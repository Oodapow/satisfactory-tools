import { describe, expect, it } from 'vitest'
import { schematics } from '../data'
import { availability } from '../data/game/availability'
import { solvePlan } from '../plan/network'
import type { OutpostPlan } from '../plan/types'
import { proposeLayout } from './generate'
import { G, cellOf, isBlock, SIZE } from './grid'
import { routeFloorPlan, routeSegments } from './gridRouter'
import { planLayout } from './layout'
import { inferFlows } from './flow'

const all = availability({ purchased: schematics.map((s) => s.id), spaceElevatorPhase: 5 })
const standard = {
  Desc_IronPlate_C: 'Recipe_IronPlate_C',
  Desc_IronScrew_C: 'Recipe_Screw_C',
  Desc_IronRod_C: 'Recipe_IronRod_C',
  Desc_IronIngot_C: 'Recipe_IngotIron_C',
  Desc_IronPlateReinforced_C: 'Recipe_IronPlateReinforced_C',
}
const plan = (patch: Partial<OutpostPlan>): OutpostPlan => ({
  id: 'test',
  name: 'Test',
  notes: '',
  goals: [],
  nodes: [],
  imports: [],
  selfPowered: false,
  createdAt: '',
  updatedAt: '',
  ...patch,
  recipeChoices: { ...standard, ...patch.recipeChoices },
})
/** Belts and pipes: power lines are straight wires and skip the grid. */
const lines = <E extends { data?: { medium?: string } }>(edges: E[]) => edges.filter((e) => e.data?.medium !== 'power')
const ironImport = (perMin: number) => ({ linkId: 'ore', other: 'Iron Fields', transport: 'belt' as const, item: 'Desc_OreIron_C', perMin })
// The example from #13: 20 Reinforced Iron Plate/min from 240 Iron Ore/min.
const rip = (patch: Partial<OutpostPlan> = {}) =>
  solvePlan(plan({ goals: [{ kind: 'item', item: 'Desc_IronPlateReinforced_C', perMin: 20 }], imports: [{ id: 'ore', from: 'x', item: 'Desc_OreIron_C', perMin: 240, via: 'belt' }], ...patch }), all)

describe('planLayout', () => {
  it('puts one production type on each floor, bottom up', () => {
    const l = planLayout({ solved: rip(), incoming: [ironImport(240)], outgoing: [], maxBeltTier: 3 })
    expect(l.floors.map((f) => f.building)).toEqual(['Desc_SmelterMk1_C', 'Desc_ConstructorMk1_C', 'Desc_ConstructorMk1_C', 'Desc_AssemblerMk1_C'])
    // Plates and rods share a floor; screws sit above the rods.
    expect(l.floors[1].lines.map((x) => x.recipe).sort()).toEqual(['Recipe_IronPlate_C', 'Recipe_IronRod_C'])
    expect(l.floors[2].lines.map((x) => x.recipe)).toEqual(['Recipe_Screw_C'])
    expect(l.floors[0].lines.reduce((n, x) => n + x.machines, 0)).toBe(8)
    expect(l.floors.every((f) => f.foundations.x > 0 && f.foundations.y > 0)).toBe(true)
  })

  it('splits a line when one belt of the best tier cannot carry it', () => {
    // 240 ore/min fits one Mk.3 belt (270) but not one Mk.2 belt (120).
    const mk3 = planLayout({ solved: rip(), incoming: [ironImport(240)], outgoing: [], maxBeltTier: 3 })
    const mk2 = planLayout({ solved: rip(), incoming: [ironImport(240)], outgoing: [], maxBeltTier: 2 })
    expect(mk3.floors[0].lines).toHaveLength(1)
    expect(mk2.floors[0].lines).toHaveLength(2)
    expect(mk2.floors[0].lines.map((x) => x.machines)).toEqual([4, 4])
    // The import arrives on as many belts as it needs.
    expect(mk2.ports.filter((p) => p.item === 'Desc_OreIron_C')).toHaveLength(2)
    for (const f of mk2.flows) expect(f.perMin).toBeLessThanOrEqual(f.item === 'Desc_IronScrew_C' ? 240 + 1e-6 : 120 + 1e-6)
  })

  it('takes imported parts at a port instead of making them', () => {
    const solved = rip({ imports: [
      { id: 'ore', from: 'x', item: 'Desc_OreIron_C', perMin: 240, via: 'belt' },
      { id: 'screws', from: 'y', item: 'Desc_IronScrew_C', perMin: 240, via: 'truck' },
    ] })
    const l = planLayout({ solved, incoming: [ironImport(240), { linkId: 'screws', other: 'Screw Town', transport: 'truck', item: 'Desc_IronScrew_C', perMin: 240 }], outgoing: [], maxBeltTier: 3 })
    expect(l.floors.flatMap((f) => f.lines).some((x) => x.recipe === 'Recipe_Screw_C')).toBe(false)
    const screwPort = l.ports.find((p) => p.item === 'Desc_IronScrew_C')!
    expect(screwPort.transport).toBe('truck')
    expect(l.flows.filter((f) => 'port' in f.from && f.from.port === screwPort.id).reduce((t, f) => t + f.perMin, 0)).toBeCloseTo(240)
  })

  it('feeds every consumer exactly what it needs', () => {
    const l = planLayout({ solved: rip(), incoming: [ironImport(240)], outgoing: [], maxBeltTier: 3 })
    for (const f of l.floors)
      for (const line of f.lines)
        line.ingredients.forEach((x, slot) => {
          const fed = l.flows.filter((fl) => 'line' in fl.to && fl.to.line === line.id && fl.to.slot === slot).reduce((t, fl) => t + fl.perMin, 0)
          expect(fed).toBeCloseTo(x.perMin)
        })
    const goal = l.ports.find((p) => p.label === 'Goal')!
    expect(goal.perMin).toBeCloseTo(20)
  })
})

describe('floor plan on the grid', () => {
  const graph = proposeLayout({ solved: rip(), incoming: [ironImport(240)], outgoing: [], maxBeltTier: 3 })

  it('places every block on the grid without overlaps', () => {
    const blocks = graph.nodes.filter(isBlock)
    for (const n of blocks) {
      expect(Math.abs(n.position.x % G)).toBe(0)
      expect(Math.abs(n.position.y % G)).toBe(0)
    }
    for (let i = 0; i < blocks.length; i++)
      for (let j = i + 1; j < blocks.length; j++) {
        const a = cellOf(blocks[i])
        const b = cellOf(blocks[j])
        const sa = SIZE[blocks[i].type]
        const sb = SIZE[blocks[j].type]
        const apart = a.x + sa.w <= b.x || b.x + sb.w <= a.x || a.y + sa.h <= b.y || b.y + sb.h <= a.y
        expect(apart, `${blocks[i].id} overlaps ${blocks[j].id}`).toBe(true)
      }
  })

  it('routes every belt with at most one belt per grid edge', () => {
    const { routes, clashes } = routeFloorPlan(graph.nodes, graph.edges)
    expect(routes.size).toBe(lines(graph.edges).length)
    expect(clashes).toEqual([])
    const seen = new Map<string, string>()
    for (const [id, pts] of routes)
      for (const s of routeSegments(pts)) {
        expect(seen.get(s), `${id} shares ${s} with ${seen.get(s)}`).toBeUndefined()
        seen.set(s, id)
      }
  })

  it('turns splitters and mergers to face their belts', () => {
    const { orients } = routeFloorPlan(graph.nodes, graph.edges)
    // Manifold splitters take in from the left; manifold mergers send out to the left.
    const splitter = graph.nodes.find((n) => n.type === 'splitter' && graph.edges.some((e) => e.source === n.id && e.sourceHandle === 'down'))!
    expect(orients.get(splitter.id)).toEqual({ rot: 0, mirror: false })
    const merger = graph.nodes.find((n) => n.type === 'merger' && graph.edges.some((e) => e.target === n.id && e.targetHandle === 'up'))!
    expect(orients.get(merger.id)?.rot).toBe(2)
  })
})

describe('bigger outposts', () => {
  const cases = [
    ['Desc_IronPlateReinforced_C', 100, 3],
    ['Desc_ModularFrame_C', 30, 3],
    ['Desc_Computer_C', 5, 3],
    ['Desc_Motor_C', 10, 4],
    ['Desc_AluminumIngot_C', 60, 4],
  ] as const
  it.each(cases)('routes %s at %d/min on Mk.%d belts without two belts sharing grid space', (item, perMin, tier) => {
    const solved = solvePlan(plan({ goals: [{ kind: 'item', item, perMin }], recipeChoices: {} }), all)
    const g = proposeLayout({ solved, incoming: [], outgoing: [], maxBeltTier: tier })
    const r = routeFloorPlan(g.nodes, g.edges)
    expect(r.routes.size).toBe(lines(g.edges).length)
    expect(r.clashes).toEqual([])
    // What each belt carries can be worked out again from the blocks it joins.
    const flows = inferFlows(g.nodes, g.edges)
    for (const e of lines(g.edges)) expect(flows.get(e.id)?.perMin, e.id).toBeCloseTo(e.data!.perMin!, 4)
    // Every port is connected.
    for (const n of g.nodes.filter((x) => x.type === 'port' && x.data.kind === 'port' && x.data.transport !== 'power'))
      expect(g.edges.some((e) => e.source === n.id || e.target === n.id), n.id).toBe(true)
  })
})
