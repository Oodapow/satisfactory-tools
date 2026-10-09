import { describe, expect, it } from 'vitest'

// An effect written as `useEffect(() => something(), deps)` returns whatever something()
// returns, and React calls that as the cleanup. When it isn't a function the page crashes:
// newer Chrome made scrollTo return a promise, which blanked the whole site (#36).
// Effects must have a block body or return a cleanup function explicitly.
const sources = import.meta.glob<string>('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

describe('effects', () => {
  it('never return the value of an expression body', () => {
    const offenders = Object.entries(sources).flatMap(([file, text]) =>
      text
        .split('\n')
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        // `() => () => ...` (returning a cleanup) and `() => {` are fine; comments don't count.
        .filter(({ line }) => !line.trim().startsWith('//') && /use(Layout|Insertion)?Effect\(\s*(async\s*)?\(\)\s*=>\s*(?!\{|\(\)\s*=>)\S/.test(line))
        .map(({ at }) => at),
    )
    expect(Object.keys(sources).length).toBeGreaterThan(20)
    expect(offenders).toEqual([])
  })
})
