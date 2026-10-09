// Rules for editing the floor plan by hand: where a dropped block lands and which lines may be drawn (#50, #52).
import type { Connection } from '@xyflow/react'
import { cellOf, freeSpot, G, handleInfo, isBlock, type BlockKind } from './grid'
import type { BeltEdge, MicroGraph, MicroNode } from './model'

/** A block put down at `n.position`, snapped to the grid and moved off any block it would cover. */
export function place(nodes: MicroNode[], n: MicroNode): MicroNode {
  if (!n.type || !isBlock(n)) return n
  const c = freeSpot(nodes, n.id, n.type as BlockKind, cellOf(n))
  return { ...n, position: { x: c.x * G, y: c.y * G } }
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

