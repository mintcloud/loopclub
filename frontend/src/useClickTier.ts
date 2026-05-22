import { useCallback, useEffect, useRef } from 'react'
import type { CellTier } from './config'

// How long we wait after a click before settling the tier. The third click
// fires immediately, so this only bounds the single-vs-double resolution.
export const CLICK_TIER_WINDOW_MS = 240

// Resolves rapid clicks on a target id into a tier — 1 click = try, 2 = toggle,
// 3+ = max. One sequence is tracked at a time (a mouse has one cursor), and a
// click on a different target dispatches the prior sequence first. Used by both
// the grid cells and the popover's piano keys so the 1/2/3-click gesture
// behaves identically wherever a sound can be triggered.
export function useClickTier(onTier: (id: number, tier: CellTier) => void) {
  const seq = useRef<{ id: number; count: number; timer: number } | null>(null)
  // Keep the callback fresh so a tier settled after a prop change still
  // dispatches against current state (e.g. audition lock toggled mid-sequence).
  const onTierRef = useRef(onTier)
  useEffect(() => {
    onTierRef.current = onTier
  }, [onTier])

  const flush = useCallback(() => {
    const c = seq.current
    if (!c) return
    clearTimeout(c.timer)
    seq.current = null
    const tier: CellTier = c.count >= 3 ? 'max' : c.count === 2 ? 'toggle' : 'try'
    onTierRef.current(c.id, tier)
  }, [])

  useEffect(() => {
    return () => {
      if (seq.current) clearTimeout(seq.current.timer)
    }
  }, [])

  const click = useCallback(
    (id: number) => {
      // A click on a different target dispatches the prior sequence first.
      if (seq.current && seq.current.id !== id) flush()

      const existing = seq.current
      if (existing && existing.id === id) {
        clearTimeout(existing.timer)
        const count = existing.count + 1
        if (count >= 3) {
          // No point waiting for a fourth click — fire the max tier now.
          seq.current = { ...existing, count }
          flush()
          return
        }
        seq.current = { id, count, timer: window.setTimeout(flush, CLICK_TIER_WINDOW_MS) }
      } else {
        seq.current = { id, count: 1, timer: window.setTimeout(flush, CLICK_TIER_WINDOW_MS) }
      }
    },
    [flush],
  )

  // Whether a sequence is currently buffering — the grid uses this to suppress
  // the hover popover while the user is mid-gesture.
  const isPending = useCallback(() => seq.current !== null, [])

  return { click, isPending }
}
