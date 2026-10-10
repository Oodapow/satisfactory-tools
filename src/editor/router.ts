// Schematic-style routing for edges: orthogonal lines with 90° corners, and a small hop
// wherever a horizontal run crosses another edge's vertical run, so crossings never read
// as joins. Every edge registers its route in a per-canvas registry so the others can
// see where to hop.
import { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import { Position } from '@xyflow/react'

export type Point = { x: number; y: number }

const STUB = 18
const HOP = 5

const dir: Record<Position, Point> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
}

/** Small per-edge offset so parallel channels of different edges don't sit on top of each other. */
function jitter(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return ((h % 5) - 2) * 6
}

export type RouteOptions = {
  /** Run the vertical part of the route along this x (a shared lane, e.g. for lifts between floors). */
  laneX?: number
  /** Move the whole middle of the route sideways, for parallel links between the same two blocks. */
  shift?: number
}

/** Orthogonal route from a source handle to a target handle. */
export function route(id: string, s: Point, sp: Position, t: Point, tp: Position, opts: RouteOptions = {}): Point[] {
  const ds = dir[sp]
  const dt = dir[tp]
  const a = { x: s.x + ds.x * STUB, y: s.y + ds.y * STUB }
  const b = { x: t.x + dt.x * STUB, y: t.y + dt.y * STUB }
  let mid: Point[]
  if (opts.laneX !== undefined) {
    mid = [{ x: opts.laneX, y: a.y }, { x: opts.laneX, y: b.y }]
  } else if (opts.shift) {
    // Parallel links: step sideways near both ends, then run alongside.
    const k = opts.shift
    const mx = (a.x + b.x) / 2 + k
    mid = ds.x ? [{ x: a.x, y: a.y + k }, { x: mx, y: a.y + k }, { x: mx, y: b.y + k }, { x: b.x, y: b.y + k }] : [{ x: a.x + k, y: a.y }, { x: a.x + k, y: (a.y + b.y) / 2 }, { x: b.x + k, y: (a.y + b.y) / 2 }, { x: b.x + k, y: b.y }]
  } else if (ds.x && dt.x) {
    // Target behind the source: go round through the gap between them instead of under the blocks.
    const backwards = (b.x - a.x) * ds.x < 0
    const mx = (a.x + b.x) / 2 + jitter(id)
    const my = (a.y + b.y) / 2 + jitter(id)
    mid = backwards ? [{ x: a.x, y: my }, { x: b.x, y: my }] : [{ x: mx, y: a.y }, { x: mx, y: b.y }]
  } else if (ds.y && dt.y) {
    const backwards = (b.y - a.y) * ds.y < 0
    const mx = (a.x + b.x) / 2 + jitter(id)
    const my = (a.y + b.y) / 2 + jitter(id)
    mid = backwards ? [{ x: mx, y: a.y }, { x: mx, y: b.y }] : [{ x: a.x, y: my }, { x: b.x, y: my }]
  } else if (ds.x) {
    mid = [{ x: b.x, y: a.y }]
  } else {
    mid = [{ x: a.x, y: b.y }]
  }
  return simplify([s, a, ...mid, b, t])
}

function simplify(points: Point[]) {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue
    const prev = out[out.length - 2]
    if (prev && last && ((Math.abs(prev.x - last.x) < 0.5 && Math.abs(last.x - p.x) < 0.5) || (Math.abs(prev.y - last.y) < 0.5 && Math.abs(last.y - p.y) < 0.5)))
      out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

type Seg = { x1: number; y1: number; x2: number; y2: number }
const verticals = (pts: Point[]): Seg[] =>
  pts.slice(1).flatMap((p, i) => (Math.abs(p.x - pts[i].x) < 0.5 ? [{ x1: p.x, y1: Math.min(p.y, pts[i].y), x2: p.x, y2: Math.max(p.y, pts[i].y) }] : []))

/** SVG path through the points, hopping over the given vertical segments on horizontal runs, with corners rounded to `radius`. */
export function pathWithHops(pts: Point[], others: Seg[], radius = 0) {
  const len = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
  // How far each corner is cut back: up to the radius, at most half of either side.
  const cut = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? 0 : Math.min(radius, len(pts[i - 1], p) / 2, len(p, pts[i + 1]) / 2)))
  const toward = (a: Point, b: Point, d: number) => {
    const l = len(a, b) || 1
    return { x: a.x + ((b.x - a.x) * d) / l, y: a.y + ((b.y - a.y) * d) / l }
  }
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const p = toward(pts[i - 1], pts[i], cut[i - 1])
    const q = toward(pts[i], pts[i - 1], cut[i])
    if (Math.abs(p.y - q.y) < 0.5 && Math.abs(p.x - q.x) > 2 * HOP) {
      const sign = Math.sign(q.x - p.x)
      const lo = Math.min(p.x, q.x) + HOP + 1
      const hi = Math.max(p.x, q.x) - HOP - 1
      const xs = others
        .filter((v) => v.x1 > lo && v.x1 < hi && p.y > v.y1 + 1 && p.y < v.y2 - 1)
        .map((v) => v.x1)
        .sort((m, n) => (m - n) * sign)
      let last = -Infinity
      for (const x of xs) {
        if (Math.abs(x - last) < 2 * HOP + 2) continue
        last = x
        d += ` L ${x - sign * HOP} ${p.y} A ${HOP} ${HOP} 0 0 ${sign > 0 ? 1 : 0} ${x + sign * HOP} ${p.y}`
      }
    }
    d += ` L ${q.x} ${q.y}`
    if (cut[i] > 0.5) {
      const r = toward(pts[i], pts[i + 1], cut[i])
      d += ` Q ${pts[i].x} ${pts[i].y} ${r.x} ${r.y}`
    }
  }
  return d
}

/** Midpoint of the longest segment (for labels), and of the longest vertical one (for lift marks). */
export function labelPoints(pts: Point[]) {
  let best = { len: -1, at: pts[0] }
  let vert = { len: -1, at: undefined as Point | undefined }
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]
    const q = pts[i]
    const len = Math.abs(p.x - q.x) + Math.abs(p.y - q.y)
    const at = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
    if (len > best.len) best = { len, at }
    if (Math.abs(p.x - q.x) < 0.5 && len > vert.len) vert = { len, at }
  }
  return { label: best.at, vertical: vert.at }
}

// ---------- Registry ----------

export class RouteRegistry {
  private routes = new Map<string, Point[]>()
  private keys = new Map<string, string>()
  private listeners = new Set<() => void>()
  private version = 0
  private queued = false

  set(id: string, pts: Point[] | null) {
    const key = pts ? JSON.stringify(pts) : ''
    if ((this.keys.get(id) ?? '') === key) return
    if (pts) {
      this.routes.set(id, pts)
      this.keys.set(id, key)
    } else {
      this.routes.delete(id)
      this.keys.delete(id)
    }
    if (this.queued) return
    this.queued = true
    queueMicrotask(() => {
      this.queued = false
      this.version++
      this.listeners.forEach((fn) => fn())
    })
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = () => this.version
  /** Vertical segments of every edge except `id`. */
  verticalsExcept(id: string) {
    return [...this.routes].flatMap(([k, pts]) => (k === id ? [] : verticals(pts)))
  }
}

export const RouteContext = createContext<RouteRegistry | null>(null)

/** Register this edge's route and get its path, hopping over the edges around it. */
export function useRoutedPath(id: string, pts: Point[], radius = 0) {
  const reg = useContext(RouteContext)
  useLayoutEffect(() => {
    reg?.set(id, pts)
  }, [reg, id, pts])
  useLayoutEffect(() => () => reg?.set(id, null), [reg, id])
  const version = useSyncExternalStore(reg?.subscribe ?? noopSubscribe, reg?.getVersion ?? zero)
  return useMemo(() => pathWithHops(pts, reg ? reg.verticalsExcept(id) : [], radius), [pts, reg, id, version, radius]) // eslint-disable-line react-hooks/exhaustive-deps
}

const noopSubscribe = () => () => {}
const zero = () => 0
