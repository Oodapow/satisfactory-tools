import type { ReactNode } from 'react'
import { useTip } from './tooltip'

/**
 * A small "?" that shows `text` as a tooltip. Explanations go here, beside the heading
 * they explain, instead of as a paragraph on the page.
 */
export function Help({ text }: { text: string }) {
  const tip = useTip(text, { tapShows: true })
  return (
    <span className="help" role="img" aria-label={text} tabIndex={0} {...tip}>
      ?
    </span>
  )
}

/** Any small mark (a ★, a count) whose meaning is a tooltip rather than words on the page. */
export function WithTip({ text, className, children }: { text: string; className?: string; children: ReactNode }) {
  const tip = useTip(text, { tapShows: true })
  return (
    <span className={className} role="img" aria-label={text} {...tip}>
      {children}
    </span>
  )
}
