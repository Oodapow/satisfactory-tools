import { createContext } from 'react'
import type { Flow } from './flow'
import type { Orient } from './grid'
import type { Point } from './router'

/** A line's worked-out load, with the lowest Mk that carries it. */
export type LineLoad = Flow & { tier?: number; over?: boolean }

/**
 * What the floor plan editor works out for all blocks at once: belt and pipe routes on the grid,
 * which way joints and ports face, what every line carries, and which connection points are taken.
 */
export type FloorPlanView = {
  routes: Map<string, Point[]>
  orients: Map<string, Orient>
  dragging: Set<string>
  loads: Map<string, LineLoad>
  /** Lines that found no route of their own and share grid space with another. */
  clashes: Set<string>
  /** Taken connection points, as `node:handle`. */
  used: Set<string>
}
export const FloorPlanContext = createContext<FloorPlanView | null>(null)
