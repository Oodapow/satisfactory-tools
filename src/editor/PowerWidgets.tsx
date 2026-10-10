// Power on the factory map's side panel, drawn as gauges and lists rather than sentences (#66).
// For now every outpost shares one grid: generators feed it, and an outpost that doesn't run on
// its own generators draws from it.
import { itemName } from '../data'
import { displayName, POWER } from '../data/icons'
import type { Solved } from '../plan/network'
import { GameIcon } from '../ui/GameIcon'
import { fmt } from './generate'
import { gridBalance } from './power'
import type { PowerLine } from './model'

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

/** The whole map's power grid: balance, generators and who draws from it. */
export function GridPanel({ all, onSelect }: { all: Solved[]; onSelect: (id: string) => void }) {
  const g = gridBalance(all)
  if (g.made < EPS && g.used < EPS) return null
  const short = g.headroom < -EPS
  return (
    <section className="pw-card" aria-label="Power grid">
      <header className="pw-head">
        <GameIcon id={POWER} size={20} link={false} />
        <span className="ne-grow">Power grid</span>
        <span className={`pw-pill ${short ? 'bad' : 'good'}`}>{short ? 'Short' : 'OK'}</span>
      </header>
      <div className="pw-tiles">
        <Tile mw={g.made} label="made" />
        <Tile mw={g.used} label="used" />
        <Tile mw={Math.abs(g.headroom)} label={short ? 'short' : 'spare'} tone={short ? 'bad' : 'good'} />
      </div>
      <PowerMeter made={g.made} used={g.used} label="Grid power used" />
      {g.generators.length > 0 && (
        <>
          <h5 className="pw-sub">Generators</h5>
          <ul className="pw-rows">
            {g.generators.map((x) => (
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
      )}
      {g.consumers.length > 0 && (
        <>
          <h5 className="pw-sub">Used by</h5>
          <ul className="pw-rows">
            {g.consumers.map((c) => (
              <li key={c.id}>
                <button type="button" className="ghost pw-row-btn" onClick={() => onSelect(c.id)} title={c.own ? 'Runs on its own generators' : 'Draws from the grid'}>
                  <span className="ne-grow pw-name">
                    {c.name}
                    <span className="pw-share">
                      <span style={{ width: `${(c.mw / Math.max(g.used, EPS)) * 100}%` }} />
                    </span>
                  </span>
                  <b className="pw-mw">{fmt(c.mw)} MW</b>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** One outpost's power: what it uses, what it makes, and where the rest comes from or goes. */
export function OutpostPower({ solved, all, powerLines }: { solved: Solved; all: Solved[]; powerLines: PowerLine[] }) {
  const { plan, solution } = solved
  const { consumedMW: used, generatedMW: made, exportedMW } = solution.power
  if (used < EPS && made < EPS) return null
  const nameOf = (id: string) => all.find((s) => s.plan.id === id)?.plan.name ?? '?'
  const own = plan.selfPowered && made > EPS
  const lines = [
    ...powerLines.filter((l) => l.to === plan.id).map((l) => ({ id: l.id, dir: 'from' as const, other: nameOf(l.from), mw: l.mw })),
    ...powerLines.filter((l) => l.from === plan.id).map((l) => ({ id: l.id, dir: 'to' as const, other: nameOf(l.to), mw: l.mw })),
  ]
  const sent = lines.filter((l) => l.dir === 'to').reduce((t, l) => t + l.mw, 0)
  return (
    <section className="pw-card" aria-label="Outpost power">
      <header className="pw-head">
        <GameIcon id={POWER} size={20} link={false} />
        <span className="ne-grow">Power</span>
        {own && used > made + EPS && <span className="pw-pill bad">Short</span>}
      </header>
      <div className="pw-tiles">
        <Tile mw={used} label="uses" />
        {made > EPS && <Tile mw={made} label="makes" />}
        {own ? (
          used > made + EPS && <Tile mw={used - made} label="short" tone="bad" />
        ) : (
          used > EPS && <Tile mw={used} label="from the grid" />
        )}
        {exportedMW > EPS && <Tile mw={exportedMW} label="to the grid" tone="good" />}
      </div>
      {/* What it makes against what is spoken for: its own machines, and the lines to other outposts. */}
      {made > EPS && <PowerMeter made={made} used={(own ? used : 0) + sent} label="Power spoken for" />}
      {lines.length > 0 && (
        <>
          <h5 className="pw-sub">Power lines</h5>
          <ul className="pw-rows">
            {lines.map((l) => (
              <li key={l.id}>
                <span className="pw-dir">{l.dir === 'from' ? '←' : '→'}</span>
                <span className="ne-grow">
                  {l.dir} {l.other}
                </span>
                <b className="pw-mw">{fmt(l.mw)} MW</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
