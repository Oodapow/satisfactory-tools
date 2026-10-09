// A save file or folder the player linked, so the app can read it again on every visit.
// Browsers can't remember a file path, but Chromium-based ones can keep a file handle
// (File System Access API) in IndexedDB and re-open it, after asking once per session.

type Permission = 'granted' | 'denied' | 'prompt'
type Handle = FileSystemFileHandle | FileSystemDirectoryHandle
type PermissionHandle = Handle & {
  queryPermission(opts: { mode: 'read' }): Promise<Permission>
  requestPermission(opts: { mode: 'read' }): Promise<Permission>
}
type Pickers = {
  showOpenFilePicker(opts: object): Promise<FileSystemFileHandle[]>
  showDirectoryPicker(opts: object): Promise<FileSystemDirectoryHandle>
}

export interface LinkedSave {
  handle: Handle
  /** Session the player linked; in a folder, saves from other sessions are skipped. */
  session?: string
}

/** Whether this browser can keep a save linked (Chrome, Edge and other Chromium browsers on desktop). */
export const canLink = typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'indexedDB' in window

const pickers = () => window as unknown as Pickers
const PICKER_ID = 'satisfactory-save'

export async function pickSaveFile(): Promise<Handle> {
  const [handle] = await pickers().showOpenFilePicker({
    id: PICKER_ID,
    types: [{ description: 'Satisfactory save', accept: { 'application/octet-stream': ['.sav'] } }],
  })
  return handle
}

export const pickSaveFolder = (): Promise<Handle> => pickers().showDirectoryPicker({ id: PICKER_ID, mode: 'read' })

/** A handle for something dropped on the page, when the browser offers one. */
export async function handleFromDrop(data: DataTransfer): Promise<Handle | null> {
  const item = data.items[0] as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }) | undefined
  if (!canLink || !item?.getAsFileSystemHandle) return null
  return ((await item.getAsFileSystemHandle().catch(() => null)) as Handle | null) ?? null
}

/** Current read permission; with `ask`, prompts the player (needs a click). */
export async function permission(handle: Handle, ask: boolean): Promise<Permission> {
  const h = handle as PermissionHandle
  const now = await h.queryPermission({ mode: 'read' })
  return now === 'prompt' && ask ? h.requestPermission({ mode: 'read' }) : now
}

/** The linked file, or the folder's .sav files (and one level of subfolders), newest first. */
export async function savesIn(handle: Handle, depth = 1): Promise<File[]> {
  if (handle.kind === 'file') return [await handle.getFile()]
  const files: File[] = []
  for await (const entry of (handle as FileSystemDirectoryHandle & { values(): AsyncIterable<Handle> }).values()) {
    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.sav')) files.push(await entry.getFile())
    else if (entry.kind === 'directory' && depth > 0) files.push(...(await savesIn(entry, depth - 1)))
  }
  return files.sort((a, b) => b.lastModified - a.lastModified)
}

// IndexedDB, because localStorage can only hold strings and a handle must be stored as itself.
const DB = 'satisfactory-tools'
const STORE = 'handles'
const KEY = 'linked-save'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db()
  return new Promise<T>((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  }).finally(() => d.close())
}

export const loadLinked = () => (canLink ? tx<LinkedSave | undefined>('readonly', (s) => s.get(KEY)) : Promise.resolve(undefined))
export const storeLinked = (link: LinkedSave) => tx('readwrite', (s) => s.put(link, KEY))
export const forgetLinked = () => tx('readwrite', (s) => s.delete(KEY))
