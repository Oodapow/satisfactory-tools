// The factory map's blocks: where each outpost's connection points sit and how big it is.
// Every exported item has its own export point on the right edge, every import its own
// import point on the left, plus one free import point that a new link fills. Blocks are
// drawn at the size of the outpost's largest floor, on a grid of half foundations.
import { buildingsById } from '../data'
import { exportsOf, type Solved } from '../plan/network'
import type { ItemId } from '../data'
import type { Transport } from '../plan/types'
import { planLayout, type PortLink } from './layout'
import type { EditorLayout } from './model'

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
  /** Power in below the import points, power out below the export points. */
  powerIn?: MapPort
  powerOut?: MapPort
  /** Size in cells. */
  w: number
  h: number
  /** The largest floor (or the extractors), in foundations. */
  foundations: { x: number; y: number }
}

/** The links touching one outpost, as its floor plan needs them. */
export function portLinks(all: Solved[], layout: Pick<EditorLayout, 'powerLines'>, id: string) {
  const name = (pid: string) => all.find((s) => s.plan.id === pid)?.plan.name ?? '?'
  const plan = all.find((s) => s.plan.id === id)!.plan
  const incoming: PortLink[] = [
    ...plan.imports.map((i) => ({ linkId: i.id, other: name(i.from), transport: i.via, item: i.item, perMin: i.perMin })),
    ...layout.powerLines.filter((l) => l.to === id).map((l) => ({ linkId: l.id, other: name(l.from), transport: 'power' as const, perMin: 0, powerMW: l.mw })),
  ]
  const outgoing: PortLink[] = [
    ...all.flatMap((s) =>
      s.plan.imports.filter((i) => i.from === id).map((i) => ({ linkId: i.id, other: s.plan.name, transport: i.via, item: i.item, perMin: i.perMin })),
    ),
    ...layout.powerLines.filter((l) => l.from === id).map((l) => ({ linkId: l.id, other: name(l.to), transport: 'power' as const, perMin: 0, powerMW: l.mw })),
  ]
  return { incoming, outgoing }
}

/** Ground footprint in foundations: the largest floor of the proposed layout, or the extractors side by side. */
export function footprint(s: Solved, all: Solved[], layout: Pick<EditorLayout, 'powerLines'>, beltTier: number, pipeTier: number) {
  let x = 0
  let y = 0
  if (s.solution.steps.length || s.solution.generators.length) {
    for (const f of planLayout({ solved: s, ...portLinks(all, layout, s.plan.id), maxBeltTier: beltTier, maxPipeTier: pipeTier }).floors) {
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
export function mapBlock(s: Solved, all: Solved[], layout: Pick<EditorLayout, 'powerLines'>, beltTier: number, pipeTier: number): MapBlock {
  const { plan, solution } = s
  const ins: MapPort[] = plan.imports.map((i, k) => ({ id: inHandleOf(i.id), dy: PORT_TOP + k * PORT_PITCH, item: i.item, perMin: i.perMin, via: i.via }))
  ins.push({ id: NEW_IN, dy: PORT_TOP + ins.length * PORT_PITCH })

  // Everything the outpost exports, plus anything others still import from it after it stopped.
  const rates = new Map(exportsOf(solution).map((e) => [e.item, e.perMin]))
  for (const o of all) for (const i of o.plan.imports) if (i.from === plan.id && !rates.has(i.item)) rates.set(i.item, 0)
  const outs: MapPort[] = [...rates].map(([item, perMin], k) => ({ id: outHandleOf(item), dy: PORT_TOP + k * PORT_PITCH, item, perMin }))

  const sentMW = layout.powerLines.filter((l) => l.from === plan.id).reduce((t, l) => t + l.mw, 0)
  const gotMW = layout.powerLines.filter((l) => l.to === plan.id).reduce((t, l) => t + l.mw, 0)
  const powerOut: MapPort | undefined =
    solution.power.exportedMW > 1e-6 || sentMW > 0 ? { id: POWER_OUT, dy: PORT_TOP + outs.length * PORT_PITCH, perMin: Math.max(solution.power.exportedMW, sentMW) } : undefined
  const powerIn: MapPort | undefined =
    solution.power.consumedMW > 1e-6 || gotMW > 0 ? { id: POWER_IN, dy: PORT_TOP + ins.length * PORT_PITCH, perMin: gotMW } : undefined

  const foundations = footprint(s, all, layout, beltTier, pipeTier)
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
