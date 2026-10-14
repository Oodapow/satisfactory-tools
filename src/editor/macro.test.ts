import type { PowerGrid } from '../plan/grids'
import { describe, expect, it } from 'vitest'
import { schematics } from '../data'
import { availability } from '../data/game/availability'
import { solvePlan } from '../plan/network'
import type { OutpostPlan } from '../plan/types'
import { fitTransport, transportsFor } from '../plan/unlocked'
import { facePorts, footprint, inHandleOf, MAP_G, mapBlock, NEW_IN, outHandleOf, POWER_IN, POWER_OUT, snap, type MapLink } from './macro'

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
    expect(new Set(b.ins.map((p) => p.at)).size).toBe(3)
    expect(b.powerIn?.id).toBe(POWER_IN)
    expect(b.powerIn!.at).toBeGreaterThan(Math.max(...b.ins.map((p) => p.at)))
  })

  it('is at least as big as its largest floor, with every point inside', () => {
    const f = footprint(works, both, noLines, 3, 2)
    const b = mapBlock(works, both, noLines, 3, 2)
    expect(f.x).toBeGreaterThan(0)
    expect(b.w).toBeGreaterThanOrEqual(f.x * 2)
    expect(b.h).toBeGreaterThanOrEqual(f.y * 2)
    for (const p of [...b.ins, ...b.outs]) expect(p.at).toBeLessThan(b.h)
  })

  it('puts unlinked imports on the left edge and exports on the right', () => {
    expect(mapBlock(works, both, noLines, 3, 2).ins.every((p) => p.side === 'l')).toBe(true)
    expect(mapBlock(mine, both, noLines, 3, 2).outs.every((p) => p.side === 'r')).toBe(true)
  })

  describe('points facing their links', () => {
    const blocks = new Map([mine, works].map((s) => [s.plan.id, mapBlock(s, both, noLines, 3, 2)]))
    const links: MapLink[] = [
      { source: 'mine', sourceHandle: outHandleOf('Desc_OreIron_C'), target: 'works', targetHandle: inHandleOf('a') },
      { source: 'mine', sourceHandle: outHandleOf('Desc_Coal_C'), target: 'works', targetHandle: inHandleOf('b') },
    ]
    const at = (mx: number, my: number, wx: number, wy: number) =>
      facePorts(blocks, new Map([['mine', { x: mx * MAP_G, y: my * MAP_G }], ['works', { x: wx * MAP_G, y: wy * MAP_G }]]), links)
    const side = (b: ReturnType<typeof at>, id: string, handle: string) => {
      const x = b.get(id)!
      return [...x.ins, ...x.outs, x.powerIn, x.powerOut].find((p) => p?.id === handle)!
    }

    it('keeps the usual sides when the exporter is on the left', () => {
      const b = at(0, 0, 60, 0)
      expect(side(b, 'mine', outHandleOf('Desc_OreIron_C')).side).toBe('r')
      expect(side(b, 'works', inHandleOf('a')).side).toBe('l')
    })

    it('swaps sides when the exporter moves to the right', () => {
      const b = at(60, 0, 0, 0)
      expect(side(b, 'mine', outHandleOf('Desc_OreIron_C')).side).toBe('l')
      expect(side(b, 'works', inHandleOf('a')).side).toBe('r')
      // Unlinked points stay where they were.
      expect(side(b, 'works', NEW_IN).side).toBe('l')
    })

    it('moves to the top or bottom edge when the other block is above or below', () => {
      const b = at(0, 0, 0, 60)
      expect(side(b, 'mine', outHandleOf('Desc_OreIron_C')).side).toBe('b')
      expect(side(b, 'works', inHandleOf('a')).side).toBe('t')
    })

    it('slides along the edge to sit level with the other block, never on top of another point', () => {
      const low = at(0, 0, 60, 4)
      const high = at(0, 0, 60, -4)
      const a = (b: ReturnType<typeof at>) => side(b, 'mine', outHandleOf('Desc_OreIron_C')).at
      expect(a(low)).toBeGreaterThan(a(high))
      const outs = low.get('mine')!.outs.filter((p) => p.side === 'r').map((p) => p.at)
      for (let i = 1; i < outs.length; i++) expect(Math.abs(outs[i] - outs[i - 1])).toBeGreaterThanOrEqual(2)
      for (const p of [...low.get('mine')!.outs, ...low.get('works')!.ins]) {
        const len = p.side === 'l' || p.side === 'r' ? low.get(p.id.startsWith('out') ? 'mine' : 'works')!.h : low.get(p.id.startsWith('out') ? 'mine' : 'works')!.w
        expect(p.at).toBeGreaterThan(0)
        expect(p.at).toBeLessThan(len)
      }
    })

    it('turns power points to face their power lines too', () => {
      const lined = [{ id: 'g', name: 'Grid', members: ['mine', 'works'], links: [{ id: 'l', a: 'works', b: 'mine' }] }] as unknown as PowerGrid[]
      const pb = new Map([mine, works].map((s) => [s.plan.id, mapBlock(s, both, lined, 3, 2)]))
      const b = facePorts(pb, new Map([['mine', { x: 0, y: 0 }], ['works', { x: 60 * MAP_G, y: 0 }]]), [
        { source: 'works', sourceHandle: POWER_OUT, target: 'mine', targetHandle: POWER_IN },
      ])
      expect(b.get('works')!.powerOut?.side).toBe('l')
      expect(b.get('mine')!.powerIn?.side).toBe('r')
    })
  })

  it('snaps positions to the grid', () => {
    expect(snap({ x: 23, y: 9 })).toEqual({ x: MAP_G, y: MAP_G })
  })
})
