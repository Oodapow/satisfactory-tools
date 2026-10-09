import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'

// One tooltip for the whole app, drawn by <TooltipLayer> in a portal so cards, scroll areas and the
// zoomed map canvas cannot clip it. Mouse shows it on hover, keyboard on focus,
// touch on long-press (or a tap, for icons that are not links).
export type Tip = { text: string; x: number; top: number; bottom: number }
let tip: Tip | null = null
export const currentTip = () => tip
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function show(text: string, el: Element) {
  const r = el.getBoundingClientRect()
  tip = { text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom }
  emit()
}
export function hide() {
  if (!tip) return
  tip = null
  emit()
}

const LONG_PRESS_MS = 450

/** Pointer, focus and click handlers that show `text` as a tooltip on the element. */
export function useTip(text: string, { tapShows }: { tapShows: boolean }) {
  const timer = useRef<number | undefined>(undefined)
  const pressed = useRef(false)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return {
    onPointerEnter: (e: ReactPointerEvent) => e.pointerType === 'mouse' && show(text, e.currentTarget),
    onPointerLeave: (e: ReactPointerEvent) => e.pointerType === 'mouse' && hide(),
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse') return
      const el = e.currentTarget
      pressed.current = false
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        pressed.current = true
        show(text, el)
      }, LONG_PRESS_MS)
    },
    onPointerUp: () => window.clearTimeout(timer.current),
    onPointerCancel: () => window.clearTimeout(timer.current),
    onFocus: (e: SyntheticEvent) => show(text, e.currentTarget),
    onBlur: hide,
    // A long-press only shows the name; it should not also follow the link.
    onClickCapture: (e: SyntheticEvent) => {
      if (pressed.current) {
        e.preventDefault()
        e.stopPropagation()
        pressed.current = false
      } else if (tapShows) {
        show(text, e.currentTarget)
      }
    },
    onContextMenu: (e: SyntheticEvent) => pressed.current && e.preventDefault(),
  }
}
