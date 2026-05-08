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
          <label>
            pitch
            <select value={pitch} onChange={(e) => setPitch(Number(e.target.value))}>
              {PITCH_LABELS.map((p, i) => (
                <option key={i} value={i}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="muted">
          cost: {(0.004 * duration).toFixed(3)} USDm · live for {duration * LOOP_DURATION_SECONDS}s
        </div>
        <div className="row">
          <button onClick={onClose}>cancel</button>
          <button className="primary" onClick={() => onSubmit(duration, pitch)}>
            toggle
          </button>
        </div>
      </div>
    </div>
  )
}
