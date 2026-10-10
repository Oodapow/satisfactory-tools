// Defaults for a new outpost goal: which item to make next, and how much of it.
import { items, recipes, resourcesById, schematicsById, type ItemId } from '../data'
import type { Availability } from '../data/game/availability'
import { extractorPerMin, extractorsFor, perMin, recipesFor } from './solve'
import { solvePlan } from './network'
import type { OutpostPlan } from './types'

/** HUB tier a recipe unlocks at: its milestone's tier, 0 for the tutorial and starting recipes. */
function unlockTier(unlockedBy: string[]) {
  const tiers = unlockedBy
    .map((id) => schematicsById.get(id))
    .map((s) => (s?.type === 'milestone' ? s.tier : 0))
  return tiers.length ? Math.min(...tiers) : 0
}

/**
 * How far into the game each item is: the HUB tier its standard recipe unlocks at,
 * or the latest tier among its ingredients if that's later (MAM recipes carry no tier,
 * so they rank by what they're made of). Raw resources an extractor can mine are 0;
 * items that need something no extractor gives (leaves, alien remains) get no rank.
 */
const depth: Map<ItemId, number> = (() => {
  const rank = new Map<ItemId, number>()
  for (const r of resourcesById.values()) if (r.extractors.length) rank.set(r.id, 0)
  const production = recipes.filter((r) => r.kind === 'production' && r.producedIn.length > 0)
  const standard = new Set(production.filter((r) => !r.alternate).flatMap((r) => r.products.map((p) => p.item)))
  // Alternates only count for items that have no standard recipe.
  const usable = production.filter((r) => !r.alternate || r.products.some((p) => !standard.has(p.item)))
  for (let changed = true; changed; ) {
    changed = false
    for (const r of usable) {
      const inputs = r.ingredients.map((i) => rank.get(i.item) ?? Infinity)
      const d = Math.max(unlockTier((r as { unlockedBy?: string[] }).unlockedBy ?? []), ...inputs)
      if (!Number.isFinite(d)) continue
      for (const p of r.products) {
        if (r.alternate && standard.has(p.item)) continue
        if (d < (rank.get(p.item) ?? Infinity)) {
          rank.set(p.item, d)
          changed = true
        }
      }
    }
  }
  return rank
})()

const sinkPoints = new Map(items.map((i) => [i.id, i.sinkPoints ?? 0]))

/**
 * The item to suggest for a new goal: the newest one (latest tier, then the most
 * complex by sink value) that can be made and that no outpost delivers yet.
 */
export function suggestGoalItem(candidates: ItemId[], available: Availability, delivered: Iterable<ItemId>): ItemId | undefined {
  const taken = new Set(delivered)
  const makeable = candidates.filter((id) => depth.has(id) && !resourcesById.has(id) && recipesFor(id, available).length > 0)
  const pool = makeable.filter((id) => !taken.has(id))
  const pick = (pool.length ? pool : makeable.length ? makeable : candidates).slice()
  pick.sort((a, b) => (depth.get(b) ?? -1) - (depth.get(a) ?? -1) || (sinkPoints.get(b) ?? 0) - (sinkPoints.get(a) ?? 0))
  return pick[0]
}

/** Largest multiple of one final machine's output tried before settling for a near fit. */
const MAX_MULTIPLE = 6

/**
 * A goal rate where the whole chain runs at 100%: the smallest multiple (2 or more) of
 * one final machine's output at which every machine count comes out whole. When no
 * multiple up to 6 does, the one of 2–4 that leaves the least idle capacity wins.
 * Raw resources get two normal nodes' worth from the best extractor.
 */
export function suggestGoalRate(item: ItemId, available: Availability): number {
  if (resourcesById.has(item)) {
    const b = extractorsFor(item, available.buildings)[0]
    return b ? round(2 * extractorPerMin(b, item)) : 60
  }
  const solved = solvePlan(probe(item, 1), available)
  const recipe = recipesFor(item, available).find((r) => r.id === solved.solution.recipes[item])
  const out = recipe?.products.find((p) => p.item === item)
  if (!recipe || !out) return 10
  const unit = perMin(out.amount, recipe)
  // Machines needed for one final machine's output; the chain scales linearly from there.
  const chain = solvePlan(probe(item, unit), available).solution.steps.map((s) => s.machines)
  const idle = (k: number) => chain.reduce((sum, m) => sum + (Math.ceil(m * k - 1e-6) - m * k), 0)
  for (let k = 2; k <= MAX_MULTIPLE; k++) if (idle(k) < 1e-6) return round(unit * k)
  const k = [2, 3, 4].reduce((best, n) => (idle(n) / n < idle(best) / best - 1e-9 ? n : best))
  return round(unit * k)
}

const round = (n: number) => Math.round(n * 1000) / 1000

function probe(item: ItemId, rate: number): OutpostPlan {
  return {
    id: 'suggest',
    name: '',
    notes: '',
    goals: [{ kind: 'item', item, perMin: rate }],
    nodes: [],
    imports: [],
    recipeChoices: {},
    selfPowered: false,
    createdAt: '',
    updatedAt: '',
  }
}
