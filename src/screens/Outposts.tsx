import { useState } from 'react'
import { buildingsById, itemName } from '../data'
import { go } from '../router'
import { buildChain, extractorRate, recipesFor } from '../state/chain'
import { catalog, type GameState } from '../state/gameState'
import { useOutposts, type Outpost } from '../state/outposts'
import { fmt } from '../format'
import { Rates } from './Rates'

const machineCount = (steps: { machines: number }[]) => steps.reduce((s, x) => s + Math.ceil(x.machines - 1e-9), 0)

export function OutpostList({ state }: { state: GameState }) {
  const { outposts, add } = useOutposts()
  const [name, setName] = useState('')
  const avail = catalog(state).available

  return (
    <section className="panel">
      <h2>Outposts</h2>
      <p className="muted">Each outpost makes one product. Pick what and how much; we work out the machines.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          go(`/outposts/${add(name.trim())}`)
          setName('')
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New outpost name" />
        <button type="submit">Create</button>
      </form>
      {outposts.length === 0 && <p className="muted">No outposts yet. Start one here or from an item in the catalog.</p>}
      <ul className="list">
        {outposts.map((o) => {
          const chain = o.target && buildChain(o.target.item, o.target.perMin, avail.recipes, o.choices ?? {})
          return (
            <li key={o.id}>
              <button type="button" className="card outpost-row" onClick={() => go(`/outposts/${o.id}`)}>
                <strong>{o.name}</strong>
                <span className="muted small">
                  {o.target
                    ? `${fmt(o.target.perMin)} ${itemName(o.target.item)}/min · ${machineCount(chain!.steps)} machines · ${fmt(chain!.powerMW, 1)} MW`
                    : 'No product picked yet'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function OutpostEditor({ id, state }: { id: string; state: GameState }) {
  const { outposts, update, remove, add } = useOutposts()
  const o = outposts.find((x) => x.id === id)
  if (!o) {
    return (
      <section className="panel">
        <p className="muted">That outpost doesn't exist anymore.</p>
        <button type="button" onClick={() => go('/outposts')}>
          Back to outposts
        </button>
      </section>
    )
  }
  return <Editor o={o} state={state} update={(p) => update(o.id, p)} remove={() => remove(o.id)} duplicate={() => add(`${o.name} (copy)`, o)} />
}

function Editor({
  o,
  state,
  update,
  remove,
  duplicate,
}: {
  o: Outpost
  state: GameState
  update: (p: Parameters<ReturnType<typeof useOutposts>['update']>[1]) => void
  remove: () => void
  duplicate: () => string
}) {
  const cat = catalog(state)
  const avail = cat.available
  const products = cat.items.filter((i) => recipesFor(i.id, avail.recipes).length > 0)
  const target = o.target ?? { item: products[0]?.id ?? '', perMin: 10 }
  const choices = o.choices ?? {}
  const chain = target.item ? buildChain(target.item, target.perMin, avail.recipes, choices) : null

  return (
    <div className="editor">
      <button type="button" className="link" onClick={() => go('/outposts')}>
        ← All outposts
      </button>
      <section className="panel">
        <input
          className="title-input big"
          value={o.name}
          onChange={(e) => update({ name: e.target.value })}
          aria-label="Outpost name"
        />
        <div className="target">
          <label>
            <span className="muted small">Make</span>
            <select value={target.item} onChange={(e) => update({ target: { ...target, item: e.target.value } })}>
              {products.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted small">Per minute</span>
            <input
              type="number"
              min={0}
              step="any"
              value={target.perMin}
              onChange={(e) => update({ target: { ...target, perMin: Math.max(0, Number(e.target.value)) } })}
            />
          </label>
        </div>
      </section>

      {chain && (
        <>
          <section className="summary">
            <div className="stat">
              <span className="stat-value">{machineCount(chain.steps)}</span>
              <span className="muted small">machines</span>
            </div>
            <div className="stat">
              <span className="stat-value">{fmt(chain.powerMW, 1)} MW</span>
              <span className="muted small">power</span>
            </div>
            <div className="stat">
              <span className="stat-value">
                {[...chain.raw].reduce((s, [item, r]) => {
                  const x = extractorRate(item, avail.buildings)
                  return s + (x ? Math.ceil(r / x.perMin - 1e-9) : 0)
                }, 0)}
              </span>
              <span className="muted small">extractors (normal nodes)</span>
            </div>
          </section>

          {chain.missing.size > 0 && (
            <p className="notice">
              You can't make {[...chain.missing].map(itemName).join(', ')} yet with what you've unlocked.
            </p>
          )}

          <section className="panel">
            <h3>Resources in</h3>
            <ul className="plain resources">
              {[...chain.raw].map(([item, rate]) => {
                const x = extractorRate(item, avail.buildings)
                return (
                  <li key={item}>
                    <strong>{fmt(rate)}</strong>/min {itemName(item)}
                    <span className="muted small">
                      {x ? ` · ${fmt(rate / x.perMin)} × ${x.name}` : ' · no extractor unlocked yet'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="panel">
            <h3>Production steps</h3>
            <div className="table-wrap">
              <table className="step-table">
                <thead>
                  <tr>
                    <th>Recipe</th>
                    <th>Machines</th>
                    <th>In → out (per min)</th>
                    <th className="num">Power</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.steps.map(({ recipe, machines, powerMW }) => {
                    const product = recipe.products[0].item
                    const options = recipesFor(product, avail.recipes)
                    return (
                      <tr key={recipe.id}>
                        <td>
                          {options.length > 1 ? (
                            <select
                              value={recipe.id}
                              onChange={(e) => update({ choices: { ...choices, [product]: e.target.value } })}
                            >
                              {options.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name.replace('Alternate: ', '★ ')}
                                </option>
                              ))}
                            </select>
                          ) : (
                            recipe.name
                          )}
                        </td>
                        <td>
                          <strong>{fmt(machines)}</strong> {buildingsById.get(recipe.producedIn[0])?.name}
                        </td>
                        <td>
                          <Rates list={recipe.ingredients} recipe={recipe} scale={machines} />
                          <span className="arrow"> → </span>
                          <Rates list={recipe.products} recipe={recipe} scale={machines} />
                        </td>
                        <td className="num">{fmt(powerMW, 1)} MW</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="panel">
        <h3>Notes</h3>
        <textarea
          value={o.notes}
          onChange={(e) => update({ notes: e.target.value })}
          placeholder="Where it is, belts, power hookup..."
          rows={3}
        />
        <div className="row">
          <button type="button" className="secondary" onClick={() => go(`/outposts/${duplicate()}`)}>
            Duplicate
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (confirm(`Delete "${o.name}"?`)) {
                remove()
                go('/outposts')
              }
            }}
          >
            Delete
          </button>
        </div>
      </section>
    </div>
  )
}
