// The factory map's power grid in numbers, for the side panel's widgets (#66).
// For now every outpost shares one grid.
import type { Solved } from '../plan/network'

const EPS = 1e-6

/** One grid's balance: what its generators make and what its machines use. */
export function gridBalance(all: Solved[]) {
  const made = all.reduce((t, s) => t + s.solution.power.generatedMW, 0)
  const used = all.reduce((t, s) => t + s.solution.power.consumedMW, 0)
  // Generators by type and fuel, across every outpost.
  const gens = new Map<string, { generator: string; fuel: string; count: number; mw: number }>()
  for (const s of all)
    for (const g of s.solution.generators) {
      const key = `${g.generator}|${g.fuel}`
      const x = gens.get(key) ?? { generator: g.generator, fuel: g.fuel, count: 0, mw: 0 }
      x.count += Math.ceil(g.machines - EPS)
      x.mw += g.mw
      gens.set(key, x)
    }
  const consumers = all
    .filter((s) => s.solution.power.consumedMW > EPS)
    .map((s) => ({ id: s.plan.id, name: s.plan.name, mw: s.solution.power.consumedMW, own: s.plan.selfPowered && s.solution.power.generatedMW > EPS }))
    .sort((a, b) => b.mw - a.mw)
  return { made, used, headroom: made - used, generators: [...gens.values()].sort((a, b) => b.mw - a.mw), consumers }
}

