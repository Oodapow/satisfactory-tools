import { buildingsById, itemsById } from '../data'

// Game icons come from src/data/game/icons.ts (owned by the game data work). It is
// picked up when present, so this module works before and after icons land. When an
// icon is missing we draw a coloured badge with the name's initials instead.
type IconsModule = { iconUrl: (id: string) => string | undefined; powerIconUrl: string }
const icons = Object.values(import.meta.glob<IconsModule>('../data/game/icons.ts', { eager: true }))[0]

/** Pseudo id for electricity, which is not an item in the game data. */
export const POWER = 'power'

export function iconUrl(id: string) {
  if (!icons) return undefined
  return id === POWER ? icons.powerIconUrl : icons.iconUrl(id)
}

export function displayName(id: string) {
  if (id === POWER) return 'Power'
  return itemsById.get(id)?.name ?? buildingsById.get(id)?.name ?? id.replace(/^(Desc_|Build_)|_C$/g, '')
}
