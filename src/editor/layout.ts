// The outpost layout algorithm (#13). From an outpost's solved plan it decides, as plain
// data: which floors to build, which production lines go on each floor and how many machines
// each line has, which ports the outpost needs, and which belt carries what between them.
// generate.ts turns this into blocks and belts on the floor-plan grid.
//
// - One floor per production type: steps with the same machine at the same depth of the
//   chain share a floor (smelting, then plates and rods, then screws, then assembly).
//   A floor sits one level above the highest floor that feeds it.
// - Each step becomes one or more manifold lines. A line is split when one belt (or pipe)
//   of the best unlocked tier can't carry its input or output, or when it would have more
//   than MAX_PER_LINE machines. All machines in a step run at the solver's clock. When they
//   don't divide evenly the manifold feeds them in order, so the first ones run full and the
//   last one idles part of the time (#73).
// - Imports and exports that one belt can't carry get one port per belt.
// - Belts pair each item's sources with its consumers in order, never above either's rate.
import { buildingsById, itemName, itemsById, recipesById } from '../data'
import type { Solved } from '../plan/network'
import { perMin } from '../plan/solve'
import { beltRates, beltTierFor, pipeRates, type ItemRate, type PortData, type Transport } from './model'

const EPS = 1e-6
export const MAX_PER_LINE = 16
/** Foundation size in metres. */
const FOUNDATION = 8

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

export type LayoutInput = {
  solved: Solved
  /** Imports into this outpost and power lines arriving. */
  incoming: PortLink[]
  /** Other outposts' imports from this one and power lines leaving. */
  outgoing: PortLink[]
  /** Best conveyor belt Mk (1-6) and pipeline Mk (1-2) to build with. */
  maxBeltTier: number
  maxPipeTier?: number
  /** Best power pole Mk (1-3). */
  maxPoleTier?: number
}

/** One manifold: identical machines in a row, fed by one belt per ingredient and collected by one belt per product. */
export type Line = {
  id: string
  floor: number
  recipe: string
  building: string
  /** Generators: the fuel they burn. */
  fuel?: string
  machines: number
  clock: number
  /** Machines' worth of work the line does at that clock (at most `machines`): the last one may idle. */
  busy: number
  /** Somersloop output multiplier. */
  boost: number
  /** Per line, in the order of the machine's inputs and outputs. */
  ingredients: ItemRate[]
  products: ItemRate[]
}

export type Floor = {
  index: number
  level: number
  building: string
  label: string
  lines: Line[]
  /** Rough size in metres: machines side by side, belts in front and behind. */
  footprint: { width: number; length: number; height: number }
  foundations: { x: number; y: number }
}

export type Port = Omit<PortData, 'kind'> & { id: string }

/**
 * Where a belt starts or ends: a line's input or output slot, or a port. `overflow` is the far
 * end of a line's input manifold, where what its machines don't take carries on.
 */
export type End = { line: string; slot: number; overflow?: boolean } | { port: string }

export type Flow = { item: string; perMin: number; from: End; to: End }

export type OutpostLayout = {
  floors: Floor[]
  ports: Port[]
  flows: Flow[]
  notes: string[]
}

const isFluid = (item: string) => itemsById.get(item)?.form !== 'solid'

/** What one belt or pipe of the allowed tier carries. */
export function capacity(item: string, maxBeltTier: number, maxPipeTier = 2) {
  return isFluid(item) ? pipeRates[Math.min(maxPipeTier, pipeRates.length) - 1] : beltRates[Math.min(maxBeltTier, beltRates.length) - 1]
}

type Step = Omit<Line, 'id' | 'floor' | 'machines' | 'ingredients' | 'products'> & {
  label: string
  count: number
  ingredients: ItemRate[]
  products: ItemRate[]
}

export function planLayout({ solved, incoming, outgoing, maxBeltTier, maxPipeTier = 2 }: LayoutInput): OutpostLayout {
  const { plan, solution } = solved
  const notes: string[] = []
  const cap = (item: string) => capacity(item, maxBeltTier, maxPipeTier)

  // 1. Steps from the solution: production and generators, with whole machines and clocks.
  const steps: Step[] = solution.steps.map((s) => {
    const r = recipesById.get(s.recipe)!
    return {
      label: r.name,
      recipe: s.recipe,
      building: s.building,
      count: Math.max(1, s.count),
      clock: s.clock,
      busy: s.clock > 0 ? Math.min(Math.max(1, s.count), s.machines / s.clock) : 1,
      boost: s.boost,
      ingredients: r.ingredients.map((i) => ({ item: i.item, perMin: perMin(i.amount, r) * s.machines })),
      products: r.products.map((p) => ({ item: p.item, perMin: perMin(p.amount, r) * s.machines * s.boost })),
    }
  })
  for (const g of solution.generators) {
    const b = buildingsById.get(g.generator)
    const fuel = itemsById.get(g.fuel)
    const spec = b?.generator?.fuels.find((f) => f.fuel === g.fuel)
    const ingredients: ItemRate[] = []
    if (fuel?.energyMJ) ingredients.push({ item: g.fuel, perMin: (g.mw * 60) / fuel.energyMJ })
    if (spec?.supplemental && b?.generator?.supplementalPerMJ) ingredients.push({ item: spec.supplemental, perMin: g.mw * 60 * b.generator.supplementalPerMJ })
    const products: ItemRate[] = []
    if (spec?.byproduct && spec.byproductAmount && fuel?.energyMJ) products.push({ item: spec.byproduct, perMin: ((g.mw * 60) / fuel.energyMJ) * spec.byproductAmount })
    const count = Math.max(1, Math.ceil(g.machines - EPS))
    const clock = plan.underclock ? g.machines / count : 1
    steps.push({ label: `${fmt(g.mw)} MW from ${itemName(g.fuel)}`, recipe: '', fuel: g.fuel, building: g.generator, count, clock, busy: g.machines / clock, boost: 1, ingredients, products })
  }

  // 2. Levels: raw processing at the bottom, a step one above the highest step feeding it.
  const producer = new Map<string, Step>()
  for (const s of steps) for (const p of s.products) if (!producer.has(p.item)) producer.set(p.item, s)
  const levels = new Map<Step, number>()
  const levelOf = (s: Step, stack = new Set<Step>()): number => {
    if (levels.has(s)) return levels.get(s)!
    if (stack.has(s)) return 0
    stack.add(s)
    const below = s.ingredients.map((i) => producer.get(i.item)).filter((p): p is Step => !!p && p !== s)
    const level = below.length ? 1 + Math.max(...below.map((p) => levelOf(p, stack))) : 0
    levels.set(s, level)
    return level
  }

  // 3. Floors: one per machine type and level.
  const groups = new Map<string, Step[]>()
  for (const s of steps) {
    const key = `${String(levelOf(s)).padStart(3, '0')}|${buildingsById.get(s.building)?.name ?? s.building}`
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  let lineSeq = 0
  const floors: Floor[] = [...groups.keys()].sort().map((key, index) => {
    const group = groups.get(key)!.sort((a, b) => a.label.localeCompare(b.label))
    const lines: Line[] = group.flatMap((s) => splitStep(s).map((l) => ({ ...l, id: `L${++lineSeq}`, floor: index })))
    const b = buildingsById.get(group[0].building)
    const name = b?.name ?? group[0].building
    const footprint = footprintOf(lines)
    return {
      index,
      level: levelOf(group[0]),
      building: group[0].building,
      label: `Floor ${index + 1} · ${name} · ${group.map((s) => `${s.label} ×${s.count}`).join(', ')}`,
      lines,
      footprint,
      foundations: { x: Math.ceil(footprint.width / FOUNDATION), y: Math.ceil(footprint.length / FOUNDATION) },
    }
  })

  function splitStep(s: Step): Omit<Line, 'id' | 'floor'>[] {
    // Sized for what the line carries with every machine busy, so the first, full machines fit too.
    const full = (x: ItemRate) => (x.perMin * s.count) / s.busy
    let k = Math.ceil(s.count / MAX_PER_LINE - EPS)
    for (const x of [...s.ingredients, ...s.products]) k = Math.max(k, Math.ceil(full(x) / cap(x.item) - EPS))
    k = Math.max(1, Math.min(k, s.count))
    const base = Math.floor(s.count / k)
    let left = s.busy
    return Array.from({ length: k }, (_, i) => {
      const machines = base + (i < s.count % k ? 1 : 0)
      // Lines fill in order like machines on a manifold: the last one gets what's left.
      const busy = Math.min(machines, Math.max(0, left))
      left -= busy
      const share = busy / s.busy
      return {
        recipe: s.recipe,
        building: s.building,
        fuel: s.fuel,
        machines,
        clock: s.clock,
        busy,
        boost: s.boost,
        ingredients: s.ingredients.map((x) => ({ item: x.item, perMin: x.perMin * share })),
        products: s.products.map((x) => ({ item: x.item, perMin: x.perMin * share })),
      }
    })
  }

  // 4. Ports: resource nodes and imports in, exports and power out.
  const ports: Port[] = []
  let portSeq = 0
  const port = (p: Omit<Port, 'id'>) => {
    const id = `P${++portSeq}`
    ports.push({ id, ...p })
    return id
  }
  /** One port per belt the rate needs. */
  const ports$ = (p: Omit<Port, 'id'>) => {
    const k = p.item && p.transport !== 'resource' ? Math.max(1, Math.ceil(p.perMin / cap(p.item) - EPS)) : 1
    for (let i = 0; i < k; i++) port({ ...p, perMin: p.perMin / k, label: k > 1 ? `${p.label} (${i + 1}/${k})` : p.label })
  }

  for (const x of solution.extraction) {
    const node = plan.nodes.find((n) => n.id === x.node)
    const clock = Math.abs(x.clock - 1) > EPS ? ` at ${Math.round(x.clock * 100)}%` : ''
    const what = node ? `${node.purity[0].toUpperCase()}${node.purity.slice(1)} node${clock}` : `${x.count} × ${buildingsById.get(x.extractor)?.name ?? 'extractor'}${clock}`
    if (x.node) port({ direction: 'in', transport: 'resource', item: x.resource, perMin: x.perMin, label: what, extractor: x.extractor })
    else ports$({ direction: 'in', transport: 'resource', item: x.resource, perMin: x.perMin, label: what, extractor: x.extractor })
  }
  for (const l of incoming) {
    if (l.transport === 'power' || !l.item) port({ direction: 'in', transport: l.transport, item: l.item, perMin: l.perMin, powerMW: l.powerMW, label: l.other, linkId: l.linkId })
    else ports$({ direction: 'in', transport: l.transport, item: l.item, perMin: l.perMin, label: l.other, linkId: l.linkId })
  }

  // Exports: what other outposts take, then the rest as the goal or surplus.
  const goals = new Set(plan.goals.flatMap((g) => (g.kind === 'item' ? [g.item] : [])))
  for (const f of solution.flows.values()) {
    if (f.exported <= EPS) continue
    let left = f.exported
    for (const l of outgoing.filter((o) => o.item === f.item)) {
      const take = Math.min(left, l.perMin)
      if (l.perMin > left + EPS) notes.push(`${l.other} imports ${fmt(l.perMin)} ${itemName(f.item)}/min, but this outpost only has ${fmt(left)}/min to spare.`)
      left -= take
      ports$({ direction: 'out', transport: l.transport, item: f.item, perMin: take, label: l.other, linkId: l.linkId })
    }
    if (left > EPS)
      ports$({ direction: 'out', transport: isFluid(f.item) ? 'pipe' : 'belt', item: f.item, perMin: left, label: goals.has(f.item) ? 'Goal' : 'Surplus' })
  }
  for (const l of outgoing.filter((o) => o.transport === 'power'))
    port({ direction: 'out', transport: 'power', perMin: 0, powerMW: l.powerMW, label: l.other, linkId: l.linkId })
  if (solution.power.exportedMW > EPS && !outgoing.some((o) => o.transport === 'power'))
    port({ direction: 'out', transport: 'power', perMin: 0, powerMW: solution.power.exportedMW, label: 'Grid' })

  // 5. Belts: per item, pair sources with consumers bottom to top, splitting where rates differ.
  type Slot = { end: End; perMin: number; order: number }
  const sources = new Map<string, Slot[]>()
  const consumers = new Map<string, Slot[]>()
  const add = (m: Map<string, Slot[]>, item: string, s: Slot) => m.set(item, [...(m.get(item) ?? []), s])
  for (const f of floors)
    for (const l of f.lines) {
      l.ingredients.forEach((x, slot) => add(consumers, x.item, { end: { line: l.id, slot }, perMin: x.perMin, order: f.index }))
      l.products.forEach((x, slot) => add(sources, x.item, { end: { line: l.id, slot }, perMin: x.perMin, order: f.index }))
    }
  for (const p of ports) {
    if (!p.item || p.transport === 'power' || p.perMin <= EPS) continue
    add(p.direction === 'in' ? sources : consumers, p.item, { end: { port: p.id }, perMin: p.perMin, order: p.direction === 'in' ? -1 : floors.length })
  }
  const flows: Flow[] = []
  // Surplus of an item a line also uses leaves through the end of that line's manifold, as
  // overflow past its last machine, not split off before its first (#73). The last line that
  // uses it takes it, if its belt has room.
  for (const [item, cons] of consumers) {
    const lineSlots = cons.filter((c) => 'line' in c.end).sort((a, b) => a.order - b.order)
    const last = lineSlots[lineSlots.length - 1]
    if (!last || !('line' in last.end)) continue
    const out = cons.find((c) => 'port' in c.end && last.perMin + c.perMin <= cap(item) + EPS)
    if (!out) continue
    flows.push({ item, perMin: out.perMin, from: { ...last.end, overflow: true }, to: out.end })
    last.perMin += out.perMin
    cons.splice(cons.indexOf(out), 1)
  }
  for (const [item, cons] of consumers) {
    const srcs = [...(sources.get(item) ?? [])].sort((a, b) => a.order - b.order)
    cons.sort((a, b) => a.order - b.order)
    let i = 0
    let j = 0
    let sLeft = srcs[0]?.perMin ?? 0
    let cLeft = cons[0]?.perMin ?? 0
    while (i < srcs.length && j < cons.length) {
      const amount = Math.min(sLeft, cLeft)
      if (amount > EPS) flows.push({ item, perMin: amount, from: srcs[i].end, to: cons[j].end })
      sLeft -= amount
      cLeft -= amount
      if (sLeft <= EPS && ++i < srcs.length) sLeft = srcs[i].perMin
      if (cLeft <= EPS && ++j < cons.length) cLeft = cons[j].perMin
    }
  }
  for (const item of sources.keys())
    if (!consumers.has(item) && incoming.some((l) => l.item === item)) notes.push(`${itemName(item)} comes in but nothing here uses it.`)
  for (const f of solution.flows.values())
    if (f.shortfall > EPS) notes.push(`Short ${fmt(f.shortfall)} ${itemName(f.item)}/min: add a resource node, an import or an unlocked recipe.`)
  for (const f of floors)
    for (const l of f.lines)
      for (const x of [...l.ingredients, ...l.products])
        if (beltTierFor(x.perMin, isFluid(x.item) ? maxPipeTier : maxBeltTier, isFluid(x.item)).over)
          notes.push(`${l.machines} × ${buildingsById.get(l.building)?.name ?? 'machine'} on floor ${f.index + 1} need ${fmt(x.perMin)} ${itemName(x.item)}/min, more than your best ${isFluid(x.item) ? 'pipe' : 'belt'} carries.`)
  if (!floors.length && !solution.extraction.length) notes.push('Nothing to build yet: give this outpost a goal in its plan.')

  return { floors, ports, flows, notes: [...new Set(notes)] }
}

/** Machines side by side along the manifold, a belt per input and output in front and behind, a walkway. */
function footprintOf(lines: Line[]) {
  let width = 0
  let length = 0
  let height = 0
  for (const l of lines) {
    const size = buildingsById.get(l.building)?.size ?? { width: 8, length: 8, height: 4 }
    width = Math.max(width, l.machines * size.width + (l.machines - 1) + 4)
    length += size.length + 2 * (l.ingredients.length + l.products.length) + 2
    height = Math.max(height, size.height + 2)
  }
  return { width, length, height }
}
