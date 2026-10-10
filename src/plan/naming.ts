// Outpost names that describe the outpost: what it delivers, or else what it mines.
// A name stays automatic, and follows the outpost as it changes, until someone types their own.
import { itemName, resourcesById } from '../data'
import { fmt } from '../format'
import type { OutpostPlan } from './types'

type Described = Pick<OutpostPlan, 'goals' | 'nodes'>

const DEFAULT = /^Outpost \d+$/

/**
 * "Reinforced Iron Plate × 20" from its goals, otherwise "Iron Ore ×2 · Copper Ore" from its
 * nodes, most first. Raw resources among the goals only name it when they are all it delivers.
 * `fallback` when it has neither.
 */
export function autoName(plan: Described, fallback = 'New outpost') {
  return describe(plan, fallback, (item, perMin) => `${itemName(item)} × ${fmt(perMin)}`)
}

function describe(plan: Described, fallback: string, label: (item: string, perMin: number) => string) {
  const made = plan.goals.filter((g) => g.kind !== 'item' || !resourcesById.has(g.item))
  const goals = (made.length ? made : plan.goals).map((g) => (g.kind === 'item' ? label(g.item, g.perMin) : `${fmt(g.mw, 1)} MW`))
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
  // Names from before the "Item × rate" format, like "Iron Plate 60/min", count as ours too.
  const legacy = describe(plan, plan.name, (item, perMin) => `${itemName(item)} ${fmt(perMin)}/min`)
  return DEFAULT.test(plan.name) || plan.name === autoName(plan, plan.name) || plan.name === legacy || / outpost$/.test(plan.name) || plan.name === 'New outpost'
}

/** The name after a change: re-made if it was automatic, kept if the player chose it. */
export function nameAfter(before: Described & { name: string }, after: Described) {
  if (!isAutoName(before)) return before.name
  return autoName(after, DEFAULT.test(before.name) ? before.name : 'New outpost')
}
