import { describe, expect, it } from 'vitest'
import { poleHandle } from './grid'
import { lineEnds, powerRole } from './io'
import type { BeltEdge, MicroNode } from './model'

const machine = (id: string, building: string): MicroNode => ({ id, type: 'machine', position: { x: 0, y: 0 }, data: { kind: 'machine', building, recipe: '', clock: 1, count: 1, floor: 0 } })
const pole: MicroNode = { id: 'pole', type: 'pole', position: { x: 0, y: 0 }, data: { kind: 'pole', floor: 0, tier: 1 } }
const wire = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string): BeltEdge => ({ id, type: 'belt', source, sourceHandle, target, targetHandle, data: { medium: 'power' } })

describe('line ends on the floor plan', () => {
  const gen = machine('gen', 'Desc_GeneratorCoal_C')
  const user = machine('user', 'Desc_ConstructorMk1_C')

  it('knows which way each block\'s power point faces', () => {
    expect(powerRole(gen.data)).toBe('out')
    expect(powerRole(user.data)).toBe('in')
    expect(powerRole(pole.data)).toBeUndefined()
  })

  it('turns power lines drawn backwards to run from the generator to the machine', () => {
    // Both drawn from the far end.
    const edges = [wire('a', 'user', 'power', 'pole', poleHandle(0)), wire('b', 'pole', poleHandle(1), 'gen', 'power')]
    const { ends, flipped } = lineEnds([gen, pole, user], edges)
    expect([...flipped].sort()).toEqual(['a', 'b'])
    expect(ends.get('gen:power')).toBe('out')
    expect(ends.get(`pole:${poleHandle(1)}`)).toBe('in')
    expect(ends.get(`pole:${poleHandle(0)}`)).toBe('out')
    expect(ends.get('user:power')).toBe('in')
  })

  it('leaves power lines drawn the right way alone', () => {
    const edges = [wire('a', 'gen', 'power', 'pole', poleHandle(0)), wire('b', 'pole', poleHandle(1), 'user', 'power')]
    expect(lineEnds([gen, pole, user], edges).flipped.size).toBe(0)
  })
})
