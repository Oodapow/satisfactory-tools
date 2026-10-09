// Icons from the game data (public/icons/, listed in src/data/game/icons.json).
import { buildingsById, itemsById } from './game'
import { iconUrl as gameIconUrl, powerIconUrl } from './game/icons'

export { powerIconUrl }

/** Pseudo id for electricity, which is not an item in the game data. */
export const POWER = 'power'

/** Icon URL for an item, building or POWER, or undefined when we have none. */
export function iconUrl(id: string) {
  return id === POWER ? powerIconUrl : gameIconUrl(id)
}

/** Display name for an item, building or POWER. */
export function displayName(id: string) {
  if (id === POWER) return 'Power'
  return itemsById.get(id)?.name ?? buildingsById.get(id)?.name ?? id.replace(/^(Desc_|Build_)|_C$/g, '')
}
