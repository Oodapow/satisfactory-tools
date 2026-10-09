import { buildingsById, itemsById } from './index'

// Icons come from the game data once it carries them (an `icon` path per item
// and building, relative to the site root). Until then callers fall back to a
// lettered badge.
type WithIcon = { icon?: string | null }

export function iconUrl(id: string): string | null {
  const icon = ((itemsById.get(id) ?? buildingsById.get(id)) as WithIcon | undefined)?.icon
  return icon ? import.meta.env.BASE_URL + icon.replace(/^\//, '') : null
}
