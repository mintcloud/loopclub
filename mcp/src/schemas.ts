// Zod input shapes for the tools. These mirror loopgen's LoopSpec so the
// validated args drop straight into encode(). Passed to registerTool as the
// `inputSchema` (a ZodRawShape — an object of zod schemas, not z.object()).

import { z } from 'zod'
import type { Instrument } from 'loopclub-loopgen'

// The 8 drum voices as a literal tuple (z.enum needs literal element types, so
// we can't derive this via TRACK_LABELS.filter, which widens to string).
const DRUM_INSTRUMENTS = ['kick', 'snare', 'clap', 'hat', 'open-hat', 'cowbell', 'crash', 'ride'] as const

// Compile-time drift guard: fails to build if a label here isn't a real
// loopgen Instrument (or if a drum voice is ever renamed in the contract).
type _AssertDrumsAreInstruments =
  (typeof DRUM_INSTRUMENTS)[number] extends Exclude<Instrument, 'synth'> ? true : never
const _drumGuard: _AssertDrumsAreInstruments = true
void _drumGuard

// Upper bounds. The grid is only 16 steps × 9 tracks, so a real loop is tiny —
// these caps are loose enough to never reject a legitimate spec but tight enough
// that a malicious caller can't make encode() do unbounded work. They matter
// most when the server is exposed over public, unauthenticated HTTP (the remote
// build): without a `.max()`, `tracks: [<millions>]` is a free CPU/memory DoS.
const MAX_TRACKS = 32 // 9 instruments; 32 tolerates dup/odd tracks, caps the rest
const MAX_STEPS = 16 // a drum row has at most 16 lit steps
const MAX_NOTES = 16 // the synth row is monophonic across 16 steps
const MAX_NAME = 120 // label is cosmetic; cap the share-copy string
// A jam link for a full grid is ~70 base64url chars; 4096 is generous headroom
// while bounding the base64 decode allocation in fromLink().
const MAX_LINK = 4096
const MAX_BIGINT_STR = 128 // a 144-bit value is ≤44 decimal / ≤38 hex chars

const DrumTrack = z.object({
  instrument: z.enum(DRUM_INSTRUMENTS),
  steps: z.array(z.number().int().min(0).max(15)).max(MAX_STEPS).describe('lit step indices, 0–15'),
})

const SynthTrack = z.object({
  instrument: z.literal('synth'),
  notes: z
    .array(
      z.object({
        step: z.number().int().min(0).max(15),
        pitch: z
          .union([z.number(), z.string().max(8)])
          .describe('MIDI note (0–127) or name like "C3" / "F#3"'),
      }),
    )
    .max(MAX_NOTES)
    .describe('one note per active synth step; the row is monophonic per step'),
})

export const Track = z.discriminatedUnion('instrument', [DrumTrack, SynthTrack])

/** ZodRawShape for `build_loop`. */
export const buildLoopShape = {
  tracks: z.array(Track).min(1).max(MAX_TRACKS).describe('the loop, as a list of tracks'),
  name: z.string().max(MAX_NAME).optional().describe('optional label, used in the share copy'),
}

/** ZodRawShape for `describe_loop`. */
export const describeLoopShape = {
  link: z.string().max(MAX_LINK).optional().describe('a loopclub ?jam= link or just the jam param'),
  pattern: z
    .string()
    .max(MAX_BIGINT_STR)
    .optional()
    .describe('alternatively, the raw pattern as a hex/decimal bigint'),
  synthData: z
    .string()
    .max(MAX_BIGINT_STR)
    .optional()
    .describe('the raw synthData bigint (paired with `pattern`)'),
}

/** ZodRawShape for the `jam` prompt arguments. */
export const jamPromptShape = {
  genre: z.string().optional().describe('e.g. house, techno, boom-bap, dnb'),
  bpm: z.string().optional().describe('advisory tempo, e.g. 124'),
}
