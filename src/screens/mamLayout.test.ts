import { describe, expect, it } from 'vitest'
import { progression, schematicsById } from '../data'
import { layoutTree } from './mamLayout'

describe('layoutTree', () => {
  it('puts children below their parents and never stacks two nodes in one cell', () => {
    for (const tree of progression.mamTrees) {
      const nodes = tree.nodes.map((id) => ({ id, parents: schematicsById.get(id)?.mamParents ?? [] }))
      const { placed } = layoutTree(nodes)
      const at = new Map(placed.map((p) => [p.id, p]))
      for (const n of nodes) for (const p of n.parents) expect(at.get(n.id)!.row).toBeGreaterThan(at.get(p)!.row)
      const cells = placed.map((p) => `${p.row}:${p.col}`)
      expect(new Set(cells).size).toBe(cells.length)
      expect(Math.min(...placed.map((p) => p.col))).toBe(0)
    }
  })

  it('centres a single child under its parents', () => {
    const { placed } = layoutTree([
      { id: 'a', parents: [] },
      { id: 'b', parents: [] },
      { id: 'c', parents: ['a', 'b'] },
    ])
    expect(placed.find((p) => p.id === 'c')).toEqual({ id: 'c', col: 0.5, row: 1 })
  })
})
