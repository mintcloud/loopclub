import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildLoopShape, describeLoopShape } from '../src/schemas.js'

// These caps are the input-side DoS mitigations for the public remote build:
// without them, an unauthenticated caller can hand encode()/decode() unbounded
// work. The tests assert the bounds reject oversized input while still
// accepting a real (tiny) loop.
const buildLoop = z.object(buildLoopShape)
const describeLoop = z.object(describeLoopShape)

describe('buildLoop input bounds', () => {
  it('accepts a normal loop', () => {
    expect(
      buildLoop.safeParse({ tracks: [{ instrument: 'kick', steps: [0, 4, 8, 12] }] }).success,
    ).toBe(true)
  })

  it('rejects too many tracks (>32)', () => {
    const tracks = Array.from({ length: 33 }, () => ({ instrument: 'kick' as const, steps: [0] }))
    expect(buildLoop.safeParse({ tracks }).success).toBe(false)
  })

  it('rejects too many steps in a drum track (>16)', () => {
    const steps = Array.from({ length: 17 }, () => 0)
    expect(buildLoop.safeParse({ tracks: [{ instrument: 'kick', steps }] }).success).toBe(false)
  })

  it('rejects too many synth notes (>16)', () => {
    const notes = Array.from({ length: 17 }, () => ({ step: 0, pitch: 'C3' }))
    expect(buildLoop.safeParse({ tracks: [{ instrument: 'synth', notes }] }).success).toBe(false)
  })

  it('rejects an over-long name', () => {
    expect(
      buildLoop.safeParse({
        tracks: [{ instrument: 'kick', steps: [0] }],
        name: 'x'.repeat(121),
      }).success,
    ).toBe(false)
  })
})

describe('describeLoop input bounds', () => {
  it('accepts a normal link', () => {
    expect(describeLoop.safeParse({ link: 'https://app.loopclub.xyz/?jam=ARER' }).success).toBe(true)
  })

  it('rejects an over-long link (>4096), bounding the base64 decode', () => {
    expect(describeLoop.safeParse({ link: 'a'.repeat(4097) }).success).toBe(false)
  })

  it('rejects an over-long pattern bigint string', () => {
    expect(describeLoop.safeParse({ pattern: '9'.repeat(129) }).success).toBe(false)
  })
})
