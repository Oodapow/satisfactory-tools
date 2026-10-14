import { useState, type InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  /** Undefined shows an empty field (with the placeholder). */
  value: number | undefined
  onChange: (value: number) => void
  /** How the value shows when the field isn't being edited. */
  format?: (value: number) => string
  /** Pass the number on only on blur or Enter, for edits that shouldn't run on every keystroke. */
  lazy?: boolean
}

const plain = (n: number) => String(Math.round(n * 10000) / 10000)

/**
 * A number field that can be empty while typing: clearing it and typing 125 gives 125, not
 * 0125. Every complete number is passed on as it's typed; on blur or Enter the field shows
 * the value again, so an empty field goes back to the last number. Escape drops the edit.
 */
export function NumberInput({ value, onChange, format = plain, lazy = false, onBlur, onKeyDown, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const valid = (text: string) => text.trim() !== '' && Number.isFinite(Number(text))
  const commit = () => {
    if (lazy && draft !== null && valid(draft)) onChange(Number(draft))
    setDraft(null)
  }
  return (
    <input
      {...rest}
      type="number"
      value={draft ?? (value === undefined || !Number.isFinite(value) ? '' : format(value))}
      onChange={(e) => {
        const text = e.target.value
        setDraft(text)
        if (!lazy && valid(text)) onChange(Number(text))
      }}
      onBlur={(e) => {
        commit()
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') setDraft(null)
        onKeyDown?.(e)
      }}
    />
  )
}
