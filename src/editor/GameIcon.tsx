import { useState } from 'react'
import { displayName, iconUrl } from './icons'

// Icons that failed to load, so they fall back straight away next time.
const failed = new Set<string>()

function hue(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** Game icon for an item, building or power, or a lettered badge when there is none. */
export function GameIcon({ id, size = 28, title }: { id?: string; size?: number; title?: string }) {
  const src = id ? iconUrl(id) : undefined
  const [, rerender] = useState(0)
  const broken = !src || failed.has(src)
  const name = id ? displayName(id) : '?'
  if (!broken && src)
    return (
      <img
        className="game-icon"
        src={src}
        width={size}
        height={size}
        alt=""
        title={title ?? name}
        onError={() => {
          failed.add(src)
          rerender((n) => n + 1)
        }}
      />
    )
  const initials = name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
  return (
    <span
      className="game-icon fallback"
      title={title ?? name}
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${id ? hue(id) : 0} 55% 45%)` }}
    >
      {initials}
    </span>
  )
}
