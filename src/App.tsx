import { gameMeta } from './data'
import { go, useRoute } from './router'
import { OutpostEditor, OutpostList } from './screens/Outposts'
import { Planner } from './screens/Planner'
import { Setup } from './screens/Setup'
import { SampleSave, Upload } from './screens/Upload'
import { Welcome } from './screens/Welcome'
import { currentTier, useGameState } from './state/gameState'

const steps = [
  { path: 'setup', label: 'Game state' },
  { path: 'plan', label: 'Planning' },
  { path: 'outposts', label: 'Outposts' },
] as const

export default function App() {
  const [page, param, sub] = useRoute()
  const [state] = useGameState()

  // Planning needs a game state; without one, start at the welcome screen.
  const needsState = page === 'plan' || page === 'outposts'
  const screen =
    !page || (needsState && !state) ? (
      <Welcome />
    ) : page === 'upload' ? (
      <Upload />
    ) : page === 'sample-save' ? (
      <SampleSave />
    ) : page === 'setup' ? (
      <Setup />
    ) : page === 'plan' && state ? (
      <Planner state={state} />
    ) : page === 'outposts' && state && param ? (
      <OutpostEditor id={param} step={sub} state={state} />
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
          <nav className="steps" aria-label="Steps">
            {steps.map((s, i) => (
              <a key={s.path} href={`#/${s.path}`} className={page === s.path ? 'step active' : 'step'}>
                <span className="step-num">{i + 1}</span>
                {s.label}
              </a>
            ))}
          </nav>
        )}
        {state && (
          <span className="chip" title="Your game state">
            Tier {Math.max(currentTier(state), 0)} · {state.source === 'save' ? 'from save' : 'manual'}
          </span>
        )}
      </header>
      <main className="page">{screen}</main>
      <footer className="foot page">*not actually approved · Game data: Satisfactory {gameMeta.gameVersion}</footer>
    </div>
  )
}
