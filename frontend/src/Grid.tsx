import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STEPS,
  TRACKS,
  TRACK_LABELS,
  SYNTH_CELL_START,
  midiToLabel,
  EXPIRING_SOON_LOOPS,
  type CellTier,
} from './config'
import type { CellState, RentEvent } from './useLiveGrid'
import { ownerColor, sameAddr, shortAddr } from './owner'
import { type ClickPhase, useClickTier } from './useClickTier'

export type CellStatus = 'free' | 'mine' | 'occupied'

// Hover-hold delay before the cell popover opens — gives the user a chance to
// click without ever seeing the popover, and only surfaces it on intent.
const HOVER_HOLD_MS = 500

interface GridProps {
  pattern: bigint
  synthData: bigint
  playingStep: number
  // Fired as the click count for a cell resolves — see ClickPhase for the
  // preview-then-commit split that powers the instant optimistic feedback on
  // double-click toggles.
  onCellTier?: (cellId: number, tier: CellTier, phase: ClickPhase) => void
  // Fired after the user has hovered a cell for HOVER_HOLD_MS — opens the popover.
  onCellHover?: (cellId: number, rect: DOMRect, status: CellStatus) => void
  // Live mode: per-cell ownership. Omitted during loop playback, where the grid
  // shows a static snapshot with no owners and falls back to track colours.
  cells?: CellState[]
  myAddress?: string | null
  currentLoop?: number
  lastRent?: RentEvent | null
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

  // Click-tier dispatch (1 = try, 2 = toggle, 3 = max). 'try' always flashes
  // green before bubbling. A 'toggle'/'max' event of any phase also cancels
  // the post-click hover timer — the user has committed to an action, no need
  // to surface the discovery popover on top.
  const { click: dispatchCellClick, isPending: clickPending } = useClickTier(
    useCallback(
      (cellId: number, tier: CellTier, phase: ClickPhase) => {
        if (tier === 'try') flashAudition(cellId)
        if (tier !== 'try') {
          // Toggle/max landing — drop the green audition flash from click 1 so
          // the optimistic purple pulse reads cleanly instead of fighting the
          // mint-green animation for ~0.3s.
          setAudited((prev) => {
            if (!prev.has(cellId)) return prev
            const next = new Set(prev)
            next.delete(cellId)
            return next
          })
          if (hoverRef.current) {
            clearTimeout(hoverRef.current.timer)
            hoverRef.current = null
          }
        }
        onCellTier?.(cellId, tier, phase)
      },
      [flashAudition, onCellTier],
    ),
  )

  // Clean up any pending hover timer when the grid unmounts.
  useEffect(() => {
    return () => {
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
      // Schedule a post-click hover so a single click reveals the popover even
      // when the mouse never moves — important for new users who click a cell
      // and then sit still, expecting some affordance to appear. If the click
      // escalates to toggle/max the useClickTier consumer above cancels this.
      if (onCellHover) {
        const timer = window.setTimeout(() => {
          hoverRef.current = null
          onCellHover(cellId, rect, status)
        }, HOVER_HOLD_MS)
        hoverRef.current = { cellId, timer }
      }
      dispatchCellClick(cellId)
    },
    [dispatchCellClick, onCellHover],
  )

  // Arm the hover-hold timer for a cell. Shared by mouseEnter and mouseMove:
  // mouseEnter alone isn't enough because a click cancels the pending timer
  // (handleCellClick) and no second mouseEnter fires while the cursor stays put
  // — so after any click the popover would never appear again until you left
  // and re-entered the cell. Re-arming on mouseMove fixes that: rest or nudge
  // the cursor on a cell and the popover surfaces, click or no prior click.
  const armHover = useCallback(
    (cellId: number, rect: DOMRect, status: CellStatus) => {
      if (!onCellHover) return
      // Click sequence in flight — don't surface the popover, the user is
      // gesturing, not exploring.
      if (clickPending()) return
      if (hoverRef.current) clearTimeout(hoverRef.current.timer)
      const timer = window.setTimeout(() => {
        hoverRef.current = null
        onCellHover(cellId, rect, status)
      }, HOVER_HOLD_MS)
      hoverRef.current = { cellId, timer }
    },
    [onCellHover, clickPending],
  )

  const handleCellEnter = armHover

  const handleCellMove = useCallback(
    (cellId: number, rect: DOMRect, status: CellStatus) => {
      // A timer is already counting down for this cell — let it run.
      if (hoverRef.current?.cellId === cellId) return
      armHover(cellId, rect, status)
    },
    [armHover],
  )

  const handleCellLeave = useCallback(() => {
    if (hoverRef.current) {
      clearTimeout(hoverRef.current.timer)
      hoverRef.current = null
    }
  }, [])

  return (
    <div className="grid">
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
          onCellMove={handleCellMove}
          onCellLeave={handleCellLeave}
          cells={cells}
          myAddress={myAddress}
          currentLoop={currentLoop}
          landed={landed}
          audited={audited}
          previewSet={previewSet}
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
  onCellMove: (cellId: number, rect: DOMRect, status: CellStatus) => void
  onCellLeave: () => void
  cells?: CellState[]
  myAddress?: string | null
  currentLoop?: number
  landed: Set<number>
  audited: Set<number>
  previewSet: Set<number>
  onRowLabelClick?: (track: number, rect: DOMRect) => void
}

function Row({
  track,
  pattern,
  synthData,
  playingStep,
  onCellClick,
  onCellEnter,
  onCellMove,
  onCellLeave,
  cells,
  myAddress,
  currentLoop,
  landed,
  audited,
  previewSet,
  onRowLabelClick,
}: RowProps) {
  const liveMode = cells !== undefined
  const fillable = liveMode && onRowLabelClick !== undefined
  return (
    <>
      <div
        className={`label${fillable ? ' fillable' : ''}`}
        onClick={
          fillable
            ? (e) => onRowLabelClick?.(track, e.currentTarget.getBoundingClientRect())
            : undefined
        }
        title={fillable ? `fill the ${TRACK_LABELS[track]} row` : undefined}
      >
        {liveMode && <span className={`track-dot ${TRACK_LABELS[track]}`} />}
        {TRACK_LABELS[track]}
        {fillable && <span className="row-fill-hint">▼</span>}
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
          // bits 0-6 of the cell word are the MIDI note (0-127) — see abi.ts.
          const midi = Number((synthData >> BigInt(offset * 16)) & 0x7Fn)
          label = midiToLabel(midi)
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
            onMouseMove={(e) => onCellMove(cellId, e.currentTarget.getBoundingClientRect(), status)}
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
