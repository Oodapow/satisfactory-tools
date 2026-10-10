// The floor plan's grid. Every block sits on it with a fixed size, and every connection
// point is a grid vertex on the block's border, so the router (gridRouter.ts) can run
// belts along grid lines. Splitters, mergers and ports turn their connection points to
// face whatever they connect to; the icon itself never turns.
import { buildingsById, itemsById, recipesById } from '../data'
import { poleConnections, type BeltEdge, type Medium, type MicroNode, type MicroNodeData } from './model'

/** Grid size in px. */
export const G = 20

export type Side = 'l' | 'r' | 't' | 'b'
export type Cell = { x: number; y: number }

/** Unit step out of a block through each side, in cells. */
export const sideDir: Record<Side, Cell> = { l: { x: -1, y: 0 }, r: { x: 1, y: 0 }, t: { x: 0, y: -1 }, b: { x: 0, y: 1 } }

/** Block sizes in cells. Floor bands aren't blocks: belts may cross them. */
export const SIZE = {
  machine: { w: 10, h: 4 },
  splitter: { w: 2, h: 2 },
  merger: { w: 2, h: 2 },
  junction: { w: 2, h: 2 },
  pole: { w: 2, h: 2 },
  port: { w: 12, h: 4 },
} as const

export type BlockKind = keyof typeof SIZE
export const isBlock = (n: MicroNode): n is MicroNode & { type: BlockKind } => !!n.type && n.type in SIZE

export type Size = { w: number; h: number }
/** Quarter turns clockwise. */
export type Rot = 0 | 1 | 2 | 3

/** Metres per grid cell: a splitter (4 m across) is 2 cells, a foundation (8 m) is 4. */
export const CELL_M = 2

/**
 * A machine's ground footprint in cells, from the game's building size: its width across the
 * top and its length down the side, inputs at the back (top) and outputs at the front (bottom).
 * Turned a quarter, width and length swap.
 */
export function machineSize(building: string, rot: Rot = 0): Size {
  const s = buildingsById.get(building)?.size
  const w = s ? Math.max(2, Math.ceil(s.width / CELL_M - 1e-9)) : SIZE.machine.w
  const h = s ? Math.max(2, Math.ceil(s.length / CELL_M - 1e-9)) : SIZE.machine.h
  return rot % 2 ? { w: h, h: w } : { w, h }
}

/** A block's size in cells: machines at their real footprint, the rest fixed. */
export const sizeOf = (type: BlockKind, data: MicroNodeData): Size =>
  type === 'machine' && data.kind === 'machine' ? machineSize(data.building, data.rot ?? 0) : SIZE[type]

/** True when two blocks' areas overlap, or come closer than `gap` cells (0: touching borders is fine). */
export function overlaps(a: Cell, sa: Size, b: Cell, sb: Size, gap = 0) {
  return a.x < b.x + sb.w + gap && b.x < a.x + sa.w + gap && a.y < b.y + sb.h + gap && b.y < a.y + sa.h + gap
}

/**
 * The free grid spot nearest to `want` for a block of `type`: a grid line clear all round it, so
 * belts and power lines can reach its connection points.
 */
export function freeSpot(nodes: MicroNode[], id: string, size: Size, want: Cell): Cell {
  const others = nodes.filter((n) => n.id !== id && isBlock(n)).map((n) => ({ at: cellOf(n), size: sizeOf(n.type as BlockKind, n.data) }))
  const free = (c: Cell) => others.every((o) => !overlaps(c, size, o.at, o.size, 2))
  if (free(want)) return want
  for (let r = 1; r < 200; r++) {
    let best: Cell | undefined
    let bestD = Infinity
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const c = { x: want.x + dx, y: want.y + dy }
        const d = dx * dx + dy * dy
        if (d < bestD && free(c)) {
          best = c
          bestD = d
        }
      }
    if (best) return best
  }
  return want
}

/** How a splitter, merger or port is turned: quarter turns clockwise, after swapping top and bottom when mirrored. */
export type Orient = { rot: 0 | 1 | 2 | 3; mirror: boolean }
export const UPRIGHT: Orient = { rot: 0, mirror: false }

const CLOCKWISE: Side[] = ['t', 'r', 'b', 'l']
const turn = (s: Side, o: Orient): Side => {
  const m = o.mirror ? (s === 't' ? 'b' : s === 'b' ? 't' : s) : s
  return CLOCKWISE[(CLOCKWISE.indexOf(m) + o.rot) % 4]
}

/** `n` connection points spread evenly along a side `w` cells long, on grid vertices and never on the corners. */
export function spread(n: number, w: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const want = Math.round(((i + 1) * w) / (n + 1))
    out.push(Math.min(w - 1, Math.max(out.length ? out[out.length - 1] + 1 : 1, want)))
  }
  return out
}

/** Turn a connection point a quarter clockwise inside a block `h` cells high. */
const quarter = (a: Anchor, h: number): Anchor => ({ dx: h - a.dy, dy: a.dx, side: CLOCKWISE[(CLOCKWISE.indexOf(a.side) + 1) % 4] })

/** Handle ids for a machine's inputs and outputs. The first ones are "in" and "out", so older floor plans still connect. */
export const inHandle = (j: number) => (j === 0 ? 'in' : `in${j}`)
export const outHandle = (p: number) => (p === 0 ? 'out' : `out${p}`)

/** Items going into and out of a machine, in handle order. */
export function machineIO(d: MicroNodeData): { ins: string[]; outs: string[] } {
  if (d.kind !== 'machine') return { ins: [], outs: [] }
  const recipe = recipesById.get(d.recipe)
  if (recipe) return { ins: recipe.ingredients.map((i) => i.item), outs: recipe.products.map((p) => p.item) }
  const gen = buildingsById.get(d.building)?.generator
  const spec = gen?.fuels.find((f) => f.fuel === d.fuel) ?? gen?.fuels[0]
  if (spec) return { ins: [spec.fuel, ...(spec.supplemental ? [spec.supplemental] : [])], outs: spec.byproduct ? [spec.byproduct] : [] }
  return { ins: [''], outs: [''] }
}

/** A connection point: offset from the block's top-left corner in cells, and the side it faces. */
export type Anchor = { dx: number; dy: number; side: Side }

/** Machines that use or make power have a power connection on their right side. */
const POWER_HANDLE = 'power'
const hasPower = (d: MicroNodeData) =>
  (d.kind === 'machine' && (!!buildingsById.get(d.building)?.generator || (buildingsById.get(d.building)?.powerConsumptionMW ?? 0) > 0)) ||
  (d.kind === 'port' && d.transport === 'resource')

/** Pole connection handle ids. */
export const poleHandle = (i: number) => `p${i}`
export const poleSize = (d: MicroNodeData) => (d.kind === 'pole' ? poleConnections[Math.min(Math.max(d.tier, 1), poleConnections.length) - 1] : 0)

/** Every connection point of a block, by handle id. */
export function anchors(type: BlockKind, data: MicroNodeData, o: Orient = UPRIGHT): Record<string, Anchor> {
  const { w, h } = type === 'machine' && data.kind === 'machine' ? machineSize(data.building) : SIZE[type]
  const at = (side: Side): Anchor => {
    const s = turn(side, o)
    return s === 'l' ? { dx: 0, dy: h / 2, side: s } : s === 'r' ? { dx: w, dy: h / 2, side: s } : s === 't' ? { dx: w / 2, dy: 0, side: s } : { dx: w / 2, dy: h, side: s }
  }
  if (type === 'machine') {
    // Upright: inputs along the back (top), outputs along the front (bottom), power on the right.
    // A turned machine carries its points round with it; the icon stays upright.
    const { ins, outs } = machineIO(data)
    const out: Record<string, Anchor> = {}
    spread(ins.length, w).forEach((dx, j) => (out[inHandle(j)] = { dx, dy: 0, side: 't' }))
    spread(outs.length, w).forEach((dx, p) => (out[outHandle(p)] = { dx, dy: h, side: 'b' }))
    if (hasPower(data)) out[POWER_HANDLE] = { dx: w, dy: Math.floor(h / 2), side: 'r' }
    const rot = data.kind === 'machine' ? (data.rot ?? 0) : 0
    for (let k = 0; k < rot; k++) for (const key of Object.keys(out)) out[key] = quarter(out[key], k % 2 ? w : h)
    return out
  }
  if (type === 'pole') {
    // Grid vertices round the pole, so power lines run on the grid like belts: the middle of each
    // side first, then the corners. A 2x2 pole has eight, so a Mk.3 shows eight of its ten.
    const ring: Anchor[] = [
      { dx: w / 2, dy: 0, side: 't' },
      { dx: w, dy: h / 2, side: 'r' },
      { dx: w / 2, dy: h, side: 'b' },
      { dx: 0, dy: h / 2, side: 'l' },
      // Corners leave up or down: a pole often stands one cell from a machine's side.
      { dx: w, dy: 0, side: 't' },
      { dx: w, dy: h, side: 'b' },
      { dx: 0, dy: h, side: 'b' },
      { dx: 0, dy: 0, side: 't' },
    ]
    const out: Record<string, Anchor> = {}
    ring.slice(0, poleSize(data)).forEach((a, i) => (out[poleHandle(i)] = a))
    return out
  }
  if (type === 'port') {
    // Power ports face their pole on the left; the rest face the belts on the right.
    const power = data.kind === 'port' && data.transport === 'power'
    const main: Record<string, Anchor> = data.kind === 'port' && data.direction === 'out' ? { in: at('l') } : { out: at(power ? 'l' : 'r') }
    // Extractors on a resource node draw power from the side away from their belt.
    return hasPower(data) ? { ...main, [POWER_HANDLE]: at('l') } : main
  }
  // Splitter: in at the back, out ahead, up and down. Merger: in at the back, up and down, out ahead.
  // Junction: the same four points, each one in or out.
  return { in: at('l'), out: at('r'), up: at('t'), down: at('b') }
}

const formOf = (item: string | undefined): Medium => (item && itemsById.get(item)?.form && itemsById.get(item)?.form !== 'solid' ? 'fluid' : 'solid')

/** What a connection point carries, and whether things flow out of it, into it, or either way. */
export type HandleInfo = { medium: Medium; role: 'in' | 'out' | 'any' }

export function handleInfo(d: MicroNodeData, handle: string | null | undefined): HandleInfo | undefined {
  const h = handle ?? ''
  if (h === POWER_HANDLE) return hasPower(d) ? { medium: 'power', role: 'any' } : undefined
  switch (d.kind) {
    case 'machine': {
      const { ins, outs } = machineIO(d)
      const i = ins.findIndex((_, j) => inHandle(j) === h)
      if (i >= 0) return { medium: formOf(ins[i]), role: 'in' }
      const o = outs.findIndex((_, p) => outHandle(p) === h)
      if (o >= 0) return { medium: formOf(outs[o]), role: 'out' }
      return undefined
    }
    case 'splitter':
      return { medium: 'solid', role: h === 'in' ? 'in' : 'out' }
    case 'merger':
      return { medium: 'solid', role: h === 'out' ? 'out' : 'in' }
    case 'junction':
      return { medium: 'fluid', role: 'any' }
    case 'pole':
      return { medium: 'power', role: 'any' }
    case 'port': {
      if (d.transport === 'power') return { medium: 'power', role: 'any' }
      const medium = d.transport === 'pipe' ? 'fluid' : formOf(d.item)
      return { medium, role: d.direction === 'in' ? 'out' : 'in' }
    }
    default:
      return undefined
  }
}

/** What a line carries: from its source's connection point, or what it was made as. */
export function edgeMedium(e: BeltEdge, byId: Map<string, MicroNode>): Medium {
  const s = byId.get(e.source)
  const t = byId.get(e.target)
  return (s && handleInfo(s.data, e.sourceHandle)?.medium) ?? (t && handleInfo(t.data, e.targetHandle)?.medium) ?? e.data?.medium ?? formOf(e.data?.item)
}

/** Position of a block in cells (rounded, for blocks placed before the grid existed). */
export const cellOf = (n: MicroNode): Cell => ({ x: Math.round(n.position.x / G), y: Math.round(n.position.y / G) })

/** Absolute cell of a handle. */
export function handleCell(n: MicroNode, handle: string, o?: Orient): (Cell & { side: Side }) | undefined {
  if (!isBlock(n)) return undefined
  const a = anchors(n.type, n.data, o)[handle ?? ''] ?? Object.values(anchors(n.type, n.data, o))[0]
  if (!a) return undefined
  const c = cellOf(n)
  return { x: c.x + a.dx, y: c.y + a.dy, side: a.side }
}

const ORIENTS: Orient[] = ([0, 1, 2, 3] as const).flatMap((rot) => [
  { rot, mirror: false },
  { rot, mirror: true },
])

/**
 * Turn every splitter, merger and port so its connection points face what they connect to.
 * Each one is scored against the centre of the block at the other end of its belts (or the
 * exact connection point on a machine, which never turns).
 */
export function orientAll(nodes: MicroNode[], edges: BeltEdge[]): Map<string, Orient> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = new Map<string, Orient>()
  const peerPoint = (id: string, handle: string | null | undefined) => {
    const n = byId.get(id)
    if (!n || !isBlock(n)) return undefined
    if (n.type === 'machine') return handleCell(n, handle ?? '')
    const c = cellOf(n)
    const s = sizeOf(n.type, n.data)
    return { x: c.x + s.w / 2, y: c.y + s.h / 2 }
  }
  for (const n of nodes) {
    if (!isBlock(n) || n.type === 'machine' || n.type === 'pole') continue
    const links: { handle: string; at: Cell }[] = []
    for (const e of edges) {
      // Power lines don't turn joints, but an extractor's port also faces its pole.
      if (n.type !== 'port' && edgeMedium(e, byId) === 'power') continue
      if (e.source === n.id) {
        const at = peerPoint(e.target, e.targetHandle)
        if (at) links.push({ handle: e.sourceHandle ?? 'out', at })
      }
      if (e.target === n.id) {
        const at = peerPoint(e.source, e.sourceHandle)
        if (at) links.push({ handle: e.targetHandle ?? 'in', at })
      }
    }
    if (!links.length) continue
    const c = cellOf(n)
    const options = n.type === 'port' ? ORIENTS.filter((o) => !o.mirror) : ORIENTS
    let best = UPRIGHT
    let bestScore = -Infinity
    for (const o of options) {
      const a = anchors(n.type, n.data, o)
      let score = 0
      for (const l of links) {
        const h = a[l.handle]
        if (!h) continue
        const vx = l.at.x - (c.x + h.dx)
        const vy = l.at.y - (c.y + h.dy)
        const len = Math.hypot(vx, vy) || 1
        const d = sideDir[h.side]
        // The single belt (into a splitter, out of a merger) matters most: it is the trunk of the joint.
        const trunk = (n.type === 'splitter' && l.handle === 'in') || (n.type === 'merger' && l.handle === 'out') ? 2 : 1
        score += (trunk * (d.x * vx + d.y * vy)) / len
      }
      if (score > bestScore + 1e-6) {
        best = o
        bestScore = score
      }
    }
    out.set(n.id, best)
  }
  return out
}
