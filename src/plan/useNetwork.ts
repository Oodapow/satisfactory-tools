import { useMemo } from 'react'
import { availability } from '../data/game/availability'
import type { GameState } from '../state/gameState'
import { powerGrids, removeOutposts } from './grids'
import { solvePlan } from './network'
import { useOutposts } from './store'
import { useGridStore } from './useGrids'

/** Every outpost solved against the current game state, what's unlocked, and the power grids they form. */
export function useNetwork(state: GameState) {
  const store = useOutposts()
  const gridStore = useGridStore()
  const available = useMemo(() => availability(state), [state])
  const solved = useMemo(() => store.outposts.map((p) => solvePlan(p, available)), [store.outposts, available])
  const grids = useMemo(() => powerGrids(solved, gridStore.store), [solved, gridStore.store])
  return {
    ...store,
    remove(id: string) {
      store.remove(id)
      gridStore.update((s) => removeOutposts(s, [id]))
    },
    available,
    solved,
    grids,
    gridStore: gridStore.store,
    updateGrids: gridStore.update,
  }
}
