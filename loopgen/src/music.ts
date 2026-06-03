// Musical generators — produce LoopSpec fragments. The MCP client's Claude can
// call these or hand-author steps; the headless seeder bot leans on them. Genre
// templates double as few-shot examples exposed to the MCP client so generated
// loops are idiomatic rather than random cells.

import { STEPS } from './constants.js'
import { foldToPlayable, toMidi } from './pitch.js'
import type { LoopSpec, SynthTrack } from './types.js'

/**
 * Euclidean rhythm — distribute `pulses` as evenly as possible across `steps`,
 * normalized so the first pulse lands on the downbeat, then optionally rotated.
 * Returns the active step indices. e.g. euclid(4, 16) → [0, 4, 8, 12] and
 * euclid(5, 16) → [0, 3, 6, 9, 12].
 */
export function euclid(pulses: number, steps = STEPS, rotate = 0): number[] {
  const p = Math.max(0, Math.floor(pulses))
  if (steps <= 0 || p <= 0) return []
  if (p >= steps) return [...Array(steps).keys()]
  // Bresenham line accumulator — the textbook even-spread that yields the
  // Euclidean pattern for these grid sizes.
  const hits: number[] = []
  let bucket = 0
  for (let i = 0; i < steps; i++) {
    bucket += p
    if (bucket >= steps) {
      bucket -= steps
      hits.push(i)
    }
  }
  // Shift so the first pulse is on step 0 (the downbeat reads as intentional).
  const first = hits[0]!
  let norm = hits.map((h) => h - first)
  if (rotate) {
    const r = ((rotate % steps) + steps) % steps
    norm = norm.map((h) => (h + r) % steps).sort((a, b) => a - b)
  }
  return norm
}

export type Scale = 'major' | 'minor' | 'dorian' | 'phrygian' | 'pentatonicMinor' | 'chromatic'

const SCALE_INTERVALS: Record<Scale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  pentatonicMinor: [0, 3, 5, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

/**
 * MIDI notes of a scale starting at `root` (name or MIDI), spanning `octaves`,
 * each folded into the in-app playable window so generated melodies stay
 * audible and keyboard-visible.
 */
export function scaleNotes(root: number | string, mode: Scale = 'minor', octaves = 2): number[] {
  const base = toMidi(root)
  const out: number[] = []
  for (let o = 0; o < octaves; o++) {
    for (const iv of SCALE_INTERVALS[mode]) {
      out.push(foldToPlayable(base + iv + o * 12))
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b)
}

function synthLine(steps: number[], pitches: number[]): SynthTrack {
  return {
    instrument: 'synth',
    notes: steps.map((step, i) => ({ step, pitch: pitches[i % pitches.length]! })),
  }
}

/**
 * Genre templates — idiomatic starting points. Each returns a fresh LoopSpec
 * (no shared mutable state). Drum patterns are hand-tuned; synth lines walk a
 * scale so they sit in key.
 */
export const GENRES: Record<string, () => LoopSpec> = {
  house: () => ({
    version: 1,
    name: 'house',
    bpm: 124,
    tracks: [
      { instrument: 'kick', steps: [0, 4, 8, 12] },
      { instrument: 'clap', steps: [4, 12] },
      { instrument: 'hat', steps: [2, 6, 10, 14] },
      { instrument: 'open-hat', steps: [2, 10] },
      synthLine([0, 8, 14], scaleNotes('A2', 'minor', 1)),
    ],
  }),
  'boom-bap': () => ({
    version: 1,
    name: 'boom-bap',
    bpm: 90,
    tracks: [
      { instrument: 'kick', steps: [0, 7, 10] },
      { instrument: 'snare', steps: [4, 12] },
      { instrument: 'hat', steps: [0, 2, 4, 6, 8, 10, 12, 14] },
      synthLine([0, 6, 11], scaleNotes('C3', 'dorian', 1)),
    ],
  }),
  techno: () => ({
    version: 1,
    name: 'techno',
    bpm: 132,
    tracks: [
      { instrument: 'kick', steps: [0, 4, 8, 12] },
      { instrument: 'hat', steps: [2, 6, 10, 14] },
      { instrument: 'clap', steps: [4, 12] },
      { instrument: 'ride', steps: euclid(7, 16) },
      synthLine([0, 3, 8, 11], scaleNotes('C2', 'phrygian', 1)),
    ],
  }),
  dnb: () => ({
    version: 1,
    name: 'dnb',
    bpm: 174,
    tracks: [
      { instrument: 'kick', steps: [0, 10] },
      { instrument: 'snare', steps: [4, 12] },
      { instrument: 'hat', steps: euclid(11, 16) },
      synthLine([0, 6], scaleNotes('A1', 'minor', 1)),
    ],
  }),
}

/**
 * Nudge a loop's density up or down by `amt` (-1..1): positive adds stray drum
 * hits on empty steps, negative thins existing ones. Deterministic given `rng`
 * so it's testable; defaults to Math.random. Never touches the synth track
 * (melody changes are a different kind of edit).
 */
export function humanize(spec: LoopSpec, amt: number, rng: () => number = Math.random): LoopSpec {
  const tracks = spec.tracks.map((t) => {
    if (t.instrument === 'synth') return { ...t, notes: [...t.notes] }
    const present = new Set(t.steps)
    if (amt >= 0) {
      const empty = [...Array(STEPS).keys()].filter((s) => !present.has(s))
      for (const s of empty) if (rng() < amt * 0.25) present.add(s)
    } else {
      for (const s of [...present]) if (rng() < -amt * 0.5) present.delete(s)
    }
    return { ...t, steps: [...present].sort((a, b) => a - b) }
  })
  return { ...spec, tracks }
}
