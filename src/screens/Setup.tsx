import { useState } from 'react'
import { itemName, progression, schematicsById } from '../data'
import { go } from '../router'
import {
  catalog,
  currentTier,
  emptyGameState,
  knownSchematics,
  openTiers,
  throughTier,
  useGameState,
  type GameState,
} from '../state/gameState'
import { Backup } from './Backup'

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

const costText = (id: string) =>
  schematicsById
    .get(id)
    ?.cost.map((c) => `${c.amount} ${itemName(c.item)}`)
    .join(', ')

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
  const [openTrees, setOpenTrees] = useState<string[]>([])
  const research = [...knownSchematics(state, 'hard-drive'), ...knownSchematics(state, 'mam')].filter(
    (r) => !r.events?.length && r.name,
  )
  const allTrees = [...new Set(research.map((r) => r.mamTree ?? 'Other'))].sort()
  // A tree's first nodes are offered as soon as the MAM is built, so a tree stays folded
  // until the player has researched something in it or opens it, keeping tree names a surprise.
  const started = (tree: string) =>
    openTrees.includes(tree) || research.some((r) => (r.mamTree ?? 'Other') === tree && owned(r.id))
  const trees = allTrees.filter(started)
  const unstarted = allTrees.filter((t) => !started(t))
  const alternates = knownSchematics(state, 'alternate').filter((s) => s.unlocks.recipes.length > 0)
  const altShown = alternates.filter((s) => s.name.toLowerCase().includes(altQuery.trim().toLowerCase()))
  const cat = catalog(state)

  return (
    <div className="setup">
      <section className="panel">
        <h2>Your game state</h2>
        <p className="muted">
          {state.source === 'save' ? `Loaded from ${state.saveName}. ` : ''}The rest of the app only shows what's ticked here.
        </p>

        <h3>How far are you?</h3>
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
        <p className="muted small">Picking a tier ticks every milestone up to it. Fine-tune below.</p>

        <h3>Space Elevator</h3>
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
        <p className="muted small">Each phase you deliver opens the next two tiers.</p>
      </section>

      <section className="panel">
        <h3>Milestones</h3>
        {progression.tiers
          .filter((t) => visibleTiers.includes(t.tier))
          .map((t) => (
            <fieldset key={t.tier} className="tier">
              <legend>{t.tier === 0 ? 'Tier 0 · HUB upgrades' : `Tier ${t.tier}`}</legend>
              {[...t.milestones]
                .sort((a, b) => (schematicsById.get(a)?.name ?? '').localeCompare(schematicsById.get(b)?.name ?? ''))
                .map((id) => (
                  <label key={id} className="check">
                    <input
                      type="checkbox"
                      checked={owned(id)}
                      onChange={() => set({ purchased: toggle(state.purchased, id) })}
                    />
                    <span>{schematicsById.get(id)?.name}</span>
                    <span className="muted small">{costText(id)}</span>
                  </label>
                ))}
            </fieldset>
          ))}
        {hiddenTiers > 0 && (
          <p className="spoiler-note">
            {hiddenTiers} later {hiddenTiers === 1 ? 'tier is' : 'tiers are'} hidden to avoid spoilers.{' '}
            <button type="button" className="link" onClick={() => setRevealAll(true)}>
              Show anyway
            </button>
          </p>
        )}
      </section>

      <section className="panel">
        <h3>MAM research</h3>
        {research.length === 0 && <p className="muted">Build the MAM (Tier 1, Field Research) to start researching.</p>}
        {trees.map((tree) => (
          <fieldset key={tree} className="tier">
            <legend>{tree === 'HardDrive' ? 'Hard Drives' : tree}</legend>
            <div className="alt-grid">
              {research
                .filter((r) => (r.mamTree ?? 'Other') === tree)
                .map((r) => (
                  <label key={r.id} className="check">
                    <input
                      type="checkbox"
                      checked={owned(r.id)}
                      onChange={() => set({ purchased: toggle(state.purchased, r.id) })}
                    />
                    <span>{r.name}</span>
                  </label>
                ))}
            </div>
          </fieldset>
        ))}
        {unstarted.length > 0 && (
          <div className="row tree-picks">
            <span className="muted small">Started another tree?</span>
            {unstarted.map((t) => (
              <button key={t} type="button" className="secondary small" onClick={() => setOpenTrees([...openTrees, t])}>
                {t === 'HardDrive' ? 'Hard Drives' : t}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h3>Alternate recipes</h3>
        {alternates.length === 0 ? (
          <p className="muted">Research Hard Drives in the MAM to start finding alternates.</p>
        ) : (
          <>
            <p className="muted small">
              Tick the ones you've unlocked from hard drives. Listed: alternates a hard drive could give you right now.
            </p>
            <input
              className="filter"
              value={altQuery}
              onChange={(e) => setAltQuery(e.target.value)}
              placeholder={`Filter ${alternates.length} alternates`}
            />
            <div className="alt-grid">
              {altShown.map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    checked={owned(s.id)}
                    onChange={() => set({ purchased: toggle(state.purchased, s.id) })}
                  />
                  <span>{s.name.replace('Alternate: ', '')}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h3>Spoilers</h3>
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
