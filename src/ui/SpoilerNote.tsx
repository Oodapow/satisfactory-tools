/**
 * The one spoiler toggle for lists that hide what the game would not show yet: a note at the
 * bottom of the list saying what is hidden, with "Show anyway", and "Hide spoilers" to undo it.
 * Spoilers are hidden by default; nothing is drawn when nothing is hidden.
 */
export function SpoilerNote({
  hidden,
  revealed,
  onChange,
}: {
  /** What is hidden, as a phrase such as "5 later tiers are". Empty or null when nothing is. */
  hidden: string | null
  revealed: boolean
  onChange: (revealed: boolean) => void
}) {
  if (!revealed && !hidden) return null
  return (
    <p className="spoiler-note">
      {revealed ? 'Showing everything, spoilers included.' : `${hidden} hidden to avoid spoilers.`}{' '}
      <button type="button" className="link" onClick={() => onChange(!revealed)}>
        {revealed ? 'Hide spoilers' : 'Show anyway'}
      </button>
    </p>
  )
}
