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
import { ownerColor, shortAddr } from './owner'

interface Props {
  cellId: number
  anchorRect: DOMRect
  onClose: () => void
  onSubmit: (durationLoops: number, pitchIdx: number) => void
  // When set, the cell is held by another player — the popover renders a
  // read-only "claimed" card instead of the toggle controls.
  occupied?: { who: string; loopsLeft: number }
}

interface PopoverPos {
  top: number
  left: number
  placement: 'above' | 'below'
  arrowLeft: number
}

// Contextual toggle popover — anchored to the clicked cell so toggling is one click
// away from the cursor. T toggles at the chosen duration, M jumps to a max toggle.
export function CellPopover({ cellId, anchorRect, onClose, onSubmit, occupied }: Props) {
  const [duration, setDuration] = useState(DEFAULT_TOGGLE_LOOPS)
  const [pitch, setPitch] = useState(0)
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const isSynth = cellId >= SYNTH_CELL_START
  const track = Math.floor(cellId / STEPS)
  const step = cellId % STEPS

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

  // Hotkeys: T = toggle at current duration, M = max toggle, Esc = close.
  // A cell held by another player is read-only, so only Esc is wired.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (occupied) return
      const k = e.key.toLowerCase()
      if (k === 't') {
        e.preventDefault()
        onSubmit(duration, pitch)
      } else if (k === 'm') {
        e.preventDefault()
        onSubmit(MAX_TOGGLE_LOOPS, pitch)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [duration, pitch, onClose, onSubmit, occupied])

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

        {occupied ? (
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
        ) : (
          <>
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

            {isSynth && (
              <div className="pitch-picker">
                <span className="pitch-label">pitch</span>
                <Keyboard selected={pitch} onSelect={setPitch} />
              </div>
            )}

            <div className="muted popover-cost">
              {(0.004 * duration).toFixed(3)} USDm · live {duration * LOOP_DURATION_SECONDS}s
            </div>

            <div className="popover-actions">
              <button className="primary" onClick={() => onSubmit(duration, pitch)}>
                toggle <kbd>T</kbd>
              </button>
              <button className="hot" onClick={() => onSubmit(MAX_TOGGLE_LOOPS, pitch)}>
                max <kbd>M</kbd>
              </button>
            </div>
          </>
        )}

        <span className="popover-arrow" style={{ left: pos?.arrowLeft ?? 0 }} />
      </div>
    </div>
  )
}

// Pentatonic scale (C, D, E, G, A) shown over a full-octave keyboard.
// F and B are disabled to make the scale gap visible; black keys are decorative.
const WHITE_KEYS: Array<{ note: string; pitchIdx: number | null }> = [
  { note: 'C', pitchIdx: 0 },
  { note: 'D', pitchIdx: 1 },
  { note: 'E', pitchIdx: 2 },
  { note: 'F', pitchIdx: null },
  { note: 'G', pitchIdx: 3 },
  { note: 'A', pitchIdx: 4 },
  { note: 'B', pitchIdx: null },
]

// Black-key positions as fractional offsets across the 7-white-key row (0..7).
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
          const disabled = k.pitchIdx === null
          const cls = ['key', 'white']
          if (active) cls.push('active')
          if (disabled) cls.push('disabled')
          return (
            <button
              key={i}
              type="button"
              className={cls.join(' ')}
              disabled={disabled}
              onClick={() => k.pitchIdx !== null && onSelect(k.pitchIdx)}
              title={disabled ? `${k.note} (out of scale)` : `${k.note} (pitch ${k.pitchIdx})`}
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
            style={{ left: `calc(${k.offset} * (100% / 7) - (var(--black-w) / 2))` }}
            aria-hidden
          />
        ))}
      </div>
      <div className="keyboard-caption muted">selected: {PITCH_LABELS[selected]}</div>
    </div>
  )
}
