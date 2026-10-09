// Custom React Flow nodes and edges for both editor levels. All edges are straight lines.
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  Handle,
  Position,
  useEdges,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react'
import { buildingsById, itemName, recipesById } from '../data'
import { exportsOf } from '../plan/network'
import { fmt } from './generate'
import { GameIcon } from './GameIcon'
import { POWER } from './icons'
import {
  transportById,
  type BeltEdge,
  type FloorData,
  type LinkEdge,
  type MachineData,
  type MicroNode,
  type OutpostNode,
  type PortData,
} from './model'

const transportIcon = (t: string) => (t === 'resource' ? 'Desc_MinerMk1_C' : (transportById.get(t as never)?.icon ?? 'Desc_ConveyorBeltMk1_C'))
const transportLabel = (t: string) => (t === 'resource' ? 'Resource node' : (transportById.get(t as never)?.label ?? t))

type Chip = { key: string; icon: string; text: string }

// ---------- Macro ----------

export function OutpostBlock({ id, data, selected }: NodeProps<OutpostNode>) {
  const { plan, solution } = data
  const edges = useEdges<LinkEdge>()
  const ins = edges.filter((e) => e.target === id)
  const goal = plan.goals[0]
  const resources = new Map<string, number>()
  for (const x of solution.extraction) resources.set(x.resource, (resources.get(x.resource) ?? 0) + x.perMin)
  const imports: Chip[] = ins.flatMap((e) =>
    e.data?.transport === 'power'
      ? [{ key: e.id, icon: POWER, text: `${fmt(e.data.powerMW ?? 0)} MW` }]
      : (e.data?.items ?? []).map((r, i) => ({ key: `${e.id}-${i}`, icon: r.item, text: fmt(r.perMin) })),
  )
  const exports: Chip[] = exportsOf(solution).map((r) => ({ key: r.item, icon: r.item, text: fmt(r.perMin) }))
  if (solution.power.exportedMW > 0) exports.push({ key: 'mw', icon: POWER, text: `${fmt(solution.power.exportedMW)} MW` })
  const short = [...solution.flows.values()].filter((f) => f.shortfall > 1e-6)

  return (
    <div className={`ne-outpost${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="ne-outpost-head">
        <GameIcon id={goal?.kind === 'item' ? goal.item : goal?.kind === 'power' ? POWER : 'Desc_TradingPost_C'} size={32} />
        <div>
          <strong>{plan.name}</strong>
          <div className="ne-sub">
            {plan.goals.length
              ? plan.goals.map((g) => (g.kind === 'item' ? `${fmt(g.perMin)} ${itemName(g.item)}/min` : `${fmt(g.mw)} MW`)).join(' · ')
              : 'No goal yet'}
          </div>
        </div>
      </div>
      {resources.size > 0 && <Row label="Extracts" items={[...resources].map(([item, r]) => ({ key: item, icon: item, text: fmt(r) }))} />}
      {imports.length > 0 && <Row label="Imports" items={imports} />}
      {exports.length > 0 && <Row label="Exports" items={exports} />}
      <Row label="Power" items={[{ key: 'use', icon: POWER, text: `uses ${fmt(solution.power.consumedMW)} MW` }]} />
      {short.length > 0 && (
        <div className="ne-short">Short: {short.map((f) => `${fmt(f.shortfall)} ${itemName(f.item)}`).join(', ')}</div>
      )}
      <div className="ne-hint">Double-click for the floor plan</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function Row({ label, items }: { label: string; items: Chip[] }) {
  return (
    <div className="ne-row">
      <span className="ne-row-label">{label}</span>
      <span className="ne-chips">
        {items.map((c) => (
          <span key={c.key} className="ne-chip">
            <GameIcon id={c.icon} size={16} />
            {c.text}
          </span>
        ))}
      </span>
    </div>
  )
}

export function LinkLine(props: EdgeProps<LinkEdge>) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, data, selected, markerEnd } = props
  // Several links between the same two outposts are drawn side by side instead of on top of each other.
  const siblings = useEdges().filter((e) => (e.source === source && e.target === target) || (e.source === target && e.target === source))
  const i = siblings.findIndex((e) => e.id === id)
  const shift = (i - (siblings.length - 1) / 2) * 28
  const len = Math.hypot(targetX - sourceX, targetY - sourceY) || 1
  const ox = (-(targetY - sourceY) / len) * shift
  const oy = ((targetX - sourceX) / len) * shift
  const [path, x, y] = getStraightPath({ sourceX: sourceX + ox, sourceY: sourceY + oy, targetX: targetX + ox, targetY: targetY + oy })
  const t = data?.transport ?? 'belt'
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} className={`ne-link ne-link-${t}${selected ? ' selected' : ''}`} />
      <EdgeLabelRenderer>
        <div className="ne-edge-label nodrag nopan" style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px)` }}>
          <GameIcon id={transportIcon(t)} size={16} title={transportLabel(t)} />
          {t === 'power'
            ? `${fmt(data?.powerMW ?? 0)} MW`
            : (data?.items ?? []).map((r) => (
                <span key={r.item} className="ne-chip">
                  <GameIcon id={r.item} size={16} />
                  {fmt(r.perMin)}
                </span>
              ))}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

// ---------- Micro ----------

export function MachineBlock({ data, selected }: NodeProps<MicroNode>) {
  const d = data as MachineData
  const recipe = recipesById.get(d.recipe)
  const building = buildingsById.get(d.building)
  const output = recipe?.products[0]?.item ?? (d.fuel ? POWER : undefined)
  return (
    <div className={`ne-machine${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Top} id="in" />
      <GameIcon id={d.building} size={30} />
      <div className="ne-machine-text">
        <strong>
          {d.count > 1 ? `${d.count}× ` : ''}
          {building?.name ?? d.building}
        </strong>
        <span className="ne-sub">
          {recipe?.name ?? (d.fuel ? itemName(d.fuel) : 'No recipe')} · {Math.round(d.clock * 1000) / 10}%
        </span>
      </div>
      {output && <GameIcon id={output} size={22} />}
      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  )
}

export function SplitterBlock({ selected }: NodeProps<MicroNode>) {
  return (
    <div className={`ne-joint splitter${selected ? ' selected' : ''}`} title="Conveyor Splitter">
      <Handle type="target" position={Position.Left} id="in" />
      <GameIcon id="Desc_ConveyorAttachmentSplitter_C" size={22} />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="source" position={Position.Bottom} id="down" />
    </div>
  )
}

export function MergerBlock({ selected }: NodeProps<MicroNode>) {
  return (
    <div className={`ne-joint merger${selected ? ' selected' : ''}`} title="Conveyor Merger">
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="target" position={Position.Top} id="up" />
      <GameIcon id="Desc_ConveyorAttachmentMerger_C" size={22} />
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  )
}

export function PortBlock({ data, selected }: NodeProps<MicroNode>) {
  const d = data as PortData
  const isIn = d.direction === 'in'
  const via = d.transport === 'resource' ? (d.extractor ?? 'Desc_MinerMk1_C') : transportIcon(d.transport)
  return (
    <div className={`ne-port ${d.direction}${selected ? ' selected' : ''}`}>
      {!isIn && <Handle type="target" position={Position.Left} id="in" />}
      <GameIcon id={via} size={26} title={transportLabel(d.transport)} />
      <div>
        <div className="ne-sub">
          {d.transport === 'resource' ? d.label : `${isIn ? 'From' : 'To'} ${d.label ?? '?'} · ${transportLabel(d.transport)}`}
        </div>
        <strong className="ne-port-item">
          {d.transport === 'power' ? (
            <>
              <GameIcon id={POWER} size={18} /> {fmt(d.powerMW ?? 0)} MW
            </>
          ) : (
            <>
              <GameIcon id={d.item} size={18} /> {fmt(d.perMin)} {d.item ? itemName(d.item) : 'Unassigned'}/min
            </>
          )}
        </strong>
      </div>
      {isIn && <Handle type="source" position={Position.Right} id="out" />}
    </div>
  )
}

export function FloorBand({ data }: NodeProps<MicroNode>) {
  const d = data as FloorData
  return (
    <div className="ne-floor" style={{ width: d.width, height: d.height }}>
      <span>{d.label}</span>
    </div>
  )
}

export function BeltLine(props: EdgeProps<BeltEdge>) {
  const { sourceX, sourceY, targetX, targetY, data, selected, markerEnd } = props
  const [path, x, y] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} className={`ne-belt${data?.overCapacity ? ' over' : ''}${selected ? ' selected' : ''}`} />
      {data?.perMin !== undefined && (
        <EdgeLabelRenderer>
          <div
            className={`ne-belt-label nodrag nopan${data.overCapacity ? ' over' : ''}`}
            style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px)` }}
            title={`${data.item ? itemName(data.item) : 'Unassigned'} · ${fmt(data.perMin)}/min${data.tier ? ` · Mk.${data.tier}` : ''}`}
          >
            <GameIcon id={data.item} size={12} />
            {fmt(data.perMin)}
            {data.tier ? <em>Mk{data.tier}</em> : null}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
