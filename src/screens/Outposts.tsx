import { useState, type CSSProperties } from 'react'
import { buildingsById, itemName, itemsById, recipesById, resourcesById } from '../data'
import { fmt } from '../format'
import { exportsOf, offers, type Solved } from '../plan/network'
import { extractorPerMin, extractorsFor, generatorsFor, MAX_CLOCK, recipesFor, somersloopBoost, unlockedFeatures, unusedImports } from '../plan/solve'
import { newId, type PlanPatch } from '../plan/store'
import type { Goal, OutpostPlan, Purity, Transport } from '../plan/types'
import { transportUnlocked } from '../plan/unlocked'
import { useNetwork } from '../plan/useNetwork'
import { editorPath } from '../editor/route'
import { go } from '../router'
import { catalog, type GameState } from '../state/gameState'
import { Amount, GameIcon, NoIconLinks, PowerIcon } from '../ui/GameIcon'
import { Help, WithTip } from '../ui/Help'
import { IconSelect } from '../ui/IconSelect'
import { Rates } from './Rates'

const ceil = (n: number) => Math.ceil(n - 1e-9)
const pct = (clock: number) => `${Math.round(clock * 1000) / 10}%`
const CLOCKS = [1, 1.5, 2, 2.5]
const PURITIES: Purity[] = ['impure', 'normal', 'pure']
const TRANSPORTS: Transport[] = ['belt', 'pipe', 'truck', 'train', 'drone']
const TRANSPORT_ICONS: Record<Transport, string> = {
  belt: 'Desc_ConveyorBeltMk1_C',
  pipe: 'Desc_Pipeline_C',
  truck: 'Desc_TruckStation_C',
  train: 'Desc_TrainDockingStation_C',
  drone: 'Desc_DroneStation_C',
}
// Views of one outpost, as tabs: any can be opened in any order.
const TABS = [
  { key: 'goal', label: 'Goal' },
  { key: 'resources', label: 'Resources' },
  { key: 'plan', label: 'Plan' },
] as const
type TabKey = (typeof TABS)[number]['key']

// ---------- List: the outpost network ----------

export function OutpostList({ state }: { state: GameState }) {
  const net = useNetwork(state)
  // A new outpost starts on the world map: click where it goes and it gets the nodes around it.
  const create = () => go('/world/new')
  const nameOf = (id: string) => net.outposts.find((o) => o.id === id)?.name ?? 'removed outpost'

  return (
    <section className="network">
      <header className="row between">
        <h2>Outposts</h2>
        <button type="button" onClick={create}>
          + New outpost
        </button>
      </header>
      {net.solved.length === 0 && (
        <p className="panel muted">No outposts yet. Start one here, or from an item in the catalog.</p>
      )}
      <ul className="outpost-grid">
        {net.solved.map(({ plan, solution }) => {
          const exports = exportsOf(solution)
          const short = [...solution.flows.values()].filter((f) => f.shortfall > 1e-6)
          return (
            <li key={plan.id}>
              <button type="button" className="card outpost-card" onClick={() => go(`/outposts/${plan.id}/plan`)}>
                <NoIconLinks>
                  <header className="row between">
                    <strong>{plan.name}</strong>
                    {short.length > 0 && <span className="badge warn">Short on {short.length}</span>}
                    {!plan.location && <span className="badge muted-badge">Not on the map</span>}
                  </header>
                  <div className="io">
                    <span className="io-label">In</span>
                    <span className="rates">
                      {plan.nodes.length > 0 && (
                        <span className="rate">
                          {plan.nodes.length} node{plan.nodes.length > 1 ? 's' : ''}
                        </span>
                      )}
                      {plan.imports.map((i) => (
                        <span key={i.id} className="rate" title={`from ${nameOf(i.from)} by ${i.via}`}>
                          <GameIcon id={i.item} size={20} />
                          <b>{fmt(i.perMin)}</b>/min · {nameOf(i.from)}
                        </span>
                      ))}
                      {plan.nodes.length + plan.imports.length === 0 && <span className="muted small">nothing yet</span>}
                    </span>
                  </div>
                  <div className="io">
                    <span className="io-label">Out</span>
                    <span className="rates">
                      {exports.map((e) => (
                        <Amount key={e.item} item={e.item} perMin={e.perMin} />
                      ))}
                      {solution.power.exportedMW > 0 && <span className="rate power"><PowerIcon size={18} /> <b>{fmt(solution.power.exportedMW, 1)}</b> MW</span>}
                      {exports.length === 0 && solution.power.exportedMW <= 0 && <span className="muted small">no goal yet</span>}
                    </span>
                  </div>
                  <span className="muted small">
                    {solution.steps.reduce((n, s) => n + s.count, 0)} machines · uses{' '}
                    {fmt(solution.power.consumedMW, 1)} MW
                  </span>
                </NoIconLinks>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------- Editor ----------

export function OutpostEditor({ id, step, state }: { id: string; step?: string; state: GameState }) {
  const net = useNetwork(state)
  const solved = net.solved.find((s) => s.plan.id === id)
  if (!solved) {
    return (
      <section className="panel">
        <p className="muted">That outpost doesn't exist anymore.</p>
        <button type="button" onClick={() => go('/map')}>
          Back to the factory map
        </button>
      </section>
    )
  }
  const current = (TABS.find((t) => t.key === step)?.key ?? 'goal') as TabKey
  const { plan } = solved
  const update = (patch: PlanPatch) => net.update(plan.id, patch)

  return (
    <div className="editor">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href="#/map">← Factory map</a>
        <span className="muted">›</span>
        <a href="#/outposts">Outposts</a>
        <span className="muted">›</span>
        <span>{plan.name}</span>
      </nav>
      <header className="editor-head">
        <input
          className="title-input big"
          value={plan.name}
          onChange={(e) => update({ name: e.target.value })}
          aria-label="Outpost name"
        />
        <div className="row">
          <a className="button secondary" href={`#/world/${plan.id}`}>
            {plan.location ? 'On the map' : 'Place on the map'}
          </a>
          <a className="button secondary" href={editorPath(plan.id)}>
            Floor plan
          </a>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (confirm(`Delete "${plan.name}"? Outposts importing from it lose those imports.`)) {
                net.remove(plan.id)
                go('/map')
              }
            }}
          >
            Delete
          </button>
        </div>
        <nav className="nav-tabs subtabs" aria-label="Outpost views">
          {TABS.map((t) => (
            <a key={t.key} href={`#/outposts/${plan.id}/${t.key}`} className={t.key === current ? 'nav-tab active' : 'nav-tab'} aria-current={t.key === current ? 'page' : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
      </header>

      <div className="editor-body">
        <div className="editor-main">
          {current === 'goal' && <GoalStep plan={plan} state={state} update={update} available={net.available} />}
          {current === 'resources' && <ResourcesStep solved={solved} all={net.solved} update={update} available={net.available} />}
          {current === 'plan' && <PlanStep solved={solved} update={update} available={net.available} />}

        </div>
        <Balance solved={solved} nameOf={(i) => net.outposts.find((o) => o.id === i)?.name ?? '?'} />
      </div>
    </div>
  )
}

type StepProps = { update: (p: PlanPatch) => void; available: ReturnType<typeof useNetwork>['available'] }

// Goal tab: what the outpost must deliver.
function GoalStep({ plan, state, update, available }: StepProps & { plan: OutpostPlan; state: GameState }) {
  const cat = catalog(state)
  const products = cat.items.filter((i) => recipesFor(i.id, available).length > 0 || resourcesById.has(i.id))
  const gens = generatorsFor(available.buildings)
  const setGoal = (i: number, g: Goal) => update({ goals: plan.goals.map((x, j) => (j === i ? g : x)) })
  const hasPower = plan.goals.some((g) => g.kind === 'power')

  return (
    <section className="panel">
      <h3>Delivers</h3>
      {plan.goals.length === 0 && <p className="muted">No goal yet.</p>}
      <ul className="plain goals">
        {plan.goals.map((g, i) => (
          <li key={i} className="goal-row">
            {g.kind === 'item' ? (
              <>
                <GameIcon id={g.item} size={32} />
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={g.perMin}
                  onChange={(e) => setGoal(i, { ...g, perMin: Math.max(0, Number(e.target.value)) })}
                  aria-label="Per minute"
                />
                <span className="muted">/min</span>
                <IconSelect
                  value={g.item}
                  onChange={(item) => setGoal(i, { ...g, item })}
                  aria-label="Product"
                  options={products.map((p) => ({ value: p.id, label: p.name, icon: p.id }))}
                />
              </>
            ) : (
              <>
                <span className="power-icon"><PowerIcon size={26} /></span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={g.mw}
                  onChange={(e) => setGoal(i, { ...g, mw: Math.max(0, Number(e.target.value)) })}
                  aria-label="Megawatts"
                />
                <span className="muted">MW from</span>
                <IconSelect
                  value={`${g.generator}|${g.fuel}`}
                  onChange={(v) => {
                    const [generator, fuel] = v.split('|')
                    setGoal(i, { ...g, generator, fuel })
                  }}
                  aria-label="Generator and fuel"
                  options={gens.flatMap((b) =>
                    b.generator!.fuels
                      .filter((f) => available.items.has(f.fuel))
                      .map((f) => ({ value: `${b.id}|${f.fuel}`, label: `${b.name} on ${itemName(f.fuel)}`, icon: f.fuel, group: b.name })),
                  )}
                />
              </>
            )}
            <button
              type="button"
              className="icon-btn"
              aria-label="Remove goal"
              onClick={() => update({ goals: plan.goals.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={products.length === 0}
          onClick={() => update({ goals: [...plan.goals, { kind: 'item', item: products[0].id, perMin: 10 }] })}
        >
          + Product
        </button>
        {!hasPower && (
          <button
            type="button"
            className="secondary"
            disabled={gens.length === 0}
            title={gens.length === 0 ? 'No generators unlocked yet' : undefined}
            onClick={() => {
              const b = gens[0]
              const fuel = b.generator!.fuels.find((f) => available.items.has(f.fuel))?.fuel ?? b.generator!.fuels[0].fuel
              update({ goals: [...plan.goals, { kind: 'power', mw: b.generator!.powerProductionMW * 4, generator: b.id, fuel }] })
            }}
          >
            + Power
          </button>
        )}
      </div>
      {hasPower && (
        <label className="check inline">
          <input type="checkbox" checked={plan.selfPowered} onChange={(e) => update({ selfPowered: e.target.checked })} />
          <span>Powers its own machines too</span>
        </label>
      )}
    </section>
  )
}

// Resources tab: what the outpost has to work with.
function ResourcesStep({ solved, all, update, available }: StepProps & { solved: Solved; all: Solved[] }) {
  const { plan, solution } = solved
  const [qty, setQty] = useState<Record<string, number>>({})
  const resources = [...resourcesById.values()].filter((r) => extractorsFor(r.id, available.buildings).length > 0 && r.id !== 'Desc_Water_C')
  const short = [...solution.flows.values()].filter((f) => f.shortfall > 1e-6)
  const offerList = offers(all, plan.id).filter((o) => o.perMin > 1e-6)
  const neededItems = new Set(short.map((f) => f.item))
  // Offers for things this outpost is short on go first.
  offerList.sort((a, b) => Number(neededItems.has(b.item)) - Number(neededItems.has(a.item)))

  const overclock = unlockedFeatures(available).has('overclocking')
  const addNode = (resource: string) =>
    update({ nodes: [...plan.nodes, { id: newId(), resource, purity: 'normal' }] })

  return (
    <>
      {short.length > 0 && (
        <section className="notice">
          <div className="row">
            <strong>Short</strong>
            <Help text="Add a node or import it." />
            <span className="rates">
              {short.map((f) => (
                <Amount key={f.item} item={f.item} perMin={f.shortfall} />
              ))}
            </span>
            {short
              .filter((f) => resourcesById.has(f.item))
              .map((f) => (
                <button key={f.item} type="button" className="secondary small with-icon" aria-label={`Add a ${itemName(f.item)} node`} onClick={() => addNode(f.item)}>
                  + <GameIcon id={f.item} size={18} link={false} /> node
                </button>
              ))}
          </div>
        </section>
      )}

      <section className="panel">
        <h3>
          Resource nodes
          <Help text="Nodes this outpost sits on. Every node runs at its clock speed; what isn't used is exported." />
        </h3>
        <ul className="plain">
          {plan.nodes.map((n) => {
            const ex = extractorsFor(n.resource, available.buildings)
            const b = ex.find((x) => x.id === n.extractor) ?? ex[0]
            const set = (patch: Partial<typeof n>) =>
              update({ nodes: plan.nodes.map((x) => (x.id === n.id ? { ...x, ...patch } : x)) })
            return (
              <li key={n.id} className="node-row">
                {n.fromMap ? (
                  // Picked on the world map: resource and purity are the node's real ones.
                  <span className="node-fixed">
                    <GameIcon id={n.resource} size={32} />
                    {n.purity} <a className="muted small" href={`#/world/${plan.id}`}>on the map</a>
                  </span>
                ) : (
                  <>
                    <IconSelect
                      iconOnly
                      value={n.resource}
                      onChange={(resource) => set({ resource, extractor: undefined })}
                      aria-label="Resource"
                      options={resources.map((r) => ({ value: r.id, label: r.name, icon: r.id }))}
                    />
                    <div className="segmented small" role="radiogroup" aria-label="Purity">
                      {PURITIES.map((p) => (
                        <label key={p}>
                          <input type="radio" name={`purity-${n.id}`} checked={n.purity === p} onChange={() => set({ purity: p })} />
                          <span>{p}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {ex.length > 1 ? (
                  <IconSelect
                    iconOnly
                    value={b?.id}
                    onChange={(extractor) => set({ extractor })}
                    aria-label="Extractor"
                    options={ex.map((x) => ({ value: x.id, label: x.name, icon: x.id }))}
                  />
                ) : (
                  b && <GameIcon id={b.id} size={24} />
                )}
                {overclock && (
                  <label className="row small" title="Clock speed. Above 100% needs a power shard per 50%.">
                    <input
                      type="number"
                      min={1}
                      max={MAX_CLOCK * 100}
                      step={1}
                      value={Math.round((n.clock ?? 1) * 100)}
                      onChange={(e) => set({ clock: Math.min(MAX_CLOCK, Math.max(0.01, Number(e.target.value) / 100)) })}
                      aria-label="Clock speed (%)"
                    />
                    %
                  </label>
                )}
                <span className="node-rate">{b ? `${fmt(extractorPerMin(b, n.resource, n.purity) * Math.min(overclock ? MAX_CLOCK : 1, n.clock ?? 1))}/min` : ''}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove node"
                  onClick={() => update({ nodes: plan.nodes.filter((x) => x.id !== n.id) })}
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
        <div className="row">
          <button type="button" className="secondary" disabled={resources.length === 0} onClick={() => addNode(resources[0].id)}>
            + Node
          </button>
          <a className="button secondary" href={`#/world/${plan.id}`}>
            Pick nodes on the world map
          </a>
        </div>
      </section>

      <section className="panel">
        <h3>Imports</h3>
        {plan.imports.length > 0 && (
          <ul className="plain">
            {plan.imports.map((imp) => {
              const set = (patch: Partial<typeof imp>) =>
                update({ imports: plan.imports.map((x) => (x.id === imp.id ? { ...x, ...patch } : x)) })
              return (
                <li key={imp.id} className="node-row">
                  <GameIcon id={imp.item} size={32} />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={imp.perMin}
                    onChange={(e) => set({ perMin: Math.max(0, Number(e.target.value)) })}
                    aria-label="Per minute"
                  />
                  <span className="node-what">
                    /min <span className="muted small">from {all.find((s) => s.plan.id === imp.from)?.plan.name}</span>
                  </span>
                  <IconSelect
                    iconOnly
                    value={imp.via}
                    onChange={(via) => set({ via: via as Transport })}
                    aria-label="Transport"
                    options={TRANSPORTS.filter((t) => t === imp.via || transportUnlocked(t, available)).map((t) => ({
                      value: t,
                      label: `by ${t}`,
                      icon: TRANSPORT_ICONS[t],
                    }))}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove import"
                    onClick={() => update({ imports: plan.imports.filter((x) => x.id !== imp.id) })}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <h4 className="sub">From other outposts</h4>
        {offerList.length === 0 ? (
          <p className="muted small">Nothing on offer yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="step-table">
              <tbody>
                {offerList.map((o) => {
                  const key = `${o.from}|${o.item}`
                  const amount = Math.min(qty[key] ?? o.perMin, o.perMin)
                  return (
                    <tr key={key} className={neededItems.has(o.item) ? 'wanted' : ''}>
                      <td>
                        <Amount item={o.item} perMin={o.perMin} />
                      </td>
                      <td className="muted small">from {o.fromName}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={o.perMin}
                          step="any"
                          value={fmt(amount)}
                          onChange={(e) => setQty({ ...qty, [key]: Number(e.target.value) })}
                          aria-label="Amount to import"
                        />
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() =>
                            update({
                              imports: [
                                ...plan.imports,
                                { id: newId(), from: o.from, item: o.item, perMin: amount, via: isFluidItem(o.item) ? 'pipe' : 'belt' },
                              ],
                            })
                          }
                        >
                          Import
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

const isFluidItem = (id: string) => itemsById.get(id)?.form !== 'solid'

// Plan tab: the proposed plan, editable.
function PlanStep({ solved, update, available }: StepProps & { solved: Solved }) {
  const { plan, solution, suggested } = solved
  const overrides = Object.keys(plan.recipeChoices).length
  const features = unlockedFeatures(available)

  return (
    <>
      <section className="summary">
        <div className="stat">
          <span className="stat-value">
            {solution.steps.reduce((n, s) => n + s.count, 0) +
              solution.generators.reduce((n, g) => n + ceil(g.machines), 0)}
          </span>
          <span className="muted small">machines</span>
        </div>
        <div className="stat">
          <span className="stat-value">{fmt(solution.power.consumedMW, 1)} MW</span>
          <span className="muted small">power used</span>
        </div>
        <div className="stat">
          <span className="stat-value">{solution.extraction.reduce((n, e) => n + e.count, 0)}</span>
          <span className="muted small">extractors</span>
        </div>
        {[...solution.steps, ...solution.extraction].some((s) => s.shards > 0) && (
          <div className="stat">
            <span className="stat-value">{[...solution.steps, ...solution.extraction].reduce((n, s) => n + s.shards, 0)}</span>
            <span className="muted small">power shards</span>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="row between">
          <h3>
            Production
            <Help text="Suggested recipes leave nothing short and use the least raw input; pick another to override." />
          </h3>
          <div className="row">
            {features.has('overclocking') && (
              <label className="row small">
                <GameIcon id={SHARD} size={20} title="Highest clock speed" />
                <select value={plan.maxClock ?? 1} onChange={(e) => update({ maxClock: Number(e.target.value) })} aria-label="Highest clock speed">
                  {CLOCKS.map((c) => (
                    <option key={c} value={c}>
                      {pct(c)}
                      {c > 1 ? ` · ${Math.round((c - 1) / 0.5)} shard${c > 1.5 ? 's' : ''}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="row small">
              <input type="checkbox" checked={!!plan.underclock} onChange={(e) => update({ underclock: e.target.checked })} />
              Underclock
              <Help text="Off: machines run at full clock and the manifold's last machine idles part of the time (idle machines draw no power). On: machines that don't divide evenly all run at one lower clock." />
            </label>
            {overrides > 0 && (
              <button type="button" className="link" onClick={() => update({ recipeChoices: {} })}>
                Reset recipes
              </button>
            )}
          </div>
        </header>
        {solution.steps.length + solution.generators.length === 0 && <p className="muted">Nothing to produce yet.</p>}
        <div className="table-wrap">
          <table className="step-table plan-table">
            {solution.steps.length + solution.generators.length > 0 && <PlanHead />}
            <tbody>
              {solution.steps.map((s) => {
                const recipe = recipesById.get(s.recipe)!
                const product = Object.keys(solution.recipes).find((i) => solution.recipes[i] === s.recipe) ?? recipe.products[0].item
                const options = recipesFor(product, available)
                const suggestedId = suggested[product] ?? options[0]?.id
                const pick = (r: string) => update({ recipeChoices: { ...plan.recipeChoices, [product]: r } })
                const sloops = somersloopBoost(buildingsById.get(s.building)).slots
                return (
                  <tr key={s.recipe}>
                    <td>
                      <span className="recipe-cell">
                        {options.length > 1 ? (
                          <IconSelect
                            iconOnly
                            value={s.recipe}
                            onChange={pick}
                            aria-label={`Recipe for ${itemName(product)}`}
                            options={options.map((r) => ({
                              value: r.id,
                              label: `${r.alternate ? '★ ' : ''}${r.name.replace('Alternate: ', '')}${suggestedId === r.id ? ' (suggested)' : ''}`,
                              icon: product,
                              extra: (
                                <span className="icon-select-extra" aria-label="Ingredients">
                                  {r.ingredients.map((x) => (
                                    <GameIcon key={x.item} id={x.item} size={18} />
                                  ))}
                                </span>
                              ),
                            }))}
                          />
                        ) : (
                          <GameIcon id={product} size={28} title={recipe.name} />
                        )}
                        {recipe.alternate && <WithTip className="mark" text="Alternate recipe">★</WithTip>}
                        {s.recipe !== suggestedId && (
                          <button type="button" className="icon-btn small" aria-label="Back to the suggested recipe" title="Back to the suggested recipe" onClick={() => pick(suggestedId)}>
                            ↺
                          </button>
                        )}
                      </span>
                    </td>
                    <td>
                      <MachineCount building={s.building} count={s.count} clock={s.clock} shards={s.shards} lastBusy={s.count * s.clock - s.machines > 1e-3 ? 1 - (s.count * s.clock - s.machines) / s.clock : undefined} />
                      {features.has('production-amplification') && sloops > 0 && (
                        <label className="row small sloops">
                          <GameIcon id="Desc_WAT1_C" size={18} title="Somersloops per machine: each adds output, and power goes up with the square of the boost" />
                          <input
                            type="number"
                            min={0}
                            max={sloops}
                            value={s.somersloops}
                            onChange={(e) => update({ somersloops: { ...plan.somersloops, [s.recipe]: Math.max(0, Number(e.target.value)) } })}
                            aria-label="Somersloops per machine"
                          />
                          {s.boost > 1 && <span className="muted">×{fmt(s.boost, 2)}</span>}
                        </label>
                      )}
                    </td>
                    <td>
                      <Rates list={recipe.ingredients} recipe={recipe} scale={s.machines} />
                    </td>
                    <td className="arrow">→</td>
                    <td>
                      <Rates list={recipe.products} recipe={recipe} scale={s.machines * s.boost} />
                    </td>
                    <td className="num">{fmt(s.powerMW, 1)} MW</td>
                  </tr>
                )
              })}
              {solution.generators.map((g) => (
                <tr key={g.generator}>
                  <td>
                    <span className="recipe-cell">
                      <span className="power-icon">
                        <PowerIcon size={22} />
                      </span>
                    </span>
                  </td>
                  <td>
                    <MachineCount building={g.generator} count={ceil(g.machines)} />
                  </td>
                  <td>
                    <span className="rates">
                      <span className="rate">
                        <GameIcon id={g.fuel} size={20} />
                      </span>
                    </span>
                  </td>
                  <td className="arrow">→</td>
                  <td>
                    <span className="rate power">
                      <PowerIcon size={18} /> <b>{fmt(g.mw, 1)}</b> MW
                    </span>
                  </td>
                  <td className="num">+{fmt(g.mw, 1)} MW</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {solution.extraction.length > 0 && (
        <section className="panel">
          <h3>Extraction</h3>
          <div className="table-wrap">
            <table className="step-table plan-table">
              <PlanHead />
              <tbody>
                {solution.extraction.map((e, i) => (
                  <tr key={i}>
                    <td>
                      <span className="recipe-cell">
                        <GameIcon id={e.resource} size={28} />
                      </span>
                    </td>
                    <td>
                      <MachineCount building={e.extractor} count={e.count} clock={e.clock} shards={e.shards} />
                    </td>
                    <td />
                    <td className="arrow">→</td>
                    <td>
                      <span className="rates">
                        <span className="rate">
                          <GameIcon id={e.resource} size={20} />
                          <b>{fmt(e.perMin)}</b>
                        </span>
                      </span>
                    </td>
                    <td className="num">{fmt(e.powerMW, 1)} MW</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <h3>Notes</h3>
        <textarea
          value={plan.notes}
          onChange={(e) => update({ notes: e.target.value })}
          placeholder="Where it is, belts, how it connects..."
          rows={3}
        />
      </section>
    </>
  )
}

const SHARD = 'Desc_CrystalShard_C'

// The plan tables' columns explain themselves with icons; the headings are for screen readers.
function PlanHead() {
  return (
    <thead className="sr-only">
      <tr>
        <th>Recipe</th>
        <th>Machines</th>
        <th>In (per min)</th>
        <th />
        <th>Out (per min)</th>
        <th>Power</th>
      </tr>
    </thead>
  )
}

/** "[building] ×4", plus the clock when it isn't 100%, how busy a part-time last machine is, and any power shards. */
function MachineCount({ building, count, clock = 1, shards = 0, lastBusy }: { building: string; count: number; clock?: number; shards?: number; lastBusy?: number }) {
  return (
    <span className="machine-count">
      <GameIcon id={building} size={24} />
      <b>×{count}</b>
      {Math.abs(clock - 1) > 1e-6 && (
        <WithTip className="muted small" text="Clock speed">
          {pct(clock)}
        </WithTip>
      )}
      {lastBusy !== undefined && (
        <WithTip className="busy" text={`The last machine is busy ${pct(lastBusy)} of the time`}>
          <span className="pie" style={{ '--p': `${lastBusy * 360}deg` } as CSSProperties} />
        </WithTip>
      )}
      {shards > 0 && (
        <span className="rate">
          <GameIcon id={SHARD} size={16} />
          <b>{shards}</b>
        </span>
      )}
    </span>
  )
}

// Always-visible summary: what goes in and what comes out.
function Balance({ solved, nameOf }: { solved: Solved; nameOf: (id: string) => string }) {
  const { plan, solution } = solved
  const flows = [...solution.flows.values()]
  const exports = exportsOf(solution)
  const goalItems = new Set(plan.goals.flatMap((g) => (g.kind === 'item' ? [g.item] : [])))
  const short = flows.filter((f) => f.shortfall > 1e-6)
  const unused = unusedImports(plan, solution)
  const net = solution.power.generatedMW - solution.power.consumedMW

  return (
    <aside className="panel balance">
      <h3>Balance</h3>
      <h4 className="sub">In</h4>
      <ul className="plain tight">
        {flows
          .filter((f) => f.extracted > 1e-6)
          .map((f) => (
            <li key={f.item}>
              <Amount item={f.item} perMin={f.extracted} /> <span className="muted small">mined</span>
            </li>
          ))}
        {plan.imports.map((i) => (
          <li key={i.id}>
            <Amount item={i.item} perMin={i.perMin} /> <span className="muted small">from {nameOf(i.from)}</span>
          </li>
        ))}
        {plan.nodes.length + plan.imports.length === 0 && solution.extraction.length === 0 && (
          <li className="muted small">Nothing yet</li>
        )}
      </ul>
      <h4 className="sub">Out</h4>
      <ul className="plain tight">
        {exports.map((e) => (
          <li key={e.item}>
            <Amount item={e.item} perMin={e.perMin} />{' '}
            <span className="muted small">{goalItems.has(e.item) ? 'goal' : resourcesById.has(e.item) ? 'spare' : 'surplus'}</span>
          </li>
        ))}
        {solution.power.exportedMW > 1e-6 && (
          <li>
            <span className="rate power">
              <PowerIcon size={18} /> <b>{fmt(solution.power.exportedMW, 1)}</b> MW
            </span>{' '}
            <span className="muted small">to grid</span>
          </li>
        )}
        {exports.length === 0 && solution.power.exportedMW <= 1e-6 && <li className="muted small">Nothing yet</li>}
      </ul>
      <h4 className="sub">Power</h4>
      <p className="small">
        Uses {fmt(solution.power.consumedMW, 1)} MW
        {solution.power.generatedMW > 0 && `, makes ${fmt(solution.power.generatedMW, 1)} MW`}
        {!plan.selfPowered && solution.power.consumedMW > 0 && <span className="muted"> · from the grid</span>}
        {plan.selfPowered && net < -1e-6 && <span className="warn-text"> · short {fmt(-net, 1)} MW</span>}
      </p>
      {short.length > 0 && (
        <>
          <h4 className="sub warn-text">Short</h4>
          <ul className="plain tight">
            {short.map((f) => (
              <li key={f.item}>
                <Amount item={f.item} perMin={f.shortfall} />
              </li>
            ))}
          </ul>
        </>
      )}
      {unused.size > 0 && (
        <>
          <h4 className="sub">Not needed</h4>
          <span className="rates">
            {[...unused].map(([item, r]) => (
              <Amount key={item} item={item} perMin={r} />
            ))}
          </span>
        </>
      )}
    </aside>
  )
}
