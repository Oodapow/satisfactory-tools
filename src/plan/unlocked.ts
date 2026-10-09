// Which ways of moving goods the player has unlocked, so pickers don't offer locked ones.
import type { Availability } from '../data/game/availability'
import type { BuildingId } from '../data'
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

