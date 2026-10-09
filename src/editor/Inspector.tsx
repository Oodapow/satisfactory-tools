// Side panel forms for whatever is selected in the editor.
import { buildingsById, itemName, itemsById, recipesById } from '../data'
import { offers, type Solved } from '../plan/network'
import { newId, type PlanPatch } from '../plan/store'
import type { Import, Transport as PlanTransport } from '../plan/types'
import { fmt } from './generate'
import { GameIcon } from '../ui/GameIcon'
import { IconSelect } from '../ui/IconSelect'
import { POWER } from '../data/icons'
import type { LineLoad } from './floorPlanView'
import { transports, type BeltData, type LinkEdge, type MachineData, type PortData, type PowerLine } from './model'
import { editorPath } from './route'
import { useUnlocked } from './unlocked'
import { GridPanel, OutpostPower } from './PowerWidgets'

const num = (v: string, fallback = 0) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback)

function ItemSelect({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const unlocked = useUnlocked()
  // Keep an item picked earlier listed even if the game state no longer has it.
  const current = value && !unlocked.items.some((i) => i.id === value) ? itemsById.get(value) : undefined
  const pickable = current ? [current, ...unlocked.items] : unlocked.items
  return (
    <IconSelect value={value} onChange={onChange} placeholder="Pick an item" options={pickable.map((i) => ({ value: i.id, label: i.name, icon: i.id }))} />
  )
}

export function MacroOverview({ all, onSelect, onExample }: { all: Solved[]; onSelect: (id: string) => void; onExample: () => void }) {
  // The example uses an Assembler and Coal Generators; don't show it before those are unlocked.
  const unlocked = useUnlocked()
  const exampleFits = ['Desc_AssemblerMk1_C', 'Desc_GeneratorCoal_C'].every((id) => [...unlocked.machines, ...unlocked.generators].some((b) => b.id === id))
  return (
    <section>
      <h3>Factory map</h3>
      <p className="ne-help">
        Every outpost plan is a block here, and every import is a link. Select an outpost to see what it imports and exports and
        what the others can send it.
      </p>
      <GridPanel all={all} onSelect={onSelect} />
      <h4>Outposts</h4>
      <ul className="ne-list">
        {all.map(({ plan }) => {
          const g = plan.goals[0]
          return (
            <li key={plan.id}>
              <button type="button" className="ghost ne-list-btn" onClick={() => onSelect(plan.id)}>
                <GameIcon id={g?.kind === 'item' ? g.item : g ? POWER : 'Desc_TradingPost_C'} size={22} link={false} />
                {plan.name}
              </button>
            </li>
          )
        })}
      </ul>
      {all.length === 0 && exampleFits && (
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
            <GameIcon id={g.kind === 'item' ? g.item : POWER} size={20} />
            {g.kind === 'item' ? `${fmt(g.perMin)} ${itemName(g.item)}/min` : `${fmt(g.mw)} MW from ${itemName(g.fuel)}`}
          </li>
        ))}
        {!plan.goals.length && <li className="ne-help">No goal yet.</li>}
      </ul>
      <a className="ne-textlink" href={`#/outposts/${plan.id}/goal`}>
        Edit goal, resources and recipes
      </a>
      <OutpostPower solved={solved} all={all} powerLines={powerLines} />

      <h4>Imports</h4>
      {plan.imports.length ? (
        <ul className="ne-list">
          {plan.imports.map((i) => (
            <li key={i.id}>
              <GameIcon id={i.item} size={18} />
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
      {exported.length ? (
        <ul className="ne-list">
          {exported.map((f) => {
            const taken = importsFromOthers.filter((i) => i.item === f.item)
            return (
              <li key={f.item}>
                <GameIcon id={f.item} size={18} />
                {fmt(f.exported)} {itemName(f.item)}/min
                {taken.length > 0 && <span className="ne-help"> · to {taken.map((t) => t.to).join(', ')}</span>}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="ne-help">{solution.power.exportedMW > 1e-6 ? 'Only power, shown above.' : 'Nothing leaves this outpost yet.'}</p>
      )}

      <h4>Available from other outposts</h4>
      {available.length === 0 && powerOffers.length === 0 && <p className="ne-help">The other outposts have nothing spare.</p>}
      {available.map((o) => (
        <div key={`${o.from}-${o.item}`} className="ne-offer-row">
          <GameIcon id={o.item} size={20} />
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
          <GameIcon id={POWER} size={20} />
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
  const unlocked = useUnlocked()
  const planTransports = transports.filter((t) => t.id !== 'power' && (t.id === imp?.via || unlocked.transports.includes(t)))
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
            <IconSelect
              value={imp.via}
              onChange={(via) => onImport({ ...imp, via: via as PlanTransport })}
              options={planTransports.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
            />
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
  const unlocked = useUnlocked()
  // Keep what's placed listed even when the game state doesn't have it unlocked.
  const machines = b && !isGenerator && !unlocked.machines.includes(b) ? [...unlocked.machines, b] : unlocked.machines
  const generators = b && isGenerator && !unlocked.generators.includes(b) ? [...unlocked.generators, b] : unlocked.generators
  const recipeOptions = unlocked.recipesIn(data.building)
  if (recipe && !recipeOptions.includes(recipe)) recipeOptions.unshift(recipe)
  const fuelOptions = unlocked.fuelsOf(b)
  if (data.fuel && !fuelOptions.some((f) => f.fuel === data.fuel)) fuelOptions.unshift(...(b?.generator?.fuels.filter((f) => f.fuel === data.fuel) ?? []))
  const runs = data.clock * data.count
  const rate = (amount: number) => (recipe ? (amount * 60 * runs) / recipe.durationSeconds : 0)
  return (
    <section>
      <h3>
        <GameIcon id={data.building} size={26} /> {b?.name ?? 'Machine'}
      </h3>
      <label className="ne-field">
        Building
        <IconSelect
          value={data.building}
          onChange={(building) => {
            const nb = buildingsById.get(building)
            onChange({
              ...data,
              building,
              recipe: nb?.generator ? '' : (unlocked.recipesIn(building)[0]?.id ?? ''),
              fuel: unlocked.fuelsOf(nb)[0]?.fuel,
            })
          }}
          options={[
            ...machines.map((m) => ({ value: m.id, label: m.name, icon: m.id, group: 'Production' })),
            ...generators.map((m) => ({ value: m.id, label: m.name, icon: m.id, group: 'Power' })),
          ]}
        />
      </label>
      {isGenerator ? (
        <label className="ne-field">
          Fuel
          <IconSelect
            value={data.fuel}
            onChange={(fuel) => onChange({ ...data, fuel })}
            options={fuelOptions.map((f) => ({ value: f.fuel, label: itemName(f.fuel), icon: f.fuel }))}
          />
        </label>
      ) : (
        <label className="ne-field">
          Recipe
          <IconSelect
            value={data.recipe}
            onChange={(recipe) => onChange({ ...data, recipe })}
            options={recipeOptions.map((r) => ({
              value: r.id,
              label: `${r.name}${r.alternate ? ' (alt)' : ''}`,
              icon: r.products[0]?.item,
            }))}
          />
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
                <GameIcon id={i.item} size={18} /> In: {fmt(rate(i.amount))} {itemName(i.item)}
              </li>
            ))}
            {recipe.products.map((p) => (
              <li key={p.item}>
                <GameIcon id={p.item} size={18} /> Out: {fmt(rate(p.amount))} {itemName(p.item)}
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
  const unlocked = useUnlocked()
  const portTransports = transports.filter((t) => t.id === data.transport || unlocked.transports.includes(t))
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
          <IconSelect
            value={data.transport}
            onChange={(transport) => onChange({ ...data, transport: transport as PortData['transport'] })}
            options={[
              ...portTransports.map((t) => ({ value: t.id as string, label: t.label, icon: t.icon })),
              { value: 'resource', label: 'Resource node', icon: 'Desc_MinerMk1_C' },
            ]}
          />
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

export function BeltInspector({ data, load, onChange, onDelete }: { data: BeltData; load?: LineLoad; onChange: (d: BeltData) => void; onDelete: () => void }) {
  const medium = load?.medium ?? data.medium ?? 'solid'
  const name = medium === 'fluid' ? 'Pipe' : medium === 'power' ? 'Power line' : 'Belt'
  if (medium === 'power')
    return (
      <section>
        <h3>{name}</h3>
        <p className="ne-help">Carries power between a pole and what it feeds. Power lines run on the grid like belts, after belts and pipes have their routes.</p>
        <div className="ne-actions">
          <button type="button" className="danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </section>
    )
  return (
    <section>
      <h3>{name}</h3>
      <p className="ne-help">
        {data.manual
          ? 'Item and rate set by hand.'
          : 'Item and rate are worked out from what this connects: the machine, port or joint that feeds it and what takes from it. Change either to set it by hand.'}
      </p>
      <label className="ne-field">
        Item
        <ItemSelect value={load?.item} onChange={(item) => onChange({ ...data, manual: true, item, perMin: load?.perMin })} />
      </label>
      <label className="ne-field">
        Per minute
        <input
          type="number"
          min={0}
          value={load?.perMin !== undefined ? Math.round(load.perMin * 100) / 100 : ''}
          placeholder="Unknown"
          onChange={(e) => onChange({ ...data, manual: true, item: load?.item, perMin: num(e.target.value) })}
        />
      </label>
      {load?.tier && (
        <p className={load.over ? 'ne-warn' : 'ne-help'}>
          {load.over
            ? `Over capacity: more than a Mk.${load.tier} ${medium === 'fluid' ? 'pipe' : 'belt'} carries. Split it or raise your best ${medium === 'fluid' ? 'pipe' : 'belt'}.`
            : `Fits on a Mk.${load.tier} ${medium === 'fluid' ? 'pipeline' : 'belt'}.`}
        </p>
      )}
      <div className="ne-actions">
        {data.manual && (
          <button type="button" className="ghost" onClick={() => onChange({ ...data, manual: undefined })}>
            Work it out again
          </button>
        )}
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </section>
  )
}
