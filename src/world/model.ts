// What the world map shows for a game state: which nodes sit in explored ground, and
// whether the player knows what they hold yet (no spoilers).
import { availability, type Availability, type GameState } from '../data/game/availability'
import type { Purity, WorldMap, WorldNode } from '../data/game/types'
import { FOG_SIZE, type Point, type SaveMap } from '../save/readMap'

/** Fog values (0-255, the game writes up to ~170) between these fade from hidden to clear. */
export const FOG_HIDDEN = 8
export const FOG_CLEAR = 90
/** A marker shows once its spot is at least this explored. */
export const FOG_REVEALED = 40

export const PURITIES: Purity[] = ['impure', 'normal', 'pure']

/** Fraction across the map, 0..1 from the west and from the north. */
export function toUnit(map: WorldMap, [x, y]: Point): Point {
  const b = map.bounds
  return [(x - b.west) / (b.east - b.west), (y - b.north) / (b.south - b.north)]
}

/** World position (cm) of a fraction across the map; the inverse of toUnit. */
export function toWorld(map: WorldMap, [u, v]: Point): Point {
  const b = map.bounds
  return [b.west + u * (b.east - b.west), b.north + v * (b.south - b.north)]
}

export function decodeFog(fog: string): Uint8Array {
  const binary = atob(fog)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** How explored a world position is (0-255); 0 outside the map. */
export function fogAt(map: WorldMap, fog: Uint8Array, p: Point) {
  const [u, v] = toUnit(map, p)
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0
  return fog[Math.floor(v * FOG_SIZE) * FOG_SIZE + Math.floor(u * FOG_SIZE)]
}

/** Overlay opacity for a fog value: 1 is fully hidden. */
export function fogOpacity(value: number) {
  const t = Math.min(Math.max((value - FOG_HIDDEN) / (FOG_CLEAR - FOG_HIDDEN), 0), 1)
  return 1 - t * t * (3 - 2 * t)
}

/** Whether the player knows a resource: they can scan for it or use it in something unlocked. */
export function knowsResource(a: Availability, id: string) {
  if (id === 'Desc_Geyser_C') return a.buildings.has('Desc_GeneratorGeoThermal_C')
  return a.scannerResources.has(id) || a.items.has(id)
}

export interface Marker {
  node: WorldNode
  /** Null when the player hasn't unlocked this resource yet. */
  resource: string | null
  inUse: boolean
}

/**
 * Nodes to draw: those in explored ground (or all of them when `showAll`), with unknown
 * resources hidden behind a question mark.
 */
export function markers(map: WorldMap, state: GameState & { map?: SaveMap }, showAll: boolean): Marker[] {
  const a = availability(state)
  const fog = state.map && decodeFog(state.map.fog)
  const inUse = new Set(state.map?.occupied)
  return map.nodes
    .filter((n) => showAll || (fog && fogAt(map, fog, [n.x, n.y]) >= FOG_REVEALED))
    .map((node) => ({ node, resource: knowsResource(a, node.resource) ? node.resource : null, inUse: inUse.has(node.id) }))
}

/** Bounding box (unit coordinates) of the explored area, or null when nothing is explored. */
export function exploredBox(fog: Uint8Array): { left: number; top: number; right: number; bottom: number } | null {
  let left = FOG_SIZE, top = FOG_SIZE, right = -1, bottom = -1
  for (let y = 0; y < FOG_SIZE; y++)
    for (let x = 0; x < FOG_SIZE; x++)
      if (fog[y * FOG_SIZE + x] >= FOG_REVEALED) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
  if (right < 0) return null
  return { left: left / FOG_SIZE, top: top / FOG_SIZE, right: (right + 1) / FOG_SIZE, bottom: (bottom + 1) / FOG_SIZE }
}

/** Nodes within this distance of a newly placed outpost are given to it: 100 m, in cm. */
export const AUTO_RADIUS = 10_000

/** Only plain nodes of known resources can be given to an outpost: wells and geysers need buildings the planner doesn't place. */
export const pickable = (m: Marker) => m.node.kind === 'node' && m.resource !== null

/** Pickable markers within `radius` of a world position, nearest first. */
export function nearby(list: Marker[], [x, y]: Point, radius = AUTO_RADIUS): Marker[] {
  const dist = (m: Marker) => Math.hypot(m.node.x - x, m.node.y - y)
  return list.filter((m) => pickable(m) && dist(m) <= radius).sort((a, b) => dist(a) - dist(b))
}

/**
 * A name from what an outpost mines, most nodes first: "Iron Ore ×2 · Copper Ore".
 * `nameOf` turns a resource id into its display name.
 */
export function outpostName(nodes: { resource: string }[], nameOf: (id: string) => string, fallback: string) {
  const counts = new Map<string, number>()
  for (const n of nodes) counts.set(n.resource, (counts.get(n.resource) ?? 0) + 1)
  if (counts.size === 0) return fallback
  return [...counts]
    .sort((a, b) => b[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(b[0])))
    .map(([id, n]) => (n > 1 ? `${nameOf(id)} ×${n}` : nameOf(id)))
    .join(' · ')
}
