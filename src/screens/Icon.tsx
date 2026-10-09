import { buildingsById, itemName } from '../data'
import { iconUrl } from '../data/icons'
import { fmt } from '../format'

const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

/** Game icon for an item or building, or a lettered badge when the data has none. */
export function Icon({ id, size = 22 }: { id: string; size?: number }) {
  const url = iconUrl(id)
  const name = buildingsById.get(id)?.name ?? itemName(id)
  if (url) return <img className="icon" src={url} alt="" width={size} height={size} loading="lazy" />
  const letters = name
    .split(/[\s-]+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
  return (
    <span
      className="icon icon-fallback"
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue(id)} 45% 45%)` }}
    >
      {letters}
    </span>
  )
}

/** A per-minute amount with its icon. */
export function Amount({ item, perMin, unit = '/min' }: { item: string; perMin: number; unit?: string }) {
  return (
    <span className="rate">
      <Icon id={item} size={16} />
      <b>{fmt(perMin)}</b>
      {unit} {itemName(item)}
    </span>
  )
}
