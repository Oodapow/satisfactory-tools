// Side panel forms for whatever is selected in the editor.
import { buildingsById, items, itemName, itemsById, recipes, recipesById, resources } from '../data'
import { offers, type Solved } from '../plan/network'
import { newId, type PlanPatch } from '../plan/store'
import type { Import, Transport as PlanTransport } from '../plan/types'
import { fmt } from './generate'
import { GameIcon } from './GameIcon'
import { POWER } from './icons'
import { transports, type BeltData, type LinkEdge, type MachineData, type PortData, type PowerLine } from './model'
import { editorPath } from './route'
import { generatorBuildings, machineBuildings, recipesIn } from './store'

const num = (v: string, fallback = 0) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback)
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)
const inProduction = new Set(recipes.filter((r) => r.kind === 'production').flatMap((r) => [...r.products, ...r.ingredients].map((a) => a.item)))
const pickableItems = items.filter((i) => inProduction.has(i.id) || resources.some((r) => r.id === i.id)).sort(byName)
const planTransports = transports.filter((t) => t.id !== 'power')

function ItemSelect({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  return (
    <span className="ne-item-select">
      <GameIcon id={value} size={22} />
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          Pick an item
        </option>
        {pickableItems.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </span>
  )
}

export function MacroOverview({ all, onSelect, onExample }: { all: Solved[]; onSelect: (id: string) => void; onExample: () => void }) {
  const generated = all.reduce((t, s) => t + s.solution.power.generatedMW, 0)
  const used = all.reduce((t, s) => t + s.solution.power.consumedMW, 0)
  return (
    <section>
      <h3>Factory map</h3>
      <p className="ne-help">
        Every outpost plan is a block here, and every import is a link. {all.length} outposts, {fmt(generated)} MW generated,{' '}
        {fmt(used)} MW used.
      </p>
      <p className="ne-help">Select an outpost to see what it imports and exports and what the others can send it.</p>
      <ul className="ne-list">
        {all.map(({ plan }) => {
          const g = plan.goals[0]
          return (
            <li key={plan.id}>
              <button type="button" className="ghost ne-list-btn" onClick={() => onSelect(plan.id)}>
                <GameIcon id={g?.kind === 'item' ? g.item : g ? POWER : 'Desc_TradingPost_C'} size={20} />
                {plan.name}
              </button>
            </li>
          )
        })}
      </ul>
      {all.length === 0 && (
        <button type="button" onClick={onExample}>
          Load example outposts
        </button>
      )}
    </section>
  )
}

export function OutpostInspector({
  solved,
  all,
  powerLines,
  onPatch,
  onAddPower,
  onDelete,
}: {
  solved: Solved
  all: Solved[]
  powerLines: PowerLine[]
  onPatch: (p: PlanPatch) => void
  onAddPower: (line: PowerLine) => void
  onDelete: () => void
}) {
  const { plan, solution } = solved
  const nameOf = (id: string) => all.find((s) => s.plan.id === id)?.plan.name ?? '?'
  const importsFromOthers = all.flatMap((s) => s.plan.imports.filter((i) => i.from === plan.id).map((i) => ({ ...i, to: s.plan.name })))
  const exported = [...solution.flows.values()].filter((f) => f.exported > 1e-6)
  const available = offers(all, plan.id).filter((o) => o.perMin > 1e-6)
  const powerOffers = all
    .filter((s) => s.plan.id !== plan.id && s.solution.power.exportedMW > 1e-6)
    .map((s) => ({
      from: s.plan,
      free: s.solution.power.exportedMW - powerLines.filter((l) => l.from === s.plan.id).reduce((t, l) => t + l.mw, 0),
    }))
    .filter((o) => o.free > 1e-6)
  const addImport = (from: string, item: string, perMin: number) => {
    const via: PlanTransport = itemsById.get(item)?.form === 'solid' ? 'belt' : 'pipe'
    const imp: Import = { id: newId(), from, item, perMin, via }
    onPatch({ imports: [...plan.imports, imp] })
  }

  return (
    <section>
      <h3>Outpost</h3>
      <label className="ne-field">
        Name
        <input value={plan.name} onChange={(e) => onPatch({ name: e.target.value })} />
      </label>
      <h4>Goal</h4>
      <ul className="ne-list">
        {plan.goals.map((g, i) => (
          <li key={i}>
            <GameIcon id={g.kind === 'item' ? g.item : POWER} size={18} />
            {g.kind === 'item' ? `${fmt(g.perMin)} ${itemName(g.item)}/min` : `${fmt(g.mw)} MW from ${itemName(g.fuel)}`}
          </li>
        ))}
        {!plan.goals.length && <li className="ne-help">No goal yet.</li>}
      </ul>
      <a className="ne-textlink" href={`#/outposts/${plan.id}/goal`}>
        Edit goal, resources and recipes
      </a>

      <h4>Imports</h4>
      {plan.imports.length ? (
        <ul className="ne-list">
          {plan.imports.map((i) => (
            <li key={i.id}>
              <GameIcon id={i.item} size={16} />
              <span className="ne-grow">
                {fmt(i.perMin)} {itemName(i.item)} from {nameOf(i.from)} by {i.via}
              </span>
              <button type="button" className="ghost" aria-label="Remove import" onClick={() => onPatch({ imports: plan.imports.filter((x) => x.id !== i.id) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ne-help">None yet. Pick from what the others offer below, or drag a link to this outpost.</p>
      )}

      <h4>Exports</h4>
      {exported.length || solution.power.exportedMW > 1e-6 ? (
        <ul className="ne-list">
          {exported.map((f) => {
            const taken = importsFromOthers.filter((i) => i.item === f.item)
            return (
              <li key={f.item}>
                <GameIcon id={f.item} size={16} />
                {fmt(f.exported)} {itemName(f.item)}/min
                {taken.length > 0 && <span className="ne-help"> · to {taken.map((t) => t.to).join(', ')}</span>}
              </li>
            )
          })}
          {solution.power.exportedMW > 1e-6 && (
            <li>
              <GameIcon id={POWER} size={16} />
              {fmt(solution.power.exportedMW)} MW
            </li>
          )}
        </ul>
      ) : (
        <p className="ne-help">Nothing leaves this outpost yet.</p>
      )}

      <h4>Available from other outposts</h4>
      {available.length === 0 && powerOffers.length === 0 && <p className="ne-help">The other outposts have nothing spare.</p>}
      {available.map((o) => (
        <div key={`${o.from}-${o.item}`} className="ne-offer-row">
          <GameIcon id={o.item} size={18} />
          <span className="ne-grow">
            {fmt(o.perMin)} {itemName(o.item)}/min · {o.fromName}
          </span>
          <button type="button" className="ghost" onClick={() => addImport(o.from, o.item, o.perMin)}>
            Import
          </button>
        </div>
      ))}
      {powerOffers.map((o) => (
        <div key={o.from.id} className="ne-offer-row">
          <GameIcon id={POWER} size={18} />
          <span className="ne-grow">
            {fmt(o.free)} MW · {o.from.name}
          </span>
          <button type="button" className="ghost" onClick={() => onAddPower({ id: newId(), from: o.from.id, to: plan.id, mw: o.free })}>
            Connect
          </button>
        </div>
      ))}

      <div className="ne-actions">
        <a className="button" href={editorPath(plan.id)}>
          Open floor plan
        </a>
        <button type="button" className="danger" onClick={() => confirm(`Delete "${plan.name}"?`) && onDelete()}>
          Delete
        </button>
      </div>
    </section>
  )
}

export function LinkInspector({
  edge,
  all,
  onImport,
  onPower,
  onDelete,
}: {
  edge: LinkEdge
  all: Solved[]
  onImport: (imp: Import) => void
  onPower: (line: PowerLine) => void
  onDelete: () => void
}) {
  const nameOf = (id: string) => all.find((s) => s.plan.id === id)?.plan.name ?? '?'
  const ref = edge.data?.ref
  const imp = ref?.kind === 'import' ? all.find((s) => s.plan.id === ref.planId)?.plan.imports.find((i) => i.id === ref.importId) : undefined
  return (
    <section>
      <h3>{ref?.kind === 'power' ? 'Power line' : 'Import'}</h3>
      <p className="ne-help">
        {nameOf(edge.source)} → {nameOf(edge.target)}
      </p>
      {imp && (
        <>
          <label className="ne-field">
            Travels by
            <select value={imp.via} onChange={(e) => onImport({ ...imp, via: e.target.value as PlanTransport })}>
              {planTransports.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ne-field">
            Item
            <ItemSelect value={imp.item} onChange={(item) => onImport({ ...imp, item })} />
          </label>
          <label className="ne-field">
            Per minute
            <input type="number" min={0} value={imp.perMin} onChange={(e) => onImport({ ...imp, perMin: num(e.target.value) })} />
          </label>
        </>
      )}
      {ref?.kind === 'power' && (
        <label className="ne-field">
          Power (MW)
          <input
            type="number"
            min={0}
            value={edge.data?.powerMW ?? 0}
            onChange={(e) => onPower({ id: ref.id, from: edge.source, to: edge.target, mw: num(e.target.value) })}
          />
        </label>
      )}
      <div className="ne-actions">
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </section>
  )
}

export function MachineInspector({ data, onChange, onDelete }: { data: MachineData; onChange: (d: MachineData) => void; onDelete: () => void }) {
  const recipe = recipesById.get(data.recipe)
  const b = buildingsById.get(data.building)
  const isGenerator = !!b?.generator
  const runs = data.clock * data.count
  const rate = (amount: number) => (recipe ? (amount * 60 * runs) / recipe.durationSeconds : 0)
  return (
    <section>
      <h3>
        <GameIcon id={data.building} size={24} /> {b?.name ?? 'Machine'}
      </h3>
      <label className="ne-field">
        Building
        <select
          value={data.building}
          onChange={(e) => {
            const nb = buildingsById.get(e.target.value)
            onChange({
              ...data,
              building: e.target.value,
              recipe: nb?.generator ? '' : (recipesIn(e.target.value)[0]?.id ?? ''),
              fuel: nb?.generator?.fuels[0]?.fuel,
            })
          }}
        >
          <optgroup label="Production">
            {machineBuildings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Power">
            {generatorBuildings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {isGenerator ? (
        <label className="ne-field">
          Fuel
          <select value={data.fuel ?? ''} onChange={(e) => onChange({ ...data, fuel: e.target.value })}>
            {b!.generator!.fuels.map((f) => (
              <option key={f.fuel} value={f.fuel}>
                {itemName(f.fuel)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="ne-field">
          Recipe
          <select value={data.recipe} onChange={(e) => onChange({ ...data, recipe: e.target.value })}>
            {recipesIn(data.building).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.alternate ? ' (alt)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="ne-grid2">
        <label className="ne-field">
          Clock %
          <input
            type="number"
            min={1}
            max={250}
            value={Math.round(data.clock * 1000) / 10}
            onChange={(e) => onChange({ ...data, clock: Math.max(0.01, num(e.target.value, 100) / 100) })}
          />
        </label>
        <label className="ne-field">
          Count
          <input type="number" min={1} value={data.count} onChange={(e) => onChange({ ...data, count: Math.max(1, Math.round(num(e.target.value, 1))) })} />
        </label>
        <label className="ne-field">
          Floor
          <input type="number" min={1} value={data.floor + 1} onChange={(e) => onChange({ ...data, floor: Math.max(0, num(e.target.value, 1) - 1) })} />
        </label>
      </div>
      {isGenerator && b?.generator && (
        <p className="ne-help">{fmt(b.generator.powerProductionMW * runs)} MW at this clock.</p>
      )}
      {recipe && (
        <>
          <h4>Per minute</h4>
          <ul className="ne-list">
            {recipe.ingredients.map((i) => (
              <li key={i.item}>
                <GameIcon id={i.item} size={16} /> In: {fmt(rate(i.amount))} {itemName(i.item)}
              </li>
            ))}
            {recipe.products.map((p) => (
              <li key={p.item}>
                <GameIcon id={p.item} size={16} /> Out: {fmt(rate(p.amount))} {itemName(p.item)}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="ne-actions">
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </section>
  )
}

export function PortInspector({ data, onChange, onDelete }: { data: PortData; onChange: (d: PortData) => void; onDelete: () => void }) {
  return (
    <section>
      <h3>Port</h3>
      <p className="ne-help">
        {data.linkId
          ? 'Comes from a link on the factory map. Change the link there; proposing a new layout picks it up.'
          : 'A port you added by hand. It only changes this drawing.'}
      </p>
      <div className="ne-grid2">
        <label className="ne-field">
          Direction
          <select value={data.direction} onChange={(e) => onChange({ ...data, direction: e.target.value as PortData['direction'] })}>
            <option value="in">In</option>
            <option value="out">Out</option>
          </select>
        </label>
        <label className="ne-field">
          Via
          <select value={data.transport} onChange={(e) => onChange({ ...data, transport: e.target.value as PortData['transport'] })}>
            {transports.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value="resource">Resource node</option>
          </select>
        </label>
      </div>
      <label className="ne-field">
        {data.direction === 'in' ? 'From' : 'To'}
        <input value={data.label ?? ''} onChange={(e) => onChange({ ...data, label: e.target.value })} />
      </label>
      {data.transport === 'power' ? (
        <label className="ne-field">
          Power (MW)
          <input type="number" min={0} value={data.powerMW ?? 0} onChange={(e) => onChange({ ...data, powerMW: num(e.target.value) })} />
        </label>
      ) : (
        <>
          <label className="ne-field">
            Item
            <ItemSelect value={data.item} onChange={(item) => onChange({ ...data, item })} />
          </label>
          <label className="ne-field">
            Per minute
            <input type="number" min={0} value={data.perMin} onChange={(e) => onChange({ ...data, perMin: num(e.target.value) })} />
          </label>
        </>
      )}
      <div className="ne-actions">
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </section>
  )
}

export function BeltInspector({ data, onChange, onDelete }: { data: BeltData; onChange: (d: BeltData) => void; onDelete: () => void }) {
  return (
    <section>
      <h3>Belt</h3>
      <label className="ne-field">
        Item
        <ItemSelect value={data.item} onChange={(item) => onChange({ ...data, item })} />
      </label>
      <label className="ne-field">
        Per minute
        <input type="number" min={0} value={data.perMin ?? 0} onChange={(e) => onChange({ ...data, perMin: num(e.target.value) })} />
      </label>
      {data.tier && (
        <p className={data.overCapacity ? 'ne-warn' : 'ne-help'}>
          {data.overCapacity
            ? `Over capacity: more than a Mk.${data.tier} ${data.item && itemsById.get(data.item)?.form !== 'solid' ? 'pipe' : 'belt'} carries. Split it or raise your best belt.`
            : `Fits on Mk.${data.tier}.`}
        </p>
      )}
      <div className="ne-actions">
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </section>
  )
}
