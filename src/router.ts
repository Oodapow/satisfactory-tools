import { useSyncExternalStore } from 'react'

// Hash routing, because GitHub Pages cannot serve SPA fallback routes.
const subscribe = (fn: () => void) => {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}

/** Current route as path segments, e.g. "#/outposts/abc" -> ["outposts", "abc"]. */
export function useRoute() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean)
}

export function go(path: string) {
  window.location.hash = path
}

/** Where an icon click goes: the catalog, searched for that item or building. */
export function catalogHref(kind: 'items' | 'buildings', name: string) {
  return `#/catalog/${kind}/${encodeURIComponent(name)}`
}
