import { Component, type ReactNode } from 'react'
import { downloadBackup, resetAll } from '../storage/persisted'

/**
 * Last line of defence: if anything throws while rendering, show what happened and a way out
 * instead of an empty page. Saved data from an older version is the usual suspect, so the
 * screen offers to download a backup and then reset it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; page?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Satisfactory Tools crashed:', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const screen = (
      <section className="panel crash" role="alert">
        <h2>Something went wrong</h2>
        <p>
          The page hit an error and stopped. Reloading often fixes it. If it keeps happening, saved data from an
          older version may be the cause: download a backup first, then reset.
        </p>
        <pre className="crash-detail">{error.message || String(error)}</pre>
        <div className="row">
          <button type="button" onClick={() => location.reload()}>
            Reload
          </button>
          <button type="button" className="secondary" onClick={downloadBackup}>
            Download backup
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (!confirm('Delete your game state, outposts and map from this browser?')) return
              resetAll()
              location.hash = '#/'
              location.reload()
            }}
          >
            Reset saved data
          </button>
        </div>
    </section>
    )
    // At the top level there is no page layout around it, so bring one.
    return this.props.page ? <div className="page">{screen}</div> : screen
  }
}
