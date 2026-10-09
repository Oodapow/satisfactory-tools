import { describe, expect, it } from 'vitest'
import { resources, schematics } from '../data'
import { availability } from '../data/game/availability'
import { worldMap } from '../data/game/worldMap'
import { FOG_SIZE, type SaveMap } from '../save/readMap'
import type { GameState } from '../state/gameState'
import { decodeFog, exploredBox, fogAt, fogOpacity, knowsResource, markers, toUnit } from './model'

const b = worldMap.bounds
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

/** Fog that is explored (value 160) inside a unit-coordinate box and hidden elsewhere. */
function fogWith(box: { left: number; top: number; right: number; bottom: number }) {
  const fog = new Uint8Array(FOG_SIZE * FOG_SIZE)
  for (let y = 0; y < FOG_SIZE; y++)
    for (let x = 0; x < FOG_SIZE; x++) {
      const u = (x + 0.5) / FOG_SIZE, v = (y + 0.5) / FOG_SIZE
      if (u >= box.left && u < box.right && v >= box.top && v < box.bottom) fog[y * FOG_SIZE + x] = 160
    }
  return fog
}
const saveMap = (fog: Uint8Array, occupied: string[] = []): SaveMap => ({ fog: encode(fog), occupied, hub: null, players: [], crashSites: [] })

describe('world map data', () => {
  it('places every node inside the map bounds', () => {
    for (const n of worldMap.nodes) {
      const [u, v] = toUnit(worldMap, [n.x, n.y])
      expect(u).toBeGreaterThan(0)
      expect(u).toBeLessThan(1)
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('only uses resources the game data knows', () => {
    const ids = new Set([...resources.map((r) => r.id), 'Desc_Geyser_C'])
    for (const n of worldMap.nodes) expect(ids).toContain(n.resource)
  })
})

describe('fog', () => {
  it('maps world corners to the fog grid', () => {
    const fog = new Uint8Array(FOG_SIZE * FOG_SIZE)
    fog[0] = 1
    fog[FOG_SIZE - 1] = 2
    fog[FOG_SIZE * FOG_SIZE - 1] = 3
    expect(fogAt(worldMap, fog, [b.west + 1, b.north + 1])).toBe(1)
    expect(fogAt(worldMap, fog, [b.east - 1, b.north + 1])).toBe(2)
    expect(fogAt(worldMap, fog, [b.east - 1, b.south - 1])).toBe(3)
    expect(fogAt(worldMap, fog, [b.west - 10, b.north])).toBe(0)
  })

  it('round-trips through base64', () => {
    const fog = fogWith({ left: 0.5, top: 0, right: 1, bottom: 0.5 })
    expect(decodeFog(encode(fog))).toEqual(fog)
  })

  it('fades from hidden to clear', () => {
    expect(fogOpacity(0)).toBe(1)
    expect(fogOpacity(255)).toBe(0)
    expect(fogOpacity(50)).toBeGreaterThan(0)
    expect(fogOpacity(50)).toBeLessThan(1)
  })

  it('finds the explored box', () => {
    const box = exploredBox(fogWith({ left: 0.5, top: 0.25, right: 0.75, bottom: 0.5 }))!
    expect(box.left).toBeCloseTo(0.5, 2)
    expect(box.right).toBeCloseTo(0.75, 2)
    expect(box.top).toBeCloseTo(0.25, 2)
    expect(box.bottom).toBeCloseTo(0.5, 2)
    expect(exploredBox(new Uint8Array(FOG_SIZE * FOG_SIZE))).toBeNull()
  })
})

describe('markers', () => {
  const start: GameState = { source: 'save', purchased: [], spaceElevatorPhase: 0, spoilers: 'hide' }
  const everything: GameState = { ...start, purchased: schematics.map((s) => s.id), spaceElevatorPhase: 5 }
  const east = { left: 0.5, top: 0, right: 1, bottom: 1 }

  it('shows nothing without a save, and everything when asked', () => {
    expect(markers(worldMap, start, false)).toEqual([])
    expect(markers(worldMap, start, true)).toHaveLength(worldMap.nodes.length)
  })

  it('shows only nodes in explored ground', () => {
    const shown = markers(worldMap, { ...everything, map: saveMap(fogWith(east)) }, false)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.length).toBeLessThan(worldMap.nodes.length)
    for (const m of shown) expect(toUnit(worldMap, [m.node.x, m.node.y])[0]).toBeGreaterThanOrEqual(0.49)
  })

  it('hides what a node holds until the resource is unlocked', () => {
    const shown = markers(worldMap, { ...start, map: saveMap(fogWith(east)) }, false)
    expect(shown.find((m) => m.node.resource === 'Desc_OreIron_C')?.resource).toBe('Desc_OreIron_C')
    const uranium = shown.filter((m) => m.node.resource === 'Desc_OreUranium_C')
    for (const m of uranium) expect(m.resource).toBeNull()
    expect(shown.filter((m) => m.node.resource === 'Desc_SAM_C').every((m) => m.resource === null)).toBe(true)
  })

  it('marks nodes with an extractor on them', () => {
    const node = worldMap.nodes.find((n) => n.kind === 'node')!
    const shown = markers(worldMap, { ...everything, map: saveMap(fogWith({ left: 0, top: 0, right: 1, bottom: 1 }), [node.id]) }, false)
    expect(shown.find((m) => m.node.id === node.id)?.inUse).toBe(true)
    expect(shown.filter((m) => m.inUse)).toHaveLength(1)
  })

  it('knows geysers once geothermal power is unlocked', () => {
    expect(knowsResource(availability(start), 'Desc_Geyser_C')).toBe(false)
    expect(knowsResource(availability(everything), 'Desc_Geyser_C')).toBe(true)
  })
})
