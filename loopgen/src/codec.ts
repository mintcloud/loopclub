// The core, deterministic codec: LoopSpec ⇄ Wire. Pure. Mirrors the contract
// bit layout (Loopclub.sol) and the frontend (useLiveGrid.ts) exactly:
//   pattern   |= 1n << BigInt(cellId)
//   synthData |= BigInt(midi & 0x7f) << BigInt((cellId - SYNTH_CELL_START) * 16)

import {
  STEPS,
  CELLS,
  SYNTH_CELL_START,
  SYNTH_TRACK,
  TRACK_LABELS,
  isSynthCell,
  type Instrument,
} from './constants.js'
import { toMidi, clampValid } from './pitch.js'
import type { LoopSpec, Track, Wire } from './types.js'

const WORD_MASK = 0xffffn
const NOTE_MASK = 0x7fn

function trackIndex(instrument: Instrument): number {
  return TRACK_LABELS.indexOf(instrument)
}

/**
 * spec → wire. Pure and canonical: the same spec always yields the same Wire,
 * and only lit synth cells contribute to synthData (a non-lit cell's word is 0).
 * Out-of-range steps are skipped; pitches are clamped to the valid 7-bit range.
 */
export function encode(spec: LoopSpec): Wire {
  let pattern = 0n
  let synthData = 0n
  for (const t of spec.tracks) {
    const track = trackIndex(t.instrument)
    if (track < 0) continue
    if (t.instrument === 'synth') {
      for (const { step, pitch } of t.notes) {
        if (!Number.isInteger(step) || step < 0 || step >= STEPS) continue
        const id = track * STEPS + step // 128..143
        pattern |= 1n << BigInt(id)
        const midi = clampValid(toMidi(pitch))
        const word = BigInt(midi) & NOTE_MASK
        synthData |= word << BigInt((id - SYNTH_CELL_START) * 16)
      }
    } else {
      for (const step of t.steps) {
        if (!Number.isInteger(step) || step < 0 || step >= STEPS) continue
        pattern |= 1n << BigInt(track * STEPS + step)
      }
    }
  }
  return { pattern, synthData }
}

/**
 * wire → spec. The inverse of encode for any canonical wire. Drum tracks list
 * their lit steps; the synth track lists {step, pitch} pairs with the raw MIDI
 * number (lossless — never folded). Empty tracks are omitted.
 */
export function decode(wire: Wire): LoopSpec {
  const drumSteps: number[][] = Array.from({ length: SYNTH_TRACK }, () => [])
  const synthNotes: { step: number; pitch: number }[] = []

  for (let id = 0; id < CELLS; id++) {
    if (((wire.pattern >> BigInt(id)) & 1n) === 0n) continue
    const track = Math.floor(id / STEPS)
    const step = id % STEPS
    if (isSynthCell(id)) {
      const word = (wire.synthData >> BigInt((id - SYNTH_CELL_START) * 16)) & WORD_MASK
      synthNotes.push({ step, pitch: Number(word & NOTE_MASK) })
    } else {
      drumSteps[track]!.push(step)
    }
  }

  const tracks: Track[] = []
  for (let track = 0; track < SYNTH_TRACK; track++) {
    const steps = drumSteps[track]!
    if (steps.length === 0) continue
    tracks.push({ instrument: TRACK_LABELS[track]! as Exclude<Instrument, 'synth'>, steps })
  }
  if (synthNotes.length > 0) tracks.push({ instrument: 'synth', notes: synthNotes })

  return { version: 1, tracks }
}

/** List of lit cellIds (0..143). Shaped to feed the frontend's `previewCells`. */
export function litCells(wire: Wire): number[] {
  const out: number[] = []
  for (let id = 0; id < CELLS; id++) {
    if (((wire.pattern >> BigInt(id)) & 1n) === 1n) out.push(id)
  }
  return out
}

/**
 * Map of lit synth cellId → 7-bit MIDI note. This is exactly the `pitchMap` the
 * jam-mode commit path needs (so a jammed synth cell's pitch survives into the
 * rentBatch call without being on the live grid yet — see jam-preview spec §7).
 */
export function synthPitches(wire: Wire): Map<number, number> {
  const out = new Map<number, number>()
  for (let id = SYNTH_CELL_START; id < CELLS; id++) {
    if (((wire.pattern >> BigInt(id)) & 1n) === 0n) continue
    const word = (wire.synthData >> BigInt((id - SYNTH_CELL_START) * 16)) & WORD_MASK
    out.set(id, Number(word & NOTE_MASK))
  }
  return out
}

/** Count of lit cells — cheap, avoids materialising litCells(). */
export function cellCount(wire: Wire): number {
  let n = 0
  let p = wire.pattern
  while (p > 0n) {
    n += Number(p & 1n)
    p >>= 1n
  }
  return n
}
