// Typed access to game data, with the same exports as src/data/game/index.ts in
// the game data PR. For now it reads mock.json, a small slice of that data
// (tiers 0-6, Caterium and Hard Drive research, some alternates). To switch to
// the real data, re-export from './game' here and delete mock.json and types.ts.
import mock from './mock.json'
import type { Building, GameMeta, Item, Progression, Recipe, Resource, Schematic } from './types'

export type * from './types'

export const items = mock.items as Item[]
export const resources = mock.resources as Resource[]
export const recipes = mock.recipes as Recipe[]
export const buildings = mock.buildings as Building[]
export const schematics = mock.schematics as Schematic[]
export const progression = mock.progression as Progression
export const gameMeta = mock.meta as GameMeta

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]))

export const itemsById = byId(items)
export const resourcesById = byId(resources)
export const recipesById = byId(recipes)
export const buildingsById = byId(buildings)
export const schematicsById = byId(schematics)

/** Recipes that output each item. */
export const recipesProducing = new Map<string, Recipe[]>()
for (const r of recipes) {
  for (const p of r.products) {
    const list = recipesProducing.get(p.item)
    if (list) list.push(r)
    else recipesProducing.set(p.item, [r])
  }
}

export const itemName = (id: string) => itemsById.get(id)?.name ?? id
