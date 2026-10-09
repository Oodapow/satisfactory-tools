#!/usr/bin/env node
// Downloads the in-game map from the Official Satisfactory Wiki and writes public/map/world.webp,
// the background of the world map screen. See data/README.md.
//
//   node scripts/fetch-map.mjs                  download File:Map.jpg from the wiki
//   node scripts/fetch-map.mjs --from <image>   use a local copy instead (e.g. extracted from the game)
//
// The image must cover the map bounds in src/data/game/world-map.json (a square, north up).

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public/map/world.webp')
const SIZE = 4096
const WIKI = 'https://satisfactory.wiki.gg/images/Map.jpg'

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
mkdirSync(dirname(OUT), { recursive: true })
const info = await sharp(input).resize(SIZE, SIZE).webp({ quality: 78 }).toFile(OUT)
console.log(`Wrote public/map/world.webp (${SIZE}px, ${Math.round(info.size / 1024)} KB) from ${from ?? WIKI}`)
