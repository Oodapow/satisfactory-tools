import { describe, expect, it } from 'vitest'
import { schematics } from '../data'
import { availability } from '../data/game/availability'
import { solvePlan } from '../plan/network'
import type { OutpostPlan } from '../plan/types'
import { proposeLayout } from './generate'
import { routeFloorPlan } from './gridRouter'
import { lineQuality } from './quality'

const all = availability({ purchased: schematics.map((s) => s.id), spaceElevatorPhase: 5 })
const plan = (patch: Partial<OutpostPlan>): OutpostPlan => ({
  id: 'test', name: 'Test', notes: '', goals: [], nodes: [], imports: [], createdAt: '', updatedAt: '', recipeChoices: {}, ...patch,
})

// Bends and crossings of every line (belts, pipes and power) in the top-to-bottom layout that
// came before #88, measured on the same outposts.
const before = [
  ['Desc_IronPlateReinforced_C', 20, 3, { bends: 80, crossings: 45 }],
  ['Desc_IronPlateReinforced_C', 100, 3, { bends: 419, crossings: 473 }],
  ['Desc_ModularFrame_C', 30, 3, { bends: 335, crossings: 247 }],
  ['Desc_Computer_C', 5, 3, { bends: 87, crossings: 67 }],
  ['Desc_Motor_C', 10, 4, { bends: 165, crossings: 156 }],
  ['Desc_AluminumIngot_C', 60, 4, { bends: 33, crossings: 12 }],
] as const

describe('left-to-right floor plans (#88)', () => {
  it.each(before)('%s at %d/min on Mk.%d belts has fewer bends and crossings than before', (item, perMin, tier, old) => {
    const g = proposeLayout({ solved: solvePlan(plan({ goals: [{ kind: 'item', item, perMin }] }), all), incoming: [], outgoing: [], maxBeltTier: tier })
    const q = lineQuality(routeFloorPlan(g.nodes, g.edges).routes)
    expect(q.bends).toBeLessThan(old.bends)
    expect(q.crossings).toBeLessThan(old.crossings)
  })
})
