import { describe, expect, it } from 'vitest'
import { buildingsById, schematics } from '../data'
import { availability } from '../data/game/availability'
import { machinePowerMW, shardsFor, sizeMachines, solve } from './solve'
import type { OutpostPlan } from './types'

// Everything unlocked, and the same minus the MAM research that unlocks overclocking and Somersloops.
const all = availability({ purchased: schematics.map((s) => s.id), spaceElevatorPhase: 5 })
const noResearch = availability({
  purchased: schematics.filter((s) => !s.unlocks.features.some((f) => f === 'overclocking' || f === 'production-amplification')).map((s) => s.id),
  spaceElevatorPhase: 5,
})
// Standard recipes only, so the numbers below match the game's defaults.
const standard = { Desc_IronPlate_C: 'Recipe_IronPlate_C', Desc_IronScrew_C: 'Recipe_Screw_C', Desc_IronRod_C: 'Recipe_IronRod_C', Desc_IronIngot_C: 'Recipe_IngotIron_C', Desc_IronPlateReinforced_C: 'Recipe_IronPlateReinforced_C' }
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
const step = (s: ReturnType<typeof solve>, recipe: string) => s.steps.find((x) => x.recipe === recipe)!

describe('machine sizing', () => {
  it('underclocks the fewest machines evenly', () => {
    expect(sizeMachines(2.5)).toEqual({ count: 3, clock: 2.5 / 3 })
    expect(sizeMachines(4)).toEqual({ count: 4, clock: 1 })
    expect(sizeMachines(4, 2)).toEqual({ count: 2, clock: 2 })
    expect(sizeMachines(4, 2.5)).toEqual({ count: 2, clock: 2 })
    expect(sizeMachines(0)).toEqual({ count: 0, clock: 0 })
  })
  it('needs one shard per 50% above 100%', () => {
    expect([1, 1.01, 1.5, 1.51, 2, 2.5].map(shardsFor)).toEqual([0, 1, 1, 2, 2, 3])
    expect(shardsFor(0.5)).toBe(0)
  })
  it('scales power with the clock exponent and Somersloops', () => {
    const constructor = buildingsById.get('Desc_ConstructorMk1_C')!
    expect(machinePowerMW(constructor)).toBeCloseTo(4)
    expect(machinePowerMW(constructor, 2)).toBeCloseTo(4 * Math.pow(2, 1.321929), 3)
    expect(machinePowerMW(constructor, 0.5)).toBeCloseTo(4 * Math.pow(0.5, 1.321929), 3)
    expect(machinePowerMW(constructor, 1, 2)).toBeCloseTo(16)
  })
})

describe('solve', () => {
  it('sizes 20 Reinforced Iron Plate/min from 240 Iron Ore/min', () => {
    const s = solve(plan({ goals: [{ kind: 'item', item: 'Desc_IronPlateReinforced_C', perMin: 20 }], nodes: [] }), all)
    expect(step(s, 'Recipe_IronPlateReinforced_C').count).toBe(4)
    expect(step(s, 'Recipe_IronPlate_C').count).toBe(6)
    expect(step(s, 'Recipe_Screw_C').count).toBe(6)
    expect(step(s, 'Recipe_IronRod_C').count).toBe(4)
    expect(step(s, 'Recipe_IngotIron_C').count).toBe(8)
    expect(s.flows.get('Desc_OreIron_C')!.shortfall).toBeCloseTo(240)
  })

  it('takes imported screws instead of making them', () => {
    const s = solve(
      plan({
        goals: [{ kind: 'item', item: 'Desc_IronPlateReinforced_C', perMin: 20 }],
        imports: [{ id: 'i', from: 'x', item: 'Desc_IronScrew_C', perMin: 240, via: 'belt' }],
      }),
      all,
    )
    expect(s.steps.find((x) => x.recipe === 'Recipe_Screw_C')).toBeUndefined()
    expect(s.flows.get('Desc_OreIron_C')!.shortfall).toBeCloseTo(180)
  })

  it('underclocks to match and draws less power', () => {
    const s = solve(plan({ goals: [{ kind: 'item', item: 'Desc_IronPlate_C', perMin: 50 }] }), all)
    const plates = step(s, 'Recipe_IronPlate_C')
    expect(plates.count).toBe(3)
    expect(plates.clock).toBeCloseTo(50 / 60)
    expect(plates.powerMW).toBeCloseTo(3 * 4 * Math.pow(50 / 60, 1.321929), 3)
  })

  it('overclocks up to the plan limit once researched', () => {
    const p = plan({ goals: [{ kind: 'item', item: 'Desc_IronPlate_C', perMin: 80 }], maxClock: 2 })
    const plates = step(solve(p, all), 'Recipe_IronPlate_C')
    expect(plates.count).toBe(2)
    expect(plates.clock).toBeCloseTo(2)
    expect(plates.shards).toBe(4)
    expect(step(solve(p, noResearch), 'Recipe_IronPlate_C').count).toBe(4)
  })

  it('applies Somersloops to output and power', () => {
    const p = plan({ goals: [{ kind: 'item', item: 'Desc_IronPlate_C', perMin: 40 }], somersloops: { Recipe_IronPlate_C: 1 } })
    const plates = step(solve(p, all), 'Recipe_IronPlate_C')
    expect(plates.boost).toBe(2)
    expect(plates.count).toBe(1)
    expect(plates.powerMW).toBeCloseTo(16)
    // Half the ingots for the same plates.
    expect(solve(p, all).flows.get('Desc_IronIngot_C')!.consumed).toBeCloseTo(30)
    expect(step(solve(p, noResearch), 'Recipe_IronPlate_C').count).toBe(2)
  })

  it('extracts by purity, miner and clock', () => {
    const node = (purity: 'impure' | 'normal' | 'pure', clock?: number) =>
      solve(plan({ nodes: [{ id: 'n', resource: 'Desc_OreIron_C', purity, extractor: 'Desc_MinerMk1_C', clock }] }), all).extraction[0]
    expect(node('impure').perMin).toBeCloseTo(30)
    expect(node('normal').perMin).toBeCloseTo(60)
    expect(node('pure').perMin).toBeCloseTo(120)
    const fast = node('pure', 2.5)
    expect(fast.perMin).toBeCloseTo(300)
    expect(fast.shards).toBe(3)
    expect(fast.powerMW).toBeCloseTo(5 * Math.pow(2.5, 1.321929), 3)
  })

  it('feeds byproducts back before making more', () => {
    // Aluminum Scrap gives off water that the Alumina Solution step can use.
    const s = solve(
      plan({
        goals: [{ kind: 'item', item: 'Desc_AluminumScrap_C', perMin: 360 }],
        recipeChoices: { Desc_AluminumScrap_C: 'Recipe_AluminumScrap_C', Desc_AluminaSolution_C: 'Recipe_AluminaSolution_C' },
      }),
      all,
    )
    const water = s.flows.get('Desc_Water_C')!
    // 360 scrap/min needs 240 alumina (360 water) and gives 120 water back.
    expect(water.byproduct).toBeCloseTo(120)
    expect(water.consumed).toBeCloseTo(360)
    expect(water.extracted).toBeCloseTo(240)
    expect(water.exported).toBeCloseTo(0)
    expect(water.shortfall).toBeCloseTo(0)
    // Silica has no use here, so it leaves as a byproduct.
    expect(s.flows.get('Desc_Silica_C')!.exported).toBeCloseTo(100)
  })
})
