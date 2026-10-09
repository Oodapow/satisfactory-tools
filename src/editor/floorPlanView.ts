import { createContext } from 'react'
import type { Orient } from './grid'
import type { Point } from './router'

/** What the floor plan editor works out for all blocks at once: belt routes on the grid and which way joints and ports face. */
export type FloorPlanView = { routes: Map<string, Point[]>; orients: Map<string, Orient>; dragging: Set<string> }
export const FloorPlanContext = createContext<FloorPlanView | null>(null)
