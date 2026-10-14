import { describe, expect, it } from 'vitest'
import type { GameState } from '../state/gameState'
import { freshness } from './freshness'

const loaded = (saveName: string, saveModified: number | undefined, purchased: string[]): GameState => ({
  source: 'save',
  saveName,
  saveModified,
  purchased,
  spaceElevatorPhase: 2,
  spoilers: 'hide',
})

const tier4 = ['Schematic_4-1_C', 'Schematic_4-3_C', 'Schematic_4-4_C', 'Schematic_4-5_C', 'Schematic_5-3_C']

describe('re-reading a linked save', () => {
  it('replaces the state with a newer save that has more milestones', () => {
    const stored = loaded('Speed Runner_autosave_1.sav', 1000, ['Schematic_3-1_C'])
    expect(freshness(stored, { name: 'Speed Runner.sav', lastModified: 2000 })).toBe('newer')
  })

  it('keeps a newer save uploaded by hand over an older linked autosave (#79)', () => {
    const stored = loaded('Speed Runner.sav', 2000, ['Schematic_3-1_C', ...tier4])
    expect(freshness(stored, { name: 'Speed Runner_autosave_1.sav', lastModified: 1000 })).toBe('older')
  })

  it('skips the same file when it has not changed', () => {
    expect(freshness(loaded('Speed Runner.sav', 2000, tier4), { name: 'Speed Runner.sav', lastModified: 2000 })).toBe('unchanged')
  })

  it('reads the same file again once the game wrote to it', () => {
    expect(freshness(loaded('Speed Runner.sav', 2000, tier4), { name: 'Speed Runner.sav', lastModified: 3000 })).toBe('newer')
  })

  it('reads when the loaded state has no save time to compare with', () => {
    expect(freshness(null, { name: 'a.sav', lastModified: 1 })).toBe('newer')
    expect(freshness({ ...loaded('a.sav', undefined, []), source: 'manual' }, { name: 'a.sav', lastModified: 1 })).toBe('newer')
    expect(freshness(loaded('a.sav', undefined, tier4), { name: 'b.sav', lastModified: 1 })).toBe('newer')
  })
})
