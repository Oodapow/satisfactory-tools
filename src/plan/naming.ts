// Outpost names that describe the outpost: what it delivers, or else what it mines.
// A name stays automatic, and follows the outpost as it changes, until someone types their own.
import { itemName } from '../data'
import { fmt } from '../format'
import type { OutpostPlan } from './types'

type Described = Pick<OutpostPlan, 'goals' | 'nodes'>

const DEFAULT = /^Outpost \d+$/

/**
 * "Iron Plate 60/min · Screw 120/min" from its goals, otherwise "Iron Ore ×2 · Copper Ore" from
 * its nodes, most first. `fallback` when it has neither.
 */
export function autoName(plan: Described, fallback = 'New outpost') {
  const goals = plan.goals.map((g) => (g.kind === 'item' ? `${itemName(g.item)} ${fmt(g.perMin)}/min` : `${fmt(g.mw, 1)} MW`))
  if (goals.length) return goals.join(' · ')
  const counts = new Map<string, number>()
  for (const n of plan.nodes) counts.set(n.resource, (counts.get(n.resource) ?? 0) + 1)
  if (counts.size === 0) return fallback
  return [...counts]
    .sort((a, b) => b[1] - a[1] || itemName(a[0]).localeCompare(itemName(b[0])))
    .map(([id, n]) => (n > 1 ? `${itemName(id)} ×${n}` : itemName(id)))
    .join(' · ')
}

/** Whether the name is still one we made (so it may be updated), not one the player typed. */
export function isAutoName(plan: Described & { name: string }) {
  return DEFAULT.test(plan.name) || plan.name === autoName(plan, plan.name) || / outpost$/.test(plan.name) || plan.name === 'New outpost'
}

/** The name after a change: re-made if it was automatic, kept if the player chose it. */
export function nameAfter(before: Described & { name: string }, after: Described) {
  if (!isAutoName(before)) return before.name
  return autoName(after, DEFAULT.test(before.name) ? before.name : 'New outpost')
}
