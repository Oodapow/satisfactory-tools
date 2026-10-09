import { usePersistentState } from '../storage/persisted'

export type Outpost = {
  id: string
  name: string
  notes: string
  /** What this outpost should produce. Optional so outposts saved before planning still load. */
  target?: { item: string; perMin: number }
  /** Recipe picked per item when more than one is available (e.g. an alternate). */
  choices?: Record<string, string>
  createdAt: string
  updatedAt: string
}

export type OutpostPatch = Partial<Pick<Outpost, 'name' | 'notes' | 'target' | 'choices'>>

const EMPTY: Outpost[] = []

export function useOutposts() {
  const [outposts, setOutposts] = usePersistentState<Outpost[]>('outposts', EMPTY)

  const now = () => new Date().toISOString()

  return {
    outposts,
    /** Returns the new outpost's id. */
    add(name: string, from?: Partial<Outpost>) {
      const o: Outpost = {
        id: crypto.randomUUID(),
        name,
        notes: from?.notes ?? '',
        target: from?.target,
        choices: from?.choices,
        createdAt: now(),
        updatedAt: now(),
      }
      setOutposts((prev) => [...prev, o])
      return o.id
    },
    update(id: string, patch: OutpostPatch) {
      setOutposts((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch, updatedAt: now() } : o)))
    },
    remove(id: string) {
      setOutposts((prev) => prev.filter((o) => o.id !== id))
    },
  }
}
