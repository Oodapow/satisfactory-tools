// Decides whether a re-read save should replace the game state that is loaded now.
import type { GameState } from '../state/gameState'

export type Freshness = 'unchanged' | 'older' | 'newer'

/**
 * How a save file compares with the loaded state. A file older than the loaded save (say a
 * linked autosave after a newer save was uploaded by hand) must not replace it, or the
 * newest milestones are lost.
 */
export function freshness(loaded: GameState | null, file: { name: string; lastModified: number }): Freshness {
  if (loaded?.source !== 'save' || loaded.saveModified === undefined) return 'newer'
  if (loaded.saveName === file.name && loaded.saveModified === file.lastModified) return 'unchanged'
  return file.lastModified < loaded.saveModified ? 'older' : 'newer'
}
