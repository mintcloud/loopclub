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

const DrumTrack = z.object({
  instrument: z.enum(DRUM_INSTRUMENTS),
  steps: z.array(z.number().int().min(0).max(15)).describe('lit step indices, 0–15'),
})

const SynthTrack = z.object({
  instrument: z.literal('synth'),
  notes: z
    .array(
      z.object({
        step: z.number().int().min(0).max(15),
        pitch: z
          .union([z.number(), z.string()])
          .describe('MIDI note (0–127) or name like "C3" / "F#3"'),
      }),
    )
    .describe('one note per active synth step; the row is monophonic per step'),
})

export const Track = z.discriminatedUnion('instrument', [DrumTrack, SynthTrack])

/** ZodRawShape for `build_loop`. */
export const buildLoopShape = {
  tracks: z.array(Track).min(1).describe('the loop, as a list of tracks'),
  name: z.string().optional().describe('optional label, used in the share copy'),
}

/** ZodRawShape for `describe_loop`. */
export const describeLoopShape = {
  link: z.string().optional().describe('a loopclub ?jam= link or just the jam param'),
  pattern: z.string().optional().describe('alternatively, the raw pattern as a hex/decimal bigint'),
  synthData: z.string().optional().describe('the raw synthData bigint (paired with `pattern`)'),
}

/** ZodRawShape for the `jam` prompt arguments. */
export const jamPromptShape = {
  genre: z.string().optional().describe('e.g. house, techno, boom-bap, dnb'),
  bpm: z.string().optional().describe('advisory tempo, e.g. 124'),
}
