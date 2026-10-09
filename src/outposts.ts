import { usePersistentState } from './storage/persisted'

export type Outpost = {
  id: string
  name: string
  notes: string
  createdAt: string
  updatedAt: string
}

const EMPTY: Outpost[] = []

export function useOutposts() {
  const [outposts, setOutposts] = usePersistentState<Outpost[]>('outposts', EMPTY)

  const now = () => new Date().toISOString()

  return {
    outposts,
    add(name: string, from?: Outpost) {
      const o: Outpost = {
        id: crypto.randomUUID(),
        name,
        notes: from?.notes ?? '',
        createdAt: now(),
        updatedAt: now(),
      }
      setOutposts((prev) => [...prev, o])
    },
    update(id: string, patch: Partial<Pick<Outpost, 'name' | 'notes'>>) {
      setOutposts((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch, updatedAt: now() } : o)))
    },
    remove(id: string) {
      setOutposts((prev) => prev.filter((o) => o.id !== id))
    },
  }
}
