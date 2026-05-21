import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STEPS, TRACKS, TRACK_LABELS, SYNTH_CELL_START, PITCH_LABELS, EXPIRING_SOON_LOOPS } from './config'
import type { CellState, RentEvent } from './useLiveGrid'
import { ownerColor, sameAddr, shortAddr } from './owner'

export type CellStatus = 'free' | 'mine' | 'occupied'
// 1 click = audition / 2 = toggle@DEFAULT / 3 = toggle@MAX. See CLICK_TIER_WINDOW_MS.
export type CellTier = 'try' | 'toggle' | 'max'

// How long we wait after the first click before settling on a tier. The third
// click fires immediately, so this only bounds single→double resolution.
const CLICK_TIER_WINDOW_MS = 240
// Hover-hold delay before the cell popover opens — gives the user a chance to
// click without ever seeing the popover, and only surfaces it on intent.
const HOVER_HOLD_MS = 500

interface GridProps {
  pattern: bigint
  synthData: bigint
  playingStep: number
  // Fired once the click count for a cell has resolved (1, 2 or ≥3).
  onCellTier?: (cellId: number, tier: CellTier, rect: DOMRect, status: CellStatus) => void
  // Fired after the user has hovered a cell for HOVER_HOLD_MS — opens the popover.
  onCellHover?: (cellId: number, rect: DOMRect, status: CellStatus) => void
  // Live mode: per-cell ownership. Omitted during loop playback, where the grid
  // shows a static snapshot with no owners and falls back to track colours.
  cells?: CellState[]
  myAddress?: string | null
  currentLoop?: number
  lastRent?: RentEvent | null
  // While on, the toggle/max tiers are inert — only audition (1 click) fires.
  // Cosmetic cue lets the grid read as "tap to hear, no edits".
  auditionMode?: boolean
  // When set, the row label becomes a button that opens the row-fill menu.
  onRowLabelClick?: (track: number, rect: DOMRect) => void
  // Cells the user is hovering on in a tools popover — drawn with a distinct
  // "will-be-activated" highlight so they can see what a click would do.
  previewCells?: number[] | null
}

export function Grid({
  pattern,
  synthData,
  playingStep,
  onCellTier,
  onCellHover,
  cells,
  myAddress,
  currentLoop,
  lastRent,
  auditionMode,
  onRowLabelClick,
  previewCells,
}: GridProps) {
  // Cells that just landed from a CellRented event get a one-shot pop animation.
  const [landed, setLanded] = useState<Set<number>>(() => new Set())
  // Ephemeral set of cells that just got an audition click — they flash a green
  // pulse and fade out, matching the "I'm just trying it, this won't rent" mood.
  const [audited, setAudited] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    if (!lastRent) return
    const id = lastRent.cellId
    setLanded((prev) => new Set(prev).add(id))
    const t = setTimeout(() => {
      setLanded((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 720)
    return () => clearTimeout(t)
  }, [lastRent])

  const previewSet = useMemo(() => new Set(previewCells ?? []), [previewCells])

  // One in-flight click sequence at a time — a mouse only has one cursor, so we
  // don't need a per-cell map.
  const clickRef = useRef<{
    cellId: number
    count: number
    timer: number
    rect: DOMRect
    status: CellStatus
  } | null>(null)
  // Tracks the pending hover-hold so we can cancel on leave or click.
  const hoverRef = useRef<{ cellId: number; timer: number } | null>(null)

  const flashAudition = useCallback((cellId: number) => {
    setAudited((prev) => new Set(prev).add(cellId))
    setTimeout(() => {
      setAudited((prev) => {
        const next = new Set(prev)
        next.delete(cellId)
        return next
      })
    }, 600)
  }, [])

  // Dispatch whatever sequence is currently buffered, then clear it.
  const flushClicks = useCallback(() => {
    const c = clickRef.current
    if (!c) return
    clearTimeout(c.timer)
    clickRef.current = null
    const tier: CellTier = c.count >= 3 ? 'max' : c.count === 2 ? 'toggle' : 'try'
    // Audition lock: only the 'try' tier fires; toggle/max are swallowed.
    if (auditionMode && tier !== 'try') return
    if (tier === 'try') flashAudition(c.cellId)
    onCellTier?.(c.cellId, tier, c.rect, c.status)
  }, [auditionMode, flashAudition, onCellTier])

  // Keep flushClicks fresh inside the setTimeout closure — auditionMode toggling
  // mid-sequence would otherwise dispatch the wrong action.
  const flushRef = useRef(flushClicks)
  useEffect(() => {
    flushRef.current = flushClicks
  }, [flushClicks])

  // Clean up any pending timers when the grid unmounts.
  useEffect(() => {
    return () => {
      if (clickRef.current) clearTimeout(clickRef.current.timer)
      if (hoverRef.current) clearTimeout(hoverRef.current.timer)
    }
  }, [])

  const handleCellClick = useCallback(
    (cellId: number, rect: DOMRect, status: CellStatus) => {
      // A click cancels any pending hover-popover — user is already engaging.
      if (hoverRef.current) {
        clearTimeout(hoverRef.current.timer)
        hoverRef.current = null
      }

      // If a sequence on a different cell is still open, dispatch it first so it
      // doesn't get lost.
      if (clickRef.current && clickRef.current.cellId !== cellId) {
        flushRef.current()
      }

      const existing = clickRef.current
      const fire = () => flushRef.current()

      if (existing && existing.cellId === cellId) {
        clearTimeout(existing.timer)
        const nextCount = existing.count + 1
        if (nextCount >= 3) {
          clickRef.current = { ...existing, count: nextCount }
          fire()
          return
        }
        const timer = window.setTimeout(fire, CLICK_TIER_WINDOW_MS)
        clickRef.current = { ...existing, count: nextCount, timer, rect }
      } else {
        const timer = window.setTimeout(fire, CLICK_TIER_WINDOW_MS)
        clickRef.current = { cellId, count: 1, timer, rect, status }
      }
    },
    [],
  )

  const handleCellEnter = useCallback(
    (cellId: number, rect: DOMRect, status: CellStatus) => {
      if (!onCellHover) return
      // Click sequence in flight — don't surface the popover, the user is
      // gesturing, not exploring.
      if (clickRef.current) return
      if (hoverRef.current) clearTimeout(hoverRef.current.timer)
      const timer = window.setTimeout(() => {
        hoverRef.current = null
        onCellHover(cellId, rect, status)
      }, HOVER_HOLD_MS)
      hoverRef.current = { cellId, timer }
    },
    [onCellHover],
  )

  const handleCellLeave = useCallback(() => {
    if (hoverRef.current) {
      clearTimeout(hoverRef.current.timer)
      hoverRef.current = null
    }
  }, [])

  return (
    <div className={`grid${auditionMode ? ' audition' : ''}`}>
      <div className="label step-axis-label">step</div>
      {Array.from({ length: STEPS }).map((_, step) => {
        const cls = ['step-num']
        if (step % 4 === 0) cls.push('downbeat')
        if (playingStep === step) cls.push('playing')
        return (
          <div key={`hdr-${step}`} className={cls.join(' ')}>
            {step + 1}
          </div>
        )
      })}
      {Array.from({ length: TRACKS }).map((_, track) => (
        <Row
          key={track}
          track={track}
          pattern={pattern}
          synthData={synthData}
          playingStep={playingStep}
          onCellClick={handleCellClick}
          onCellEnter={handleCellEnter}
          onCellLeave={handleCellLeave}
          cells={cells}
          myAddress={myAddress}
          currentLoop={currentLoop}
          landed={landed}
          audited={audited}
          previewSet={previewSet}
          auditionMode={auditionMode}
          onRowLabelClick={onRowLabelClick}
        />
      ))}
    </div>
  )
}

interface RowProps {
  track: number
  pattern: bigint
  synthData: bigint
  playingStep: number
  onCellClick: (cellId: number, rect: DOMRect, status: CellStatus) => void
  onCellEnter: (cellId: number, rect: DOMRect, status: CellStatus) => void
  onCellLeave: () => void
  cells?: CellState[]
  myAddress?: string | null
  currentLoop?: number
  landed: Set<number>
  audited: Set<number>
  previewSet: Set<number>
  auditionMode?: boolean
  onRowLabelClick?: (track: number, rect: DOMRect) => void
}

function Row({
  track,
  pattern,
  synthData,
  playingStep,
  onCellClick,
  onCellEnter,
  onCellLeave,
  cells,
  myAddress,
  currentLoop,
  landed,
  audited,
  previewSet,
  auditionMode,
  onRowLabelClick,
}: RowProps) {
  const liveMode = cells !== undefined
  // Row labels are only tappable when the row-fill menu is wired AND we're not
  // in audition mode — audition is read-only by design, so the fill affordance
  // gets visibly disabled to match.
  const fillable = liveMode && onRowLabelClick !== undefined && !auditionMode
  const fillableDisabled = liveMode && onRowLabelClick !== undefined && auditionMode
  return (
    <>
      <div
        className={`label${fillable ? ' fillable' : ''}${fillableDisabled ? ' fillable-disabled' : ''}`}
        onClick={
          fillable
            ? (e) => onRowLabelClick?.(track, e.currentTarget.getBoundingClientRect())
            : undefined
        }
        title={
          fillable
            ? `fill the ${TRACK_LABELS[track]} row`
            : fillableDisabled
              ? 'exit audition mode to edit'
              : undefined
        }
      >
        {liveMode && <span className={`track-dot ${TRACK_LABELS[track]}`} />}
        {TRACK_LABELS[track]}
        {(fillable || fillableDisabled) && <span className="row-fill-hint">▼</span>}
      </div>
      {Array.from({ length: STEPS }).map((_, step) => {
        const cellId = step + track * STEPS
        const on = ((pattern >> BigInt(cellId)) & 1n) === 1n
        const isSynth = cellId >= SYNTH_CELL_START
        const playing = playingStep === step
        const beatStart = step % 4 === 0

        const cell = cells?.[cellId]
        const owner = on ? (cell?.owner ?? null) : null
        const mine = sameAddr(owner, myAddress)
        const pending = Boolean(cell?.pending)
        const loopsLeft =
          cell && currentLoop !== undefined ? cell.expiryLoop - currentLoop : Number.POSITIVE_INFINITY
        const expiring = on && liveMode && Number.isFinite(loopsLeft) && loopsLeft <= EXPIRING_SOON_LOOPS

        let status: CellStatus = 'free'
        if (on && owner) status = mine ? 'mine' : 'occupied'

        let label = ''
        if (on && isSynth) {
          const offset = cellId - SYNTH_CELL_START
          const pitchIdx = Number((synthData >> BigInt(offset * 16)) & 0x7n) % PITCH_LABELS.length
          label = PITCH_LABELS[pitchIdx]
        }

        const trackName = TRACK_LABELS[track]
        const cls = ['cell']
        if (on) {
          cls.push('on')
          if (liveMode) cls.push(mine ? 'mine' : 'other')
          else cls.push(trackName)
        }
        if (playing) cls.push('playing')
        if (beatStart) cls.push('beat-1')
        if (pending) cls.push('pending')
        if (expiring) cls.push('expiring')
        if (landed.has(cellId)) cls.push('just-landed')
        if (audited.has(cellId)) cls.push('auditioning')
        // preview is only drawn on cells the click would actually rent — i.e.
        // empty / lapsed ones; never on a cell another player live-holds.
        if (previewSet.has(cellId) && status !== 'occupied') cls.push('preview-fill')

        const style: CSSProperties = {}
        if (on && liveMode && owner && !mine) {
          ;(style as Record<string, string>)['--cell-color'] = ownerColor(owner)
        }

        let title = `cell ${cellId}`
        if (liveMode) {
          if (status === 'occupied' && owner) {
            const n = Math.max(0, Math.round(loopsLeft))
            title = `rented by ${shortAddr(owner)} · ${n} loop${n === 1 ? '' : 's'} left · click = try`
          } else if (status === 'mine') {
            const n = Math.max(0, Math.round(loopsLeft))
            title = `your cell · ${n} loop${n === 1 ? '' : 's'} left${pending ? ' · confirming…' : ''} · 1c try · 2c +16 · 3c +32`
          } else {
            title = `1 click = try · 2 clicks = toggle (16) · 3 clicks = max (32) · hover for menu`
          }
        }

        return (
          <div
            key={cellId}
            className={cls.join(' ')}
            style={style}
            onClick={(e) => onCellClick(cellId, e.currentTarget.getBoundingClientRect(), status)}
            onMouseEnter={(e) => onCellEnter(cellId, e.currentTarget.getBoundingClientRect(), status)}
            onMouseLeave={onCellLeave}
            title={title}
          >
            {label}
          </div>
        )
      })}
    </>
  )
}
