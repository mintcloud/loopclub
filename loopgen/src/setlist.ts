// The setlist — hand-authored, recognisable loops, as opposed to the procedural
// GENRES templates in music.ts. A genre template is a *style*; a setlist entry is
// a *tune*: the terrace riff everyone already knows, squeezed into 16 steps and
// one monophonic synth row.
//
// Constraints worth stating, because they shape every entry below:
//   • 16 steps, one bar. An anthem's phrase is compressed to 16ths — you get the
//     contour and the rhythm, not the full melody.
//   • The synth row is monophonic (one pitch per step) — no chords, no harmony.
//   • Pitches stay inside the app-playable window (C1..C4) so the in-app keyboard
//     can show them and laptop speakers can actually reproduce them.
//
// Melody is identity here: a setlist entry rendered without its synth row is just
// drums. Consumers that must trim (the seeder's cell budget) should drop drum
// cells before synth cells — see chooseCells() in the seeder.

import type { LoopSpec } from './types.js'

/**
 * Recognisable loops, keyed by slug. Same shape as GENRES so callers can build a
 * single pool from both. Each returns a fresh spec (no shared mutable state).
 */
export const SETLIST: Record<string, () => LoopSpec> = {
  'seven-nation-army': () => ({
    version: 1,
    name: 'Seven Nation Army',
    bpm: 120,
    tracks: [
      // The riff: E E G E D C B — the one the whole stadium hums.
      {
        instrument: 'synth',
        notes: [
          { step: 0, pitch: 'E3' },
          { step: 3, pitch: 'E3' },
          { step: 4, pitch: 'G3' },
          { step: 6, pitch: 'E3' },
          { step: 8, pitch: 'D3' },
          { step: 11, pitch: 'C3' },
          { step: 14, pitch: 'B2' },
        ],
      },
      { instrument: 'kick', steps: [0, 8] },
      { instrument: 'clap', steps: [4, 12] },
      { instrument: 'crash', steps: [0] },
    ],
  }),

  'we-will-rock-you': () => ({
    version: 1,
    name: 'We Will Rock You',
    bpm: 81,
    tracks: [
      // Stomp, stomp, CLAP. The oldest crowd instruction in the game.
      { instrument: 'kick', steps: [0, 2, 8, 10] },
      { instrument: 'clap', steps: [4, 12] },
      {
        instrument: 'synth',
        notes: [
          { step: 6, pitch: 'E3' },
          { step: 14, pitch: 'A2' },
        ],
      },
    ],
  }),

  'thunder-clap': () => ({
    version: 1,
    name: 'Thunder Clap (HÚ!)',
    bpm: 100,
    tracks: [
      // The Viking clap: one HÚ on the downbeat, then the accelerando into the
      // next bar. The tightening gaps (8 → 12 → 14 → 15) are the whole trick.
      { instrument: 'clap', steps: [0, 8, 12, 14, 15] },
      { instrument: 'kick', steps: [0, 8] },
      { instrument: 'crash', steps: [0] },
      {
        instrument: 'synth',
        notes: [
          { step: 0, pitch: 'A2' },
          { step: 8, pitch: 'A2' },
        ],
      },
    ],
  }),

  'ole-ole-ole': () => ({
    version: 1,
    name: 'Olé, Olé, Olé',
    bpm: 110,
    tracks: [
      {
        instrument: 'synth',
        notes: [
          { step: 0, pitch: 'G3' },
          { step: 3, pitch: 'E3' },
          { step: 6, pitch: 'C3' },
          { step: 10, pitch: 'D3' },
          { step: 13, pitch: 'E3' },
        ],
      },
      // Claps land on the syllables, which is what makes the chant a chant.
      { instrument: 'clap', steps: [0, 3, 6, 10, 13] },
      { instrument: 'kick', steps: [0, 8] },
    ],
  }),

  batucada: () => ({
    version: 1,
    name: 'Batucada (Brazil)',
    bpm: 100,
    tracks: [
      { instrument: 'kick', steps: [0, 3, 8, 11] }, // surdo
      { instrument: 'cowbell', steps: [2, 6, 10, 14] }, // agogô
      { instrument: 'clap', steps: [4, 12] },
      {
        instrument: 'synth',
        notes: [
          { step: 0, pitch: 'D3' },
          { step: 6, pitch: 'F3' },
          { step: 10, pitch: 'A3' },
        ],
      },
    ],
  }),

  'ode-to-joy': () => ({
    version: 1,
    name: 'Ode to Joy',
    bpm: 120,
    tracks: [
      // Beethoven, the anthem of Europe. Fourteen notes fit a bar exactly, with
      // two steps of air at the end so the loop breathes.
      {
        instrument: 'synth',
        notes: [
          { step: 0, pitch: 'E3' },
          { step: 1, pitch: 'E3' },
          { step: 2, pitch: 'F3' },
          { step: 3, pitch: 'G3' },
          { step: 4, pitch: 'G3' },
          { step: 5, pitch: 'F3' },
          { step: 6, pitch: 'E3' },
          { step: 7, pitch: 'D3' },
          { step: 8, pitch: 'C3' },
          { step: 9, pitch: 'C3' },
          { step: 10, pitch: 'D3' },
          { step: 11, pitch: 'E3' },
          { step: 12, pitch: 'E3' },
          { step: 13, pitch: 'D3' },
        ],
      },
      { instrument: 'kick', steps: [0, 8] },
      { instrument: 'crash', steps: [0] },
    ],
  }),

  marseillaise: () => ({
    version: 1,
    name: 'La Marseillaise',
    bpm: 120,
    tracks: [
      // "Allons enfants de la patrie" — the marching pickup, transposed down so
      // the phrase's top note still lands inside the playable window.
      {
        instrument: 'synth',
        notes: [
          { step: 0, pitch: 'G2' },
          { step: 2, pitch: 'G2' },
          { step: 3, pitch: 'C3' },
          { step: 5, pitch: 'C3' },
          { step: 7, pitch: 'D3' },
          { step: 9, pitch: 'D3' },
          { step: 11, pitch: 'G3' },
          { step: 13, pitch: 'E3' },
          { step: 15, pitch: 'C3' },
        ],
      },
      { instrument: 'kick', steps: [0, 8] },
      { instrument: 'snare', steps: [4, 12] },
      { instrument: 'crash', steps: [0] },
    ],
  }),
}

/** Setlist slugs, in rotation order. */
export const SETLIST_NAMES = Object.keys(SETLIST)
