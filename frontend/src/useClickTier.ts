import { useCallback, useEffect, useRef } from 'react'
import type { CellTier } from './config'

// How long we wait after a click before settling a 2-click 'toggle'. This must
// be generous enough to span a real human double-click: OS double-click
// thresholds run 400–500ms. 'try' fires on the first click (the audition is
// non-committal, no reason to delay it), so widening the window only delays
// the toggle commit — which is an async on-chain op anyway.
export const CLICK_TIER_WINDOW_MS = 420

// 'preview' fires the instant a tier is hinted (count 2 → toggle preview), so
// the consumer can paint optimistic feedback before the on-chain commit.
// 'commit' fires when the action should actually run. The split is what makes
// a double-click feel responsive: the cell can pulse purple the moment the
// second click lands, ~420ms before the tx would otherwise have been resolved.
export type ClickPhase = 'preview' | 'commit'

// Resolves rapid clicks into a tier with the two phases above:
//   click 1                  → ('try',    'commit') — audition immediately
//   click 2                  → ('toggle', 'preview') — paint optimistic instantly
//   …no 3rd within WINDOW   → ('toggle', 'commit') — submit the tx
//   click 3                  → ('max',    'commit') — submit max immediately
// One sequence is tracked at a time; a click on a different target settles the
// prior sequence first. Used by both the grid cells and the popover's piano
// keys so the 1/2/3-click gesture behaves identically wherever a sound can be
// triggered.
export function useClickTier(
  onTier: (id: number, tier: CellTier, phase: ClickPhase) => void,
) {
  const seq = useRef<{ id: number; count: number; timer: number } | null>(null)
  // Keep the callback fresh so a tier settled after a prop change still
  // dispatches against current state (e.g. audition lock toggled mid-sequence).
  const onTierRef = useRef(onTier)
  useEffect(() => {
    onTierRef.current = onTier
  }, [onTier])

  // A sequence that stalled at 2 clicks commits as 'toggle'. count===1 needs
  // nothing here: 'try' already fired on the click itself, and the preview
  // for count===2 already fired the moment the second click landed.
  const settle = useCallback(() => {
    const c = seq.current
    if (!c) return
    clearTimeout(c.timer)
    seq.current = null
    if (c.count >= 2) onTierRef.current(c.id, 'toggle', 'commit')
  }, [])

  useEffect(() => {
    return () => {
      if (seq.current) clearTimeout(seq.current.timer)
    }
  }, [])

  const click = useCallback(
    (id: number) => {
      // A click on a different target settles the prior sequence first (so a
      // half-finished double-click on cell A commits as toggle before B's
      // gesture begins).
      if (seq.current && seq.current.id !== id) settle()

      const existing = seq.current
      if (!existing) {
        seq.current = { id, count: 1, timer: window.setTimeout(settle, CLICK_TIER_WINDOW_MS) }
        onTierRef.current(id, 'try', 'commit')
        return
      }

      clearTimeout(existing.timer)
      const count = existing.count + 1
      if (count >= 3) {
        // No point waiting for a fourth click — fire max now.
        seq.current = null
        onTierRef.current(id, 'max', 'commit')
        return
      }
      // count === 2 — preview 'toggle' immediately (instant pulse / optimistic
      // paint), then wait the window in case a 3rd click escalates to max.
      seq.current = { id, count, timer: window.setTimeout(settle, CLICK_TIER_WINDOW_MS) }
      onTierRef.current(id, 'toggle', 'preview')
    },
    [settle],
  )

  // Whether a sequence is currently buffering — the grid uses this to suppress
  // the hover popover while the user is mid-gesture.
  const isPending = useCallback(() => seq.current !== null, [])

  return { click, isPending }
}
