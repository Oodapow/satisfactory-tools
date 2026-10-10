import { describe, expect, it } from 'vitest'
import { schematics } from '../data'
import { availability } from '../data/game/availability'
import { addLink, EMPTY_GRIDS, gridOf, migratePowerLines, powerGrids, removeLinks, removeOutposts, renameGrid } from './grids'
import { solvePlan } from './network'
import type { OutpostPlan } from './types'

const all = availability({ purchased: schematics.map((s) => s.id), spaceElevatorPhase: 5 })
const plan = (patch: Partial<OutpostPlan>): OutpostPlan => ({
  id: 'test',
  name: 'Test',
  notes: '',
  goals: [],
  nodes: [],
  imports: [],
  selfPowered: false,
  createdAt: '',
  updatedAt: '',
  recipeChoices: {},
  ...patch,
})
const coal = (id: string, createdAt: string) =>
  solvePlan(plan({ id, name: `Coal ${id}`, createdAt, goals: [{ kind: 'power', mw: 200, generator: 'Desc_GeneratorCoal_C', fuel: 'Desc_Coal_C' }], nodes: [{ id: 'n', resource: 'Desc_Coal_C', purity: 'normal' }] }), all)
const works = (id: string, createdAt: string) =>
  solvePlan(plan({ id, name: `Works ${id}`, createdAt, goals: [{ kind: 'item', item: 'Desc_IronPlateReinforced_C', perMin: 20 }], recipeChoices: { Desc_IronScrew_C: 'Recipe_Screw_C' } }), all)

describe('power grids (#61)', () => {
  const p = coal('p', '1')
  const w = works('w', '2')
  const x = works('x', '3')
  const outposts = [p, w, x]

  it('puts every outpost on a grid of its own until power lines join them', () => {
    const grids = powerGrids(outposts, EMPTY_GRIDS)
    expect(grids).toHaveLength(3)
    for (const s of outposts) expect(gridOf(grids, s.plan.id)?.members).toEqual([s.plan.id])
  })

  it('joins outposts linked directly or through others into one grid', () => {
    const store = addLink(addLink(EMPTY_GRIDS, 'p', 'w'), 'w', 'x')
    const grids = powerGrids(outposts, store)
    expect(grids).toHaveLength(1)
    expect(grids[0].members).toEqual(['p', 'w', 'x'])
    expect(grids[0].links).toHaveLength(2)
  })

  it('adds up what generators make and what outposts use, per grid', () => {
    const grids = powerGrids(outposts, addLink(EMPTY_GRIDS, 'p', 'w'))
    const g = gridOf(grids, 'w')!
    expect(g.made).toBeCloseTo(200)
    expect(g.used).toBeCloseTo(p.solution.power.consumedMW + w.solution.power.consumedMW)
    expect(g.headroom).toBeCloseTo(g.made - g.used)
    expect(g.generators).toEqual([{ generator: 'Desc_GeneratorCoal_C', fuel: 'Desc_Coal_C', count: 3, mw: 200 }])
    expect(g.consumers.every((c, i, a) => i === 0 || a[i - 1].mw >= c.mw)).toBe(true)
    // The outpost left out has no generators and is short of everything it uses.
    const lone = gridOf(grids, 'x')!
    expect(lone.made).toBe(0)
    expect(lone.headroom).toBeCloseTo(-x.solution.power.consumedMW)
  })

  it('names a grid after its power plant, keeps a given name through merges, and splits again', () => {
    let store = addLink(EMPTY_GRIDS, 'p', 'w')
    expect(gridOf(powerGrids(outposts, store), 'w')!.name).toBe('Coal p grid')
    const lone = gridOf(powerGrids(outposts, store), 'x')!
    store = renameGrid(store, lone, 'North')
    store = addLink(store, 'w', 'x')
    const merged = powerGrids(outposts, store)
    expect(merged).toHaveLength(1)
    expect(merged[0].name).toBe('North')
    store = removeLinks(store, [store.links[0].id])
    expect(powerGrids(outposts, store)).toHaveLength(2)
  })

  it("doesn't add a second line between the same two outposts, or one to itself", () => {
    const store = addLink(EMPTY_GRIDS, 'p', 'w')
    expect(addLink(store, 'w', 'p')).toBe(store)
    expect(addLink(store, 'p', 'p')).toBe(store)
  })

  it('drops the lines of removed outposts', () => {
    const store = removeOutposts(addLink(addLink(EMPTY_GRIDS, 'p', 'w'), 'w', 'x'), ['x'])
    expect(store.links.map((l) => [l.a, l.b])).toEqual([['p', 'w']])
  })

  it('turns one-way power lines saved before grids into grid lines', () => {
    const store = migratePowerLines([
      { id: '1', from: 'p', to: 'w' },
      { id: '2', from: 'w', to: 'p' },
      { id: '3', from: 'p', to: 'x' },
    ])
    expect(store.links).toEqual([
      { id: '1', a: 'p', b: 'w' },
      { id: '3', a: 'p', b: 'x' },
    ])
    expect(powerGrids(outposts, store)).toHaveLength(1)
  })
})
