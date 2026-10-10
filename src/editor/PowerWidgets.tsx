// Power on the factory map's side panel, drawn as gauges and lists rather than sentences (#66).
// Each power grid (#61) gets its own card: outposts joined by power lines share one, and an
// outpost with no power lines is a grid of its own.
import { useState } from 'react'
import { itemName } from '../data'
import { displayName, POWER } from '../data/icons'
import type { PowerGrid } from '../plan/grids'
import type { Solved } from '../plan/network'
import { GameIcon } from '../ui/GameIcon'
import { fmt } from './generate'

const EPS = 1e-6

/** A bar of what is used against what is made; anything used beyond that shows red. */
export function PowerMeter({ made, used, label }: { made: number; used: number; label?: string }) {
  const full = Math.max(made, used, EPS)
  const ok = Math.min(used, made)
  const short = Math.max(0, used - made)
  const pct = (v: number) => `${(v / full) * 100}%`
  const title = made > EPS ? `${fmt((used / made) * 100)}% of ${fmt(made)} MW used` : `${fmt(used)} MW used, nothing made`
  return (
    <div className="pw-meter" role="meter" aria-label={label ?? 'Power used'} aria-valuemin={0} aria-valuemax={made} aria-valuenow={used} title={title}>
      <span className="pw-fill" style={{ width: pct(ok) }} />
      {short > EPS && <span className="pw-fill pw-over" style={{ width: pct(short) }} />}
    </div>
  )
}

function Tile({ mw, label, tone }: { mw: number; label: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`pw-tile${tone ? ` ${tone}` : ''}`}>
      <b>
        {fmt(mw)}
        <small> MW</small>
      </b>
      <span>{label}</span>
    </div>
  )
}

const isShort = (g: PowerGrid) => g.headroom < -EPS

function Status({ grid }: { grid: PowerGrid }) {
  const short = isShort(grid)
  const idle = grid.made < EPS && grid.used < EPS
  return <span className={`pw-pill ${idle ? '' : short ? 'bad' : 'good'}`}>{idle ? 'No power' : short ? 'Short' : 'OK'}</span>
}

function Balance({ grid }: { grid: PowerGrid }) {
  const short = isShort(grid)
  return (
    <>
      <div className="pw-tiles">
        <Tile mw={grid.made} label="made" />
        <Tile mw={grid.used} label="used" />
        <Tile mw={Math.abs(grid.headroom)} label={short ? 'short' : 'spare'} tone={short ? 'bad' : 'good'} />
      </div>
      <PowerMeter made={grid.made} used={grid.used} label={`${grid.name} power used`} />
    </>
  )
}

function Generators({ grid }: { grid: PowerGrid }) {
  if (!grid.generators.length) return <p className="ne-help">No generators on this grid. Draw a power line to an outpost that makes power.</p>
  return (
    <>
      <h5 className="pw-sub">Generators</h5>
      <ul className="pw-rows">
        {grid.generators.map((x) => (
          <li key={`${x.generator}|${x.fuel}`}>
            <GameIcon id={x.generator} size={22} link={false} />
            <span className="ne-grow">
              {x.count} × {displayName(x.generator)}
              <span className="pw-fuel">
                <GameIcon id={x.fuel} size={14} link={false} /> {itemName(x.fuel)}
              </span>
            </span>
            <b className="pw-mw">{fmt(x.mw)} MW</b>
          </li>
        ))}
      </ul>
    </>
  )
}

function Consumers({ grid, onSelect }: { grid: PowerGrid; onSelect: (id: string) => void }) {
  if (!grid.consumers.length) return null
  return (
    <>
      <h5 className="pw-sub">Used by</h5>
      <ul className="pw-rows">
        {grid.consumers.map((c) => (
          <li key={c.id}>
            <button type="button" className="ghost pw-row-btn" onClick={() => onSelect(c.id)}>
              <span className="ne-grow pw-name">
                {c.name}
                <span className="pw-share">
                  <span style={{ width: `${(c.mw / Math.max(grid.used, EPS)) * 100}%` }} />
                </span>
              </span>
              <b className="pw-mw">{fmt(c.mw)} MW</b>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/** One grid at a glance. Clicking its name selects it, which highlights its outposts and power lines on the map. */
export function GridCard({
  grid,
  selected,
  onSelectGrid,
  onSelect,
}: {
  grid: PowerGrid
  selected?: boolean
  onSelectGrid: (id: string) => void
  onSelect: (id: string) => void
}) {
  return (
    <section className={`pw-card${selected ? ' selected' : ''}`} aria-label={grid.name}>
      <header className="pw-head">
        <GameIcon id={POWER} size={20} link={false} />
        <button type="button" className="ghost pw-title ne-grow" onClick={() => onSelectGrid(grid.id)} title="Show this grid on the map">
          {grid.name}
          <small>
            {grid.members.length} outpost{grid.members.length === 1 ? '' : 's'}
          </small>
        </button>
        <Status grid={grid} />
      </header>
      <Balance grid={grid} />
      <Generators grid={grid} />
      <Consumers grid={grid} onSelect={onSelect} />
    </section>
  )
}

/** Every grid on the map, one card each. */
export function GridList({ grids, onSelectGrid, onSelect }: { grids: PowerGrid[]; onSelectGrid: (id: string) => void; onSelect: (id: string) => void }) {
  if (!grids.length) return null
  return (
    <>
      <h4>Power grids</h4>
      {grids.map((g) => (
        <GridCard key={g.id} grid={g} onSelectGrid={onSelectGrid} onSelect={onSelect} />
      ))}
    </>
  )
}

/** A selected grid: its balance, its name, its outposts and the power lines that join them. */
export function GridInspector({
  grid,
  all,
  onRename,
  onRemoveLink,
  onSelect,
}: {
  grid: PowerGrid
  all: Solved[]
  onRename: (name: string) => void
  onRemoveLink: (id: string) => void
  onSelect: (id: string) => void
}) {
  const byId = new Map(all.map((s) => [s.plan.id, s]))
  const nameOf = (id: string) => byId.get(id)?.plan.name ?? '?'
  return (
    <section>
      <h3>Power grid</h3>
      <label className="ne-field">
        Name
        <input value={grid.name} placeholder={grid.name} onChange={(e) => onRename(e.target.value)} />
      </label>
      <section className="pw-card selected" aria-label={grid.name}>
        <header className="pw-head">
          <GameIcon id={POWER} size={20} link={false} />
          <span className="ne-grow">Balance</span>
          <Status grid={grid} />
        </header>
        <Balance grid={grid} />
        <Generators grid={grid} />
      </section>
      <h4>Outposts</h4>
      <ul className="pw-rows">
        {grid.members.map((id) => {
          const p = byId.get(id)?.solution.power
          return (
            <li key={id}>
              <button type="button" className="ghost pw-row-btn" onClick={() => onSelect(id)}>
                <span className="ne-grow">{nameOf(id)}</span>
                {p && p.generatedMW > EPS && <b className="pw-mw good">+{fmt(p.generatedMW)} MW</b>}
                {p && p.consumedMW > EPS && <b className="pw-mw">−{fmt(p.consumedMW)} MW</b>}
              </button>
            </li>
          )
        })}
      </ul>
      <h4>Power lines</h4>
      {grid.links.length ? (
        <ul className="pw-rows">
          {grid.links.map((l) => (
            <li key={l.id}>
              <span className="pw-dir">⚡</span>
              <span className="ne-grow">
                {nameOf(l.a)} — {nameOf(l.b)}
              </span>
              <button type="button" className="ghost" aria-label="Remove power line" onClick={() => onRemoveLink(l.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ne-help">One outpost on its own. Draw a power line from it to another outpost to put both on one grid.</p>
      )}
    </section>
  )
}

/** One outpost's power: what it uses and makes, the grid it is on, and its power lines. */
export function OutpostPower({
  solved,
  grid,
  all,
  onSelectGrid,
  onAddLink,
  onRemoveLink,
}: {
  solved: Solved
  grid: PowerGrid | undefined
  all: Solved[]
  onSelectGrid: (id: string) => void
  onAddLink: (other: string) => void
  onRemoveLink: (id: string) => void
}) {
  const { plan, solution } = solved
  const { consumedMW: used, generatedMW: made } = solution.power
  const [pick, setPick] = useState('')
  const nameOf = (id: string) => all.find((s) => s.plan.id === id)?.plan.name ?? '?'
  const lines = (grid?.links ?? []).filter((l) => l.a === plan.id || l.b === plan.id).map((l) => ({ id: l.id, other: l.a === plan.id ? l.b : l.a }))
  const linked = new Set(lines.map((l) => l.other))
  const candidates = all.filter((s) => s.plan.id !== plan.id && !linked.has(s.plan.id))
  return (
    <section className="pw-card" aria-label="Outpost power">
      <header className="pw-head">
        <GameIcon id={POWER} size={20} link={false} />
        <span className="ne-grow">Power</span>
        {grid && <Status grid={grid} />}
      </header>
      <div className="pw-tiles">
        <Tile mw={used} label="uses" />
        {made > EPS && <Tile mw={made} label="makes" tone="good" />}
        {grid && <Tile mw={Math.abs(grid.headroom)} label={isShort(grid) ? 'grid short' : 'grid spare'} tone={isShort(grid) ? 'bad' : 'good'} />}
      </div>
      {grid && (
        <>
          <button type="button" className="ghost pw-row-btn pw-grid-link" onClick={() => onSelectGrid(grid.id)} title="Show this grid on the map">
            <span className="ne-grow pw-name">
              On {grid.name}
              <PowerMeter made={grid.made} used={grid.used} label={`${grid.name} power used`} />
            </span>
            <span className="pw-mw">
              {fmt(grid.used)} / {fmt(grid.made)} MW
            </span>
          </button>
        </>
      )}
      <h5 className="pw-sub">Power lines</h5>
      {lines.length ? (
        <ul className="pw-rows">
          {lines.map((l) => (
            <li key={l.id}>
              <span className="pw-dir">⚡</span>
              <span className="ne-grow">{nameOf(l.other)}</span>
              <button type="button" className="ghost" aria-label={`Remove power line to ${nameOf(l.other)}`} onClick={() => onRemoveLink(l.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ne-help">None: this outpost is a grid of its own.</p>
      )}
      {candidates.length > 0 && (
        <div className="ne-offer-row">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Outpost to run a power line to" className="ne-grow">
            <option value="">Power line to…</option>
            {candidates.map((s) => (
              <option key={s.plan.id} value={s.plan.id}>
                {s.plan.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ghost"
            disabled={!pick}
            onClick={() => {
              onAddLink(pick)
              setPick('')
            }}
          >
            Connect
          </button>
        </div>
      )}
    </section>
  )
}
