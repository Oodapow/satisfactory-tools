// Routes floor-plan belts along the grid (grid.ts) so they stay readable: belts run on grid
// lines, no two belts share a grid edge, a belt only turns where no other belt is, and two
// belts may only meet where they cross straight through each other (drawn with a hop).
// Each belt is an A* search over grid vertices that avoids blocks and the belts routed
// before it, preferring few turns and few crossings. Short belts (manifolds) go first.
import { cellOf, G, handleCell, isBlock, orientAll, SIZE, type Cell, type Orient, type Side } from './grid'
import type { BeltEdge, MicroNode } from './model'
import type { Point } from './router'

const TURN = 4
const CROSS = 3
/** Sharing a grid edge or vertex with another belt: allowed only as a last resort. */
const CLASH = 100_000
const MARGIN = 10
const MAX_EXPANSIONS = 1_000_000

// Directions: 0 = +x, 1 = +y, 2 = -x, 3 = -y.
const DX = [1, 0, -1, 0]
const DY = [0, 1, 0, -1]
const dirOf: Record<Side, number> = { r: 0, b: 1, l: 2, t: 3 }

export type Routes = {
  /** Corner points in px, from the source handle to the target handle. */
  routes: Map<string, Point[]>
  orients: Map<string, Orient>
  /** Belts that had to share grid space with another one (no clean path). */
  clashes: string[]
}

/** Lay out every belt of a floor plan on the grid. */
export function routeFloorPlan(nodes: MicroNode[], edges: BeltEdge[]): Routes {
  const orients = orientAll(nodes, edges)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const blocks = nodes.filter(isBlock)
  const routes = new Map<string, Point[]>()
  const clashes: string[] = []
  if (!blocks.length) return { routes, orients, clashes }

  // Grid bounds around every block.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of blocks) {
    const c = cellOf(n)
    const s = SIZE[n.type]
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x + s.w)
    maxY = Math.max(maxY, c.y + s.h)
  }
  minX -= MARGIN
  minY -= MARGIN
  const W = maxX + MARGIN - minX + 1
  const H = maxY + MARGIN - minY + 1
  const idx = (x: number, y: number) => (y - minY) * W + (x - minX)
  const inside = (x: number, y: number) => x >= minX && y >= minY && x < minX + W && y < minY + H

  // Blocks and their borders are off limits; connection points are opened per search.
  const blocked = new Uint8Array(W * H)
  for (const n of blocks) {
    const c = cellOf(n)
    const s = SIZE[n.type]
    for (let y = c.y; y <= c.y + s.h; y++) for (let x = c.x; x <= c.x + s.w; x++) if (inside(x, y)) blocked[idx(x, y)] = 1
  }
  // What committed belts use: per vertex, bit 1 = runs through horizontally, 2 = vertically,
  // 4 = turns or ends here. Per grid edge, 1 = used (horizontal edges at 2i, vertical at 2i+1).
  const vertex = new Uint8Array(W * H)
  const segment = new Uint8Array(W * H * 2)
  const segKey = (x: number, y: number, d: number) => {
    // Normalise to the edge leaving the lower vertex in +x or +y.
    if (d === 2) return idx(x - 1, y) * 2
    if (d === 3) return idx(x, y - 1) * 2 + 1
    return idx(x, y) * 2 + (d === 0 ? 0 : 1)
  }

  const ends = edges.flatMap((e) => {
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    if (!s || !t) return []
    const a = handleCell(s, e.sourceHandle ?? 'out', orients.get(s.id))
    const b = handleCell(t, e.targetHandle ?? 'in', orients.get(t.id))
    return a && b ? [{ e, a, b }] : []
  })
  // The grid spot just outside every connection point belongs to that point's belt: others keep off it.
  const reserved = new Uint8Array(W * H)
  const stepOut = (c: Cell & { side: Side }) => ({ x: c.x + DX[dirOf[c.side]], y: c.y + DY[dirOf[c.side]] })
  for (const { a, b } of ends)
    for (const c of [stepOut(a), stepOut(b)]) if (inside(c.x, c.y)) reserved[idx(c.x, c.y)] = 1
  ends.sort((p, q) => Math.abs(p.a.x - p.b.x) + Math.abs(p.a.y - p.b.y) - (Math.abs(q.a.x - q.b.x) + Math.abs(q.a.y - q.b.y)))

  // Search state, reused across belts: a state is valid only when its stamp matches.
  const N = W * H * 4
  const g = new Float64Array(N)
  const prev = new Int32Array(N)
  const stamp = new Int32Array(N)
  let round = 0

  for (const { e, a, b } of ends) {
    if (!inside(a.x, a.y) || !inside(b.x, b.y)) continue
    const path = search(a, b)
    if (!path) continue
    commit(path.cells)
    if (path.clash) clashes.push(e.id)
    routes.set(e.id, corners(path.cells).map((c) => ({ x: c.x * G, y: c.y * G })))
  }
  return { routes, orients, clashes }

  function search(a: Cell & { side: Side }, b: Cell & { side: Side }) {
    const start = idx(a.x, a.y)
    const goal = idx(b.x, b.y)
    const sa = stepOut(a)
    const sb = stepOut(b)
    const own1 = inside(sa.x, sa.y) ? idx(sa.x, sa.y) : -1
    const own2 = inside(sb.x, sb.y) ? idx(sb.x, sb.y) : -1
    const wasA = blocked[start]
    const wasB = blocked[goal]
    blocked[start] = 0
    blocked[goal] = 0
    round++
    const cost0 = (st: number) => (stamp[st] === round ? g[st] : Infinity)
    const heap = new Heap()
    const sd = dirOf[a.side]
    const s0 = start * 4 + sd
    g[s0] = 0
    prev[s0] = -1
    stamp[s0] = round
    heap.push(s0, 0)
    const h = (v: number) => {
      const x = (v % W) + minX
      const y = Math.floor(v / W) + minY
      return Math.abs(x - b.x) + Math.abs(y - b.y)
    }
    // The belt has to enter the target block through its side.
    const td = (dirOf[b.side] + 2) % 4
    let found = -1
    let expansions = 0
    while (heap.size && expansions++ < MAX_EXPANSIONS) {
      const st = heap.pop()
      const v = st >> 2
      const din = st & 3
      if (v === goal) {
        if (din === td) {
          found = st
          break
        }
        continue
      }
      const gv = g[st]
      const x = (v % W) + minX
      const y = Math.floor(v / W) + minY
      const used = v === start ? 0 : vertex[v]
      for (let d = 0; d < 4; d++) {
        if (d === (din + 2) % 4) continue
        // Leave the source block straight out of its side.
        if (v === start && d !== sd) continue
        const nx = x + DX[d]
        const ny = y + DY[d]
        if (!inside(nx, ny)) continue
        const w = idx(nx, ny)
        if (blocked[w]) continue
        let cost = 1
        if (v !== start) {
          if (d === din) {
            const axis = d % 2 === 0 ? 1 : 2
            if (used & (axis | 4)) cost += CLASH
            else if (used) cost += CROSS
          } else {
            cost += TURN
            if (used) cost += CLASH
          }
        }
        if (segment[segKey(x, y, d)]) cost += CLASH
        if (w !== goal && vertex[w] & 4) cost += CLASH
        if (reserved[w] && w !== own1 && w !== own2) cost += CLASH
        const ns = w * 4 + d
        const ng = gv + cost
        if (ng < cost0(ns)) {
          g[ns] = ng
          prev[ns] = st
          stamp[ns] = round
          heap.push(ns, ng + h(w))
        }
      }
    }
    blocked[start] = wasA
    blocked[goal] = wasB
    if (found < 0) return null
    const cells: Cell[] = []
    for (let s = found; s >= 0; s = prev[s]) {
      const v = s >> 2
      cells.push({ x: (v % W) + minX, y: Math.floor(v / W) + minY })
    }
    cells.reverse()
    return { cells, clash: g[found] >= CLASH }
  }

  function commit(cells: Cell[]) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      const v = idx(c.x, c.y)
      if (i === 0 || i === cells.length - 1) {
        vertex[v] |= 4
      } else {
        const p = cells[i - 1]
        const n = cells[i + 1]
        if (p.x === n.x) vertex[v] |= 2
        else if (p.y === n.y) vertex[v] |= 1
        else vertex[v] |= 4
      }
      if (i > 0) {
        const p = cells[i - 1]
        const d = c.x > p.x ? 0 : c.y > p.y ? 1 : c.x < p.x ? 2 : 3
        segment[segKey(p.x, p.y, d)] = 1
      }
    }
  }
}

/** Keep only the corners of a cell path. */
function corners(cells: Cell[]) {
  const out: Cell[] = []
  for (let i = 0; i < cells.length; i++) {
    const p = cells[i - 1]
    const c = cells[i]
    const n = cells[i + 1]
    if (!p || !n || !((p.x === c.x && c.x === n.x) || (p.y === c.y && c.y === n.y))) out.push(c)
  }
  return out
}

/** Every grid edge each route uses, to check routes never share one. */
export function routeSegments(pts: Point[]) {
  const out: string[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = { x: pts[i - 1].x / G, y: pts[i - 1].y / G }
    const b = { x: pts[i].x / G, y: pts[i].y / G }
    const sx = Math.sign(b.x - a.x)
    const sy = Math.sign(b.y - a.y)
    for (let x = a.x, y = a.y; x !== b.x || y !== b.y; x += sx, y += sy) {
      const nx = x + sx
      const ny = y + sy
      out.push(sx ? `h${Math.min(x, nx)},${y}` : `v${x},${Math.min(y, ny)}`)
    }
  }
  return out
}

class Heap {
  private keys: number[] = []
  private vals: number[] = []
  get size() {
    return this.keys.length
  }
  push(key: number, val: number) {
    const k = this.keys
    const v = this.vals
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (v[p] <= val) break
      k[i] = k[p]
      v[i] = v[p]
      i = p
    }
    k[i] = key
    v[i] = val
  }
  pop() {
    const k = this.keys
    const v = this.vals
    const top = k[0]
    const lastK = k.pop()!
    const lastV = v.pop()!
    if (k.length) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= k.length) break
        const r = l + 1
        const c = r < k.length && v[r] < v[l] ? r : l
        if (v[c] >= lastV) break
        k[i] = k[c]
        v[i] = v[c]
        i = c
      }
      k[i] = lastK
      v[i] = lastV
    }
    return top
  }
}
