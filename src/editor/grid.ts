// The floor plan's grid. Every block sits on it with a fixed size, and every connection
// point is a grid vertex on the block's border, so the router (gridRouter.ts) can run
// belts along grid lines. Splitters, mergers and ports turn their connection points to
// face whatever they connect to; the icon itself never turns.
import { buildingsById, recipesById } from '../data'
import type { BeltEdge, MicroNode, MicroNodeData } from './model'

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
  port: { w: 12, h: 4 },
} as const

export type BlockKind = keyof typeof SIZE
export const isBlock = (n: MicroNode): n is MicroNode & { type: BlockKind } => !!n.type && n.type in SIZE

/** How a splitter, merger or port is turned: quarter turns clockwise, after swapping top and bottom when mirrored. */
export type Orient = { rot: 0 | 1 | 2 | 3; mirror: boolean }
export const UPRIGHT: Orient = { rot: 0, mirror: false }

const CLOCKWISE: Side[] = ['t', 'r', 'b', 'l']
const turn = (s: Side, o: Orient): Side => {
  const m = o.mirror ? (s === 't' ? 'b' : s === 'b' ? 't' : s) : s
  return CLOCKWISE[(CLOCKWISE.indexOf(m) + o.rot) % 4]
}

// Connection points on a machine's top (inputs) and bottom (outputs), in cells from its left edge.
export const SPREAD: Record<number, number[]> = { 1: [5], 2: [3, 7], 3: [2, 5, 8], 4: [2, 4, 6, 8] }

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

/** Every connection point of a block, by handle id. */
export function anchors(type: BlockKind, data: MicroNodeData, o: Orient = UPRIGHT): Record<string, Anchor> {
  const { w, h } = SIZE[type]
  const at = (side: Side): Anchor => {
    const s = turn(side, o)
    return s === 'l' ? { dx: 0, dy: h / 2, side: s } : s === 'r' ? { dx: w, dy: h / 2, side: s } : s === 't' ? { dx: w / 2, dy: 0, side: s } : { dx: w / 2, dy: h, side: s }
  }
  if (type === 'machine') {
    const { ins, outs } = machineIO(data)
    const out: Record<string, Anchor> = {}
    ;(SPREAD[ins.length] ?? []).forEach((dx, j) => (out[inHandle(j)] = { dx, dy: 0, side: 't' }))
    ;(SPREAD[outs.length] ?? []).forEach((dx, p) => (out[outHandle(p)] = { dx, dy: h, side: 'b' }))
    return out
  }
  if (type === 'port') return data.kind === 'port' && data.direction === 'out' ? { in: at('l') } : { out: at('r') }
  // Splitter: in at the back, out ahead, up and down. Merger: in at the back, up and down, out ahead.
  return { in: at('l'), out: at('r'), up: at('t'), down: at('b') }
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
    return { x: c.x + SIZE[n.type].w / 2, y: c.y + SIZE[n.type].h / 2 }
  }
  for (const n of nodes) {
    if (!isBlock(n) || n.type === 'machine') continue
    const links: { handle: string; at: Cell }[] = []
    for (const e of edges) {
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
