// The human-facing intermediate representation (IR). This is what the user's
// Claude fills in via the MCP `build_loop` tool, what the seeder bot emits, and
// what the Basic Pitch adapter produces. The codec converts it to/from the
// on-chain wire format.

import type { Instrument } from './constants.js'

export type { Instrument }

export interface DrumTrack {
  instrument: Exclude<Instrument, 'synth'>
  /** Active step indices, 0..15. Order-insensitive; duplicates are ignored. */
  steps: number[]
}

export interface SynthTrack {
  instrument: 'synth'
  /** One note per active step. Pitch as MIDI number or note name ("C3","F#3"). */
  notes: { step: number; pitch: number | string }[]
}

export type Track = DrumTrack | SynthTrack

export interface LoopSpec {
  version: 1
  /** Advisory only — tempo lives in the app/contract, not the bit grid. */
  bpm?: number
  /** Optional label, used in share copy. */
  name?: string
  tracks: Track[]
}

/** The on-chain wire format: the two uint256s the contract stores. */
export interface Wire {
  /** bit i set ⇔ cell i is lit. 144 meaningful bits. */
  pattern: bigint
  /** 16-bit word per synth cell; word k (k=cellId-128) holds a 7-bit MIDI note. */
  synthData: bigint
}
