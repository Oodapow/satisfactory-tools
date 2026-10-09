import { useState } from 'react'
import { buildingsById, itemName } from '../data'
import { go } from '../router'
import { catalog, purchasable, type GameState } from '../state/gameState'
import { useOutposts } from '../state/outposts'
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

export function Planner({ state }: { state: GameState }) {
  const [tab, setTab] = useState<Tab>('recipes')
  const [q, setQ] = useState('')
  const { add } = useOutposts()
  const cat = catalog(state)
  const blur = state.spoilers === 'blur'
  const match = (name: string) => name.toLowerCase().includes(q.trim().toLowerCase())

  const planFor = (item: string) => {
    const id = add(`${itemName(item)} outpost`, { target: { item, perMin: 10 } })
    go(`/outposts/${id}`)
  }
  const makeable = new Set(cat.recipes.flatMap((r) => r.products.map((p) => p.item)))
  const next = purchasable(state).filter((s) => s.type === 'milestone' || s.type === 'tutorial')

  return (
    <div className="planner">
      <aside className="panel next-up">
        <h3>Next milestones</h3>
        {next.length === 0 && <p className="muted small">Nothing to buy right now. Deliver the next Space Elevator phase.</p>}
        <ul className="plain">
          {next.map((m) => (
            <li key={m.id}>
              <strong>{m.name}</strong>
              <span className="muted small">
                Tier {m.tier} · {m.cost.map((c) => `${c.amount} ${itemName(c.item)}`).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      </aside>

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
                    <h4>{r.name.replace('Alternate: ', '')}</h4>
                    {r.alternate && <span className="badge">Alternate</span>}
                  </header>
                  <p className="muted small">{r.producedIn.map((b) => buildingsById.get(b)?.name).join(', ')}</p>
                  <div className="flow">
                    <Rates list={r.ingredients} recipe={r} />
                    <span className="arrow">→</span>
                    <Rates list={r.products} recipe={r} />
                  </div>
                  <span className="muted small">per minute</span>
                </article>
              ))}
          {tab === 'recipes' && !q && <Locked count={cat.lockedRecipes} noun="recipes" blur={blur} />}

          {tab === 'items' &&
            cat.items
              .filter((i) => match(i.name))
              .map((i) => (
                <article key={i.id} className="card item">
                  <h4>{i.name}</h4>
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
                  <h4>{b.name}</h4>
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
