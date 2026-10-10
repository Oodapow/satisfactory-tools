// Custom React Flow nodes and edges for both editor levels. Edges are drawn like a
// schematic: orthogonal runs with 90° corners and hops where they cross (see router.ts).
// Connection points are coloured by what they carry (belt, pipe, power): hollow while free,
// filled once a line connects to them. Each takes one line.
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
import { FloorPlanContext, type LineLoad } from './floorPlanView'
import { anchors, G, handleInfo, machineIO, UPRIGHT, type Anchor, type BlockKind, type Side } from './grid'
import { labelPoints, route, useRoutedPath, type Point } from './router'
import { JunctionSymbol, LiftSymbol, MergerSymbol, PoleSymbol, SplitterSymbol } from './Symbols'
import {
  transportById,
  type BeltEdge,
  type FloorData,
  type LinkEdge,
  type MachineData,
  type MicroNode,
  type MicroNodeData,
  type Medium,
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
/** A connection point at its exact grid spot on the block's border, coloured by what it carries. */
function GridPort({ node, data, id, a }: { node: string; data: MicroNodeData; id: string; a: Anchor }) {
  const info = handleInfo(data, id)
  const connected = !!useContext(FloorPlanContext)?.used.has(`${node}:${id}`)
  return (
    <Handle
      type={info?.role === 'in' ? 'target' : 'source'}
      id={id}
      position={position[a.side]}
      isConnectable={!connected}
      title={`${info?.medium === 'fluid' ? 'Pipe' : info?.medium === 'power' ? 'Power' : 'Belt'} ${info?.role === 'any' ? 'connection' : info?.role === 'in' ? 'input' : 'output'}${connected ? '' : ' (free)'}`}
      style={{ left: a.dx * G, top: a.dy * G, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }}
      className={`ne-handle m-${info?.medium ?? 'solid'}${info?.role === 'in' ? ' in' : ''}${connected ? ' connected' : ''}`}
    />
  )
}

/** Every connection point of a block. */
function GridPorts({ id, type, data, a }: { id: string; type: BlockKind; data: MicroNodeData; a?: Record<string, Anchor> }) {
  return Object.entries(a ?? anchors(type, data)).map(([h, at]) => <GridPort key={h} node={id} data={data} id={h} a={at} />)
}

// ---------- Macro ----------

export function OutpostBlock({ id, data, selected }: NodeProps<OutpostNode>) {
  const { plan, solution } = data
  const edges = useEdges<LinkEdge>()
  const ins = edges.filter((e) => e.target === id)
  const goal = plan.goals[0]
  const resources = new Map<string, number>()
  for (const x of solution.extraction) resources.set(x.resource, (resources.get(x.resource) ?? 0) + x.perMin)
  // Power lines aren't imports: power is the grid's, shown on its own row.
  const imports: Chip[] = ins.flatMap((e) =>
    e.data?.transport === 'power' ? [] : (e.data?.items ?? []).map((r, i) => ({ key: `${e.id}-${i}`, icon: r.item, text: fmt(r.perMin) })),
  )
  const exports: Chip[] = exportsOf(solution).map((r) => ({ key: r.item, icon: r.item, text: fmt(r.perMin) }))
  const power: Chip[] = [{ key: 'use', icon: POWER, text: `uses ${fmt(solution.power.consumedMW)} MW` }]
  if (solution.power.generatedMW > 0) power.push({ key: 'make', icon: POWER, text: `makes ${fmt(solution.power.generatedMW)} MW` })
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
      <Row label="Power" items={power} />
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
      <BaseEdge path={path} markerEnd={markerEnd} className={`ne-link ne-link-${t}${selected ? ' selected' : ''}${data?.dim ? ' ne-dim' : ''}${data?.lit ? ' ne-lit' : ''}`} />
      <EdgeLabelRenderer>
        <div className={`ne-edge-label nodrag nopan${data?.dim ? ' ne-dim' : ''}`} style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px)` }}>
          <GameIcon id={transportIcon(t)} size={18} title={transportLabel(t)} />
          {t === 'power'
            ? null
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

export function MachineBlock({ id, data, selected }: NodeProps<MicroNode>) {
  const d = data as MachineData
  const recipe = recipesById.get(d.recipe)
  const building = buildingsById.get(d.building)
  const output = recipe?.products[0]?.item ?? (d.fuel ? POWER : undefined)
  const io = machineIO(d)
  return (
    <div className={`ne-machine${selected ? ' selected' : ''}`} title={`In: ${io.ins.map(itemName).join(', ') || 'nothing'} · Out: ${io.outs.map(itemName).join(', ') || 'power'}`}>
      <GridPorts id={id} type="machine" data={d} />
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
  return (
    <div className={`ne-joint splitter${selected ? ' selected' : ''}`} title="Conveyor Splitter">
      <GridPorts id={id} type="splitter" data={data} a={anchors('splitter', data, useOrient(id))} />
      <GameIcon id="Desc_ConveyorAttachmentSplitter_C" size={24} fallback={<SplitterSymbol />} />
    </div>
  )
}

/** Merger: in at the back, up and down, out ahead. Its connection points turn to face its belts; the icon stays upright. */
export function MergerBlock({ id, data, selected }: NodeProps<MicroNode>) {
  return (
    <div className={`ne-joint merger${selected ? ' selected' : ''}`} title="Conveyor Merger">
      <GridPorts id={id} type="merger" data={data} a={anchors('merger', data, useOrient(id))} />
      <GameIcon id="Desc_ConveyorAttachmentMerger_C" size={24} fallback={<MergerSymbol />} />
    </div>
  )
}

/** Pipeline Junction: four pipe connections, each in or out. */
export function JunctionBlock({ id, data, selected }: NodeProps<MicroNode>) {
  return (
    <div className={`ne-joint junction${selected ? ' selected' : ''}`} title="Pipeline Junction">
      <GridPorts id={id} type="junction" data={data} a={anchors('junction', data, useOrient(id))} />
      <GameIcon id="Desc_PipelineJunction_Cross_C" size={24} fallback={<JunctionSymbol />} />
    </div>
  )
}

/** Power pole: its power lines round the edge, one per connection point. */
export function PoleBlock({ id, data, selected }: NodeProps<MicroNode>) {
  const tier = data.kind === 'pole' ? data.tier : 1
  return (
    <div className={`ne-pole${selected ? ' selected' : ''}`} title={`Power Pole Mk.${tier}`}>
      <GridPorts id={id} type="pole" data={data} />
      <div className="ne-pole-disc">
        <GameIcon id={`Desc_PowerPoleMk${tier}_C`} size={20} fallback={<PoleSymbol size={18} />} />
      </div>
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
      <GridPorts id={id} type="port" data={d} a={a} />
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

/** A belt, pipe or power line on the floor plan, following its grid route. */
export function BeltLine(props: EdgeProps<BeltEdge>) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props
  const view = useContext(FloorPlanContext)
  const load = view?.loads.get(id)
  const medium = load?.medium ?? data?.medium ?? 'solid'
  const grid = view && !view.dragging.has(source) && !view.dragging.has(target) ? view.routes.get(id) : undefined
  if (medium === 'power') return <WireLine id={id} grid={grid} selected={!!selected} clash={!!view?.clashes.has(id)} sx={sourceX} sy={sourceY} tx={targetX} ty={targetY} sp={sourcePosition} tp={targetPosition} />
  return <FlowLine {...props} load={load} medium={medium} grid={grid} clash={!!view?.clashes.has(id)} sx={sourceX} sy={sourceY} tx={targetX} ty={targetY} sp={sourcePosition} tp={targetPosition} />
}

/** A power line: on the grid like a belt, but thin, with no direction and nothing carried. */
function WireLine({ id, grid, selected, clash, sx, sy, tx, ty, sp, tp }: { id: string; grid?: Point[]; selected: boolean; clash: boolean; sx: number; sy: number; tx: number; ty: number; sp: Position; tp: Position }) {
  const pts = useMemo(() => grid ?? route(id, { x: sx, y: sy }, sp, { x: tx, y: ty }, tp), [grid, id, sx, sy, sp, tx, ty, tp])
  const path = useRoutedPath(id, pts)
  return <BaseEdge path={path} className={`ne-wire${clash ? ' clash' : ''}${selected ? ' selected' : ''}`} />
}

function FlowLine({
  id,
  data,
  selected,
  load,
  medium,
  grid,
  clash,
  sx,
  sy,
  tx,
  ty,
  sp,
  tp,
}: EdgeProps<BeltEdge> & { load?: LineLoad; medium: Medium; grid?: Point[]; clash: boolean; sx: number; sy: number; tx: number; ty: number; sp: Position; tp: Position }) {
  // The grid route, unless one of its blocks is being dragged (then a plain route follows the drag).
  const pts = useMemo(() => grid ?? route(id, { x: sx, y: sy }, sp, { x: tx, y: ty }, tp), [grid, id, sx, sy, sp, tx, ty, tp])
  const path = useRoutedPath(id, pts)
  const { label, vertical } = labelPoints(pts)
  // Short hops (a splitter dropping into its machine) carry no label, so it doesn't sit on the blocks; selecting the line shows it.
  const longest = Math.max(0, ...pts.slice(1).map((p, i) => Math.abs(p.x - pts[i].x) + Math.abs(p.y - pts[i].y)))
  const showLabel = selected || longest >= 3 * G
  const lift = medium === 'solid' ? (data?.lift ?? 0) : 0
  const pipe = medium === 'fluid'
  const over = !!load?.over
  const what = `${load?.item ? itemName(load.item) : 'Unassigned'} · ${load?.perMin !== undefined ? `${fmt(load.perMin)}/min` : 'rate unknown'}${load?.tier ? ` · ${pipe ? 'Pipeline' : 'Belt'} Mk.${load.tier}` : ''}${load?.manual ? ' · set by hand' : ''}`
  return (
    <>
      <BaseEdge path={path} markerEnd={`url(#ne-arrow-${pipe ? 'pipe' : 'belt'})`} className={`ne-belt${pipe ? ' pipe' : ''}${over ? ' over' : ''}${clash ? ' clash' : ''}${selected ? ' selected' : ''}`} />
      <EdgeLabelRenderer>
        {showLabel && (
          <div
            className={`ne-belt-label nodrag nopan${pipe ? ' pipe' : ''}${over ? ' over' : ''}`}
            style={{ transform: `translate(-50%,-50%) translate(${label.x}px,${label.y}px)` }}
            title={what}
          >
            {load?.item && <GameIcon id={load.item} size={12} />}
            {load?.perMin !== undefined ? fmt(load.perMin) : '?'}
            {load?.tier ? <em>Mk{load.tier}</em> : null}
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

/** Arrowheads for belts and pipes, coloured to match. */
export function LineMarkers() {
  return (
    <svg className="ne-markers" aria-hidden>
      <defs>
        {(['belt', 'pipe'] as const).map((k) => (
          <marker key={k} id={`ne-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M0,0L10,5L0,10z" className={`ne-arrow-${k}`} />
          </marker>
        ))}
      </defs>
    </svg>
  )
}
