import { useState } from 'react'
import { schematicsById, type Schematic } from '../data'
import { go } from '../router'
import { gameStateFromSave, parseSave, type SaveImport, type SaveSummary } from '../save/parseSave'
import { currentTier, emptyGameState, throughTier, useGameState, type GameState } from '../state/gameState'

type Status =
  | { step: 'pick' }
  | { step: 'reading'; fileName: string; progress: number }
  | { step: 'failed'; fileName: string; message: string }
  | { step: 'done'; result: SaveImport; summary: SaveSummary }

export function Upload() {
  const [, setState] = useGameState()
  const [status, setStatus] = useState<Status>({ step: 'pick' })
  const [dragging, setDragging] = useState(false)

  const accept = (file: File | undefined) => {
    if (!file) return
    setStatus({ step: 'reading', fileName: file.name, progress: 0 })
    parseSave(file, (progress) => setStatus({ step: 'reading', fileName: file.name, progress }))
      .then((summary) => setStatus({ step: 'done', result: gameStateFromSave(summary, file.name), summary }))
      .catch((err: Error) => setStatus({ step: 'failed', fileName: file.name, message: err.message }))
  }

  if (status.step === 'reading') {
    return (
      <section className="panel">
        <h2>Reading {status.fileName}</h2>
        <progress className="save-progress" value={status.progress} max={1} />
        <p className="muted">Big saves take a few seconds. Everything stays on your device.</p>
      </section>
    )
  }

  if (status.step === 'done') {
    return (
      <UploadResult
        parsed={status.result.state}
        summary={status.summary}
        unknown={status.result.unknown}
        onUse={(s, next) => (setState(s), go(next))}
      />
    )
  }

  return (
    <section className="panel">
      <h2>Upload a save</h2>
      <p className="muted">
        On Windows, saves live in <code>%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\</code>. The file is read in your
        browser and never uploaded anywhere.
      </p>
      {status.step === 'failed' && (
        <p className="notice error" role="alert">
          Couldn't read <strong>{status.fileName}</strong>. Pick a save from Update 8 or 1.x; older saves and other
          files can't be read. <span className="muted">({status.message})</span>
        </p>
      )}
      <label
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          accept(e.dataTransfer.files[0])
        }}
      >
        <input type="file" accept=".sav" hidden onChange={(e) => accept(e.target.files?.[0])} />
        <strong>Drop your .sav file here</strong>
        <span className="muted">or click to choose one</span>
      </label>
      <button type="button" className="link" onClick={() => go('/sample-save')}>
        No save handy? Try a sample
      </button>
    </section>
  )
}

// A fixed mid-game state for trying the app without a save.
function sampleState(): GameState {
  const base = throughTier({ ...emptyGameState('save'), saveName: 'Sample Save.sav', spaceElevatorPhase: 1 }, 3)
  return {
    ...base,
    purchased: [
      ...base.purchased,
      'Research_Caterium_0_C',
      'Research_Caterium_1_C',
      'Research_HardDrive_0_C',
      'Schematic_Alternate_Screw_C',
      'Schematic_Alternate_IngotSteel1_C',
    ],
  }
}

export function SampleSave() {
  const [, setState] = useGameState()
  return <UploadResult parsed={sampleState()} onUse={(s, next) => (setState(s), go(next))} />
}

const playTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

function UploadResult({
  parsed,
  summary,
  unknown = [],
  onUse,
}: {
  parsed: GameState
  summary?: SaveSummary
  unknown?: string[]
  onUse: (s: GameState, next: string) => void
}) {
  const count = (...types: Schematic['type'][]) =>
    parsed.purchased.filter((id) => types.includes(schematicsById.get(id)?.type as Schematic['type'])).length
  return (
    <section className="panel">
      {!summary && <p className="notice">This is a made-up sample game, so you can look around without a save.</p>}
      <h2>Here's what we found</h2>
      <p className="muted">
        From <strong>{summary?.sessionName || parsed.saveName}</strong>
        {summary && <> · {playTime(summary.playSeconds)} played</>}
      </p>
      <dl className="facts">
        <div>
          <dt>Tier</dt>
          <dd>{Math.max(currentTier(parsed), 0)}</dd>
        </div>
        <div>
          <dt>Space Elevator</dt>
          <dd>Phase {parsed.spaceElevatorPhase}</dd>
        </div>
        <div>
          <dt>Milestones</dt>
          <dd>{count('milestone', 'tutorial')}</dd>
        </div>
        <div>
          <dt>MAM research</dt>
          <dd>{count('mam')}</dd>
        </div>
        <div>
          <dt>Alternate recipes</dt>
          <dd>{count('alternate')}</dd>
        </div>
        <div>
          <dt>AWESOME Shop</dt>
          <dd>{count('awesome-shop')}</dd>
        </div>
      </dl>
      {unknown.length > 0 && (
        <p className="muted">
          Skipped {unknown.length} unlock{unknown.length === 1 ? '' : 's'} we don't know
          {summary?.isModded ? ', probably from mods' : ''}.
        </p>
      )}
      <div className="row">
        <button type="button" onClick={() => onUse(parsed, '/map')}>
          Looks right, open the factory map
        </button>
        <button type="button" className="secondary" onClick={() => onUse(parsed, '/setup')}>
          Adjust by hand
        </button>
      </div>
    </section>
  )
}
