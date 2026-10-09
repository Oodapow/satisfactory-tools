import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { displayName, iconUrl } from '../data/icons'
import type { Purity } from '../data/game/types'
import { worldMap, worldMapImage } from '../data/game/worldMap'
import { FOG_SIZE, type Point } from '../save/readMap'
import type { GameState } from '../state/gameState'
import { usePersistentState } from '../storage/persisted'
import { hide, useTip } from '../ui/tooltip'
import { decodeFog, exploredBox, fogAt, fogOpacity, FOG_REVEALED, markers, PURITIES, toUnit, type Marker } from './model'
import './world.css'

// The map is laid out on a square "stage" of STAGE px and zoomed with a CSS transform;
// markers scale back by 1/zoom so they stay the same size on screen.
const STAGE = 1000
const MAX_ZOOM_OVER_IMAGE = 3

type View = { x: number; y: number; k: number }

type Filters = {
  /** Resources (or "unknown") the player switched off. */
  hidden: string[]
  hiddenPurities: Purity[]
  crashSites: boolean
  /** Spoilers: show nodes in unexplored areas too. */
  showAll: boolean
}
const defaultFilters: Filters = { hidden: [], hiddenPurities: [], crashSites: true, showAll: false }
const UNKNOWN = 'unknown'

export default function WorldScreen({ state }: { state: GameState }) {
  const [filters, setFilters] = usePersistentState<Filters>('worldMapFilters', defaultFilters)
  const f = { ...defaultFilters, ...filters }
  const save = state.map
  const fog = useMemo(() => (save ? decodeFog(save.fog) : null), [save])
  const all = useMemo(() => markers(worldMap, state, f.showAll), [state, f.showAll])
  const shown = all.filter(
    (m) => !f.hidden.includes(m.resource ?? UNKNOWN) && !f.hiddenPurities.includes(m.node.purity) && m.node.kind !== 'wellCore',
  )
  const cores = all.filter((m) => m.node.kind === 'wellCore' && !f.hidden.includes(m.resource ?? UNKNOWN))
  const revealed = (p: Point) => f.showAll || (fog !== null && fogAt(worldMap, fog, p) >= FOG_REVEALED)
  const crashSites = f.crashSites ? (save?.crashSites ?? []).filter(revealed) : []

  // Counts for the filter chips, before filtering.
  const byResource = new Map<string, number>()
  const byPurity = new Map<Purity, number>()
  for (const m of all) {
    if (m.node.kind === 'wellCore') continue
    byResource.set(m.resource ?? UNKNOWN, (byResource.get(m.resource ?? UNKNOWN) ?? 0) + 1)
    byPurity.set(m.node.purity, (byPurity.get(m.node.purity) ?? 0) + 1)
  }
  const resourceIds = [...byResource.keys()].sort((a, b) =>
    a === UNKNOWN ? 1 : b === UNKNOWN ? -1 : displayName(a).localeCompare(displayName(b)),
  )
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])

  return (
    <div className="wm-screen">
      <div className="wm-bar">
        <div className="wm-chips" role="group" aria-label="Resources">
          {resourceIds.map((id) => (
            <button
              key={id}
              type="button"
              className={`wm-chip${f.hidden.includes(id) ? ' off' : ''}`}
              aria-pressed={!f.hidden.includes(id)}
              onClick={() => setFilters({ ...f, hidden: toggle(f.hidden, id) })}
            >
              {id === UNKNOWN ? <span className="wm-unknown small">?</span> : <img src={iconUrl(id)} alt="" width={20} height={20} />}
              {id === UNKNOWN ? 'Not unlocked yet' : displayName(id)}
              <span className="wm-count">{byResource.get(id)}</span>
            </button>
          ))}
        </div>
        <div className="wm-chips" role="group" aria-label="Purity and landmarks">
          {PURITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={`wm-chip${f.hiddenPurities.includes(p) ? ' off' : ''}`}
              aria-pressed={!f.hiddenPurities.includes(p)}
              onClick={() => setFilters({ ...f, hiddenPurities: toggle(f.hiddenPurities, p) })}
            >
              <span className={`wm-dot ${p}`} />
              {p[0].toUpperCase() + p.slice(1)}
              <span className="wm-count">{byPurity.get(p) ?? 0}</span>
            </button>
          ))}
          {save && (
            <button
              type="button"
              className={`wm-chip${f.crashSites ? '' : ' off'}`}
              aria-pressed={f.crashSites}
              onClick={() => setFilters({ ...f, crashSites: !f.crashSites })}
            >
              <img src={iconUrl('Desc_HardDrive_C')} alt="" width={20} height={20} />
              Crash sites
            </button>
          )}
          <label className="wm-check" title="Shows nodes in places you haven't been yet">
            <input type="checkbox" checked={f.showAll} onChange={(e) => setFilters({ ...f, showAll: e.target.checked })} />
            Show unexplored (spoilers)
          </label>
        </div>
      </div>
      {!save && (
        <p className="notice wm-notice">
          The map shows what you've explored, which comes from your save. <a href="#/upload">Upload a save</a> to see it.
        </p>
      )}
      <MapView fog={f.showAll ? null : fog} hasSave={Boolean(save)}>
        {cores.map((m) => (
          <NodeMarker key={m.node.id} marker={m} />
        ))}
        {shown.map((m) => (
          <NodeMarker key={m.node.id} marker={m} />
        ))}
        {crashSites.map((p) => (
          <Landmark key={p.join()} at={p} label="Crash site" icon="Desc_HardDrive_C" className="crash" />
        ))}
        {save?.hub && <Landmark at={save.hub} label="The HUB" icon="Desc_TradingPost_C" className="hub" />}
        {save?.players.map((p) => <Landmark key={p.join()} at={p} label="You (when the game was saved)" className="player" />)}
      </MapView>
    </div>
  )
}

const purityName = (p: Purity) => p[0].toUpperCase() + p.slice(1)

function NodeMarker({ marker: { node, resource, inUse } }: { marker: Marker }) {
  const what = resource ? displayName(resource) : 'Unknown resource'
  const label =
    node.kind === 'wellCore'
      ? `Resource well: ${what}`
      : `${purityName(node.purity)} ${what}${node.kind === 'wellSatellite' ? ' (resource well)' : node.kind === 'geyser' ? '' : ' node'}${inUse ? ' · in use' : ''}`
  const tip = useTip(label, { tapShows: true })
  const [u, v] = toUnit(worldMap, [node.x, node.y])
  const kindClass = node.kind === 'wellCore' ? 'core' : node.kind === 'wellSatellite' ? 'satellite' : ''
  return (
    <span
      className={`wm-marker wm-node ${node.kind === 'wellCore' ? '' : node.purity} ${kindClass}${inUse ? ' in-use' : ''}`}
      style={{ left: `${u * 100}%`, top: `${v * 100}%` }}
      role="img"
      aria-label={label}
      tabIndex={0}
      {...tip}
    >
      {resource ? <img src={iconUrl(resource)} alt="" draggable={false} /> : <span className="wm-unknown">?</span>}
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

/** Pan and zoom (drag, wheel, pinch, buttons) over the map picture with the fog drawn on top. */
function MapView({ fog, hasSave, children }: { fog: Uint8Array | null; hasSave: boolean; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>({ x: 0, y: 0, k: 1 })
  const [size, setSize] = useState({ w: 0, h: 0 })

  const fitZoom = () => Math.min(size.w, size.h) / STAGE
  const maxZoom = () => (4096 / STAGE) * MAX_ZOOM_OVER_IMAGE

  const apply = () => {
    const { x, y, k } = view.current
    if (!stage.current) return
    stage.current.style.transform = `translate(${x}px, ${y}px) scale(${k})`
    stage.current.style.setProperty('--k', String(k))
    // Markers shrink when the whole map is in view, so crowded areas stay readable.
    stage.current.style.setProperty('--s', String(Math.min(1, Math.max(0.6, k / (fitZoom() * 3)))))
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
  const fit = (box: { left: number; top: number; right: number; bottom: number }) => {
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

  // First layout: zoom to what's been explored.
  const placed = useRef(false)
  useLayoutEffect(() => {
    if (!size.w || !size.h) return
    if (!placed.current) {
      placed.current = true
      fitExplored()
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
  const local = (e: ReactPointerEvent) => {
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

  const zoomButton = (factor: number) => zoomAt(factor, size.w / 2, size.h / 2)

  return (
    <div
      className="wm-viewport"
      ref={viewport}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="wm-stage" ref={stage} style={{ width: STAGE, height: STAGE }}>
        <img className="wm-image" src={worldMapImage} alt="Map of the world" draggable={false} />
        <canvas className="wm-fog" ref={canvas} width={FOG_SIZE} height={FOG_SIZE} />
        {children}
      </div>
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
