import type { Availability } from '../data/game/availability'
import type { ItemId } from '../data'
import { solve, suggestRecipes } from './solve'
import type { OutpostId, OutpostPlan, OutpostSolution } from './types'

export type Solved = { plan: OutpostPlan; solution: OutpostSolution; suggested: Record<ItemId, string> }

export function solvePlan(plan: OutpostPlan, available: Availability): Solved {
  const suggested = suggestRecipes(plan, available)
  return { plan, solution: solve(plan, available, suggested), suggested }
}

/** What an outpost sends out, per minute, including leftover resources and byproducts. */
export function exportsOf(s: OutpostSolution) {
  return [...s.flows.values()].filter((f) => f.exported > 1e-6).map((f) => ({ item: f.item, perMin: f.exported }))
}

export type Offer = { from: OutpostId; fromName: string; item: ItemId; perMin: number; claimed: number }

/**
 * Exports of every outpost except `forId`, minus what's already imported from
 * them (by anyone, `forId` included): what `forId` could still bring in.
 */
export function offers(all: Solved[], forId: OutpostId | null): Offer[] {
  const claimed = new Map<string, number>()
  for (const { plan } of all) {
    for (const imp of plan.imports) {
      const k = `${imp.from}|${imp.item}`
      claimed.set(k, (claimed.get(k) ?? 0) + imp.perMin)
    }
  }
  const out: Offer[] = []
  for (const { plan, solution } of all) {
    if (plan.id === forId) continue
    for (const e of exportsOf(solution)) {
      const taken = claimed.get(`${plan.id}|${e.item}`) ?? 0
      out.push({ from: plan.id, fromName: plan.name, item: e.item, perMin: Math.max(0, e.perMin - taken), claimed: taken })
    }
  }
  return out
}
