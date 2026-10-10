// Pulls what the world map needs out of a parsed save: the explored area (fog of war),
// which nodes have an extractor on them, what's been collected, and a few landmarks.
import type { SaveComponent, SaveEntity } from '@etothepii/satisfactory-file-parser'

/** Side of the fog grid we keep. The save's is 512; half is plenty under a blurred overlay. */
export const FOG_SIZE = 256
const SAVE_FOG_SIZE = 512

/** World positions are [x, y] in cm. */
export type Point = [number, number]

export interface SaveMap {
  /**
   * Explored area as FOG_SIZE × FOG_SIZE bytes, row by row from the north-west corner, base64.
   * 0 is unexplored; the game writes up to about 170 where the pioneer has been.
   */
  fog: string
  /** Ids of nodes, well spots and geysers with an extractor on them (as in world-map.json). */
  occupied: string[]
  hub: Point | null
  players: Point[]
  /**
   * Collected pickups and opened or dismantled crash sites: actor names and pickup ids, matched
   * against `id` and `guid` in world-map.json's collectibles.
   */
  collected: string[]
}

type SaveObject = SaveEntity | SaveComponent
type ObjectRef = { pathName: string }

const actorName = (pathName: string) => pathName.slice(pathName.lastIndexOf('.') + 1)

/** A GUID as the save stores it (four uint32s) in the form the collectibles list uses: "0802A376-4D248B96-…". */
const guid = (parts: number[]) => parts.map((n) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0')).join('-')

const position = (o: SaveObject): Point | null => {
  const t = 'transform' in o ? o.transform?.translation : undefined
  return t ? [Math.round(t.x), Math.round(t.y)] : null
}

/** The map manager stores the fog as 512×512 RGBA; the blue channel is how explored a texel is. */
function fogOf(objects: SaveObject[]): string | null {
  const manager = objects.find((o) => o.typePath.endsWith('.FGMapManager'))
  const raw = (manager?.properties.mFogOfWarRawData as { values?: number[] } | undefined)?.values
  if (!raw || raw.length !== SAVE_FOG_SIZE * SAVE_FOG_SIZE * 4) return null
  const step = SAVE_FOG_SIZE / FOG_SIZE
  const out = new Uint8Array(FOG_SIZE * FOG_SIZE)
  for (let y = 0; y < FOG_SIZE; y++) {
    for (let x = 0; x < FOG_SIZE; x++) {
      let max = 0
      for (let dy = 0; dy < step; dy++)
        for (let dx = 0; dx < step; dx++) max = Math.max(max, raw[((y * step + dy) * SAVE_FOG_SIZE + x * step + dx) * 4 + 2])
      out[y * FOG_SIZE + x] = max
    }
  }
  let binary = ''
  for (const b of out) binary += String.fromCharCode(b)
  return btoa(binary)
}

/**
 * What the pioneer has collected. Picked-up slugs, Somersloops and Mercer Spheres are listed by
 * pickup id in the scannable subsystem (and some by name in the levels' collectables, which also
 * hold dismantled crash sites); an opened crash site has mHasBeenOpened set.
 */
function collectedOf(objects: SaveObject[], collectables: ObjectRef[]): string[] {
  const out = new Set(collectables.map((c) => actorName(c.pathName)))
  const scannable = objects.find((o) => o.typePath.endsWith('.FGScannableSubsystem'))
  const picked = (scannable?.properties.mDestroyedPickups as { values?: unknown[] } | undefined)?.values ?? []
  for (const g of picked) if (Array.isArray(g) && g.length === 4) out.add(guid(g as number[]))
  for (const o of objects)
    if (o.typePath.endsWith('/BP_DropPod.BP_DropPod_C') && (o.properties.mHasBeenOpened as { value?: boolean } | undefined)?.value)
      out.add(actorName(o.instanceName))
  return [...out].sort()
}

export function readMap(objects: SaveObject[], collectables: ObjectRef[] = []): SaveMap | null {
  const fog = fogOf(objects)
  if (fog === null) return null
  const occupied = new Set<string>()
  const of = (type: string) => objects.filter((o) => o.typePath.endsWith(type))
  for (const o of objects) {
    const ref = (o.properties.mExtractableResource as { value?: ObjectRef } | undefined)?.value?.pathName
    if (ref) occupied.add(actorName(ref))
  }
  const points = (list: SaveObject[]) => list.map(position).filter((p): p is Point => p !== null)
  return {
    fog,
    occupied: [...occupied].sort(),
    hub: points(of('/Build_TradingPost.Build_TradingPost_C'))[0] ?? null,
    players: points(of('/Char_Player.Char_Player_C')),
    collected: collectedOf(objects, collectables),
  }
}
