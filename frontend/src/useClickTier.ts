import { useCallback, useEffect, useRef } from 'react'
import type { CellTier } from './config'

// How long we wait after a click before settling a 2-click 'toggle'. This must
// be generous enough to span a real human double-click: OS double-click
// thresholds run 400–500ms, and the old 240ms window meant a deliberate
// double-click frequently split into two separate single clicks — i.e. two
// 'try's and no toggle ("double click does nothing"). The 'try' tier no longer
// waits on this window (it fires on the first click, see below), so widening it
// costs nothing on the common path — it only delays the toggle commit, which is
// an async on-chain op anyway.
export const CLICK_TIER_WINDOW_MS = 420

// Resolves rapid clicks on a target id into a tier — 1 click = try, 2 = toggle,
// 3+ = max. One sequence is tracked at a time (a mouse has one cursor), and a
// click on a different target dispatches the prior sequence first. Used by both
// the grid cells and the popover's piano keys so the 1/2/3-click gesture
// behaves identically wherever a sound can be triggered.
//
// 'try' fires immediately on the first click — auditioning a sound is
// non-committal (no rent, no transaction), so there is no reason to make the
// user wait out the window to hear it. Only 'toggle' has to wait, because it
// can't commit until we know the gesture won't escalate to a triple-click
// 'max'. 'max' fires immediately on the third click.
export function useClickTier(onTier: (id: number, tier: CellTier) => void) {
  // count is how many clicks have landed on `id` so far; `timer` settles a
  // pending 2-click toggle once the window lapses without a third click.
  const seq = useRef<{ id: number; count: number; timer: number } | null>(null)
  // Keep the callback fresh so a tier settled after a prop change still
  // dispatches against current state (e.g. audition lock toggled mid-sequence).
  const onTierRef = useRef(onTier)
  useEffect(() => {
    onTierRef.current = onTier
  }, [onTier])

  // Settle a sequence that stalled at 2 clicks → that's a 'toggle'. A sequence
  // that stalled at 1 click needs nothing here: its 'try' already fired on the
  // click itself.
  const settle = useCallback(() => {
    const c = seq.current
    if (!c) return
    clearTimeout(c.timer)
    seq.current = null
    if (c.count >= 2) onTierRef.current(c.id, 'toggle')
  }, [])

  useEffect(() => {
    return () => {
      if (seq.current) clearTimeout(seq.current.timer)
    }
  }, [])

  const click = useCallback(
    (id: number) => {
      // A click on a different target settles the prior sequence first (so a
      // half-finished double-click on cell A commits as a toggle before B's
      // gesture begins).
      if (seq.current && seq.current.id !== id) settle()

      const existing = seq.current
      if (!existing) {
        // First click on this target — fire 'try' now (instant audition) and
        // open the window in case a second/third click follows.
        seq.current = { id, count: 1, timer: window.setTimeout(settle, CLICK_TIER_WINDOW_MS) }
        onTierRef.current(id, 'try')
        return
      }

      clearTimeout(existing.timer)
      const count = existing.count + 1
      if (count >= 3) {
        // No point waiting for a fourth click — fire the max tier now.
        seq.current = null
        onTierRef.current(id, 'max')
        return
      }
      // count === 2: don't commit the toggle yet — a third click would make it
      // a 'max'. Re-arm the window; `settle` resolves it to a toggle on lapse.
      seq.current = { id, count, timer: window.setTimeout(settle, CLICK_TIER_WINDOW_MS) }
    },
    [settle],
  )

  // Whether a sequence is currently buffering — the grid uses this to suppress
  // the hover popover while the user is mid-gesture.
  const isPending = useCallback(() => seq.current !== null, [])

  return { click, isPending }
}
