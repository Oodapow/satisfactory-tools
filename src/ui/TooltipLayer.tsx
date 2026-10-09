import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { currentTip, hide, subscribe } from './tooltip'

/** Renders the tooltip. Mount once, near the app root. */
export function TooltipLayer() {
  const current = useSyncExternalStore(subscribe, currentTip)
  useEffect(() => {
    if (!current) return
    // Anything that moves the page out from under the tooltip hides it.
    const off = () => hide()
    const onDown = (e: PointerEvent) => e.pointerType !== 'mouse' && hide()
    window.addEventListener('scroll', off, true)
    window.addEventListener('resize', off)
    window.addEventListener('hashchange', off)
    window.addEventListener('wheel', off, { passive: true })
    const t = window.setTimeout(() => window.addEventListener('pointerdown', onDown), 0)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('scroll', off, true)
      window.removeEventListener('resize', off)
      window.removeEventListener('hashchange', off)
      window.removeEventListener('wheel', off)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [current])
  const box = useRef<HTMLDivElement>(null)
  // Centre on the icon, but keep the whole tooltip on screen.
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !current) return
    const w = el.offsetWidth
    el.style.left = `${Math.min(Math.max(current.x - w / 2, 8), window.innerWidth - w - 8)}px`
  }, [current])
  if (!current) return null
  const above = current.top > 40
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className={above ? 'tip above' : 'tip below'}
      style={{ left: current.x, top: above ? current.top - 6 : current.bottom + 6 }}
    >
      {current.text}
    </div>,
    document.body,
  )
}
