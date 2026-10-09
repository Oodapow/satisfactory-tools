// Mirror of src/data/game/types.ts from the game data PR, so the mock fixture
// and the real data share one shape. Delete once that PR lands.

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
  /** MAM research tree, from the game's folder name (e.g. "Caterium", "AlienTech"). */
  mamTree?: string
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
