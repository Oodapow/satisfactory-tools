// Which end of every floor plan line is its output and which its input (#87): belts and pipes
// run output to input, so a line's source end is an output and its target end an input. Points
// that work either way (pipeline junctions) take their colour from this. Power has no direction
// and keeps its own colour.
import type { BeltEdge } from './model'

export type Io = 'in' | 'out'

/** Every connected point as `node:handle`, marked as the output or input end of its line. */
export function lineEnds(edges: BeltEdge[]) {
  const ends = new Map<string, Io>()
  for (const e of edges) {
    ends.set(`${e.source}:${e.sourceHandle}`, 'out')
    ends.set(`${e.target}:${e.targetHandle}`, 'in')
  }
  return ends
}
