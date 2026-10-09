// Parses a save off the main thread: large saves take seconds and hundreds of MB.
import { readSave, type SaveSummary } from './readSave'

export type SaveWorkerRequest = { name: string; file: ArrayBuffer }
export type SaveWorkerResponse =
  | { type: 'progress'; progress: number }
  | { type: 'done'; summary: SaveSummary }
  | { type: 'error'; message: string }

const post = (msg: SaveWorkerResponse) => self.postMessage(msg)

self.onmessage = (e: MessageEvent<SaveWorkerRequest>) => {
  try {
    let last = -1
    const summary = readSave(e.data.name, e.data.file, (progress) => {
      // The parser reports very often; pass on whole percents only.
      const pct = Math.floor(progress * 100)
      if (pct > last) post({ type: 'progress', progress: (last = pct) / 100 })
    })
    post({ type: 'done', summary })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
