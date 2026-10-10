import { describe, expect, it } from 'vitest'
import { schematics } from '../data'
import { availability } from '../data/game/availability'
import { solvePlan } from '../plan/network'
import type { OutpostPlan } from '../plan/types'
import { connection, place } from './connect'
import { inferFlows } from './flow'
import { routeFloorPlan, routeSegments } from './gridRouter'
import { proposeLayout } from './generate'
import { cellOf, edgeMedium, overlaps, poleSize, sizeOf, type BlockKind } from './grid'
import type { MicroGraph, MicroNode } from './model'

const all = availability({ purchased: schematics.map((s) => s.id), spaceElevatorPhase: 5 })
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
  recipeChoices: {},
  ...patch,
})
const coalPower = () =>
  proposeLayout({
    solved: solvePlan(plan({ goals: [{ kind: 'power', mw: 200, generator: 'Desc_GeneratorCoal_C', fuel: 'Desc_Coal_C' }], nodes: [{ id: 'n', resource: 'Desc_Coal_C', purity: 'normal' }] }), all),
    incoming: [],
    outgoing: [],
    maxBeltTier: 3,
    maxPoleTier: 1,
  })
const plateInput = () => ({
  solved: solvePlan(plan({ goals: [{ kind: 'item', item: 'Desc_IronPlateReinforced_C', perMin: 20 }], recipeChoices: { Desc_IronScrew_C: 'Recipe_Screw_C' } }), all),
  incoming: [],
  outgoing: [],
  maxBeltTier: 3,
})
const plates = () => proposeLayout(plateInput())
const byId = (g: MicroGraph) => new Map(g.nodes.map((n) => [n.id, n]))

describe('pipes (#47)', () => {
  it('carries water in pipes through pipeline junctions, never belts, splitters or mergers', () => {
    const g = coalPower()
    const nodes = byId(g)
    const water = g.edges.filter((e) => e.data?.item === 'Desc_Water_C')
    expect(water.length).toBeGreaterThan(0)
    for (const e of water) {
      expect(edgeMedium(e, nodes)).toBe('fluid')
      for (const end of [nodes.get(e.source)!, nodes.get(e.target)!]) expect(['splitter', 'merger']).not.toContain(end.type)
    }
    expect(g.nodes.some((n) => n.type === 'junction')).toBe(true)
  })
})

describe('power (#48)', () => {
  for (const [name, make] of [['coal power', coalPower], ['plates', plates]] as const)
    it(`wires every machine of ${name} to a pole, no pole over its connections`, () => {
      const g = make()
      const nodes = byId(g)
      const wires = g.edges.filter((e) => edgeMedium(e, nodes) === 'power')
      for (const m of g.nodes.filter((n) => n.type === 'machine')) expect(wires.some((w) => w.target === m.id && w.targetHandle === 'power'), m.id).toBe(true)
      for (const p of g.nodes.filter((n) => n.type === 'pole')) {
        const n = wires.filter((w) => w.source === p.id || w.target === p.id).length
        expect(n).toBeLessThanOrEqual(poleSize(p.data))
      }
      // Every pole is reachable from every other: one grid.
      const adj = new Map<string, string[]>()
      for (const w of wires) {
        adj.set(w.source, [...(adj.get(w.source) ?? []), w.target])
        adj.set(w.target, [...(adj.get(w.target) ?? []), w.source])
      }
      const poles = g.nodes.filter((n) => n.type === 'pole').map((n) => n.id)
      const seen = new Set([poles[0]])
      const todo = [poles[0]]
      while (todo.length)
        for (const x of adj.get(todo.pop()!) ?? [])
          if (!seen.has(x)) {
            seen.add(x)
            todo.push(x)
          }
      for (const p of poles) expect(seen.has(p), p).toBe(true)
    })

  it('runs power lines on the grid, clear of belts and of each other', () => {
    const mk3 = (tier: number) => proposeLayout({ ...plateInput(), maxPoleTier: tier })
    for (const g of [coalPower(), plates(), mk3(2), mk3(3)]) {
      const nodes = byId(g)
      const r = routeFloorPlan(g.nodes, g.edges)
      expect(r.clashes).toEqual([])
      const seen = new Map<string, string>()
      for (const e of g.edges) {
        const pts = r.routes.get(e.id)!
        expect(pts, e.id).toBeDefined()
        // Only horizontal and vertical runs between grid points.
        for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, e.id).toBe(true)
        for (const s of routeSegments(pts)) {
          expect(seen.get(s), `${e.id} (${edgeMedium(e, nodes)}) shares ${s} with ${seen.get(s)}`).toBeUndefined()
          seen.set(s, e.id)
        }
      }
    }
  })
})

describe('connection points (#50)', () => {
  for (const [name, make] of [['coal power', coalPower], ['plates', plates]] as const)
    it(`uses every connection point of ${name} at most once`, () => {
      const g = make()
      const seen = new Set<string>()
      for (const e of g.edges)
        for (const k of [`${e.source}:${e.sourceHandle}`, `${e.target}:${e.targetHandle}`]) {
          expect(seen.has(k), k).toBe(false)
          seen.add(k)
        }
    })

  const machine = (id: string, recipe: string, x = 0): MicroNode => ({ id, type: 'machine', position: { x, y: 0 }, data: { kind: 'machine', building: 'Desc_ConstructorMk1_C', recipe, clock: 1, count: 1, floor: 0 } })
  const g: MicroGraph = {
    maxBeltTier: 3,
    nodes: [machine('ingot', 'Recipe_IronPlate_C'), machine('plate', 'Recipe_IronPlate_C', 400), { id: 'j', type: 'junction', position: { x: 0, y: 200 }, data: { kind: 'junction', floor: 0 } }],
    edges: [],
  }
  it('turns a line dragged from an input to run output to input', () => {
    const c = connection(g, { source: 'plate', sourceHandle: 'in', target: 'ingot', targetHandle: 'out' })
    expect(c?.c).toMatchObject({ source: 'ingot', sourceHandle: 'out', target: 'plate', targetHandle: 'in' })
  })
  it('refuses input to input, belt to pipe, and a taken point', () => {
    expect(connection(g, { source: 'plate', sourceHandle: 'in', target: 'ingot', targetHandle: 'in' })).toBeNull()
    expect(connection(g, { source: 'ingot', sourceHandle: 'out', target: 'j', targetHandle: 'in' })).toBeNull()
    const taken = { ...g, edges: [{ id: 'e', source: 'ingot', sourceHandle: 'out', target: 'plate', targetHandle: 'in' }] }
    expect(connection(taken, { source: 'ingot', sourceHandle: 'out', target: 'plate', targetHandle: 'in' })).toBeNull()
  })
  it('lets power connect any free power points', () => {
    expect(connection(g, { source: 'ingot', sourceHandle: 'power', target: 'plate', targetHandle: 'power' })?.medium).toBe('power')
  })
})

describe('inferred belts (#51)', () => {
  for (const [name, make] of [['coal power', coalPower], ['plates', plates]] as const)
    it(`works out the same item and rate as the ${name} proposal`, () => {
      const g = make()
      const flows = inferFlows(g.nodes, g.edges)
      for (const e of g.edges) {
        if (e.data?.medium === 'power') continue
        const f = flows.get(e.id)!
        expect(f.item, e.id).toBe(e.data?.item)
        expect(f.perMin, e.id).toBeCloseTo(e.data!.perMin!, 4)
      }
    })

  it('splits a machine output by what each branch takes, and keeps values set by hand', () => {
    const nodes: MicroNode[] = [
      { id: 'smelter', type: 'machine', position: { x: 0, y: 0 }, data: { kind: 'machine', building: 'Desc_SmelterMk1_C', recipe: 'Recipe_IngotIron_C', clock: 1, count: 1, floor: 0 } },
      { id: 's', type: 'splitter', position: { x: 0, y: 0 }, data: { kind: 'splitter', floor: 0 } },
      { id: 'a', type: 'machine', position: { x: 0, y: 0 }, data: { kind: 'machine', building: 'Desc_ConstructorMk1_C', recipe: 'Recipe_IronPlate_C', clock: 0.5, count: 1, floor: 0 } },
      { id: 'b', type: 'machine', position: { x: 0, y: 0 }, data: { kind: 'machine', building: 'Desc_ConstructorMk1_C', recipe: 'Recipe_IronRod_C', clock: 1, count: 1, floor: 0 } },
    ]
    const edges = [
      { id: 'in', source: 'smelter', sourceHandle: 'out', target: 's', targetHandle: 'in' },
      { id: 'toA', source: 's', sourceHandle: 'out', target: 'a', targetHandle: 'in' },
      { id: 'toB', source: 's', sourceHandle: 'up', target: 'b', targetHandle: 'in' },
    ]
    const f = inferFlows(nodes, edges)
    expect(f.get('in')).toMatchObject({ item: 'Desc_IronIngot_C', perMin: 30 })
    // A plate constructor at 50% takes 15, a rod constructor 15.
    expect(f.get('toA')?.perMin).toBeCloseTo(15)
    expect(f.get('toB')?.perMin).toBeCloseTo(15)
    const manual = inferFlows(nodes, [{ ...edges[0], data: { manual: true, item: 'Desc_IronIngot_C', perMin: 20 } }, ...edges.slice(1)])
    expect(manual.get('in')).toMatchObject({ perMin: 20, manual: true })
    expect(manual.get('toA')!.perMin! + manual.get('toB')!.perMin!).toBeCloseTo(20)
  })
})

describe('grid (#52)', () => {
  it('moves a dropped block off the blocks it would cover', () => {
    const g = plates()
    const m = g.nodes.find((n) => n.type === 'machine')!
    const placed = place(g.nodes, { id: 'new', type: 'machine', position: { ...m.position }, data: m.data })
    expect(placed.position).not.toEqual(m.position)
    for (const n of g.nodes.filter((x) => x.type && x.type !== 'floor'))
      expect(overlaps(cellOf(placed), sizeOf('machine', placed.data), cellOf(n), sizeOf(n.type as BlockKind, n.data), 1), n.id).toBe(false)
  })
})

describe('full clock and overflow (#60)', () => {
  it('runs every machine at 100% and lets the last one on the manifold idle', () => {
    const g = proposeLayout({
      solved: solvePlan(plan({ goals: [{ kind: 'item', item: 'Desc_IronPlate_C', perMin: 50 }], recipeChoices: { Desc_IronPlate_C: 'Recipe_IronPlate_C', Desc_IronIngot_C: 'Recipe_IngotIron_C' } }), all),
      incoming: [{ linkId: 'ingots', other: 'Smelters', transport: 'belt', item: 'Desc_IronIngot_C', perMin: 75 }],
      outgoing: [],
      maxBeltTier: 3,
    })
    const plates = g.nodes.filter((n) => n.data.kind === 'machine' && n.data.recipe === 'Recipe_IronPlate_C')
    expect(plates.map((n) => (n.data.kind === 'machine' ? n.data.clock : 0))).toEqual([1, 1, 1])
    const fed = plates.map((m) => g.edges.find((e) => e.target === m.id && e.targetHandle === 'in')!.data!.perMin!)
    expect(fed[0]).toBeCloseTo(30)
    expect(fed[1]).toBeCloseTo(30)
    expect(fed[2]).toBeCloseTo(15)
  })

  it('exports surplus ore from the end of the manifold, past the last machine', () => {
    const g = proposeLayout({
      solved: solvePlan(plan({ goals: [{ kind: 'item', item: 'Desc_IronIngot_C', perMin: 60 }], nodes: [{ id: 'n', resource: 'Desc_OreIron_C', purity: 'pure' }], recipeChoices: { Desc_IronIngot_C: 'Recipe_IngotIron_C' } }), all),
      incoming: [],
      outgoing: [],
      maxBeltTier: 6,
    })
    const nodes = byId(g)
    const surplus = g.nodes.find((n) => n.data.kind === 'port' && n.data.item === 'Desc_OreIron_C' && n.data.direction === 'out')!
    const into = g.edges.find((e) => e.target === surplus.id)!
    // It comes off a splitter that first feeds a smelter: the manifold's last one.
    const splitter = nodes.get(into.source)!
    expect(splitter.type).toBe('splitter')
    const feeds = g.edges.filter((e) => e.source === splitter.id).map((e) => nodes.get(e.target)!)
    expect(feeds.some((n) => n.data.kind === 'machine')).toBe(true)
    // The ore port feeds the manifold directly: nothing is split off before the first smelter.
    const ore = g.nodes.find((n) => n.data.kind === 'port' && n.data.transport === 'resource')!
    const first = g.edges.find((e) => e.source === ore.id)!
    expect(g.edges.filter((e) => e.source === first.target).some((e) => nodes.get(e.target)?.data.kind === 'machine')).toBe(true)
  })
})
