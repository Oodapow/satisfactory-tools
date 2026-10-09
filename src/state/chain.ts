import { buildingsById, recipesProducing, resourcesById, type Recipe } from '../data'

export const perMin = (amount: number, r: Recipe) => (amount * 60) / r.durationSeconds

export type Step = { recipe: Recipe; machines: number; powerMW: number }

export type Chain = {
  steps: Step[]
  /** Raw resources needed, per minute. */
  raw: Map<string, number>
  /** Items no available recipe can make. */
  missing: Set<string>
  powerMW: number
}

/** Recipes that make `item` in a machine, from the available set, standard recipes first. */
export function recipesFor(item: string, available: Set<string>) {
  return (recipesProducing.get(item) ?? [])
    .filter((r) => available.has(r.id) && r.kind === 'production' && r.producedIn.length > 0)
    .sort((a, b) => Number(a.alternate) - Number(b.alternate))
}

/**
 * Work backwards from a target rate to every machine needed, using the chosen
 * recipe per item (or the first available). Byproducts are ignored and power is
 * linear in machine count: good enough to size an outpost.
 */
export function buildChain(target: string, rate: number, available: Set<string>, choice: Record<string, string>): Chain {
  const runs = new Map<string, { recipe: Recipe; machines: number }>()
  const raw = new Map<string, number>()
  const missing = new Set<string>()

  const need = (item: string, r: number, depth: number) => {
    if (resourcesById.has(item)) {
      raw.set(item, (raw.get(item) ?? 0) + r)
      return
    }
    const options = recipesFor(item, available)
    const recipe = options.find((x) => x.id === choice[item]) ?? options[0]
    if (!recipe || depth > 20) {
      missing.add(item)
      return
    }
    const m = r / perMin(recipe.products.find((p) => p.item === item)!.amount, recipe)
    const prev = runs.get(recipe.id)
    runs.set(recipe.id, { recipe, machines: (prev?.machines ?? 0) + m })
    for (const x of recipe.ingredients) need(x.item, perMin(x.amount, recipe) * m, depth + 1)
  }
  need(target, rate, 0)

  const steps = [...runs.values()].map(({ recipe, machines }) => ({
    recipe,
    machines,
    powerMW: machines * (buildingsById.get(recipe.producedIn[0])?.powerConsumptionMW ?? 0),
  }))
  return { steps, raw, missing, powerMW: steps.reduce((s, x) => s + x.powerMW, 0) }
}

/** Items per minute one extractor yields on a normal node, using the best unlocked one. */
export function extractorRate(item: string, buildings: Set<string>) {
  const res = resourcesById.get(item)
  const rates = (res?.extractors ?? [])
    .filter((b) => buildings.has(b))
    .map((b) => buildingsById.get(b)!)
    .filter((b) => b.extractor)
    .map((b) => {
      const e = b.extractor!
      const fluid = res!.form !== 'solid'
      return { name: b.name, perMin: ((e.itemsPerCycle / (fluid ? 1000 : 1)) * 60) / e.cycleSeconds }
    })
    .sort((a, b) => b.perMin - a.perMin)
  return rates[0] ?? null
}
