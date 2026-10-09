import { useMemo } from 'react'
import { availability } from '../data/game/availability'
import type { GameState } from '../state/gameState'
import { solvePlan } from './network'
import { useOutposts } from './store'

/** Every outpost solved against the current game state, plus what's unlocked. */
export function useNetwork(state: GameState) {
  const store = useOutposts()
  const available = useMemo(() => availability(state), [state])
  const solved = useMemo(() => store.outposts.map((p) => solvePlan(p, available)), [store.outposts, available])
  return { ...store, available, solved }
}
