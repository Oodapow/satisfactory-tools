// Copy of src/data/game/availability.ts from the game data PR, reading the mock
// data through ./index. Delete once that PR lands and import from './game'.
import { progression, recipesById, schematics, schematicsById } from './index'
import type { BuildingId, ItemId, RecipeId, Schematic, SchematicId } from './types'

export interface GameState {
  /** Schematics the player has bought or researched (milestones, MAM, alternates, shop). */
  purchased: SchematicId[]
  /** Space Elevator phases completed (0-5). */
  spaceElevatorPhase: number
}

export interface Availability {
  /** Purchased schematics plus everything they grant, plus the starting ones. */
  schematics: Set<SchematicId>
  recipes: Set<RecipeId>
  buildings: Set<BuildingId>
  /** Items appearing in any available recipe, plus scannable resources. */
  items: Set<ItemId>
  scannerResources: Set<ItemId>
}

/** Everything unlocked for this game state. */
export function availability(state: GameState): Availability {
  const owned = new Set<SchematicId>()
  const queue = [...progression.startingSchematics, ...state.purchased]
  while (queue.length) {
    const id = queue.pop() as SchematicId
    const s = schematicsById.get(id)
    if (!s || owned.has(id)) continue
    owned.add(id)
    queue.push(...s.unlocks.schematics)
  }

  const result: Availability = {
    schematics: owned,
    recipes: new Set(),
    buildings: new Set(),
    items: new Set(),
    scannerResources: new Set(),
  }
  for (const id of owned) {
    const s = schematicsById.get(id) as Schematic
    for (const r of s.unlocks.recipes) result.recipes.add(r)
    for (const r of s.unlocks.scannerResources) {
      result.scannerResources.add(r)
      result.items.add(r)
    }
  }
  for (const id of result.recipes) {
    const r = recipesById.get(id)
    if (!r) continue
    if (r.building) result.buildings.add(r.building)
    for (const x of [...r.ingredients, ...r.products]) result.items.add(x.item)
  }
  return result
}

/**
 * Schematics the player could buy next. MAM research trees are an approximation:
 * the game's data file does not say which node in a tree comes before which.
 */
export function purchasable(state: GameState, unlocked = availability(state)): Schematic[] {
  const has = (id: SchematicId) => unlocked.schematics.has(id)
  const tutorialDone = schematics.filter((s) => s.type === 'tutorial').every((s) => has(s.id))

  const tierOpen = (tier: number) => {
    const gate = progression.tiers.find((t) => t.tier === tier)?.gate
    if (!gate || gate.requires === 'start') return true
    if (gate.requires === 'tutorial') return tutorialDone
    return state.spaceElevatorPhase >= gate.phase
  }
  const accessOpen = (type: string) => {
    const access = progression.access[type]
    if (!access) return true
    if (access.building && !unlocked.buildings.has(access.building)) return false
    if (access.schematic && !has(access.schematic)) return false
    return true
  }

  return schematics.filter((s) => {
    if (has(s.id) || s.discontinued) return false
    if (s.dependencies) {
      const { schematics: deps, requireAll, gamePhase } = s.dependencies
      if (gamePhase) return false
      if (deps.length && !(requireAll ? deps.every(has) : deps.some(has))) return false
    }
    switch (s.type) {
      case 'tutorial':
        return true
      case 'milestone':
        return tierOpen(s.tier)
      case 'mam':
      case 'hard-drive':
        return accessOpen('mam')
      case 'alternate':
        return accessOpen('mam') && accessOpen('alternate')
      case 'awesome-shop':
        return accessOpen('awesome-shop')
      default:
        // Custom and customization schematics are granted by others, never bought.
        return false
    }
  })
}
