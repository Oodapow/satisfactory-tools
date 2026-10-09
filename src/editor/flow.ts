// Works out what every belt and pipe of a floor plan carries, from what it connects (#51).
// The item comes from the source end (a machine output's product, a port's item, whatever
// reaches a joint), or else from what the far end takes. Rates are a max flow: machine outputs
// and ports put in what they make, machine inputs and ports take what they need, and joints
// pass anything through, so a splitter shares what comes in by what each branch can take and
// a merger adds up its inputs. A line whose item and rate were set by hand keeps them.
// Power lines carry no item.
import { buildingsById, itemsById, recipesById } from '../data'
import { perMin } from '../plan/solve'
import { edgeMedium, inHandle, outHandle } from './grid'
import type { BeltEdge, ItemRate, MachineData, Medium, MicroNode } from './model'

export type Flow = { medium: Medium; item?: string; perMin?: number; manual: boolean }

/** A machine block's inputs and outputs per minute, for all `count` machines at its clock. */
export function machineRates(d: MachineData): { ins: ItemRate[]; outs: ItemRate[] } {
  const k = d.count * d.clock
  const recipe = recipesById.get(d.recipe)
  if (recipe)
    return {
      ins: recipe.ingredients.map((i) => ({ item: i.item, perMin: perMin(i.amount, recipe) * k })),
      outs: recipe.products.map((p) => ({ item: p.item, perMin: perMin(p.amount, recipe) * k * (d.boost ?? 1) })),
    }
  const b = buildingsById.get(d.building)
  const gen = b?.generator
  const spec = gen?.fuels.find((f) => f.fuel === d.fuel) ?? gen?.fuels[0]
  const energy = spec ? itemsById.get(spec.fuel)?.energyMJ : undefined
  if (!gen || !spec) return { ins: [], outs: [] }
  const mw = gen.powerProductionMW * k * (d.load ?? 1)
  const burn = energy ? (mw * 60) / energy : 0
  const ins: ItemRate[] = [{ item: spec.fuel, perMin: burn }]
  if (spec.supplemental) ins.push({ item: spec.supplemental, perMin: mw * 60 * (gen.supplementalPerMJ ?? 0) })
  const outs: ItemRate[] = spec.byproduct ? [{ item: spec.byproduct, perMin: burn * (spec.byproductAmount ?? 0) }] : []
  return { ins, outs }
}

export function inferFlows(nodes: MicroNode[], edges: BeltEdge[]): Map<string, Flow> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const medium = new Map(edges.map((e) => [e.id, edgeMedium(e, byId)]))
  const lines = edges.filter((e) => medium.get(e.id) !== 'power')
  const into = new Map<string, BeltEdge[]>()
  const outOf = new Map<string, BeltEdge[]>()
  for (const e of lines) {
    into.set(e.target, [...(into.get(e.target) ?? []), e])
    outOf.set(e.source, [...(outOf.get(e.source) ?? []), e])
  }
  const rates = new Map<string, { ins: ItemRate[]; outs: ItemRate[] }>()
  const machine = (n: MicroNode) => {
    if (n.data.kind !== 'machine') return undefined
    if (!rates.has(n.id)) rates.set(n.id, machineRates(n.data))
    return rates.get(n.id)
  }
  const isJoint = (n: MicroNode | undefined) => !!n && (n.data.kind === 'splitter' || n.data.kind === 'merger' || n.data.kind === 'junction')
  /** What a machine output or port puts on its line. */
  const supplyOf = (e: BeltEdge): ItemRate | undefined => {
    const s = byId.get(e.source)
    if (s?.data.kind === 'machine') return machine(s)!.outs.find((_, i) => outHandle(i) === e.sourceHandle)
    if (s?.data.kind === 'port' && s.data.perMin > 0) return { item: s.data.item ?? '', perMin: s.data.perMin }
    return undefined
  }
  /** What a machine input or port takes from its line (Infinity: no limit known). */
  const takes = (e: BeltEdge): number | undefined => {
    const t = byId.get(e.target)
    if (t?.data.kind === 'machine') return machine(t)!.ins.find((_, i) => inHandle(i) === e.targetHandle)?.perMin
    if (t?.data.kind === 'port') return t.data.perMin > 0 ? t.data.perMin : Infinity
    return undefined
  }

  // 1. Items: from the source end, through joints, else what the far end wants.
  const itemMemo = new Map<string, string | undefined>()
  function itemOf(e: BeltEdge, seen = new Set<string>()): string | undefined {
    if (e.data?.manual) return e.data.item
    if (itemMemo.has(e.id)) return itemMemo.get(e.id)
    if (seen.has(e.id)) return undefined
    seen.add(e.id)
    const s = byId.get(e.source)
    let item = s?.data.kind === 'port' ? s.data.item : supplyOf(e)?.item
    if (!item && isJoint(s)) for (const i of into.get(s!.id) ?? []) if ((item = itemOf(i, seen))) break
    item ||= wants(e)
    itemMemo.set(e.id, item)
    return item
  }
  function wants(e: BeltEdge, seen = new Set<string>()): string | undefined {
    if (seen.has(e.id)) return undefined
    seen.add(e.id)
    const t = byId.get(e.target)
    if (t?.data.kind === 'machine') return machine(t)!.ins.find((_, i) => inHandle(i) === e.targetHandle)?.item
    if (t?.data.kind === 'port') return t.data.item
    if (isJoint(t)) for (const o of outOf.get(t!.id) ?? []) if (!o.data?.manual) return wants(o, seen)
    return undefined
  }

  // 2. Rates: the most every consumer can get from every source along the lines, as a max flow.
  // Machine outputs and ports feed in what they make; machine inputs and ports take what they need;
  // a line set by hand carries at most its rate. Joints pass anything through.
  // A machine only runs as busy as its outputs can get rid of what it makes: the last machines on a
  // manifold idle part of the time (#60). Each machine's share of busy time comes from the sinks
  // backwards: solve with every output able to make its full rate and every input taking its
  // machine's busy share, see what each output got rid of, and repeat until that settles. The
  // final flow then has every machine make and take its busy share.
  const tail = (e: BeltEdge) => (isJoint(byId.get(e.source)) ? e.source : `${e.source}:${e.sourceHandle}`)
  const head = (e: BeltEdge) => (isJoint(byId.get(e.target)) ? e.target : `${e.target}:${e.targetHandle}`)
  const busy = new Map<string, number>()
  const share = (id: string | undefined) => (id ? (busy.get(id) ?? 1) : 1)
  const machineOf = (id: string) => (byId.get(id)?.data.kind === 'machine' ? id : undefined)
  const arcs = new Map<string, number>()
  const build = (outputsFull: boolean) => {
    const net = new MaxFlow()
    const fed = new Map<string, { arc: number; cap: number; machine?: string }>()
    const taken = new Set<string>()
    for (const e of lines) {
      const cap = e.data?.manual && e.data.perMin !== undefined ? e.data.perMin : UNLIMITED
      arcs.set(e.id, net.add(tail(e), head(e), cap))
      const sup = supplyOf(e)
      if (sup && !fed.has(tail(e))) {
        const m = machineOf(e.source)
        const c = sup.perMin * (outputsFull ? 1 : share(m))
        // A byproduct leaves wherever the plan sends it; the main product sets how busy the machine is.
        const main = e.sourceHandle === outHandle(0) || e.sourceHandle == null
        fed.set(tail(e), { arc: net.add(SOURCE, tail(e), c), cap: sup.perMin, machine: main ? m : undefined })
      }
      const want = takes(e)
      if (want !== undefined && !taken.has(head(e))) {
        taken.add(head(e))
        net.add(head(e), SINK, Number.isFinite(want) ? want * share(machineOf(e.target)) : UNLIMITED)
      }
    }
    net.solve()
    return { net, fed }
  }
  for (let round = 0; round < 100; round++) {
    const { net, fed } = build(true)
    const next = new Map<string, number>()
    for (const p of fed.values())
      if (p.machine && p.cap > 1e-12) next.set(p.machine, Math.min(next.get(p.machine) ?? 1, net.flow(p.arc) / p.cap))
    let settled = true
    for (const [m, u] of next) {
      if (Math.abs(u - share(m)) > 1e-9) settled = false
      busy.set(m, u)
    }
    if (settled) break
  }
  const { net } = build(false)
  const reached = net.reachable()

  // Lines nothing feeds yet show what their far end would take.
  const demandMemo = new Map<string, number>()
  function demand(e: BeltEdge, seen = new Set<string>()): number {
    if (e.data?.manual && e.data.perMin !== undefined) return e.data.perMin
    if (demandMemo.has(e.id)) return demandMemo.get(e.id)!
    if (seen.has(e.id)) return Infinity
    seen.add(e.id)
    const t = byId.get(e.target)
    const d = isJoint(t) ? (outOf.get(t!.id) ?? []).reduce((sum, o) => sum + demand(o, seen), 0) || Infinity : (takes(e) ?? Infinity) * share(machineOf(e.target))
    demandMemo.set(e.id, d)
    return d
  }

  const out = new Map<string, Flow>()
  for (const e of edges) {
    const m = medium.get(e.id)!
    if (m === 'power') {
      out.set(e.id, { medium: m, manual: false })
      continue
    }
    const d = demand(e)
    const perMin = e.data?.manual ? e.data.perMin : reached.has(tail(e)) ? net.flow(arcs.get(e.id)!) : Number.isFinite(d) ? d : undefined
    out.set(e.id, { medium: m, item: itemOf(e), perMin, manual: !!e.data?.manual })
  }
  return out
}

const SOURCE = '<source>'
/** Capacity of a line with no set rate: far above any belt, but finite so flows stay numbers. */
const UNLIMITED = 1e9
const SINK = '<sink>'

/** Edmonds-Karp max flow: shortest augmenting paths first, which keeps manifolds feeding the nearest machines. */
class MaxFlow {
  private ids = new Map<string, number>()
  private adj: number[][] = []
  private to: number[] = []
  private cap: number[] = []
  private base: number[] = []
  private node(k: string) {
    let i = this.ids.get(k)
    if (i === undefined) {
      i = this.adj.length
      this.ids.set(k, i)
      this.adj.push([])
    }
    return i
  }
  /** Adds an arc and returns its index. */
  add(from: string, to: string, cap: number) {
    const a = this.node(from)
    const b = this.node(to)
    const i = this.to.length
    this.to.push(b, a)
    this.cap.push(cap, 0)
    this.base.push(cap, 0)
    this.adj[a].push(i)
    this.adj[b].push(i + 1)
    return i
  }
  flow(arc: number) {
    return this.base[arc] - this.cap[arc]
  }
  solve() {
    const s = this.ids.get(SOURCE)
    const t = this.ids.get(SINK)
    if (s === undefined || t === undefined) return
    for (let rounds = 0; rounds < 10_000; rounds++) {
      const via = new Array<number>(this.adj.length).fill(-1)
      const queue = [s]
      via[s] = -2
      for (let q = 0; q < queue.length && via[t] === -1; q++)
        for (const arc of this.adj[queue[q]]) {
          const v = this.to[arc]
          if (via[v] === -1 && this.cap[arc] > 1e-9) {
            via[v] = arc
            queue.push(v)
          }
        }
      if (via[t] === -1) return
      let push = Infinity
      for (let v = t; v !== s; v = this.to[via[v] ^ 1]) push = Math.min(push, this.cap[via[v]])
      for (let v = t; v !== s; v = this.to[via[v] ^ 1]) {
        this.cap[via[v]] -= push
        this.cap[via[v] ^ 1] += push
      }
    }
  }
  /** Points some source reaches along the lines, whatever their capacity. */
  reachable() {
    const out = new Set<string>()
    const s = this.ids.get(SOURCE)
    if (s === undefined) return out
    const names = [...this.ids.keys()]
    const seen = new Set([s])
    const todo = [s]
    while (todo.length) {
      const u = todo.pop()!
      out.add(names[u])
      for (const arc of this.adj[u]) {
        const v = this.to[arc]
        if (arc & 1 || seen.has(v)) continue
        seen.add(v)
        todo.push(v)
      }
    }
    return out
  }
}
