import { useState, type ReactNode } from 'react'
import { buildingsById, groupByTaxonomy, taxonomy, type Building, type Item, type Recipe } from '../data'
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
  const [category, setCategory] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const { save } = useOutposts()
  const blur = state.spoilers === 'blur'

  const planFor = (item: string) => {
    const goals: Goal[] = [{ kind: 'item', item, perMin: 10 }]
    const plan = blankPlan(autoName({ goals, nodes: [] }), { goals })
    save(plan)
    go(`/outposts/${plan.id}/resources`)
  }
  const makeable = new Set(cat.recipes.flatMap((r) => r.products.map((p) => p.item)))

  const lc = q.trim().toLowerCase()
  const match = (name: string) => name.toLowerCase().includes(lc)

  // Every tab is grouped like the game groups it: buildings by build menu, items (and recipes,
  // by what they make) by item category. Only unlocked things are listed, so empty groups never show.
  const tree =
    tab === 'recipes'
      ? groupByTaxonomy(taxonomy.items, cat.recipes.filter((r) => match(r.name)), (r) => r.products[0].item)
      : tab === 'items'
        ? groupByTaxonomy(taxonomy.items, cat.items.filter((i) => match(i.name)), (i) => i.id)
        : groupByTaxonomy(taxonomy.buildings, cat.buildings.filter((b) => match(b.name)), (b) => b.id)
  const shownCategory = tree.some((c) => c.id === category) ? category : null
  const shown = shownCategory ? tree.filter((c) => c.id === shownCategory) : tree
  const total = tree.reduce((n, c) => n + count(c), 0)

  // Groups start collapsed so the page stays short; a search opens every group that matches.
  const searching = lc !== ''
  const allGroupKeys = shown.flatMap((c) => c.groups.map((g) => `${c.id}/${g.id}`))
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const pickTab = (t: Tab) => {
    setTab(t)
    setCategory(null)
    setOpen(new Set())
  }

  const recipeCard = (r: Recipe) => (
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
  )

  const itemCard = (i: Item) => (
    <article key={i.id} className="card item">
      <h4 className="with-icon">
        <GameIcon id={i.id} size={28} />
        <span className="ellipsis" title={i.name}>{i.name}</span>
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
  )

  const buildingCard = (b: Building) => (
    <article key={b.id} className="card">
      <h4 className="with-icon">
        <GameIcon id={b.id} size={28} />
        <span className="ellipsis" title={b.name}>{b.name}</span>
      </h4>
      <p className="muted small">
        {b.generator
          ? `Makes ${b.generator.powerProductionMW} MW`
          : b.powerConsumptionMW
            ? `Uses ${b.powerConsumptionMW} MW`
            : 'No power needed'}
      </p>
    </article>
  )

  const card = (x: Recipe | Item | Building): ReactNode =>
    tab === 'recipes' ? recipeCard(x as Recipe) : tab === 'items' ? itemCard(x as Item) : buildingCard(x as Building)

  const locked =
    tab === 'recipes'
      ? { count: cat.lockedRecipes, noun: 'recipes' }
      : tab === 'items'
        ? { count: cat.lockedItems, noun: 'items' }
        : { count: cat.lockedBuildings, noun: 'buildings' }

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
                onClick={() => pickTab(t)}
              >
                {label}
              </button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search" />
        </div>

        <div className="catalog-body">
          <nav className="catalog-nav" aria-label="Categories">
            <button
              type="button"
              className={shownCategory === null ? 'cat-link active' : 'cat-link'}
              aria-current={shownCategory === null}
              onClick={() => setCategory(null)}
            >
              <span>All</span>
              <span className="cat-count">{total}</span>
            </button>
            {tree.map((c) => (
              <button
                key={c.id}
                type="button"
                className={shownCategory === c.id ? 'cat-link active' : 'cat-link'}
                aria-current={shownCategory === c.id}
                onClick={() => setCategory(c.id)}
              >
                <span>{c.name}</span>
                <span className="cat-count">{count(c)}</span>
              </button>
            ))}
          </nav>

          <div className="catalog-groups">
            {tree.length === 0 && <p className="muted">Nothing matches “{q.trim()}”.</p>}
            {tree.length > 0 && (
              <div className="group-actions">
                <button type="button" className="link" onClick={() => setOpen(new Set(allGroupKeys))}>Expand all</button>
                <button type="button" className="link" onClick={() => setOpen(new Set())}>Collapse all</button>
              </div>
            )}
            {shown.map((c) => (
              <section key={c.id} className="catalog-category" aria-labelledby={`cat-${c.id}`}>
                <h3 id={`cat-${c.id}`} className="category-title">
                  {c.name} <span className="cat-count">{count(c)}</span>
                </h3>
                {c.groups.map((g) => {
                  const key = `${c.id}/${g.id}`
                  const members = g.members as (Recipe | Item | Building)[]
                  const isOpen = searching || open.has(key)
                  return (
                    <details key={g.id} className="catalog-group" open={isOpen}>
                      <summary
                        onClick={(e) => {
                          e.preventDefault()
                          if (!searching) toggle(key)
                        }}
                      >
                        <span className="group-title">{g.name}</span>
                        <span className="cat-count">{g.members.length}</span>
                        {!isOpen && (
                          <span className="group-preview" aria-hidden="true">
                            {members.slice(0, 12).map((m) => (
                              <GameIcon key={m.id} id={'products' in m ? m.products[0].item : m.id} size={22} link={false} />
                            ))}
                            {members.length > 12 && <span className="cat-count">+{members.length - 12}</span>}
                          </span>
                        )}
                      </summary>
                      {isOpen && <div className={tab === 'recipes' ? 'cards' : 'cards compact'}>{members.map(card)}</div>}
                    </details>
                  )
                })}
              </section>
            ))}
            {!q && shownCategory === null && (
              <div className="cards">
                <Locked count={locked.count} noun={locked.noun} blur={blur} />
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

const count = (c: { groups: { members: unknown[] }[] }) => c.groups.reduce((n, g) => n + g.members.length, 0)
