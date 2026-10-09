// Floor-plan proposal for one outpost: takes the layout decided by layout.ts (floors, lines,
// ports and belts) and places it on the grid as editor blocks.
//
// Floors are stacked bottom to top (the first floor lowest on screen), each line a row of
// machines with a splitter manifold per ingredient above it and a merger manifold per product
// below it. Lines start at the left edge of their floor, so every belt enters and leaves on
// the left, through a gutter where belts climb between floors. Ports sit in a column left of
// the gutter. Where a source feeds several consumers it gets splitters right after it; where a
// consumer takes from several sources it gets mergers right before it. All belts are routed
// later, on the grid (gridRouter.ts).
import { itemsById } from '../data'
import { G, inHandle, outHandle, SIZE, sideDir, SPREAD, type Cell, type Side } from './grid'
import { fmt, planLayout, type End, type LayoutInput, type Line } from './layout'
import { beltTierFor, type BeltEdge, type MicroGraph, type MicroNode } from './model'

export { fmt }
export type { PortLink } from './layout'
export type ProposalInput = LayoutInput

const MACHINE_PITCH = SIZE.machine.w + 2
/** Grid cells between manifold rows, and between joints in a chain. */
const ROW = 4
const FLOOR_GAP = 6
const PORT_GAP = 6

const isFluid = (item: string) => itemsById.get(item)?.form !== 'solid'

/** A belt end: the block and handle, its grid spot and side, and where joints for it go (left of a line's first machine). */
type Endpoint = { node: string; handle: string; at: Cell; side: Side; floor: number; joint?: Cell }

export function proposeLayout(input: ProposalInput): MicroGraph {
  const { maxBeltTier, maxPipeTier = 2 } = input
  const plan = planLayout(input)
  const nodes: MicroNode[] = []
  const edges: BeltEdge[] = []
  const floorOf = new Map<string, number>()
  let seq = 0
  const id = (p: string) => `${p}${++seq}`
  const px = (c: Cell) => ({ x: c.x * G, y: c.y * G })

  const block = (type: 'machine' | 'splitter' | 'merger' | 'port', at: Cell, data: MicroNode['data'], floor: number) => {
    const nid = id(type[0])
    nodes.push({ id: nid, type, position: px(at), data })
    floorOf.set(nid, floor)
    return nid
  }
  const edge = (from: { node: string; handle: string }, to: { node: string; handle: string }, item: string, rate: number) => {
    const fluid = isFluid(item)
    const { tier, over } = beltTierFor(rate, fluid ? maxPipeTier : maxBeltTier, fluid)
    const lift = (floorOf.get(to.node) ?? 0) - (floorOf.get(from.node) ?? 0)
    edges.push({
      id: id('e'),
      type: 'belt',
      source: from.node,
      sourceHandle: from.handle,
      target: to.node,
      targetHandle: to.handle,
      data: { item, perMin: rate, tier, overCapacity: over, lift: lift || undefined },
    })
  }

  // How many belts meet at each end, to leave room for the splitters and mergers there.
  const key = (e: End) => ('port' in e ? `p:${e.port}` : `l:${e.line}:${e.slot}`)
  const fan = new Map<string, number>()
  for (const f of plan.flows) {
    fan.set(`o${key(f.from)}`, (fan.get(`o${key(f.from)}`) ?? 0) + 1)
    fan.set(`i${key(f.to)}`, (fan.get(`i${key(f.to)}`) ?? 0) + 1)
  }
  const jointsFor = (belts: number) => (belts <= 1 ? 0 : Math.ceil((belts - 1) / 2))
  const lineJoints = (l: Line) =>
    Math.max(
      0,
      ...l.ingredients.map((_, s) => jointsFor(fan.get(`il:${l.id}:${s}`) ?? 0)),
      ...l.products.map((_, s) => jointsFor(fan.get(`ol:${l.id}:${s}`) ?? 0)),
    )

  // 1. Floors, top floor first so y grows downwards.
  const items = new Set(plan.flows.map((f) => f.item))
  const maxLineJoints = Math.max(0, ...plan.floors.flatMap((f) => f.lines.map(lineJoints)))
  // Joints for manifold ends sit in the gutter's right edge, in line with their row; belts climb left of them.
  const gutter = 6 + ROW * maxLineJoints + Math.min(80, plan.flows.length + items.size)
  const ends = new Map<string, Endpoint>()
  let y = 0
  const lineHeight = (l: Line) => 2 + ROW * l.ingredients.length + SIZE.machine.h + (l.products.length ? ROW * l.products.length + 2 : 2) + 1
  for (const floor of [...plan.floors].reverse()) {
    const margin = 4
    const top = y
    let lineTop = top + 1
    let width = 0
    for (const l of floor.lines) {
      placeLine(l, margin, lineTop, floor.index)
      width = Math.max(width, margin + l.machines * MACHINE_PITCH)
      lineTop += lineHeight(l)
    }
    const ft = floor.footprint
    nodes.push({
      id: `floor${floor.index}`,
      type: 'floor',
      position: px({ x: -1, y: top }),
      draggable: false,
      selectable: false,
      zIndex: -1,
      data: {
        kind: 'floor',
        floor: floor.index,
        width: (width + 1) * G,
        height: (lineTop - top) * G,
        label: `${floor.label} · about ${floor.foundations.x} × ${floor.foundations.y} foundations, ${Math.ceil(ft.height)} m high`,
      },
    })
    y = lineTop + FLOOR_GAP
  }

  function placeLine(l: Line, margin: number, top: number, floor: number) {
    const a = l.ingredients.length
    const b = l.products.length
    const mt = top + 2 + ROW * a
    const mb = mt + SIZE.machine.h
    const inX = SPREAD[a] ?? []
    const outX = SPREAD[b] ?? []
    const machines = Array.from({ length: l.machines }, (_, i) =>
      block('machine', { x: margin + i * MACHINE_PITCH, y: mt }, { kind: 'machine', building: l.building, recipe: l.recipe, fuel: l.fuel, clock: l.clock, count: 1, floor }, floor),
    )
    const mx = (i: number) => margin + i * MACHINE_PITCH
    const n = l.machines

    // Input manifolds: a splitter above each machine but the last, flowing right.
    l.ingredients.forEach((ing, j) => {
      const row = top + 2 + ROW * j
      const per = ing.perMin / n
      if (n === 1) {
        ends.set(`il:${l.id}:${j}`, { node: machines[0], handle: inHandle(j), at: { x: mx(0) + inX[j], y: mt }, side: 't', floor, joint: { x: -3, y: row } })
        return
      }
      const splitters = machines.slice(0, -1).map((_, i) => block('splitter', { x: mx(i) + inX[j] - 1, y: row - 1 }, { kind: 'splitter', floor }, floor))
      splitters.forEach((s, i) => {
        edge({ node: s, handle: 'down' }, { node: machines[i], handle: inHandle(j) }, ing.item, per)
        const next = splitters[i + 1] ? { node: splitters[i + 1], handle: 'in' } : { node: machines[i + 1], handle: inHandle(j) }
        edge({ node: s, handle: 'out' }, next, ing.item, per * (n - 1 - i))
      })
      ends.set(`il:${l.id}:${j}`, { node: splitters[0], handle: 'in', at: { x: mx(0) + inX[j] - 1, y: row }, side: 'l', floor, joint: { x: -3, y: row } })
    })

    // Output manifolds: a merger below each machine but the last, flowing left.
    l.products.forEach((prod, p) => {
      const row = mb + ROW + ROW * p
      const per = prod.perMin / n
      if (n === 1) {
        ends.set(`ol:${l.id}:${p}`, { node: machines[0], handle: outHandle(p), at: { x: mx(0) + outX[p], y: mb }, side: 'b', floor, joint: { x: -3, y: row } })
        return
      }
      const mergers = machines.slice(0, -1).map((_, i) => block('merger', { x: mx(i) + outX[p] - 1, y: row - 1 }, { kind: 'merger', floor }, floor))
      edge({ node: machines[n - 1], handle: outHandle(p) }, { node: mergers[n - 2], handle: 'in' }, prod.item, per)
      mergers.forEach((m, i) => {
        edge({ node: machines[i], handle: outHandle(p) }, { node: m, handle: 'up' }, prod.item, per)
        if (i > 0) edge({ node: m, handle: 'out' }, { node: mergers[i - 1], handle: 'in' }, prod.item, per * (n - i))
      })
      ends.set(`ol:${l.id}:${p}`, { node: mergers[0], handle: 'out', at: { x: mx(0) + outX[p] - 1, y: row }, side: 'l', floor, joint: { x: -3, y: row } })
    })
  }

  // 2. Ports in a column left of the gutter, below the first floor's level: inputs, then outputs.
  const portJoints = Math.max(0, ...plan.ports.map((p) => jointsFor(fan.get(`${p.direction === 'in' ? 'o' : 'i'}p:${p.id}`) ?? 0)))
  const portX = -gutter - PORT_GAP - ROW * portJoints - SIZE.port.w
  let portY = y
  for (const p of [...plan.ports].sort((a, b) => Number(a.direction === 'out') - Number(b.direction === 'out'))) {
    const { id: pid, ...data } = p
    const at = { x: portX, y: portY }
    const nid = block('port', at, { kind: 'port', ...data }, 0)
    const handle = p.direction === 'in' ? 'out' : 'in'
    ends.set(`${p.direction === 'in' ? 'o' : 'i'}p:${pid}`, { node: nid, handle, at: { x: portX + SIZE.port.w, y: portY + SIZE.port.h / 2 }, side: 'r', floor: 0 })
    portY += SIZE.port.h + 2 + ROW * jointsFor(fan.get(`${p.direction === 'in' ? 'o' : 'i'}p:${pid}`) ?? 0)
  }

  // 3. Belts between ends, with splitters after a source that feeds several consumers and
  // mergers before a consumer fed by several sources.
  const outs = new Map<string, { node: string; handle: string }[]>()
  const ins = new Map<string, { node: string; handle: string }[]>()
  // Joints go just outside the end, in a row along its side (top-left corner of a 2x2 block).
  // Manifold ends put them in the gutter, in line with their row, so belts reach them from its lanes.
  const near = (e: Endpoint, i: number): Cell => {
    if (e.joint) return { x: e.joint.x - ROW * i - 1, y: e.joint.y - 1 }
    const d = sideDir[e.side]
    return { x: e.at.x + d.x * ROW * (i + 1) - 1, y: e.at.y + d.y * ROW * (i + 1) - 1 }
  }
  for (const [k, belts] of fan) {
    const e = ends.get(k)
    if (!e) continue
    const flows = plan.flows.filter((f) => (k[0] === 'o' ? `o${key(f.from)}` : `i${key(f.to)}`) === k)
    const total = flows.reduce((t, f) => t + f.perMin, 0)
    const item = flows[0]?.item ?? ''
    if (belts <= 1) {
      ;(k[0] === 'o' ? outs : ins).set(k, [{ node: e.node, handle: e.handle }])
      continue
    }
    const kind = k[0] === 'o' ? 'splitter' : 'merger'
    const joints = Array.from({ length: jointsFor(belts) }, (_, i) => block(kind, near(e, i), { kind, floor: e.floor }, e.floor))
    const handles: { node: string; handle: string }[] = []
    joints.forEach((j, i) => {
      const last = i === joints.length - 1
      for (const h of last ? (kind === 'splitter' ? ['out', 'up', 'down'] : ['in', 'up', 'down']) : ['up', 'down']) handles.push({ node: j, handle: h })
    })
    // Rates along the chain: what still has to pass each joint.
    let left = total
    joints.forEach((j, i) => {
      const prev = i === 0 ? { node: e.node, handle: e.handle } : { node: joints[i - 1], handle: kind === 'splitter' ? 'out' : 'in' }
      if (kind === 'splitter') edge(prev, { node: j, handle: 'in' }, item, left)
      else edge({ node: j, handle: 'out' }, prev, item, left)
      left -= flows.slice(i * 2, i * 2 + 2).reduce((t, f) => t + f.perMin, 0)
    })
    ;(k[0] === 'o' ? outs : ins).set(k, handles.slice(0, belts))
  }
  // Each flow takes the next free handle at both of its ends.
  const used = new Map<string, number>()
  const next = (m: Map<string, { node: string; handle: string }[]>, k: string) => {
    const i = used.get(k) ?? 0
    used.set(k, i + 1)
    return m.get(k)?.[i]
  }
  for (const f of plan.flows) {
    const a = next(outs, `o${key(f.from)}`)
    const b = next(ins, `i${key(f.to)}`)
    if (a && b) edge(a, b, f.item, f.perMin)
  }

  const notes = [...plan.notes]
  const lines = plan.floors.reduce((n, f) => n + f.lines.length, 0)
  const steps = new Set(plan.floors.flatMap((f) => f.lines.map((l) => l.recipe + l.fuel))).size
  if (lines > steps) notes.push(`Some steps are split into parallel lines because one belt can't carry them (best belt Mk.${maxBeltTier}).`)
  return { nodes, edges, maxBeltTier, maxPipeTier, generatedAt: new Date().toISOString(), notes }
}
