// Grid + wire-format constants. These mirror the on-chain contract
// (contracts/src/Loopclub.sol) and the frontend (frontend/src/config.ts)
// EXACTLY — loopgen is the single source of truth the frontend should migrate
// onto, so any drift here is a round-trip bug.
//
// Contract facts (Loopclub.sol):
//   CELLS = 144, SYNTH_CELL_START = 128, PITCH_OPTIONS = 128 (cellData < 128).
//   pattern    : bit i set  ⇔ cell i is lit.
//   synthData  : 16-bit word per synth cell; word k (k = cellId-128) at bits
//                [k*16 .. k*16+15]; bits 0-6 of the word = 7-bit MIDI note.

/** Steps per track (one bar, 16th-note grid). */
export const STEPS = 16
/** Tracks (8 drum voices + 1 synth row). */
export const TRACKS = 9
/** Total cells: STEPS * TRACKS. */
export const CELLS = STEPS * TRACKS // 144
/** First cellId of the synth row (track 8 → 8 * 16). Cells >= this carry a pitch. */
export const SYNTH_CELL_START = 128
/** Number of synth cells (one row of STEPS). */
export const SYNTH_CELLS = CELLS - SYNTH_CELL_START // 16

/**
 * Track labels, index 0..8. Double as CSS class names in the app, so they are
 * kept space-free. The 9th (`synth`) is the melodic row.
 */
export const TRACK_LABELS = [
  'kick',
  'snare',
  'clap',
  'hat',
  'open-hat',
  'cowbell',
  'crash',
  'ride',
  'synth',
] as const

export type Instrument = (typeof TRACK_LABELS)[number]

/** Index of the synth track within TRACK_LABELS. */
export const SYNTH_TRACK = TRACK_LABELS.indexOf('synth') // 8

// ───── Pitch ranges ─────
// Two distinct ranges, and conflating them is the classic bug:
//   • CONTRACT-VALID: any 7-bit MIDI note, 0..127. encode()/decode() must
//     round-trip the full range faithfully — the seeder bot and other clients
//     can (and will) write notes outside the in-app keyboard window.
//   • APP-PLAYABLE: the subset the in-app piano exposes, C1..C4 (24..60). Used
//     ONLY by input adapters (hum-to-loop, generators) to keep produced melodies
//     inside the range the keyboard can display and laptop speakers can hear.

/** Lowest valid 7-bit MIDI note the contract accepts. */
export const PITCH_VALID_MIN = 0
/** Highest valid 7-bit MIDI note the contract accepts (PITCH_OPTIONS - 1). */
export const PITCH_VALID_MAX = 127

/** Low end of the in-app keyboard — C1. */
export const PITCH_PLAYABLE_MIN = 24
/** High end of the in-app keyboard — C4 (inclusive). */
export const PITCH_PLAYABLE_MAX = 60
/** Default synth pitch — C3, mid-range (sub-bass reads as silent on laptops). */
export const PITCH_DEFAULT = 48

/** cellId → track index (0..8). */
export function trackOf(cellId: number): number {
  return Math.floor(cellId / STEPS)
}
/** cellId → step index (0..15). */
export function stepOf(cellId: number): number {
  return cellId % STEPS
}
/** (track, step) → cellId. */
export function cellId(track: number, step: number): number {
  return track * STEPS + step
}
/** True when this cell belongs to the synth (melodic) row. */
export function isSynthCell(id: number): boolean {
  return id >= SYNTH_CELL_START
}
