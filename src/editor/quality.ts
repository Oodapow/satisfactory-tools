// How tidy a floor plan's lines are, to compare layouts (#88): bends are corners along a line,
// crossings are grid points two lines pass through.
import { G } from './grid'
import type { Point } from './router'

export function lineQuality(routes: Map<string, Point[]>) {
  let bends = 0
  const seen = new Map<string, number>()
  for (const pts of routes.values()) {
    bends += Math.max(0, pts.length - 2)
    const mine = new Set<string>()
    for (let i = 1; i < pts.length; i++) {
      const a = { x: pts[i - 1].x / G, y: pts[i - 1].y / G }
      const b = { x: pts[i].x / G, y: pts[i].y / G }
      const sx = Math.sign(b.x - a.x)
      const sy = Math.sign(b.y - a.y)
      for (let x = a.x, y = a.y; x !== b.x || y !== b.y; x += sx, y += sy) if (i > 1 || x !== a.x || y !== a.y) mine.add(`${x},${y}`)
    }
    const last = pts[pts.length - 1]
    if (last) mine.delete(`${last.x / G},${last.y / G}`)
    for (const k of mine) seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  let crossings = 0
  for (const n of seen.values()) if (n > 1) crossings += n - 1
  return { bends, crossings }
}
