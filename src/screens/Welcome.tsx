import { go } from '../router'
import { currentTier, emptyGameState, useGameState } from '../state/gameState'

export function Welcome() {
  const [state, setState] = useGameState()

  return (
    <section className="welcome">
      <header className="hero">
        <p className="eyebrow">FICSIT Inc. approved*</p>
        <h1>Plan your next outpost</h1>
        <p className="lede">
          Tell us how far you've got, and we'll only show what you've unlocked. No spoilers.
        </p>
      </header>

      {state && (
        <button type="button" className="choice choice-continue" onClick={() => go('/plan')}>
          <span className="choice-title">Continue planning</span>
          <span className="choice-body">
            Tier {Math.max(currentTier(state), 0)} · Space Elevator phase {state.spaceElevatorPhase}
            {state.source === 'save' && state.saveName ? ` · from ${state.saveName}` : ''}
          </span>
        </button>
      )}

      <div className="choices">
        <button type="button" className="choice" onClick={() => go('/upload')}>
          <span className="choice-icon" aria-hidden>
            ⇪
          </span>
          <span className="choice-title">Upload a save</span>
          <span className="choice-body">
            Pick your <code>.sav</code> file and we read your milestones, research and hard drives from it.
          </span>
        </button>
        <button
          type="button"
          className="choice"
          onClick={() => {
            if (!state) setState(emptyGameState())
            go('/setup')
          }}
        >
          <span className="choice-icon" aria-hidden>
            ✎
          </span>
          <span className="choice-title">Set it up by hand</span>
          <span className="choice-body">Tick off the tiers and milestones you've finished. Takes a minute.</span>
        </button>
      </div>
      <p className="muted small">Everything stays in this browser. Nothing is uploaded anywhere.</p>
    </section>
  )
}
