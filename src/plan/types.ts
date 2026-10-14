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

/** Power the outpost's generators add to its grid, in MW, using one generator type and fuel. */
export interface PowerGoal {
  kind: 'power'
  mw: number
  generator: BuildingId
  fuel: ItemId
}

export type Goal = ItemGoal | PowerGoal

/**
 * How a step's machines share the work when the user hasn't pinned a clock.
 * 'uniform': N machines at one shared clock that hits the rate exactly (blueprint friendly).
 * 'full': whole machines at full clock, the manifold's last one idling part of the time.
 */
export type ClockMode = 'uniform' | 'full'

/** What the user set on one production step (keyed by recipe). Unset fields are derived. */
export interface StepSetting {
  /** Whole machines to build. Without a clock, they share one clock that hits the rate. */
  count?: number
  /** Clock speed every machine runs at, 1 = 100%. Always set together with `count`. */
  clock?: number
  /** Sizing strategy for this step; defaults to the planner-wide setting. */
  mode?: ClockMode
}

export interface OutpostPlan {
  id: OutpostId
  name: string
  /** Kept in storage and backups, no longer shown. */
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
  /** Machine count, clock and sizing strategy the user set, per recipe. */
  steps?: Record<RecipeId, StepSetting>
  /** Items this outpost doesn't make itself: they have to be imported. */
  skipped?: ItemId[]
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
  /** Machines' worth the plan asks of this step; more than `machines` when a set count or clock can't keep up. */
  demand: number
  /** Whole machines to build. */
  count: number
  /** Clock speed every one of them runs at, 1 = 100%. */
  clock: number
  /** Sizing strategy used when the clock isn't set by the user. */
  mode: ClockMode
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
  /** Whole generators to build. */
  count: number
  /** Clock speed every one of them runs at, 1 = 100%. */
  clock: number
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
  /** Power isn't exported: what the generators make feeds the outpost's grid (see ./grids.ts). */
  power: { consumedMW: number; generatedMW: number }
  /** Recipe actually used per item (chosen or suggested). */
  recipes: Record<ItemId, RecipeId>
}
