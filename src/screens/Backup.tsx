import { useRef } from 'react'
import { exportAll, importAll } from '../storage/persisted'

export function Backup() {
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
      <h3>Backup</h3>
      <p className="muted">Data stays on this device. Export a file to move it to another browser or phone.</p>
      <div className="row">
        <button type="button" className="secondary" onClick={download}>
          Export
        </button>
        <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
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
