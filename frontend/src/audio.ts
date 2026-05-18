import * as Tone from 'tone'
import { PITCH_LABELS, STEPS, SYNTH_CELL_START } from './config'

let kick: Tone.MembraneSynth | null = null
let snare: Tone.NoiseSynth | null = null
let hat: Tone.MetalSynth | null = null
let synth: Tone.PolySynth | null = null
let seq: Tone.Sequence | null = null

let livePattern = 0n
let livePitches = 0n

let snapshotPattern: bigint | null = null
let snapshotPitches: bigint | null = null

export function setLiveState(pattern: bigint, pitches: bigint) {
  livePattern = pattern
  livePitches = pitches
}

/// When set, the sequencer plays the snapshot instead of live state.
/// Pass nulls to clear and resume live playback.
export function setSnapshot(pattern: bigint | null, pitches: bigint | null) {
  snapshotPattern = pattern
  snapshotPitches = pitches
}

export function snapshotActive(): boolean {
  return snapshotPattern !== null
}

let onStepListener: ((step: number) => void) | null = null
export function onStep(fn: (step: number) => void) {
  onStepListener = fn
}

function bit(pattern: bigint, idx: number): boolean {
  return ((pattern >> BigInt(idx)) & 1n) === 1n
}

function pitchAtFrom(pitches: bigint, synthCellOffset: number): string {
  const idx = Number((pitches >> BigInt(synthCellOffset * 3)) & 0x7n)
  return `${PITCH_LABELS[idx % PITCH_LABELS.length]}4`
}

export async function startAudio() {
  if (seq) return
  await Tone.start()
  // iOS: switch off the default "ambient" audio session so the hardware
  // ring/silent switch doesn't mute Web Audio on the built-in speaker.
  // The user explicitly pressed play, so 'playback' is the right category.
  // Safari 16.4+ / iOS 17+; older iOS lacks the API and silently no-ops
  // (headphone/Bluetooth output is unaffected by the silent switch anyway).
  if ('audioSession' in navigator) {
    try {
      (navigator as { audioSession: { type: string } }).audioSession.type = 'playback'
    } catch {
      // Unsupported value or read-only — leave the default session.
    }
  }
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
      const p = snapshotPattern ?? livePattern
      const ps = snapshotPitches ?? livePitches
      // Track 0 (kick), 1 (snare), 2 (hat) — drums
      if (bit(p, step + 0 * STEPS)) kick?.triggerAttackRelease('C2', '16n', time)
      if (bit(p, step + 1 * STEPS)) snare?.triggerAttackRelease('16n', time)
      if (bit(p, step + 2 * STEPS)) hat?.triggerAttackRelease('C5', '32n', time)
      // Track 3 (synth)
      const synthCellId = step + 3 * STEPS
      if (synthCellId >= SYNTH_CELL_START && bit(p, synthCellId)) {
        const note = pitchAtFrom(ps, synthCellId - SYNTH_CELL_START)
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
