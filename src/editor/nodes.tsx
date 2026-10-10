// Custom React Flow nodes and edges for both editor levels. Edges are drawn like a
// schematic: orthogonal runs with 90° corners and hops where they cross (see router.ts).
// Ports are hollow circles while free and filled once something connects to them.
import { useContext, useEffect, useMemo, type CSSProperties } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
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
import { FloorPlanContext } from './floorPlanView'
import { anchors, G, machineIO, UPRIGHT, type Anchor, type Side } from './grid'
import { MAP_G, NEW_IN, POWER_IN, POWER_OUT, type MapPort } from './macro'
import { labelPoints, route, useRoutedPath } from './router'
import { LiftSymbol, MergerSymbol, SplitterSymbol } from './Symbols'
import {
  transportById,
  transportColor,
  type BeltEdge,
  type FloorData,
  type LinkEdge,
  type MachineData,
  type MicroNode,
  type OutpostNode,
  type PortData,
  type Transport,
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

export function OutpostBlock({ data, selected }: NodeProps<OutpostNode>) {
  const { plan, solution, block } = data
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

/** Small arrowhead at a link's input end, in the link's colour. */
export const linkMarker = (t: Transport) => ({ type: MarkerType.ArrowClosed, width: 14, height: 14, color: transportColor[t], markerUnits: 'userSpaceOnUse', strokeWidth: 1 })

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
