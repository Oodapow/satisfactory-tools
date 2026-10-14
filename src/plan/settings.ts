import { usePersistentState } from '../storage/persisted'
import { DEFAULT_CLOCK_MODE } from './solve'
import type { ClockMode } from './types'

/** Planner-wide settings, shared by every outpost. */
export type PlannerSettings = {
  /** How steps without their own setting size their machines. */
  clockMode: ClockMode
}

const DEFAULTS: PlannerSettings = { clockMode: DEFAULT_CLOCK_MODE }

export function usePlannerSettings() {
  const [stored, setStored] = usePersistentState<Partial<PlannerSettings>>('plannerSettings', DEFAULTS)
  const settings: PlannerSettings = { ...DEFAULTS, ...stored }
  return [settings, (patch: Partial<PlannerSettings>) => setStored((prev) => ({ ...prev, ...patch }))] as const
}
