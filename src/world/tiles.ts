// Which map tiles to load and draw for a view. Boxes are in unit coordinates: 0..1 across the map.
import { worldMapTiles } from '../data/game/worldMap'

export type Box = { left: number; top: number; right: number; bottom: number }
export type Tile = { key: string; level: number; row: number; col: number; box: Box }

const { tile: TILE, overlap: OVERLAP, sizes: SIZES } = worldMapTiles

/** The coarsest level that still looks sharp when the whole map is drawn `px` device pixels across. */
export function levelFor(px: number) {
  const i = SIZES.findIndex((size) => size * 1.25 >= px)
  return i < 0 ? SIZES.length - 1 : i
}

/** Tiles across one side of a level. */
export const tilesAcross = (level: number) => Math.ceil(SIZES[level] / TILE)

/** The part of the map one tile covers, overlap included. */
export function tileOf(level: number, row: number, col: number): Tile {
  const size = SIZES[level]
  const edge = (i: number, d: number) => Math.min(size, Math.max(0, i * TILE + d)) / size
  return {
    key: `${level}/${row}/${col}`,
    level,
    row,
    col,
    box: { left: edge(col, -OVERLAP), top: edge(row, -OVERLAP), right: edge(col + 1, OVERLAP), bottom: edge(row + 1, OVERLAP) },
  }
}

export const parseKey = (key: string) => key.split('/').map(Number) as [number, number, number]

/** `box` grown by one tile of `level` on every side: the ring around the view that loads next. */
export function padded(box: Box, level: number): Box {
  const d = TILE / SIZES[level]
  return { left: box.left - d, top: box.top - d, right: box.right + d, bottom: box.bottom + d }
}

export const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** The tiles of `level` that overlap `box`, nearest to `center` first. */
export function tilesIn(level: number, box: Box, center: [number, number]): Tile[] {
  const n = tilesAcross(level)
  const span = (lo: number, hi: number) => [Math.max(0, Math.floor((lo * SIZES[level]) / TILE)), Math.min(n - 1, Math.floor((hi * SIZES[level]) / TILE))]
  const [c0, c1] = span(box.left, box.right)
  const [r0, r1] = span(box.top, box.bottom)
  const tiles: Tile[] = []
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) tiles.push(tileOf(level, r, c))
  const dist = (t: Tile) => Math.hypot((t.box.left + t.box.right) / 2 - center[0], (t.box.top + t.box.bottom) / 2 - center[1])
  return tiles.sort((a, b) => dist(a) - dist(b))
}
