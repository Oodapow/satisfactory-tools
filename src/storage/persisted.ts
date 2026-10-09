import { useCallback, useSyncExternalStore } from 'react'

// All app state lives in localStorage under this prefix, one JSON entry per key.
// Each entry is wrapped with a schema version so stored data can be migrated later.
const PREFIX = 'sft:'
const SCHEMA_VERSION = 1

type Envelope<T> = { v: number; data: T }

const listeners = new Map<string, Set<() => void>>()
// Cache parsed values so useSyncExternalStore gets a stable reference between renders.
const cache = new Map<string, { raw: string | null; value: unknown }>()

function storageKey(key: string) {
  return PREFIX + key
}

function read<T>(key: string, fallback: T): T {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(storageKey(key))
  } catch {
    // Storage blocked (private mode, disabled cookies): behave as empty.
  }
  const hit = cache.get(key)
  if (hit && hit.raw === raw) return (hit.value ?? fallback) as T

  let value: T | undefined
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Envelope<T>
      if (parsed && parsed.v === SCHEMA_VERSION) value = parsed.data
    } catch {
      // Corrupt entry: ignore and fall back.
    }
  }
  cache.set(key, { raw, value })
  return value ?? fallback
}

function write<T>(key: string, data: T) {
  const raw = JSON.stringify({ v: SCHEMA_VERSION, data } satisfies Envelope<T>)
  try {
    localStorage.setItem(storageKey(key), raw)
  } catch {
    // Quota exceeded or storage blocked: keep the in-memory value for this session.
  }
  cache.set(key, { raw, value: data })
  notify(key)
}

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn())
}

function subscribe(key: string, fn: () => void) {
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(fn)
  return () => set.delete(fn)
}

// Keep other open tabs in sync.
window.addEventListener('storage', (e) => {
  if (e.key === null) listeners.forEach((_, k) => notify(k))
  else if (e.key.startsWith(PREFIX)) notify(e.key.slice(PREFIX.length))
})

/** Like useState, but the value survives reloads and is shared across tabs. */
export function usePersistentState<T>(key: string, initial: T) {
  const value = useSyncExternalStore(
    (fn) => subscribe(key, fn),
    () => read(key, initial),
  )
  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = read(key, initial)
      write(key, typeof next === 'function' ? (next as (p: T) => T)(prev) : next)
    },
    // `initial` is only a fallback; changing it should not recreate the setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return [value, setValue] as const
}

/** Every stored entry, for backups. */
export function exportAll(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k?.startsWith(PREFIX)) continue
    const raw = localStorage.getItem(k)!
    try {
      out[k.slice(PREFIX.length)] = JSON.parse(raw)
    } catch {
      // Keep a corrupt entry as text so a backup never fails and nothing is lost.
      out[k.slice(PREFIX.length)] = raw
    }
  }
  return { app: 'satisfactory-tools', exportedAt: new Date().toISOString(), entries: out }
}

/** Save exportAll() as a JSON file. */
export function downloadBackup() {
  const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `satisfactory-tools-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Delete every stored entry. */
export function resetAll() {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(PREFIX)) keys.push(k)
  }
  for (const k of keys) localStorage.removeItem(k)
  cache.clear()
  listeners.forEach((_, k) => notify(k))
}

/**
 * Restore entries from a backup produced by exportAll. Entries in the backup
 * overwrite same-named ones here; anything not in the backup is left untouched.
 */
export function importAll(backup: unknown) {
  const b = backup as { app?: string; entries?: Record<string, unknown> }
  if (b?.app !== 'satisfactory-tools' || typeof b.entries !== 'object' || b.entries === null) {
    throw new Error('Not a Satisfactory Tools backup file')
  }
  const entries = Object.entries(b.entries)
  for (const [key, env] of entries) {
    const e = env as Envelope<unknown> | null
    if (typeof e !== 'object' || e === null || typeof e.v !== 'number' || !('data' in e)) {
      throw new Error(`Backup entry "${key}" is malformed`)
    }
  }
  for (const [key, env] of entries) {
    localStorage.setItem(storageKey(key), JSON.stringify(env))
    cache.delete(key)
    notify(key)
  }
}
