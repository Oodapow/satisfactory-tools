import { buildings, items, recipesById, type ItemAmount, type Schematic } from '../data'
import { iconUrl } from '../data/icons'
import { fmt } from '../format'
import { GameIcon } from './GameIcon'

// Schematics (milestones, research, alternates) have no icon files of their own, so
// borrow one: an item or building drawn with the same texture, else the first thing
// the schematic unlocks.
let byTexture: Map<string, string> | undefined
function schematicIconId(s: Schematic): string | undefined {
  byTexture ??= new Map(
    [...items, ...buildings]
      .filter((x) => x.iconTexture && iconUrl(x.id))
      .map((x) => [x.iconTexture as string, x.id] as const)
      .reverse(),
  )
  const recipe = s.unlocks.recipes.map((id) => recipesById.get(id)).find(Boolean)
  const candidates = [
    s.iconTexture ? byTexture.get(s.iconTexture) : undefined,
    recipe?.building ?? recipe?.products[0]?.item,
    ...s.unlocks.scannerResources,
    ...s.unlocks.items.map((x) => x.item),
  ]
  return candidates.find((id) => id && iconUrl(id))
}

/** Icon for a milestone, research node or alternate, borrowed from what it unlocks. */
export function SchematicIcon({ schematic, size = 32 }: { schematic: Schematic; size?: number }) {
  const name = schematic.name.replace('Alternate: ', '')
  // The name is not an item id, so the fallback is a lettered badge with no catalog link.
  return <GameIcon id={schematicIconId(schematic) ?? name} size={size} title={name} link={false} />
}

/** What a schematic gives, as a row of icons. */
export function Unlocks({ schematic, size = 22, max = 8 }: { schematic: Schematic; size?: number; max?: number }) {
  const ids = [
    ...new Set(
      schematic.unlocks.recipes
        .map((id) => recipesById.get(id))
        .map((r) => r && (r.building ?? r.products[0]?.item))
        .concat(schematic.unlocks.scannerResources)
        .filter((id): id is string => !!id),
    ),
  ]
  if (ids.length === 0) return null
  return (
    <span className="icon-row">
      {ids.slice(0, max).map((id) => (
        <GameIcon key={id} id={id} size={size} />
      ))}
      {ids.length > max && <span className="muted small">+{ids.length - max}</span>}
    </span>
  )
}

/** Item amounts as "100 [icon]" chips. */
export function Costs({ list }: { list: ItemAmount[] }) {
  return (
    <span className="rates">
      {list.map((c) => (
        <span key={c.item} className="rate">
          <b>{fmt(c.amount)}</b>
          <GameIcon id={c.item} />
        </span>
      ))}
    </span>
  )
}
