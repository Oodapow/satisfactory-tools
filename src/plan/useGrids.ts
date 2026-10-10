import { useMemo } from 'react'
import { readStored, usePersistentState } from '../storage/persisted'
import { migratePowerLines, type GridStore } from './grids'

const KEY = 'power-grids'

/**
 * Before grids, the factory map kept one-way power lines in its own layout. Until grids are
 * first saved, those are read as grid lines; the first edit stores them under their own key.
 */
function legacy(): GridStore {
  const layout = readStored<{ powerLines?: { id: string; from: string; to: string }[] } | null>('node-editor', null)
  return migratePowerLines(layout?.powerLines)
}

function normalize(s: GridStore | null): GridStore {
  if (!s) return legacy()
  return { links: Array.isArray(s.links) ? s.links : [], names: s.names && typeof s.names === 'object' ? s.names : {} }
}

/** Power lines between outposts and grid names, stored next to the outpost plans. */
export function useGridStore() {
  const [stored, setStored] = usePersistentState<GridStore | null>(KEY, null)
  const store = useMemo(() => normalize(stored), [stored])
  const update = (fn: (s: GridStore) => GridStore) => setStored((prev) => fn(normalize(prev)))
  return { store, update }
}
