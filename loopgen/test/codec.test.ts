import { describe, it, expect } from 'vitest'
import { encode, decode, litCells, synthPitches, cellCount } from '../src/codec.js'
import type { LoopSpec, Wire } from '../src/types.js'

describe('codec — contract bit layout', () => {
  it('encodes drum + synth to the exact uint256s the contract expects', () => {
    const spec: LoopSpec = {
      version: 1,
      tracks: [
        { instrument: 'kick', steps: [0, 4, 8, 12] },
        { instrument: 'synth', notes: [{ step: 0, pitch: 'C3' }] }, // C3 = MIDI 48
      ],
    }
    const wire = encode(spec)
    // kick bits 0,4,8,12 = 0x1111; synth cellId 128 lit = 1<<128.
    expect(wire.pattern).toBe(0x1111n | (1n << 128n))
    // synth word 0 (cellId 128) = MIDI 48, at bits [0..15].
    expect(wire.synthData).toBe(48n)
  })

  it('places a synth note word at (cellId-128)*16 bits, 7-bit value', () => {
    // synth step 3 → cellId 131 → word index 3 → bit offset 48. pitch F#3 = 54.
    const wire = encode({
      version: 1,
      tracks: [{ instrument: 'synth', notes: [{ step: 3, pitch: 'F#3' }] }],
    })
    expect(wire.pattern).toBe(1n << 131n)
    expect(wire.synthData).toBe(54n << 48n)
    expect(synthPitches(wire).get(131)).toBe(54)
  })

  it('round-trips decode(encode(spec)) preserving steps and pitches', () => {
    const spec: LoopSpec = {
      version: 1,
      tracks: [
        { instrument: 'kick', steps: [0, 8] },
        { instrument: 'hat', steps: [2, 6, 10, 14] },
        { instrument: 'synth', notes: [{ step: 0, pitch: 48 }, { step: 8, pitch: 51 }] },
      ],
    }
    const back = decode(encode(spec))
    expect(back).toEqual({
      version: 1,
      tracks: [
        { instrument: 'kick', steps: [0, 8] },
        { instrument: 'hat', steps: [2, 6, 10, 14] },
        { instrument: 'synth', notes: [{ step: 0, pitch: 48 }, { step: 8, pitch: 51 }] },
      ],
    })
  })

  it('round-trips encode(decode(wire)) === wire for arbitrary valid wires', () => {
    const wires: Wire[] = [
      { pattern: 0n, synthData: 0n },
      { pattern: 0x1111n, synthData: 0n },
      // every synth cell lit with the full 7-bit range of notes
      (() => {
        let pattern = 0n
        let synthData = 0n
        for (let k = 0; k < 16; k++) {
          pattern |= 1n << BigInt(128 + k)
          synthData |= BigInt((k * 8) & 0x7f) << BigInt(k * 16)
        }
        return { pattern, synthData }
      })(),
    ]
    for (const w of wires) {
      const r = encode(decode(w))
      expect(r.pattern).toBe(w.pattern)
      expect(r.synthData).toBe(w.synthData)
    }
  })

  it('clamps out-of-range pitch to 7 bits and skips bad steps', () => {
    const wire = encode({
      version: 1,
      tracks: [
        { instrument: 'kick', steps: [-1, 0, 16, 99] }, // only 0 is valid
        { instrument: 'synth', notes: [{ step: 1, pitch: 200 }] }, // clamps to 127
      ],
    })
    expect(litCells(wire).filter((c) => c < 128)).toEqual([0])
    expect(synthPitches(wire).get(129)).toBe(127)
  })

  it('decode omits empty tracks', () => {
    const back = decode({ pattern: 1n << 4n, synthData: 0n }) // single kick at step 4
    expect(back.tracks).toEqual([{ instrument: 'kick', steps: [4] }])
  })

  it('litCells / cellCount agree', () => {
    const wire = encode({
      version: 1,
      tracks: [{ instrument: 'kick', steps: [0, 4, 8, 12] }],
    })
    expect(litCells(wire)).toEqual([0, 4, 8, 12])
    expect(cellCount(wire)).toBe(4)
  })
})
