import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { resourcesById } from '../data'
import { displayName, iconUrl } from '../data/icons'
import type { Purity, WorldNode } from '../data/game/types'
import { worldMap, worldMapOverview, worldMapTiles } from '../data/game/worldMap'
import { blankPlan, useOutposts } from '../plan/store'
import type { OutpostPlan } from '../plan/types'
import { go } from '../router'
import { FOG_SIZE, type Point } from '../save/readMap'
import type { GameState } from '../state/gameState'
import { usePersistentState } from '../storage/persisted'
import { hide, useTip } from '../ui/tooltip'
import { decodeFog, exploredBox, fogAt, fogOpacity, FOG_REVEALED, markers, PURITIES, toUnit, toWorld, type Marker } from './model'
import './world.css'

// The map is laid out on a square "stage" of STAGE px and zoomed with a CSS transform;
// markers scale back by 1/zoom so they stay the same size on screen.
const STAGE = 1000
/** How far past the source picture's own pixels you can zoom. */
const MAX_OVERZOOM = 2

type View = { x: number; y: number; k: number }
type Box = { left: number; top: number; right: number; bottom: number }

type Filters = {
  /** Resources (or "unknown") the player switched off. */
  hidden: string[]
  hiddenPurities: Purity[]
  crashSites: boolean
  outposts: boolean
  /** Spoilers: show nodes in unexplored areas too. */
  showAll: boolean
  /** Side panel open; unset means "open on wide screens". */
  panel?: boolean
}
const defaultFilters: Filters = { hidden: [], hiddenPurities: [], crashSites: true, outposts: true, showAll: false }
const UNKNOWN = 'unknown'

// Legend groups, in the order the game's resource list uses.
const GROUPS = [
  { key: 'solid', label: 'Ores' },
  { key: 'liquid', label: 'Fluids' },
  { key: 'gas', label: 'Gases' },
  { key: 'geyser', label: 'Geysers' },
  { key: UNKNOWN, label: 'Not unlocked yet' },
] as const
const groupOf = (resource: string | null) =>
  resource === null ? UNKNOWN : resource === 'Desc_Geyser_C' ? 'geyser' : (resourcesById.get(resource)?.form ?? 'solid')

/** Only plain nodes can be given to an outpost: wells and geysers need buildings the planner doesn't place. */
const pickable = (m: Marker) => m.node.kind === 'node' && m.resource !== null

export default function WorldScreen({ state, outpostId }: { state: GameState; outpostId?: string }) {
  const [filters, setFilters] = usePersistentState<Filters>('worldMapFilters', defaultFilters)
  const f = { ...defaultFilters, ...filters }
  const panelOpen = f.panel ?? window.innerWidth >= 800
  const { outposts, save: saveOutpost, update: updateOutpost } = useOutposts()
  const active = outposts.find((o) => o.id === outpostId)
  // Placing: the next click on the map creates an outpost there ('new') or moves the selected one.
  const [placing, setPlacing] = useState<'new' | 'move' | null>(null)

  const save = state.map
  const fog = useMemo(() => (save ? decodeFog(save.fog) : null), [save])
  const all = useMemo(() => markers(worldMap, state, f.showAll), [state, f.showAll])
  const visible = (m: Marker) => !f.hidden.includes(m.resource ?? UNKNOWN) && !f.hiddenPurities.includes(m.node.purity)
  const cores = all.filter((m) => m.node.kind === 'wellCore' && !f.hidden.includes(m.resource ?? UNKNOWN))
  const shown = all.filter((m) => m.node.kind !== 'wellCore' && visible(m))
  const revealed = (p: Point) => f.showAll || (fog !== null && fogAt(worldMap, fog, p) >= FOG_REVEALED)
  const crashSites = f.crashSites ? (save?.crashSites ?? []).filter(revealed) : []

  // Which outpost uses each node picked on the map.
  const usedBy = new Map<string, OutpostPlan>()
  for (const o of outposts) for (const n of o.nodes) if (n.fromMap) usedBy.set(n.id, o)

  const toggleNode = (node: WorldNode) => {
    if (!active) return
    const has = active.nodes.some((n) => n.id === node.id)
    updateOutpost(active.id, {
      nodes: has
        ? active.nodes.filter((n) => n.id !== node.id)
        : [...active.nodes, { id: node.id, resource: node.resource, purity: node.purity, fromMap: true }],
    })
  }

  const place = (p: Point) => {
    const location = { x: Math.round(p[0]), y: Math.round(p[1]) }
    if (placing === 'move' && active) updateOutpost(active.id, { location })
    else {
      const plan = blankPlan(`Outpost ${outposts.length + 1}`, { location })
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

  const focus = active?.location ? toUnit(worldMap, [active.location.x, active.location.y]) : null

  return (
    <div className={`wm-screen${panelOpen ? ' panel-open' : ''}`}>
      <aside className="wm-panel" aria-label="Map legend and outposts" hidden={!panelOpen}>
        <div className="wm-panel-head">
          <strong>World map</strong>
          <button type="button" className="icon-btn" aria-label="Close the legend" onClick={() => setPanel(false)}>
            ×
          </button>
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
          <div className="row">
            <button type="button" className={`small${placing === 'new' ? '' : ' secondary'}`} onClick={() => setPlacing(placing === 'new' ? null : 'new')}>
              New outpost on the map
            </button>
            {active && (
              <button type="button" className={`small${placing === 'move' ? '' : ' secondary'}`} onClick={() => setPlacing(placing === 'move' ? null : 'move')}>
                {active.location ? 'Move it' : 'Put it on the map'}
              </button>
            )}
          </div>
          {placing && <p className="notice small">Click the map where the outpost goes.</p>}
          {active && <OutpostNodes plan={active} onRemove={(id) => updateOutpost(active.id, { nodes: active.nodes.filter((n) => n.id !== id) })} />}
        </section>

        {GROUPS.map((g) => {
          const ids = [...byResource.keys()].filter((id) => groupOf(id === UNKNOWN ? null : id) === g.key)
          if (ids.length === 0) return null
          ids.sort((a, b) => displayName(a).localeCompare(displayName(b)))
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
          {save && (
            <LegendRow
              on={f.crashSites}
              onToggle={() => setFilters({ ...f, crashSites: !f.crashSites })}
              icon={<img src={iconUrl('Desc_HardDrive_C')} alt="" width={22} height={22} />}
              label="Crash sites"
              count={(save.crashSites ?? []).filter(revealed).length}
            />
          )}
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
            return (
              <NodeMarker
                key={m.node.id}
                marker={m}
                picked={Boolean(active && owner?.id === active.id)}
                usedBy={owner && owner.id !== active?.id ? owner.name : undefined}
                onPick={active && pickable(m) && !placing ? () => toggleNode(m.node) : undefined}
                hint={active && !pickable(m) && m.node.kind === 'node' ? 'unlock it to plan with it' : undefined}
              />
            )
          })}
          {crashSites.map((p) => (
            <Landmark key={p.join()} at={p} label="Crash site" icon="Desc_HardDrive_C" className="crash" />
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

const purityName = (p: Purity) => p[0].toUpperCase() + p.slice(1)

function LegendRow({ on, onToggle, icon, label, count }: { on: boolean; onToggle: () => void; icon: ReactNode; label: string; count?: number }) {
  return (
    <button type="button" className={`wm-row${on ? '' : ' off'}`} aria-pressed={on} onClick={onToggle}>
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
      <a className="button secondary small-link" href={`#/outposts/${plan.id}/resources`}>
        Open {plan.name}
      </a>
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

/** Detail tiles of the map picture currently on screen, as "row-col" keys. */
function visibleTiles(view: View, w: number, h: number) {
  const n = worldMapTiles.count
  const tile = (STAGE * view.k) / n
  const keys: string[] = []
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const left = view.x + c * tile, top = view.y + r * tile
      if (left < w && top < h && left + tile > 0 && top + tile > 0) keys.push(`${r}-${c}`)
    }
  return keys
}

/** Pan and zoom (drag, wheel, pinch, buttons) over the map picture with the fog drawn on top. */
function MapView({
  fog,
  hasSave,
  placing,
  onPlace,
  focus,
  menu,
  children,
}: {
  fog: Uint8Array | null
  hasSave: boolean
  placing: boolean
  onPlace: (p: Point) => void
  /** Unit point to center on at first, e.g. the selected outpost. */
  focus: Point | null
  menu: ReactNode
  children: ReactNode
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>({ x: 0, y: 0, k: 1 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  // Full-resolution tiles load once the overview would be stretched, and only those on screen.
  const [tiles, setTiles] = useState<string[]>([])

  const fitZoom = () => Math.min(size.w, size.h) / STAGE
  const maxZoom = () => (worldMapTiles.sourceSize / STAGE) * MAX_OVERZOOM

  const apply = () => {
    const { x, y, k } = view.current
    if (!stage.current) return
    stage.current.style.transform = `translate(${x}px, ${y}px) scale(${k})`
    stage.current.style.setProperty('--k', String(k))
    // Markers shrink when the whole map is in view, so crowded areas stay readable.
    stage.current.style.setProperty('--s', String(Math.min(1, Math.max(0.6, k / (fitZoom() * 3)))))
    const wanted = STAGE * k * window.devicePixelRatio > worldMapOverview.size * 1.1 ? visibleTiles(view.current, size.w, size.h) : []
    setTiles((prev) => {
      // Keep tiles already loaded, so panning back doesn't flash the overview.
      const next = [...new Set([...prev, ...wanted])]
      return next.length === prev.length ? prev : next
    })
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
  const fitAll = () => fit({ left: 0, top: 0, right: 1, bottom: 1 })
  const fitExplored = () => {
    const box = fog && exploredBox(fog)
    if (box) fit(box)
    else fitAll()
  }

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // First layout: zoom to the selected outpost, or to what's been explored.
  const placed = useRef(false)
  useLayoutEffect(() => {
    if (!size.w || !size.h) return
    if (!placed.current) {
      placed.current = true
      const r = 0.05
      if (focus) fit({ left: focus[0] - r, top: focus[1] - r, right: focus[0] + r, bottom: focus[1] + r })
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
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    pointers.current.set(e.pointerId, local(e))
    gesture.current = { moved: pointers.current.size > 1, dist: pinchDistance() }
  }
  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
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
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size === 1) {
      set({ ...view.current, x: view.current.x + p.x - prev.x, y: view.current.y + p.y - prev.y })
    } else if (pointers.current.size === 2) {
      const dist = pinchDistance()
      const [a, b] = [...pointers.current.values()]
      if (gesture.current.dist > 0) zoomAt(dist / gesture.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2)
      // Pan with the midpoint too.
      set({ ...view.current, x: view.current.x + (p.x - prev.x) / 2, y: view.current.y + (p.y - prev.y) / 2 })
      gesture.current.dist = dist
    }
  }
  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId)
    gesture.current.dist = pinchDistance()
  }
  // A click (not the end of a drag) on the map itself, while placing an outpost.
  const onClick = (e: ReactMouseEvent) => {
    if (!placing || gesture.current.moved || (e.target as Element).closest('.wm-marker, .wm-controls, .wm-menu')) return
    const p = local(e)
    const { x, y, k } = view.current
    onPlace(toWorld(worldMap, [(p.x - x) / k / STAGE, (p.y - y) / k / STAGE]))
  }

  const zoomButton = (factor: number) => zoomAt(factor, size.w / 2, size.h / 2)
  const n = worldMapTiles.count

  return (
    <div
      className={`wm-viewport${placing ? ' placing' : ''}`}
      ref={viewport}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
    >
      <div className="wm-stage" ref={stage} style={{ width: STAGE, height: STAGE }}>
        <img className="wm-image" src={worldMapOverview.url} alt="Map of the world" draggable={false} />
        {tiles.map((key) => {
          const [r, c] = key.split('-').map(Number)
          return (
            <img
              key={key}
              className="wm-tile"
              src={worldMapTiles.url(r, c)}
              alt=""
              draggable={false}
              style={{ left: `${(c * 100) / n}%`, top: `${(r * 100) / n}%`, width: `${100 / n}%`, height: `${100 / n}%` }}
            />
          )
        })}
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
        {fog && (
          <button type="button" className="secondary small" onClick={fitExplored}>
            Explored
          </button>
        )}
        <button type="button" className="secondary small" onClick={fitAll}>
          Whole map
        </button>
      </div>
      <p className="wm-credit">
        Map: <a href="https://satisfactory.wiki.gg/wiki/Map" target="_blank" rel="noreferrer">Official Satisfactory Wiki</a>
      </p>
    </div>
  )
}
