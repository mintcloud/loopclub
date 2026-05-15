import { STEPS, TRACKS, TRACK_LABELS, SYNTH_CELL_START, PITCH_LABELS } from './config'

interface GridProps {
  pattern: bigint
  pitches: bigint
  playingStep: number
  onCellClick: (cellId: number, rect: DOMRect) => void
}

export function Grid({ pattern, pitches, playingStep, onCellClick }: GridProps) {
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
          pitches={pitches}
          playingStep={playingStep}
          onCellClick={onCellClick}
        />
      ))}
    </div>
  )
}

interface RowProps {
  track: number
  pattern: bigint
  pitches: bigint
  playingStep: number
  onCellClick: (cellId: number, rect: DOMRect) => void
}

function Row({ track, pattern, pitches, playingStep, onCellClick }: RowProps) {
  return (
    <>
      <div className="label">{TRACK_LABELS[track]}</div>
      {Array.from({ length: STEPS }).map((_, step) => {
        const cellId = step + track * STEPS
        const on = ((pattern >> BigInt(cellId)) & 1n) === 1n
        const isSynth = cellId >= SYNTH_CELL_START
        const playing = playingStep === step
        const beatStart = step % 4 === 0

        let label = ''
        if (on && isSynth) {
          const offset = cellId - SYNTH_CELL_START
          const pitchIdx = Number((pitches >> BigInt(offset * 3)) & 0x7n) % PITCH_LABELS.length
          label = PITCH_LABELS[pitchIdx]
        }

        const trackName = TRACK_LABELS[track]
        const cls = ['cell']
        if (on) cls.push('on', trackName)
        if (playing) cls.push('playing')
        if (beatStart) cls.push('beat-1')

        return (
          <div
            key={cellId}
            className={cls.join(' ')}
            onClick={(e) => onCellClick(cellId, e.currentTarget.getBoundingClientRect())}
            title={`cell ${cellId}`}
          >
            {label}
          </div>
        )
      })}
    </>
  )
}
