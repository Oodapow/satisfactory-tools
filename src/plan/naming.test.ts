import { describe, expect, it } from 'vitest'
import { autoName, isAutoName, nameAfter } from './naming'
import type { Goal, ResourceNode } from './types'

const node = (resource: string): ResourceNode => ({ id: resource + Math.random(), resource, purity: 'normal' })
const plate: Goal = { kind: 'item', item: 'Desc_IronPlate_C', perMin: 60 }

describe('outpost names', () => {
  it('names an outpost after what it delivers, else what it mines', () => {
    expect(autoName({ goals: [], nodes: [] }, 'Outpost 3')).toBe('Outpost 3')
    expect(autoName({ goals: [], nodes: [node('Desc_OreCopper_C'), node('Desc_OreIron_C'), node('Desc_OreIron_C')] })).toBe('Iron Ore ×2 · Copper Ore')
    expect(autoName({ goals: [plate], nodes: [node('Desc_OreIron_C')] })).toBe('Iron Plate × 60')
  })

  it('follows the outpost while the name is ours, and keeps a typed one', () => {
    const mined = { name: 'Iron Ore', goals: [], nodes: [node('Desc_OreIron_C')] }
    expect(isAutoName(mined)).toBe(true)
    expect(nameAfter(mined, { goals: [plate], nodes: mined.nodes })).toBe('Iron Plate × 60')
    expect(nameAfter({ ...mined, name: 'Outpost 2' }, { goals: [], nodes: [] })).toBe('Outpost 2')
    expect(nameAfter({ ...mined, name: 'Iron Plate outpost' }, { goals: [plate], nodes: [] })).toBe('Iron Plate × 60')
    const typed = { ...mined, name: 'Home base' }
    expect(isAutoName(typed)).toBe(false)
    expect(nameAfter(typed, { goals: [plate], nodes: [] })).toBe('Home base')
  })
  it('leaves raw resources out of the name unless they are all it delivers', () => {
    const ore: Goal = { kind: 'item', item: 'Desc_OreIron_C', perMin: 120 }
    expect(autoName({ goals: [plate, ore], nodes: [] })).toBe('Iron Plate × 60')
    expect(autoName({ goals: [ore], nodes: [] })).toBe('Iron Ore × 120')
  })
  it('renames outposts still carrying the old "Item 60/min" name', () => {
    const old = { name: 'Iron Plate 60/min', goals: [plate], nodes: [] }
    expect(isAutoName(old)).toBe(true)
    expect(nameAfter(old, { goals: [{ ...plate, perMin: 30 }], nodes: [] })).toBe('Iron Plate × 30')
  })
})
