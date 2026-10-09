#!/usr/bin/env node
// Collects icons for every item and building in src/data/game/ into public/icons/<id>.webp
// and records them in src/data/game/icons.json. See data/README.md.
//
//   node scripts/fetch-icons.mjs                 fill in missing icons from all sources
//   node scripts/fetch-icons.mjs --dir <folder>  also use PNGs extracted from the game (named by id or texture)
//   node scripts/fetch-icons.mjs --force         re-fetch icons that already exist
//   node scripts/fetch-icons.mjs --check         verify icons.json and public/icons agree (no network)
//
// Sources, in order: --dir (the game's own textures), the Official Satisfactory Wiki (matched by wiki name),
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
    get: async (t) => {
      for (const file of await wikiFiles(t)) {
        const png = await download(`${WIKI}/images/${encodeURIComponent(file)}`)
        if (png) return png
      }
      return null
    },
  },
  {
    name: 'wiki-mirror',
    get: (t) => t.mirrorId && download(`https://raw.githubusercontent.com/jdcravenBD/Satisfunction/main/public/icons/${t.mirrorId}.png`),
  },
]

// The wiki names architecture icons by shape, size and material ("Inv._Ramp_2m_(Coated).png") rather
// than by the in-game name, which repeats across materials. Its Template:Docs*.json pages give each
// class name its wiki name ("Inverted Ramp (2 m) (Polished)"); with the list of uploaded files that
// is enough to find the icon for each variant.
const WIKI = 'https://satisfactory.wiki.gg'
const MATERIALS = {
  asphalt: ['Asphalt'],
  concrete: ['Concrete'],
  polished: ['Coated'],
  concretepolished: ['Coated'],
  polishedconcrete: ['Coated'],
  grip: ['Grip Metal'],
  gripmetal: ['Grip Metal'],
  metal: ['Grip Metal', 'Steel', 'Metal'],
  steel: ['Steel'],
  tar: ['Tar'],
  window: ['Glass', 'FICSIT'],
  ficsit: ['FICSIT'],
  ficsitset: ['FICSIT'],
  orange: ['FICSIT'],
}
const SHAPES = {
  'Foundation Stairs': ['Foundation Stair'],
  'Straight Walkway': ['Walkway Straight'],
  'Walkway Intersection': ['Walkway Crossing'],
  'Walkway T-Junction': ['Walkway T-Crossing'],
  'Walkway Corner': ['Walkway Turn'],
  'FICSMAS Candy Cane': ['Candy Cane'],
  'FICSMAS Snowman': ['Snowman'],
}

let wikiIndex
async function loadWikiIndex() {
  const api = async (params) => {
    const res = await download(`${WIKI}/api.php?${new URLSearchParams({ format: 'json', ...params })}`)
    return res && JSON.parse(res.toString())
  }
  const files = new Map()
  let more = {}
  do {
    const page = await api({ action: 'query', list: 'allimages', ailimit: '500', ...more })
    if (!page?.query) return { files, names: new Map() }
    for (const image of page.query.allimages) files.set(image.name.toLowerCase(), image.name)
    more = page.continue ?? null
  } while (more)
  const names = new Map()
  for (const template of ['DocsBuildings.json', 'DocsItems.json']) {
    const raw = await download(`${WIKI}/index.php?${new URLSearchParams({ title: `Template:${template}`, action: 'raw' })}`)
    if (!raw) continue
    for (const [id, versions] of Object.entries(JSON.parse(raw.toString()))) names.set(id, versions.at(-1).name)
  }
  return { files, names }
}

async function wikiFiles(t) {
  wikiIndex ??= await loadWikiIndex()
  const { files, names } = wikiIndex
  const candidates = []
  for (const name of [names.get(t.id), t.name]) {
    if (name) candidates.push(...wikiCandidates(t.id, name))
  }
  const known = candidates.map((c) => files.get(`${c.replace(/ /g, '_')}.png`.toLowerCase())).filter(Boolean)
  // Without the file list (API unreachable), fall back to guessing the file from the display name.
  return [...new Set(files.size ? known : [`${t.name.replace(/ /g, '_')}.png`])]
}

function wikiCandidates(id, fullName) {
  let name = fullName.replace(/ (?=\d)/g, '').replace(/ /g, ' ').replace(/™/g, '')
  let material
  const mat = name.match(/ \(([A-Za-z ]+)\)$/)
  if (mat) {
    material = mat[1].toLowerCase().replace(/ /g, '')
    name = name.slice(0, mat.index)
  }
  material ??= id.toLowerCase().split('_').find((part) => part in MATERIALS)
  let size
  const sized = name.match(/ \((\d+(?:\.\d+)?) ?m\)/)
  if (sized) {
    size = sized[1]
    name = name.slice(0, sized.index) + name.slice(sized.index + sized[0].length)
  }
  name = name.replace(/ Day \d+$/, '').trim()
  const shapes = [name, ...(SHAPES[name] ?? []), ...(name.startsWith('Inverted ') ? [`Inv. ${name.slice(9)}`] : [])]
  const out = []
  for (const shape of shapes) {
    for (const m of MATERIALS[material] ?? ['FICSIT']) {
      if (shape === 'Roof') out.push(`${m} Roof ${size}m`)
      if (shape === 'Flat Roof') out.push(`${m} Roof Flat`)
      if (size) out.push(`${shape} ${size}m (${m})`)
      out.push(`${shape} (${m})`)
    }
    if (size) out.push(`${shape} ${size}m`)
    out.push(shape)
  }
  return out
}

const unreachable = new Set()
const reached = new Set()
async function download(url) {
  const host = new URL(url).host
  if (unreachable.has(host)) return null
  for (let attempt = 0; attempt < 4; attempt++) {
    let res
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
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
