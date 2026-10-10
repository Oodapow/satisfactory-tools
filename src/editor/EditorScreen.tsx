// Node editor: the factory map of outposts (macro) and the floor plan inside one outpost (micro).
import '@xyflow/react/dist/style.css'
import './editor.css'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { buildingsById, itemsById } from '../data'
import { activeGrids, addLink, gridOf, removeLinks as removePowerLinks, renameGrid, type PowerGrid, type PowerLink } from '../plan/grids'
import { offers, type Solved } from '../plan/network'
import { blankPlan } from '../plan/store'
import { useNetwork } from '../plan/useNetwork'
import type { GameState } from '../state/gameState'
import { fmt, proposeLayout, type PortLink } from './generate'
import { GameIcon, NoIconLinks } from '../ui/GameIcon'
import { POWER } from '../data/icons'
import { GridInspector } from './PowerWidgets'
import { BeltInspector, LinkInspector, MachineInspector, MacroOverview, OutpostInspector, PortInspector } from './Inspector'
import {
  beltRates,
  beltTierFor,
  LAYOUT_VERSION,
  type BeltEdge,
  type EditorLayout,
  type LinkEdge,
  type MachineData,
  type MicroGraph,
  type MicroNode,
  type OutpostNode,
  type PortData,
} from './model'
import { G, isBlock } from './grid'
import { connection, place } from './connect'
import { routeFloorPlan } from './gridRouter'
import { inferFlows } from './flow'
import { FloorPlanContext, type FloorPlanView, type LineLoad } from './floorPlanView'
import { BeltLine, FloorBand, JunctionBlock, LineMarkers, LinkLine, MachineBlock, MergerBlock, OutpostBlock, PoleBlock, PortBlock, SplitterBlock } from './nodes'
import { editorPath } from './route'
import { RouteContext, RouteRegistry } from './router'
import { JunctionSymbol, MergerSymbol, PoleSymbol, SplitterSymbol } from './Symbols'
import { examplePlans, useEditorLayout } from './store'
import { UnlockedContext, useUnlocked } from './unlocked'

type Net = ReturnType<typeof useNetwork>
type UpdateLayout = (fn: (l: EditorLayout) => EditorLayout) => void
type Selection = { kind: 'node' | 'edge' | 'grid'; id: string } | null

const DND = 'application/x-satisfactory-node'
const macroNodeTypes = { outpost: OutpostBlock }
const macroEdgeTypes = { link: LinkLine }
const microNodeTypes = { machine: MachineBlock, splitter: SplitterBlock, merger: MergerBlock, junction: JunctionBlock, pole: PoleBlock, port: PortBlock, floor: FloorBand }
const microEdgeTypes = { belt: BeltLine }
const arrow = { type: MarkerType.ArrowClosed, width: 18, height: 18 }
const flowProps = {
  connectionLineType: ConnectionLineType.Step,
  deleteKeyCode: ['Backspace', 'Delete'],
  fitView: true,
  minZoom: 0.1,
  colorMode: 'system' as const,
}

export default function EditorScreen({ state, outpostId }: { state: GameState; outpostId?: string }) {
  const net = useNetwork(state)
  const { layout, update } = useEditorLayout()
  const solved = outpostId ? net.solved.find((s) => s.plan.id === outpostId) : undefined
  return (
    <div className="ne-screen">
      <div className="ne-toolbar">
        <nav className="ne-crumbs" aria-label="Breadcrumb">
          <a href={editorPath()}>Factory map</a>
          {outpostId && (
            <>
              <span>›</span>
              <strong>{solved?.plan.name ?? 'Missing outpost'}</strong>
              {solved && (
                <a className="ne-textlink" href={`#/outposts/${solved.plan.id}/goal`}>
                  Edit plan
                </a>
              )}
            </>
          )}
        </nav>
      </div>
      <UnlockedContext.Provider value={net.available}>
      <ReactFlowProvider key={outpostId ?? 'macro'}>
        {outpostId ? (
          solved ? (
            <MicroEditor net={net} solved={solved} layout={layout} update={update} />
          ) : (
            <p className="ne-help ne-pad">That outpost doesn't exist anymore.</p>
          )
        ) : (
          <MacroEditor net={net} layout={layout} update={update} />
        )}
      </ReactFlowProvider>
      </UnlockedContext.Provider>
    </div>
  )
}

/** Drop palette items on the canvas, or click one to add it in the middle of the view (touch screens can't drag). */
function useDrop(onDrop: (payload: Record<string, string>, pos: { x: number; y: number }) => void) {
  const { screenToFlowPosition } = useReactFlow()
  const ref = useRef<HTMLDivElement>(null)
  return {
    canvas: {
      ref,
      onDragOver: (e: DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        const raw = e.dataTransfer.getData(DND)
        if (raw) onDrop(JSON.parse(raw), screenToFlowPosition({ x: e.clientX, y: e.clientY }))
      },
    },
    addAtCenter: (payload: Record<string, string>) => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const jitter = () => (Math.random() - 0.5) * 60
      onDrop(payload, screenToFlowPosition({ x: r.left + r.width / 2 + jitter(), y: r.top + r.height / 2 + jitter() }))
    },
  }
}

function PaletteItem({
  payload,
  icon,
  onAdd,
  children,
}: {
  payload: Record<string, string>
  icon: string | ReactNode
  onAdd: (p: Record<string, string>) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="ne-palette-item"
      draggable
      title="Drag onto the canvas, or click to add"
      onClick={() => onAdd(payload)}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND, JSON.stringify(payload))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      {typeof icon === 'string' ? <GameIcon id={icon} size={22} /> : icon}
      {children}
    </button>
  )
}

// ---------- Macro ----------

/** Links on the map: every plan import, plus the power lines between outposts. */
function macroEdges(all: Solved[], links: PowerLink[], sel: Selection, grid: PowerGrid | undefined): LinkEdge[] {
  const ids = new Set(all.map((s) => s.plan.id))
  const edges: LinkEdge[] = []
  for (const { plan } of all)
    for (const imp of plan.imports)
      if (ids.has(imp.from))
        edges.push({
          id: imp.id,
          type: 'link',
          source: imp.from,
          target: plan.id,
          markerEnd: arrow,
          selected: sel?.kind === 'edge' && sel.id === imp.id,
          data: { transport: imp.via, items: [{ item: imp.item, perMin: imp.perMin }], ref: { kind: 'import', planId: plan.id, importId: imp.id } },
        })
  // Power lines have no direction, so no arrow.
  for (const l of links)
    if (ids.has(l.a) && ids.has(l.b))
      edges.push({
        id: l.id,
        type: 'link',
        source: l.a,
        target: l.b,
        selected: (sel?.kind === 'edge' && sel.id === l.id) || !!grid?.links.some((x) => x.id === l.id),
        data: { transport: 'power', items: [], ref: { kind: 'power', id: l.id } },
      })
  // With a grid selected, everything not on it fades.
  if (grid) for (const e of edges) if (e.data && (e.data.transport !== 'power' || !e.selected)) e.data = { ...e.data, dim: true }
  return edges
}

function MacroEditor({ net, layout, update }: { net: Net; layout: EditorLayout; update: UpdateLayout }) {
  const [sel, setSel] = useState<Selection>(null)
  const [routes] = useState(() => new RouteRegistry())
  const unlocked = useUnlocked()
  const all = net.solved
  // What a link drawn between two outposts becomes: an import of goods, or a power line.
  const [drawing, setDrawing] = useState<'goods' | 'power'>('goods')
  const selGrid = sel?.kind === 'grid' ? net.grids.find((g) => g.id === sel.id) : undefined

  // Plans are the source of truth: blocks are rebuilt from them on every render, with the
  // sizes React Flow measured and the positions the editor stores.
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({})
  const nodes = useMemo<OutpostNode[]>(
    () =>
      all.map((s, i) => ({
        id: s.plan.id,
        type: 'outpost',
        position: layout.positions[s.plan.id] ?? { x: (i % 3) * 380, y: Math.floor(i / 3) * 320 },
        data: s,
        measured: measured[s.plan.id],
        selected: sel?.kind === 'node' && sel.id === s.plan.id,
        className: selGrid ? (selGrid.members.includes(s.plan.id) ? 'ne-on-grid' : 'ne-dim') : undefined,
      })),
    [all, layout.positions, measured, sel, selGrid],
  )
  const edges = useMemo(() => macroEdges(all, net.gridStore.links, sel, selGrid), [all, net.gridStore.links, sel, selGrid])

  const removeOutposts = (ids: string[]) => {
    for (const id of ids) net.remove(id)
    update((l) => {
      const positions = { ...l.positions }
      const micro = { ...l.micro }
      for (const id of ids) {
        delete positions[id]
        delete micro[id]
      }
      return { ...l, positions, micro }
    })
  }

  const removeLinks = (ids: string[]) => {
    for (const e of edges.filter((x) => ids.includes(x.id))) {
      const ref = e.data!.ref
      if (ref.kind === 'import') {
        const plan = all.find((s) => s.plan.id === ref.planId)?.plan
        if (plan) net.update(plan.id, { imports: plan.imports.filter((i) => i.id !== ref.importId) })
      }
    }
    net.updateGrids((g) => removePowerLinks(g, ids))
  }

  const onNodesChange = (changes: NodeChange<OutpostNode>[]) => {
    const sized = changes.flatMap((c) => (c.type === 'dimensions' && c.dimensions ? [[c.id, c.dimensions] as const] : []))
    if (sized.length) setMeasured((m) => ({ ...m, ...Object.fromEntries(sized) }))
    const moved = changes.flatMap((c) => (c.type === 'position' && c.position ? [[c.id, c.position] as const] : []))
    if (moved.length) update((l) => ({ ...l, positions: { ...l.positions, ...Object.fromEntries(moved) } }))
    const removed = changes.flatMap((c) => (c.type === 'remove' ? [c.id] : []))
    if (removed.length) removeOutposts(removed)
    for (const c of changes) if (c.type === 'select' && c.selected) setSel({ kind: 'node', id: c.id })
  }
  const onEdgesChange = (changes: EdgeChange<LinkEdge>[]) => {
    const removed = changes.flatMap((c) => (c.type === 'remove' ? [c.id] : []))
    if (removed.length) removeLinks(removed)
    for (const c of changes) if (c.type === 'select' && c.selected) setSel({ kind: 'edge', id: c.id })
  }

  const connectPower = (a: string, b: string) => {
    const id = crypto.randomUUID()
    net.updateGrids((g) => addLink(g, a, b, id))
    return id
  }

  // A new link becomes an import of whatever the source has spare, or a power line when drawing power.
  const onConnect = (c: Connection) => {
    if (c.source === c.target) return
    const from = all.find((s) => s.plan.id === c.source)!
    const to = all.find((s) => s.plan.id === c.target)!
    if (drawing === 'power') {
      const existing = net.gridStore.links.find((l) => (l.a === c.source && l.b === c.target) || (l.a === c.target && l.b === c.source))
      setSel({ kind: 'edge', id: existing?.id ?? connectPower(from.plan.id, to.plan.id) })
      return
    }
    const offer = offers(all, to.plan.id).find((o) => o.from === from.plan.id && o.perMin > 1e-6)
    const goal = from.plan.goals.find((g) => g.kind === 'item')
    const item = offer?.item ?? (goal?.kind === 'item' ? goal.item : 'Desc_OreIron_C')
    const id = crypto.randomUUID()
    const via = itemsById.get(item)?.form === 'solid' ? 'belt' : 'pipe'
    net.update(to.plan.id, { imports: [...to.plan.imports, { id, from: from.plan.id, item, perMin: offer?.perMin ?? 60, via }] })
    setSel({ kind: 'edge', id })
  }

  const drop = useDrop((_, position) => {
    const plan = blankPlan(`Outpost ${all.length + 1}`)
    update((l) => ({ ...l, positions: { ...l.positions, [plan.id]: position } }))
    net.save(plan)
    setSel({ kind: 'node', id: plan.id })
  })

  const loadExample = () => {
    const ex = examplePlans()
    for (const p of ex.plans) net.save(p)
    update((l) => ({ ...l, positions: { ...l.positions, ...ex.layout.positions } }))
    net.updateGrids((g) => ex.powerLinks.reduce((s, [a, b]) => addLink(s, a, b), g))
  }

  const selNode = sel?.kind === 'node' ? all.find((s) => s.plan.id === sel.id) : undefined
  const selEdge = sel?.kind === 'edge' ? edges.find((e) => e.id === sel.id) : undefined

  return (
    <div className="ne-body">
      {/* Icons on the canvas and palette select or drag, so they are not catalog links. */}
      <NoIconLinks>
      <aside className="ne-palette">
        <h3>Add</h3>
        <PaletteItem payload={{ kind: 'outpost' }} icon="Desc_TradingPost_C" onAdd={drop.addAtCenter}>
          Outpost
        </PaletteItem>
        <p className="ne-help">Drag an outpost onto the map, or click it. Double-click an outpost for its floor plan.</p>
        <h3>Draw</h3>
        <div className="ne-seg" role="radiogroup" aria-label="What a drawn link becomes">
          {(
            [
              ['goods', 'Desc_ConveyorBeltMk1_C', 'Goods'],
              ['power', POWER, 'Power line'],
            ] as const
          ).map(([k, icon, label]) => (
            <button key={k} type="button" role="radio" aria-checked={drawing === k} className={drawing === k ? 'on' : ''} onClick={() => setDrawing(k)}>
              <GameIcon id={icon} size={18} link={false} />
              {label}
            </button>
          ))}
        </div>
        <p className="ne-help">
          {drawing === 'goods'
            ? "Drag from one outpost's right edge to another's left edge to import what the first has spare."
            : 'Drag from one outpost to another to run a power line. Outposts joined by power lines, directly or through others, share one grid.'}
        </p>
        <h3>Links</h3>
        {unlocked.transports.map((t) => (
          <div key={t.id} className="ne-legend">
            <span className={`ne-swatch ne-link-${t.id}`} />
            {t.label}
          </div>
        ))}
      </aside>
      <div className="ne-canvas" {...drop.canvas}>
        <RouteContext.Provider value={routes}>
        <ReactFlow
          {...flowProps}
          nodes={nodes}
          edges={edges}
          nodeTypes={macroNodeTypes}
          edgeTypes={macroEdgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneClick={() => setSel(null)}
          onNodeDoubleClick={(_, n) => (window.location.hash = editorPath(n.id))}
        >
          <Background gap={24} />
          <Controls />
          <MiniMap pannable zoomable className="ne-minimap" />
        </ReactFlow>
        </RouteContext.Provider>
      </div>
      </NoIconLinks>
      <aside className="ne-inspector">
        {selNode ? (
          <OutpostInspector
            solved={selNode}
            all={all}
            grid={gridOf(net.grids, selNode.plan.id)}
            onPatch={(p) => net.update(selNode.plan.id, p)}
            onSelectGrid={(id) => setSel({ kind: 'grid', id })}
            onAddPowerLink={(other) => connectPower(selNode.plan.id, other)}
            onRemovePowerLink={(id) => net.updateGrids((g) => removePowerLinks(g, [id]))}
            onDelete={() => {
              removeOutposts([selNode.plan.id])
              setSel(null)
            }}
          />
        ) : selEdge ? (
          <LinkInspector
            edge={selEdge}
            all={all}
            onImport={(imp) => {
              const plan = all.find((s) => s.plan.id === selEdge.target)!.plan
              net.update(plan.id, { imports: plan.imports.map((i) => (i.id === imp.id ? imp : i)) })
            }}
            grid={selEdge.data?.ref.kind === 'power' ? gridOf(net.grids, selEdge.source) : undefined}
            onSelectGrid={(id) => setSel({ kind: 'grid', id })}
            onDelete={() => {
              removeLinks([selEdge.id])
              setSel(null)
            }}
          />
        ) : (
          selGrid ? (
            <GridInspector
              grid={selGrid}
              all={all}
              onRename={(name) => net.updateGrids((g) => renameGrid(g, selGrid, name))}
              onRemoveLink={(id) => net.updateGrids((g) => removePowerLinks(g, [id]))}
              onSelect={(id) => setSel({ kind: 'node', id })}
            />
          ) : (
            <MacroOverview
              all={all}
              grids={activeGrids(net.grids)}
              onSelect={(id) => setSel({ kind: 'node', id })}
              onSelectGrid={(id) => setSel({ kind: 'grid', id })}
              onExample={loadExample}
            />
          )
        )}
      </aside>
    </div>
  )
}

// ---------- Micro ----------

/**
 * The macro links touching one outpost, as floor-plan ports. Everything inside an outpost is on
 * its grid, so power is one port: out to the grid for an outpost that makes more than it uses,
 * in from the grid otherwise.
 */
function portLinks(all: Solved[], grid: PowerGrid | undefined, id: string) {
  const name = (pid: string) => all.find((s) => s.plan.id === pid)?.plan.name ?? '?'
  const { plan, solution } = all.find((s) => s.plan.id === id)!
  const incoming: PortLink[] = plan.imports.map((i) => ({ linkId: i.id, other: name(i.from), transport: i.via, item: i.item, perMin: i.perMin }))
  const outgoing: PortLink[] = all.flatMap((s) =>
    s.plan.imports.filter((i) => i.from === id).map((i) => ({ linkId: i.id, other: s.plan.name, transport: i.via, item: i.item, perMin: i.perMin })),
  )
  const net = solution.power.generatedMW - solution.power.consumedMW
  if (grid && Math.abs(net) > 1e-6)
    (net > 0 ? outgoing : incoming).push({ linkId: `grid:${id}`, other: grid.name, transport: 'power', perMin: 0, powerMW: Math.abs(net) })
  return { incoming, outgoing }
}

function MicroEditor({ net, solved, layout, update }: { net: Net; solved: Solved; layout: EditorLayout; update: UpdateLayout }) {
  const id = solved.plan.id
  const [sel, setSel] = useState<Selection>(null)
  const [routes] = useState(() => new RouteRegistry())
  const graph = layout.micro[id]
  const unlocked = useUnlocked()
  const view = useFloorPlanView(graph, unlocked.pipeTier)
  const maxBeltTier = graph?.maxBeltTier ?? unlocked.beltTier
  const { fitView } = useReactFlow()
  const grid = gridOf(net.grids, id)
  const links = useMemo(() => portLinks(net.solved, grid, id), [net.solved, grid, id])

  const propose = useCallback(
    (tier: number) => proposeLayout({ solved, ...links, maxBeltTier: tier, maxPipeTier: unlocked.pipeTier, maxPoleTier: unlocked.poleTier }),
    [solved, links, unlocked.pipeTier, unlocked.poleTier],
  )

  // First visit: propose a layout from the plan. An untouched proposal from an older version is proposed again.
  const outdated = !!graph?.generatedAt && (graph.version ?? 1) < LAYOUT_VERSION
  useEffect(() => {
    if (!graph || outdated) update((l) => ({ ...l, micro: { ...l.micro, [id]: propose(graph?.maxBeltTier ?? unlocked.beltTier) } }))
  }, [graph, outdated, id, propose, update, unlocked.beltTier])

  const setGraph = useCallback(
    (fn: (g: MicroGraph) => MicroGraph) => update((l) => (l.micro[id] ? { ...l, micro: { ...l.micro, [id]: fn(l.micro[id]) } } : l)),
    [id, update],
  )

  // Floor plans saved before the grid existed: put their blocks on it.
  useEffect(() => {
    if (graph?.nodes.some((n) => isBlock(n) && (n.position.x % G || n.position.y % G)))
      setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (isBlock(n) ? { ...n, position: { x: Math.round(n.position.x / G) * G, y: Math.round(n.position.y / G) * G } } : n)) }))
  }, [graph, setGraph])
  // Any manual edit means the layout is no longer the untouched proposal.
  const edited = (g: MicroGraph): MicroGraph => ({ ...g, generatedAt: undefined })

  const regenerate = (tier = maxBeltTier) => {
    if (graph && !graph.generatedAt && !confirm('Replace your edited floor plan with a new proposal?')) return
    update((l) => ({ ...l, micro: { ...l.micro, [id]: propose(tier) } }))
    setSel(null)
    setTimeout(() => fitView({ duration: 300 }), 50)
  }

  const onNodesChange = (changes: NodeChange<MicroNode>[]) => {
    for (const c of changes) if (c.type === 'select' && c.selected) setSel({ kind: 'node', id: c.id })
    setGraph((g) => {
      let nodes = applyNodeChanges(changes, g.nodes)
      // A dropped block lands on free grid space: nudged to the nearest spot no other block covers.
      const dropped = new Set(changes.flatMap((c) => (c.type === 'position' && c.dragging === false ? [c.id] : [])))
      if (dropped.size) nodes = nodes.map((n) => (dropped.has(n.id) && isBlock(n) ? place(nodes, n) : n))
      const removed = new Set(changes.flatMap((c) => (c.type === 'remove' ? [c.id] : [])))
      // Lines go with the blocks they connect.
      const edges = removed.size ? g.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)) : g.edges
      return removed.size || dropped.size ? edited({ ...g, nodes, edges }) : { ...g, nodes }
    })
  }
  const onEdgesChange = (changes: EdgeChange<MicroGraph['edges'][number]>[]) => {
    for (const c of changes) if (c.type === 'select' && c.selected) setSel({ kind: 'edge', id: c.id })
    setGraph((g) => {
      const edges = applyEdgeChanges(changes, g.edges)
      return changes.some((c) => c.type === 'remove') ? edited({ ...g, edges }) : { ...g, edges }
    })
  }
  // A line joins two free points that carry the same thing, an output to an input; dragging either way works.
  const check = (c: Connection | BeltEdge) => (graph ? connection(graph, c) : null)
  const onConnect = (c: Connection) => {
    const ok = check(c)
    if (ok) setGraph((g) => edited({ ...g, edges: addEdge({ ...ok.c, type: 'belt', data: { medium: ok.medium } }, g.edges) }))
  }

  const drop = useDrop((p, position) => {
    const nid = `${p.kind}-${crypto.randomUUID().slice(0, 8)}`
    let data: MicroNode['data']
    if (p.kind === 'machine') {
      const b = buildingsById.get(p.building)
      data = { kind: 'machine', building: p.building, recipe: b?.generator ? '' : (unlocked.recipesIn(p.building)[0]?.id ?? ''), fuel: unlocked.fuelsOf(b)[0]?.fuel, clock: 1, count: 1, floor: 0 }
    } else if (p.kind === 'port') data = { kind: 'port', direction: p.direction as 'in' | 'out', transport: p.transport as PortData['transport'], perMin: 60, label: 'Added by hand' }
    else if (p.kind === 'pole') data = { kind: 'pole', floor: 0, tier: unlocked.poleTier }
    else data = { kind: p.kind as 'splitter' | 'merger' | 'junction', floor: 0 }
    setGraph((g) => edited({ ...g, nodes: [...g.nodes, place(g.nodes, { id: nid, type: p.kind, position, data })] }))
    setSel({ kind: 'node', id: nid })
  })

  const linkIds = new Set([...links.incoming, ...links.outgoing].map((l) => l.linkId))
  const portIds = new Set(graph?.nodes.flatMap((n) => (n.data.kind === 'port' && n.data.linkId ? [n.data.linkId] : [])))
  const stale = !!graph && ([...linkIds].some((x) => !portIds.has(x)) || [...portIds].some((x) => !linkIds.has(x)))

  const stats = useMemo(() => {
    let mw = 0
    let machines = 0
    const floors = new Set<number>()
    for (const n of graph?.nodes ?? []) {
      if (n.data.kind !== 'machine') continue
      const b = buildingsById.get(n.data.building)
      machines += n.data.count
      floors.add(n.data.floor)
      if (!b?.generator) mw += (b?.powerConsumptionMW ?? 0) * n.data.count * Math.pow(n.data.clock, b?.powerConsumptionExponent ?? 1.321928)
    }
    // What the grid has for this outpost: everything it makes, less what the grid's other outposts use.
    const powerIn = grid ? grid.made - (grid.used - solved.solution.power.consumedMW) : solved.solution.power.generatedMW
    return { mw, machines, floors: floors.size, powerIn: Math.max(0, powerIn) }
  }, [graph, grid, solved])

  if (!graph) return null
  const selNode = sel?.kind === 'node' ? graph.nodes.find((n) => n.id === sel.id) : undefined
  const selEdge = sel?.kind === 'edge' ? graph.edges.find((e) => e.id === sel.id) : undefined
  const patchNode = (data: MicroNode['data']) => setGraph((g) => edited({ ...g, nodes: g.nodes.map((n) => (n.id === selNode?.id ? { ...n, data } : n)) }))
  const removeSelected = () => {
    if (selNode) onNodesChange([{ type: 'remove', id: selNode.id }])
    if (selEdge) onEdgesChange([{ type: 'remove', id: selEdge.id }])
    setSel(null)
  }
  const short = stats.machines > 0 && stats.mw > stats.powerIn + 0.01

  return (
    <div className="ne-body">
      {/* Icons on the canvas and palette select or drag, so they are not catalog links. */}
      <NoIconLinks>
      <aside className="ne-palette">
        <h3>Machines</h3>
        {unlocked.machines.map((b) => (
          <PaletteItem key={b.id} payload={{ kind: 'machine', building: b.id }} icon={b.id} onAdd={drop.addAtCenter}>
            {b.name}
          </PaletteItem>
        ))}
        <h3>Power</h3>
        {unlocked.generators.map((b) => (
          <PaletteItem key={b.id} payload={{ kind: 'machine', building: b.id }} icon={b.id} onAdd={drop.addAtCenter}>
            {b.name}
          </PaletteItem>
        ))}
        <h3>Logistics</h3>
        <PaletteItem payload={{ kind: 'splitter' }} icon={<GameIcon id="Desc_ConveyorAttachmentSplitter_C" size={22} fallback={<SplitterSymbol />} />} onAdd={drop.addAtCenter}>
          Splitter
        </PaletteItem>
        <PaletteItem payload={{ kind: 'merger' }} icon={<GameIcon id="Desc_ConveyorAttachmentMerger_C" size={22} fallback={<MergerSymbol />} />} onAdd={drop.addAtCenter}>
          Merger
        </PaletteItem>
        <PaletteItem payload={{ kind: 'junction' }} icon={<GameIcon id="Desc_PipelineJunction_Cross_C" size={22} fallback={<JunctionSymbol />} />} onAdd={drop.addAtCenter}>
          Pipeline Junction
        </PaletteItem>
        <PaletteItem payload={{ kind: 'pole' }} icon={<GameIcon id={`Desc_PowerPoleMk${unlocked.poleTier}_C`} size={22} fallback={<PoleSymbol />} />} onAdd={drop.addAtCenter}>
          Power Pole Mk.{unlocked.poleTier}
        </PaletteItem>
        <h3>Ports</h3>
        {unlocked.transports.flatMap((t) =>
          (['in', 'out'] as const).map((dir) => (
            <PaletteItem key={t.id + dir} payload={{ kind: 'port', direction: dir, transport: t.id }} icon={t.icon} onAdd={drop.addAtCenter}>
              {t.label} {dir}
            </PaletteItem>
          )),
        )}
        <PaletteItem payload={{ kind: 'port', direction: 'in', transport: 'resource' }} icon="Desc_MinerMk1_C" onAdd={drop.addAtCenter}>
          Resource node
        </PaletteItem>
      </aside>
      <div className="ne-canvas" {...drop.canvas}>
        <div className="ne-plan-bar">
          <button type="button" onClick={() => regenerate()}>
            Propose layout
          </button>
          <label>
            Best belt
            <select
              value={maxBeltTier}
              onChange={(e) => {
                const tier = Number(e.target.value)
                if (graph.generatedAt) regenerate(tier)
                else setGraph((g) => ({ ...g, maxBeltTier: tier }))
              }}
            >
              {beltRates.slice(0, Math.max(unlocked.beltTier, maxBeltTier)).map((r, i) => (
                <option key={r} value={i + 1}>
                  Mk.{i + 1} ({r}/min)
                </option>
              ))}
            </select>
          </label>
          <span className="ne-stat">
            {stats.machines} machines · {stats.floors} floors · {fmt(stats.mw)} MW
            {stats.powerIn > 0 && <> of {fmt(stats.powerIn)} MW on {grid?.name ?? 'the grid'}</>}
          </span>
          <span className="ne-stat">{graph.generatedAt ? 'Proposed' : 'Edited'}</span>
        </div>
        {(stale || short || view.clashes.size > 0 || !!graph.notes?.length) && (
          <ul className="ne-notes">
            {stale && <li>Links on the factory map changed since this was proposed. Propose layout again to update the ports.</li>}
            {short && (
              <li>
                Machines draw {fmt(stats.mw)} MW but {grid?.name ?? 'the grid'} has {fmt(stats.powerIn)} MW for them. Run a power line to a
                power plant on the factory map, or add generators.
              </li>
            )}
            {view.clashes.size > 0 && (
              <li>
                {view.clashes.size} line{view.clashes.size === 1 ? '' : 's'} (dashed red) found no grid route of {view.clashes.size === 1 ? 'its' : 'their'} own and share grid space. Move blocks apart to make room.
              </li>
            )}
            {graph.notes?.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
        <FloorPlanContext.Provider value={view}>
        <RouteContext.Provider value={routes}>
        <ReactFlow
          {...flowProps}
          snapToGrid
          snapGrid={[G, G]}
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={microNodeTypes}
          edgeTypes={microEdgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          isValidConnection={(c) => !!check(c as Connection)}
          onPaneClick={() => setSel(null)}
          defaultEdgeOptions={{ type: 'belt' }}
        >
          <LineMarkers />
          <Background gap={G} />
          <Controls />
          <MiniMap pannable zoomable className="ne-minimap" />
        </ReactFlow>
        </RouteContext.Provider>
        </FloorPlanContext.Provider>
      </div>
      </NoIconLinks>
      <aside className="ne-inspector">
        {selNode?.data.kind === 'machine' ? (
          <MachineInspector data={selNode.data as MachineData} onChange={patchNode} onDelete={removeSelected} />
        ) : selNode?.data.kind === 'port' ? (
          <PortInspector data={selNode.data} onChange={patchNode} onDelete={removeSelected} />
        ) : selNode ? (
          <section>
            <h3>{jointInfo[selNode.data.kind]?.[0] ?? 'Block'}</h3>
            <p className="ne-help">{jointInfo[selNode.data.kind]?.[1]}</p>
            <div className="ne-actions">
              <button type="button" className="danger" onClick={removeSelected}>
                Delete
              </button>
            </div>
          </section>
        ) : selEdge ? (
          <BeltInspector
            data={selEdge.data ?? {}}
            load={view.loads.get(selEdge.id)}
            onChange={(data) => setGraph((g) => edited({ ...g, edges: g.edges.map((e) => (e.id === selEdge.id ? { ...e, data } : e)) }))}
            onDelete={removeSelected}
          />
        ) : (
          <section>
            <h3>{solved.plan.name}</h3>
            <p className="ne-help">
              {graph.generatedAt
                ? 'Proposed from the plan: one floor per production type with raw processing at the bottom, machines fed by splitter manifolds and collected by mergers, and a line split in two wherever one belt of your best tier can\'t carry it. Fluids run in pipes through pipeline junctions, and a power pole beside every machine is wired to the power ports. Belts and pipes run along the grid and never share a grid line.'
                : 'Edited floor plan. Propose layout replaces it with a fresh proposal from the plan.'}
            </p>
            <p className="ne-help">
              Move, add or remove anything; it changes this drawing, not the plan. To change what the outpost makes or
              imports, edit the plan or the factory map.
            </p>
            <p className="ne-help">
              Drag blocks in from the left, or click them. Drag from any free connection point to another of the same colour: orange for belts,
              blue for pipes, yellow for power. Each point takes one line, and belts and pipes always run from an output to an input.
            </p>
          </section>
        )}
      </aside>
    </div>
  )
}

/** What the inspector says about joints and poles. */
const jointInfo: Partial<Record<MicroNode['data']['kind'], [string, string]>> = {
  splitter: ['Splitter', 'One belt in at the back, up to three out: ahead, left and right. Its connection points turn to face the belts on their own.'],
  merger: ['Merger', 'Up to three belts in: back, left and right. One out ahead. Its connection points turn to face the belts on their own.'],
  junction: ['Pipeline Junction', 'Four pipe connections, each one in or out: it splits a pipe, joins pipes, or both. Fluids never go through splitters or mergers.'],
  pole: ['Power Pole', 'Takes as many power lines as the game allows for its Mk (4, 7 or 10), one per connection point; a Mk.3 shows eight here. Power lines run on the grid.'],
}

/**
 * Line routes on the grid, which way joints and ports face, what every line carries, and which
 * connection points are taken, for the whole floor plan.
 * Routes are worked out again whenever blocks or lines change, but not while a block is being dragged:
 * the lines of a dragged block follow it with a plain route until it is dropped.
 */
function useFloorPlanView(graph: MicroGraph | undefined, pipeTier: number): FloorPlanView {
  const dragKey = graph?.nodes.flatMap((n) => (n.dragging ? [n.id] : [])).join() ?? ''
  const key = graph
    ? JSON.stringify([
        graph.nodes.map((n) => [n.id, n.type, n.dragging ? 'drag' : [n.position.x, n.position.y], n.data.kind === 'machine' ? [n.data.recipe, n.data.fuel, n.data.building] : n.data.kind === 'port' ? [n.data.direction, n.data.transport, n.data.item] : n.data.kind === 'pole' ? n.data.tier : 0]),
        graph.edges.map((e) => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle]),
      ])
    : ''
  // Keyed on the shape of the plan, not on every drag frame.
  const routed = useMemo(() => (graph ? routeFloorPlan(graph.nodes, graph.edges) : undefined), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const nodes = graph?.nodes
  const edges = graph?.edges
  const beltTier = graph?.maxBeltTier ?? 6
  const pipes = graph?.maxPipeTier ?? pipeTier
  const loads = useMemo(() => {
    const out = new Map<string, LineLoad>()
    if (!nodes || !edges) return out
    for (const [id, f] of inferFlows(nodes, edges)) {
      const fluid = f.medium === 'fluid'
      const t = f.perMin !== undefined && f.medium !== 'power' ? beltTierFor(f.perMin, fluid ? pipes : beltTier, fluid) : undefined
      out.set(id, { ...f, tier: t?.tier, over: t?.over })
    }
    return out
  }, [nodes, edges, beltTier, pipes])
  const used = useMemo(() => new Set((edges ?? []).flatMap((e) => [`${e.source}:${e.sourceHandle}`, `${e.target}:${e.targetHandle}`])), [edges])
  return useMemo(
    () => ({
      routes: routed?.routes ?? new Map(),
      orients: routed?.orients ?? new Map(),
      clashes: new Set(routed?.clashes ?? []),
      dragging: new Set(dragKey ? dragKey.split(',') : []),
      loads,
      used,
    }),
    [routed, dragKey, loads, used],
  )
}
