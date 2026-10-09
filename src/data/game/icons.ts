// Icon URLs for items and buildings. Files live in public/icons/, listed in icons.json
// by scripts/fetch-icons.mjs; see data/README.md for sources.
import iconsJson from './icons.json'

const icons = iconsJson as Record<string, { file: string; source: string }>
const base = `${import.meta.env.BASE_URL}icons/`

/** URL of the icon for an item or building id, or undefined when we have none yet. */
export function iconUrl(id: string): string | undefined {
  const entry = icons[id]
  return entry && base + entry.file
}

/** Icon for electricity (MW), which is not an item in the game data. */
export const powerIconUrl = `${base}power.svg`
