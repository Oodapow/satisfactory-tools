// Keeps the game state in step with a linked save: re-reads it on every visit and whenever
// the player asks, but only parses when the file changed.
import { useSyncExternalStore } from 'react'
import { readStored, writeStored } from '../storage/persisted'
import type { GameState } from '../state/gameState'
import { forgetLinked, loadLinked, permission, savesIn, storeLinked, type LinkedSave } from './linked'
import { gameStateFromSave, parseSave, type SaveImport, type SaveSummary } from './parseSave'

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'needs-permission'; name: string }
  | { kind: 'reading'; name: string; fileName: string; progress: number }
  | { kind: 'synced'; name: string; fileName: string; modified: number; skipped: number }
  | { kind: 'failed'; name: string; message: string }

let status: SyncStatus = { kind: 'off' }
let link: LinkedSave | undefined
const listeners = new Set<() => void>()
const set = (next: SyncStatus) => {
  status = next
  listeners.forEach((fn) => fn())
}

export const useSyncStatus = () =>
  useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => status,
  )

/** At most this many recent saves are opened looking for the linked session. */
const MAX_TRIES = 4

export type SyncResult = SaveImport & { summary: SaveSummary }

async function sync(): Promise<SyncResult | null> {
  if (!link) return null
  const name = link.handle.name
  try {
    const files = (await savesIn(link.handle)).slice(0, MAX_TRIES)
    if (!files.length) throw new Error(`No .sav files in ${name}.`)
    const prev = readStored<GameState | null>('gameState', null)
    for (const file of files) {
      // Same file, unchanged since last time: nothing to do.
      if (prev?.source === 'save' && prev.saveName === file.name && prev.saveModified === file.lastModified) {
        set({ kind: 'synced', name, fileName: file.name, modified: file.lastModified, skipped: 0 })
        return null
      }
      set({ kind: 'reading', name, fileName: file.name, progress: 0 })
      const summary = await parseSave(file, (progress) => set({ kind: 'reading', name, fileName: file.name, progress }))
      if (link.session && summary.sessionName !== link.session) continue
      const result = gameStateFromSave(summary, file.name)
      const state: GameState = { ...result.state, spoilers: prev?.spoilers ?? 'hide', saveModified: file.lastModified }
      writeStored('gameState', state)
      if (!link.session) await storeLinked((link = { ...link, session: summary.sessionName }))
      set({ kind: 'synced', name, fileName: file.name, modified: file.lastModified, skipped: result.unknown.length })
      return { ...result, state, summary }
    }
    throw new Error(`None of the latest saves in ${name} belong to "${link.session}".`)
  } catch (err) {
    set({ kind: 'failed', name, message: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/** Called once at startup: re-read the linked save if the browser still allows it. */
export async function startSync() {
  link = await loadLinked().catch(() => undefined)
  if (!link) return
  const p = await permission(link.handle, false).catch(() => 'denied' as const)
  if (p === 'granted') await sync().catch(() => {})
  else set({ kind: 'needs-permission', name: link.handle.name })
}

/** After a click: ask for access again (browsers forget it between sessions) and read. */
export async function allowAndSync() {
  if (!link) return
  if ((await permission(link.handle, true)) !== 'granted') {
    set({ kind: 'needs-permission', name: link.handle.name })
    return
  }
  await sync().catch(() => {})
}

/** Link a newly picked or dropped save file or folder, read it, and return what was read. */
export async function linkSave(handle: LinkedSave['handle']): Promise<SyncResult | null> {
  if ((await permission(handle, true)) !== 'granted') throw new Error('The browser did not allow reading it.')
  link = { handle }
  await storeLinked(link)
  // A new link always re-reads, even if the newest file is the one already loaded.
  const prev = readStored<GameState | null>('gameState', null)
  if (prev) writeStored('gameState', { ...prev, saveModified: undefined })
  return sync()
}

export async function unlinkSave() {
  link = undefined
  await forgetLinked().catch(() => {})
  set({ kind: 'off' })
}
