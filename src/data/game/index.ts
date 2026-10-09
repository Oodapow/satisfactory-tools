// Typed access to the generated game data. Import from here, not from the JSON files.
import itemsJson from './items.json'
import resourcesJson from './resources.json'
import recipesJson from './recipes.json'
import buildingsJson from './buildings.json'
import schematicsJson from './schematics.json'
import progressionJson from './progression.json'
import metaJson from './meta.json'
import taxonomyJson from './taxonomy.json'
import type { Building, GameMeta, Item, Progression, Recipe, Resource, Schematic, Taxonomy, TaxonomyCategory } from './types'

export type * from './types'

export const items = itemsJson as Item[]
export const resources = resourcesJson as Resource[]
export const recipes = recipesJson as Recipe[]
export const buildings = buildingsJson as Building[]
export const schematics = schematicsJson as Schematic[]
export const progression = progressionJson as Progression
export const gameMeta = metaJson as GameMeta
export const taxonomy = taxonomyJson as Taxonomy

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

/** Where an item or building sits in the taxonomy: its category and group. */
export const taxonomyOf = new Map<string, { category: TaxonomyCategory; group: TaxonomyCategory['groups'][number] }>()
for (const category of [...taxonomy.items, ...taxonomy.buildings]) {
  for (const group of category.groups) for (const id of group.members) taxonomyOf.set(id, { category, group })
}

/**
 * Sorts `things` into the taxonomy `tree`, in display order, keeping only the categories and groups
 * that have something in them. Ids the tree does not list end up in a trailing "Other" group.
 */
export function groupByTaxonomy<T>(tree: TaxonomyCategory[], things: T[], idOf: (t: T) => string) {
  const byId = new Map<string, T[]>()
  for (const t of things) push(byId, idOf(t), t)
  const placed = new Set(tree.flatMap((c) => c.groups.flatMap((g) => g.members)))
  const out: { id: string; name: string; groups: { id: string; name: string; members: T[] }[] }[] = []
  for (const category of tree) {
    const groups = category.groups
      .map((g) => ({ id: g.id, name: g.name, members: g.members.flatMap((id) => byId.get(id) ?? []) }))
      .filter((g) => g.members.length > 0)
    if (groups.length) out.push({ id: category.id, name: category.name, groups })
  }
  const rest = things.filter((t) => !placed.has(idOf(t)))
  if (rest.length) out.push({ id: 'other', name: 'Other', groups: [{ id: 'other', name: 'Other', members: rest }] })
  return out
}
