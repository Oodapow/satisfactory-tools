import { allowAndSync, useSyncStatus } from './sync'

/** Header status of a linked save: reading, waiting for the browser's permission, or failed. */
export function SyncChip() {
  const sync = useSyncStatus()
  if (sync.kind === 'reading') {
    return <span className="chip">Reading {sync.fileName}… {Math.round(sync.progress * 100)}%</span>
  }
  if (sync.kind === 'needs-permission') {
    // Browsers forget file access between visits; one click (a user gesture) gets it back.
    return (
      <button type="button" className="chip chip-action" onClick={() => allowAndSync()} title={`Re-read your saves in ${sync.name}`}>
        ⟳ Update from save
      </button>
    )
  }
  if (sync.kind === 'failed') {
    return (
      <a className="chip chip-warn" href="#/upload" title={sync.message}>
        Save sync failed
      </a>
    )
  }
  return null
}
