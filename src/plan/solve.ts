import { buildingsById, itemsById, progression, recipesById, recipesProducing, resourcesById, schematicsById } from '../data'
import type { Availability } from '../data/game/availability'
import type { Building, BuildingId, ItemId, Recipe, RecipeId } from '../data'
import type { ExtractionStep, ItemFlow, OutpostPlan, OutpostSolution, ProductionStep, Purity } from './types'

export const perMin = (amount: number, r: Recipe) => (amount * 60) / r.durationSeconds

/** Unlocked recipes that make `item` in an unlocked machine, standard ones first. */
export function recipesFor(item: ItemId, available: Availability) {
  return (recipesProducing.get(item) ?? [])
    .filter((r) => available.recipes.has(r.id) && r.kind === 'production' && r.producedIn.some((b) => available.buildings.has(b)))
    .sort((a, b) => Number(a.alternate) - Number(b.alternate))
}

const isFluid = (item: ItemId) => (resourcesById.get(item)?.form ?? itemsById.get(item)?.form) !== 'solid'

/** Output of one extractor at 100% clock, per minute (m³ for fluids). */
export function extractorPerMin(b: Building, item: ItemId, purity: Purity = 'normal') {
  const e = b.extractor
  if (!e) return 0
  const units = isFluid(item) ? e.itemsPerCycle / 1000 : e.itemsPerCycle
  return ((units * 60) / e.cycleSeconds) * progression.purityMultipliers[purity]
}

/** Unlocked extractors for a resource, fastest first. */
export function extractorsFor(item: ItemId, buildings: Set<BuildingId>) {
  return (resourcesById.get(item)?.extractors ?? [])
    .filter((id) => buildings.has(id))
    .map((id) => buildingsById.get(id)!)
    .filter((b) => b.extractor)
    .sort((a, b) => extractorPerMin(b, item) - extractorPerMin(a, item))
}

/** Resources that don't need a node, like water from a Water Extractor. */
function nodelessExtractor(item: ItemId, buildings: Set<BuildingId>) {
  return extractorsFor(item, buildings).find((b) => b.id === 'Desc_WaterPump_C')
}

/** Generators the player has, with the fuels each can burn. */
export function generatorsFor(buildings: Set<BuildingId>) {
  return [...buildings]
    .map((id) => buildingsById.get(id)!)
    .filter((b) => b?.generator && b.generator.powerProductionMW > 0 && b.generator.fuels.length > 0)
}

type Choice = Record<ItemId, RecipeId>

/** Highest clock speed: 250% with three power shards. */
export const MAX_CLOCK = 2.5
const DEFAULT_EXPONENT = 1.321928

const featureCache = new WeakMap<Availability, Set<string>>()
/** Game features the player has researched, like 'overclocking' and 'production-amplification'. */
export function unlockedFeatures(available: Availability) {
  let f = featureCache.get(available)
  if (!f) {
    f = new Set([...available.schematics].flatMap((id) => schematicsById.get(id)?.unlocks.features ?? []))
    featureCache.set(available, f)
  }
  return f
}

/** Power shards one machine needs to run at `clock`: one per 50% above 100%. */
export const shardsFor = (clock: number) => Math.max(0, Math.ceil((clock - 1) / 0.5 - 1e-9))

/** Power draw of one machine at `clock`, with `boost` the Somersloop output multiplier (1 = none). */
export function machinePowerMW(b: Building | undefined, clock = 1, boost = 1) {
  if (!b) return 0
  const sloopExp = b.overclock?.somersloopPowerExponent ?? 2
  return b.powerConsumptionMW * Math.pow(clock, b.powerConsumptionExponent || DEFAULT_EXPONENT) * Math.pow(boost, sloopExp)
}

/**
 * Whole machines for `machines` worth of work at 100% clock, run no faster than
 * `maxClock`: the fewest machines, all at the same clock, so a manifold feeds
 * them evenly (2.5 machines of work at 100% max is 3 machines at 83.3%).
 */
export function sizeMachines(machines: number, maxClock = 1) {
  if (machines <= 1e-9) return { count: 0, clock: 0 }
  const limit = Math.min(MAX_CLOCK, Math.max(0.01, maxClock))
  const count = Math.max(1, Math.ceil(machines / limit - 1e-9))
  return { count, clock: machines / count }
}

/** Somersloops a building can take per machine, and the output multiplier for `n` of them. */
export function somersloopBoost(b: Building | undefined, n = 0) {
  const slots = b?.overclock?.somersloopSlots ?? 0
  const used = Math.max(0, Math.min(slots, Math.round(n)))
  return { slots, used, boost: 1 + used * (b?.overclock?.somersloopBoostPerSlot ?? 0) }
}

/**
 * Derive machines, power and flows for a plan. Demand is walked back from the
 * goals; imports are used before producing locally, then byproducts of the
 * outpost's own recipes, then new production. Resources come from the plan's
 * nodes. Anything left over (byproducts, unused node output) is exported.
 * Machines are sized to the plan's highest clock speed and underclocked to
 * match, with power following the game's clock exponent and Somersloop boost.
 */
export function solve(plan: OutpostPlan, available: Availability, suggested: Choice = {}): OutpostSolution {
  const choose = (item: ItemId) => {
    const options = recipesFor(item, available)
    return (
      options.find((r) => r.id === plan.recipeChoices[item]) ??
      options.find((r) => r.id === suggested[item]) ??
      options[0]
    )
  }
  // Clocks above 100% and Somersloops only count once the player has researched them.
  const features = unlockedFeatures(available)
  const maxClock = features.has('overclocking') ? (plan.maxClock ?? 1) : Math.min(1, plan.maxClock ?? 1)
  const sloopsFor = (id: RecipeId) => (features.has('production-amplification') ? plan.somersloops?.[id] : 0)
  const nodeClock = (c = 1) => Math.min(features.has('overclocking') ? MAX_CLOCK : 1, Math.max(0.01, c))

  const powerGoal = plan.goals.find((g) => g.kind === 'power')
  let generatedMW = powerGoal?.mw ?? 0
  let credit = new Map<ItemId, number>()
  let result!: ReturnType<typeof walk>
  // Two things feed back into the walk, so it repeats until they settle: byproducts the
  // outpost makes (they can cover demand for another step) and, when self-powered, the
  // power its own machines draw.
  for (let i = 0; i < 12; i++) {
    result = walk(generatedMW, credit)
    const next = powerGoal && plan.selfPowered ? powerGoal.mw + result.consumedMW : generatedMW
    const settled = Math.abs(next - generatedMW) < 1e-6 && sameRates(credit, result.byproducts)
    generatedMW = next
    credit = result.byproducts
    if (settled) break
  }
  return result.solution

  function walk(mw: number, byproducts: Map<ItemId, number>) {
    const flows = new Map<ItemId, ItemFlow>()
    const flow = (item: ItemId) => {
      let f = flows.get(item)
      if (!f) flows.set(item, (f = { item, extracted: 0, imported: 0, produced: 0, consumed: 0, exported: 0, shortfall: 0, byproduct: 0 }))
      return f
    }
    const pool = new Map<ItemId, number>()
    for (const imp of plan.imports) {
      pool.set(imp.item, (pool.get(imp.item) ?? 0) + imp.perMin)
      flow(imp.item).imported += imp.perMin
    }
    // Byproducts from the last pass, usable before making more of the item.
    const spare = new Map(byproducts)
    const runs = new Map<RecipeId, { item: ItemId; machines: number; boost: number; sloops: number }>()
    const rawDemand = new Map<ItemId, number>()
    const recipes: Choice = {}
    const take = (from: Map<ItemId, number>, item: ItemId, rate: number) => {
      const got = Math.min(from.get(item) ?? 0, rate)
      if (got > 0) from.set(item, (from.get(item) ?? 0) - got)
      return got
    }

    const need = (item: ItemId, rate: number, depth: number) => {
      let rest = rate - take(pool, item, rate)
      rest -= take(spare, item, rest)
      if (rest <= 1e-9) return
      if (resourcesById.has(item)) {
        rawDemand.set(item, (rawDemand.get(item) ?? 0) + rest)
        return
      }
      const recipe = depth < 25 ? choose(item) : undefined
      if (!recipe) {
        flow(item).shortfall += rest
        return
      }
      recipes[item] = recipe.id
      const { boost, used } = somersloopBoost(buildingsById.get(recipe.producedIn[0]), sloopsFor(recipe.id))
      const m = rest / (perMin(recipe.products.find((p) => p.item === item)!.amount, recipe) * boost)
      const run = runs.get(recipe.id) ?? { item, machines: 0, boost, sloops: used }
      run.machines += m
      runs.set(recipe.id, run)
      for (const x of recipe.ingredients) {
        const r = perMin(x.amount, recipe) * m
        flow(x.item).consumed += r
        need(x.item, r, depth + 1)
      }
    }

    for (const g of plan.goals) if (g.kind === 'item') need(g.item, g.perMin, 0)

    const generators: OutpostSolution['generators'] = []
    if (powerGoal && mw > 0) {
      const gen = buildingsById.get(powerGoal.generator)?.generator
      const fuel = itemsById.get(powerGoal.fuel)
      if (gen && fuel && fuel.energyMJ > 0) {
        const fuelRate = (mw * 60) / fuel.energyMJ
        flow(fuel.id).consumed += fuelRate
        need(fuel.id, fuelRate, 0)
        const spec = gen.fuels.find((f) => f.fuel === fuel.id)
        if (spec?.supplemental && gen.supplementalPerMJ) {
          const water = mw * 60 * gen.supplementalPerMJ
          flow(spec.supplemental).consumed += water
          need(spec.supplemental, water, 0)
        }
        // Nuclear waste and the like leave the outpost.
        if (spec?.byproduct && spec.byproductAmount) {
          const f = flow(spec.byproduct)
          const rate = fuelRate * spec.byproductAmount
          f.produced += rate
          f.byproduct += rate
        }
        generators.push({ generator: powerGoal.generator, fuel: fuel.id, machines: mw / gen.powerProductionMW, mw })
      }
    }

    const made = new Map<ItemId, number>()
    const steps: ProductionStep[] = [...runs].map(([id, run]) => {
      const recipe = recipesById.get(id)!
      for (const p of recipe.products) {
        const rate = perMin(p.amount, recipe) * run.machines * run.boost
        flow(p.item).produced += rate
        if (p.item !== run.item) {
          flow(p.item).byproduct += rate
          made.set(p.item, (made.get(p.item) ?? 0) + rate)
        }
      }
      const building = recipe.producedIn.find((b) => available.buildings.has(b)) ?? recipe.producedIn[0]
      const b = buildingsById.get(building)
      const { count, clock } = sizeMachines(run.machines, b?.overclock?.canOverclock === false ? 1 : maxClock)
      return {
        recipe: id,
        item: run.item,
        building,
        machines: run.machines,
        count,
        clock,
        shards: count * shardsFor(clock),
        somersloops: run.sloops,
        boost: run.boost,
        powerMW: count * machinePowerMW(b, clock, run.boost),
      }
    })

    // Every node runs at its clock; what the outpost doesn't use is exported.
    const extraction: ExtractionStep[] = []
    for (const node of plan.nodes) {
      const b = (node.extractor && buildingsById.get(node.extractor)) || extractorsFor(node.resource, available.buildings)[0]
      if (!b) continue
      const clock = nodeClock(node.clock)
      const rate = extractorPerMin(b, node.resource, node.purity) * clock
      flow(node.resource).extracted += rate
      extraction.push({
        resource: node.resource,
        extractor: b.id,
        node: node.id,
        machines: 1,
        count: 1,
        clock,
        shards: shardsFor(clock),
        perMin: rate,
        powerMW: machinePowerMW(b, clock),
      })
    }
    for (const [item, demand] of rawDemand) {
      const f = flow(item)
      const missing = demand - f.extracted
      if (missing <= 1e-9) continue
      const pump = nodelessExtractor(item, available.buildings)
      if (pump) {
        const machines = missing / extractorPerMin(pump, item)
        const { count, clock } = sizeMachines(machines, maxClock)
        f.extracted += missing
        extraction.push({
          resource: item,
          extractor: pump.id,
          machines,
          count,
          clock,
          shards: count * shardsFor(clock),
          perMin: missing,
          powerMW: count * machinePowerMW(pump, clock),
        })
      } else f.shortfall += missing
    }

    for (const f of flows.values()) {
      // Unused imports aren't exports: they simply aren't needed.
      const net = f.extracted + f.produced + f.imported - f.consumed - (pool.get(f.item) ?? 0)
      f.exported = Math.max(0, net)
      // Counted on a byproduct that, after this pass, isn't made in that amount.
      if (net < -1e-6 && f.shortfall < -net) f.shortfall = -net
    }
    const consumedMW = steps.reduce((s, x) => s + x.powerMW, 0) + extraction.reduce((s, x) => s + x.powerMW, 0)
    const solution: OutpostSolution = {
      steps,
      generators,
      extraction,
      flows,
      power: { consumedMW, generatedMW: mw, exportedMW: plan.selfPowered ? mw - consumedMW : mw },
      recipes,
    }
    return { solution, consumedMW, byproducts: made }
  }
}

function sameRates(a: Map<ItemId, number>, b: Map<ItemId, number>) {
  for (const k of new Set([...a.keys(), ...b.keys()])) if (Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0)) > 1e-6) return false
  return true
}

/** Unused imports, per item: what the plan brings in but doesn't need. */
export function unusedImports(plan: OutpostPlan, s: OutpostSolution) {
  const out = new Map<ItemId, number>()
  for (const imp of plan.imports) {
    const f = s.flows.get(imp.item)
    if (!f) continue
    const used = f.consumed - f.produced - f.extracted
    const spare = f.imported - Math.max(0, used)
    if (spare > 1e-6) out.set(imp.item, spare)
  }
  return out
}

const score = (s: OutpostSolution) => {
  let shortfall = 0
  let extracted = 0
  for (const f of s.flows.values()) {
    shortfall += f.shortfall
    extracted += Math.max(0, f.consumed - f.produced - f.imported)
  }
  const machines = s.steps.reduce((n, x) => n + x.count, 0)
  return shortfall * 1e6 + extracted + machines * 2
}

/**
 * Pick a recipe for every item the user hasn't decided on: the one that leaves
 * nothing short, then uses the least raw input, then the fewest machines.
 */
export function suggestRecipes(plan: OutpostPlan, available: Availability): Choice {
  const choice: Choice = {}
  for (let pass = 0; pass < 3; pass++) {
    let changed = false
    const current = solve(plan, available, choice)
    for (const item of Object.keys(current.recipes)) {
      if (plan.recipeChoices[item]) continue
      const options = recipesFor(item, available)
      if (options.length < 2) continue
      let best = choice[item] ?? current.recipes[item]
      let bestScore = score(solve(plan, available, { ...choice, [item]: best }))
      for (const r of options) {
        const sc = score(solve(plan, available, { ...choice, [item]: r.id }))
        if (sc < bestScore - 1e-9) {
          best = r.id
          bestScore = sc
        }
      }
      if (choice[item] !== best) {
        choice[item] = best
        changed = true
      }
    }
    if (!changed) break
  }
  return choice
}
