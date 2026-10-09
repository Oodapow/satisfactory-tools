import { itemName, type ItemAmount, type Recipe } from '../data'
import { fmt } from '../format'
import { perMin } from '../plan/solve'
import { GameIcon } from '../ui/GameIcon'

/**
 * Item amounts as per-minute chips: recipe amounts are per cycle, so pass the recipe.
 * `compact` drops the names to tooltips except on wide screens, as "10/min [icon]".
 */
export function Rates({
  list,
  recipe,
  scale = 1,
  compact = false,
}: {
  list: ItemAmount[]
  recipe: Recipe
  scale?: number
  compact?: boolean
}) {
  if (compact)
    return (
      <span className="rates">
        {list.map((x) => (
          <span key={x.item} className="rate">
            <b>{fmt(perMin(x.amount, recipe) * scale)}/min</b>
            <GameIcon id={x.item} />
            <span className="rate-name">{itemName(x.item)}</span>
          </span>
        ))}
      </span>
    )
  return (
    <span className="rates">
      {list.map((x) => (
        <span key={x.item} className="rate">
          <GameIcon id={x.item} size={20} />
          <b>{fmt(perMin(x.amount, recipe) * scale)}</b> {itemName(x.item)}
        </span>
      ))}
    </span>
  )
}
