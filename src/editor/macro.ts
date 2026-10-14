// The factory map's blocks: where each outpost's connection points sit and how big it is.
// Every exported item has its own export point, every import its own import point, plus one
// free import point that a new link fills. Unlinked points sit on the left (imports) and
// right (exports) edges; linked ones slide round the block to face what they link to (#89).
// Blocks are drawn at the size of the outpost's largest floor, on a grid of half foundations.
import { buildingsById } from '../data'
import { gridOf, type PowerGrid } from '../plan/grids'
import { exportsOf, type Solved } from '../plan/network'
import { netMW } from '../plan/solve'
import type { ItemId } from '../data'
import type { Transport } from '../plan/types'
import type { Side } from './grid'
import { planLayout, type PortLink } from './layout'

/** Factory map grid size in px: one cell is half a foundation (4 m). */
export const MAP_G = 16
/** Foundation size in metres, and in grid cells on the map. */
const FOUNDATION_M = 8
const CELLS_PER_FOUNDATION = 2
/** Grid cells between two connection points on the same edge. */
export const PORT_PITCH = 2
/** First connection point's distance from the top edge, in cells: clear of the labels of points on the top edge. */
const PORT_TOP = 3
/** Smallest block, in cells: room for the icon between the two columns of points. */
const MIN_W = 10
const MIN_H = 6

/** The free import point a new link connects to. */
export const NEW_IN = 'in:new'
export const POWER_IN = 'power-in'
export const POWER_OUT = 'power-out'
export const inHandleOf = (importId: string) => `in:${importId}`
export const outHandleOf = (item: ItemId) => `out:${item}`
export const itemOfOut = (handle: string | null | undefined) => (handle?.startsWith('out:') ? handle.slice(4) : undefined)

export type MapPort = {
  /** Handle id. */
  id: string
  /** Which edge of the block it sits on. */
  side: Side
  /** Cells along that edge: from the top edge for left and right, from the left edge for top and bottom. */
  at: number
  item?: ItemId
  perMin?: number
  via?: Transport
}

export type MapBlock = {
  ins: MapPort[]
  outs: MapPort[]
  /** Power points: below the import points and below the export points. A power line is drawn
   * from one outpost's right power point to another's left one, but has no direction: it puts
   * both on one grid. */
  powerIn?: MapPort
  powerOut?: MapPort
  /** Size in cells. */
  w: number
  h: number
  /** The largest floor (or the extractors), in foundations. */
  foundations: { x: number; y: number }
}

/**
 * The links touching one outpost, as its floor plan needs them. Everything inside an outpost is
 * on its grid, so power is one port: out to the grid for an outpost that makes more than it
 * uses, in from the grid otherwise.
 */
export function portLinks(all: Solved[], grids: PowerGrid[], id: string) {
  const name = (pid: string) => all.find((s) => s.plan.id === pid)?.plan.name ?? '?'
  const { plan, solution } = all.find((s) => s.plan.id === id)!
  const grid = gridOf(grids, id)
  const incoming: PortLink[] = plan.imports.map((i) => ({ linkId: i.id, other: name(i.from), transport: i.via, item: i.item, perMin: i.perMin }))
  const outgoing: PortLink[] = all.flatMap((s) =>
    s.plan.imports.filter((i) => i.from === id).map((i) => ({ linkId: i.id, other: s.plan.name, transport: i.via, item: i.item, perMin: i.perMin })),
  )
  const net = netMW(solution)
  if (grid && Math.abs(net) > 1e-6)
    (net > 0 ? outgoing : incoming).push({ linkId: `grid:${id}`, other: grid.name, transport: 'power', perMin: 0, powerMW: Math.abs(net) })
  return { incoming, outgoing }
}

/** Ground footprint in foundations: the largest floor of the proposed layout, or the extractors side by side. */
export function footprint(s: Solved, all: Solved[], grids: PowerGrid[], beltTier: number, pipeTier: number) {
  let x = 0
  let y = 0
  if (s.solution.steps.length || s.solution.generators.length) {
    for (const f of planLayout({ solved: s, ...portLinks(all, grids, s.plan.id), maxBeltTier: beltTier, maxPipeTier: pipeTier }).floors) {
      x = Math.max(x, f.foundations.x)
      y = Math.max(y, f.foundations.y)
    }
  }
  // Extractors stand side by side with a walkway between them.
  let width = 0
  let length = 0
  for (const e of s.solution.extraction) {
    const size = buildingsById.get(e.extractor)?.size
    if (!size) continue
    width += (size.width + 4) * e.count
    length = Math.max(length, size.length + 4)
  }
  x = Math.max(x, Math.ceil(width / FOUNDATION_M))
  y = Math.max(y, Math.ceil(length / FOUNDATION_M))
  return { x, y }
}

/** Connection points and size of one outpost's block. */
export function mapBlock(s: Solved, all: Solved[], grids: PowerGrid[], beltTier: number, pipeTier: number): MapBlock {
  const { plan, solution } = s
  const ins: MapPort[] = plan.imports.map((i, k) => ({ id: inHandleOf(i.id), side: 'l', at: PORT_TOP + k * PORT_PITCH, item: i.item, perMin: i.perMin, via: i.via }))
  ins.push({ id: NEW_IN, side: 'l', at: PORT_TOP + ins.length * PORT_PITCH })

  // Everything the outpost exports, plus anything others still import from it after it stopped.
  const rates = new Map(exportsOf(solution).map((e) => [e.item, e.perMin]))
  for (const o of all) for (const i of o.plan.imports) if (i.from === plan.id && !rates.has(i.item)) rates.set(i.item, 0)
  const outs: MapPort[] = [...rates].map(([item, perMin], k) => ({ id: outHandleOf(item), side: 'r', at: PORT_TOP + k * PORT_PITCH, item, perMin }))

  // Both power points on anything that makes or uses power or has a power line, so a line can start or end at any of them.
  // Only one carries a rate: the outpost's net power, out to the grid when its generators make more than its machines
  // use, in from it otherwise.
  const lined = !!gridOf(grids, plan.id)?.links.some((l) => l.a === plan.id || l.b === plan.id)
  const powered = lined || solution.power.consumedMW > 1e-6 || solution.power.generatedMW > 1e-6
  const net = netMW(solution)
  const powerOut: MapPort | undefined = powered ? { id: POWER_OUT, side: 'r', at: PORT_TOP + outs.length * PORT_PITCH, perMin: Math.max(0, net) } : undefined
  const powerIn: MapPort | undefined = powered ? { id: POWER_IN, side: 'l', at: PORT_TOP + ins.length * PORT_PITCH, perMin: Math.max(0, -net) } : undefined

  const foundations = footprint(s, all, grids, beltTier, pipeTier)
  const points = Math.max(ins.length + (powerIn ? 1 : 0), outs.length + (powerOut ? 1 : 0))
  return {
    ins,
    outs,
    powerIn,
    powerOut,
    w: Math.max(MIN_W, foundations.x * CELLS_PER_FOUNDATION),
    h: Math.max(MIN_H, foundations.y * CELLS_PER_FOUNDATION, 2 * PORT_TOP + (points - 1) * PORT_PITCH),
    foundations,
  }
}

/** Snap a position to the map grid. */
export const snap = (p: { x: number; y: number }) => ({ x: Math.round(p.x / MAP_G) * MAP_G, y: Math.round(p.y / MAP_G) * MAP_G })

/** One line on the map between two outposts' connection points. */
export type MapLink = { source: string; sourceHandle: string; target: string; targetHandle: string }

/** Cells kept clear at the ends of each edge, so points on two edges never meet at a corner. */
const CORNER: Record<Side, number> = { l: PORT_TOP, r: PORT_TOP, t: 3, b: 3 }
const SIDES: Side[] = ['l', 'r', 't', 'b']

/**
 * Points slid round each block to face what they link to (#89): a linked point goes on the edge
 * that faces the blocks at its lines' far ends, level with them where the edge reaches, so lines
 * run short and straight. Points on one edge keep PORT_PITCH apart; an edge with no room left
 * passes the rest on to the next edge that faces their way. Unlinked points keep their place
 * on the left or right edge. Positions are block top-left corners in px.
 */
export function facePorts(blocks: Map<string, MapBlock>, positions: Map<string, { x: number; y: number }>, links: MapLink[]): Map<string, MapBlock> {
  const centre = (id: string) => {
    const b = blocks.get(id)
    const p = positions.get(id)
    return b && p ? { x: p.x / MAP_G + b.w / 2, y: p.y / MAP_G + b.h / 2 } : undefined
  }
  // Far ends of each point's lines.
  const far = new Map<string, { x: number; y: number }[]>()
  const add = (id: string, handle: string, other: string) => {
    const c = centre(other)
    if (!c || other === id) return
    const k = `${id}:${handle}`
    far.set(k, [...(far.get(k) ?? []), c])
  }
  for (const l of links) {
    add(l.source, l.sourceHandle, l.target)
    add(l.target, l.targetHandle, l.source)
  }

  const out = new Map<string, MapBlock>()
  for (const [id, b] of blocks) {
    const c = centre(id)
    const pos = positions.get(id)
    if (!c || !pos) {
      out.set(id, b)
      continue
    }
    const len: Record<Side, number> = { l: b.h, r: b.h, t: b.w, b: b.w }
    const room = (s: Side) => Math.max(1, Math.floor((len[s] - 2 * CORNER[s]) / PORT_PITCH) + 1)
    const all = [...b.ins, ...b.outs, ...(b.powerIn ? [b.powerIn] : []), ...(b.powerOut ? [b.powerOut] : [])]
    // Each point's edges in order of preference, and where along each it would like to sit.
    const wants = all.map((p) => {
      const ends = far.get(`${id}:${p.id}`)
      if (!ends?.length) return { p, sides: [p.side, ...SIDES.filter((s) => s !== p.side)], along: () => p.at, linked: false }
      const t = { x: ends.reduce((a, e) => a + e.x, 0) / ends.length, y: ends.reduce((a, e) => a + e.y, 0) / ends.length }
      const dx = (t.x - c.x) / (b.w / 2)
      const dy = (t.y - c.y) / (b.h / 2)
      const h: Side = dx < 0 ? 'l' : 'r'
      const v: Side = dy < 0 ? 't' : 'b'
      const [first, second] = Math.abs(dx) >= Math.abs(dy) ? [h, v] : [v, h]
      const opposite = (s: Side): Side => ({ l: 'r', r: 'l', t: 'b', b: 't' })[s] as Side
      const along = (s: Side) => (s === 'l' || s === 'r' ? t.y - pos.y / MAP_G : t.x - pos.x / MAP_G)
      return { p, sides: [first, second, opposite(second), opposite(first)], along, linked: true }
    })
    // Linked points pick their edge first; unlinked ones fill in after.
    const onSide = new Map<Side, { p: MapPort; want: number }[]>(SIDES.map((s) => [s, []]))
    for (const w of [...wants].sort((a, z) => Number(z.linked) - Number(a.linked))) {
      const s = w.sides.find((x) => onSide.get(x)!.length < room(x)) ?? w.sides[0]
      onSide.get(s)!.push({ p: w.p, want: w.along(s) })
    }
    const placed = new Map<string, MapPort>()
    for (const s of SIDES) {
      const list = onSide.get(s)!.sort((a, z) => a.want - z.want || a.p.at - z.p.at)
      const lo = Math.min(CORNER[s], len[s] / 2)
      const hi = Math.max(lo, len[s] - CORNER[s])
      const at = list.map((x) => Math.round(Math.min(hi, Math.max(lo, x.want))))
      // Push apart forwards, then back from the far end if that ran past it.
      for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i], at[i - 1] + PORT_PITCH)
      for (let i = at.length - 1; i >= 0; i--) at[i] = Math.min(at[i], i === at.length - 1 ? hi : at[i + 1] - PORT_PITCH)
      list.forEach((x, i) => placed.set(x.p.id, { ...x.p, side: s, at: at[i] }))
    }
    out.set(id, {
      ...b,
      ins: b.ins.map((p) => placed.get(p.id)!),
      outs: b.outs.map((p) => placed.get(p.id)!),
      powerIn: b.powerIn && placed.get(b.powerIn.id),
      powerOut: b.powerOut && placed.get(b.powerOut.id),
    })
  }
  return out
}
