// Schematic symbols for logistics parts the game icon set doesn't cover. Drawn in
// currentColor so they follow the theme.

/** Conveyor Splitter: one belt in, up to three out. */
export function SplitterSymbol({ size = 22, flip = false }: { size?: number; flip?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M1 12h6M17 12h6M12 1v6M12 17v6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 9.5l3 2.5-3 2.5M9.5 4l2.5-3 2.5 3M9.5 20l2.5 3 2.5-3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** Conveyor Merger: up to three belts in, one out. */
export function MergerSymbol({ size = 22, flip = false }: { size?: number; flip?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M1 12h6M17 12h6M12 1v6M12 17v6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 9.5l3 2.5-3 2.5M9.5 4l2.5 3 2.5-3M9.5 20l2.5-3 2.5 3M1 9.5l3 2.5-3 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/** Conveyor Lift: carries a belt up or down between floors. */
export function LiftSymbol({ size = 16, down = false }: { size?: number; down?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={down ? { transform: 'scaleY(-1)' } : undefined}>
      <path d="M6 22V5M18 22V5" stroke="currentColor" strokeWidth="2" />
      <path d="M6 10h12M6 15h12M6 20h12" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 6l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

/** Pipeline Junction: four pipe connections, each in or out. */
export function JunctionSymbol({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M1 12h6M17 12h6M12 1v6M12 17v6" stroke="currentColor" strokeWidth="3" />
    </svg>
  )
}

/** Power pole: a mast with a lightning bolt. */
export function PoleSymbol({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 6v17M7 23h10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M13 1l-4 6h4l-2 5 5-7h-4z" fill="currentColor" />
    </svg>
  )
}
