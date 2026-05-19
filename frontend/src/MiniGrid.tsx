import { STEPS, TRACKS, TRACK_LABELS } from './config'

interface MiniGridProps {
  pattern: bigint
  synthData: bigint
  playingStep?: number
}

export function MiniGrid({ pattern, synthData: _synthData, playingStep = -1 }: MiniGridProps) {
  return (
    <div className="mini-grid">
      {Array.from({ length: TRACKS }).map((_, track) => (
        <div key={track} className="mini-row">
          {Array.from({ length: STEPS }).map((_, step) => {
            const cellId = step + track * STEPS
            const on = ((pattern >> BigInt(cellId)) & 1n) === 1n
            const trackName = TRACK_LABELS[track]
            const playing = playingStep === step
            const cls = ['mini-cell']
            if (on) cls.push('on', trackName)
            if (playing) cls.push('playing')
            if (step % 4 === 0) cls.push('beat-1')
            return <div key={cellId} className={cls.join(' ')} />
          })}
        </div>
      ))}
    </div>
  )
}
