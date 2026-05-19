import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatUnits } from 'viem'
import { STEPS, TRACK_LABELS, DEFAULT_TOGGLE_LOOPS, MAX_TOGGLE_LOOPS } from './config'
import type { CellState } from './useLiveGrid'

interface Props {
  track: number
  anchorRect: DOMRect
  cells: CellState[]
  currentLoop: number
  rentPerLoop: bigint
  onClose: () => void
  // Apply a fill — rents every cellId for `duration` loops in one batched tx.
  onApply: (cellIds: number[], duration: number) => void
}

interface PopoverPos {
  top: number
  left: number
}

// Evenly spread `hits` onsets across `steps`, always starting on step 0 — the
// "Euclidean fill" primitive (floor distribution). 4 over 16 → 0,4,8,12.
function spread(hits: number, steps: number): number[] {
  if (hits <= 0) return []
  if (hits >= steps) return Array.from({ length: steps }, (_, i) => i)
  return Array.from({ length: hits }, (_, k) => Math.floor((k * steps) / hits))
}

const ALL_STEPS = Array.from({ length: STEPS }, (_, i) => i)

// Quick patterns. Additive only — a fill never clears a cell (ephemeral by
// design): it just rents the still-empty steps in the set.
const PRESETS: { key: string; label: string; steps: number[] }[] = [
  { key: '4/4', label: '4·on·4', steps: [0, 4, 8, 12] },
  { key: 'off', label: 'offbeat', steps: [2, 6, 10, 14] },
  { key: '8th', label: '8ths', steps: [0, 2, 4, 6, 8, 10, 12, 14] },
  { key: 'full', label: 'full', steps: ALL_STEPS },
]

// Per-row fill menu — anchored to the row's label. Lets you lay down a regular
// pattern in one click + one signed transaction instead of tapping each step.
export function RowToolsPopover({
  track,
  anchorRect,
  cells,
  currentLoop,
  rentPerLoop,
  onClose,
  onApply,
}: Props) {
  const [duration, setDuration] = useState(DEFAULT_TOGGLE_LOOPS)
  const [hits, setHits] = useState(4)
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const rentUsdm = Number(formatUnits(rentPerLoop, 18))

  // A step is fillable if nothing live currently holds its cell (it's off, or
  // the rent has lapsed). Live cells — yours or anyone's — are left untouched.
  const targetsFor = useMemo(() => {
    return (steps: number[]) =>
      steps
        .map((s) => s + track * STEPS)
        .filter((id) => {
          const c = cells[id]
          return !(c && c.owner && c.expiryLoop > currentLoop)
        })
  }, [cells, currentLoop, track])

  // Place the menu just below the row label; flip above if it would clip.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const gap = 8
    const margin = 8
    const left = Math.max(margin, Math.min(anchorRect.left, window.innerWidth - width - margin))
    let top = anchorRect.bottom + gap
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, anchorRect.top - height - gap)
    }
    setPos({ top, left })
  }, [anchorRect])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fmtCost = (n: number) => (n * rentUsdm * duration).toFixed(3)

  const apply = (steps: number[]) => {
    const ids = targetsFor(steps)
    if (ids.length > 0) onApply(ids, duration)
  }

  const euclidSteps = useMemo(() => spread(hits, STEPS), [hits])
  const euclidTargets = targetsFor(euclidSteps)

  return (
    <div className="popover-layer" onClick={onClose}>
      <div
        ref={ref}
        className="row-tools"
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popover-head">
          <span className="popover-title">{TRACK_LABELS[track]} · fill row</span>
          <button className="popover-x" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        <label className="popover-duration">
          loops
          <input
            type="number"
            min={1}
            max={MAX_TOGGLE_LOOPS}
            value={duration}
            onChange={(e) =>
              setDuration(Math.max(1, Math.min(MAX_TOGGLE_LOOPS, Number(e.target.value) || 1)))
            }
          />
        </label>

        <div className="row-tools-grid">
          {PRESETS.map((p) => {
            const n = targetsFor(p.steps).length
            return (
              <button
                key={p.key}
                disabled={n === 0}
                onClick={() => apply(p.steps)}
                title={n === 0 ? 'those steps are already filled' : `rents ${n} cell${n === 1 ? '' : 's'}`}
              >
                <span className="rt-label">{p.label}</span>
                <span className="rt-cost">{n === 0 ? 'filled' : `${n} · ${fmtCost(n)}`}</span>
              </button>
            )
          })}
        </div>

        <div className="row-tools-euclid">
          <label className="popover-duration">
            spread
            <input
              type="number"
              min={1}
              max={STEPS}
              value={hits}
              onChange={(e) => setHits(Math.max(1, Math.min(STEPS, Number(e.target.value) || 1)))}
            />
          </label>
          <button disabled={euclidTargets.length === 0} onClick={() => apply(euclidSteps)}>
            {euclidTargets.length === 0
              ? 'spread — filled'
              : `spread ${hits} · ${fmtCost(euclidTargets.length)}`}
          </button>
        </div>

        <span className="muted">USDm · adds cells only — never clears</span>
      </div>
    </div>
  )
}
