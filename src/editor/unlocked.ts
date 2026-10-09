// Spoiler-safe lists for the editor's palettes and pickers: only what the game state has unlocked.
import { createContext, useContext, useMemo } from 'react'
import { items, recipes, resources, type Building } from '../data'
import type { Availability } from '../data/game/availability'
import { bestBeltTier, bestPipeTier, transportUnlocked } from '../plan/unlocked'
import { transports } from './model'
import { generatorBuildings, machineBuildings, recipesIn } from './store'

/** The current game state's unlocks, provided by the editor screen. */
export const UnlockedContext = createContext<Availability | null>(null)

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)
const inProduction = new Set(recipes.filter((r) => r.kind === 'production').flatMap((r) => [...r.products, ...r.ingredients].map((a) => a.item)))
const pickableItems = items.filter((i) => inProduction.has(i.id) || resources.some((r) => r.id === i.id)).sort(byName)

export function useUnlocked() {
  const a = useContext(UnlockedContext)
  return useMemo(() => {
    // Without a game state (shouldn't happen inside the editor) nothing is hidden.
    const has = (set: keyof Pick<Availability, 'buildings' | 'recipes' | 'items'>, id: string) => !a || a[set].has(id)
    return {
      machines: machineBuildings.filter((b) => has('buildings', b.id)),
      generators: generatorBuildings.filter((b) => has('buildings', b.id)),
      recipesIn: (building: string) => recipesIn(building).filter((r) => has('recipes', r.id)),
      fuelsOf: (b: Building | undefined) => (b?.generator?.fuels ?? []).filter((f) => has('items', f.fuel)),
      items: pickableItems.filter((i) => has('items', i.id)),
      transports: transports.filter((t) => !a || transportUnlocked(t.id, a)),
      beltTier: a ? bestBeltTier(a) : 6,
      pipeTier: a ? bestPipeTier(a) : 2,
      poleTier: a ? Math.max(1, ...[1, 2, 3].filter((mk) => a.buildings.has(`Desc_PowerPoleMk${mk}_C`))) : 3,
    }
  }, [a])
}
