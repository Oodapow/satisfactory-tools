// The default map's nodes and image bounds. Kept out of index.ts so only the world map screen loads it.
import worldMapJson from './world-map.json'
import type { WorldMap } from './types'

export const worldMap = worldMapJson as WorldMap

// The in-game map picture, cut by scripts/fetch-map.mjs (keep these in step with it).
const base = `${import.meta.env.BASE_URL}map/`
/** Whole map, small: shown at once, under the tiles. */
export const worldMapBase = { url: `${base}base.webp`, size: 512 }
/**
 * The map at each zoom level (`sizes` in px, coarsest first, the last at the source's resolution),
 * cut into `tile` px squares that reach `overlap` px into their neighbours. Row 0 is at the north.
 */
export const worldMapTiles = {
  tile: 512,
  overlap: 2,
  sizes: [625, 1250, 2500, 5000],
  url: (level: number, row: number, col: number) => `${base}${level}/${row}-${col}.webp`,
}
