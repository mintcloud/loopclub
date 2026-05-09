import { useState } from 'react'
import { PITCH_LABELS, SYNTH_CELL_START, LOOP_DURATION_SECONDS, TRACK_LABELS, STEPS } from './config'

interface Props {
  cellId: number
  onClose: () => void
  onSubmit: (durationLoops: number, pitchIdx: number) => void
}

export function ToggleModal({ cellId, onClose, onSubmit }: Props) {
  const [duration, setDuration] = useState(4)
  const [pitch, setPitch] = useState(0)
  const isSynth = cellId >= SYNTH_CELL_START
  const track = Math.floor(cellId / STEPS)
  const step = cellId % STEPS

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          rent cell #{cellId} · {TRACK_LABELS[track]} step {step + 1}
        </h3>
        <label>
          duration (loops × {LOOP_DURATION_SECONDS}s)
          <input
            type="number"
            min={1}
            max={32}
            value={duration}
            onChange={(e) => setDuration(Math.max(1, Math.min(32, Number(e.target.value) || 1)))}
          />
        </label>
        {isSynth && (
          <div className="pitch-picker">
            <span className="pitch-label">pitch</span>
            <Keyboard selected={pitch} onSelect={setPitch} />
          </div>
        )}
        <div className="muted">
          cost: {(0.004 * duration).toFixed(3)} USDm · live for {duration * LOOP_DURATION_SECONDS}s
        </div>
        <div className="row">
          <button onClick={onClose}>cancel</button>
          <button className="hot" onClick={() => onSubmit(32, pitch)}>
            max toggle
          </button>
          <button className="primary" onClick={() => onSubmit(duration, pitch)}>
            toggle
          </button>
        </div>
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
