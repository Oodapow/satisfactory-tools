import { describe, expect, it } from 'vitest'
import { schematics } from '../data'
import { availability } from '../data/game/availability'
import { solvePlan } from '../plan/network'
import type { OutpostPlan } from '../plan/types'
import { place } from './connect'
import { proposeLayout } from './generate'
import { anchors, machineSize, spread } from './grid'
import { routeFloorPlan } from './gridRouter'
import type { MachineData } from './model'

const constructor = (rot: MachineData['rot'] = 0): MachineData => ({
  kind: 'machine',
  building: 'Desc_ConstructorMk1_C',
  recipe: 'Recipe_IronPlate_C',
  clock: 1,
  count: 1,
  floor: 0,
  rot,
})

describe('machine footprints (#68)', () => {
  it('uses the building size from the game, 2 m per cell', () => {
    // Constructor: 8 m wide, 10 m long.
    expect(machineSize('Desc_ConstructorMk1_C')).toEqual({ w: 4, h: 5 })
    // Assembler: 9 x 16 m, rounded up to whole cells.
    expect(machineSize('Desc_AssemblerMk1_C')).toEqual({ w: 5, h: 8 })
    expect(machineSize('Desc_AssemblerMk1_C', 1)).toEqual({ w: 8, h: 5 })
  })

  it('spreads points along a side on grid vertices, off the corners', () => {
    expect(spread(1, 4)).toEqual([2])
    expect(spread(4, 6)).toEqual([1, 2, 4, 5])
    for (const p of spread(4, 5)) expect(p).toBeGreaterThan(0)
  })

  it('turns its connection points with it', () => {
    const up = anchors('machine', constructor(0))
    expect(up.in).toEqual({ dx: 2, dy: 0, side: 't' })
    expect(up.out).toEqual({ dx: 2, dy: 5, side: 'b' })
    // A quarter turn clockwise: the back faces right, the front left, in a 5 x 4 block.
    const right = anchors('machine', constructor(1))
    expect(right.in).toEqual({ dx: 5, dy: 2, side: 'r' })
    expect(right.out).toEqual({ dx: 0, dy: 2, side: 'l' })
    const down = anchors('machine', constructor(2))
    expect(down.in).toEqual({ dx: 2, dy: 5, side: 'b' })
    const left = anchors('machine', constructor(3))
    expect(left.in.side).toBe('l')
    expect(left.power.side).toBe('t')
  })
})

describe('turning a machine in a proposed floor plan (#68)', () => {
  const all = availability({ purchased: schematics.map((s) => s.id), spaceElevatorPhase: 5 })
  const plan: OutpostPlan = {
    id: 't', name: 't', notes: '', nodes: [], imports: [], selfPowered: false, createdAt: '', updatedAt: '',
    goals: [{ kind: 'item', item: 'Desc_IronPlateReinforced_C', perMin: 20 }],
    recipeChoices: { Desc_IronScrew_C: 'Recipe_Screw_C' },
  }
  const g = proposeLayout({ solved: solvePlan(plan, all), incoming: [], outgoing: [], maxBeltTier: 3 })

  it('keeps every line of the turned machine on the grid', () => {
    for (const m of g.nodes.filter((n) => n.data.kind === 'machine')) {
      if (m.data.kind !== 'machine') continue
      const turned = place(g.nodes, { ...m, data: { ...m.data, rot: 1 } })
      const nodes = g.nodes.map((n) => (n.id === m.id ? turned : n))
      const { routes } = routeFloorPlan(nodes, g.edges)
      const mine = g.edges.filter((e) => e.source === m.id || e.target === m.id)
      expect(mine.filter((e) => !routes.has(e.id)).map((e) => `${m.id}:${e.sourceHandle}->${e.targetHandle}`)).toEqual([])
    }
  })
})
