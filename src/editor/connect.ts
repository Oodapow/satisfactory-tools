// Rules for editing the floor plan by hand: where a dropped block lands and which lines may be drawn (#50, #52).
import type { Connection } from '@xyflow/react'
import { cellOf, facePoles, freeSpot, G, handleInfo, isBlock, sizeOf, type BlockKind } from './grid'
import type { BeltEdge, MachineData, MicroGraph, MicroNode } from './model'

/** A block put down at `n.position`, snapped to the grid and moved off any block it would cover (never off a line). */
export function place(nodes: MicroNode[], n: MicroNode, roomy = false): MicroNode {
  if (!n.type || !isBlock(n)) return n
  const c = freeSpot(nodes, n.id, sizeOf(n.type as BlockKind, n.data), cellOf(n), roomy)
  return { ...n, position: { x: c.x * G, y: c.y * G } }
}

/**
 * Turn a machine a quarter clockwise. Nobody chose where the turned block goes, so it keeps a grid
 * line clear all round it, moving if it must, so its lines can reach every connection point. Its
 * power line moves round with it, so the pole at the other end picks its points again.
 */
export function turnMachine(g: MicroGraph, id: string): MicroGraph {
  const n = g.nodes.find((x) => x.id === id)
  if (!n || n.data.kind !== 'machine') return g
  const turned = place(g.nodes, { ...n, data: { ...n.data, rot: (((n.data.rot ?? 0) + 1) % 4) as MachineData['rot'] } }, true)
  const nodes = g.nodes.map((x) => (x.id === id ? turned : x))
  const poles = new Set(g.edges.flatMap((e) => (e.target === id && e.targetHandle === 'power' ? [e.source] : e.source === id && e.sourceHandle === 'power' ? [e.target] : [])))
  const edges = g.edges.map((e) => (poles.has(e.source) || poles.has(e.target) ? { ...e } : e))
  facePoles(nodes, edges, undefined, poles)
  return { ...g, nodes, edges }
}

/**
 * Whether a new line may join two connection points, and which way it runs: both points free,
 * carrying the same thing, and for belts and pipes an output to an input. Returns the connection
 * turned to run output to input, or null.
 */
export function connection(graph: MicroGraph, c: Connection | BeltEdge) {
  if (!c.source || !c.target || c.source === c.target) return null
  const a = graph.nodes.find((n) => n.id === c.source)
  const b = graph.nodes.find((n) => n.id === c.target)
  const ia = a && handleInfo(a.data, c.sourceHandle)
  const ib = b && handleInfo(b.data, c.targetHandle)
  if (!ia || !ib || ia.medium !== ib.medium) return null
  const taken = (node: string, handle: string | null | undefined) =>
    graph.edges.some((e) => (e.source === node && e.sourceHandle === handle) || (e.target === node && e.targetHandle === handle))
  if (taken(c.source, c.sourceHandle) || taken(c.target, c.targetHandle)) return null
  if (ia.medium !== 'power') {
    if (ia.role === ib.role && ia.role !== 'any') return null
    // Dragged from an input: the line still runs output to input.
    if (ia.role === 'in' || ib.role === 'out')
      return { medium: ia.medium, c: { source: c.target, sourceHandle: c.targetHandle ?? null, target: c.source, targetHandle: c.sourceHandle ?? null } }
  }
  return { medium: ia.medium, c: { source: c.source, sourceHandle: c.sourceHandle ?? null, target: c.target, targetHandle: c.targetHandle ?? null } }
}

