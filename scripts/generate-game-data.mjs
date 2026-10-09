#!/usr/bin/env node
// Turns the game's own data dump (CommunityResources/Docs/en-US.json) into the
// normalized JSON files in src/data/game/. See data/README.md.
//
//   node scripts/generate-game-data.mjs                  regenerate from data/raw/en-US.json
//   node scripts/generate-game-data.mjs --from <file>    refresh data/raw/en-US.json from a game install first
//   node scripts/generate-game-data.mjs --check          fail if the committed output is stale
//   ... --game-version 1.2.4.0                           record the game version in meta.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(ROOT, 'data/raw/en-US.json')
const SUPPLEMENTS = join(ROOT, 'data/supplements')
const OUT = join(ROOT, 'src/data/game')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

// ---------------------------------------------------------------------------
// Raw file handling

/** The game ships UTF-16LE with a BOM and CRLF; we keep a UTF-8, LF copy so git can diff it. */
function decodeDocs(buffer) {
  let text
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.subarray(2).toString('utf16le')
  else text = buffer.toString('utf8').replace(/^﻿/, '')
  return text.replace(/\r\n/g, '\n')
}

const from = option('--from')
if (from) {
  const text = decodeDocs(readFileSync(from))
  JSON.parse(text) // fail early on a bad file
  writeFileSync(RAW, text)
  console.log(`Copied ${from} -> data/raw/en-US.json`)
}

const docs = JSON.parse(decodeDocs(readFileSync(RAW)))
const progression = JSON.parse(readFileSync(join(SUPPLEMENTS, 'progression.json'), 'utf8'))
const resourceNodes = JSON.parse(readFileSync(join(SUPPLEMENTS, 'resource-nodes.json'), 'utf8'))
const extraItems = JSON.parse(readFileSync(join(SUPPLEMENTS, 'items.json'), 'utf8'))
const mamTrees = JSON.parse(readFileSync(join(SUPPLEMENTS, 'mam-trees.json'), 'utf8'))
const previousMeta = readJsonIfExists(join(OUT, 'meta.json'))

function readJsonIfExists(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Unreal text-property helpers. Values look like
//   ((ItemClass="/Script/Engine.BlueprintGeneratedClass'/Game/.../Desc_IronIngot.Desc_IronIngot_C'",Amount=3))

const CLASS_REF = /\.([\w-]+_C)['"]/g
const AMOUNT_REF = /ItemClass="[^"]*?\.([\w-]+_C)'?"\s*,\s*Amount=([\d.]+)/g

const classRefs = (value) => [...String(value ?? '').matchAll(CLASS_REF)].map((m) => m[1])
const amountRefs = (value) =>
  [...String(value ?? '').matchAll(AMOUNT_REF)].map((m) => ({ item: m[1], amount: Number(m[2]) }))
const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? round(n) : 0
}
const bool = (value) => value === 'True'
const round = (n) => Math.round(n * 1e6) / 1e6
const text = (value) => (value ?? '').replace(/\r\n/g, '\n').trim()
/** Texture asset name from "Texture2D /Game/.../IconDesc_Fuel_256.IconDesc_Fuel_256" or a brush struct. */
const texture = (value) => String(value ?? '').match(/\/Game\/[^'"\s]*\.([\w-]+)/)?.[1] ?? null

// ---------------------------------------------------------------------------
// Index the raw classes by their native (C++) class

const byNative = new Map()
for (const group of docs) {
  const native = group.NativeClass.match(/FactoryGame\.(\w+)'/)[1]
  byNative.set(native, group.Classes)
}
const classesOf = (...natives) => natives.flatMap((n) => byNative.get(n) ?? [])
const allClasses = [...byNative.entries()].flatMap(([native, classes]) =>
  classes.map((c) => ({ native, c })),
)

// ---------------------------------------------------------------------------
// Items

const ITEM_CATEGORY = {
  FGResourceDescriptor: 'resource',
  FGItemDescriptor: 'part',
  FGItemDescriptorBiomass: 'biomass',
  FGItemDescriptorNuclearFuel: 'nuclear-fuel',
  FGItemDescriptorPowerBoosterFuel: 'power-booster-fuel',
  FGConsumableDescriptor: 'consumable',
  FGEquipmentDescriptor: 'equipment',
  FGAmmoTypeProjectile: 'ammo',
  FGAmmoTypeSpreadshot: 'ammo',
  FGAmmoTypeInstantHit: 'ammo',
  FGPowerShardDescriptor: 'power-shard',
  FGVehicleDescriptor: 'vehicle',
}

const STACK_SIZE = { SS_ONE: 1, SS_SMALL: 50, SS_MEDIUM: 100, SS_BIG: 200, SS_HUGE: 500, SS_FLUID: null }
const FORM = { RF_SOLID: 'solid', RF_LIQUID: 'liquid', RF_GAS: 'gas', RF_INVALID: 'solid' }

const items = new Map()
for (const [native, category] of Object.entries(ITEM_CATEGORY)) {
  for (const c of classesOf(native)) {
    const form = FORM[c.mForm] ?? 'solid'
    const item = {
      id: c.ClassName,
      name: text(c.mDisplayName),
      description: text(c.mDescription),
      category,
      form,
      stackSize: STACK_SIZE[c.mStackSize] ?? null,
      sinkPoints: c.mResourceSinkPoints === undefined ? null : num(c.mResourceSinkPoints),
      // MJ per item; for fluids MJ per m³ (the game stores MJ per litre).
      energyMJ: form === 'solid' ? num(c.mEnergyValue) : round(num(c.mEnergyValue) * 1000),
      radioactiveDecay: num(c.mRadioactiveDecay),
      isAlienItem: bool(c.mIsAlienItem),
      iconTexture: texture(c.mPersistentBigIcon) ?? texture(c.mSmallIcon),
    }
    if (form !== 'solid') item.fluidColor = rgba(c.mFluidColor)
    items.set(item.id, item)
  }
}

for (const extra of extraItems.items) {
  if (items.has(extra.id)) throw new Error(`supplements/items.json: ${extra.id} is now in the game data, remove it`)
  items.set(extra.id, {
    iconTexture: null,
    sinkPoints: null,
    energyMJ: 0,
    radioactiveDecay: 0,
    isAlienItem: false,
    ...extra,
    fromSupplement: true,
  })
}

function rgba(value) {
  const m = String(value).match(/B=(\d+),G=(\d+),R=(\d+),A=(\d+)/)
  return m ? { r: +m[3], g: +m[2], b: +m[1], a: +m[4] } : null
}

const isFluid = (id) => items.has(id) && items.get(id).form !== 'solid'
/** Recipes count fluids in litres; we use m³ like the in-game UI. */
const toDisplayAmount = ({ item, amount }) => ({ item, amount: isFluid(item) ? round(amount / 1000) : amount })

// ---------------------------------------------------------------------------
// Buildings. The build gun makes a descriptor (Desc_X_C); the placed actor is Build_X_C.
// We key buildings by descriptor because that is what recipes and unlocks reference.

const buildClasses = new Map(allClasses.filter(({ c }) => c.ClassName.startsWith('Build_')).map(({ native, c }) => [c.ClassName, { native, c }]))

const KIND_BY_NATIVE = {
  FGBuildableManufacturer: 'manufacturer',
  FGBuildableManufacturerVariablePower: 'manufacturer',
  FGBuildableResourceExtractor: 'extractor',
  FGBuildableWaterPump: 'extractor',
  FGBuildableFrackingExtractor: 'extractor',
  FGBuildableFrackingActivator: 'well-pressurizer',
  FGBuildableGeneratorFuel: 'generator',
  FGBuildableGeneratorNuclear: 'generator',
  FGBuildableGeneratorGeoThermal: 'generator',
}

function buildMenu(subCategories) {
  const m = String(subCategories).match(/BuildCategories\/Sub_(\w+)\/SC_([\w-]+)\./)
  return m ? { category: m[1], subCategory: m[2] } : null
}

/** First clearance box, in metres (Unreal units are cm). */
function footprint(clearance) {
  const m = String(clearance ?? '').match(/Min=\(X=(-?[\d.]+),Y=(-?[\d.]+),Z=(-?[\d.]+)\),Max=\(X=(-?[\d.]+),Y=(-?[\d.]+),Z=(-?[\d.]+)\)/)
  if (!m) return null
  const [x1, y1, z1, x2, y2, z2] = m.slice(1).map(Number)
  const size = { width: round((x2 - x1) / 100), length: round((y2 - y1) / 100), height: round((z2 - z1) / 100) }
  return size.width > 0 && size.length > 0 ? size : null
}

const buildings = new Map()
const buildToDesc = new Map()
for (const d of classesOf('FGBuildingDescriptor')) {
  const buildId = d.ClassName.replace(/^Desc_/, 'Build_')
  const build = buildClasses.get(buildId)
  const b = build?.c ?? {}
  const native = build?.native ?? null
  const building = {
    id: d.ClassName,
    buildClass: build ? buildId : null,
    name: text(d.mDisplayName) || text(b.mDisplayName),
    description: text(d.mDescription) || text(b.mDescription),
    kind: KIND_BY_NATIVE[native] ?? 'other',
    nativeClass: native,
    buildMenu: buildMenu(d.mSubCategories),
    iconTexture: texture(d.mPersistentBigIcon) ?? texture(d.mSmallIcon),
    size: footprint(b.mClearanceData),
    powerConsumptionMW: num(b.mPowerConsumption),
    powerConsumptionExponent: num(b.mPowerConsumptionExponent),
  }
  if (b.mEstimatedMininumPowerConsumption !== undefined) {
    building.variablePowerMW = { min: num(b.mEstimatedMininumPowerConsumption), max: num(b.mEstimatedMaximumPowerConsumption) }
  }
  if (b.mManufacturingSpeed !== undefined) building.manufacturingSpeed = num(b.mManufacturingSpeed)
  if (b.mCanChangePotential !== undefined) {
    building.overclock = {
      canOverclock: bool(b.mCanChangePotential),
      // Power Shard slots; the game gives 3 unless overridden.
      shardSlots: bool(b.mOverridePotentialShardSlots) ? num(b.mPotentialShardSlots) : bool(b.mCanChangePotential) ? 3 : 0,
      // Somersloop slots (production amplification).
      somersloopSlots: bool(b.mCanChangeProductionBoost) ? num(b.mProductionShardSlotSize) : 0,
      somersloopBoostPerSlot: num(b.mProductionShardBoostMultiplier),
      somersloopPowerExponent: num(b.mProductionBoostPowerConsumptionExponent),
    }
  }
  if (building.kind === 'generator') building.generator = generatorInfo(b)
  if (building.kind === 'extractor') building.extractor = extractorInfo(b)
  buildings.set(building.id, building)
  if (build) buildToDesc.set(buildId, building.id)
}

function generatorInfo(b) {
  const fuels = Array.isArray(b.mFuel)
    ? b.mFuel.map((f) => ({
        fuel: f.mFuelClass,
        supplemental: f.mSupplementalResourceClass || null,
        byproduct: f.mByproduct || null,
        byproductAmount: f.mByproductAmount ? num(f.mByproductAmount) : null,
      }))
    : []
  return {
    powerProductionMW: num(b.mPowerProduction),
    fuels,
    // m³ of supplemental resource (water) per MJ produced; the game stores litres per MJ.
    supplementalPerMJ: b.mSupplementalToPowerRatio === undefined ? null : round(num(b.mSupplementalToPowerRatio) / 1000),
    variable: b.mVariablePowerProductionFactor === undefined
      ? null
      : {
          constantMW: num(b.mVariablePowerProductionConstant),
          factorMW: num(b.mVariablePowerProductionFactor),
          cycleSeconds: num(b.mVariablePowerProductionCycleLength),
        },
  }
}

function extractorInfo(b) {
  const forms = String(b.mAllowedResourceForms ?? '').match(/RF_\w+/g) ?? []
  return {
    allowedForms: forms.map((f) => FORM[f]),
    allowedResources: classRefs(b.mAllowedResources),
    itemsPerCycle: num(b.mItemsPerCycle),
    cycleSeconds: num(b.mExtractCycleTime),
  }
}

// ---------------------------------------------------------------------------
// Recipes

const WORKSHOP = {
  BP_WorkBenchComponent_C: 'craftBench',
  BP_WorkshopComponent_C: 'equipmentWorkshop',
  BP_BuildGun_C: 'buildGun',
}

const recipes = new Map()
const warnings = []
for (const c of classesOf('FGRecipe')) {
  const producers = classRefs(c.mProducedIn)
  const ingredients = amountRefs(c.mIngredients)
  const rawProducts = amountRefs(c.mProduct)
  const machines = producers.filter((p) => buildToDesc.has(p)).map((p) => buildToDesc.get(p))
  const via = new Set(producers.map((p) => WORKSHOP[p]).filter(Boolean))

  const productBuildings = rawProducts.filter((p) => buildings.has(p.item))
  const products = rawProducts.filter((p) => !buildings.has(p.item))
  let kind
  if (via.has('buildGun')) kind = 'building'
  else if (machines.length) kind = 'production'
  else if (via.has('equipmentWorkshop')) kind = 'equipment'
  else if (via.has('craftBench')) kind = 'manual'
  else kind = 'other'

  const recipe = {
    id: c.ClassName,
    name: text(c.mDisplayName),
    kind,
    alternate: c.FullName.includes('/AlternateRecipes/') || /^Alternate:/.test(c.mDisplayName),
    durationSeconds: num(c.mManufactoringDuration),
    ingredients: ingredients.map(toDisplayAmount),
    products: products.map(toDisplayAmount),
    producedIn: machines,
    craftBench: via.has('craftBench'),
    equipmentWorkshop: via.has('equipmentWorkshop'),
    manualDurationMultiplier: num(c.mManualManufacturingMultiplier),
    unlockedBy: [],
  }
  if (productBuildings.length) recipe.building = productBuildings[0].item
  // Only machines with variable power (Particle Accelerator, Converter, Quantum Encoder) use these.
  if (machines.some((m) => buildings.get(m).variablePowerMW)) {
    recipe.variablePowerMW = {
      min: num(c.mVariablePowerConsumptionConstant),
      max: round(num(c.mVariablePowerConsumptionConstant) + num(c.mVariablePowerConsumptionFactor)),
    }
  }
  if (c.mRelevantEvents) recipe.events = eventsOf(c.mRelevantEvents)
  recipes.set(recipe.id, recipe)
}

function eventsOf(value) {
  return (String(value).match(/EV_(\w+)/g) ?? []).map((e) => e.slice(3).toLowerCase())
}

// Building descriptors carry no unlock info of their own; attach the recipe that builds them.
for (const r of recipes.values()) {
  if (r.building) {
    const b = buildings.get(r.building)
    ;(b.buildRecipes ??= []).push(r.id)
  }
}

// ---------------------------------------------------------------------------
// Schematics (milestones, MAM research, alternates, AWESOME Shop, ...)

const SCHEMATIC_TYPE = {
  EST_Tutorial: 'tutorial',
  EST_Milestone: 'milestone',
  EST_MAM: 'mam',
  EST_Alternate: 'alternate',
  EST_HardDrive: 'hard-drive',
  EST_ResourceSink: 'awesome-shop',
  EST_Custom: 'custom',
  EST_Customization: 'customization',
}

const customizationRecipes = new Set(classesOf('FGCustomizationRecipe').map((c) => c.ClassName))

const FEATURE_UNLOCKS = {
  BP_UnlockMap_C: 'map',
  BP_UnlockBuildOverclock_C: 'overclocking',
  BP_UnlockBuildProductionBoost_C: 'production-amplification',
  BP_UnlockCircuitDaisyChaining_C: 'power-daisy-chaining',
  BP_UnlockBuildEfficiency_C: 'build-efficiency-display',
  BP_UnlockCheckmark_C: 'checkmark',
  BP_UnlockCustomizer_C: 'customizer',
  BP_UnlockBlueprints_C: 'blueprints',
}

const schematicIds = new Set(classesOf('FGSchematic').map((c) => c.ClassName))
const notes = []
const schematics = new Map()
for (const c of classesOf('FGSchematic')) {
  const unlocks = {
    recipes: [],
    schematics: [],
    scannerResources: [],
    inventorySlots: 0,
    armSlots: 0,
    items: [],
    features: [],
    cosmetics: [],
  }
  for (const u of c.mUnlocks) {
    switch (u.Class) {
      case 'BP_UnlockRecipe_C':
      case 'BP_UnlockBlueprints_C':
        for (const id of classRefs(u.mRecipes)) {
          if (recipes.has(id)) unlocks.recipes.push(id)
          else if (customizationRecipes.has(id)) unlocks.cosmetics.push(id)
          else warnings.push(`${c.ClassName} unlocks unknown recipe ${id}`)
        }
        if (FEATURE_UNLOCKS[u.Class]) unlocks.features.push(FEATURE_UNLOCKS[u.Class])
        break
      case 'BP_UnlockSchematic_C':
        unlocks.schematics.push(...classRefs(u.mSchematics))
        break
      case 'BP_UnlockScannableResource_C':
        unlocks.scannerResources.push(...classRefs(u.mResourcePairsToAddToScanner), ...classRefs(u.mResourcesToAddToScanner))
        break
      case 'BP_UnlockInventorySlot_C':
        unlocks.inventorySlots += num(u.mNumInventorySlotsToUnlock)
        break
      case 'BP_UnlockArmEquipmentSlot_C':
        unlocks.armSlots += num(u.mNumArmEquipmentSlotsToUnlock)
        break
      case 'BP_UnlockGiveItem_C':
        for (const given of amountRefs(u.mItemsToGive)) {
          // Statues, cups and the like are not described in the Docs file.
          if (items.has(given.item)) unlocks.items.push(toDisplayAmount(given))
          else unlocks.cosmetics.push(given.item)
        }
        break
      case 'BP_UnlockCentralStorageUploadSpeed_C':
        unlocks.features.push(`dimensional-depot-upload-speed:${num(u.mUploadSpeedPercentageDecrease)}`)
        break
      case 'BP_UnlockCentralStorageItemLimit_C':
        unlocks.features.push(`dimensional-depot-stack-limit:+${num(u.mItemStackLimitIncrease)}`)
        break
      case 'BP_UnlockCentralStorageUploadSlots_C':
        unlocks.features.push(`dimensional-depot-upload-slots:+${num(u.mNumSlotsToUnlock)}`)
        break
      case 'BP_UnlockItemDescriptor_C':
      case 'BP_UnlockScannableObject_C':
      case 'BP_UnlockEmote_C':
      case 'FGUnlockTape':
      case 'FGUnlockCustomization':
        unlocks.cosmetics.push(...classRefs(u.mItemDescriptors ?? u.mScannableObjects ?? u.mEmotes ?? u.mTapeUnlocks ?? u.mCustomizationUnlocks))
        break
      case 'BP_UnlockInfoOnly_C':
        break
      default:
        if (FEATURE_UNLOCKS[u.Class]) unlocks.features.push(FEATURE_UNLOCKS[u.Class])
        else warnings.push(`${c.ClassName} has unhandled unlock ${u.Class}`)
    }
  }

  const deps = { schematics: [], requireAll: true, gamePhase: null }
  for (const dep of c.mSchematicDependencies) {
    if (dep.Class === 'BP_SchematicPurchasedDependency_C') {
      // A few dependencies point at schematics that no longer exist; the game ignores them.
      const ids = classRefs(dep.mSchematics)
      deps.schematics.push(...ids.filter((id) => schematicIds.has(id)))
      for (const id of ids.filter((id) => !schematicIds.has(id))) notes.push(`${c.ClassName}: dropped dependency on removed ${id}`)
      deps.requireAll = bool(dep.mRequireAllSchematicsToBePurchased)
    } else if (dep.Class === 'BP_GamePhaseReachedDependency_C') {
      deps.gamePhase = dep.mGamePhase.replace(/^EGP_/, '').toLowerCase()
    } else warnings.push(`${c.ClassName} has unhandled dependency ${dep.Class}`)
  }

  const type = SCHEMATIC_TYPE[c.mType] ?? 'custom'
  const path = c.FullName.split(' ')[1]
  const schematic = {
    id: c.ClassName,
    name: text(c.mDisplayName),
    description: text(c.mDescription),
    type,
    tier: num(c.mTechTier),
    cost: amountRefs(c.mCost).map(toDisplayAmount),
    timeSeconds: num(c.mTimeToComplete),
    dependencies: deps.schematics.length || deps.gamePhase ? deps : null,
    hiddenUntilDependenciesMet: bool(c.mHiddenUntilDependenciesMet),
    iconTexture: texture(c.mSchematicIcon),
    // Old research kept so existing saves load; it cannot be bought any more.
    discontinued: /^Discontinued\b/.test(c.mDisplayName),
    unlocks,
  }
  const mamTree = path.match(/\/Research\/(\w+)_RS\//)
  if (mamTree) schematic.mamTree = mamTree[1]
  const shop = String(c.mSubCategories).match(/SC_RSS_([\w-]+)\./)
  if (shop) schematic.shopCategory = shop[1]
  if (c.mRelevantEvents) schematic.events = eventsOf(c.mRelevantEvents)
  schematics.set(schematic.id, schematic)
}

for (const s of schematics.values()) {
  for (const id of s.unlocks.recipes) recipes.get(id).unlockedBy.push(s.id)
}

// ---------------------------------------------------------------------------
// MAM research tree layout (from the supplement; the game file only has folders)

const placed = new Set()
const mamEntry = (entry, where) => {
  const s = schematics.get(entry.id)
  if (!s) return warnings.push(`${where}: unknown schematic ${entry.id}`), null
  if (s.type !== 'mam') return warnings.push(`${where}: ${entry.id} is ${s.type}, not MAM research`), null
  if (s.name !== entry.name) warnings.push(`${where}: ${entry.id} is called "${s.name}" in the game, not "${entry.name}"`)
  if (placed.has(entry.id)) warnings.push(`${where}: ${entry.id} is listed twice`)
  placed.add(entry.id)
  return s
}
for (const [tree, { nodes }] of Object.entries(mamTrees.trees)) {
  const inTree = new Set(nodes.map((n) => n.id))
  for (const node of nodes) {
    const s = mamEntry(node, `mam-trees.json ${tree}`)
    if (!s) continue
    for (const p of node.parents) if (!inTree.has(p)) warnings.push(`mam-trees.json ${tree}: parent ${p} of ${node.id} is not in the tree`)
    s.mamTree = tree
    s.mamParents = node.parents
  }
}
for (const entry of mamTrees.notInTree) mamEntry(entry, 'mam-trees.json notInTree')
for (const s of schematics.values()) {
  if (s.type === 'mam' && !s.discontinued && !placed.has(s.id)) {
    warnings.push(`mam-trees.json: research ${s.id} ("${s.name}") is in no tree; add it to a tree or to notInTree`)
  }
}

// ---------------------------------------------------------------------------
// Raw resources and how to extract them

const resources = [...items.values()]
  .filter((i) => i.category === 'resource')
  .map((i) => {
    const extractors = [...buildings.values()]
      .filter((b) => b.extractor)
      .filter((b) => {
        const e = b.extractor
        return e.allowedResources.length ? e.allowedResources.includes(i.id) : e.allowedForms.includes(i.form)
      })
      .map((b) => b.id)
    return {
      id: i.id,
      name: i.name,
      form: i.form,
      extractors,
      scannerUnlockedBy: [...schematics.values()].filter((s) => s.unlocks.scannerResources.includes(i.id)).map((s) => s.id),
      nodes: resourceNodes.nodes[i.id] ?? null,
    }
  })

// ---------------------------------------------------------------------------
// Progression: tiers + Space Elevator phases (phases come from the supplement file)

const tiers = []
for (const s of schematics.values()) {
  if (s.type !== 'milestone' && s.type !== 'tutorial') continue
  let t = tiers.find((x) => x.tier === s.tier)
  if (!t) tiers.push((t = { tier: s.tier, gate: progression.tierGates[s.tier] ?? null, milestones: [] }))
  t.milestones.push(s.id)
}
tiers.sort((a, b) => a.tier - b.tier)
for (const t of tiers) t.milestones.sort()

const progressionOut = {
  startingSchematics: ['Schematic_StartingRecipes_C'],
  tiers,
  spaceElevatorPhases: progression.spaceElevatorPhases,
  access: {
    mam: { building: 'Desc_Mam_C' },
    'awesome-shop': { building: 'Desc_ResourceSinkShop_C' },
    alternate: { schematic: 'Research_HardDrive_0_C', note: 'Alternates come from Hard Drives researched in the MAM.' },
  },
  purityMultipliers: resourceNodes.purityMultipliers,
  geysers: resourceNodes.geysers,
}

// ---------------------------------------------------------------------------
// Validate references so a game update that renames things fails loudly

const known = (id) => items.has(id) || buildings.has(id) || recipes.has(id) || schematics.has(id)
const check = (id, where) => {
  if (!known(id)) warnings.push(`${where} references unknown ${id}`)
}
for (const r of recipes.values()) {
  for (const x of [...r.ingredients, ...r.products]) check(x.item, r.id)
}
for (const s of schematics.values()) {
  for (const x of s.cost) check(x.item, s.id)
  for (const x of s.unlocks.items) check(x.item, s.id)
  for (const id of [...s.unlocks.schematics, ...(s.dependencies?.schematics ?? []), ...s.unlocks.scannerResources]) check(id, s.id)
}
for (const b of buildings.values()) for (const f of b.generator?.fuels ?? []) check(f.fuel, b.id)
for (const p of progression.spaceElevatorPhases) for (const x of p.cost) check(x.item, `phase ${p.phase}`)
for (const id of Object.keys(resourceNodes.nodes)) check(id, 'resource-nodes.json')
for (const a of Object.values(progressionOut.access)) check(a.building ?? a.schematic, 'progression access')

const fatal = warnings

// ---------------------------------------------------------------------------
// Write

const sortById = (map) => [...map.values()].sort((a, b) => a.id.localeCompare(b.id))
const gameVersion = option('--game-version') ?? previousMeta?.gameVersion ?? 'unknown'
const outputs = {
  'items.json': sortById(items),
  'resources.json': resources.sort((a, b) => a.id.localeCompare(b.id)),
  'recipes.json': sortById(recipes),
  'buildings.json': sortById(buildings),
  'schematics.json': sortById(schematics),
  'progression.json': progressionOut,
  'meta.json': {
    gameVersion,
    gameVersionNote: option('--game-version-note') ?? previousMeta?.gameVersionNote ?? null,
    source: 'CommunityResources/Docs/en-US.json shipped with the game, plus data/supplements/*.json',
    units: {
      fluids: 'm³ (recipe amounts, costs); per-minute rates are m³/min',
      energyMJ: 'MJ per item, or MJ per m³ for fluids',
      power: 'MW',
      size: 'metres (first clearance box of the placed building)',
    },
    counts: {
      items: items.size,
      resources: resources.length,
      recipes: recipes.size,
      buildings: buildings.size,
      schematics: schematics.size,
    },
    copyright: 'Game data © Coffee Stain Studios. Supplements adapted from the Official Satisfactory Wiki (CC BY-NC-SA 4.0).',
  },
}

let stale = []
mkdirSync(OUT, { recursive: true })
for (const [file, value] of Object.entries(outputs)) {
  const path = join(OUT, file)
  const content = JSON.stringify(value, null, 2) + '\n'
  if (flag('--check')) {
    let current = ''
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      // missing counts as stale
    }
    if (current !== content) stale.push(file)
  } else {
    writeFileSync(path, content)
  }
}

for (const n of notes) console.log(`note: ${n}`)
for (const w of fatal) console.error(`error: ${w}`)
console.log(Object.entries(outputs['meta.json'].counts).map(([k, v]) => `${v} ${k}`).join(', '))
if (fatal.length) process.exitCode = 1
if (stale.length) {
  console.error(`Stale generated files: ${stale.join(', ')}. Run: npm run data:generate`)
  process.exitCode = 1
}
