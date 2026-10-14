import { describe, expect, it } from 'vitest'
import { lineEnds } from './io'

describe('line ends on the floor plan', () => {
  it('marks each line source as an output and its target as an input', () => {
    const ends = lineEnds([{ id: 'a', type: 'belt', source: 'j1', sourceHandle: 'out', target: 'j2', targetHandle: 'in' }])
    expect(ends.get('j1:out')).toBe('out')
    expect(ends.get('j2:in')).toBe('in')
  })
})
