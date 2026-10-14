// Edits made on the Plan tab. A step the user sizes (machine count and clock) fixes what it
// makes, so the goals it serves are scaled to match: the plan drives the goals, not only the
// other way round.
import { recipesById, type ItemId, type RecipeId } from '../data'
import type { Availability } from '../data/game/availability'
import type { Solved } from './network'
import { perMin, solve, type SolveOptions } from './solve'
import type { PlanPatch } from './store'
import type { Goal, OutpostPlan, StepSetting } from './types'

type Ctx = { available: Availability; options?: SolveOptions }

const demandOf = (plan: OutpostPlan, solved: Solved, ctx: Ctx, recipe: RecipeId) =>
  solve(plan, ctx.available, solved.suggested, ctx.options).steps.find((s) => s.recipe === recipe)?.demand ?? 0

/**
 * Item goals scaled so `recipe`'s step is asked for exactly `target` machines' worth of
 * work. Only goals whose chain reaches the step change; with none (it only feeds
 * generators, say) the goals stay as they are.
 */
export function fitGoals(plan: OutpostPlan, solved: Solved, ctx: Ctx, recipe: RecipeId, target: number): Goal[] {
  const base = demandOf(plan, solved, ctx, recipe)
  if (base <= 1e-9) return plan.goals
  const feeds = plan.goals.map((g, i) => g.kind === 'item' && demandOf({ ...plan, goals: plan.goals.filter((_, j) => j !== i) }, solved, ctx, recipe) < base - 1e-9)
  if (!feeds.some(Boolean)) return plan.goals
  let goals = plan.goals
  // Demand is linear in the goals apart from imports and byproducts, so this settles fast.
  for (let i = 0, d = base; i < 8 && d > 1e-9 && Math.abs(d - target) > 1e-6; i++) {
    const f = target / d
    goals = goals.map((g, j) => (feeds[j] && g.kind === 'item' ? { ...g, perMin: clean(g.perMin * f) } : g))
    d = demandOf({ ...plan, goals }, solved, ctx, recipe)
  }
  return goals
}

const clean = (n: number) => Math.round(n * 1e9) / 1e9

/**
 * Store `setting` for a step (none resets it to the suggestion). When it fixes both the
 * machine count and the clock, the goals snap to what those machines make.
 */
export function editStep(solved: Solved, ctx: Ctx, recipe: RecipeId, setting: StepSetting | undefined): PlanPatch {
  const { plan } = solved
  const steps = { ...plan.steps }
  const kept = setting && Object.fromEntries(Object.entries(setting).filter(([, v]) => v !== undefined))
  if (kept && Object.keys(kept).length) steps[recipe] = kept
  else delete steps[recipe]
  if (!setting?.count || !setting.clock) return { steps }
  const next = { ...plan, steps }
  // The solver clamps the clock to what the machine allows; fit to what it will really run.
  const step = solve(next, ctx.available, solved.suggested, ctx.options).steps.find((s) => s.recipe === recipe)
  if (!step) return { steps }
  return { steps, goals: fitGoals(next, solved, ctx, recipe, step.count * step.clock) }
}

/**
 * Add a production step for `recipe`: its main product becomes a goal (or an existing
 * goal for it grows) by one machine's output, and the recipe is picked for that item.
 */
export function addStep(plan: OutpostPlan, recipe: RecipeId): PlanPatch {
  const r = recipesById.get(recipe)
  if (!r) return {}
  const out = r.products[0]
  const rate = perMin(out.amount, r)
  const has = plan.goals.some((g) => g.kind === 'item' && g.item === out.item)
  return {
    recipeChoices: { ...plan.recipeChoices, [out.item]: recipe },
    skipped: plan.skipped?.filter((i) => i !== out.item),
    goals: has
      ? plan.goals.map((g) => (g.kind === 'item' && g.item === out.item ? { ...g, perMin: clean(g.perMin + rate) } : g))
      : [...plan.goals, { kind: 'item', item: out.item, perMin: clean(rate) }],
  }
}

/**
 * Remove the step making `item` with `recipe`. A goal step takes its goal with it; a step
 * that feeds others means the item isn't made here and has to be imported.
 */
export function removeStep(plan: OutpostPlan, recipe: RecipeId, item: ItemId): PlanPatch {
  const steps = { ...plan.steps }
  delete steps[recipe]
  const isGoal = plan.goals.some((g) => g.kind === 'item' && g.item === item)
  if (isGoal) return { steps, goals: plan.goals.filter((g) => !(g.kind === 'item' && g.item === item)) }
  return { steps, skipped: [...new Set([...(plan.skipped ?? []), item])] }
}
