import { lazy, Suspense } from 'react'
import { gameMeta } from './data'
import { go, useRoute } from './router'
import { OutpostEditor, OutpostList } from './screens/Outposts'
import { Planner } from './screens/Planner'
import { Setup } from './screens/Setup'
import { SampleSave, Upload } from './screens/Upload'
import { Welcome } from './screens/Welcome'
import { currentTier, useGameState } from './state/gameState'
import { TooltipLayer } from './ui/TooltipLayer'

// The node editor pulls in React Flow, so it loads on first visit.
const EditorScreen = lazy(() => import('./editor/EditorScreen'))

// Sections, not steps: the main flow is game state, then the factory map. The catalog is for
// looking things up, and the outposts list is where one outpost gets defined.
const tabs = [
  { path: 'setup', label: 'Game state' },
  { path: 'map', label: 'Factory map' },
  { path: 'outposts', label: 'Outposts' },
  { path: 'catalog', label: 'Catalog' },
] as const

export default function App() {
  const [route, param, sub] = useRoute()
  const [state] = useGameState()
  // "#/plan" was the catalog's old address; keep old links working.
  const page = route === 'plan' ? 'catalog' : route

  // These need a game state; without one, start at the welcome screen.
  const needsState = page === 'catalog' || page === 'outposts' || page === 'map'
  const screen =
    !page || (needsState && !state) ? (
      <Welcome />
    ) : page === 'upload' ? (
      <Upload />
    ) : page === 'sample-save' ? (
      <SampleSave />
    ) : page === 'setup' ? (
      <Setup />
    ) : page === 'catalog' && state ? (
      <Planner key={`${param}/${sub}`} state={state} kind={param} query={sub && decodeURIComponent(sub)} />
    ) : page === 'outposts' && state && param ? (
      <OutpostEditor id={param} step={sub} state={state} />
    ) : page === 'map' && state ? (
      <Suspense fallback={<p className="muted">Loading the editor…</p>}>
        <EditorScreen state={state} outpostId={param} />
      </Suspense>
    ) : page === 'outposts' && state ? (
      <OutpostList state={state} />
    ) : (
      <Welcome />
    )

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => go('/')}>
          Satisfactory Tools
        </button>
        {state && (
          <nav className="nav-tabs" aria-label="Sections">
            {tabs.map((t) => (
              <a key={t.path} href={`#/${t.path}`} className={page === t.path ? 'nav-tab active' : 'nav-tab'} aria-current={page === t.path ? 'page' : undefined}>
                {t.label}
              </a>
            ))}
          </nav>
        )}
        {state && (
          <a className="chip" href="#/setup" title="Your game state">
            Tier {Math.max(currentTier(state), 0)} · {state.source === 'save' ? 'from save' : 'manual'}
          </a>
        )}
      </header>
      <main className="app-main">
        <div className={page === 'map' ? 'page-wide' : 'page'}>{screen}</div>
      </main>
      <TooltipLayer />
      <footer className="foot">*not actually approved · Game data: Satisfactory {gameMeta.gameVersion}</footer>
    </div>
  )
}
