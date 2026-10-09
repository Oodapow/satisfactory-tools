import { describe, expect, it } from 'vitest'
import { buildings, groupByTaxonomy, items, taxonomy, taxonomyOf } from './game'

describe('taxonomy', () => {
  it('places every item and building in exactly one group', () => {
    for (const x of [...items, ...buildings]) expect(taxonomyOf.has(x.id), x.id).toBe(true)
  })

  it('groups buildings like the build menu', () => {
    expect(taxonomyOf.get('Desc_ConstructorMk1_C')?.group.name).toBe('Manufacturers')
    expect(taxonomyOf.get('Desc_ConstructorMk1_C')?.category.name).toBe('Production')
  })

  it('keeps only non-empty groups, in display order', () => {
    const picked = ['Desc_IronPlate_C', 'Desc_OreIron_C', 'Desc_Wire_C'].map((id) => items.find((i) => i.id === id)!)
    const tree = groupByTaxonomy(taxonomy.items, picked, (i) => i.id)
    expect(tree.map((c) => c.name)).toEqual(['Resources', 'Parts'])
    expect(tree[1].groups.map((g) => g.name)).toEqual(['Standard Parts', 'Electronics'])
  })

  it('puts unknown ids in a trailing Other group', () => {
    const tree = groupByTaxonomy(taxonomy.items, ['nope'], (x) => x)
    expect(tree).toEqual([{ id: 'other', name: 'Other', groups: [{ id: 'other', name: 'Other', members: ['nope'] }] }])
  })
})
