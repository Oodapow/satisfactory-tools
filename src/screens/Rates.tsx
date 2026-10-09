import { itemName, type ItemAmount, type Recipe } from '../data'
import { fmt } from '../format'
import { perMin } from '../plan/solve'
import { GameIcon } from '../ui/GameIcon'

/** Item amounts as per-minute chips: recipe amounts are per cycle, so pass the recipe. */
export function Rates({ list, recipe, scale = 1 }: { list: ItemAmount[]; recipe: Recipe; scale?: number }) {
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
