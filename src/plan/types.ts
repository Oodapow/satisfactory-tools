// The outpost plan model. An outpost is declared by what it must deliver
// (goals), what it has to work with (local resource nodes and imports from
// other outposts), and the recipe picked per item. Everything else (machines,
// power, surplus exports) is derived by ./solve.ts, so these types are what a
// planner UI or node editor reads and writes.
import type { BuildingId, ItemId, RecipeId } from '../data'

export type OutpostId = string

export type Purity = 'impure' | 'normal' | 'pure'

/** How goods move between outposts. Informational for now; the layout planner will use it. */
export type Transport = 'belt' | 'pipe' | 'truck' | 'train' | 'drone'

/** A resource node the outpost has access to. */
export interface ResourceNode {
  id: string
  resource: ItemId
  purity: Purity
  /** Extractor to put on it; defaults to the best unlocked one. */
  extractor?: BuildingId
  /** Clock speed of the extractor, 1 = 100%. Above 1 needs power shards. Defaults to 1. */
  clock?: number
  /** Picked on the world map: `id` is the node's id there, and resource and purity are the real ones. */
  fromMap?: boolean
}

/** Goods brought in from another outpost's exports. */
export interface Import {
  id: string
  from: OutpostId
  item: ItemId
  perMin: number
  via: Transport
}

/** Something the outpost must deliver, per minute. */
export interface ItemGoal {
  kind: 'item'
  item: ItemId
  perMin: number
}

/** Power the outpost must feed into the grid, in MW, using one generator type and fuel. */
export interface PowerGoal {
  kind: 'power'
  mw: number
  generator: BuildingId
  fuel: ItemId
}

export type Goal = ItemGoal | PowerGoal

export interface OutpostPlan {
  id: OutpostId
  name: string
  notes: string
  goals: Goal[]
  nodes: ResourceNode[]
  imports: Import[]
  /** Recipe per item where there is a choice. Missing entries use the suggested recipe. */
  recipeChoices: Record<ItemId, RecipeId>
  /** Run the outpost's own machines on its own generators (only with a power goal). */
  selfPowered: boolean
  /**
   * Highest clock speed machines are sized for, 1 = 100% (up to 2.5 with three power shards).
   * Defaults to 1.
   */
  maxClock?: number
  /**
   * Underclock machines that don't divide evenly so they all run at the same lower clock.
   * Off by default: they run at full clock and the manifold's last machine idles part of the time.
   */
  underclock?: boolean
  /** Somersloops slotted into each machine, per recipe. Each one adds output and multiplies power. */
  somersloops?: Record<RecipeId, number>
  /** Where the outpost sits on the world map, in world units (cm). */
  location?: { x: number; y: number }
  createdAt: string
  updatedAt: string
}

// Derived, never stored.

export interface ProductionStep {
  recipe: RecipeId
  /** The item this step runs for; the recipe's other products are byproducts. */
  item: ItemId
  building: BuildingId
  /** Fractional machine count at 100% clock (with any Somersloops counted in). */
  machines: number
  /** Whole machines to build. */
  count: number
  /** Clock speed every one of them runs at, 1 = 100%. */
  clock: number
  /** Power shards needed in total (one per 50% above 100%, per machine). */
  shards: number
  /** Somersloops per machine. */
  somersloops: number
  /** Output multiplier from Somersloops (1 = none, 2 = doubled). */
  boost: number
  powerMW: number
}

export interface GeneratorStep {
  generator: BuildingId
  fuel: ItemId
  machines: number
  mw: number
}

export interface ExtractionStep {
  resource: ItemId
  extractor: BuildingId
  /** Nodes used; water extractors don't need a node. */
  node?: string
  /** Fractional machines at 100% clock (water extractors), or 1 per node. */
  machines: number
  /** Whole extractors to build. */
  count: number
  /** Clock speed every one of them runs at, 1 = 100%. */
  clock: number
  shards: number
  perMin: number
  powerMW: number
}

/** Per-item flow through the outpost, per minute. */
export interface ItemFlow {
  item: ItemId
  extracted: number
  imported: number
  produced: number
  consumed: number
  /** Leaves the outpost: goals plus anything left over. */
  exported: number
  /** Made as a side product of another item's recipe (included in `produced`). */
  byproduct: number
  /** Needed but not covered by nodes, imports or recipes. */
  shortfall: number
}

export interface OutpostSolution {
  steps: ProductionStep[]
  generators: GeneratorStep[]
  extraction: ExtractionStep[]
  flows: Map<ItemId, ItemFlow>
  power: { consumedMW: number; generatedMW: number; exportedMW: number }
  /** Recipe actually used per item (chosen or suggested). */
  recipes: Record<ItemId, RecipeId>
}
