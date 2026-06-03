// Adapter: Spotify Basic Pitch note events → LoopSpec. Basic Pitch (Apache-2.0)
// does audio→MIDI in the browser, so "hum your melody" lives in the app; this
// adapter just quantizes the note events onto the 16-step synth row. The MCP
// server can also expose it for clients that produce MIDI themselves.

import { STEPS } from './constants.js'
import { foldToPlayable } from './pitch.js'
import type { LoopSpec } from './types.js'

export interface NoteEvent {
  startTimeSeconds: number
  pitchMidi: number
  amplitude: number
}

/**
 * Quantize hummed note events to the synth track. For each of the 16 steps,
 * the loudest note starting in that step's time window wins; its pitch is
 * folded into the playable window. Silence → no note (sparse).
 *
 * @param loopSeconds duration of the one bar the user recorded against.
 */
export function fromBasicPitch(notes: NoteEvent[], loopSeconds: number): LoopSpec {
  const synthNotes: { step: number; pitch: number }[] = []
  if (loopSeconds <= 0 || !Number.isFinite(loopSeconds)) {
    return { version: 1, tracks: [] }
  }
  for (let step = 0; step < STEPS; step++) {
    const lo = (step / STEPS) * loopSeconds
    const hi = ((step + 1) / STEPS) * loopSeconds
    let best: NoteEvent | undefined
    for (const n of notes) {
      if (n.startTimeSeconds >= lo && n.startTimeSeconds < hi) {
        if (!best || n.amplitude > best.amplitude) best = n
      }
    }
    if (best) synthNotes.push({ step, pitch: foldToPlayable(best.pitchMidi) })
  }
  return { version: 1, tracks: synthNotes.length ? [{ instrument: 'synth', notes: synthNotes }] : [] }
}
