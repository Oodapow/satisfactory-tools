import { buildingsById, itemsById, progression, recipesById, recipesProducing, resourcesById } from '../data'
import type { Availability } from '../data/game/availability'
import type { Building, BuildingId, ItemId, Recipe, RecipeId } from '../data'
import type { ExtractionStep, ItemFlow, OutpostPlan, OutpostSolution, Purity } from './types'

export const perMin = (amount: number, r: Recipe) => (amount * 60) / r.durationSeconds

/** Recipes that make `item` in a machine from the available set, standard ones first. */
export function recipesFor(item: ItemId, available: Set<RecipeId>) {
  return (recipesProducing.get(item) ?? [])
    .filter((r) => available.has(r.id) && r.kind === 'production' && r.producedIn.length > 0)
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

/**
 * Derive machines, power and flows for a plan. Demand is walked back from the
 * goals; imports are used before producing locally; resources come from the
 * plan's nodes. Anything left over (byproducts, unused node output) is exported.
 */
export function solve(plan: OutpostPlan, available: Availability, suggested: Choice = {}): OutpostSolution {
  const choose = (item: ItemId) => {
    const options = recipesFor(item, available.recipes)
    return (
      options.find((r) => r.id === plan.recipeChoices[item]) ??
      options.find((r) => r.id === suggested[item]) ??
      options[0]
    )
  }

  const powerGoal = plan.goals.find((g) => g.kind === 'power')
  let generatedMW = powerGoal?.mw ?? 0
  let result!: ReturnType<typeof walk>
  // Generators' fuel chain draws power too, so iterate a few times when self-powered.
  for (let i = 0; i < 6; i++) {
    result = walk(generatedMW)
    if (!powerGoal || !plan.selfPowered) break
    const next = powerGoal.mw + result.consumedMW
    if (Math.abs(next - generatedMW) < 1e-6) break
    generatedMW = next
  }
  return result.solution

  function walk(mw: number) {
    const flows = new Map<ItemId, ItemFlow>()
    const flow = (item: ItemId) => {
      let f = flows.get(item)
      if (!f) flows.set(item, (f = { item, extracted: 0, imported: 0, produced: 0, consumed: 0, exported: 0, shortfall: 0 }))
      return f
    }
    const pool = new Map<ItemId, number>()
    for (const imp of plan.imports) {
      pool.set(imp.item, (pool.get(imp.item) ?? 0) + imp.perMin)
      flow(imp.item).imported += imp.perMin
    }
    const runs = new Map<RecipeId, number>()
    const rawDemand = new Map<ItemId, number>()
    const recipes: Choice = {}

    const need = (item: ItemId, rate: number, depth: number) => {
      const fromPool = Math.min(pool.get(item) ?? 0, rate)
      if (fromPool > 0) pool.set(item, (pool.get(item) ?? 0) - fromPool)
      const rest = rate - fromPool
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
      const m = rest / perMin(recipe.products.find((p) => p.item === item)!.amount, recipe)
      runs.set(recipe.id, (runs.get(recipe.id) ?? 0) + m)
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
        generators.push({ generator: powerGoal.generator, fuel: fuel.id, machines: mw / gen.powerProductionMW, mw })
      }
    }

    const steps = [...runs].map(([id, machines]) => {
      const recipe = recipesById.get(id)!
      for (const p of recipe.products) flow(p.item).produced += perMin(p.amount, recipe) * machines
      const building = recipe.producedIn[0]
      return { recipe: id, building, machines, powerMW: machines * (buildingsById.get(building)?.powerConsumptionMW ?? 0) }
    })

    // Every node runs at full speed; what the outpost doesn't use is exported.
    const extraction: ExtractionStep[] = []
    for (const node of plan.nodes) {
      const b = (node.extractor && buildingsById.get(node.extractor)) || extractorsFor(node.resource, available.buildings)[0]
      if (!b) continue
      const rate = extractorPerMin(b, node.resource, node.purity)
      flow(node.resource).extracted += rate
      extraction.push({ resource: node.resource, extractor: b.id, node: node.id, machines: 1, perMin: rate, powerMW: b.powerConsumptionMW })
    }
    for (const [item, demand] of rawDemand) {
      const f = flow(item)
      const missing = demand - f.extracted
      if (missing <= 1e-9) continue
      const pump = nodelessExtractor(item, available.buildings)
      if (pump) {
        const machines = missing / extractorPerMin(pump, item)
        f.extracted += missing
        extraction.push({ resource: item, extractor: pump.id, machines, perMin: missing, powerMW: machines * pump.powerConsumptionMW })
      } else f.shortfall += missing
    }

    for (const f of flows.values()) {
      f.exported = Math.max(0, f.extracted + f.produced + f.imported - f.consumed - (pool.get(f.item) ?? 0))
    }
    // Unused imports aren't exports: they simply aren't needed.
    const consumedMW = steps.reduce((s, x) => s + x.powerMW, 0) + extraction.reduce((s, x) => s + x.powerMW, 0)
    const solution: OutpostSolution = {
      steps,
      generators,
      extraction,
      flows,
      power: { consumedMW, generatedMW: mw, exportedMW: plan.selfPowered ? mw - consumedMW : mw },
      recipes,
    }
    return { solution, consumedMW }
  }
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
  const machines = s.steps.reduce((n, x) => n + Math.ceil(x.machines - 1e-9), 0)
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
      const options = recipesFor(item, available.recipes)
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
