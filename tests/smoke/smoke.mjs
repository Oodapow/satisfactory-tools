// Loads the production build the way GitHub Pages serves it (under /satisfactory-tools/) and
// fails if any screen comes up blank or throws. Run after `npm run build`: npm run test:smoke
import { readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../..', import.meta.url))
const dist = join(root, 'dist')
const fixtures = join(root, 'tests/smoke/fixtures')
const BASE = '/satisfactory-tools/'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' }

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (!path.startsWith(BASE)) return res.writeHead(404).end()
  let file = normalize(join(dist, path.slice(BASE.length)))
  if (!file.startsWith(dist)) return res.writeHead(403).end()
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html')
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((r) => server.listen(0, r))
const origin = `http://localhost:${server.address().port}${BASE}`

const legacy = JSON.parse(readFileSync(join(fixtures, 'storage-before-navigation.json'), 'utf8'))
const outpostIds = legacy['sft:outposts'].data.map((o) => o.id)
const env = (data) => ({ v: 1, data })

const routes = ['#/', '#/upload', '#/sample-save', '#/setup', '#/catalog', '#/outposts', '#/map', '#/world']
const scenarios = [
  { name: 'empty storage', storage: {}, routes },
  {
    name: 'data saved by an older version',
    storage: legacy,
    routes: [...routes, ...outpostIds.flatMap((id) => [`#/map/${id}`, `#/outposts/${id}/goal`, `#/outposts/${id}/plan`])],
  },
  {
    name: 'outposts from before plans existed',
    storage: {
      'sft:gameState': legacy['sft:gameState'],
      'sft:outposts': env([{ id: 'old-1', name: 'Old', target: { item: 'Desc_IronPlate_C', perMin: 30 }, choices: {} }]),
    },
    routes: [...routes, '#/map/old-1', '#/outposts/old-1/plan'],
  },
  // Broken data may land on the error screen, but must never leave the page empty.
  {
    name: 'corrupt storage',
    storage: { 'sft:gameState': env({ source: 'manual' }), 'sft:outposts': env('nope'), 'sft:node-editor': env(null) },
    routes,
    allowCrash: true,
  },
]

const browser = await chromium.launch()
const failures = []

for (const s of scenarios) {
  for (const route of s.routes) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.addInitScript((entries) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.clear()
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, JSON.stringify(v))
    }, s.storage)
    await page.goto(origin + route)
    await page.waitForTimeout(800)
    const text = (await page.textContent('#root'))?.trim() ?? ''
    const crashed = text.includes('Something went wrong')
    const problem =
      text.length < 40 ? 'blank page' : crashed && !s.allowCrash ? `error screen: ${text.slice(0, 160)}` : !s.allowCrash && errors.length ? `uncaught error: ${errors[0]}` : null
    console.log(`${problem ? 'FAIL' : 'ok  '} ${s.name} ${route}${problem ? ` (${problem})` : ''}`)
    if (problem) failures.push(`${s.name} ${route}: ${problem}`)
    await page.close()
  }
}

// Reading a real save runs the parser in a Web Worker, whose file must resolve under the Pages path.
{
  const page = await browser.newPage()
  await page.goto(origin + '#/upload')
  await page.setInputFiles('input[type=file]', join(fixtures, 'sample-1.2.sav'))
  const ok = await page.waitForSelector("text=Here's what we found", { timeout: 30000 }).then(() => true, () => false)
  console.log(`${ok ? 'ok  ' : 'FAIL'} upload sample-1.2.sav`)
  if (!ok) failures.push(`upload: ${(await page.textContent('#root'))?.trim().slice(0, 200)}`)
  await page.close()
}

await browser.close()
server.close()
if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
