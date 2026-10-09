#!/usr/bin/env node
// Downloads the in-game map from the Official Satisfactory Wiki and cuts it into what the world
// map screen loads: a small overview for zoomed-out views and full-resolution detail tiles that
// load as you zoom in. See data/README.md.
//
//   node scripts/fetch-map.mjs                  download File:Map.jpg from the wiki
//   node scripts/fetch-map.mjs --from <image>   use a local copy instead (e.g. extracted from the game)
//
// The image must cover the map bounds in src/data/game/world-map.json (a square, north up).
// Writes public/map/overview.webp and public/map/tiles/<row>-<col>.webp (TILES × TILES of them).

import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public/map')
const WIKI = 'https://satisfactory.wiki.gg/images/Map.jpg'
// Keep in step with src/data/game/worldMap.ts.
const OVERVIEW = 2048
const TILES = 4

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
rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'tiles'), { recursive: true })

let total = 0
total += (await sharp(input).resize(OVERVIEW, OVERVIEW).webp({ quality: 80 }).toFile(join(OUT, 'overview.webp'))).size
// Tiles cover equal fractions of the map; edges are rounded so they meet without gaps.
const edge = (i) => Math.round((i * width) / TILES)
for (let r = 0; r < TILES; r++) {
  for (let c = 0; c < TILES; c++) {
    const region = { left: edge(c), top: edge(r), width: edge(c + 1) - edge(c), height: edge(r + 1) - edge(r) }
    total += (await sharp(input).extract(region).webp({ quality: 88 }).toFile(join(OUT, 'tiles', `${r}-${c}.webp`))).size
  }
}
console.log(`Wrote public/map/ (${OVERVIEW}px overview + ${TILES}×${TILES} tiles of ${Math.round(width / TILES)}px, ${Math.round(total / 1024)} KB) from ${from ?? WIKI}`)
