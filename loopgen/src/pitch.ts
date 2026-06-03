// Pitch helpers: MIDI ↔ note-name conversion, and the two clamps (valid vs
// playable). Kept separate from the codec so the codec stays purely about bits.

import {
  PITCH_VALID_MIN,
  PITCH_VALID_MAX,
  PITCH_PLAYABLE_MIN,
  PITCH_PLAYABLE_MAX,
} from './constants.js'

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

// Map a note letter (+ optional accidental) to its semitone offset within an
// octave. Supports both sharps (#) and flats (b).
const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/**
 * Convert a note name like "C3", "F#3", "Eb1", or "A#-1" to a MIDI note number,
 * using scientific pitch notation (MIDI 60 = C4). A plain number passes through.
 * Throws on an unparseable string so bad input surfaces instead of silently
 * encoding garbage.
 */
export function toMidi(pitch: number | string): number {
  if (typeof pitch === 'number') return Math.round(pitch)
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(pitch.trim())
  if (!m) throw new Error(`unparseable pitch: ${JSON.stringify(pitch)}`)
  const letter = m[1]!.toUpperCase()
  const accidental = m[2]!
  const octave = parseInt(m[3]!, 10)
  let semitone = LETTER_SEMITONE[letter]!
  if (accidental === '#') semitone += 1
  else if (accidental === 'b') semitone -= 1
  // MIDI 0 = C-1, so C(octave) = (octave + 1) * 12.
  return (octave + 1) * 12 + semitone
}

/** Convert a MIDI note number to a sharp-spelled scientific name, e.g. 48 → "C3". */
export function midiToName(midi: number): string {
  const cls = PITCH_CLASS_NAMES[((midi % 12) + 12) % 12]!
  const octave = Math.floor(midi / 12) - 1
  return `${cls}${octave}`
}

/** Clamp to the contract-valid 7-bit MIDI range (0..127). Used by the codec. */
export function clampValid(midi: number): number {
  return Math.max(PITCH_VALID_MIN, Math.min(PITCH_VALID_MAX, midi))
}

/**
 * Octave-fold a note into the in-app playable window (C1..C4) so a hummed or
 * generated melody always lands somewhere the keyboard can show and the speaker
 * can voice. Folding (not clamping) preserves pitch class — a high C stays a C.
 * Used by input adapters, never by the codec's faithful round-trip.
 */
export function foldToPlayable(midi: number): number {
  let m = Math.round(midi)
  while (m > PITCH_PLAYABLE_MAX) m -= 12
  while (m < PITCH_PLAYABLE_MIN) m += 12
  // Pathological inputs (NaN, ±Infinity) can't be folded into range; clamp.
  if (!Number.isFinite(m)) return PITCH_PLAYABLE_MIN
  return m
}
