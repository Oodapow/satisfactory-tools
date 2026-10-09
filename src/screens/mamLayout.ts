// Grid positions for a MAM research tree, drawn top to bottom like the in-game MAM:
// a node sits one row below its lowest parent, and roughly under the middle of its parents.

export interface TreeNodeInput {
  id: string
  parents: string[]
}

export interface Placed {
  id: string
  /** Column; whole numbers, 0 at the left. */
  col: number
  row: number
}

export function layoutTree(nodes: TreeNodeInput[]): { placed: Placed[]; cols: number; rows: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const order = new Map(nodes.map((n, i) => [n.id, i]))
  const rowOf = new Map<string, number>()
  const row = (id: string, seen = new Set<string>()): number => {
    const known = rowOf.get(id)
    if (known !== undefined) return known
    // A cycle or missing parent would be a data error; treat it as a root rather than recurse forever.
    if (seen.has(id)) return 0
    seen.add(id)
    const parents = (byId.get(id)?.parents ?? []).filter((p) => byId.has(p))
    const r = parents.length ? 1 + Math.max(...parents.map((p) => row(p, seen))) : 0
    rowOf.set(id, r)
    return r
  }
  for (const n of nodes) row(n.id)

  const rows = Math.max(0, ...rowOf.values()) + 1
  const x = new Map<string, number>()
  for (let r = 0; r < rows; r++) {
    const layer = nodes.filter((n) => rowOf.get(n.id) === r)
    const want = (n: TreeNodeInput) => {
      const px = n.parents.map((p) => x.get(p)).filter((v): v is number => v !== undefined)
      return px.length ? px.reduce((a, b) => a + b, 0) / px.length : 0
    }
    const desired = layer.map((n, i) => ({ n, at: r === 0 ? i : want(n) }))
    desired.sort((a, b) => a.at - b.at || (order.get(a.n.id) ?? 0) - (order.get(b.n.id) ?? 0))
    // Spread them one column apart, then slide the whole row so it stays centred under its parents.
    const spread = desired.map((d, i) => ({ ...d, col: i }))
    for (let i = 1; i < spread.length; i++) spread[i].col = Math.max(spread[i].at, spread[i - 1].col + 1)
    const shift = spread.reduce((s, d) => s + (d.at - d.col), 0) / Math.max(1, spread.length)
    for (const d of spread) x.set(d.n.id, d.col + shift)
  }

  // Snap to half columns, then move everything so the leftmost node is at column 0.
  const snapped = nodes.map((n) => ({ id: n.id, col: Math.round((x.get(n.id) ?? 0) * 2) / 2, row: rowOf.get(n.id) ?? 0 }))
  for (let r = 0; r < rows; r++) {
    const layer = snapped.filter((p) => p.row === r).sort((a, b) => a.col - b.col)
    for (let i = 1; i < layer.length; i++) layer[i].col = Math.max(layer[i].col, layer[i - 1].col + 1)
  }
  const min = Math.min(...snapped.map((p) => p.col))
  for (const p of snapped) p.col -= min
  const cols = Math.max(0, ...snapped.map((p) => p.col)) + 1
  return { placed: snapped, cols, rows }
}
