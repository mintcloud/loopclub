import * as Tone from 'tone'
import { STEPS, SYNTH_CELL_START } from './config'

// Nine tracks: 8 drum voices + 1 synth row. The drum voices are all Tone.js
// built-ins (no samples) — kit 0 of the sound-expansion grid.
let kick: Tone.MembraneSynth | null = null
let snare: Tone.NoiseSynth | null = null
let clap: Tone.NoiseSynth | null = null
let closedHat: Tone.MetalSynth | null = null
let openHat: Tone.MetalSynth | null = null
let cowbell: Tone.MetalSynth | null = null
let crash: Tone.MetalSynth | null = null
let ride: Tone.MetalSynth | null = null
let synth: Tone.PolySynth | null = null
let seq: Tone.Sequence | null = null

let livePattern = 0n
let liveSynthData = 0n

let snapshotPattern: bigint | null = null
let snapshotSynthData: bigint | null = null

// One diatonic octave — the 8 scale degrees a synth cell's 3-bit pitch indexes.
const SYNTH_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'] as const

export function setLiveState(pattern: bigint, synthData: bigint) {
  livePattern = pattern
  liveSynthData = synthData
}

/// When set, the sequencer plays the snapshot instead of live state.
/// Pass nulls to clear and resume live playback.
export function setSnapshot(pattern: bigint | null, synthData: bigint | null) {
  snapshotPattern = pattern
  snapshotSynthData = synthData
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

// Synth word is 16 bits per cell; bits 0-2 are the pitch (scale-degree index).
function noteAt(synthData: bigint, synthCellOffset: number): string {
  const idx = Number((synthData >> BigInt(synthCellOffset * 16)) & 0x7n)
  return SYNTH_NOTES[idx] ?? SYNTH_NOTES[0]
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
  clap = new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.002, decay: 0.12, sustain: 0 } }).toDestination()
  clap.volume.value = -6
  closedHat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 8000, octaves: 0.5 }).toDestination()
  closedHat.volume.value = -20
  openHat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.4, release: 0.2 }, harmonicity: 5.1, modulationIndex: 32, resonance: 7000, octaves: 1 }).toDestination()
  openHat.volume.value = -18
  cowbell = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.18, release: 0.05 }, harmonicity: 1.5, modulationIndex: 16, resonance: 4000, octaves: 1.2 }).toDestination()
  cowbell.volume.value = -16
  crash = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.2, release: 0.6 }, harmonicity: 8, modulationIndex: 40, resonance: 9000, octaves: 1.5 }).toDestination()
  crash.volume.value = -20
  ride = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.4, release: 0.2 }, harmonicity: 6, modulationIndex: 28, resonance: 9500, octaves: 1 }).toDestination()
  ride.volume.value = -22
  synth = new Tone.PolySynth(Tone.Synth, { envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.4 } }).toDestination()
  synth.volume.value = -8

  const steps = Array.from({ length: STEPS }, (_, i) => i)
  seq = new Tone.Sequence(
    (time, step) => {
      const p = snapshotPattern ?? livePattern
      const sd = snapshotSynthData ?? liveSynthData
      // Tracks 0-7 are drum voices, in grid-row order.
      if (bit(p, step + 0 * STEPS)) kick?.triggerAttackRelease('C1', '8n', time)
      if (bit(p, step + 1 * STEPS)) snare?.triggerAttackRelease('16n', time)
      if (bit(p, step + 2 * STEPS)) clap?.triggerAttackRelease('16n', time)
      if (bit(p, step + 3 * STEPS)) closedHat?.triggerAttackRelease('C6', '32n', time)
      if (bit(p, step + 4 * STEPS)) openHat?.triggerAttackRelease('C6', '8n', time)
      if (bit(p, step + 5 * STEPS)) cowbell?.triggerAttackRelease('A4', '16n', time)
      if (bit(p, step + 6 * STEPS)) crash?.triggerAttackRelease('C6', '1n', time)
      if (bit(p, step + 7 * STEPS)) ride?.triggerAttackRelease('C7', '4n', time)
      // Track 8 (synth) — pitched by the cell's stored scale degree.
      const synthCellId = step + 8 * STEPS
      if (synthCellId >= SYNTH_CELL_START && bit(p, synthCellId)) {
        const note = noteAt(sd, synthCellId - SYNTH_CELL_START)
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
  clap?.dispose()
  closedHat?.dispose()
  openHat?.dispose()
  cowbell?.dispose()
  crash?.dispose()
  ride?.dispose()
  synth?.dispose()
  kick = snare = clap = closedHat = openHat = cowbell = crash = ride = synth = null
}

export function audioRunning(): boolean {
  return seq !== null
}
