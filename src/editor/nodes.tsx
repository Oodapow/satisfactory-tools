// Custom React Flow nodes and edges for both editor levels. Edges are drawn like a
// schematic: orthogonal runs with 90° corners and hops where they cross (see router.ts).
// Ports are hollow circles while free and filled once something connects to them.
import { useContext, useEffect, useMemo, type CSSProperties } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  useEdges,
  useNodeConnections,
  useUpdateNodeInternals,
  type EdgeProps,
  type HandleType,
  type NodeProps,
} from '@xyflow/react'
import { buildingsById, itemName, recipesById } from '../data'
import { exportsOf } from '../plan/network'
import { fmt } from './generate'
import { GameIcon } from '../ui/GameIcon'
import { POWER } from '../data/icons'
import { FloorPlanContext } from './floorPlanView'
import { anchors, G, machineIO, UPRIGHT, type Anchor, type Side } from './grid'
import { labelPoints, route, useRoutedPath } from './router'
import { LiftSymbol, MergerSymbol, SplitterSymbol } from './Symbols'
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

/** A connection point: hollow while free, filled once connected. */
function Port({ type, position, id, style }: { type: HandleType; position: Position; id?: string; style?: CSSProperties }) {
  const connected = useNodeConnections({ handleType: type, handleId: id }).length > 0
  return <Handle type={type} position={position} id={id} style={style} className={`ne-handle ne-handle-${type}${connected ? ' connected' : ''}`} />
}

/** Which way a joint or port faces; React Flow re-measures its handles when that changes. */
function useOrient(id: string) {
  const o = useContext(FloorPlanContext)?.orients.get(id) ?? UPRIGHT
  const updateInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateInternals(id)
  }, [id, o.rot, o.mirror, updateInternals])
  return o
}

const position: Record<Side, Position> = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom }
/** A connection point at its exact grid spot on the block's border. */
function GridPort({ type, id, a }: { type: HandleType; id: string; a: Anchor }) {
  return (
    <Port
      type={type}
      id={id}
      position={position[a.side]}
      style={{ left: a.dx * G, top: a.dy * G, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }}
    />
  )
}

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
      <Port type="target" position={Position.Left} />
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
      <Port type="source" position={Position.Right} />
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
            <GameIcon id={c.icon} size={18} />
            {c.text}
          </span>
        ))}
      </span>
    </div>
  )
}

export function LinkLine(props: EdgeProps<LinkEdge>) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props
  // Several links between the same two outposts run side by side instead of on top of each other.
  const siblings = useEdges().filter((e) => (e.source === source && e.target === target) || (e.source === target && e.target === source))
  const i = siblings.findIndex((e) => e.id === id)
  const shift = (i - (siblings.length - 1) / 2) * 26
  const pts = useMemo(
    () => route(id, { x: sourceX, y: sourceY }, sourcePosition, { x: targetX, y: targetY }, targetPosition, { shift }),
    [id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, shift],
  )
  const path = useRoutedPath(id, pts)
  const { x, y } = labelPoints(pts).label
  const t = data?.transport ?? 'belt'
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} className={`ne-link ne-link-${t}${selected ? ' selected' : ''}`} />
      <EdgeLabelRenderer>
        <div className="ne-edge-label nodrag nopan" style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px)` }}>
          <GameIcon id={transportIcon(t)} size={18} title={transportLabel(t)} />
          {t === 'power'
            ? `${fmt(data?.powerMW ?? 0)} MW`
            : (data?.items ?? []).map((r) => (
                <span key={r.item} className="ne-chip">
                  <GameIcon id={r.item} size={18} />
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
  const io = machineIO(d)
  const points = Object.entries(anchors('machine', d))
  return (
    <div className={`ne-machine${selected ? ' selected' : ''}`} title={`In: ${io.ins.map(itemName).join(', ') || 'nothing'} · Out: ${io.outs.map(itemName).join(', ') || 'power'}`}>
      {points.map(([h, a]) => (
        <GridPort key={h} type={a.side === 't' ? 'target' : 'source'} id={h} a={a} />
      ))}
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
    </div>
  )
}

/** Splitter: in at the back, out ahead, up and down. Its connection points turn to face its belts; the icon stays upright. */
export function SplitterBlock({ id, data, selected }: NodeProps<MicroNode>) {
  const a = anchors('splitter', data, useOrient(id))
  return (
    <div className={`ne-joint splitter${selected ? ' selected' : ''}`} title="Conveyor Splitter">
      <GridPort type="target" id="in" a={a.in} />
      <GameIcon id="Desc_ConveyorAttachmentSplitter_C" size={24} fallback={<SplitterSymbol />} />
      <GridPort type="source" id="out" a={a.out} />
      <GridPort type="source" id="up" a={a.up} />
      <GridPort type="source" id="down" a={a.down} />
    </div>
  )
}

/** Merger: in at the back, up and down, out ahead. Its connection points turn to face its belts; the icon stays upright. */
export function MergerBlock({ id, data, selected }: NodeProps<MicroNode>) {
  const a = anchors('merger', data, useOrient(id))
  return (
    <div className={`ne-joint merger${selected ? ' selected' : ''}`} title="Conveyor Merger">
      <GridPort type="target" id="in" a={a.in} />
      <GridPort type="target" id="up" a={a.up} />
      <GridPort type="target" id="down" a={a.down} />
      <GameIcon id="Desc_ConveyorAttachmentMerger_C" size={24} fallback={<MergerSymbol />} />
      <GridPort type="source" id="out" a={a.out} />
    </div>
  )
}

export function PortBlock({ id, data, selected }: NodeProps<MicroNode>) {
  const d = data as PortData
  const isIn = d.direction === 'in'
  const a = anchors('port', d, useOrient(id))
  const via = d.transport === 'resource' ? (d.extractor ?? 'Desc_MinerMk1_C') : transportIcon(d.transport)
  return (
    <div className={`ne-port ${d.direction}${selected ? ' selected' : ''}`}>
      {!isIn && <GridPort type="target" id="in" a={a.in} />}
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
      {isIn && <GridPort type="source" id="out" a={a.out} />}
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
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props
  // The grid route, unless one of its blocks is being dragged (then a plain route follows the drag).
  const view = useContext(FloorPlanContext)
  const grid = view && !view.dragging.has(source) && !view.dragging.has(target) ? view.routes.get(id) : undefined
  const pts = useMemo(
    () => grid ?? route(id, { x: sourceX, y: sourceY }, sourcePosition, { x: targetX, y: targetY }, targetPosition),
    [grid, id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition],
  )
  const path = useRoutedPath(id, pts)
  const { label, vertical } = labelPoints(pts)
  // Short hops (a splitter dropping into its machine) carry no label, so it doesn't sit on the blocks; selecting the belt shows it.
  const longest = Math.max(0, ...pts.slice(1).map((p, i) => Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y)))
  const showLabel = selected || longest >= 3 * G
  const lift = data?.lift ?? 0
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} className={`ne-belt${data?.overCapacity ? ' over' : ''}${selected ? ' selected' : ''}`} />
      <EdgeLabelRenderer>
        {data?.perMin !== undefined && showLabel && (
          <div
            className={`ne-belt-label nodrag nopan${data.overCapacity ? ' over' : ''}`}
            style={{ transform: `translate(-50%,-50%) translate(${label.x}px,${label.y}px)` }}
            title={`${data.item ? itemName(data.item) : 'Unassigned'} · ${fmt(data.perMin)}/min${data.tier ? ` · Mk.${data.tier}` : ''}`}
          >
            <GameIcon id={data.item} size={12} />
            {fmt(data.perMin)}
            {data.tier ? <em>Mk{data.tier}</em> : null}
          </div>
        )}
        {lift !== 0 && vertical && (
          <div
            className="ne-lift nodrag nopan"
            style={{ transform: `translate(-50%,-50%) translate(${vertical.x}px,${vertical.y + 22}px)` }}
            title={`Conveyor lift, ${Math.abs(lift)} floor${Math.abs(lift) === 1 ? '' : 's'} ${lift > 0 ? 'up' : 'down'}`}
          >
            <GameIcon id="Desc_ConveyorLiftMk1_C" size={16} fallback={<LiftSymbol down={lift < 0} />} />{lift > 0 ? '↑' : '↓'}
            {Math.abs(lift)}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
