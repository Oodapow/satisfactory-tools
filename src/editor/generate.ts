// Floor-plan proposal for one outpost: takes the layout decided by layout.ts (floors, lines,
// ports and belts) and places it on the grid as editor blocks.
//
// Everything flows left to right (#88): raw inputs come in from a column of ports on the
// left, floors follow one another left to right from the first, and products leave through a
// column of ports on the right. Each line is a column of machines, turned so their inputs face
// left and their outputs right, with a splitter manifold per ingredient left of it and a
// merger manifold per product right of it. Lines start at the top edge of their floor, so
// every belt enters and leaves at the top, through a gutter above the floors where belts run
// across to the next floor. Where a source feeds several consumers it gets splitters right
// after it; where a consumer takes from several sources it gets mergers right before it. All
// belts are routed later, on the grid (gridRouter.ts). Fluids get pipes and pipeline junctions
// instead of belts, splitters and mergers. Power lines run on the grid too: a pole above every
// machine, chained along each line, from the power ports to the generators and machines.
//
// Lines are worked out lying down (machines in a row, inputs above, outputs below) and stood up
// by swapping x and y, which turns each machine a quarter anticlockwise.
import { itemsById } from '../data'
import { anchors, facePoles, G, type Rot, inHandle, outHandle, poleHandle, machineSize, SIZE, sideDir, type Cell, type Side } from './grid'
import { fmt, planLayout, type End, type LayoutInput, type Line } from './layout'
import { beltTierFor, LAYOUT_VERSION, type BeltEdge, type MicroGraph, type MicroNode } from './model'

export { fmt }
export type { PortLink } from './layout'
export type ProposalInput = LayoutInput

/** Each machine has its pole one cell before it, and a free grid line for the power line from the last machine. */
const pitch = (building: string) => machineSize(building).w + 1 + SIZE.pole.w + 2
/** Grid cells between manifold rows, and between joints in a chain. */
const ROW = 4
const FLOOR_GAP = 6
const EPS = 1e-9
const PORT_GAP = 6
/** Machines stand turned a quarter anticlockwise: inputs on the left, outputs on the right. */
const ROT: Rot = 3

/** Pole points on its right and left sides. */
const POLE_RIGHT = poleHandle(1)
const POLE_LEFT = poleHandle(3)

const flip = (c: Cell): Cell => ({ x: c.y, y: c.x })
const flipSide: Record<Side, Side> = { l: 't', t: 'l', r: 'b', b: 'r' }

const isFluid = (item: string) => itemsById.get(item)?.form !== 'solid'

/** A belt end: the block and handle, its grid spot and side, and where joints for it go (in the gutter above its line, stepping up). */
type Endpoint = { node: string; handle: string; at: Cell; side: Side; floor: number; joint?: Cell; jointDir?: Cell }

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
  /** A block on a line, given where it goes lying down. */
  const stood = (type: 'machine' | 'splitter' | 'merger' | 'junction', at: Cell, data: MicroNode['data'], floor: number) => block(type, flip(at), data, floor)
  /** A belt end on a line, given lying down. */
  const lineEnd = (k: string, e: Endpoint) =>
    ends.set(k, { ...e, at: flip(e.at), side: flipSide[e.side], joint: e.joint && flip(e.joint), jointDir: e.joint && { x: 0, y: -1 } })
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

  // 1. Floors, first floor first so they run left to right (lying down: top to bottom).
  const maxLineJoints = Math.max(0, ...plan.floors.flatMap((f) => f.lines.map(lineJoints)))
  const ends = new Map<string, Endpoint>()
  /** What needs a power line, in chain order, with where its pole goes. */
  const powered: { floor: number; clients: { node: string; handle: string; pole: Cell }[] }[] = []
  let y = 0
  const lineHeight = (l: Line) => 2 + ROW * l.ingredients.length + machineSize(l.building).h + (l.products.length ? ROW * l.products.length + 2 : 2) + 1
  for (const floor of plan.floors) {
    const margin = 6
    const top = y
    let lineTop = top + 1
    let width = 0
    for (const l of floor.lines) {
      placeLine(l, margin, lineTop, floor.index)
      width = Math.max(width, margin + l.machines * pitch(l.building))
      lineTop += lineHeight(l)
    }
    const ft = floor.footprint
    nodes.push({
      id: `floor${floor.index}`,
      type: 'floor',
      position: px(flip({ x: -1, y: top })),
      draggable: false,
      selectable: false,
      zIndex: -1,
      data: {
        kind: 'floor',
        floor: floor.index,
        width: (lineTop - top) * G,
        height: (width + 1) * G,
        label: `${floor.label} · about ${floor.foundations.x} × ${floor.foundations.y} foundations, ${Math.ceil(ft.height)} m high`,
      },
    })
    y = lineTop + FLOOR_GAP
  }

  function placeLine(l: Line, margin: number, top: number, floor: number) {
    const a = l.ingredients.length
    const b = l.products.length
    const mt = top + 2 + ROW * a
    const size = machineSize(l.building)
    const mb = mt + size.h
    // Connection points of a standing machine, lying down.
    const at = anchors('machine', { kind: 'machine', building: l.building, recipe: l.recipe, fuel: l.fuel, clock: 1, count: 1, floor, rot: ROT })
    const inX = Array.from({ length: a }, (_, j) => at[inHandle(j)].dy)
    const outX = Array.from({ length: b }, (_, p) => at[outHandle(p)].dy)
    const powerY = at.power?.dx ?? Math.floor(size.h / 2)
    const mx = (i: number) => margin + i * pitch(l.building) + SIZE.pole.w + 1
    // Generators burn only what the grid draws: the first ones run full, the last one less.
    const genLoad = (i: number) => (l.recipe ? {} : { load: Math.min(1, Math.max(0, l.busy - i)) })
    const machines = Array.from({ length: l.machines }, (_, i) =>
      stood('machine', { x: mx(i), y: mt }, { kind: 'machine', building: l.building, recipe: l.recipe, fuel: l.fuel, clock: l.clock, count: 1, floor, rot: ROT, ...(l.boost !== 1 ? { boost: l.boost } : {}), ...genLoad(i) }, floor),
    )
    const n = l.machines
    powered.push({ floor, clients: machines.map((m, i) => ({ node: m, handle: 'power', pole: flip({ x: mx(i) - 1 - SIZE.pole.w, y: mt + powerY - SIZE.pole.h / 2 }) })) })

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
        lineEnd(`il:${l.id}:${j}`, { node: machines[0], handle: inHandle(j), at: { x: mx(0) + inX[j], y: mt }, side: 't', floor, joint: { x: -3, y: row } })
        return
      }
      const kind = joint(ing.item, 'splitter')
      const splitters = (spill ? machines : machines.slice(0, -1)).map((_, i) => stood(kind, { x: mx(i) + inX[j] - 1, y: row - 1 }, { kind, floor }, floor))
      splitters.forEach((s, i) => {
        edge({ node: s, handle: 'down' }, { node: machines[i], handle: inHandle(j) }, ing.item, take(i))
        if (splitters[i + 1]) edge({ node: s, handle: 'out' }, { node: splitters[i + 1], handle: 'in' }, ing.item, sum(take, i + 1) + spill)
        else if (!spill) edge({ node: s, handle: 'out' }, { node: machines[i + 1], handle: inHandle(j) }, ing.item, take(i + 1))
        else lineEnd(`ol:${l.id}:${j}:x`, { node: s, handle: 'out', at: { x: mx(i) + inX[j] + 1, y: row }, side: 'r', floor })
      })
      lineEnd(`il:${l.id}:${j}`, { node: splitters[0], handle: 'in', at: { x: mx(0) + inX[j] - 1, y: row }, side: 'l', floor, joint: { x: -3, y: row } })
    })

    // Output manifolds: a merger below each machine but the last, flowing left.
    l.products.forEach((prod, p) => {
      const row = mb + ROW + ROW * p
      const make = load(prod.perMin)
      if (n === 1) {
        lineEnd(`ol:${l.id}:${p}`, { node: machines[0], handle: outHandle(p), at: { x: mx(0) + outX[p], y: mb }, side: 'b', floor, joint: { x: -3, y: row } })
        return
      }
      const kind = joint(prod.item, 'merger')
      const mergers = machines.slice(0, -1).map((_, i) => stood(kind, { x: mx(i) + outX[p] - 1, y: row - 1 }, { kind, floor }, floor))
      mergers.forEach((m, i) => {
        edge({ node: machines[i], handle: outHandle(p) }, { node: m, handle: 'up' }, prod.item, make(i))
        if (i > 0) edge({ node: m, handle: 'out' }, { node: mergers[i - 1], handle: 'in' }, prod.item, sum(make, i))
      })
      edge({ node: machines[n - 1], handle: outHandle(p) }, { node: mergers[n - 2], handle: 'in' }, prod.item, make(n - 1))
      lineEnd(`ol:${l.id}:${p}`, { node: mergers[0], handle: 'out', at: { x: mx(0) + outX[p] - 1, y: row }, side: 'l', floor, joint: { x: -3, y: row } })
    })
  }

  // 2. Ports in two columns: what comes in on the left of the first floor, what goes out on the
  // right of the last. Both sit level with the gutter, so each port's belt runs straight along
  // its own lane; the port whose belt goes furthest gets the lane furthest up, so lanes don't
  // cross. Power ports go in the left column below the gutter. Power ports and extractors get a
  // pole left of the column.
  const portPower: { node: string; handle: string; pole: Cell }[] = []
  const portKey = (p: { id: string; direction: 'in' | 'out' }) => `${p.direction === 'in' ? 'o' : 'i'}p:${p.id}`
  /** How far right a port's belts reach into the floors. */
  const reach = (p: (typeof plan.ports)[number]) => {
    const xs = plan.flows.flatMap((f) => {
      const far = 'port' in f.from && f.from.port === p.id ? ends.get(`i${key(f.to)}`) : 'port' in f.to && f.to.port === p.id ? ends.get(`o${key(f.from)}`) : undefined
      return far ? [far.at.x] : []
    })
    return p.direction === 'in' ? Math.min(Infinity, ...xs) : Math.max(-Infinity, ...xs)
  }
  // Lanes between the floors and the ports' lanes for belts from floor to floor.
  const between = plan.flows.filter((f) => 'line' in f.from && 'line' in f.to).length
  const gutterBottom = -2 - ROW * (maxLineJoints + 1) - Math.min(40, between)
  const column = (ports: typeof plan.ports, side: 'l' | 'r', up: boolean) => {
    const joints = Math.max(0, ...ports.map((p) => jointsFor(fan.get(portKey(p)) ?? 0)))
    const gap = PORT_GAP + ROW * joints
    const portX = side === 'l' ? -1 - gap - SIZE.port.w : y + gap
    let portY = up ? gutterBottom : 0
    for (const p of ports) {
      const room = SIZE.port.h + 2 + ROW * jointsFor(fan.get(portKey(p)) ?? 0)
      if (up) portY -= room
      const { id: _pid, ...data } = p
      const nid = block('port', { x: portX, y: portY }, { kind: 'port', ...data }, 0)
      const handle = p.direction === 'in' ? 'out' : 'in'
      const pole = { x: portX - 3 - SIZE.pole.w, y: portY + SIZE.port.h / 2 - SIZE.pole.h / 2 }
      if (p.transport === 'power') portPower.push({ node: nid, handle, pole })
      else if (p.transport === 'resource') portPower.push({ node: nid, handle: 'power', pole })
      const at = { x: side === 'l' ? portX + SIZE.port.w : portX, y: portY + SIZE.port.h / 2 }
      ends.set(portKey(p), { node: nid, handle, at, side: side === 'l' ? 'r' : 'l', floor: 0 })
      if (!up) portY += room
    }
  }
  const itemPorts = plan.ports.filter((p) => p.transport !== 'power')
  // Nearest first, stacking up from the floors.
  column(itemPorts.filter((p) => p.direction === 'in').sort((a, b) => reach(a) - reach(b)), 'l', true)
  column(itemPorts.filter((p) => p.direction === 'out').sort((a, b) => reach(b) - reach(a)), 'r', true)
  column(plan.ports.filter((p) => p.transport === 'power'), 'l', false)

  // 3. Belts between ends, with splitters after a source that feeds several consumers and
  // mergers before a consumer fed by several sources.
  const outs = new Map<string, { node: string; handle: string }[]>()
  const ins = new Map<string, { node: string; handle: string }[]>()
  // Joints go just outside the end, in a row along its side (top-left corner of a 2x2 block).
  // Manifold ends put them in the gutter, in line with their manifold, so belts reach them from its lanes.
  const near = (e: Endpoint, i: number): Cell => {
    if (e.joint && e.jointDir) return { x: e.joint.x + e.jointDir.x * ROW * i - 1, y: e.joint.y + e.jointDir.y * ROW * i - 1 }
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
  // their column, then a riser runs through every line's first pole, first floor first, and each
  // line's poles chain along it. No pole takes more than four lines, so even a Mk.1 pole does.
  const wire = (pole: { node: string; used: number }, to: { node: string; handle: string }) =>
    edges.push({ id: id('w'), type: 'belt', source: pole.node, sourceHandle: poleHandle(pole.used++), target: to.node, targetHandle: to.handle, data: { medium: 'power' } })
  const pole = (c: { node: string; handle: string; pole: Cell }, floor: number, from?: { node: string; used: number }) => {
    const p = { node: block('pole', c.pole, { kind: 'pole', floor, tier: maxPoleTier }, floor), used: 0 }
    if (from) wire(from, { node: p.node, handle: poleHandle(p.used++) })
    wire(p, c)
    return p
  }
  /** Pole points chosen up front, by line id and end. */
  const fixed = new Map<string, { source?: string; target?: string }>()
  let riser: { node: string; used: number } | undefined
  for (const c of portPower) riser = pole(c, 0, riser)
  for (const seg of [...powered].sort((a, b) => a.clients[0].pole.x - b.clients[0].pole.x || a.clients[0].pole.y - b.clients[0].pole.y)) {
    if (!seg.clients.length) continue
    riser = pole(seg.clients[0], seg.floor, riser)
    let prev = riser
    // Down a line, each pole's line to the next runs past a machine on alternate sides: in on one
    // side, out on the other, so it bends twice instead of three times.
    seg.clients.slice(1).forEach((c, k) => {
      prev = pole(c, seg.floor, prev)
      const side = k % 2 ? POLE_RIGHT : POLE_LEFT
      fixed.set(edges[edges.length - 2].id, k ? { source: side, target: side } : { target: side })
    })
  }
  facePoles(nodes, edges, fixed)

  const notes = [...plan.notes]
  const lines = plan.floors.reduce((n, f) => n + f.lines.length, 0)
  const steps = new Set(plan.floors.flatMap((f) => f.lines.map((l) => l.recipe + l.fuel))).size
  if (lines > steps) notes.push(`Some steps are split into parallel lines because one belt can't carry them (best belt Mk.${maxBeltTier}).`)
  return { nodes, edges, maxBeltTier, maxPipeTier, version: LAYOUT_VERSION, generatedAt: new Date().toISOString(), notes }
}
