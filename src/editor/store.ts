import { useCallback, useEffect, useRef, useState } from 'react'
import { buildings, recipes } from '../data'
import { blankPlan, newId } from '../plan/store'
import type { OutpostPlan } from '../plan/types'
import { usePersistentState } from '../storage/persisted'
import type { EditorLayout } from './model'

const EMPTY: EditorLayout = { positions: {}, powerLines: [], micro: {} }

/**
 * The editor's own state (positions, power lines, floor plans). Edits stay in memory
 * while dragging and are written to storage shortly after they stop, so dragging
 * doesn't serialise on every frame.
 */
export function useEditorLayout() {
  const [stored, setStored] = usePersistentState<EditorLayout>('node-editor', EMPTY)
  const [layout, setLayout] = useState<EditorLayout>({ ...EMPTY, ...stored })
  const pending = useRef<EditorLayout | null>(null)

  useEffect(() => {
    if (!pending.current) return
    const t = setTimeout(() => {
      if (pending.current) setStored(pending.current)
      pending.current = null
    }, 300)
    return () => clearTimeout(t)
  }, [layout, setStored])

  // Flush on unmount so a quick navigation away doesn't lose the last edit.
  useEffect(
    () => () => {
      if (pending.current) setStored(pending.current)
    },
    [setStored],
  )

  const update = useCallback((fn: (l: EditorLayout) => EditorLayout) => {
    setLayout((l) => {
      const next = fn(l)
      pending.current = next
      return next
    })
  }, [])

  return { layout, update }
}

/** Three outposts matching the planning example: 20 Reinforced Iron Plates from imported ore and screws. */
export function examplePlans(): { plans: OutpostPlan[]; layout: Partial<EditorLayout> } {
  const iron = blankPlan('Iron Fields', {
    goals: [{ kind: 'item', item: 'Desc_IronScrew_C', perMin: 120 }],
    nodes: [
      { id: newId(), resource: 'Desc_OreIron_C', purity: 'pure' },
      { id: newId(), resource: 'Desc_OreIron_C', purity: 'pure' },
    ],
  })
  const power = blankPlan('Coal Power', {
    goals: [{ kind: 'power', mw: 150, generator: 'Desc_GeneratorCoal_C', fuel: 'Desc_Coal_C' }],
    nodes: [{ id: newId(), resource: 'Desc_Coal_C', purity: 'normal' }],
  })
  const plates = blankPlan('Plate Works', {
    goals: [{ kind: 'item', item: 'Desc_IronPlateReinforced_C', perMin: 20 }],
    imports: [
      { id: newId(), from: iron.id, item: 'Desc_OreIron_C', perMin: 210, via: 'belt' },
      { id: newId(), from: iron.id, item: 'Desc_IronScrew_C', perMin: 120, via: 'truck' },
    ],
  })
  return {
    plans: [iron, power, plates],
    layout: {
      positions: { [iron.id]: { x: 0, y: 0 }, [power.id]: { x: 0, y: 340 }, [plates.id]: { x: 560, y: 140 } },
      powerLines: [
        { id: newId(), from: power.id, to: plates.id, mw: 100 },
        { id: newId(), from: power.id, to: iron.id, mw: 50 },
      ],
    },
  }
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)
const productionRecipes = recipes.filter((r) => r.kind === 'production' && r.producedIn.length > 0)
const producers = new Set(productionRecipes.flatMap((r) => r.producedIn))

/** Buildings for the palette: manufacturers that run recipes, and generators. */
export const machineBuildings = buildings.filter((b) => b.kind === 'manufacturer' && producers.has(b.id)).sort(byName)
export const generatorBuildings = buildings
  .filter((b) => b.kind === 'generator' && b.generator && b.generator.fuels.length > 0)
  .sort(byName)
export const recipesIn = (building: string) => productionRecipes.filter((r) => r.producedIn.includes(building)).sort(byName)
