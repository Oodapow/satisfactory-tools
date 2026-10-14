// Which end of every floor plan line is its output and which its input (#87). Belts and pipes
// already run output to input. Power lines are drawn either way, so they are turned to run away
// from what feeds the grid (generators, and power coming in from the factory map) towards the
// machines that use it, through any poles in between.
import { buildingsById } from '../data'
import { edgeMedium } from './grid'
import type { BeltEdge, MicroNode, MicroNodeData } from './model'

export type Io = 'in' | 'out'

/** Which way a block's own power point faces: out of what makes power, into what uses it. Poles pass it on either way. */
export function powerRole(d: MicroNodeData): Io | undefined {
  if (d.kind === 'machine') return buildingsById.get(d.building)?.generator ? 'out' : 'in'
  if (d.kind === 'port' && d.transport === 'power') return d.direction === 'in' ? 'out' : 'in'
  return undefined
}

/**
 * Every connected point as `node:handle`, marked as the output or input end of its line, and the
 * power lines whose stored direction runs against the flow of power.
 */
export function lineEnds(nodes: MicroNode[], edges: BeltEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const power = edges.filter((e) => edgeMedium(e, byId) === 'power')
  const near = new Map<string, BeltEdge[]>()
  for (const e of power) for (const n of [e.source, e.target]) near.set(n, [...(near.get(n) ?? []), e])

  // Hops from the nearest power source, through the power lines.
  const hops = new Map<string, number>()
  const queue = nodes.filter((n) => near.has(n.id) && powerRole(n.data) === 'out').map((n) => n.id)
  for (const id of queue) hops.set(id, 0)
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    // Machines that use power are ends, not relays.
    const node = byId.get(id)
    if (node && powerRole(node.data) === 'in') continue
    for (const e of near.get(id) ?? []) {
      const other = e.source === id ? e.target : e.source
      if (hops.has(other)) continue
      hops.set(other, hops.get(id)! + 1)
      queue.push(other)
    }
  }

  const flipped = new Set<string>()
  for (const e of power) {
    const s = hops.get(e.source) ?? Infinity
    const t = hops.get(e.target) ?? Infinity
    const sn = byId.get(e.source)
    const tn = byId.get(e.target)
    if (s > t || (s === t && ((sn && powerRole(sn.data) === 'in') || (tn && powerRole(tn.data) === 'out')))) flipped.add(e.id)
  }

  const ends = new Map<string, Io>()
  for (const e of edges) {
    const [from, fromHandle, to, toHandle] = flipped.has(e.id) ? [e.target, e.targetHandle, e.source, e.sourceHandle] : [e.source, e.sourceHandle, e.target, e.targetHandle]
    ends.set(`${from}:${fromHandle}`, 'out')
    ends.set(`${to}:${toHandle}`, 'in')
  }
  return { ends, flipped }
}
