import { describe, expect, it } from 'vitest'
import { schematics } from '../data'
import { availability } from '../data/game/availability'
import { addStep, editStep, removeStep } from './edit'
import { solvePlan } from './network'
import type { OutpostPlan } from './types'

const all = availability({ purchased: schematics.map((s) => s.id), spaceElevatorPhase: 5 })
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
const ctx = { available: all }
const goalRate = (p: Partial<OutpostPlan>, item: string) => p.goals?.flatMap((g) => (g.kind === 'item' && g.item === item ? [g.perMin] : []))[0]

describe('editing the plan', () => {
  it('snaps the goal to what a set clock makes', () => {
    // 15 plates/min at 50% clock: one plate constructor at 50% makes 10, so two make 20.
    const solved = solvePlan(plan({ goals: [{ kind: 'item', item: 'Desc_IronPlate_C', perMin: 15 }] }), all)
    const patch = editStep(solved, ctx, 'Recipe_IronPlate_C', { count: 2, clock: 0.5 })
    expect(patch.steps).toEqual({ Recipe_IronPlate_C: { count: 2, clock: 0.5 } })
    expect(goalRate(patch, 'Desc_IronPlate_C')).toBeCloseTo(20)
  })

  it('scales the goal from an intermediate step', () => {
    // 20 reinforced plates/min need four rod constructors' work; two of them at 100% are enough for 10.
    const solved = solvePlan(plan({ goals: [{ kind: 'item', item: 'Desc_IronPlateReinforced_C', perMin: 20 }] }), all)
    const patch = editStep(solved, ctx, 'Recipe_IronRod_C', { count: 2, clock: 1 })
    expect(goalRate(patch, 'Desc_IronPlateReinforced_C')).toBeCloseTo(10)
    const after = solvePlan({ ...solved.plan, ...patch }, all).solution
    expect(after.steps.find((s) => s.recipe === 'Recipe_IronRod_C')).toMatchObject({ count: 2, clock: 1 })
    expect(after.flows.get('Desc_IronRod_C')!.shortfall).toBeCloseTo(0)
  })

  it("doesn't touch goals for a count alone, and resets to the suggestion", () => {
    const solved = solvePlan(plan({ goals: [{ kind: 'item', item: 'Desc_IronScrew_C', perMin: 100 }], steps: { Recipe_Screw_C: { count: 2, clock: 0.5 } } }), all)
    expect(editStep(solved, ctx, 'Recipe_Screw_C', { count: 5 })).toEqual({ steps: { Recipe_Screw_C: { count: 5 } } })
    expect(editStep(solved, ctx, 'Recipe_Screw_C', undefined)).toEqual({ steps: {} })
  })

  it('adds a step as a goal of one machine, and removes it again', () => {
    const p = plan({})
    const added = addStep(p, 'Recipe_Screw_C')
    expect(added.goals).toEqual([{ kind: 'item', item: 'Desc_IronScrew_C', perMin: 40 }])
    expect(added.recipeChoices?.Desc_IronScrew_C).toBe('Recipe_Screw_C')
    expect(goalRate(addStep({ ...p, ...added }, 'Recipe_Screw_C'), 'Desc_IronScrew_C')).toBe(80)
    expect(removeStep({ ...p, ...added }, 'Recipe_Screw_C', 'Desc_IronScrew_C').goals).toEqual([])
  })

  it('removing an intermediate step imports its item instead', () => {
    const p = plan({ goals: [{ kind: 'item', item: 'Desc_IronPlateReinforced_C', perMin: 20 }] })
    const patch = removeStep(p, 'Recipe_Screw_C', 'Desc_IronScrew_C')
    expect(patch.skipped).toEqual(['Desc_IronScrew_C'])
    expect(patch.goals).toBeUndefined()
  })
})
