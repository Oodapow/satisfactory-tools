// Which ways of moving goods the player has unlocked, so pickers don't offer locked ones.
import type { Availability } from '../data/game/availability'
import { itemsById, resourcesById, type BuildingId, type ItemId } from '../data'
import type { Transport } from './types'

/** Buildings that make each transport usable; any one of them is enough. */
const transportBuildings: Record<Transport | 'power', BuildingId[]> = {
  belt: ['Desc_ConveyorBeltMk1_C'],
  pipe: ['Desc_Pipeline_C'],
  truck: ['Desc_TruckStation_C'],
  train: ['Desc_TrainDockingStation_C', 'Desc_TrainDockingStationLiquid_C'],
  drone: ['Desc_DroneStation_C'],
  power: ['Desc_PowerLine_C'],
}

export const transportUnlocked = (t: Transport | 'power', a: Availability) => transportBuildings[t].some((b) => a.buildings.has(b))

const beltTiers = [1, 2, 3, 4, 5, 6].map((mk) => `Desc_ConveyorBeltMk${mk}_C`)
const pipeTiers = ['Desc_Pipeline_C', 'Desc_PipelineMK2_C']
const best = (tiers: string[], a: Availability) => Math.max(1, ...tiers.map((id, i) => (a.buildings.has(id) ? i + 1 : 0)))

/** Highest conveyor belt Mk the player can build (1 when none is unlocked yet). */
export const bestBeltTier = (a: Availability) => best(beltTiers, a)
/** Highest pipeline Mk the player can build (1 when none is unlocked yet). */
export const bestPipeTier = (a: Availability) => best(pipeTiers, a)


/**
 * Ways an item can travel between outposts: solids by belt, truck, train or drone; fluids and
 * gases by pipe or in a fluid freight car. Packaged fluids are solid items, so they go by belt.
 */
export function transportsFor(item: ItemId | undefined): Transport[] {
  if (!item) return ['belt', 'pipe', 'truck', 'train', 'drone']
  const form = itemsById.get(item)?.form ?? resourcesById.get(item)?.form
  return form && form !== 'solid' ? ['pipe', 'train'] : ['belt', 'truck', 'train', 'drone']
}

/** `via` if the item can travel that way, otherwise the first way it can. */
export const fitTransport = (item: ItemId | undefined, via?: Transport): Transport => {
  const ok = transportsFor(item)
  return via && ok.includes(via) ? via : ok[0]
}
