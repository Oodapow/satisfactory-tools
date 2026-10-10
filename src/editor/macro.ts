// The factory map's blocks: where each outpost's connection points sit and how big it is.
// Every exported item has its own export point on the right edge, every import its own
// import point on the left, plus one free import point that a new link fills. Blocks are
// drawn at the size of the outpost's largest floor, on a grid of half foundations.
import { buildingsById } from '../data'
import { gridOf, type PowerGrid } from '../plan/grids'
import { exportsOf, type Solved } from '../plan/network'
import type { ItemId } from '../data'
import type { Transport } from '../plan/types'
import { planLayout, type PortLink } from './layout'
import { MarkerType } from '@xyflow/react'
import { transportColor, type Transport as LinkTransport } from './model'

/** Factory map grid size in px: one cell is half a foundation (4 m). */
export const MAP_G = 16
/** Foundation size in metres, and in grid cells on the map. */
const FOUNDATION_M = 8
const CELLS_PER_FOUNDATION = 2
/** Grid cells between two connection points on the same edge. */
export const PORT_PITCH = 2
/** First connection point's distance from the top edge, in cells. */
const PORT_TOP = 2
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
  /** Cells from the block's top edge. */
  dy: number
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
  const net = solution.power.generatedMW - solution.power.consumedMW
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
  const ins: MapPort[] = plan.imports.map((i, k) => ({ id: inHandleOf(i.id), dy: PORT_TOP + k * PORT_PITCH, item: i.item, perMin: i.perMin, via: i.via }))
  ins.push({ id: NEW_IN, dy: PORT_TOP + ins.length * PORT_PITCH })

  // Everything the outpost exports, plus anything others still import from it after it stopped.
  const rates = new Map(exportsOf(solution).map((e) => [e.item, e.perMin]))
  for (const o of all) for (const i of o.plan.imports) if (i.from === plan.id && !rates.has(i.item)) rates.set(i.item, 0)
  const outs: MapPort[] = [...rates].map(([item, perMin], k) => ({ id: outHandleOf(item), dy: PORT_TOP + k * PORT_PITCH, item, perMin }))

  // Both power points on anything that makes or uses power or has a power line, so a line can start or end at any of them.
  const lined = !!gridOf(grids, plan.id)?.links.some((l) => l.a === plan.id || l.b === plan.id)
  const powered = lined || solution.power.consumedMW > 1e-6 || solution.power.generatedMW > 1e-6
  const powerOut: MapPort | undefined = powered ? { id: POWER_OUT, dy: PORT_TOP + outs.length * PORT_PITCH, perMin: solution.power.generatedMW } : undefined
  const powerIn: MapPort | undefined = powered ? { id: POWER_IN, dy: PORT_TOP + ins.length * PORT_PITCH, perMin: solution.power.consumedMW } : undefined

  const foundations = footprint(s, all, grids, beltTier, pipeTier)
  const points = Math.max(ins.length + (powerIn ? 1 : 0), outs.length + (powerOut ? 1 : 0))
  return {
    ins,
    outs,
    powerIn,
    powerOut,
    w: Math.max(MIN_W, foundations.x * CELLS_PER_FOUNDATION),
    h: Math.max(MIN_H, foundations.y * CELLS_PER_FOUNDATION, PORT_TOP + points * PORT_PITCH),
    foundations,
  }
}

/** Snap a position to the map grid. */
export const snap = (p: { x: number; y: number }) => ({ x: Math.round(p.x / MAP_G) * MAP_G, y: Math.round(p.y / MAP_G) * MAP_G })

/** Small arrowhead at a link's input end, in the link's colour. */
export const linkMarker = (t: LinkTransport) => ({ type: MarkerType.ArrowClosed, width: 14, height: 14, color: transportColor[t], markerUnits: 'userSpaceOnUse', strokeWidth: 1 })
