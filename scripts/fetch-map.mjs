#!/usr/bin/env node
// Downloads the in-game map from the Official Satisfactory Wiki and cuts it into what the world
// map screen loads: a small base picture shown at once, and a pyramid of tiles per zoom level that
// load around the view as you pan and zoom. See data/README.md.
//
//   node scripts/fetch-map.mjs                  download File:Map.jpg from the wiki
//   node scripts/fetch-map.mjs --from <image>   use a local copy instead (e.g. extracted from the game)
//
// The image must cover the map bounds in src/data/game/world-map.json (a square, north up).
// Writes public/map/base.webp and public/map/<level>/<row>-<col>.webp.

import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public/map')
const WIKI = 'https://satisfactory.wiki.gg/images/Map.jpg'
// Keep in step with worldMapTiles in src/data/game/worldMap.ts.
const BASE = 512
const TILE = 512
/** Each tile reaches this many pixels into its neighbours, so they meet without seams. */
const OVERLAP = 2
/** Level sizes in px, coarsest first; the last is the source's own resolution. */
const LEVELS = [625, 1250, 2500, 5000]

const args = process.argv.slice(2)
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : undefined

let input
if (from) {
  input = readFileSync(from)
} else {
  const res = await fetch(WIKI, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`${WIKI}: HTTP ${res.status}`)
  input = Buffer.from(await res.arrayBuffer())
}

const { width, height } = await sharp(input).metadata()
if (width !== height) throw new Error(`Expected a square map image, got ${width}×${height}`)
if (width !== LEVELS.at(-1)) throw new Error(`Expected a ${LEVELS.at(-1)} px map image, got ${width} px; update LEVELS here and in worldMap.ts`)
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

let total = 0
let count = 0
total += (await sharp(input).resize(BASE, BASE).webp({ quality: 75 }).toFile(join(OUT, 'base.webp'))).size
for (const [level, size] of LEVELS.entries()) {
  mkdirSync(join(OUT, String(level)))
  const img = await sharp(input).resize(size, size).raw().toBuffer({ resolveWithObject: true })
  const n = Math.ceil(size / TILE)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const left = Math.max(0, c * TILE - OVERLAP), top = Math.max(0, r * TILE - OVERLAP)
      const right = Math.min(size, (c + 1) * TILE + OVERLAP), bottom = Math.min(size, (r + 1) * TILE + OVERLAP)
      const tile = sharp(img.data, { raw: img.info }).extract({ left, top, width: right - left, height: bottom - top })
      total += (await tile.webp({ quality: 82 }).toFile(join(OUT, String(level), `${r}-${c}.webp`))).size
      count++
    }
  }
}
console.log(`Wrote public/map/ (${BASE}px base + ${count} tiles over ${LEVELS.length} levels, ${Math.round(total / 1024)} KB) from ${from ?? WIKI}`)
