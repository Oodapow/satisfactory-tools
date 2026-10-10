// Floor-plan proposal for one outpost: takes the layout decided by layout.ts (floors, lines,
// ports and belts) and places it on the grid as editor blocks.
//
// Floors are stacked bottom to top (the first floor lowest on screen), each line a row of
// machines with a splitter manifold per ingredient above it and a merger manifold per product
// below it. Lines start at the left edge of their floor, so every belt enters and leaves on
// the left, through a gutter where belts climb between floors. Ports sit in a column left of
// the gutter. Where a source feeds several consumers it gets splitters right after it; where a
// consumer takes from several sources it gets mergers right before it. All belts are routed
// later, on the grid (gridRouter.ts). Fluids get pipes and pipeline junctions instead of belts,
// splitters and mergers. Power lines run on the grid too: a pole right of every machine,
// chained along each line, from the power ports to the generators and machines.
import { itemsById } from '../data'
import { anchors, G, inHandle, outHandle, poleHandle, SIZE, sideDir, SPREAD, type Cell, type Side } from './grid'
import { fmt, planLayout, type End, type LayoutInput, type Line } from './layout'
import { beltTierFor, LAYOUT_VERSION, type BeltEdge, type MicroGraph, type MicroNode } from './model'

export { fmt }
export type { PortLink } from './layout'
export type ProposalInput = LayoutInput

/** Each machine has its pole one cell to its right, then a free grid line for the power line to the next pole. */
const MACHINE_PITCH = SIZE.machine.w + 1 + SIZE.pole.w + 2
/** Grid cells between manifold rows, and between joints in a chain. */
const ROW = 4
const FLOOR_GAP = 6
const EPS = 1e-9
const PORT_GAP = 6

const isFluid = (item: string) => itemsById.get(item)?.form !== 'solid'

/** A belt end: the block and handle, its grid spot and side, and where joints for it go (left of a line's first machine). */
type Endpoint = { node: string; handle: string; at: Cell; side: Side; floor: number; joint?: Cell }

export function proposeLayout(input: ProposalInput): MicroGraph {
  const { maxBeltTier, maxPipeTier = 2, maxPoleTier = 1 } = input
  const plan = planLayout(input)
  const nodes: MicroNode[] = []
  const edges: BeltEdge[] = []
  const floorOf = new Map<string, number>()
  let seq = 0
  const id = (p: string) => `${p}${++seq}`
  const px = (c: Cell) => ({ x: c.x * G, y: c.y * G })

  const block = (type: 'machine' | 'splitter' | 'merger' | 'junction' | 'pole' | 'port', at: Cell, data: MicroNode['data'], floor: number) => {
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
      data: { medium: fluid ? 'fluid' : 'solid', item, perMin: rate, tier, overCapacity: over, lift: lift || undefined },
    })
  }
  /** A fluid splits and joins at pipeline junctions, a solid at splitters and mergers. */
  const joint = (item: string, kind: 'splitter' | 'merger') => (isFluid(item) ? 'junction' : kind)

  // How many belts meet at each end, to leave room for the splitters and mergers there.
  const key = (e: End) => ('port' in e ? `p:${e.port}` : `l:${e.line}:${e.slot}${e.overflow ? ':x' : ''}`)
  /** Surplus leaving through the end of a line's input manifold, by `line:slot`. */
  const overflow = new Map<string, number>()
  for (const f of plan.flows) if ('line' in f.from && f.from.overflow) overflow.set(`${f.from.line}:${f.from.slot}`, (overflow.get(`${f.from.line}:${f.from.slot}`) ?? 0) + f.perMin)
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
  /** What needs a power line, in chain order, with where its pole goes. */
  const powered: { floor: number; clients: { node: string; handle: string; pole: Cell }[] }[] = []
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
    // Generators burn only what the grid draws: the first ones run full, the last one less.
    const genLoad = (i: number) => (l.recipe ? {} : { load: Math.min(1, Math.max(0, l.busy - i)) })
    const machines = Array.from({ length: l.machines }, (_, i) =>
      block('machine', { x: margin + i * MACHINE_PITCH, y: mt }, { kind: 'machine', building: l.building, recipe: l.recipe, fuel: l.fuel, clock: l.clock, count: 1, floor, ...(l.boost !== 1 ? { boost: l.boost } : {}), ...genLoad(i) }, floor),
    )
    const mx = (i: number) => margin + i * MACHINE_PITCH
    const n = l.machines
    powered.push({ floor, clients: machines.map((m, i) => ({ node: m, handle: 'power', pole: { x: mx(i) + SIZE.machine.w + 1, y: mt + SIZE.machine.h / 2 - SIZE.pole.h / 2 } })) })

    // What machine i takes or makes per minute: the first ones run full, the last one idles part of the time.
    const load = (perMin: number) => (i: number) => (l.busy > EPS ? (perMin / l.busy) * Math.min(1, Math.max(0, l.busy - i)) : 0)
    const sum = (f: (i: number) => number, from: number, to = n) => Array.from({ length: Math.max(0, to - from) }, (_, k) => f(from + k)).reduce((t, x) => t + x, 0)

    // Input manifolds: a splitter above each machine but the last, flowing right. When surplus
    // leaves through the end of the manifold, the last machine gets a splitter too and the
    // overflow carries on past it.
    l.ingredients.forEach((ing, j) => {
      const row = top + 2 + ROW * j
      const take = load(ing.perMin)
      const spill = overflow.get(`${l.id}:${j}`) ?? 0
      if (n === 1 && !spill) {
        ends.set(`il:${l.id}:${j}`, { node: machines[0], handle: inHandle(j), at: { x: mx(0) + inX[j], y: mt }, side: 't', floor, joint: { x: -3, y: row } })
        return
      }
      const kind = joint(ing.item, 'splitter')
      const splitters = (spill ? machines : machines.slice(0, -1)).map((_, i) => block(kind, { x: mx(i) + inX[j] - 1, y: row - 1 }, { kind, floor }, floor))
      splitters.forEach((s, i) => {
        edge({ node: s, handle: 'down' }, { node: machines[i], handle: inHandle(j) }, ing.item, take(i))
        if (splitters[i + 1]) edge({ node: s, handle: 'out' }, { node: splitters[i + 1], handle: 'in' }, ing.item, sum(take, i + 1) + spill)
        else if (!spill) edge({ node: s, handle: 'out' }, { node: machines[i + 1], handle: inHandle(j) }, ing.item, take(i + 1))
        else ends.set(`ol:${l.id}:${j}:x`, { node: s, handle: 'out', at: { x: mx(i) + inX[j] + 1, y: row }, side: 'r', floor })
      })
      ends.set(`il:${l.id}:${j}`, { node: splitters[0], handle: 'in', at: { x: mx(0) + inX[j] - 1, y: row }, side: 'l', floor, joint: { x: -3, y: row } })
    })

    // Output manifolds: a merger below each machine but the last, flowing left.
    l.products.forEach((prod, p) => {
      const row = mb + ROW + ROW * p
      const make = load(prod.perMin)
      if (n === 1) {
        ends.set(`ol:${l.id}:${p}`, { node: machines[0], handle: outHandle(p), at: { x: mx(0) + outX[p], y: mb }, side: 'b', floor, joint: { x: -3, y: row } })
        return
      }
      const kind = joint(prod.item, 'merger')
      const mergers = machines.slice(0, -1).map((_, i) => block(kind, { x: mx(i) + outX[p] - 1, y: row - 1 }, { kind, floor }, floor))
      mergers.forEach((m, i) => {
        edge({ node: machines[i], handle: outHandle(p) }, { node: m, handle: 'up' }, prod.item, make(i))
        if (i > 0) edge({ node: m, handle: 'out' }, { node: mergers[i - 1], handle: 'in' }, prod.item, sum(make, i))
      })
      edge({ node: machines[n - 1], handle: outHandle(p) }, { node: mergers[n - 2], handle: 'in' }, prod.item, make(n - 1))
      ends.set(`ol:${l.id}:${p}`, { node: mergers[0], handle: 'out', at: { x: mx(0) + outX[p] - 1, y: row }, side: 'l', floor, joint: { x: -3, y: row } })
    })
  }

  // 2. Ports in a column left of the gutter, below the first floor's level: inputs, then outputs.
  // Power ports and extractors get a pole left of the column.
  const portPower: { node: string; handle: string; pole: Cell }[] = []
  const portJoints = Math.max(0, ...plan.ports.map((p) => jointsFor(fan.get(`${p.direction === 'in' ? 'o' : 'i'}p:${p.id}`) ?? 0)))
  const portX = -gutter - PORT_GAP - ROW * portJoints - SIZE.port.w
  let portY = y
  for (const p of [...plan.ports].sort((a, b) => Number(a.direction === 'out') - Number(b.direction === 'out'))) {
    const { id: pid, ...data } = p
    const at = { x: portX, y: portY }
    const nid = block('port', at, { kind: 'port', ...data }, 0)
    const handle = p.direction === 'in' ? 'out' : 'in'
    const pole = { x: portX - 3 - SIZE.pole.w, y: portY + SIZE.port.h / 2 - SIZE.pole.h / 2 }
    if (p.transport === 'power') portPower.push({ node: nid, handle, pole })
    else if (p.transport === 'resource') portPower.push({ node: nid, handle: 'power', pole })
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
    const splits = k[0] === 'o'
    const kind = joint(item, splits ? 'splitter' : 'merger')
    const joints = Array.from({ length: jointsFor(belts) }, (_, i) => block(kind, near(e, i), { kind, floor: e.floor }, e.floor))
    const handles: { node: string; handle: string }[] = []
    joints.forEach((j, i) => {
      const last = i === joints.length - 1
      for (const h of last ? (splits ? ['out', 'up', 'down'] : ['in', 'up', 'down']) : ['up', 'down']) handles.push({ node: j, handle: h })
    })
    // Rates along the chain: what still has to pass each joint.
    let left = total
    joints.forEach((j, i) => {
      const prev = i === 0 ? { node: e.node, handle: e.handle } : { node: joints[i - 1], handle: splits ? 'out' : 'in' }
      if (splits) edge(prev, { node: j, handle: 'in' }, item, left)
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

  // 4. Power: a pole beside each client (power port, extractor, machine). The ports' poles chain down
  // their column, then a riser climbs through every line's first pole, bottom floor first, and each
  // line's poles chain along it. No pole takes more than four lines, so even a Mk.1 pole does.
  const wire = (pole: { node: string; used: number }, to: { node: string; handle: string }) =>
    edges.push({ id: id('w'), type: 'belt', source: pole.node, sourceHandle: poleHandle(pole.used++), target: to.node, targetHandle: to.handle, data: { medium: 'power' } })
  const pole = (c: { node: string; handle: string; pole: Cell }, floor: number, from?: { node: string; used: number }) => {
    const p = { node: block('pole', c.pole, { kind: 'pole', floor, tier: maxPoleTier }, floor), used: 0 }
    if (from) wire(from, { node: p.node, handle: poleHandle(p.used++) })
    wire(p, c)
    return p
  }
  let riser: { node: string; used: number } | undefined
  for (const c of portPower) riser = pole(c, 0, riser)
  for (const seg of [...powered].sort((a, b) => b.clients[0].pole.y - a.clients[0].pole.y)) {
    if (!seg.clients.length) continue
    riser = pole(seg.clients[0], seg.floor, riser)
    let prev = riser
    for (const c of seg.clients.slice(1)) prev = pole(c, seg.floor, prev)
  }
  nearestHandles(nodes, edges)

  const notes = [...plan.notes]
  const lines = plan.floors.reduce((n, f) => n + f.lines.length, 0)
  const steps = new Set(plan.floors.flatMap((f) => f.lines.map((l) => l.recipe + l.fuel))).size
  if (lines > steps) notes.push(`Some steps are split into parallel lines because one belt can't carry them (best belt Mk.${maxBeltTier}).`)
  return { nodes, edges, maxBeltTier, maxPipeTier, version: LAYOUT_VERSION, generatedAt: new Date().toISOString(), notes }
}

/**
 * Give each pole's power lines the connection points round the pole that face them, so lines don't
 * wrap round the pole. Lines to machines and ports pick first, since those sit right beside it.
 */
function nearestHandles(nodes: MicroNode[], edges: BeltEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const point = (id: string, handle: string | null | undefined) => {
    const n = byId.get(id)!
    // Another pole's points are being reassigned too: aim at its middle.
    const a = n.type === 'pole' ? { dx: SIZE.pole.w / 2, dy: SIZE.pole.h / 2 } : anchors(n.type as 'machine', n.data)[handle ?? '']
    return { x: n.position.x / G + (a?.dx ?? 0), y: n.position.y / G + (a?.dy ?? 0) }
  }
  for (const pole of nodes) {
    if (pole.data.kind !== 'pole') continue
    const a = anchors('pole', pole.data)
    const free = new Set(Object.keys(a))
    const c = { x: pole.position.x / G + SIZE.pole.w / 2, y: pole.position.y / G + SIZE.pole.h / 2 }
    const mine = edges
      .filter((e) => e.source === pole.id || e.target === pole.id)
      .map((e) => {
        const far = e.source === pole.id ? point(e.target, e.targetHandle) : point(e.source, e.sourceHandle)
        const other = byId.get(e.source === pole.id ? e.target : e.source)
        return { e, angle: Math.atan2(far.y - c.y, far.x - c.x), toPole: other?.type === 'pole' }
      })
      .sort((p, q) => Number(p.toPole) - Number(q.toPole))
    for (const { e, angle } of mine) {
      let best = ''
      let bestD = Infinity
      for (const h of free) {
        const t = Math.atan2(a[h].dy - SIZE.pole.h / 2, a[h].dx - SIZE.pole.w / 2) - angle
        const d = Math.abs(Math.atan2(Math.sin(t), Math.cos(t)))
        if (d < bestD) {
          best = h
          bestD = d
        }
      }
      free.delete(best)
      if (e.source === pole.id) e.sourceHandle = best
      else e.targetHandle = best
    }
  }
}
