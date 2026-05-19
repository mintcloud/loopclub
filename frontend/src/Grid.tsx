import { type CSSProperties, useEffect, useState } from 'react'
import { STEPS, TRACKS, TRACK_LABELS, SYNTH_CELL_START, PITCH_LABELS, EXPIRING_SOON_LOOPS } from './config'
import type { CellState, RentEvent } from './useLiveGrid'
import { ownerColor, sameAddr, shortAddr } from './owner'

export type CellStatus = 'free' | 'mine' | 'occupied'

interface GridProps {
  pattern: bigint
  synthData: bigint
  playingStep: number
  onCellClick: (cellId: number, rect: DOMRect, status: CellStatus) => void
  // Live mode: per-cell ownership. Omitted during loop playback, where the grid
  // shows a static snapshot with no owners and falls back to track colours.
  cells?: CellState[]
  myAddress?: string | null
  currentLoop?: number
  lastRent?: RentEvent | null
  // While true, cell clicks audition the sound instead of opening the popover.
  // Used purely to give the grid a "tap to hear" hover cue.
  auditionMode?: boolean
  // When set, the row label becomes a button that opens the row-fill menu.
  onRowLabelClick?: (track: number, rect: DOMRect) => void
}

export function Grid({
  pattern,
  synthData,
  playingStep,
  onCellClick,
  cells,
  myAddress,
  currentLoop,
  lastRent,
  auditionMode,
  onRowLabelClick,
}: GridProps) {
  // Cells that just landed from a CellRented event get a one-shot pop animation.
  const [landed, setLanded] = useState<Set<number>>(() => new Set())

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
          onCellClick={onCellClick}
          cells={cells}
          myAddress={myAddress}
          currentLoop={currentLoop}
          landed={landed}
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
  cells?: CellState[]
  myAddress?: string | null
  currentLoop?: number
  landed: Set<number>
  onRowLabelClick?: (track: number, rect: DOMRect) => void
}

function Row({
  track,
  pattern,
  synthData,
  playingStep,
  onCellClick,
  cells,
  myAddress,
  currentLoop,
  landed,
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
        {fillable && <span className="row-fill-hint">▦</span>}
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

        const style: CSSProperties = {}
        if (on && liveMode && owner && !mine) {
          ;(style as Record<string, string>)['--cell-color'] = ownerColor(owner)
        }

        let title = `cell ${cellId}`
        if (liveMode) {
          if (status === 'occupied' && owner) {
            const n = Math.max(0, Math.round(loopsLeft))
            title = `rented by ${shortAddr(owner)} · ${n} loop${n === 1 ? '' : 's'} left`
          } else if (status === 'mine') {
            const n = Math.max(0, Math.round(loopsLeft))
            title = `your cell · ${n} loop${n === 1 ? '' : 's'} left${pending ? ' · confirming…' : ''}`
          } else {
            title = `cell ${cellId} — tap to rent`
          }
        }

        return (
          <div
            key={cellId}
            className={cls.join(' ')}
            style={style}
            onClick={(e) => onCellClick(cellId, e.currentTarget.getBoundingClientRect(), status)}
            title={title}
          >
            {label}
          </div>
        )
      })}
    </>
  )
}
