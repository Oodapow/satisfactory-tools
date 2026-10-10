// Pulls the unlock progress out of a Satisfactory save. Runs inside the save
// worker; the parsing itself is done by @etothepii/satisfactory-file-parser.
import { Parser, type SaveComponent, type SaveEntity } from '@etothepii/satisfactory-file-parser'
import { readMap, type SaveMap } from './readMap'

/** What we read from a save, before matching it against our game data. */
export interface SaveSummary {
  sessionName: string
  playSeconds: number
  saveVersion: number
  buildVersion: number
  isModded: boolean
  /** Class names of every bought milestone, research, alternate and shop schematic (e.g. "Schematic_1-1_C"). */
  purchased: string[]
  /** Space Elevator phases delivered (0-5). */
  spaceElevatorPhase: number
  /** Explored area and landmarks for the world map; null if the save has no map data. */
  map: SaveMap | null
}

type ObjectRef = { pathName: string }

/** "/Game/.../Schematic_1-1.Schematic_1-1_C" → "Schematic_1-1_C" */
const className = (ref: ObjectRef) => ref.pathName.slice(ref.pathName.lastIndexOf('.') + 1)

export function readSave(name: string, file: ArrayBuffer, onProgress?: (progress: number) => void): SaveSummary {
  const save = Parser.ParseSave(name, file, { onProgressCallback: (p) => onProgress?.(p) })
  const objects: (SaveEntity | SaveComponent)[] = Object.values(save.levels).flatMap((l) => l.objects)
  const find = (type: string) => objects.find((o) => o.typePath.endsWith(type))

  const schematics = find('.BP_SchematicManager_C')
  if (!schematics) throw new Error('This save has no schematic manager, so it may not be a Satisfactory game save.')
  const purchased = (schematics.properties.mPurchasedSchematics as { values?: ObjectRef[] } | undefined)?.values ?? []

  // The game phase is "GP_Project_Assembly_Phase_N" once N phases are delivered.
  const phase = (find('.BP_GamePhaseManager_C')?.properties.mCurrentGamePhase as { value?: ObjectRef } | undefined)?.value
  const phaseNumber = Number(phase?.pathName.match(/Phase_(\d+)$/)?.[1] ?? 0)

  return {
    sessionName: save.header.sessionName,
    playSeconds: save.header.playDurationSeconds,
    saveVersion: save.header.saveVersion,
    buildVersion: save.header.buildVersion,
    isModded: Boolean(save.header.isModdedSave),
    purchased: [...new Set(purchased.map(className))],
    spaceElevatorPhase: Math.min(Math.max(phaseNumber, 0), 5),
    map: readMap(objects, Object.values(save.levels).flatMap((l) => l.collectables ?? [])),
  }
}
