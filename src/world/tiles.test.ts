import { describe, expect, it } from 'vitest'
import { worldMapTiles } from '../data/game/worldMap'
import { levelFor, overlaps, padded, tileOf, tilesAcross, tilesIn } from './tiles'

describe('map tiles', () => {
  it('picks the coarsest level that is sharp enough', () => {
    expect(levelFor(300)).toBe(0)
    expect(levelFor(780)).toBe(0)
    expect(levelFor(1000)).toBe(1)
    expect(levelFor(5000)).toBe(3)
    expect(levelFor(20000)).toBe(worldMapTiles.sizes.length - 1)
  })

  it('cuts each level into overlapping tiles that cover the whole map', () => {
    for (const [level] of worldMapTiles.sizes.entries()) {
      const n = tilesAcross(level)
      const first = tileOf(level, 0, 0)
      const last = tileOf(level, n - 1, n - 1)
      expect(first.box.left).toBe(0)
      expect(first.box.top).toBe(0)
      expect(last.box.right).toBe(1)
      expect(last.box.bottom).toBe(1)
      // Neighbours overlap, so no seam shows between them.
      if (n > 1) expect(tileOf(level, 0, 1).box.left).toBeLessThan(first.box.right)
    }
  })

  it('loads only the tiles around the view, nearest first', () => {
    const level = worldMapTiles.sizes.length - 1
    const view = { left: 0.5, top: 0.5, right: 0.55, bottom: 0.55 }
    const tiles = tilesIn(level, padded(view, level), [0.525, 0.525])
    expect(tiles.length).toBeGreaterThan(1)
    expect(tiles.length).toBeLessThan(tilesAcross(level) ** 2 / 4)
    expect(overlaps(tiles[0].box, view)).toBe(true)
    const centre = (t: (typeof tiles)[number]) => Math.hypot((t.box.left + t.box.right) / 2 - 0.525, (t.box.top + t.box.bottom) / 2 - 0.525)
    for (let i = 1; i < tiles.length; i++) expect(centre(tiles[i])).toBeGreaterThanOrEqual(centre(tiles[i - 1]))
  })

  it('needs few tiles for the whole map', () => {
    const whole = { left: 0, top: 0, right: 1, bottom: 1 }
    expect(tilesIn(levelFor(700), whole, [0.5, 0.5]).length).toBeLessThanOrEqual(4)
  })
})
