import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  PITCH_LABELS,
  SYNTH_CELL_START,
  LOOP_DURATION_SECONDS,
  TRACK_LABELS,
  STEPS,
  DEFAULT_TOGGLE_LOOPS,
  MAX_TOGGLE_LOOPS,
} from './config'
import type { CellTier } from './Grid'
import { ownerColor, shortAddr } from './owner'

interface Props {
  cellId: number
  anchorRect: DOMRect
  onClose: () => void
  // Mirrors the click-tier scheme on the grid: 1c=try, 2c=toggle, 3c=max. The
  // popover exposes the same three actions as buttons so the gesture is
  // discoverable instead of hidden.
  onTier: (tier: CellTier, pitchIdx: number) => void
  // While on, the toggle/max rows render disabled — they explain why instead
  // of just being inert, so the "audition lock" mode reads clearly.
  auditionLocked?: boolean
  // When set, the cell is held by another player — the popover renders a
  // read-only "claimed" card instead of the toggle controls (try still works).
  occupied?: { who: string; loopsLeft: number }
}

interface PopoverPos {
  top: number
  left: number
  placement: 'above' | 'below'
  arrowLeft: number
}

// Contextual tier popover — anchored to the cell so the user sees the same
// three actions whether they reach them via the gesture (1/2/3 clicks on the
// cell) or by hovering and clicking inside the popover. The popover is the
// discovery layer for the gesture, so the row labels spell out which click
// count maps to which tier.
export function CellPopover({
  cellId,
  anchorRect,
  onClose,
  onTier,
  auditionLocked,
  occupied,
}: Props) {
  const [pitch, setPitch] = useState(0)
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const isSynth = cellId >= SYNTH_CELL_START
  const track = Math.floor(cellId / STEPS)
  const step = cellId % STEPS

  const toggleCost = (0.004 * DEFAULT_TOGGLE_LOOPS).toFixed(3)
  const maxCost = (0.004 * MAX_TOGGLE_LOOPS).toFixed(3)

  // Place the popover above the cell; flip below if it would clip the viewport top.
  useLayoutEffect(() => {
    const el = popoverRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const gap = 10
    const margin = 8
    const cellCenterX = anchorRect.left + anchorRect.width / 2

    let left = cellCenterX - width / 2
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))

    let placement: 'above' | 'below' = 'above'
    let top = anchorRect.top - height - gap
    if (top < margin) {
      placement = 'below'
      top = Math.min(anchorRect.bottom + gap, window.innerHeight - height - margin)
    }

    const arrowLeft = Math.max(14, Math.min(cellCenterX - left, width - 14))
    setPos({ top, left, placement, arrowLeft })
  }, [anchorRect, isSynth])

  // Hotkeys mirror the click-tier scheme: A = try (audition), T = toggle@16,
  // M = max@32, Esc = close. Try works even on occupied cells.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      const k = e.key.toLowerCase()
      if (k === 'a') {
        e.preventDefault()
        onTier('try', pitch)
        return
      }
      if (occupied || auditionLocked) return
      if (k === 't') {
        e.preventDefault()
        onTier('toggle', pitch)
      } else if (k === 'm') {
        e.preventDefault()
        onTier('max', pitch)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pitch, onClose, onTier, occupied, auditionLocked])

  return (
    <div className="popover-layer" onClick={onClose}>
      <div
        ref={popoverRef}
        className={`cell-popover ${pos?.placement ?? 'above'}`}
        style={{
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          visibility: pos ? 'visible' : 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popover-head">
          <span className="popover-title">
            cell #{cellId} · {TRACK_LABELS[track]} {step + 1}
          </span>
          <button className="popover-x" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>

        {occupied && (
          <div className="popover-claimed">
            <span className="claimed-owner">
              <span className="claimed-dot" style={{ background: ownerColor(occupied.who) }} />
              rented by {shortAddr(occupied.who)}
            </span>
            <span className="muted">
              Frees up in {Math.max(0, occupied.loopsLeft)} loop
              {occupied.loopsLeft === 1 ? '' : 's'} (~{Math.max(0, occupied.loopsLeft) * LOOP_DURATION_SECONDS}s)
              {' '}— then it's yours to grab.
            </span>
          </div>
        )}

        {isSynth && !occupied && (
          <div className="pitch-picker">
            <span className="pitch-label">pitch</span>
            <Keyboard selected={pitch} onSelect={setPitch} />
          </div>
        )}

        <div className="tier-list" role="group" aria-label="cell actions">
          <TierRow
            label="Try"
            sub="hear it · no rent"
            gesture="1 click"
            hotkey="A"
            kind="try"
            onClick={() => onTier('try', pitch)}
          />
          <TierRow
            label={`Toggle · ${DEFAULT_TOGGLE_LOOPS} loops`}
            sub={`${toggleCost} USDm · ${DEFAULT_TOGGLE_LOOPS * LOOP_DURATION_SECONDS}s live`}
            gesture="2 clicks"
            hotkey="T"
            kind="toggle"
            disabled={Boolean(occupied) || auditionLocked}
            disabledReason={
              occupied ? "someone else's cell" : auditionLocked ? 'audition lock on' : undefined
            }
            onClick={() => onTier('toggle', pitch)}
          />
          <TierRow
            label={`Max · ${MAX_TOGGLE_LOOPS} loops`}
            sub={`${maxCost} USDm · ${MAX_TOGGLE_LOOPS * LOOP_DURATION_SECONDS}s live`}
            gesture="3 clicks"
            hotkey="M"
            kind="max"
            disabled={Boolean(occupied) || auditionLocked}
            disabledReason={
              occupied ? "someone else's cell" : auditionLocked ? 'audition lock on' : undefined
            }
            onClick={() => onTier('max', pitch)}
          />
        </div>

        <span className="popover-arrow" style={{ left: pos?.arrowLeft ?? 0 }} />
      </div>
    </div>
  )
}

interface TierRowProps {
  label: string
  sub: string
  gesture: string
  hotkey: string
  kind: 'try' | 'toggle' | 'max'
  disabled?: boolean
  disabledReason?: string
  onClick: () => void
}

function TierRow({ label, sub, gesture, hotkey, kind, disabled, disabledReason, onClick }: TierRowProps) {
  return (
    <button
      type="button"
      className={`tier-row tier-${kind}${disabled ? ' disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledReason : `${label} · ${gesture}`}
    >
      <span className="tier-main">
        <span className="tier-label">{label}</span>
        <span className="tier-sub muted">{disabled && disabledReason ? disabledReason : sub}</span>
      </span>
      <span className="tier-gesture">
        <span className="tier-gesture-text">{gesture}</span>
        <kbd className="tier-hotkey">{hotkey}</kbd>
      </span>
    </button>
  )
}

// One diatonic octave — eight selectable scale degrees (C D E F G A B C) over a
// full white-key keyboard. Black keys are decorative.
const WHITE_KEYS: Array<{ note: string; pitchIdx: number }> = [
  { note: 'C', pitchIdx: 0 },
  { note: 'D', pitchIdx: 1 },
  { note: 'E', pitchIdx: 2 },
  { note: 'F', pitchIdx: 3 },
  { note: 'G', pitchIdx: 4 },
  { note: 'A', pitchIdx: 5 },
  { note: 'B', pitchIdx: 6 },
  { note: 'C', pitchIdx: 7 },
]

// Black-key positions as fractional offsets across the 8-white-key row (0..8).
const BLACK_KEYS: Array<{ note: string; offset: number }> = [
  { note: 'C#', offset: 1 },
  { note: 'D#', offset: 2 },
  { note: 'F#', offset: 4 },
  { note: 'G#', offset: 5 },
  { note: 'A#', offset: 6 },
]

function Keyboard({ selected, onSelect }: { selected: number; onSelect: (idx: number) => void }) {
  return (
    <div className="keyboard">
      <div className="keyboard-whites">
        {WHITE_KEYS.map((k, i) => {
          const active = k.pitchIdx === selected
          const cls = ['key', 'white']
          if (active) cls.push('active')
          return (
            <button
              key={i}
              type="button"
              className={cls.join(' ')}
              onClick={() => onSelect(k.pitchIdx)}
              title={`${PITCH_LABELS[k.pitchIdx]} (degree ${k.pitchIdx})`}
            >
              <span className="key-label">{k.note}</span>
            </button>
          )
        })}
      </div>
      <div className="keyboard-blacks">
        {BLACK_KEYS.map((k) => (
          <span
            key={k.note}
            className="key black"
            style={{ left: `calc(${k.offset} * (100% / 8) - (var(--black-w) / 2))` }}
            aria-hidden
          />
        ))}
      </div>
      <div className="keyboard-caption muted">selected: {PITCH_LABELS[selected]}</div>
    </div>
  )
}
