import { useState } from 'react'
import { schematicsById, type Schematic } from '../data'
import { go } from '../router'
import { currentTier, emptyGameState, throughTier, useGameState, type GameState } from '../state/gameState'

// Save parsing isn't built yet: this screen shows the intended flow with a
// fixed sample result, so the next step can be designed against it.
function mockParse(fileName: string): GameState {
  const base = throughTier({ ...emptyGameState('save'), saveName: fileName, spaceElevatorPhase: 1 }, 3)
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

export function Upload() {
  const [, setState] = useGameState()
  const [parsed, setParsed] = useState<GameState | null>(null)
  const [dragging, setDragging] = useState(false)

  const accept = (file: File | undefined) => file && setParsed(mockParse(file.name))

  if (!parsed) {
    return (
      <section className="panel">
        <h2>Upload a save</h2>
        <p className="muted">
          On Windows, saves live in <code>%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\</code>.
        </p>
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

  return <UploadResult parsed={parsed} onUse={(s, next) => (setState(s), go(next))} />
}

export function SampleSave() {
  const [, setState] = useGameState()
  return <UploadResult parsed={mockParse('Sample Save.sav')} onUse={(s, next) => (setState(s), go(next))} />
}

function UploadResult({ parsed, onUse }: { parsed: GameState; onUse: (s: GameState, next: string) => void }) {
  const count = (...types: Schematic['type'][]) =>
    parsed.purchased.filter((id) => types.includes(schematicsById.get(id)?.type as Schematic['type'])).length
  return (
    <section className="panel">
      <p className="notice">Preview: save parsing isn't built yet, so this shows sample results.</p>
      <h2>Here's what we found</h2>
      <p className="muted">
        From <strong>{parsed.saveName}</strong>
      </p>
      <dl className="facts">
        <div>
          <dt>Tier</dt>
          <dd>{currentTier(parsed)}</dd>
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
      </dl>
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
