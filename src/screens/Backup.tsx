import { useRef } from 'react'
import { downloadBackup, importAll } from '../storage/persisted'
import { Help } from '../ui/Help'

export function Backup() {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <section className="panel">
      <h3>
        Backup
        <Help text="Data stays on this device. Export a file to move it to another browser or phone." />
      </h3>
      <div className="row">
        <button type="button" className="secondary" onClick={downloadBackup}>
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
