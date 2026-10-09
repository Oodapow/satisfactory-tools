import { useMemo } from 'react'
import { usePersistentState } from '../storage/persisted'
import type { OutpostPlan } from './types'

// Outposts saved before plans existed had a single target and recipe choices.
type Legacy = Partial<OutpostPlan> & {
  id: string
  name: string
  target?: { item: string; perMin: number }
  choices?: Record<string, string>
}

function normalize(o: Legacy): OutpostPlan {
  const now = new Date().toISOString()
  return {
    id: o.id,
    name: o.name,
    notes: o.notes ?? '',
    goals: o.goals ?? (o.target ? [{ kind: 'item', ...o.target }] : []),
    nodes: o.nodes ?? [],
    imports: o.imports ?? [],
    recipeChoices: o.recipeChoices ?? o.choices ?? {},
    selfPowered: o.selfPowered ?? false,
    maxClock: o.maxClock,
    somersloops: o.somersloops,
    location: o.location,
    createdAt: o.createdAt ?? now,
    updatedAt: o.updatedAt ?? now,
  }
}

const EMPTY: Legacy[] = []

export type PlanPatch = Partial<Omit<OutpostPlan, 'id' | 'createdAt' | 'updatedAt'>>

export const newId = () => crypto.randomUUID()

export function blankPlan(name: string, from?: PlanPatch): OutpostPlan {
  const now = new Date().toISOString()
  return normalize({ id: newId(), name, ...from, createdAt: now, updatedAt: now })
}

export function useOutposts() {
  const [raw, setRaw] = usePersistentState<Legacy[]>('outposts', EMPTY)
  const outposts = useMemo(() => raw.map(normalize), [raw])
  const now = () => new Date().toISOString()

  return {
    outposts,
    save(plan: OutpostPlan) {
      setRaw((prev) => {
        const exists = prev.some((o) => o.id === plan.id)
        const next = { ...plan, updatedAt: now() }
        return exists ? prev.map((o) => (o.id === plan.id ? next : o)) : [...prev, next]
      })
    },
    update(id: string, patch: PlanPatch) {
      setRaw((prev) => prev.map((o) => (o.id === id ? { ...normalize(o), ...patch, updatedAt: now() } : o)))
    },
    remove(id: string) {
      // Drop the outpost and any imports other outposts take from it.
      setRaw((prev) =>
        prev
          .filter((o) => o.id !== id)
          .map((o) => ({ ...o, imports: (o.imports ?? []).filter((i) => i.from !== id) })),
      )
    },
  }
}
