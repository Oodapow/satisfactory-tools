// Data model for the node editor. Two levels:
// - macro: the factory map. Blocks are outpost plans (src/plan), links are their imports,
//   plus power lines between outposts.
// - micro: the inside of one outpost: machines, splitters, mergers, and ports that connect
//   to the macro links (imports, exports, power) and to local resource nodes.
// The plans stay the source of truth for goals, nodes, imports and recipes. This module only
// stores what the plan model doesn't have: block positions, power lines and floor plans.
import type { Edge, Node } from '@xyflow/react'
import type { Solved } from '../plan/network'
import type { OutpostId, Transport as PlanTransport } from '../plan/types'

export type ItemRate = { item: string; perMin: number }

export type Transport = PlanTransport | 'power'

export const transports: { id: Transport; label: string; icon: string }[] = [
  { id: 'belt', label: 'Conveyor belt', icon: 'Desc_ConveyorBeltMk1_C' },
  { id: 'pipe', label: 'Pipeline', icon: 'Desc_Pipeline_C' },
  { id: 'truck', label: 'Truck', icon: 'Desc_TruckStation_C' },
  { id: 'train', label: 'Train', icon: 'Desc_TrainDockingStation_C' },
  { id: 'drone', label: 'Drone', icon: 'Desc_DroneStation_C' },
  { id: 'power', label: 'Power line', icon: 'power' },
]
export const transportById = new Map(transports.map((t) => [t.id, t]))

// ---------- Macro level (derived from plans on every render) ----------

export type OutpostNode = Node<Solved, 'outpost'>

export type LinkData = {
  transport: Transport
  /** Empty for power lines. */
  items: ItemRate[]
  powerMW?: number
  /** The plan import this link shows, or the power line id. */
  ref: { kind: 'import'; planId: OutpostId; importId: string } | { kind: 'power'; id: string }
}
export type LinkEdge = Edge<LinkData>

/** Power sent from one outpost to another. The plan model has no power imports yet, so the editor keeps these. */
export type PowerLine = { id: string; from: OutpostId; to: OutpostId; mw: number }

// ---------- Micro level (stored per outpost) ----------

export type MachineData = {
  kind: 'machine'
  building: string
  /** Empty for generators. */
  recipe: string
  /** Generators: the fuel they burn. */
  fuel?: string
  /** Clock speed, 1 = 100%. */
  clock: number
  /** How many identical machines this block stands for (1 unless the layout collapsed a large group). */
  count: number
  floor: number
}
/** Splitters and mergers turn to face their belts on their own (see grid.ts). */
export type SplitterData = { kind: 'splitter'; floor: number }
export type MergerData = { kind: 'merger'; floor: number }
export type PortData = {
  kind: 'port'
  direction: 'in' | 'out'
  /** 'resource' is a local resource node with its extractor. */
  transport: Transport | 'resource'
  item?: string
  perMin: number
  powerMW?: number
  /** Where the port leads: the other outpost's name, or a role like "Goal" or "Surplus". */
  label?: string
  /** Resource ports: the extractor on the node. */
  extractor?: string
  /** Macro link this port belongs to, to spot layouts that are out of date. */
  linkId?: string
}
export type FloorData = { kind: 'floor'; floor: number; label: string; width: number; height: number }

export type MicroNodeData = MachineData | SplitterData | MergerData | PortData | FloorData
export type MicroNode = Node<MicroNodeData>

export type BeltData = {
  item?: string
  perMin?: number
  /** Conveyor Mk tier (1-6) or pipe Mk (1-2) chosen for the rate. */
  tier?: number
  /** Rate is above what the best allowed belt can carry. */
  overCapacity?: boolean
  /** Floors climbed by a conveyor lift on the way (negative goes down). */
  lift?: number
}
export type BeltEdge = Edge<BeltData>

export type MicroGraph = {
  nodes: MicroNode[]
  edges: BeltEdge[]
  /** Best conveyor tier the player can build, used when proposing layouts. */
  maxBeltTier: number
  /** Best pipeline tier (1-2). */
  maxPipeTier?: number
  /** Set while the graph is an untouched proposal; cleared by any edit. */
  generatedAt?: string
  /** Warnings from the last proposal. */
  notes?: string[]
}

/** Everything the editor stores, under one localStorage key. */
export type EditorLayout = {
  positions: Record<OutpostId, { x: number; y: number }>
  powerLines: PowerLine[]
  micro: Record<OutpostId, MicroGraph>
}

export const beltRates = [60, 120, 270, 480, 780, 1200]
export const pipeRates = [300, 600]

/** Lowest tier that carries `perMin`, capped at `maxTier`. */
export function beltTierFor(perMin: number, maxTier: number, fluid = false) {
  const rates = fluid ? pipeRates : beltRates
  const cap = Math.min(maxTier, rates.length)
  for (let i = 0; i < cap; i++) if (perMin <= rates[i] + 1e-6) return { tier: i + 1, over: false }
  return { tier: cap, over: true }
}
