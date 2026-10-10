// Power grids (#61). Power is not an import: every outpost sits on exactly one grid, and
// everything inside an outpost is on that grid. Outposts joined by power lines, directly or
// through others, share a grid; an outpost with no power lines is a grid of its own. A grid's
// generators are all its members' generators, and its consumption all their machines.
import type { Solved } from './network'
import type { OutpostId } from './types'

const EPS = 1e-6

/** A power line between two outposts. It has no direction: power flows wherever the grid needs it. */
export type PowerLink = { id: string; a: OutpostId; b: OutpostId }

/** What is stored: the lines, and names given to grids (keyed by the grid's id, see PowerGrid.id). */
export type GridStore = { links: PowerLink[]; names: Record<string, string> }

export type GridGenerators = { generator: string; fuel: string; count: number; mw: number }
export type GridConsumer = { id: OutpostId; name: string; mw: number }

export interface PowerGrid {
  /** Its oldest outpost's id: stays put while outposts join or leave. */
  id: string
  name: string
  /** Set when the player named it. */
  named: boolean
  members: OutpostId[]
  links: PowerLink[]
  made: number
  used: number
  /** Made minus used; below zero the grid is short. */
  headroom: number
  generators: GridGenerators[]
  /** Outposts that use power, most first. */
  consumers: GridConsumer[]
}

export const EMPTY_GRIDS: GridStore = { links: [], names: {} }

const oldestFirst = (a: Solved, b: Solved) => a.plan.createdAt.localeCompare(b.plan.createdAt) || a.plan.id.localeCompare(b.plan.id)

/** Every grid on the map, the biggest first. Lines to outposts that no longer exist are ignored. */
export function powerGrids(all: Solved[], store: GridStore): PowerGrid[] {
  const byId = new Map(all.map((s) => [s.plan.id, s]))
  const links = store.links.filter((l) => l.a !== l.b && byId.has(l.a) && byId.has(l.b))

  // Union-find over the outposts.
  const parent = new Map(all.map((s) => [s.plan.id, s.plan.id]))
  const find = (x: string): string => {
    const p = parent.get(x)!
    if (p === x) return x
    const r = find(p)
    parent.set(x, r)
    return r
  }
  for (const l of links) parent.set(find(l.a), find(l.b))

  const groups = new Map<string, Solved[]>()
  for (const s of all) {
    const r = find(s.plan.id)
    groups.set(r, [...(groups.get(r) ?? []), s])
  }

  const grids = [...groups.values()].map((members) => {
    members.sort(oldestFirst)
    const ids = new Set(members.map((m) => m.plan.id))
    const id = members[0].plan.id
    // A name given to a grid that has since merged into this one still counts.
    const given = store.names[id] ?? members.map((m) => store.names[m.plan.id]).find(Boolean)
    const made = members.reduce((t, s) => t + s.solution.power.generatedMW, 0)
    const used = members.reduce((t, s) => t + s.solution.power.consumedMW, 0)
    const gens = new Map<string, GridGenerators>()
    for (const s of members)
      for (const g of s.solution.generators) {
        const key = `${g.generator}|${g.fuel}`
        const x = gens.get(key) ?? { generator: g.generator, fuel: g.fuel, count: 0, mw: 0 }
        x.count += Math.ceil(g.machines - EPS)
        x.mw += g.mw
        gens.set(key, x)
      }
    // Named after its biggest power plant, or its oldest outpost.
    const plant = [...members].sort((a, b) => b.solution.power.generatedMW - a.solution.power.generatedMW)[0]
    const fallback = `${(plant.solution.power.generatedMW > EPS ? plant : members[0]).plan.name} grid`
    return {
      id,
      name: given || fallback,
      named: !!given,
      members: members.map((m) => m.plan.id),
      links: links.filter((l) => ids.has(l.a)),
      made,
      used,
      headroom: made - used,
      generators: [...gens.values()].sort((a, b) => b.mw - a.mw),
      consumers: members
        .filter((s) => s.solution.power.consumedMW > EPS)
        .map((s) => ({ id: s.plan.id, name: s.plan.name, mw: s.solution.power.consumedMW }))
        .sort((a, b) => b.mw - a.mw),
    }
  })
  return grids.sort((a, b) => b.members.length - a.members.length || b.made + b.used - (a.made + a.used))
}

/** The grid an outpost is on. */
export const gridOf = (grids: PowerGrid[], outpost: OutpostId) => grids.find((g) => g.members.includes(outpost))

/** Grids that make or use any power: the ones worth showing. */
export const activeGrids = (grids: PowerGrid[]) => grids.filter((g) => g.made > EPS || g.used > EPS || g.members.length > 1)

/** A new line, unless the two are already on the same grid line or are the same outpost. */
export function addLink(store: GridStore, a: OutpostId, b: OutpostId, id: string = crypto.randomUUID()): GridStore {
  if (a === b || store.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return store
  return { ...store, links: [...store.links, { id, a, b }] }
}

export function removeLinks(store: GridStore, ids: string[]): GridStore {
  return { ...store, links: store.links.filter((l) => !ids.includes(l.id)) }
}

/** Drop the lines of outposts that are gone. */
export function removeOutposts(store: GridStore, ids: OutpostId[]): GridStore {
  return { ...store, links: store.links.filter((l) => !ids.includes(l.a) && !ids.includes(l.b)) }
}

export function renameGrid(store: GridStore, grid: PowerGrid, name: string): GridStore {
  const names = { ...store.names }
  // One name per grid: forget names its members carried from before a merge.
  for (const m of grid.members) delete names[m]
  if (name.trim()) names[grid.id] = name
  return { ...store, names }
}

/**
 * Power lines saved before grids existed: one-way lines with a fixed MW, sent from a
 * generator outpost to another. Each becomes a plain line between the two, so the same
 * outposts end up on one grid.
 */
export function migratePowerLines(old: { id: string; from: string; to: string }[] | undefined): GridStore {
  let store = EMPTY_GRIDS
  for (const l of Array.isArray(old) ? old : []) if (l?.from && l.to) store = addLink(store, l.from, l.to, l.id)
  return store
}
