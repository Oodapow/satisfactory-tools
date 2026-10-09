// The default map's nodes and image bounds. Kept out of index.ts so only the world map screen loads it.
import worldMapJson from './world-map.json'
import type { WorldMap } from './types'

export const worldMap = worldMapJson as WorldMap

/** The in-game map picture, made by scripts/fetch-map.mjs. */
export const worldMapImage = `${import.meta.env.BASE_URL}map/world.webp`
