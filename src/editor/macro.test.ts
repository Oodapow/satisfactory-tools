import type { PowerGrid } from '../plan/grids'
import { describe, expect, it } from 'vitest'
import { schematics } from '../data'
import { availability } from '../data/game/availability'
import { solvePlan } from '../plan/network'
import type { OutpostPlan } from '../plan/types'
import { fitTransport, transportsFor } from '../plan/unlocked'
import { footprint, MAP_G, mapBlock, NEW_IN, outHandleOf, POWER_IN, snap } from './macro'

const all = availability({ purchased: schematics.map((s) => s.id), spaceElevatorPhase: 5 })
const plan = (id: string, patch: Partial<OutpostPlan>): OutpostPlan => ({
  id,
  name: id,
  notes: '',
  goals: [],
  nodes: [],
  imports: [],
  recipeChoices: {},
  selfPowered: false,
  createdAt: '',
  updatedAt: '',
  ...patch,
})
const noLines: PowerGrid[] = []

describe('transport per item', () => {
  it('keeps fluids in pipes and solids off them', () => {
    expect(transportsFor('Desc_Water_C')).toEqual(['pipe', 'train'])
    expect(transportsFor('Desc_Rotor_C')).not.toContain('pipe')
    expect(fitTransport('Desc_Water_C', 'belt')).toBe('pipe')
    expect(fitTransport('Desc_Rotor_C', 'pipe')).toBe('belt')
    expect(fitTransport('Desc_Rotor_C', 'truck')).toBe('truck')
  })
})

describe('factory map blocks', () => {
  const mine = solvePlan(plan('mine', { nodes: [{ id: 'n1', resource: 'Desc_OreIron_C', purity: 'pure' }, { id: 'n2', resource: 'Desc_Coal_C', purity: 'normal' }] }), all)
  const works = solvePlan(
    plan('works', {
      goals: [{ kind: 'item', item: 'Desc_IronPlate_C', perMin: 20 }],
      imports: [
        { id: 'a', from: 'mine', item: 'Desc_OreIron_C', perMin: 30, via: 'belt' },
        { id: 'b', from: 'mine', item: 'Desc_Coal_C', perMin: 10, via: 'truck' },
      ],
    }),
    all,
  )
  const both = [mine, works]

  it('gives an extraction site one export point per resource and no goal', () => {
    const b = mapBlock(mine, both, noLines, 3, 2)
    expect(b.outs.map((p) => p.id)).toEqual([outHandleOf('Desc_OreIron_C'), outHandleOf('Desc_Coal_C')])
    // Only the free import point.
    expect(b.ins.map((p) => p.id)).toEqual([NEW_IN])
  })

  it('gives every import its own point, plus one free point below them', () => {
    const b = mapBlock(works, both, noLines, 3, 2)
    expect(b.ins.map((p) => p.id)).toEqual(['in:a', 'in:b', NEW_IN])
    expect(new Set(b.ins.map((p) => p.dy)).size).toBe(3)
    expect(b.powerIn?.id).toBe(POWER_IN)
    expect(b.powerIn!.dy).toBeGreaterThan(Math.max(...b.ins.map((p) => p.dy)))
  })

  it('is at least as big as its largest floor, with every point inside', () => {
    const f = footprint(works, both, noLines, 3, 2)
    const b = mapBlock(works, both, noLines, 3, 2)
    expect(f.x).toBeGreaterThan(0)
    expect(b.w).toBeGreaterThanOrEqual(f.x * 2)
    expect(b.h).toBeGreaterThanOrEqual(f.y * 2)
    for (const p of [...b.ins, ...b.outs]) expect(p.dy).toBeLessThan(b.h)
  })

  it('snaps positions to the grid', () => {
    expect(snap({ x: 23, y: 9 })).toEqual({ x: MAP_G, y: MAP_G })
  })
})
