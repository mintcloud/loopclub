import * as Tone from 'tone'
import { PITCH_LABELS, STEPS, SYNTH_CELL_START } from './config'

let kick: Tone.MembraneSynth | null = null
let snare: Tone.NoiseSynth | null = null
let hat: Tone.MetalSynth | null = null
let synth: Tone.PolySynth | null = null
let seq: Tone.Sequence | null = null

let livePattern = 0n
let livePitches = 0n

export function setLiveState(pattern: bigint, pitches: bigint) {
  livePattern = pattern
  livePitches = pitches
}

let onStepListener: ((step: number) => void) | null = null
export function onStep(fn: (step: number) => void) {
  onStepListener = fn
}

function bit(pattern: bigint, idx: number): boolean {
  return ((pattern >> BigInt(idx)) & 1n) === 1n
}

function pitchAt(synthCellOffset: number): string {
  const idx = Number((livePitches >> BigInt(synthCellOffset * 3)) & 0x7n)
  return `${PITCH_LABELS[idx % PITCH_LABELS.length]}4`
}

export async function startAudio() {
  if (seq) return
  await Tone.start()
  // 60 BPM × 16th-notes = 250ms/step, 16 steps = 4s — matches LOOP_DURATION_SECONDS.
  Tone.Transport.bpm.value = 60

  kick = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 4, envelope: { attack: 0.001, decay: 0.4, sustain: 0 } }).toDestination()
  snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).toDestination()
  hat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 8000, octaves: 0.5 }).toDestination()
  hat.volume.value = -18
  synth = new Tone.PolySynth(Tone.Synth, { envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.4 } }).toDestination()
  synth.volume.value = -8

  const steps = Array.from({ length: STEPS }, (_, i) => i)
  seq = new Tone.Sequence(
    (time, step) => {
      // Track 0 (kick), 1 (snare), 2 (hat) — drums
      if (bit(livePattern, step + 0 * STEPS)) kick?.triggerAttackRelease('C2', '16n', time)
      if (bit(livePattern, step + 1 * STEPS)) snare?.triggerAttackRelease('16n', time)
      if (bit(livePattern, step + 2 * STEPS)) hat?.triggerAttackRelease('C5', '32n', time)
      // Track 3 (synth)
      const synthCellId = step + 3 * STEPS
      if (synthCellId >= SYNTH_CELL_START && bit(livePattern, synthCellId)) {
        const note = pitchAt(synthCellId - SYNTH_CELL_START)
        synth?.triggerAttackRelease(note, '8n', time)
      }
      Tone.getDraw().schedule(() => onStepListener?.(step), time)
    },
    steps,
    '16n'
  )
  seq.start(0)
  Tone.Transport.start()
}

export function stopAudio() {
  Tone.Transport.stop()
  seq?.dispose()
  seq = null
  kick?.dispose()
  snare?.dispose()
  hat?.dispose()
  synth?.dispose()
  kick = snare = hat = synth = null
}

export function audioRunning(): boolean {
  return seq !== null
}
