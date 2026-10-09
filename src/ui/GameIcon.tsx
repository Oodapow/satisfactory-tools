import { createContext, useContext, useState, type ReactNode } from 'react'
import { buildingsById, itemName, itemsById } from '../data'
import { displayName, iconUrl, POWER } from '../data/icons'
import { fmt } from '../format'
import { catalogHref } from '../router'
import { useTip } from './tooltip'

// Icons that failed to load, so they fall back straight away next time.
const failed = new Set<string>()

/** Default icon size. Pass a size only where the layout needs a different one. */
export const ICON = 22

/**
 * Whether icons inside are links to the catalog. Turn it off where a click already
 * means something else: inside a button, or on the map canvas where it selects.
 */
const IconLinks = createContext(true)
export function NoIconLinks({ children }: { children: ReactNode }) {
  return <IconLinks.Provider value={false}>{children}</IconLinks.Provider>
}

function hue(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** Catalog link for an item or building id, or undefined for anything else (power). */
function hrefFor(id: string) {
  if (buildingsById.has(id)) return catalogHref('buildings', buildingsById.get(id)!.name)
  if (itemsById.has(id)) return catalogHref('items', itemsById.get(id)!.name)
}

/**
 * Game icon for an item, building or power, with its name as a tooltip. Clicking it
 * opens the catalog searched for that thing. Draws a lettered badge when there is no
 * icon file.
 */
export function GameIcon({
  id,
  size = ICON,
  title,
  fallback,
  link,
}: {
  id?: string
  size?: number
  /** Tooltip text; defaults to the item or building name. */
  title?: string
  /** Shown instead of the lettered badge when there is no icon. */
  fallback?: ReactNode
  /** Override whether the icon links to the catalog. */
  link?: boolean
}) {
  const linksOn = useContext(IconLinks)
  const [, rerender] = useState(0)
  const name = id ? displayName(id) : '?'
  const text = title ?? name
  const href = id && (link ?? linksOn) ? hrefFor(id) : undefined
  const tip = useTip(text, { tapShows: !href })

  const src = id ? iconUrl(id) : undefined
  let img: ReactNode
  if (src && !failed.has(src))
    img = (
      <img
        className="game-icon"
        src={src}
        width={size}
        height={size}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => {
          failed.add(src)
          rerender((n) => n + 1)
        }}
      />
    )
  else if (fallback) img = fallback
  else {
    const initials = name
      .split(/[\s.-]+/)
      .filter((w) => /^[A-Za-z0-9]/.test(w))
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
    img = (
      <span
        className="game-icon fallback"
        style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${id ? hue(id) : 0} 55% 45%)` }}
      >
        {initials}
      </span>
    )
  }

  if (href)
    return (
      <a className="icon-wrap icon-link" href={href} aria-label={`${name}: find in the catalog`} onClick={(e) => e.stopPropagation()} {...tip}>
        {img}
      </a>
    )
  return (
    <span className="icon-wrap" role="img" aria-label={text} {...tip}>
      {img}
    </span>
  )
}

/** The electricity icon, for MW amounts. */
export function PowerIcon({ size = ICON }: { size?: number }) {
  return <GameIcon id={POWER} size={size} />
}

/** A per-minute amount with its icon. */
export function Amount({ item, perMin, unit = '/min' }: { item: string; perMin: number; unit?: string }) {
  return (
    <span className="rate">
      <GameIcon id={item} size={18} />
      <b>{fmt(perMin)}</b>
      {unit} {itemName(item)}
    </span>
  )
}
