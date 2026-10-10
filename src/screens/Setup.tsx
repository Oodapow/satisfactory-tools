import { useState } from 'react'
import { progression, schematicsById, type Schematic } from '../data'
import { go } from '../router'
import {
  catalog,
  currentTier,
  emptyGameState,
  knownSchematics,
  openTiers,
  purchasable,
  throughTier,
  useGameState,
  type GameState,
} from '../state/gameState'
import { Backup } from './Backup'
import { Help } from '../ui/Help'
import { NoIconLinks } from '../ui/GameIcon'
import { Costs, SchematicIcon, Unlocks } from '../ui/SchematicIcon'
import { MamResearch } from './MamResearch'
import { SpoilerNote } from '../ui/SpoilerNote'

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

/** A tickable schematic: icon, name, and optionally its cost and unlocks. */
function Tile({
  schematic,
  checked,
  onToggle,
  detail = false,
}: {
  schematic: Schematic
  checked: boolean
  onToggle: () => void
  detail?: boolean
}) {
  return (
    // A click anywhere on the tile ticks it, so its icons are not catalog links.
    <NoIconLinks>
      <label className={checked ? 'tile done' : 'tile'}>
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <SchematicIcon schematic={schematic} size={36} />
        <span className="tile-body">
          <span className="tile-name">{schematic.name.replace('Alternate: ', '')}</span>
          {detail && schematic.cost.length > 0 && <Costs list={schematic.cost} />}
        </span>
        <span className="tile-check" aria-hidden>
          ✓
        </span>
      </label>
    </NoIconLinks>
  )
}

export function Setup() {
  const [stored, setState] = useGameState()
  const state = stored ?? emptyGameState()
  const set = (patch: Partial<GameState>) => setState({ ...state, ...patch })
  const [revealAll, setRevealAll] = useState(false)
  const [altQuery, setAltQuery] = useState('')

  const tier = currentTier(state)
  const allTiers = progression.tiers.map((t) => t.tier)
  // Only tiers the HUB would show for this game state; later ones stay hidden unless asked.
  const open = new Set(openTiers(state))
  const visibleTiers = revealAll ? allTiers : allTiers.filter((t) => open.has(t))
  const hiddenTiers = allTiers.length - visibleTiers.length
  const phases = progression.spaceElevatorPhases.filter((p) => revealAll || p.phase <= state.spaceElevatorPhase + 1)

  const owned = (id: string) => state.purchased.includes(id)
  const [tierPick, setTierPick] = useState<number | null>(null)
  const shownTiers = progression.tiers.filter((t) => visibleTiers.includes(t.tier))
  // Open on the first tier with milestones left, as the HUB does.
  const tierTab =
    shownTiers.find((t) => t.tier === tierPick) ??
    shownTiers.find((t) => t.milestones.some((id) => !owned(id))) ??
    shownTiers.at(-1)
  const alternates = knownSchematics(state, 'alternate').filter((s) => s.unlocks.recipes.length > 0)
  const altShown = alternates.filter((s) => s.name.toLowerCase().includes(altQuery.trim().toLowerCase()))
  const cat = catalog(state)
  const next = purchasable(state).filter((s) => s.type === 'milestone' || s.type === 'tutorial')
  const flip = (id: string) => set({ purchased: toggle(state.purchased, id) })
  const nextPhase = progression.spaceElevatorPhases.find((p) => p.phase === state.spaceElevatorPhase + 1)

  return (
    <div className="setup">
      <section className="panel state-head">
        <div>
          <h2>
            Your game state
            <Help text="The rest of the app only shows what's ticked here." />
          </h2>
          {state.source === 'save' && <p className="muted">{state.saveName}</p>}
        </div>
        <dl className="facts">
          <div>
            <dt>Tier</dt>
            <dd>{Math.max(tier, 0)}</dd>
          </div>
          <div>
            <dt>Space Elevator</dt>
            <dd>{state.spaceElevatorPhase ? `Phase ${state.spaceElevatorPhase}` : 'Not started'}</dd>
          </div>
          <div>
            <dt>Recipes</dt>
            <dd>{cat.recipes.length}</dd>
          </div>
          <div>
            <dt>Buildings</dt>
            <dd>{cat.buildings.length}</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h3>Next milestones</h3>
        {next.length === 0 ? (
          <p className="muted">Nothing to buy in the HUB right now. Deliver the next Space Elevator phase.</p>
        ) : (
          <ul className="next-grid">
            {next.map((m) => (
              <li key={m.id} className="next-card">
                <SchematicIcon schematic={m} size={40} />
                <div className="next-body">
                  <strong>{m.name}</strong>
                  <span className="muted small">Tier {m.tier}</span>
                  <span className="labelled">
                    <span className="label">Cost</span>
                    <Costs list={m.cost} />
                  </span>
                  <span className="labelled">
                    <span className="label">Unlocks</span>
                    <Unlocks schematic={m} size={26} />
                  </span>
                </div>
                <button type="button" className="secondary small" onClick={() => flip(m.id)}>
                  Mark done
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h3>
          How far are you?
          <Help text="Picking a tier ticks every milestone up to it. Fine-tune below." />
        </h3>
        <div className="row tier-picks">
          {visibleTiers.map((t) => (
            <button
              key={t}
              type="button"
              className={t === tier ? '' : 'secondary'}
              onClick={() => setState(throughTier(state, t))}
            >
              Tier {t}
            </button>
          ))}
        </div>

        <h3>
          Space Elevator
          <Help text="Each phase you deliver opens the next two tiers." />
        </h3>
        <div className="segmented" role="radiogroup" aria-label="Space Elevator phase">
          {[{ phase: 0, name: 'Not started' }, ...phases].map((p) => (
            <label key={p.phase}>
              <input
                type="radio"
                name="phase"
                checked={state.spaceElevatorPhase === p.phase}
                onChange={() => set({ spaceElevatorPhase: p.phase })}
              />
              <span>{p.phase === 0 ? p.name : `Phase ${p.phase}`}</span>
            </label>
          ))}
        </div>
        {nextPhase && (
          <p className="row phase-cost">
            <span className="muted small">Phase {nextPhase.phase} needs</span>
            <Costs list={nextPhase.cost} />
          </p>
        )}
      </section>

      <section className="panel">
        <h3>Milestones</h3>
        <div className="tabs subtabs" role="tablist" aria-label="Tiers">
          {shownTiers.map((t) => (
            <button
              key={t.tier}
              type="button"
              role="tab"
              aria-selected={t === tierTab}
              className={t === tierTab ? 'tab active' : 'tab'}
              onClick={() => setTierPick(t.tier)}
            >
              <span>Tier {t.tier}</span>
              <span className="tab-count">
                {t.milestones.filter(owned).length}/{t.milestones.length}
              </span>
            </button>
          ))}
        </div>
        {tierTab && (
          <div className="tiles" role="tabpanel">
            {tierTab.milestones
              .map((id) => schematicsById.get(id))
              .filter((m): m is Schematic => !!m)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((m) => (
                <Tile key={m.id} schematic={m} checked={owned(m.id)} onToggle={() => flip(m.id)} detail />
              ))}
          </div>
        )}
        <SpoilerNote
          hidden={hiddenTiers > 0 ? `${hiddenTiers} later ${hiddenTiers === 1 ? 'tier is' : 'tiers are'}` : null}
          revealed={revealAll}
          onChange={setRevealAll}
        />
      </section>

      <section className="panel">
        <h3>MAM research</h3>
        <MamResearch state={state} flip={flip} />
      </section>

      <section className="panel">
        <h3>
          Alternate recipes
          <Help text="Tick the ones you've unlocked from hard drives. Listed: alternates a hard drive could give you right now." />
        </h3>
        {alternates.length === 0 ? (
          <p className="muted">Research Hard Drives in the MAM to start finding alternates.</p>
        ) : (
          <>
            <input
              className="filter"
              value={altQuery}
              onChange={(e) => setAltQuery(e.target.value)}
              placeholder={`Filter ${alternates.length} alternates`}
            />
            <div className="tiles">
              {altShown.map((s) => (
                <Tile key={s.id} schematic={s} checked={owned(s.id)} onToggle={() => flip(s.id)} />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h3>
          Spoilers
          <Help text="How locked recipes, items and buildings show up in the catalog." />
        </h3>
        <div className="segmented" role="radiogroup" aria-label="Spoilers">
          {(
            [
              ['hide', 'Hide locked things'],
              ['blur', 'Show them blurred'],
            ] as const
          ).map(([v, label]) => (
            <label key={v}>
              <input
                type="radio"
                name="spoilers"
                checked={state.spoilers === v}
                onChange={() => set({ spoilers: v })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </section>

      <div className="sticky-cta">
        <span>
          <strong>{cat.recipes.length}</strong> recipes · <strong>{cat.buildings.length}</strong> {cat.buildings.length === 1 ? 'building' : 'buildings'} unlocked
        </span>
        <button type="button" onClick={() => go('/map')}>
          Open the factory map →
        </button>
      </div>

      <Backup />
    </div>
  )
}
