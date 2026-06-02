import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  SYNTH_CELL_START,
  SYNTH_PITCH_MIN,
  SYNTH_PITCH_MAX,
  SYNTH_PITCH_DEFAULT,
  LOOP_DURATION_SECONDS,
  TRACK_LABELS,
  STEPS,
  DEFAULT_TOGGLE_LOOPS,
  MAX_TOGGLE_LOOPS,
  isWhiteKey,
  midiToLabel,
  type CellTier,
} from './config'
import { ownerColor, shortAddr } from './owner'
import { type ClickPhase, useClickTier } from './useClickTier'

interface Props {
  cellId: number
  anchorRect: DOMRect
  onClose: () => void
  // Mirrors the click-tier scheme on the grid: 1c=try, 2c=toggle, 3c=max. The
  // popover exposes the same three actions as buttons so the gesture is
  // discoverable instead of hidden. The phase mirrors useClickTier — explicit
  // button clicks always fire 'commit'; the piano keyboard inside can also
  // fire 'preview' on a 2-click gesture, same as the grid cells.
  onTier: (tier: CellTier, pitchIdx: number, phase: ClickPhase) => void
  // When set, the cell is held by another player — the popover renders a
  // read-only "claimed" card instead of the toggle controls (try still works).
  occupied?: { who: string; loopsLeft: number }
  // Pitch the synth keyboard opens on. App owns the value so it sticks across
  // re-opens; defaults to SYNTH_PITCH_DEFAULT (C3) on first open.
  initialPitch?: number
  // Fired whenever the user selects a different key — App stores it as the
  // next popover's initialPitch.
  onPitchChange?: (pitch: number) => void
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
  occupied,
  initialPitch,
  onPitchChange,
}: Props) {
  const [pitch, setPitchState] = useState(initialPitch ?? SYNTH_PITCH_DEFAULT)
  // Wrap setPitch so every user-driven key change bubbles up to App. The
  // keyboard's onSelect and the previous-key tracking inside useClickTier both
  // route through here, so App always sees the freshest pick.
  const setPitch = (next: number) => {
    setPitchState(next)
    onPitchChange?.(next)
  }
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
        onTier('try', pitch, 'commit')
        return
      }
      if (occupied) return
      if (k === 't') {
        e.preventDefault()
        onTier('toggle', pitch, 'commit')
      } else if (k === 'm') {
        e.preventDefault()
        onTier('max', pitch, 'commit')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pitch, onClose, onTier, occupied])

  // Dismiss on any pointer-down outside the panel. The backdrop is
  // pointer-events:none (see .popover-layer) so this click ALSO lands on the
  // grid cell underneath — that's deliberate: a click that closes the popover
  // still counts toward the cell's click-tier gesture, so a double-click reads
  // as two clicks, not one. (Previously the backdrop swallowed the first click.)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    // The layer is pointer-events:none — it never catches clicks, so a click
    // that dismisses the popover passes straight through to the grid cell and
    // still counts toward its click-tier gesture. Only the panel below is
    // interactive.
    <div className="popover-layer">
      <div
        ref={popoverRef}
        className={`cell-popover ${pos?.placement ?? 'above'}${isSynth ? ' synth-popover' : ''}`}
        style={{
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          visibility: pos ? 'visible' : 'hidden',
        }}
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
            <Keyboard selected={pitch} onSelect={setPitch} onTier={onTier} />
          </div>
        )}

        <div className="tier-list" role="group" aria-label="cell actions">
          <TierRow
            label="Try"
            sub="hear it · no rent"
            gesture="1 click"
            hotkey="A"
            kind="try"
            onClick={() => onTier('try', pitch, 'commit')}
          />
          <TierRow
            label={`Toggle · ${DEFAULT_TOGGLE_LOOPS} loops`}
            sub={`${toggleCost} USDm · ${DEFAULT_TOGGLE_LOOPS * LOOP_DURATION_SECONDS}s live`}
            gesture="2 clicks"
            hotkey="T"
            kind="toggle"
            disabled={Boolean(occupied)}
            disabledReason={occupied ? "someone else's cell" : undefined}
            onClick={() => onTier('toggle', pitch, 'commit')}
          />
          <TierRow
            label={`Max · ${MAX_TOGGLE_LOOPS} loops`}
            sub={`${maxCost} USDm · ${MAX_TOGGLE_LOOPS * LOOP_DURATION_SECONDS}s live`}
            gesture="3 clicks"
            hotkey="M"
            kind="max"
            disabled={Boolean(occupied)}
            disabledReason={occupied ? "someone else's cell" : undefined}
            onClick={() => onTier('max', pitch, 'commit')}
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

// Build the 3-octave keyboard layout from the MIDI range in config. White keys
// hold the click target; black keys are positioned absolutely above the white
// row at the boundary between their two neighbours (standard piano layout).
function buildKeyboardLayout() {
  const whites: Array<{ midi: number; whiteIdx: number }> = []
  for (let midi = SYNTH_PITCH_MIN; midi <= SYNTH_PITCH_MAX; midi++) {
    if (isWhiteKey(midi)) whites.push({ midi, whiteIdx: whites.length })
  }
  // For each black key in range, anchor it to the *next* white key's left edge —
  // that's the boundary it physically sits over. Skip blacks at the extreme end
  // where no following white key exists in our range.
  const blacks: Array<{ midi: number; anchorWhite: number }> = []
  for (let midi = SYNTH_PITCH_MIN; midi <= SYNTH_PITCH_MAX; midi++) {
    if (isWhiteKey(midi)) continue
    const nextWhite = whites.find((w) => w.midi === midi + 1)
    if (!nextWhite) continue
    blacks.push({ midi, anchorWhite: nextWhite.whiteIdx })
  }
  return { whites, blacks }
}

function Keyboard({
  selected,
  onSelect,
  onTier,
}: {
  selected: number
  onSelect: (idx: number) => void
  // Same tier callback the cell uses — clicking a key 1×/2×/3× runs
  // try / toggle / max at that key's pitch, with the same preview/commit
  // phase split so a 2-click on a key paints the cell optimistically too.
  onTier: (tier: CellTier, pitchIdx: number, phase: ClickPhase) => void
}) {
  // Each piano key carries the same 1/2/3-click gesture as a grid cell, keyed
  // by its pitch (MIDI note) so rapid clicks on one key resolve to a single tier.
  const { click: dispatchKeyClick } = useClickTier((midi, tier, phase) =>
    onTier(tier, midi, phase),
  )

  const { whites, blacks } = useMemo(buildKeyboardLayout, [])

  // Scroll the selected key into view on mount — the keyboard now spans 22
  // white keys and the default (C3) lives a third of the way in, so without
  // this on a narrow popover the user might not see the active key.
  const containerRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = containerRef.current?.querySelector('.key.white.active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [])

  return (
    <div
      className="keyboard"
      ref={containerRef}
      style={{ ['--white-count' as string]: whites.length }}
    >
      <div className="keyboard-whites">
        {whites.map(({ midi }) => {
          const active = midi === selected
          const label = midiToLabel(midi) // e.g. "C3", "F#3"
          const cls = ['key', 'white']
          if (active) cls.push('active')
          // Letter without octave for the body of the key; the octave number
          // is rendered separately and only on Cs so the keyboard stays legible
          // at 16px-per-key without turning into a wall of "C3 D3 E3 F3 …".
          const isOctaveAnchor = midi % 12 === 0
          return (
            <button
              key={midi}
              type="button"
              className={cls.join(' ')}
              onClick={() => {
                // Highlight the key immediately; the tier (try/toggle/max)
                // settles ~420ms later once the click count is known.
                onSelect(midi)
                dispatchKeyClick(midi)
              }}
              title={`${label} (MIDI ${midi}) — 1 click try · 2 toggle · 3 max`}
            >
              <span className="key-label">{label[0]}</span>
              {isOctaveAnchor && (
                <span className="key-octave">{label.slice(1)}</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="keyboard-blacks">
        {blacks.map(({ midi, anchorWhite }) => {
          const active = midi === selected
          const label = midiToLabel(midi) // e.g. "A#2", "F#3"
          const cls = ['key', 'black']
          if (active) cls.push('active')
          return (
            <button
              key={midi}
              type="button"
              className={cls.join(' ')}
              // The black key sits over the boundary between the white key at
              // `anchorWhite - 1` and the one at `anchorWhite`. CSS grid spreads
              // whites evenly across the row; the boundary lives at
              // `anchorWhite * (100% / totalWhites)`.
              style={{
                left: `calc(${anchorWhite} * (100% / var(--white-count)) - (var(--black-w) / 2))`,
              }}
              onClick={() => {
                // Same gesture as a white key: highlight now, settle the tier
                // (try/toggle/max) once the click count is known.
                onSelect(midi)
                dispatchKeyClick(midi)
              }}
              title={`${label} (MIDI ${midi}) — 1 click try · 2 toggle · 3 max`}
            />
          )
        })}
      </div>
    </div>
  )
}
