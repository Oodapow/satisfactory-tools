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
  useNodeConnections,
  useUpdateNodeInternals,
  type EdgeProps,
  type HandleType,
  type NodeProps,
} from '@xyflow/react'
import { buildingsById, itemName, recipesById } from '../data'
import { fmt } from './generate'
import { GameIcon } from '../ui/GameIcon'
import { POWER } from '../data/icons'
import { FloorPlanContext, type LineLoad } from './floorPlanView'
import { anchors, G, handleInfo, machineIO, machineSize, UPRIGHT, type Anchor, type BlockKind, type Side } from './grid'
import { labelPoints, route, useRoutedPath, type Point } from './router'
import { JunctionSymbol, LiftSymbol, MergerSymbol, PoleSymbol, SplitterSymbol } from './Symbols'
import { MAP_G, NEW_IN, POWER_IN, POWER_OUT, type MapPort } from './macro'
import {
  transportById,
  transportColor,
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

/** A connection point: hollow while free, filled once connected. */
function Port({
  type,
  position,
  id,
  style,
  className,
  title,
}: {
  type: HandleType
  position: Position
  id?: string
  style?: CSSProperties
  className?: string
  title?: string
}) {
  const connected = useNodeConnections({ handleType: type, handleId: id }).length > 0
  return (
    <Handle
      type={type}
      position={position}
      id={id}
      style={style}
      title={title}
      className={`ne-handle ne-handle-${type}${connected ? ' connected' : ''}${className ? ` ${className}` : ''}`}
    />
  )
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

/** One connection point on an outpost's edge, with the item it carries next to it. */
function MapPortView({ p, type }: { p: MapPort; type: HandleType }) {
  const left = type === 'target'
  const free = p.id === NEW_IN
  const power = p.id === POWER_IN || p.id === POWER_OUT
  const rate = power ? `${fmt(p.perMin ?? 0)} MW` : fmt(p.perMin ?? 0)
  return (
    <>
      <Port
        type={type}
        id={p.id}
        position={left ? Position.Left : Position.Right}
        style={{ top: p.dy * MAP_G }}
        className={power ? 'ne-handle-power' : undefined}
        title={free ? 'Free import point' : power ? `Power ${left ? 'in' : 'out'} · ${rate}` : `${itemName(p.item ?? '')} · ${rate}/min`}
      />
      {!free && (
        <span className={`ne-map-port ${left ? 'in' : 'out'}`} style={{ top: p.dy * MAP_G }}>
          <GameIcon id={power ? POWER : p.item} size={18} />
          {(!power || (p.perMin ?? 0) > 0) && <span>{fmt(p.perMin ?? 0)}</span>}
        </span>
      )}
    </>
  )
}

export function OutpostBlock({ id, data, selected }: NodeProps<OutpostNode>) {
  const { plan, solution, block } = data
  // Points come and go as links are made; React Flow re-measures them only when told to.
  const points = [...block.ins, ...block.outs, block.powerIn, block.powerOut].map((p) => p && `${p.id}@${p.dy}`).join()
  const updateInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateInternals(id)
  }, [id, points, block.w, block.h, updateInternals])
  const goal = plan.goals[0]
  // Outposts that only extract show their extractor; their exports are the resources.
  const extractor = !goal ? solution.extraction[0]?.extractor : undefined
  const icon = goal?.kind === 'item' ? goal.item : goal?.kind === 'power' ? POWER : (extractor ?? 'Desc_TradingPost_C')
  const resources = new Map<string, number>()
  if (goal) for (const x of solution.extraction) resources.set(x.resource, (resources.get(x.resource) ?? 0) + x.perMin)
  const short = [...solution.flows.values()].filter((f) => f.shortfall > 1e-6)
  const power = solution.power.exportedMW > 1e-6 ? `+${fmt(solution.power.exportedMW)}` : `${fmt(solution.power.consumedMW)}`
  const { x, y } = block.foundations

  return (
    <div
      className={`ne-outpost${selected ? ' selected' : ''}${short.length ? ' short' : ''}`}
      style={{ width: block.w * MAP_G, height: block.h * MAP_G }}
      title={`${plan.name}${x && y ? ` · ${x} × ${y} foundations` : ''}`}
    >
      {block.ins.map((p) => (
        <MapPortView key={p.id} p={p} type="target" />
      ))}
      {block.outs.map((p) => (
        <MapPortView key={p.id} p={p} type="source" />
      ))}
      {block.powerIn && <MapPortView p={block.powerIn} type="target" />}
      {block.powerOut && <MapPortView p={block.powerOut} type="source" />}
      <div className="ne-outpost-body">
        <GameIcon id={icon} size={32} />
        <strong className="ne-outpost-name">{plan.name}</strong>
        <span className="ne-chips">
          {[...resources].map(([item, r]) => (
            <span key={item} className="ne-chip" title={`Extracts ${fmt(r)} ${itemName(item)}/min`}>
              <GameIcon id={item} size={16} />
              {fmt(r)}
            </span>
          ))}
          {solution.power.consumedMW + solution.power.exportedMW > 1e-6 && (
            <span className="ne-chip" title={solution.power.exportedMW > 1e-6 ? 'Power sent out (MW)' : 'Power used (MW)'}>
              <GameIcon id={POWER} size={16} />
              {power}
            </span>
          )}
          {short.map((f) => (
            <span key={f.item} className="ne-chip short" title={`Short ${fmt(f.shortfall)} ${itemName(f.item)}/min`}>
              <GameIcon id={f.item} size={16} />−{fmt(f.shortfall)}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}

export function LinkLine(props: EdgeProps<LinkEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props
  const pts = useMemo(
    () => route(id, { x: sourceX, y: sourceY }, sourcePosition, { x: targetX, y: targetY }, targetPosition),
    [id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition],
  )
  const path = useRoutedPath(id, pts, 8)
  const { x, y } = labelPoints(pts).label
  const t = data?.transport ?? 'belt'
  const r = data?.items[0]
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} className={`ne-link ne-link-${t}${selected ? ' selected' : ''}`} />
      <EdgeLabelRenderer>
        <div
          className={`ne-edge-label nodrag nopan${selected ? ' selected' : ''}`}
          style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px)`, borderColor: transportColor[t] }}
          title={`${transportLabel(t)}${r ? ` · ${itemName(r.item)}` : ''}`}
        >
          <GameIcon id={transportIcon(t)} size={14} />
          {t === 'power' ? (
            `${fmt(data?.powerMW ?? 0)} MW`
          ) : r ? (
            <>
              <GameIcon id={r.item} size={14} />
              {fmt(r.perMin)}
            </>
          ) : null}
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
  // Drawn at the building's real footprint; turning it moves the points, never the icon.
  const size = machineSize(d.building, d.rot ?? 0)
  const updateInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateInternals(id)
  }, [id, d.rot, d.building, d.recipe, d.fuel, updateInternals])
  return (
    <div
      className={`ne-machine${selected ? ' selected' : ''}`}
      style={{ width: size.w * G, height: size.h * G }}
      title={`${d.count > 1 ? `${d.count}× ` : ''}${building?.name ?? d.building} · ${recipe?.name ?? (d.fuel ? itemName(d.fuel) : 'No recipe')} · ${Math.round(d.clock * 1000) / 10}%\nIn: ${io.ins.map(itemName).join(', ') || 'nothing'} · Out: ${io.outs.map(itemName).join(', ') || 'power'}`}
    >
      <GridPorts id={id} type="machine" data={d} />
      <GameIcon id={d.building} size={Math.min(30, (Math.min(size.w, size.h) * G) / 2)} />
      {output && <GameIcon id={output} size={18} />}
      <span className="ne-machine-clock">
        {d.count > 1 ? `${d.count}× ` : ''}
        {Math.round(d.clock * 100)}%
      </span>
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
