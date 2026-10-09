// Placeholder floor-plan proposal for one outpost. It takes the plan's solution
// (machines, generators, extraction from src/plan/solve.ts) and lays it out: one
// floor per recipe, raw processing at the bottom and the goal at the top, machines
// fed by a splitter manifold and collected by a merger manifold, belts sized to the
// best allowed tier, and a port for every import, export, power line and resource
// node. Belts between floors run up shared lanes beside the building, with a
// conveyor lift where they change floor. The real layout optimiser is tracked separately (#13); this exists so the
// editor has something plausible to render and edit.
import { buildingsById, itemName, itemsById, recipesById } from '../data'
import type { Solved } from '../plan/network'
import { perMin } from '../plan/solve'
import { beltTierFor, type BeltEdge, type ItemRate, type MicroGraph, type MicroNode, type PortData, type Transport } from './model'

const EPS = 1e-6

export const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) : n.toFixed(1))

/** A link touching this outpost on the factory map, as the floor plan needs it. */
export type PortLink = {
  linkId: string
  /** The outpost at the other end. */
  other: string
  transport: Transport
  item?: string
  perMin: number
  powerMW?: number
}

export type ProposalInput = {
  solved: Solved
  /** Imports into this outpost and power lines arriving. */
  incoming: PortLink[]
  /** Other outposts' imports from this one and power lines leaving. */
  outgoing: PortLink[]
  maxBeltTier: number
}

type Floor = {
  label: string
  building: string
  recipe: string
  fuel?: string
  machines: number
  ingredients: ItemRate[]
  products: ItemRate[]
  level: number
}
type Endpoint = { node: string; handle: string }

const isFluid = (item: string) => itemsById.get(item)?.form !== 'solid'

// Layout constants (px).
const MACHINE_DX = 200
const ROW = 56
const FLOOR_GAP = 60
const PORT_X = -700
/** Vertical lanes left of the floors, one per item, where belts climb between floors. */
const LANE_X = -70
const LANE_DX = 18

export function proposeLayout({ solved, incoming, outgoing, maxBeltTier }: ProposalInput): MicroGraph {
  const { plan, solution } = solved
  const notes: string[] = []
  const nodes: MicroNode[] = []
  const edges: BeltEdge[] = []
  let seq = 0
  const id = (p: string) => `${p}${++seq}`

  // 1. Floors from the solution: production steps and generators.
  const floors: Floor[] = solution.steps.map((s) => {
    const r = recipesById.get(s.recipe)!
    return {
      label: r.name,
      building: s.building,
      recipe: s.recipe,
      machines: s.machines,
      ingredients: r.ingredients.map((i) => ({ item: i.item, perMin: perMin(i.amount, r) * s.machines })),
      products: r.products.map((p) => ({ item: p.item, perMin: perMin(p.amount, r) * s.machines })),
      level: 0,
    }
  })
  for (const g of solution.generators) {
    const b = buildingsById.get(g.generator)
    const fuel = itemsById.get(g.fuel)
    const ingredients: ItemRate[] = []
    if (fuel?.energyMJ) ingredients.push({ item: g.fuel, perMin: (g.mw * 60) / fuel.energyMJ })
    const spec = b?.generator?.fuels.find((f) => f.fuel === g.fuel)
    if (spec?.supplemental && b?.generator?.supplementalPerMJ)
      ingredients.push({ item: spec.supplemental, perMin: g.mw * 60 * b.generator.supplementalPerMJ })
    floors.push({ label: `${fmt(g.mw)} MW from ${itemName(g.fuel)}`, building: g.generator, recipe: '', fuel: g.fuel, machines: g.machines, ingredients, products: [], level: 0 })
  }

  // Raw processing at the bottom: a floor sits one above the highest floor feeding it.
  const producer = new Map<string, Floor>()
  for (const f of floors) for (const p of f.products) if (!producer.has(p.item)) producer.set(p.item, f)
  const levels = new Map<Floor, number>()
  const levelOf = (f: Floor, stack = new Set<Floor>()): number => {
    if (levels.has(f)) return levels.get(f)!
    if (stack.has(f)) return 0
    stack.add(f)
    const below = f.ingredients.map((i) => producer.get(i.item)).filter((p): p is Floor => !!p && p !== f)
    const level = below.length ? 1 + Math.max(...below.map((p) => levelOf(p, stack))) : 0
    levels.set(f, level)
    return level
  }
  floors.forEach((f) => (f.level = levelOf(f)))
  floors.sort((a, b) => a.level - b.level || a.label.localeCompare(b.label))

  // Sources and consumers per item, wired together at the end.
  const sources = new Map<string, { at: Endpoint; perMin: number }[]>()
  const consumers = new Map<string, { at: Endpoint; perMin: number; y: number }[]>()
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => (m.get(k) ?? m.set(k, []).get(k)!).push(v)
  // Floor of every node, to know where a belt needs a conveyor lift. Ports and hubs are on the ground.
  const floorOf = new Map<string, number>()
  const lanes = new Map<string, number>()
  const laneFor = (item: string) => lanes.get(item) ?? lanes.set(item, LANE_X - lanes.size * LANE_DX).get(item)!
  const edge = (from: Endpoint, to: Endpoint, item: string, rate: number, viaLane = false) => {
    const fluid = isFluid(item)
    const { tier, over } = beltTierFor(rate, fluid ? 2 : maxBeltTier, fluid)
    const lift = (floorOf.get(to.node) ?? 0) - (floorOf.get(from.node) ?? 0)
    edges.push({
      id: id('e'),
      type: 'belt',
      source: from.node,
      sourceHandle: from.handle,
      target: to.node,
      targetHandle: to.handle,
      data: { item, perMin: rate, tier, overCapacity: over, lift: lift || undefined, laneX: viaLane ? laneFor(item) : undefined },
    })
  }

  // 2. Floors, stacked bottom to top. Each floor: a splitter row per ingredient feeding the
  // machines from the left, the machines, and a merger row per product collecting to the left.
  const layouts = floors.map((f) => {
    const n = Math.max(1, Math.ceil(f.machines - EPS))
    const blocks = n > 12 ? 1 : n
    const height = 40 + f.ingredients.length * ROW + 90 + Math.max(1, f.products.length) * ROW + 20
    return { f, n, blocks, height, width: 120 + blocks * MACHINE_DX }
  })
  const width = Math.max(700, ...layouts.map((l) => l.width))
  const groundY = layouts.reduce((h, l) => h + l.height + FLOOR_GAP, 0)
  let top = groundY
  layouts.forEach(({ f, n, blocks, height }, index) => {
    top -= height + FLOOR_GAP
    const machineName = buildingsById.get(f.building)?.name ?? f.building
    nodes.push({
      id: `floor${index}`,
      type: 'floor',
      position: { x: -40, y: top },
      draggable: false,
      selectable: false,
      zIndex: -1,
      data: {
        kind: 'floor',
        floor: index,
        width: width + 40,
        height,
        label: `Floor ${index + 1} · ${f.label} · ${n} ${machineName}${n === 1 ? '' : 's'}`,
      },
    })
    const machineY = top + 40 + f.ingredients.length * ROW + 10
    const clock = f.machines / n
    const machines: string[] = []
    // Joints sit centred over or under the machine they serve (machine blocks are 180 wide).
    const jointX = (i: number, row: number) => 40 + i * MACHINE_DX + 90 - 20 + row * 44
    for (let i = 0; i < blocks; i++) {
      const mid = id('m')
      machines.push(mid)
      floorOf.set(mid, index)
      nodes.push({
        id: mid,
        type: 'machine',
        position: { x: 40 + i * MACHINE_DX, y: machineY },
        data: { kind: 'machine', building: f.building, recipe: f.recipe, fuel: f.fuel, clock, count: blocks === 1 ? n : 1, floor: index },
      })
    }

    // Input manifolds, one row per ingredient, flowing right.
    f.ingredients.forEach((ing, j) => {
      const y = top + 40 + j * ROW
      if (blocks === 1) {
        push(consumers, ing.item, { at: { node: machines[0], handle: 'in' }, perMin: ing.perMin, y })
        return
      }
      const splitters = machines.slice(0, -1).map((_, i) => {
        const sid = id('s')
        floorOf.set(sid, index)
        nodes.push({ id: sid, type: 'splitter', position: { x: jointX(i, j), y }, data: { kind: 'splitter', floor: index, facing: 'right' } })
        return sid
      })
      push(consumers, ing.item, { at: { node: splitters[0], handle: 'in' }, perMin: ing.perMin, y })
      splitters.forEach((sid, i) => {
        edge({ node: sid, handle: 'down' }, { node: machines[i], handle: 'in' }, ing.item, ing.perMin / blocks)
        const left = (ing.perMin * (blocks - 1 - i)) / blocks
        const next = splitters[i + 1] ? { node: splitters[i + 1], handle: 'in' } : { node: machines[i + 1], handle: 'in' }
        edge({ node: sid, handle: 'out' }, next, ing.item, left)
      })
    })

    // Output manifolds, one row per product, flowing left towards the lanes.
    f.products.forEach((prod, p) => {
      const y = machineY + 100 + p * ROW
      if (blocks === 1) {
        push(sources, prod.item, { at: { node: machines[0], handle: 'out' }, perMin: prod.perMin })
        return
      }
      const mergers = machines.slice(0, -1).map((_, i) => {
        const gid = id('g')
        floorOf.set(gid, index)
        nodes.push({ id: gid, type: 'merger', position: { x: jointX(i, p), y }, data: { kind: 'merger', floor: index, facing: 'left' } })
        return gid
      })
      // The last machine joins the chain from the right; every other drops into the merger below it.
      edge({ node: machines[blocks - 1], handle: 'out' }, { node: mergers[blocks - 2], handle: 'in' }, prod.item, prod.perMin / blocks)
      mergers.forEach((gid, i) => {
        edge({ node: machines[i], handle: 'out' }, { node: gid, handle: 'up' }, prod.item, prod.perMin / blocks)
        if (i > 0) edge({ node: gid, handle: 'out' }, { node: mergers[i - 1], handle: 'in' }, prod.item, (prod.perMin * (blocks - i)) / blocks)
      })
      push(sources, prod.item, { at: { node: mergers[0], handle: 'out' }, perMin: prod.perMin })
    })
  })

  // 3. Ports on the ground, below the floors: resource nodes and imports on the left,
  // exports and power on the right.
  let inY = groundY + 20
  let outY = groundY + 20
  const OUT_X = width + 160
  const port = (data: Omit<PortData, 'kind'>) => {
    const pid = id('p')
    const isIn = data.direction === 'in'
    floorOf.set(pid, 0)
    nodes.push({ id: pid, type: 'port', position: { x: isIn ? PORT_X : OUT_X, y: isIn ? inY : outY }, data: { kind: 'port', ...data } })
    if (isIn) inY += 90
    else outY += 90
    return pid
  }

  for (const x of solution.extraction) {
    const node = plan.nodes.find((n) => n.id === x.node)
    const what = node
      ? `${node.purity[0].toUpperCase()}${node.purity.slice(1)} node`
      : `${fmt(x.machines)} × ${buildingsById.get(x.extractor)?.name ?? 'extractor'}`
    const pid = port({ direction: 'in', transport: 'resource', item: x.resource, perMin: x.perMin, label: what, extractor: x.extractor })
    push(sources, x.resource, { at: { node: pid, handle: 'out' }, perMin: x.perMin })
  }
  for (const l of incoming) {
    const pid = port({ direction: 'in', transport: l.transport, item: l.item, perMin: l.perMin, powerMW: l.powerMW, label: l.other, linkId: l.linkId })
    if (l.item) push(sources, l.item, { at: { node: pid, handle: 'out' }, perMin: l.perMin })
  }

  // Exports: what other outposts take, then the rest as the goal or surplus.
  const goals = new Set(plan.goals.flatMap((g) => (g.kind === 'item' ? [g.item] : [])))
  for (const f of solution.flows.values()) {
    if (f.exported <= EPS) continue
    let left = f.exported
    for (const l of outgoing.filter((o) => o.item === f.item)) {
      const take = Math.min(left, l.perMin)
      if (l.perMin > left + EPS)
        notes.push(`${l.other} imports ${fmt(l.perMin)} ${itemName(f.item)}/min, but this outpost only has ${fmt(left)}/min to spare.`)
      left -= take
      const y = outY
      const pid = port({ direction: 'out', transport: l.transport, item: f.item, perMin: take, label: l.other, linkId: l.linkId })
      if (take > EPS) push(consumers, f.item, { at: { node: pid, handle: 'in' }, perMin: take, y })
    }
    if (left > EPS) {
      const y = outY
      const pid = port({
        direction: 'out',
        transport: isFluid(f.item) ? 'pipe' : 'belt',
        item: f.item,
        perMin: left,
        label: goals.has(f.item) ? 'Goal' : 'Surplus',
      })
      push(consumers, f.item, { at: { node: pid, handle: 'in' }, perMin: left, y })
    }
  }
  for (const l of outgoing.filter((o) => o.transport === 'power'))
    port({ direction: 'out', transport: 'power', perMin: 0, powerMW: l.powerMW, label: l.other, linkId: l.linkId })
  if (solution.power.exportedMW > EPS && !outgoing.some((o) => o.transport === 'power'))
    port({ direction: 'out', transport: 'power', perMin: 0, powerMW: solution.power.exportedMW, label: 'Grid' })

  for (const f of solution.flows.values())
    if (f.shortfall > EPS) notes.push(`Short ${fmt(f.shortfall)} ${itemName(f.item)}/min: add a resource node, an import or an unlocked recipe.`)

  // 4. Wire each item's sources to its consumers along the item's lane, through a merger
  // and/or splitter on the ground when several meet.
  for (const [item, cons] of consumers) {
    const srcs = sources.get(item) ?? []
    if (!srcs.length) continue
    const total = cons.reduce((t, c) => t + c.perMin, 0)
    const laneX = laneFor(item)
    let from: Endpoint
    let hubY = groundY + 20 + 90 * Math.max(0, [...lanes.keys()].indexOf(item))
    if (srcs.length === 1) from = srcs[0].at
    else {
      const gid = id('g')
      floorOf.set(gid, 0)
      nodes.push({ id: gid, type: 'merger', position: { x: laneX - 20, y: hubY }, data: { kind: 'merger', floor: -1, facing: 'right' } })
      for (const s of srcs) edge(s.at, { node: gid, handle: 'down' }, item, s.perMin, true)
      from = { node: gid, handle: 'out' }
      hubY += 50
    }
    if (cons.length === 1) {
      edge(from, cons[0].at, item, total, true)
      continue
    }
    const sid = id('s')
    floorOf.set(sid, 0)
    nodes.push({ id: sid, type: 'splitter', position: { x: laneX - 20 + 60, y: hubY }, data: { kind: 'splitter', floor: -1, facing: 'right' } })
    edge(from, { node: sid, handle: 'in' }, item, total)
    for (const c of cons) edge({ node: sid, handle: 'up' }, c.at, item, c.perMin, true)
  }
  for (const item of sources.keys())
    if (!consumers.has(item) && incoming.some((l) => l.item === item)) notes.push(`${itemName(item)} comes in but nothing here uses it.`)

  if (!floors.length && !solution.extraction.length) notes.push('Nothing to build yet: give this outpost a goal in its plan.')

  return { nodes, edges, maxBeltTier, generatedAt: new Date().toISOString(), notes }
}
