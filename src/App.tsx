import { useRef, useState } from 'react'
import { useOutposts } from './outposts'
import { exportAll, importAll } from './storage/persisted'

const tools = [
  { name: 'Production Calculator', blurb: 'Machines and inputs needed for a target output rate.' },
  { name: 'Recipe Browser', blurb: 'Search items, alternates and what they unlock.' },
  { name: 'Power Planner', blurb: 'Balance generators against your factory draw.' },
]

function Outposts() {
  const { outposts, add, update, remove } = useOutposts()
  const [name, setName] = useState('')

  return (
    <section className="panel">
      <h2>Outposts</h2>
      <p className="muted">Saved in this browser, so they're still here next time you open the site.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          add(name.trim())
          setName('')
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New outpost name" />
        <button type="submit">Add</button>
      </form>
      {outposts.length === 0 && <p className="muted">No outposts yet.</p>}
      <ul className="list">
        {outposts.map((o) => (
          <li key={o.id} className="card">
            <input
              className="title-input"
              value={o.name}
              onChange={(e) => update(o.id, { name: e.target.value })}
              aria-label="Outpost name"
            />
            <textarea
              value={o.notes}
              onChange={(e) => update(o.id, { notes: e.target.value })}
              placeholder="Notes: resources, machines, power..."
              rows={3}
            />
            <div className="row">
              <button type="button" onClick={() => add(`${o.name} (copy)`, o)}>
                Duplicate
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => confirm(`Delete "${o.name}"?`) && remove(o.id)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Backup() {
  const fileRef = useRef<HTMLInputElement>(null)

  const download = () => {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `satisfactory-tools-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <section className="panel">
      <h2>Backup</h2>
      <p className="muted">Data stays on this device. Export a file to move it to another browser or phone.</p>
      <div className="row">
        <button type="button" onClick={download}>
          Export
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              importAll(JSON.parse(await file.text()))
            } catch (err) {
              alert(err instanceof Error ? err.message : 'Import failed')
            }
          }}
        />
      </div>
    </section>
  )
}

export default function App() {
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">FICSIT Inc. approved*</p>
        <h1>Satisfactory Tools</h1>
        <p className="lede">A small toolbox for planning factories. More coming soon.</p>
      </header>
      <Outposts />
      <section className="grid">
        {tools.map((t) => (
          <article key={t.name} className="card">
            <h2>{t.name}</h2>
            <p>{t.blurb}</p>
            <span className="badge">Coming soon</span>
          </article>
        ))}
      </section>
      <Backup />
      <footer className="foot">*not actually approved</footer>
    </main>
  )
}
