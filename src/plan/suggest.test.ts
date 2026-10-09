import { describe, expect, it } from 'vitest'
import { items, progression } from '../data'
import { availability } from '../data/game/availability'
import { solvePlan } from './network'
import { suggestGoalItem, suggestGoalRate } from './suggest'

const throughTier = (n: number) =>
  availability({ purchased: progression.tiers.filter((t) => t.tier <= n).flatMap((t) => t.milestones), spaceElevatorPhase: 5 })
const tier2 = throughTier(2)
const unlocked = items.map((i) => i.id).filter((id) => tier2.items.has(id))

describe('suggested goal item', () => {
  it('picks the newest unlocked part, not the alphabetical first', () => {
    const item = suggestGoalItem(unlocked, tier2, [])!
    expect(['Desc_SpaceElevatorPart_1_C', 'Desc_ModularFrame_C', 'Desc_Rotor_C']).toContain(item)
  })
  it('skips items another outpost already delivers', () => {
    const first = suggestGoalItem(unlocked, tier2, [])!
    expect(suggestGoalItem(unlocked, tier2, [first])).not.toBe(first)
  })
  it('never suggests raw resources or things that need leaves', () => {
    const ids = unlocked.filter((id) => ['Desc_OreIron_C', 'Desc_GenericBiomass_C', 'Desc_IronPlate_C'].includes(id))
    expect(suggestGoalItem(ids, tier2, [])).toBe('Desc_IronPlate_C')
  })
})

describe('suggested goal rate', () => {
  const machines = (item: string, perMin: number) =>
    solvePlan(
      { id: 't', name: '', notes: '', goals: [{ kind: 'item', item, perMin }], nodes: [], imports: [], recipeChoices: {}, selfPowered: false, createdAt: '', updatedAt: '' },
      tier2,
    ).solution.steps
  it('is a multiple of one machine at which the whole chain runs at 100%', () => {
    // One constructor makes 20 Iron Plate/min; 40/min is 2 constructors on 2 smelters.
    expect(suggestGoalRate('Desc_IronPlate_C', tier2)).toBe(40)
    for (const item of ['Desc_IronPlate_C', 'Desc_IronPlateReinforced_C', 'Desc_Rotor_C', 'Desc_Cable_C']) {
      for (const s of machines(item, suggestGoalRate(item, tier2))) expect(s.machines).toBeCloseTo(Math.round(s.machines), 6)
    }
  })
  it('is not 10 for everything', () => {
    const rates = new Set(['Desc_IronPlate_C', 'Desc_Cable_C', 'Desc_Rotor_C', 'Desc_Cement_C'].map((i) => suggestGoalRate(i, tier2)))
    expect(rates.size).toBeGreaterThan(1)
  })
})
