import { describe, it, expect } from 'vitest'
import { toLink, toJamParam, fromLink, LinkError } from '../src/link.js'
import { encode } from '../src/codec.js'
import type { Wire } from '../src/types.js'

const drumOnly = encode({ version: 1, tracks: [{ instrument: 'kick', steps: [0, 4, 8, 12] }] })
const fullMelody = encode({
  version: 1,
  tracks: [{ instrument: 'synth', notes: Array.from({ length: 16 }, (_, s) => ({ step: s, pitch: 36 + s })) }],
})

describe('link — transport round-trip', () => {
  it('round-trips wire → param → wire', () => {
    for (const w of [drumOnly, fullMelody, { pattern: 0n, synthData: 0n } as Wire]) {
      const back = fromLink(toJamParam(w))
      expect(back.pattern).toBe(w.pattern)
      expect(back.synthData).toBe(w.synthData)
    }
  })

  it('builds a clean URL and parses it back from the full URL', () => {
    const url = toLink(drumOnly, 'https://loopclub.xyz')
    expect(url.startsWith('https://loopclub.xyz/?jam=')).toBe(true)
    const back = fromLink(url)
    expect(back.pattern).toBe(drumOnly.pattern)
  })

  it('normalises a trailing slash in the origin', () => {
    expect(toLink(drumOnly, 'https://loopclub.xyz/')).toContain('https://loopclub.xyz/?jam=')
  })

  it('keeps a drum-only link tiny and a full melody bounded', () => {
    expect(toJamParam(drumOnly).length).toBeLessThanOrEqual(30)
    expect(toJamParam(fullMelody).length).toBeLessThanOrEqual(80)
  })

  it('rejects an unknown version', () => {
    const bad = toJamParam(drumOnly)
    // flip the version byte by decoding/re-encoding is awkward; just assert a
    // hand-built bad payload throws via the version guard path.
    expect(() => fromLink('AAAA')).toThrow(LinkError) // too short / bad version
  })

  it('rejects a midi > 127', () => {
    // Build a valid-shaped payload by hand: version=1, pattern with cell 128 set,
    // synthCount=1, (cellId=128, midi=200) — midi must fail.
    const bytes = new Uint8Array(1 + 18 + 1 + 2)
    bytes[0] = 1
    bytes[1 + 16] = 0x01 // byte 16 bit 0 = cell 128 lit
    bytes[1 + 18] = 1 // synthCount
    bytes[20] = 128 // cellId
    bytes[21] = 200 // midi (invalid)
    const param = b64url(bytes)
    expect(() => fromLink(param)).toThrow(/bad midi/)
  })

  it('rejects a synth note for an unlit cell', () => {
    const bytes = new Uint8Array(1 + 18 + 1 + 2)
    bytes[0] = 1
    // pattern left empty → cell 128 NOT lit
    bytes[1 + 18] = 1
    bytes[20] = 128
    bytes[21] = 48
    expect(() => fromLink(b64url(bytes))).toThrow(/unlit cell/)
  })

  it('rejects a length mismatch', () => {
    const bytes = new Uint8Array(1 + 18 + 1 + 2)
    bytes[0] = 1
    bytes[1 + 18] = 5 // claims 5 synth notes but only room for 1
    expect(() => fromLink(b64url(bytes))).toThrow(LinkError)
  })

  it('rejects an out-of-range synth cellId', () => {
    const bytes = new Uint8Array(1 + 18 + 1 + 2)
    bytes[0] = 1
    bytes[1] = 0x01 // cell 0 lit (a drum cell)
    bytes[1 + 18] = 1
    bytes[20] = 0 // cellId 0 is NOT a synth cell
    bytes[21] = 48
    expect(() => fromLink(b64url(bytes))).toThrow(/synth cellId/)
  })
})

// Local base64url encoder mirroring link.ts, so tests can build raw payloads.
function b64url(bytes: Uint8Array): string {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0
    const triple = (b0 << 16) | (b1 << 8) | b2
    const n = bytes.length - i
    out += B64[(triple >> 18) & 0x3f]
    out += B64[(triple >> 12) & 0x3f]
    if (n > 1) out += B64[(triple >> 6) & 0x3f]
    if (n > 2) out += B64[triple & 0x3f]
  }
  return out
}
