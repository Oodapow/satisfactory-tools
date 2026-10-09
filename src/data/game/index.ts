// Typed access to the generated game data. Import from here, not from the JSON files.
import itemsJson from './items.json'
import resourcesJson from './resources.json'
import recipesJson from './recipes.json'
import buildingsJson from './buildings.json'
import schematicsJson from './schematics.json'
import progressionJson from './progression.json'
import metaJson from './meta.json'
import type { Building, GameMeta, Item, Progression, Recipe, Resource, Schematic } from './types'

export type * from './types'

export const items = itemsJson as Item[]
export const resources = resourcesJson as Resource[]
export const recipes = recipesJson as Recipe[]
export const buildings = buildingsJson as Building[]
export const schematics = schematicsJson as Schematic[]
export const progression = progressionJson as Progression
export const gameMeta = metaJson as GameMeta

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]))

export const itemsById = byId(items)
export const resourcesById = byId(resources)
export const recipesById = byId(recipes)
export const buildingsById = byId(buildings)
export const schematicsById = byId(schematics)

/** Placed-actor class (Build_*, as in save files) to building descriptor. */
export const buildingsByBuildClass = new Map(
  buildings.filter((b) => b.buildClass).map((b) => [b.buildClass as string, b]),
)

/** Recipes that output each item. */
export const recipesProducing = new Map<string, Recipe[]>()
/** Recipes that consume each item. */
export const recipesConsuming = new Map<string, Recipe[]>()
for (const r of recipes) {
  for (const p of r.products) push(recipesProducing, p.item, r)
  for (const i of r.ingredients) push(recipesConsuming, i.item, r)
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
