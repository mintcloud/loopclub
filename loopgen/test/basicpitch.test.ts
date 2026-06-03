import { describe, it, expect } from 'vitest'
import { fromBasicPitch, type NoteEvent } from '../src/basicpitch.js'
import { encode, synthPitches } from '../src/codec.js'

describe('fromBasicPitch', () => {
  it('quantizes notes onto the 16-step synth row, loudest wins per step', () => {
    const loopSeconds = 4 // 0.25s per step
    const notes: NoteEvent[] = [
      { startTimeSeconds: 0.0, pitchMidi: 48, amplitude: 0.9 }, // step 0
      { startTimeSeconds: 0.1, pitchMidi: 36, amplitude: 0.2 }, // step 0, quieter → loses
      { startTimeSeconds: 2.0, pitchMidi: 60, amplitude: 0.7 }, // step 8
    ]
    const spec = fromBasicPitch(notes, loopSeconds)
    expect(spec.tracks.length).toBe(1)
    const wire = encode(spec)
    const pitches = synthPitches(wire)
    expect(pitches.get(128)).toBe(48) // step 0, loudest
    expect(pitches.get(136)).toBe(60) // step 8
  })

  it('folds out-of-range pitches into the playable window', () => {
    const spec = fromBasicPitch([{ startTimeSeconds: 0, pitchMidi: 84, amplitude: 1 }], 4)
    const pitch = synthPitches(encode(spec)).get(128)!
    expect(pitch).toBeGreaterThanOrEqual(24)
    expect(pitch).toBeLessThanOrEqual(60)
    expect(pitch % 12).toBe(84 % 12) // pitch class preserved (C)
  })

  it('returns no tracks on empty input or bad loop length', () => {
    expect(fromBasicPitch([], 4).tracks).toEqual([])
    expect(fromBasicPitch([{ startTimeSeconds: 0, pitchMidi: 48, amplitude: 1 }], 0).tracks).toEqual([])
  })
})
