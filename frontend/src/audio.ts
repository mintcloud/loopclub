import * as Tone from 'tone'
import { STEPS, SYNTH_CELL_START } from './config'

// Kit 0 — a Roland TR-808 voiced entirely from Tone.js built-ins (no samples),
// plus a TB-303-style acid synth on the last track. Each voice is synthesised
// the way the original hardware makes the sound:
//   kick    — sine + fast pitch drop                 (MembraneSynth)
//   snare   — noise crack + tonal body               (NoiseSynth + Synth)
//   clap    — bandpassed white-noise burst           (NoiseSynth + Filter)
//   hats    — the 808 cymbal FM model itself         (MetalSynth)
//   cowbell — two detuned square tones + bandpass    (PolySynth + Filter)
//   crash   — long inharmonic cymbal                 (MetalSynth)
//   ride    — brighter, shorter cymbal               (MetalSynth)
//   synth   — acid: saw → resonant filter sweep + glide + drive (MonoSynth)
let kick: Tone.MembraneSynth | null = null
let snareNoise: Tone.NoiseSynth | null = null
let snareBody: Tone.Synth | null = null
let snareFilter: Tone.Filter | null = null
let clap: Tone.NoiseSynth | null = null
let clapFilter: Tone.Filter | null = null
let closedHat: Tone.MetalSynth | null = null
let openHat: Tone.MetalSynth | null = null
let cowbell: Tone.PolySynth | null = null
let cowbellFilter: Tone.Filter | null = null
let crash: Tone.MetalSynth | null = null
let ride: Tone.MetalSynth | null = null
let acid: Tone.MonoSynth | null = null
let acidDrive: Tone.Distortion | null = null
let seq: Tone.Sequence | null = null

let livePattern = 0n
let liveSynthData = 0n

let snapshotPattern: bigint | null = null
let snapshotSynthData: bigint | null = null

// One octave of an acid bassline — the 8 scale degrees a synth cell indexes,
// pitched low (C2–C3) where a 303 line lives.
const SYNTH_NOTES = ['C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2', 'C3'] as const

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

// Build every voice without starting the sequencer. Idempotent — safe to call
// from a one-shot cell preview as well as from startAudio(). Tone.start() needs
// a user gesture; a cell click or a Play press satisfies that.
export async function ensureVoices() {
  if (kick) return
  await Tone.start()
  // iOS: switch off the default "ambient" audio session so the hardware
  // ring/silent switch doesn't mute Web Audio on the built-in speaker.
  // The user explicitly pressed play / a cell, so 'playback' is the right
  // category. Safari 16.4+ / iOS 17+; older iOS lacks the API and no-ops.
  if ('audioSession' in navigator) {
    try {
      (navigator as { audioSession: { type: string } }).audioSession.type = 'playback'
    } catch {
      // Unsupported value or read-only — leave the default session.
    }
  }
  // 60 BPM × 16th-notes = 250ms/step, 16 steps = 4s — matches LOOP_DURATION_SECONDS.
  Tone.Transport.bpm.value = 60

  // ── Track 0 · bass drum — sine with a fast pitch drop and a long tail ──
  kick = new Tone.MembraneSynth({
    pitchDecay: 0.045,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.1 },
  }).toDestination()

  // ── Track 1 · snare — a white-noise crack over a short tonal body ──
  snareFilter = new Tone.Filter({ type: 'highpass', frequency: 1200 }).toDestination()
  snareNoise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
  }).connect(snareFilter)
  snareNoise.volume.value = -8
  snareBody = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.02 },
  }).toDestination()
  snareBody.volume.value = -11

  // ── Track 2 · hand clap — a bandpassed white-noise burst ──
  clapFilter = new Tone.Filter({ type: 'bandpass', frequency: 1100, Q: 1.2 }).toDestination()
  clap = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.002, decay: 0.22, sustain: 0 },
  }).connect(clapFilter)
  clap.volume.value = -6

  // ── Tracks 3-4 · hi-hats — MetalSynth IS the 808 cymbal/hat FM model ──
  closedHat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.06, release: 0.01 },
    harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5,
  }).toDestination()
  closedHat.volume.value = -16
  openHat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.5, release: 0.2 },
    harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5,
  }).toDestination()
  openHat.volume.value = -18

  // ── Track 5 · cowbell — two detuned square tones through a bandpass.
  //    MetalSynth can't do this: its highpass guts a cowbell's body.
  cowbellFilter = new Tone.Filter({ type: 'bandpass', frequency: 2640, Q: 1.4 }).toDestination()
  cowbell = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'square' },
    envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.05 },
  }).connect(cowbellFilter)
  cowbell.volume.value = -12

  // ── Tracks 6-7 · crash + ride — long / short inharmonic cymbals ──
  crash = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 1.6, release: 0.6 },
    harmonicity: 5.1, modulationIndex: 40, resonance: 5000, octaves: 2,
  }).toDestination()
  crash.volume.value = -20
  ride = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.5, release: 0.3 },
    harmonicity: 6.5, modulationIndex: 28, resonance: 6000, octaves: 1.5,
  }).toDestination()
  ride.volume.value = -22

  // ── Track 8 · acid synth — TB-303 shape: a sawtooth through a resonant
  //    lowpass whose cutoff the filter envelope sweeps on every note, plus
  //    portamento (the signature glide) and a touch of overdrive.
  acidDrive = new Tone.Distortion({ distortion: 0.32, wet: 0.45 }).toDestination()
  acid = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { type: 'lowpass', rolloff: -24, Q: 7 },
    envelope: { attack: 0.005, decay: 0.18, sustain: 0.25, release: 0.2 },
    filterEnvelope: {
      attack: 0.01, decay: 0.28, sustain: 0.15, release: 0.25,
      baseFrequency: 120, octaves: 4.2, exponent: 2,
    },
  }).connect(acidDrive)
  acid.portamento = 0.045 // glide between consecutive notes — the 303 slide
  acid.volume.value = -8
}

export async function startAudio() {
  if (seq) return
  await ensureVoices()

  const steps = Array.from({ length: STEPS }, (_, i) => i)
  seq = new Tone.Sequence(
    (time, step) => {
      const p = snapshotPattern ?? livePattern
      const sd = snapshotSynthData ?? liveSynthData
      // Tracks 0-7 are drum voices, in grid-row order.
      if (bit(p, step + 0 * STEPS)) kick?.triggerAttackRelease('C1', '8n', time)
      if (bit(p, step + 1 * STEPS)) {
        snareNoise?.triggerAttackRelease('16n', time)
        snareBody?.triggerAttackRelease('G3', '16n', time)
      }
      if (bit(p, step + 2 * STEPS)) clap?.triggerAttackRelease('16n', time)
      if (bit(p, step + 3 * STEPS)) closedHat?.triggerAttackRelease('C6', '32n', time)
      if (bit(p, step + 4 * STEPS)) openHat?.triggerAttackRelease('C6', '8n', time)
      if (bit(p, step + 5 * STEPS)) cowbell?.triggerAttackRelease([540, 800], '16n', time)
      if (bit(p, step + 6 * STEPS)) crash?.triggerAttackRelease('C6', '1n', time)
      if (bit(p, step + 7 * STEPS)) ride?.triggerAttackRelease('C7', '4n', time)
      // Track 8 (acid synth) — pitched by the cell's stored scale degree.
      const synthCellId = step + 8 * STEPS
      if (synthCellId >= SYNTH_CELL_START && bit(p, synthCellId)) {
        const note = noteAt(sd, synthCellId - SYNTH_CELL_START)
        acid?.triggerAttackRelease(note, '8n', time)
      }
      Tone.getDraw().schedule(() => onStepListener?.(step), time)
    },
    steps,
    '16n'
  )
  seq.start(0)
  Tone.Transport.start()
}

// Stop the 16-step sequencer. The voices are deliberately kept alive so
// audition-mode cell preview keeps working after Play is switched off.
export function stopAudio() {
  Tone.Transport.stop()
  seq?.dispose()
  seq = null
}

export function audioRunning(): boolean {
  return seq !== null
}

// Play one cell's voice once, immediately — the audition-mode primitive. Lets a
// player hear a sound before paying to rent the cell. Independent of the
// sequencer: works whether or not the loop is playing. `pitchIdx` only matters
// for synth-row cells (track 8); drum voices ignore it.
export async function previewCell(cellId: number, pitchIdx = 0) {
  await ensureVoices()
  const track = Math.floor(cellId / STEPS)
  const t = Tone.now()
  switch (track) {
    case 0:
      kick?.triggerAttackRelease('C1', '8n', t)
      break
    case 1:
      snareNoise?.triggerAttackRelease('16n', t)
      snareBody?.triggerAttackRelease('G3', '16n', t)
      break
    case 2:
      clap?.triggerAttackRelease('16n', t)
      break
    case 3:
      closedHat?.triggerAttackRelease('C6', '32n', t)
      break
    case 4:
      openHat?.triggerAttackRelease('C6', '8n', t)
      break
    case 5:
      cowbell?.triggerAttackRelease([540, 800], '16n', t)
      break
    case 6:
      crash?.triggerAttackRelease('C6', '1n', t)
      break
    case 7:
      ride?.triggerAttackRelease('C7', '4n', t)
      break
    case 8:
      acid?.triggerAttackRelease(SYNTH_NOTES[pitchIdx & 0x7] ?? SYNTH_NOTES[0], '8n', t)
      break
  }
}
