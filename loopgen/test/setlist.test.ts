import { describe, it, expect } from 'vitest'
import { SETLIST, SETLIST_NAMES } from '../src/setlist.js'
import { encode, decode, cellCount } from '../src/codec.js'
import { toMidi } from '../src/pitch.js'
import { toJamParam, fromLink } from '../src/link.js'
import { PITCH_PLAYABLE_MIN, PITCH_PLAYABLE_MAX, STEPS } from '../src/constants.js'

describe('SETLIST', () => {
  it('is non-empty and every entry returns a fresh spec', () => {
    expect(SETLIST_NAMES.length).toBeGreaterThan(0)
    for (const name of SETLIST_NAMES) {
      const a = SETLIST[name]!()
      const b = SETLIST[name]!()
      expect(a).not.toBe(b)
      a.tracks.length = 0
      expect(b.tracks.length).toBeGreaterThan(0)
    }
  })

  it('every entry carries a melody — the tune is the point', () => {
    for (const name of SETLIST_NAMES) {
      const spec = SETLIST[name]!()
      const synth = spec.tracks.find((t) => t.instrument === 'synth')
      expect(synth, `${name} has no synth track`).toBeDefined()
      expect(synth!.instrument === 'synth' && synth!.notes.length).toBeGreaterThan(0)
    }
  })

  it('keeps every pitch inside the app-playable window', () => {
    for (const name of SETLIST_NAMES) {
      const spec = SETLIST[name]!()
      for (const track of spec.tracks) {
        if (track.instrument !== 'synth') continue
        for (const n of track.notes) {
          const midi = toMidi(n.pitch)
          expect(midi, `${name} step ${n.step}`).toBeGreaterThanOrEqual(PITCH_PLAYABLE_MIN)
          expect(midi, `${name} step ${n.step}`).toBeLessThanOrEqual(PITCH_PLAYABLE_MAX)
        }
      }
    }
  })

  it('never puts two notes on one synth step (the row is monophonic)', () => {
    for (const name of SETLIST_NAMES) {
      const spec = SETLIST[name]!()
      for (const track of spec.tracks) {
        if (track.instrument !== 'synth') continue
        const steps = track.notes.map((n) => n.step)
        expect(new Set(steps).size, `${name} has duplicate synth steps`).toBe(steps.length)
        expect(steps.every((s) => s >= 0 && s < STEPS)).toBe(true)
      }
    }
  })

  it('round-trips through the wire format and a deep link', () => {
    for (const name of SETLIST_NAMES) {
      const spec = SETLIST[name]!()
      const wire = encode(spec)
      expect(cellCount(wire)).toBeGreaterThan(0)
      expect(fromLink(toJamParam(wire))).toEqual(wire)
      // Decoding recovers the same lit cells the spec described.
      expect(encode(decode(wire))).toEqual(wire)
    }
  })
})
