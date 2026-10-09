// Main-thread side of save reading: runs the worker and turns its summary into a game state.
import { schematicsById } from '../data'
import { emptyGameState, type GameState } from '../state/gameState'
import type { SaveSummary } from './readSave'
import type { SaveWorkerRequest, SaveWorkerResponse } from './save.worker'

export type { SaveSummary }

/** Parses a .sav in a Web Worker. `onProgress` gets 0..1. */
export function parseSave(file: File, onProgress?: (progress: number) => void): Promise<SaveSummary> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./save.worker.ts', import.meta.url), { type: 'module' })
    const finish = () => worker.terminate()
    worker.onmessage = (e: MessageEvent<SaveWorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'progress') return onProgress?.(msg.progress)
      finish()
      if (msg.type === 'done') resolve(msg.summary)
      else reject(new Error(msg.message))
    }
    worker.onerror = (e) => (finish(), reject(new Error(e.message || 'The save reader stopped unexpectedly.')))
    file.arrayBuffer().then(
      (buffer) => worker.postMessage({ name: file.name, file: buffer } satisfies SaveWorkerRequest, [buffer]),
      (err) => (finish(), reject(err)),
    )
  })
}

export interface SaveImport {
  state: GameState
  /** Purchased schematics our data doesn't know, usually from mods. */
  unknown: string[]
}

/** Keep the schematics our game data knows; the rest (mods, removed content) is reported back. */
export function gameStateFromSave(summary: SaveSummary, fileName: string): SaveImport {
  const known = summary.purchased.filter((id) => schematicsById.has(id))
  return {
    state: {
      ...emptyGameState('save'),
      saveName: fileName,
      purchased: known,
      spaceElevatorPhase: summary.spaceElevatorPhase,
    },
    unknown: summary.purchased.filter((id) => !schematicsById.has(id)),
  }
}
