import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { taxonomy, taxonomyOf } from '../data'
import { displayName, iconUrl } from '../data/icons'
import type { Purity, WorldNode } from '../data/game/types'
import { worldMap, worldMapBase, worldMapTiles } from '../data/game/worldMap'
import { autoName } from '../plan/naming'
import { removeOutposts } from '../plan/grids'
import { blankPlan, useOutposts } from '../plan/store'
import { useGridStore } from '../plan/useGrids'
import type { OutpostPlan, ResourceNode } from '../plan/types'
import { go } from '../router'
import { FOG_SIZE, type Point } from '../save/readMap'
import type { GameState } from '../state/gameState'
import { usePersistentState } from '../storage/persisted'
import { hide, useTip } from '../ui/tooltip'
import { COLLECTIBLES, CRASH_SITE, decodeFog, exploredBox, fogOpacity, markers, nearby, pickable, pickups, PURITIES, toUnit, toWorld, type Marker, type Pickup } from './model'
import { levelFor, overlaps, padded, parseKey, tileOf, tilesIn, type Box as TileBox, type Tile } from './tiles'
import './world.css'

// The map is laid out on a square "stage" of STAGE px and zoomed with a CSS transform;
// markers scale back by 1/zoom so they stay the same size on screen.
const STAGE = 1000
/** How far past the source picture's own pixels you can zoom. */
const MAX_OVERZOOM = 2

type View = { x: number; y: number; k: number }
type Box = { left: number; top: number; right: number; bottom: number }

type Filters = {
  /** Resources and collectibles (or "unknown", "unknown-pickup") the player switched off. */
  hidden: string[]
  hiddenPurities: Purity[]
  /** Hide collectibles already picked up (and crash sites already opened). */
  hideCollected: boolean
  outposts: boolean
  /** Spoilers: show nodes in unexplored areas too. */
  showAll: boolean
  /** Side panel open; unset means "open on wide screens". */
  panel?: boolean
}
const defaultFilters: Filters = { hidden: [], hiddenPurities: [], hideCollected: false, outposts: true, showAll: false }
const UNKNOWN = 'unknown'
const UNKNOWN_PICKUP = 'unknown-pickup'
const pickupName = (item: string) => (item === CRASH_SITE ? 'Crash site' : displayName(item))

// Legend groups: the in-game taxonomy's resource groups (ores, fluid resources), in its order,
// then geysers, which aren't items, and resources the player hasn't unlocked yet.
const GROUPS: { key: string; label: string; members?: string[] }[] = [
  ...taxonomy.items.find((c) => c.id === 'resources')!.groups.map((g) => ({ key: g.id, label: g.name, members: g.members })),
  { key: 'geyser', label: 'Geysers' },
  { key: UNKNOWN, label: 'Not unlocked yet' },
]
const groupOf = (resource: string | null) =>
  resource === null ? UNKNOWN : resource === 'Desc_Geyser_C' ? 'geyser' : (taxonomyOf.get(resource)?.group.id ?? 'ores')

export default function WorldScreen({ state, outpostId }: { state: GameState; outpostId?: string }) {
  const [filters, setFilters] = usePersistentState<Filters>('worldMapFilters', defaultFilters)
  const f = { ...defaultFilters, ...filters }
  // On phones the legend sits below the map, where the page scrolls to it, so it can't be closed.
  const narrow = window.innerWidth < 800
  const panelOpen = narrow || (f.panel ?? true)
  const { outposts, save: saveOutpost, update: updateOutpost, remove: removeOutpost } = useOutposts()
  const gridStore = useGridStore()
  const active = outposts.find((o) => o.id === outpostId)
  // Placing: the next click on the map creates an outpost there ('new') or moves the selected one.
  // Every outpost belongs somewhere on the map, so one that isn't on it yet asks to be placed.
  // Unset means the default for the selected outpost; it resets when the selection changes.
  const [chosenPlacing, setPlacing] = useState<'new' | 'move' | null | undefined>(undefined)
  const [placingFor, setPlacingFor] = useState(outpostId)
  if (placingFor !== outpostId) {
    setPlacingFor(outpostId)
    setPlacing(undefined)
  }
  const placing = chosenPlacing !== undefined ? chosenPlacing : outpostId === 'new' ? 'new' : active && !active.location ? 'move' : null

  const save = state.map
  const fog = useMemo(() => (save ? decodeFog(save.fog) : null), [save])
  const all = useMemo(() => markers(worldMap, state, f.showAll), [state, f.showAll])
  const visible = (m: Marker) => !f.hidden.includes(m.resource ?? UNKNOWN) && !f.hiddenPurities.includes(m.node.purity)
  const cores = all.filter((m) => m.node.kind === 'wellCore' && !f.hidden.includes(m.resource ?? UNKNOWN))
  const shown = all.filter((m) => m.node.kind !== 'wellCore' && visible(m))
  const allPickups = useMemo(() => pickups(worldMap, state, f.showAll), [state, f.showAll])
  const shownPickups = allPickups.filter((p) => !f.hidden.includes(p.item ?? UNKNOWN_PICKUP) && !(f.hideCollected && p.collected))

  // Which outpost uses each node picked on the map.
  const usedBy = new Map<string, OutpostPlan>()
  for (const o of outposts) for (const n of o.nodes) if (n.fromMap) usedBy.set(n.id, o)

  const asNode = (node: WorldNode): ResourceNode => ({ id: node.id, resource: node.resource, purity: node.purity, fromMap: true })

  const toggleNode = (node: WorldNode) => {
    if (!active) return
    // A node belongs to one outpost at most.
    const owner = usedBy.get(node.id)
    if (owner && owner.id !== active.id) return
    const has = active.nodes.some((n) => n.id === node.id)
    updateOutpost(active.id, { nodes: has ? active.nodes.filter((n) => n.id !== node.id) : [...active.nodes, asNode(node)] })
  }

  /** Unclaimed nodes within reach of a spot, for an outpost placed there. */
  const nodesNear = (p: Point, self?: string) =>
    nearby(all, p)
      .filter((m) => {
        const owner = usedBy.get(m.node.id)
        return !owner || owner.id === self
      })
      .map((m) => asNode(m.node))

  const place = (p: Point) => {
    const location = { x: Math.round(p[0]), y: Math.round(p[1]) }
    if (placing === 'move' && active) {
      // The map-picked nodes follow the outpost to its new spot; nodes added by hand stay.
      const nodes = [...active.nodes.filter((n) => !n.fromMap), ...nodesNear(p, active.id)]
      updateOutpost(active.id, { location, nodes })
    } else {
      const nodes = nodesNear(p)
      const plan = blankPlan(autoName({ goals: [], nodes }, `Outpost ${outposts.length + 1}`), { location, nodes })
      saveOutpost(plan)
      go(`/world/${plan.id}`)
    }
    setPlacing(null)
  }

  // Counts for the legend, before filtering.
  const byResource = new Map<string, number>()
  const byPurity = new Map<Purity, number>()
  for (const m of all) {
    if (m.node.kind === 'wellCore') continue
    byResource.set(m.resource ?? UNKNOWN, (byResource.get(m.resource ?? UNKNOWN) ?? 0) + 1)
    byPurity.set(m.node.purity, (byPurity.get(m.node.purity) ?? 0) + 1)
  }
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])
  const setPanel = (panel: boolean) => setFilters({ ...f, panel })

  const removeActive = () => {
    if (!active || !confirm(`Delete "${active.name}"? Outposts importing from it lose those imports.`)) return
    removeOutpost(active.id)
    gridStore.update((s) => removeOutposts(s, [active.id]))
    go('/world')
  }

  const player = save?.players[0] ? toUnit(worldMap, save.players[0]) : null
  const focus = active?.location ? toUnit(worldMap, [active.location.x, active.location.y]) : null

  return (
    <div className={`wm-screen${panelOpen ? ' panel-open' : ''}`}>
      <aside className="wm-panel" aria-label="Map legend and outposts" hidden={!panelOpen}>
        <div className="wm-panel-head">
          <strong>World map</strong>
          {!narrow && (
            <button type="button" className="icon-btn" aria-label="Close the legend" onClick={() => setPanel(false)}>
              ×
            </button>
          )}
        </div>

        <section className="wm-section">
          <h4>Outposts</h4>
          <select
            value={active?.id ?? ''}
            onChange={(e) => (setPlacing(null), go(e.target.value ? `/world/${e.target.value}` : '/world'))}
            aria-label="Outpost to edit on the map"
          >
            <option value="">No outpost selected</option>
            {outposts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.location ? '' : ' (not on the map)'}
              </option>
            ))}
          </select>
          {active && <OutpostNodes plan={active} onRemove={(id) => updateOutpost(active.id, { nodes: active.nodes.filter((n) => n.id !== id) })} />}
        </section>

        {GROUPS.map((g) => {
          const ids = [...byResource.keys()].filter((id) => groupOf(id === UNKNOWN ? null : id) === g.key)
          if (ids.length === 0) return null
          const order = (id: string) => g.members?.indexOf(id) ?? -1
          ids.sort((a, b) => order(a) - order(b) || displayName(a).localeCompare(displayName(b)))
          return (
            <section key={g.key} className="wm-section">
              <h4>{g.label}</h4>
              {ids.map((id) => (
                <LegendRow
                  key={id}
                  on={!f.hidden.includes(id)}
                  onToggle={() => setFilters({ ...f, hidden: toggle(f.hidden, id) })}
                  icon={id === UNKNOWN ? <span className="wm-unknown small">?</span> : <img src={iconUrl(id)} alt="" width={22} height={22} />}
                  label={id === UNKNOWN ? 'Unknown resource' : displayName(id)}
                  count={byResource.get(id)}
                />
              ))}
            </section>
          )
        })}

        {allPickups.length > 0 && (
          <section className="wm-section">
            <h4>Collectibles</h4>
            {[...COLLECTIBLES, UNKNOWN_PICKUP].map((id) => {
              const list = allPickups.filter((p) => (p.item ?? UNKNOWN_PICKUP) === id)
              if (list.length === 0) return null
              const left = list.filter((p) => !p.collected).length
              return (
                <LegendRow
                  key={id}
                  on={!f.hidden.includes(id)}
                  onToggle={() => setFilters({ ...f, hidden: toggle(f.hidden, id) })}
                  icon={id === UNKNOWN_PICKUP ? <span className="wm-unknown small">?</span> : <img src={iconUrl(id)} alt="" width={22} height={22} />}
                  label={id === UNKNOWN_PICKUP ? 'Not found yet' : id === CRASH_SITE ? 'Crash sites' : displayName(id)}
                  count={left === list.length ? left : `${left}/${list.length}`}
                  title={`${left} of ${list.length} ${id === CRASH_SITE ? 'not opened yet' : 'not collected yet'}`}
                />
              )
            })}
            <label className="wm-check" title="Collected pickups and opened crash sites come from your save">
              <input type="checkbox" checked={f.hideCollected} onChange={(e) => setFilters({ ...f, hideCollected: e.target.checked })} />
              Hide collected
            </label>
          </section>
        )}

        <section className="wm-section">
          <h4>Purity</h4>
          {PURITIES.map((p) => (
            <LegendRow
              key={p}
              on={!f.hiddenPurities.includes(p)}
              onToggle={() => setFilters({ ...f, hiddenPurities: toggle(f.hiddenPurities, p) })}
              icon={<span className={`wm-dot ${p}`} />}
              label={purityName(p)}
              count={byPurity.get(p) ?? 0}
            />
          ))}
        </section>

        <section className="wm-section">
          <h4>On the map</h4>
          <LegendRow
            on={f.outposts}
            onToggle={() => setFilters({ ...f, outposts: !f.outposts })}
            icon={<span className="wm-outpost-dot" />}
            label="Outposts"
            count={outposts.filter((o) => o.location).length}
          />
          <label className="wm-check" title="Shows nodes in places you haven't been yet">
            <input type="checkbox" checked={f.showAll} onChange={(e) => setFilters({ ...f, showAll: e.target.checked })} />
            Show unexplored (spoilers)
          </label>
        </section>
      </aside>

      <div className="wm-main">
        {!save && (
          <p className="notice wm-notice">
            The map shows what you've explored, which comes from your save. <a href="#/upload">Upload a save</a> to see it.
          </p>
        )}
        <MapView
          fog={f.showAll ? null : fog}
          hasSave={Boolean(save)}
          placing={placing !== null}
          onPlace={place}
          focus={focus}
          player={player}
          controls={
            <button type="button" className={`small${placing === 'new' ? '' : ' secondary'}`} aria-pressed={placing === 'new'} onClick={() => setPlacing(placing === 'new' ? null : 'new')}>
              New outpost
            </button>
          }
          overlay={
            placing ? (
              <>
                <span className="wm-overlay-text">
                  Click the map where {placing === 'move' && active ? <strong>{active.name}</strong> : 'the new outpost'} goes. Nodes within 100 m are given to it.
                </span>
                <button type="button" className="secondary small" onClick={() => setPlacing(null)}>
                  Cancel
                </button>
              </>
            ) : (
              active && (
                <>
                  <strong className="wm-overlay-text">{active.name}</strong>
                  <button type="button" className="secondary small" onClick={() => setPlacing('move')}>
                    {active.location ? 'Move' : 'Put on the map'}
                  </button>
                  <a className="button small" href={openHref(active)}>
                    Open
                  </a>
                  <button type="button" className="danger small" onClick={removeActive}>
                    Delete
                  </button>
                </>
              )
            )
          }
          menu={
            !panelOpen && (
              <button type="button" className="wm-menu secondary small" aria-label="Open the legend" onClick={() => setPanel(true)}>
                ☰ Legend
              </button>
            )
          }
        >
          {cores.map((m) => (
            <NodeMarker key={m.node.id} marker={m} />
          ))}
          {shown.map((m) => {
            const owner = usedBy.get(m.node.id)
            const other = owner && owner.id !== active?.id ? owner : undefined
            return (
              <NodeMarker
                key={m.node.id}
                marker={m}
                picked={Boolean(active && owner?.id === active.id)}
                usedBy={other?.name}
                // A node another outpost has can't be taken; clicking it selects that outpost instead.
                onPick={placing ? undefined : other ? () => go(`/world/${other.id}`) : active && pickable(m) ? () => toggleNode(m.node) : undefined}
                hint={active && !pickable(m) && m.node.kind === 'node' ? 'unlock it to plan with it' : other ? 'click to select it' : undefined}
              />
            )
          })}
          {shownPickups.map((p) => (
            <PickupMarker key={p.collectible.id} pickup={p} />
          ))}
          {save?.hub && <Landmark at={save.hub} label="The HUB" icon="Desc_TradingPost_C" className="hub" />}
          {save?.players.map((p) => <Landmark key={p.join()} at={p} label="You (when the game was saved)" className="player" />)}
          {f.outposts &&
            outposts
              .filter((o) => o.location)
              .map((o) => (
                <OutpostMarker key={o.id} plan={o} active={o.id === active?.id} onSelect={() => (setPlacing(null), go(`/world/${o.id}`))} />
              ))}
        </MapView>
      </div>
    </div>
  )
}

/** Where opening an outpost lands: its plan, or its goal while it has none. */
const openHref = (plan: OutpostPlan) => `#/outposts/${plan.id}/${plan.goals.length ? 'plan' : 'goal'}`

const purityName = (p: Purity) => p[0].toUpperCase() + p.slice(1)

function LegendRow({ on, onToggle, icon, label, count, title }: { on: boolean; onToggle: () => void; icon: ReactNode; label: string; count?: ReactNode; title?: string }) {
  return (
    <button type="button" className={`wm-row${on ? '' : ' off'}`} aria-pressed={on} onClick={onToggle} title={title}>
      <span className="wm-row-icon">{icon}</span>
      <span className="wm-row-label">{label}</span>
      {count !== undefined && <span className="wm-count">{count}</span>}
    </button>
  )
}

/** The selected outpost's nodes, with the ones picked on the map first. */
function OutpostNodes({ plan, onRemove }: { plan: OutpostPlan; onRemove: (id: string) => void }) {
  const fromMap = plan.nodes.filter((n) => n.fromMap)
  const manual = plan.nodes.length - fromMap.length
  return (
    <div className="wm-outpost">
      <p className="muted small">
        Click a node on the map to add it to <strong>{plan.name}</strong>, or click it again to take it out.
      </p>
      {fromMap.length > 0 && (
        <ul className="plain wm-outpost-nodes">
          {fromMap.map((n) => (
            <li key={n.id}>
              <img src={iconUrl(n.resource)} alt="" width={20} height={20} />
              <span className={`wm-dot ${n.purity}`} />
              <span>
                {purityName(n.purity)} {displayName(n.resource)}
              </span>
              <button type="button" className="icon-btn" aria-label={`Remove ${displayName(n.resource)} node`} onClick={() => onRemove(n.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {manual > 0 && (
        <p className="muted small">
          Plus {manual} node{manual === 1 ? '' : 's'} added by hand.
        </p>
      )}
    </div>
  )
}

function NodeMarker({
  marker: { node, resource, inUse },
  picked = false,
  usedBy,
  onPick,
  hint,
}: {
  marker: Marker
  picked?: boolean
  usedBy?: string
  onPick?: () => void
  hint?: string
}) {
  const what = resource ? displayName(resource) : 'Unknown resource'
  const label = [
    node.kind === 'wellCore'
      ? `Resource well: ${what}`
      : `${purityName(node.purity)} ${what}${node.kind === 'wellSatellite' ? ' (resource well)' : node.kind === 'geyser' ? '' : ' node'}`,
    inUse && 'in use',
    picked && 'in this outpost',
    usedBy && `planned for ${usedBy}`,
    hint,
  ]
    .filter(Boolean)
    .join(' · ')
  const tip = useTip(label, { tapShows: !onPick })
  const [u, v] = toUnit(worldMap, [node.x, node.y])
  const kindClass = node.kind === 'wellCore' ? 'core' : node.kind === 'wellSatellite' ? 'satellite' : ''
  const className = [
    'wm-marker wm-node',
    node.kind === 'wellCore' ? '' : node.purity,
    kindClass,
    inUse && 'in-use',
    picked && 'picked',
    usedBy && 'used',
    onPick && 'pickable',
  ]
    .filter(Boolean)
    .join(' ')
  const style = { left: `${u * 100}%`, top: `${v * 100}%` }
  const content = resource ? <img src={iconUrl(resource)} alt="" draggable={false} /> : <span className="wm-unknown">?</span>
  if (onPick)
    return (
      <button type="button" className={className} style={style} aria-label={label} aria-pressed={picked} onClick={onPick} {...tip}>
        {content}
      </button>
    )
  return (
    <span className={className} style={style} role="img" aria-label={label} tabIndex={0} {...tip}>
      {content}
    </span>
  )
}

function PickupMarker({ pickup }: { pickup: Pickup }) {
  const { collectible, item, collected } = pickup
  const crash = collectible.item === CRASH_SITE
  const label = item === null ? 'Something to pick up (you haven\'t found one yet)' : `${pickupName(item)}${collected ? (crash ? ' (opened)' : ' (collected)') : ''}`
  const tip = useTip(label, { tapShows: true })
  const [u, v] = toUnit(worldMap, [collectible.x, collectible.y])
  return (
    <span
      className={`wm-marker wm-pickup${crash ? ' crash' : ''}${collected ? ' collected' : ''}`}
      style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
      role="img"
      aria-label={label}
      tabIndex={0}
      {...tip}
    >
      {item === null ? <span className="wm-unknown">?</span> : <img src={iconUrl(item)} alt="" draggable={false} />}
    </span>
  )
}

function Landmark({ at, label, icon, className }: { at: Point; label: string; icon?: string; className: string }) {
  const tip = useTip(label, { tapShows: true })
  const [u, v] = toUnit(worldMap, at)
  return (
    <span
      className={`wm-marker wm-landmark ${className}`}
      style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
      role="img"
      aria-label={label}
      tabIndex={0}
      {...tip}
    >
      {icon && <img src={iconUrl(icon)} alt="" draggable={false} />}
    </span>
  )
}

function OutpostMarker({ plan, active, onSelect }: { plan: OutpostPlan; active: boolean; onSelect: () => void }) {
  const [u, v] = toUnit(worldMap, [plan.location!.x, plan.location!.y])
  return (
    <button
      type="button"
      className={`wm-marker wm-outpost-marker${active ? ' active' : ''}`}
      style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
      onClick={onSelect}
      aria-label={`Outpost ${plan.name}${active ? ' (selected)' : ''}`}
    >
      <span className="wm-pin" />
      <span className="wm-outpost-name">{plan.name}</span>
    </button>
  )
}

/** Tiles loading at once; the rest wait in a queue, nearest to the view first. */
const PARALLEL = 4

/** Map tiles around the view, loaded nearest first as it pans and zooms. */
function useTiles() {
  // Tiles drawn are the loaded ones at or below the view's level, around the view.
  const [area, setArea] = useState<{ level: number; box: TileBox }>({ level: 0, box: { left: 0, top: 0, right: 0, bottom: 0 } })
  const areaId = useRef('')
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set())
  const loader = useRef({ queue: [] as Tile[], busy: new Set<string>(), done: new Set<string>() })

  const pump = () => {
    const l = loader.current
    while (l.busy.size < PARALLEL && l.queue.length) {
      const t = l.queue.shift()!
      if (l.done.has(t.key) || l.busy.has(t.key)) continue
      l.busy.add(t.key)
      const img = new Image()
      img.onload = () => {
        l.busy.delete(t.key)
        l.done.add(t.key)
        setLoaded(new Set(l.done))
        pump()
      }
      img.onerror = () => {
        l.busy.delete(t.key)
        pump()
      }
      img.src = worldMapTiles.url(t.level, t.row, t.col)
    }
  }

  /** Called on every view change with the unit box on screen and how wide the map is drawn, in device px. */
  const update = (view: TileBox, px: number) => {
    const level = levelFor(px)
    const box = padded(view, level)
    const wanted = tilesIn(level, box, [(view.left + view.right) / 2, (view.top + view.bottom) / 2])
    const id = `${level}:${wanted.map((t) => t.key).join(',')}`
    if (id === areaId.current) return
    areaId.current = id
    setArea({ level, box })
    // Whatever hasn't started yet gives way to what's around the new view.
    loader.current.queue = wanted.filter((t) => !loader.current.done.has(t.key))
    pump()
  }

  const shown = [...loaded]
    .map(parseKey)
    .filter(([level]) => level <= area.level)
    .sort((a, b) => a[0] - b[0])
    .map(([level, row, col]) => tileOf(level, row, col))
    .filter((t) => overlaps(t.box, area.box))
  return { shown, update }
}

/** Pan and zoom (drag, wheel, pinch, buttons) over the map picture with the fog drawn on top. */
function MapView({
  fog,
  hasSave,
  placing,
  onPlace,
  focus,
  player,
  menu,
  controls,
  overlay,
  children,
}: {
  fog: Uint8Array | null
  hasSave: boolean
  placing: boolean
  onPlace: (p: Point) => void
  /** Unit point to center on at first, e.g. the selected outpost. */
  focus: Point | null
  /** The player's unit point: where the map opens when nothing else is selected. */
  player: Point | null
  menu: ReactNode
  /** More buttons with the zoom controls. */
  controls?: ReactNode
  /** Shown along the bottom of the map, e.g. the selected outpost's actions. */
  overlay?: ReactNode
  children: ReactNode
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>({ x: 0, y: 0, k: 1 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const tiles = useTiles()
  // On a page that scrolls (phones), one finger scrolls the page and two fingers move the map.
  const [cooperative, setCooperative] = useState(false)
  const [hint, setHint] = useState(false)

  const fitZoom = () => Math.min(size.w, size.h) / STAGE
  const sourceSize = worldMapTiles.sizes[worldMapTiles.sizes.length - 1]
  /** Zoom where one pixel of the map picture is one pixel on screen. */
  const nativeZoom = () => sourceSize / STAGE
  const maxZoom = () => nativeZoom() * MAX_OVERZOOM

  const apply = () => {
    const { x, y, k } = view.current
    if (!stage.current) return
    stage.current.style.transform = `translate(${x}px, ${y}px) scale(${k})`
    stage.current.style.setProperty('--k', String(k))
    // Markers shrink when the whole map is in view, so crowded areas stay readable.
    stage.current.style.setProperty('--s', String(Math.min(1, Math.max(0.6, k / (fitZoom() * 3)))))
    const span = STAGE * k
    tiles.update({ left: -x / span, top: -y / span, right: (size.w - x) / span, bottom: (size.h - y) / span }, span * window.devicePixelRatio)
  }

  // Keep at least part of the map on screen.
  const clamp = (v: View): View => {
    const k = Math.min(Math.max(v.k, fitZoom() * 0.8), maxZoom())
    const span = STAGE * k
    const margin = 80
    return {
      k,
      x: Math.min(Math.max(v.x, margin - span), size.w - margin),
      y: Math.min(Math.max(v.y, margin - span), size.h - margin),
    }
  }

  const set = (v: View) => {
    view.current = clamp(v)
    apply()
  }

  /** Zoom by `factor` keeping the screen point (px, py) still. */
  const zoomAt = (factor: number, px: number, py: number) => {
    const { x, y, k } = view.current
    const nk = Math.min(Math.max(k * factor, fitZoom() * 0.8), maxZoom())
    set({ k: nk, x: px - ((px - x) * nk) / k, y: py - ((py - y) * nk) / k })
  }

  /** Show the unit-coordinate box, centered. */
  const fit = (box: Box) => {
    const pad = 0.15
    const w = (box.right - box.left) * (1 + pad * 2)
    const h = (box.bottom - box.top) * (1 + pad * 2)
    const k = Math.min(size.w / (w * STAGE), size.h / (h * STAGE))
    const cx = ((box.left + box.right) / 2) * STAGE
    const cy = ((box.top + box.bottom) / 2) * STAGE
    set({ k, x: size.w / 2 - cx * k, y: size.h / 2 - cy * k })
  }
  /** Center on a unit point at full detail. */
  const centerOn = (p: Point) => {
    const k = nativeZoom()
    set({ k, x: size.w / 2 - p[0] * STAGE * k, y: size.h / 2 - p[1] * STAGE * k })
  }
  const fitAll = () => fit({ left: 0, top: 0, right: 1, bottom: 1 })
  const fitExplored = () => {
    const box = fog && exploredBox(fog)
    if (box) fit(box)
    else fitAll()
  }

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const measure = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
      let scroller = el.parentElement
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
      setCooperative(Boolean(scroller && scroller.scrollHeight > scroller.clientHeight + 1))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // First layout: the selected outpost, else the player at full detail, else what's been explored.
  const placed = useRef(false)
  useLayoutEffect(() => {
    if (!size.w || !size.h) return
    if (!placed.current) {
      placed.current = true
      if (focus) centerOn(focus)
      else if (player) centerOn(player)
      else fitExplored()
    } else set(view.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])

  // Draw the fog: dark where unexplored, fading out where the pioneer has been.
  useEffect(() => {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.clearRect(0, 0, FOG_SIZE, FOG_SIZE)
    if (!fog && !hasSave) {
      ctx.fillStyle = 'rgba(12, 14, 18, 0.88)'
      ctx.fillRect(0, 0, FOG_SIZE, FOG_SIZE)
      return
    }
    if (!fog) return
    const img = ctx.createImageData(FOG_SIZE, FOG_SIZE)
    for (let i = 0; i < fog.length; i++) {
      img.data[i * 4] = 12
      img.data[i * 4 + 1] = 14
      img.data[i * 4 + 2] = 18
      img.data[i * 4 + 3] = Math.round(fogOpacity(fog[i]) * 225)
    }
    ctx.putImageData(img, 0, 0)
  }, [fog, hasSave])

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      hide()
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  // Drag to pan, two fingers to pinch. Capture the pointer only once it moves, so a tap
  // still reaches the marker under it.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ moved: boolean; dist: number }>({ moved: false, dist: 0 })
  const local = (e: { clientX: number; clientY: number }) => {
    const r = viewport.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  // Touch on a scrolling page is handled by the touch listeners below instead.
  const ours = (e: ReactPointerEvent) => !(cooperative && e.pointerType === 'touch')
  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || !ours(e)) return
    pointers.current.set(e.pointerId, local(e))
    gesture.current = { moved: pointers.current.size > 1, dist: pinchDistance() }
  }
  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  /** Pan by the midpoint's move and zoom by the fingers' spread, around the midpoint. */
  const pinch = (a: { x: number; y: number }, b: { x: number; y: number }, prevMid: { x: number; y: number }, prevDist: number) => {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    set({ ...view.current, x: view.current.x + mid.x - prevMid.x, y: view.current.y + mid.y - prevMid.y })
    if (prevDist > 0) zoomAt(dist / prevDist, mid.x, mid.y)
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const p = local(e)
    if (!gesture.current.moved && Math.hypot(p.x - prev.x, p.y - prev.y) < 4) return
    if (!gesture.current.moved) {
      gesture.current.moved = true
      viewport.current?.setPointerCapture(e.pointerId)
      hide()
    }
    if (pointers.current.size === 1) {
      pointers.current.set(e.pointerId, p)
      set({ ...view.current, x: view.current.x + p.x - prev.x, y: view.current.y + p.y - prev.y })
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const before = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const dist = pinchDistance()
      pointers.current.set(e.pointerId, p)
      const [a2, b2] = [...pointers.current.values()]
      pinch(a2, b2, before, dist)
    }
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId)
    gesture.current.dist = pinchDistance()
  }

  // Cooperative touch: two fingers pan and pinch the map; one finger is left to scroll the page.
  useEffect(() => {
    const el = viewport.current
    if (!el || !cooperative) return
    let last: { mid: { x: number; y: number }; dist: number } | null = null
    let hintTimer = 0
    const two = (e: TouchEvent) => {
      const [a, b] = [local(e.touches[0]), local(e.touches[1])]
      return { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) }
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 1) gesture.current.moved = false
      if (e.touches.length >= 2) {
        gesture.current.moved = true
        hide()
        setHint(false)
        const t = two(e)
        last = { mid: t.mid, dist: t.dist }
      }
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 && last) {
        if (e.cancelable) e.preventDefault()
        const t = two(e)
        pinch(t.a, t.b, last.mid, last.dist)
        last = { mid: t.mid, dist: t.dist }
      } else if (e.touches.length === 1 && !last) {
        setHint(true)
        clearTimeout(hintTimer)
        hintTimer = window.setTimeout(() => setHint(false), 1500)
      }
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) last = null
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      clearTimeout(hintTimer)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  })

  // A click (not the end of a drag) on the map itself, while placing an outpost.
  const onClick = (e: ReactMouseEvent) => {
    if (!placing || gesture.current.moved || (e.target as Element).closest('.wm-marker, .wm-controls, .wm-menu, .wm-overlay')) return
    const p = local(e)
    const { x, y, k } = view.current
    onPlace(toWorld(worldMap, [(p.x - x) / k / STAGE, (p.y - y) / k / STAGE]))
  }

  const zoomButton = (factor: number) => zoomAt(factor, size.w / 2, size.h / 2)

  return (
    <div
      className={`wm-viewport${placing ? ' placing' : ''}${cooperative ? ' cooperative' : ''}`}
      ref={viewport}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
    >
      <div className="wm-stage" ref={stage} style={{ width: STAGE, height: STAGE }}>
        <img className="wm-image" src={worldMapBase.url} alt="Map of the world" draggable={false} />
        {tiles.shown.map(({ key, level, row, col, box }) => (
          <img
            key={key}
            className="wm-tile"
            src={worldMapTiles.url(level, row, col)}
            alt=""
            draggable={false}
            decoding="async"
            style={{ left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${(box.right - box.left) * 100}%`, height: `${(box.bottom - box.top) * 100}%` }}
          />
        ))}
        <canvas className="wm-fog" ref={canvas} width={FOG_SIZE} height={FOG_SIZE} />
        {children}
      </div>
      {menu}
      <div className="wm-controls">
        <button type="button" className="secondary small" onClick={() => zoomButton(1.5)} aria-label="Zoom in">
          +
        </button>
        <button type="button" className="secondary small" onClick={() => zoomButton(1 / 1.5)} aria-label="Zoom out">
          −
        </button>
        {player && (
          <button type="button" className="secondary small" onClick={() => centerOn(player)} title="Where you were when the game was saved">
            You
          </button>
        )}
        {fog && (
          <button type="button" className="secondary small" onClick={fitExplored}>
            Explored
          </button>
        )}
        <button type="button" className="secondary small" onClick={fitAll}>
          Whole map
        </button>
        {controls}
      </div>
      {hint && <p className="wm-hint">Use two fingers to move the map</p>}
      {overlay && <div className="wm-overlay">{overlay}</div>}
      <p className="wm-credit">
        Map: <a href="https://satisfactory.wiki.gg/wiki/Map" target="_blank" rel="noreferrer">Official Satisfactory Wiki</a>
      </p>
    </div>
  )
}
