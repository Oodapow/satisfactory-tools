#!/usr/bin/env node
// Collects icons for every item and building in src/data/game/ into public/icons/<id>.webp
// and records them in src/data/game/icons.json. See data/README.md.
//
//   node scripts/fetch-icons.mjs                 fill in missing icons from all sources
//   node scripts/fetch-icons.mjs --dir <folder>  also use PNGs extracted from the game (named by id or texture)
//   node scripts/fetch-icons.mjs --force         re-fetch icons that already exist
//   node scripts/fetch-icons.mjs --check         verify icons.json and public/icons agree (no network)
//
// Sources, in order: --dir (the game's own textures), the Official Satisfactory Wiki,
// then a mirror of the wiki's icons that names files by game id.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'src/data/game')
const OUT = join(ROOT, 'public/icons')
const MANIFEST = join(DATA, 'icons.json')
const SIZE = 96

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const manifest = existsSync(MANIFEST) ? readJson(MANIFEST) : {}

if (flag('--check')) {
  const files = new Set(readdirSync(OUT).filter((f) => f.endsWith('.webp')))
  const problems = []
  for (const [id, entry] of Object.entries(manifest)) {
    if (!files.delete(entry.file)) problems.push(`icons.json lists ${id} but public/icons/${entry.file} is missing`)
  }
  for (const f of files) problems.push(`public/icons/${f} is not listed in icons.json`)
  for (const p of problems) console.error(p)
  console.log(`${Object.keys(manifest).length} icons`)
  process.exit(problems.length ? 1 : 0)
}

const { default: sharp } = await import('sharp')

const targets = [
  ...readJson(join(DATA, 'items.json')).map((i) => ({ id: i.id, name: i.name, texture: i.iconTexture, mirrorId: i.id })),
  ...readJson(join(DATA, 'buildings.json')).map((b) => ({ id: b.id, name: b.name, texture: b.iconTexture, mirrorId: b.buildClass })),
]

// PNGs extracted from the game (e.g. with satisfactory-icon-extractor), indexed by file name.
const localFiles = new Map()
const dir = option('--dir')
if (dir) {
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (extname(f).toLowerCase() === '.png') localFiles.set(basename(f, extname(f)).toLowerCase(), p)
    }
  }
  walk(dir)
}

const sources = [
  {
    name: 'game',
    get: async (t) => {
      const path = [t.id, t.texture].filter(Boolean).map((k) => localFiles.get(k.toLowerCase())).find(Boolean)
      return path ? readFileSync(path) : null
    },
  },
  {
    name: 'wiki',
    get: (t) => download(`https://satisfactory.wiki.gg/images/${encodeURIComponent(t.name.replace(/ /g, '_'))}.png`),
  },
  {
    name: 'wiki-mirror',
    get: (t) => t.mirrorId && download(`https://raw.githubusercontent.com/jdcravenBD/Satisfunction/main/public/icons/${t.mirrorId}.png`),
  },
]

const unreachable = new Set()
const reached = new Set()
async function download(url) {
  const host = new URL(url).host
  if (unreachable.has(host)) return null
  for (let attempt = 0; attempt < 4; attempt++) {
    let res
    try {
      res = await fetch(url)
    } catch {
      if (reached.has(host)) continue
      // Blocked or offline: stop trying this host for the rest of the run.
      unreachable.add(host)
      console.warn(`warning: cannot reach ${host}, skipping it`)
      return null
    }
    reached.add(host)
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }
    if (res.status === 403 && !res.headers.get('content-type')?.startsWith('image/')) {
      unreachable.add(host)
      console.warn(`warning: ${host} refused the request (403), skipping it`)
      return null
    }
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null
  }
  return null
}

mkdirSync(OUT, { recursive: true })
const missing = []
let added = 0
for (const t of targets) {
  if (manifest[t.id] && !flag('--force')) continue
  let done = false
  for (const source of sources) {
    const png = await source.get(t)
    if (!png) continue
    const file = `${t.id}.webp`
    await sharp(png).resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 85 }).toFile(join(OUT, file))
    manifest[t.id] = { file, source: source.name }
    added++
    done = true
    break
  }
  if (!done) missing.push(`${t.id} (${t.name})`)
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n')
console.log(`added ${added}, total ${Object.keys(sorted).length} of ${targets.length}, missing ${missing.length}`)
if (flag('--verbose')) for (const m of missing) console.log(`missing: ${m}`)
