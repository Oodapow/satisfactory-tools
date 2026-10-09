// Types for the generated game data in this folder. The JSON is produced by
// scripts/generate-game-data.mjs; see data/README.md for sources and units.
// Every id is the game's own class name (e.g. "Desc_IronPlate_C"), so ids match save files.

export type ItemId = string
export type RecipeId = string
export type BuildingId = string
export type SchematicId = string

export type Form = 'solid' | 'liquid' | 'gas'

/** Amounts of fluids are in m³, solids in items. */
export interface ItemAmount {
  item: ItemId
  amount: number
}

export type ItemCategory =
  | 'resource'
  | 'part'
  | 'biomass'
  | 'nuclear-fuel'
  | 'power-booster-fuel'
  | 'consumable'
  | 'equipment'
  | 'ammo'
  | 'power-shard'
  | 'vehicle'
  | 'special'
  | 'scanner-target'

export interface Item {
  id: ItemId
  name: string
  description: string
  category: ItemCategory
  form: Form
  /** null for fluids (they live in pipes and packages). */
  stackSize: number | null
  /** AWESOME Sink points; null when the item cannot be sunk. */
  sinkPoints: number | null
  /** MJ per item, or per m³ for fluids. Non-zero for fuels. */
  energyMJ: number
  radioactiveDecay: number
  isAlienItem: boolean
  /** The game's texture asset for the icon (for extracting icons from the game files). */
  iconTexture: string | null
  fluidColor?: { r: number; g: number; b: number; a: number } | null
  /** Present when the item comes from data/supplements/items.json rather than the game file. */
  fromSupplement?: true
}

export interface Resource {
  id: ItemId
  name: string
  form: Form
  /** Buildings that can extract it. */
  extractors: BuildingId[]
  /** Milestones/research that add it to the resource scanner. */
  scannerUnlockedBy: SchematicId[]
  /** Node counts on the map by purity (from the wiki); null when not tracked. */
  nodes: { impure: number; normal: number; pure: number } | null
}

export type RecipeKind =
  /** Made in a production building (may also be hand-craftable). */
  | 'production'
  /** Placed with the build gun; `building` says what it builds. */
  | 'building'
  /** Made in the Equipment Workshop. */
  | 'equipment'
  /** Only at the Craft Bench. */
  | 'manual'
  /** Legacy recipes with no producer. */
  | 'other'

export interface Recipe {
  id: RecipeId
  name: string
  kind: RecipeKind
  alternate: boolean
  /** Seconds per cycle at 100% clock. */
  durationSeconds: number
  ingredients: ItemAmount[]
  products: ItemAmount[]
  /** Production buildings that can run it. */
  producedIn: BuildingId[]
  craftBench: boolean
  equipmentWorkshop: boolean
  manualDurationMultiplier: number
  /** Schematics (milestones, research, alternates, shop) that unlock it. */
  unlockedBy: SchematicId[]
  /** For build-gun recipes: the building it places. */
  building?: BuildingId
  /** For variable-power machines: power swings between min and max over the cycle. */
  variablePowerMW?: { min: number; max: number }
  /** Seasonal events the recipe belongs to (e.g. "christmas"). */
  events?: string[]
}

export type BuildingKind = 'manufacturer' | 'extractor' | 'generator' | 'well-pressurizer' | 'other'

export interface Building {
  /** Building descriptor id (Desc_*), what recipes and unlocks refer to. */
  id: BuildingId
  /** The placed actor class (Build_*) as it appears in save files; null for a few variants. */
  buildClass: string | null
  name: string
  description: string
  kind: BuildingKind
  nativeClass: string | null
  buildMenu: { category: string; subCategory: string } | null
  /** The game's texture asset for the icon. */
  iconTexture: string | null
  /** Footprint in metres. */
  size: { width: number; length: number; height: number } | null
  powerConsumptionMW: number
  powerConsumptionExponent: number
  variablePowerMW?: { min: number; max: number }
  manufacturingSpeed?: number
  overclock?: {
    canOverclock: boolean
    shardSlots: number
    somersloopSlots: number
    somersloopBoostPerSlot: number
    somersloopPowerExponent: number
  }
  generator?: {
    powerProductionMW: number
    fuels: { fuel: ItemId; supplemental: ItemId | null; byproduct: ItemId | null; byproductAmount: number | null }[]
    /** m³ of supplemental resource (water) per MJ produced. */
    supplementalPerMJ: number | null
    /** Geothermal: output varies over a cycle. */
    variable: { constantMW: number; factorMW: number; cycleSeconds: number } | null
  }
  extractor?: {
    allowedForms: Form[]
    /** Empty means any resource of an allowed form. */
    allowedResources: ItemId[]
    /** Per cycle on a normal node; fluids in litres (divide by 1000 for m³). */
    itemsPerCycle: number
    cycleSeconds: number
  }
  /** Build-gun recipes that place this building. */
  buildRecipes?: RecipeId[]
}

export type SchematicType =
  | 'tutorial'
  | 'milestone'
  | 'mam'
  | 'alternate'
  | 'hard-drive'
  | 'awesome-shop'
  | 'custom'
  | 'customization'

export interface Schematic {
  id: SchematicId
  name: string
  description: string
  type: SchematicType
  /** HUB tier for milestones; the game also sets it on research. */
  tier: number
  /** Parts (or FICSIT Coupons for the AWESOME Shop) needed to buy it. */
  cost: ItemAmount[]
  timeSeconds: number
  dependencies: {
    schematics: SchematicId[]
    /** false: any one of `schematics` is enough. */
    requireAll: boolean
    /** e.g. "victory" for the post-game cup. */
    gamePhase: string | null
  } | null
  hiddenUntilDependenciesMet: boolean
  /** The game's texture asset for the icon. */
  iconTexture: string | null
  /** Old research kept for save compatibility; cannot be bought. */
  discontinued: boolean
  unlocks: {
    recipes: RecipeId[]
    /** Schematics granted for free when this one is bought. */
    schematics: SchematicId[]
    scannerResources: ItemId[]
    inventorySlots: number
    armSlots: number
    items: ItemAmount[]
    /** Game features such as "map" or "overclocking". */
    features: string[]
    /** Paint, patterns, tapes, emotes and other cosmetic class ids. */
    cosmetics: string[]
  }
  /** MAM research tree (e.g. "Caterium", "AlienTech"), from data/supplements/mam-trees.json, else the game's folder. */
  mamTree?: string
  /**
   * MAM research: the nodes drawn directly above this one. Any one of them being researched
   * opens it; empty means it opens with the tree. Absent for research that is in no tree.
   */
  mamParents?: SchematicId[]
  /** AWESOME Shop category. */
  shopCategory?: string
  events?: string[]
}

export type TierGate =
  | { requires: 'start' }
  | { requires: 'tutorial' }
  | { requires: 'phase'; phase: number }

export interface Progression {
  /** Granted to every new game. */
  startingSchematics: SchematicId[]
  tiers: { tier: number; gate: TierGate | null; milestones: SchematicId[] }[]
  spaceElevatorPhases: { phase: number; name: string; cost: ItemAmount[]; unlocksTiers: number[] }[]
  /** What the player needs before a schematic type can be bought at all. */
  access: Record<string, { building?: BuildingId; schematic?: SchematicId; note?: string }>
  /** MAM research trees in the supplement's order; `nodes` run top to bottom as the wiki diagrams list them. */
  mamTrees: { id: string; name: string; nodes: SchematicId[] }[]
  purityMultipliers: { impure: number; normal: number; pure: number }
  geysers: { impure: number; normal: number; pure: number }
}

export interface GameMeta {
  gameVersion: string
  gameVersionNote: string | null
  source: string
  units: Record<string, string>
  counts: Record<string, number>
  copyright: string
}

export type Purity = 'impure' | 'normal' | 'pure'

/** A node, resource well spot or geyser on the default map (world-map.json). */
export interface WorldNode {
  /** Actor name, as in save files (Persistent_Level:PersistentLevel.<id>). */
  id: string
  /** wellCore is where a Resource Well Pressurizer goes; wellSatellite is one of the well's nodes. */
  kind: 'node' | 'wellCore' | 'wellSatellite' | 'geyser'
  resource: ItemId
  purity: Purity
  /** World position in cm; x grows east, y grows south. */
  x: number
  y: number
}

export interface WorldMap {
  /** World area covered by the map image (and the save's fog of war), in cm. */
  bounds: { west: number; east: number; north: number; south: number }
  nodes: WorldNode[]
}

/** One level of the catalog's grouping: a subcategory and its members in display order. */
export interface TaxonomyGroup {
  id: string
  name: string
  /** Item or building ids. */
  members: string[]
}

export interface TaxonomyCategory {
  id: string
  name: string
  groups: TaxonomyGroup[]
}

/** How items and buildings are grouped for browsing (taxonomy.json). Buildings follow the in-game build menu. */
export interface Taxonomy {
  items: TaxonomyCategory[]
  buildings: TaxonomyCategory[]
}
