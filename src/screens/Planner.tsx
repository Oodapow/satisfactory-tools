import { useState } from 'react'
import { buildingsById } from '../data'
import { go } from '../router'
import { catalog, type GameState } from '../state/gameState'
import { autoName } from '../plan/naming'
import { blankPlan, useOutposts } from '../plan/store'
import type { Goal } from '../plan/types'
import { GameIcon } from '../ui/GameIcon'
import { Rates } from './Rates'

type Tab = 'recipes' | 'items' | 'buildings'

function Locked({ count, noun, blur }: { count: number; noun: string; blur: boolean }) {
  if (count === 0) return null
  if (!blur) return <p className="spoiler-note">🔒 {count} more {noun} unlock as you progress.</p>
  return (
    <>
      {Array.from({ length: Math.min(count, 12) }, (_, i) => (
        <article key={i} className="card locked" aria-label={`Locked ${noun}`}>
          <span className="bar w60" />
          <span className="bar w90" />
          <span className="badge muted-badge">Locked</span>
        </article>
      ))}
      {count > 12 && <p className="spoiler-note">…and {count - 12} more locked {noun}.</p>}
    </>
  )
}

/** Catalog tab for a search opened from an icon: buildings for a building, else recipes when any match, else items. */
function startTab(kind: string | undefined, query: string, recipeNames: string[]): Tab {
  if (kind === 'buildings') return 'buildings'
  const q = query.toLowerCase()
  if (kind === 'items' && !recipeNames.some((n) => n.toLowerCase().includes(q))) return 'items'
  return 'recipes'
}

export function Planner({ state, kind, query = '' }: { state: GameState; kind?: string; query?: string }) {
  const cat = catalog(state)
  const [tab, setTab] = useState<Tab>(() => startTab(kind, query, cat.recipes.map((r) => r.name)))
  const [q, setQ] = useState(query)
  const { save } = useOutposts()
  const blur = state.spoilers === 'blur'
  const match = (name: string) => name.toLowerCase().includes(q.trim().toLowerCase())

  const planFor = (item: string) => {
    const goals: Goal[] = [{ kind: 'item', item, perMin: 10 }]
    const plan = blankPlan(autoName({ goals, nodes: [] }), { goals })
    save(plan)
    go(`/outposts/${plan.id}/resources`)
  }
  const makeable = new Set(cat.recipes.flatMap((r) => r.products.map((p) => p.item)))

  return (
    <div className="planner">
      <section className="panel catalog">
        <div className="toolbar">
          <div className="tabs" role="tablist">
            {(
              [
                ['recipes', `Recipes (${cat.recipes.length})`],
                ['items', `Items (${cat.items.length})`],
                ['buildings', `Buildings (${cat.buildings.length})`],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'tab active' : 'tab'}
                onClick={() => setTab(t)}
              >
                {label}
              </button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search" />
        </div>

        <div className="cards">
          {tab === 'recipes' &&
            cat.recipes
              .filter((r) => match(r.name))
              .map((r) => (
                <article key={r.id} className="card recipe">
                  <header>
                    <h4 className="with-icon">
                      <GameIcon id={r.products[0].item} size={28} />
                      <span className="ellipsis" title={r.name}>{r.name.replace('Alternate: ', '')}</span>
                    </h4>
                    {r.alternate && <span className="badge">Alt</span>}
                  </header>
                  <div className="flow">
                    <Rates list={r.ingredients} recipe={r} compact />
                    <span className="arrow">→</span>
                    <Rates list={r.products} recipe={r} compact />
                  </div>
                  <p className="muted small machines">
                    {r.producedIn.filter((b) => cat.available.buildings.has(b)).map((b) => (
                      <span key={b} className="with-icon">
                        <GameIcon id={b} size={20} />
                        <span className="rate-name">{buildingsById.get(b)?.name}</span>
                      </span>
                    ))}
                  </p>
                </article>
              ))}
          {tab === 'recipes' && !q && <Locked count={cat.lockedRecipes} noun="recipes" blur={blur} />}

          {tab === 'items' &&
            cat.items
              .filter((i) => match(i.name))
              .map((i) => (
                <article key={i.id} className="card item">
                  <h4 className="with-icon">
                    <GameIcon id={i.id} size={28} />
                    {i.name}
                  </h4>
                  {i.category === 'resource' ? (
                    <span className="badge muted-badge">Resource</span>
                  ) : makeable.has(i.id) ? (
                    <button type="button" className="secondary small" onClick={() => planFor(i.id)}>
                      Plan an outpost
                    </button>
                  ) : (
                    <span className="badge muted-badge">Not made in machines</span>
                  )}
                </article>
              ))}
          {tab === 'items' && !q && <Locked count={cat.lockedItems} noun="items" blur={blur} />}

          {tab === 'buildings' &&
            cat.buildings
              .filter((b) => match(b.name))
              .map((b) => (
                <article key={b.id} className="card">
                  <h4 className="with-icon">
                    <GameIcon id={b.id} size={28} />
                    {b.name}
                  </h4>
                  <p className="muted small">
                    {b.generator
                      ? `Makes ${b.generator.powerProductionMW} MW`
                      : b.powerConsumptionMW
                        ? `Uses ${b.powerConsumptionMW} MW`
                        : 'No power needed'}
                  </p>
                </article>
              ))}
          {tab === 'buildings' && !q && <Locked count={cat.lockedBuildings} noun="buildings" blur={blur} />}
        </div>
      </section>
    </div>
  )
}
