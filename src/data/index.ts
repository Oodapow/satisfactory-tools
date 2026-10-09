// App-facing entry to the game data in ./game, plus small lookups the UI shares.
import { itemsById } from './game'

export * from './game'

export const itemName = (id: string) => itemsById.get(id)?.name ?? id
