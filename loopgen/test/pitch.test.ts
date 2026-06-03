import { describe, it, expect } from 'vitest'
import { toMidi, midiToName, foldToPlayable, clampValid } from '../src/pitch.js'

describe('pitch', () => {
  it('parses scientific note names to MIDI', () => {
    expect(toMidi('C3')).toBe(48)
    expect(toMidi('C4')).toBe(60)
    expect(toMidi('C1')).toBe(24)
    expect(toMidi('C-1')).toBe(0)
    expect(toMidi('F#3')).toBe(54)
    expect(toMidi('Eb1')).toBe(27)
    expect(toMidi('A2')).toBe(45)
    expect(toMidi(50)).toBe(50)
  })

  it('round-trips MIDI → name → MIDI for naturals', () => {
    for (const midi of [0, 24, 36, 48, 60, 72]) {
      expect(toMidi(midiToName(midi))).toBe(midi)
    }
  })

  it('throws on garbage', () => {
    expect(() => toMidi('not-a-note')).toThrow()
    expect(() => toMidi('H9')).toThrow()
  })

  it('folds into the playable window, preserving pitch class', () => {
    expect(foldToPlayable(48)).toBe(48) // already in range
    expect(foldToPlayable(72)).toBe(60) // C5 → C4
    expect(foldToPlayable(12)).toBe(24) // C0 → C1
    expect(foldToPlayable(100) % 12).toBe(100 % 12) // same pitch class
    expect(foldToPlayable(100)).toBeGreaterThanOrEqual(24)
    expect(foldToPlayable(100)).toBeLessThanOrEqual(60)
  })

  it('clampValid keeps notes in 0..127', () => {
    expect(clampValid(-5)).toBe(0)
    expect(clampValid(200)).toBe(127)
    expect(clampValid(60)).toBe(60)
  })
})
