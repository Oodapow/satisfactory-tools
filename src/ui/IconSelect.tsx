import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GameIcon, NoIconLinks } from './GameIcon'
import { hide as hideTip, useTip } from './tooltip'

export type IconOption = {
  value: string
  label: string
  /** Item or building id whose icon is shown next to the label. */
  icon?: string
  /** Extra content after the label, such as a badge. */
  extra?: ReactNode
  group?: string
}

// Long lists get a filter box at the top.
const FILTER_FROM = 10

/** A dropdown like <select>, but each option shows its game icon. */
export function IconSelect({
  value,
  options,
  onChange,
  placeholder = 'Pick one',
  className,
  iconOnly = false,
  'aria-label': ariaLabel,
}: {
  value?: string
  options: IconOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  /** Show only the current option's icon (and extra); its label becomes a tooltip. The list keeps labels. */
  iconOnly?: boolean
  'aria-label'?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number }>()
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const current = options.find((o) => o.value === value)
  const tip = useTip(current?.label ?? placeholder, { tapShows: false })

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options
  }, [options, q])

  const place = () => {
    const r = button.current!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - 8
    const above = r.top - 8
    const width = Math.min(Math.max(r.width, 300), window.innerWidth - 16)
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setPos(
      below >= 240 || below >= above
        ? { left, width, top: r.bottom + 4, maxHeight: Math.min(360, below) }
        : { left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(360, above) },
    )
  }

  const openList = () => {
    hideTip()
    place()
    setQ('')
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const close = (focus = true) => {
    setOpen(false)
    if (focus) button.current?.focus()
  }
  const pick = (o: IconOption) => {
    if (o.value !== value) onChange(o.value)
    close()
  }

  // Close on outside clicks, and follow the button when the page scrolls.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!list.current?.contains(t) && !button.current?.contains(t)) close(false)
    }
    const onScroll = (e: Event) => !list.current?.contains(e.target as Node) && place()
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // Keep the highlighted option in view.
  useLayoutEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, shown.length - 1))
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
    else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(shown.length - 1)
    else if (e.key === 'Enter' && shown[active]) pick(shown[active])
    else if (e.key === 'Escape' || e.key === 'Tab') return close(e.key === 'Escape')
    else return
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`icon-select${iconOnly ? ' icon-only' : ''} ${className ?? ''}`}
        role="combobox"
        aria-label={iconOnly && current ? `${ariaLabel ?? ''}: ${current.label}` : ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onKeyDown={onKey}
        {...(iconOnly ? tip : {})}
        onClick={() => (open ? close() : openList())}
      >
        <NoIconLinks>{current?.icon && <GameIcon id={current.icon} size={22} />}</NoIconLinks>
        {!iconOnly && <span className="icon-select-label">{current?.label ?? placeholder}</span>}
        {!iconOnly && current?.extra}
        <span className="icon-select-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={list} className="icon-select-pop" style={pos}>
            {options.length >= FILTER_FROM && (
              <input
                autoFocus
                className="icon-select-filter"
                value={q}
                placeholder="Filter"
                aria-label="Filter options"
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKey}
              />
            )}
            <div id={listId} role="listbox" aria-label={ariaLabel} className="icon-select-list">
              <NoIconLinks>
                {shown.map((o, i) => {
                  const heading = o.group && o.group !== shown[i - 1]?.group ? o.group : undefined
                  return (
                    <div key={o.value} role="presentation">
                      {heading && <div className="icon-select-group">{heading}</div>}
                      <div
                        role="option"
                        data-index={i}
                        aria-selected={o.value === value}
                        className={i === active ? 'icon-select-option active' : 'icon-select-option'}
                        onPointerMove={() => setActive(i)}
                        onClick={() => pick(o)}
                      >
                        {o.icon && <GameIcon id={o.icon} size={22} />}
                        <span className="icon-select-label">{o.label}</span>
                        {o.extra}
                      </div>
                    </div>
                  )
                })}
              </NoIconLinks>
              {shown.length === 0 && <div className="icon-select-empty">No matches</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
