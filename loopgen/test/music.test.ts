import { describe, it, expect } from 'vitest'
import { euclid, scaleNotes, GENRES, humanize } from '../src/music.js'
import { encode, cellCount } from '../src/codec.js'
import { PITCH_PLAYABLE_MIN, PITCH_PLAYABLE_MAX } from '../src/constants.js'
import type { LoopSpec } from '../src/types.js'

describe('euclid', () => {
  it('produces the expected even distributions on the downbeat', () => {
    expect(euclid(4, 16)).toEqual([0, 4, 8, 12])
    expect(euclid(5, 16)).toEqual([0, 3, 6, 9, 12])
    expect(euclid(1, 16)).toEqual([0])
  })
  it('returns the right pulse count and stays in range', () => {
    for (const p of [2, 3, 7, 11]) {
      const hits = euclid(p, 16)
      expect(hits.length).toBe(p)
      expect(hits.every((h) => h >= 0 && h < 16)).toBe(true)
      expect(hits[0]).toBe(0)
    }
  })
  it('handles edge cases', () => {
    expect(euclid(0, 16)).toEqual([])
    expect(euclid(16, 16)).toEqual([...Array(16).keys()])
    expect(euclid(20, 16).length).toBe(16)
  })
  it('rotates', () => {
    expect(euclid(4, 16, 2)).toEqual([2, 6, 10, 14])
  })
})

describe('scaleNotes', () => {
  it('stays in the playable window and in key', () => {
    const notes = scaleNotes('A2', 'minor', 2)
    expect(notes.every((n) => n >= PITCH_PLAYABLE_MIN && n <= PITCH_PLAYABLE_MAX)).toBe(true)
    // A natural minor pitch classes from A: A B C D E F G = {9,11,0,2,4,5,7}
    const classes = new Set(notes.map((n) => n % 12))
    for (const c of classes) expect([9, 11, 0, 2, 4, 5, 7]).toContain(c)
  })
})

describe('GENRES', () => {
  it('every template encodes to a non-empty, on-grid loop', () => {
    for (const name of Object.keys(GENRES)) {
      const spec = GENRES[name]!()
      const wire = encode(spec)
      expect(cellCount(wire)).toBeGreaterThan(0)
      expect(spec.name).toBe(name)
    }
  })
})

describe('humanize', () => {
  const base: LoopSpec = {
    version: 1,
    tracks: [{ instrument: 'hat', steps: [0, 4, 8, 12] }],
  }
  it('is deterministic given a seeded rng and adds hits when positive', () => {
    const rng = seeded(1)
    const out = humanize(base, 1, rng)
    const out2 = humanize(base, 1, seeded(1))
    expect(out).toEqual(out2)
    const hat = out.tracks[0]!
    expect(hat.instrument).toBe('hat')
    if (hat.instrument !== 'synth') expect(hat.steps.length).toBeGreaterThanOrEqual(4)
  })
  it('thins hits when negative', () => {
    const out = humanize(base, -1, () => 0) // rng always 0 → always below threshold → remove all
    const hat = out.tracks[0]!
    if (hat.instrument !== 'synth') expect(hat.steps.length).toBe(0)
  })
})

// Tiny deterministic PRNG (mulberry32) for reproducible humanize tests.
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
