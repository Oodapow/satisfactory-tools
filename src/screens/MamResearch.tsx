import { useLayoutEffect, useRef, useState } from 'react'
import { progression, schematicsById, type Schematic } from '../data'
import { availability, type GameState } from '../state/gameState'
import { NoIconLinks } from '../ui/GameIcon'
import { Costs, SchematicIcon } from '../ui/SchematicIcon'
import { layoutTree } from './mamLayout'

const HARD_DRIVE = 'Research_HardDrive_0_C'
// Seasonal trees (FICSMAS) only show in the MAM while their event runs.
const trees = [
  ...progression.mamTrees.filter((t) => t.nodes.every((id) => !schematicsById.get(id)?.events?.length)),
  { id: 'HardDrive', name: 'Hard Drives', nodes: [HARD_DRIVE] },
].sort((a, b) => a.name.localeCompare(b.name))

// Grid cell and card size in pixels; lines run between the cards.
const CELL_W = 160
const CELL_H = 172
const CARD_W = 146
const CARD_H = 136

/** What the player gets to see of a node, as the MAM shows it. */
type Seen = 'done' | 'open' | 'locked' | 'unknown' | 'hidden'

export function MamResearch({ state, flip }: { state: GameState; flip: (id: string) => void }) {
  const [tab, setTab] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)
  const owned = (id: string) => state.purchased.includes(id)

  if (!availability(state).buildings.has('Desc_Mam_C')) {
    return <p className="muted">Build the MAM (Tier 1, Field Research) to start researching.</p>
  }

  const progress = (nodes: string[]) => nodes.filter(owned).length
  // Open on the first tree with research under way, like returning to the MAM.
  const current = trees.find((t) => t.id === tab) ?? trees.find((t) => progress(t.nodes) > 0) ?? trees[0]

  return (
    <>
      <div className="tabs subtabs" role="tablist" aria-label="Research trees">
        {trees.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t === current}
            className={t === current ? 'tab active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            <span>{t.name}</span>
            <span className="tab-count">
              {progress(t.nodes)}/{t.nodes.length}
            </span>
          </button>
        ))}
      </div>
      <Tree key={current.id} nodes={current.nodes} owned={owned} flip={flip} reveal={reveal} />
      <p className="spoiler-note">
        {reveal ? (
          <>
            Showing the whole tree.{' '}
            <button type="button" className="link" onClick={() => setReveal(false)}>
              Hide spoilers
            </button>
          </>
        ) : (
          <>
            Research you can't start yet stays a <b>?</b>, and what lies past it stays hidden, as in the MAM.{' '}
            <button type="button" className="link" onClick={() => setReveal(true)}>
              Show anyway
            </button>
          </>
        )}
      </p>
    </>
  )
}

function Tree({
  nodes: ids,
  owned,
  flip,
  reveal,
}: {
  nodes: string[]
  owned: (id: string) => boolean
  flip: (id: string) => void
  reveal: boolean
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // A tree wider than the screen opens scrolled to its middle, where the first nodes sit.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }, [])
  const nodes = ids.map((id) => schematicsById.get(id)).filter((s): s is Schematic => !!s)
  const parents = (s: Schematic) => s.mamParents ?? []
  const { placed, cols, rows } = layoutTree(nodes.map((s) => ({ id: s.id, parents: parents(s) })))
  const at = new Map(placed.map((p) => [p.id, p]))

  const seen = new Map<string, Seen>()
  for (const s of nodes) {
    const ps = parents(s)
    if (owned(s.id)) seen.set(s.id, 'done')
    else if (ps.length === 0 || ps.some(owned)) seen.set(s.id, 'open')
  }
  // One step past what can be researched shows as a locked "?"; anything deeper is not drawn.
  for (const s of nodes) {
    if (seen.has(s.id)) continue
    const nearOpen = parents(s).some((p) => seen.get(p) === 'open')
    seen.set(s.id, reveal ? 'locked' : nearOpen ? 'unknown' : 'hidden')
  }

  const x = (col: number) => col * CELL_W + (CELL_W - CARD_W) / 2 + CARD_W / 2
  const y = (row: number) => row * CELL_H
  const edges = nodes.flatMap((s) =>
    parents(s)
      .filter((p) => seen.get(p) !== 'hidden' && seen.get(s.id) !== 'hidden')
      .map((p) => ({ from: at.get(p)!, to: at.get(s.id)!, done: seen.get(p) === 'done', key: `${p}>${s.id}` })),
  )
  const height = Math.max(...placed.filter((p) => seen.get(p.id) !== 'hidden').map((p) => p.row), 0) + 1

  return (
    <div className="mam-scroll" ref={scroller}>
      <div className="mam-tree" style={{ width: cols * CELL_W, height: (reveal ? rows : height) * CELL_H - (CELL_H - CARD_H) }}>
        <svg className="mam-lines" width={cols * CELL_W} height={rows * CELL_H} aria-hidden>
          {edges.map(({ from, to, done, key }) => {
            const mid = y(to.row) - (CELL_H - CARD_H) / 2
            return (
              <path
                key={key}
                className={done ? 'done' : ''}
                d={`M${x(from.col)},${y(from.row) + CARD_H} V${mid} H${x(to.col)} V${y(to.row)}`}
              />
            )
          })}
        </svg>
        {nodes.map((s) => {
          const p = at.get(s.id)!
          const how = seen.get(s.id)!
          if (how === 'hidden') return null
          const style = { left: p.col * CELL_W + (CELL_W - CARD_W) / 2, top: y(p.row), width: CARD_W, height: CARD_H }
          if (how === 'unknown') {
            return (
              <div key={s.id} className="mam-node unknown" style={style} aria-label="Locked research">
                ?
              </div>
            )
          }
          const canTick = how !== 'locked'
          return (
            <NoIconLinks key={s.id}>
              <label className={`mam-node ${how}`} style={style} title={canTick ? undefined : 'Research a node above it first'}>
                <input type="checkbox" checked={how === 'done'} disabled={!canTick} onChange={() => flip(s.id)} />
                <span className="mam-node-head">
                  <SchematicIcon schematic={s} size={32} />
                  <span className="tile-check" aria-hidden>
                    ✓
                  </span>
                </span>
                <span className="mam-node-name">{s.name}</span>
                {s.cost.length > 0 && <Costs list={s.cost} />}
              </label>
            </NoIconLinks>
          )
        })}
      </div>
    </div>
  )
}
