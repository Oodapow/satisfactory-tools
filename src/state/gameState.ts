import { availability, purchasable, type GameState as Unlocks } from '../data/availability'
import { buildings, items, progression, recipes, schematicsById, type Recipe, type Schematic } from '../data'
import { usePersistentState } from '../storage/persisted'

/** What the player has unlocked so far (the input to planning mode), plus how to show it. */
export type GameState = Unlocks & {
  source: 'manual' | 'save'
  /** File name of the uploaded save, when source is 'save'. */
  saveName?: string
  /** How locked content shows up: not at all, or blurred out. */
  spoilers: 'hide' | 'blur'
}

export function useGameState() {
  return usePersistentState<GameState | null>('gameState', null)
}

export function emptyGameState(source: GameState['source'] = 'manual'): GameState {
  return { source, purchased: [], spaceElevatorPhase: 0, spoilers: 'hide' }
}

export const milestonesOfTier = (tier: number) => progression.tiers.find((t) => t.tier === tier)?.milestones ?? []

/** Space Elevator phase a tier needs before its milestones can be bought. */
export function phaseForTier(tier: number) {
  const gate = progression.tiers.find((t) => t.tier === tier)?.gate
  return gate?.requires === 'phase' ? gate.phase : 0
}

/** Mark every milestone up to and including `tier` as done, keeping research and alternates. */
export function throughTier(state: GameState, tier: number): GameState {
  const milestones = new Set(progression.tiers.flatMap((t) => t.milestones))
  const others = state.purchased.filter((id) => !milestones.has(id))
  const done = progression.tiers.filter((t) => t.tier <= tier).flatMap((t) => t.milestones)
  return { ...state, purchased: [...others, ...done], spaceElevatorPhase: Math.max(state.spaceElevatorPhase, phaseForTier(tier)) }
}

/** Highest tier with at least one finished milestone, or -1. */
export function currentTier(state: GameState) {
  const done = new Set(state.purchased)
  return progression.tiers.reduce((t, x) => (x.milestones.some((m) => done.has(m)) ? Math.max(t, x.tier) : t), -1)
}

/** Tiers whose gate is open, i.e. what the HUB would show. */
export function openTiers(state: GameState) {
  const tutorialDone = milestonesOfTier(0).every((m) => state.purchased.includes(m))
  return progression.tiers
    .filter((t) => {
      const g = t.gate
      if (!g || g.requires === 'start') return true
      if (g.requires === 'tutorial') return tutorialDone
      return state.spaceElevatorPhase >= g.phase
    })
    .map((t) => t.tier)
}

/** Owned and next-to-buy schematics of a type: the spoiler-safe list to pick from. */
export function knownSchematics(state: GameState, type: Schematic['type']) {
  const next = purchasable(state).filter((s) => s.type === type)
  const owned = state.purchased.map((id) => schematicsById.get(id)).filter((s) => s?.type === type) as Schematic[]
  return [...owned, ...next].sort((a, b) => a.name.localeCompare(b.name))
}

export { availability, purchasable }

/** The unlocked part of the catalog, split into what planning mode lists. */
export function catalog(state: GameState) {
  const a = availability(state)
  const isProduction = (r: Recipe) => r.kind === 'production' && r.producedIn.length > 0
  return {
    available: a,
    recipes: recipes
      .filter((r) => isProduction(r) && a.recipes.has(r.id))
      .sort((x, y) => x.name.replace('Alternate: ', '').localeCompare(y.name.replace('Alternate: ', ''))),
    lockedRecipes: recipes.filter((r) => isProduction(r) && !a.recipes.has(r.id)).length,
    items: items.filter((i) => a.items.has(i.id)).sort((x, y) => x.name.localeCompare(y.name)),
    lockedItems: items.filter((i) => !a.items.has(i.id)).length,
    buildings: buildings.filter((b) => a.buildings.has(b.id)),
    lockedBuildings: buildings.filter((b) => !a.buildings.has(b.id)).length,
  }
}
