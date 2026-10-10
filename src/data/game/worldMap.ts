// The default map's nodes and image bounds. Kept out of index.ts so only the world map screen loads it.
import worldMapJson from './world-map.json'
import type { WorldMap } from './types'

export const worldMap = worldMapJson as WorldMap

// The in-game map picture, cut by scripts/fetch-map.mjs (keep these in step with it).
const base = `${import.meta.env.BASE_URL}map/`
/** Whole map, small: for zoomed-out views. */
export const worldMapOverview = { url: `${base}overview.webp`, size: 2048 }
/** Full-resolution source cut into TILES × TILES tiles, row 0 at the north. */
export const worldMapTiles = { count: 4, sourceSize: 5000, url: (row: number, col: number) => `${base}tiles/${row}-${col}.webp` }
