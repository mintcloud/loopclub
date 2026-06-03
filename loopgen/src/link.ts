// The transport: Wire ⇄ shareable deep-link payload. The MCP server emits a
// `?jam=<base64url>` link; the app decodes it to pre-fill the grid as a free
// preview before anything is on-chain (see jam-preview-stage-spec.md).
//
// Payload (little-endian):
//   [version:1B][pattern:18B][synthCount:1B][ synthCount × (cellId:1B, midi:1B) ]
//   • pattern  = 144 bits = exactly 18 bytes (drum + synth on/off bits).
//   • synth notes are appended sparsely so drum-only loops stay ~tiny.
//   • a version byte lets us extend (swing, kit hint) without breaking old links.
//
// fromLink VALIDATES HARD — it is untrusted URL input. Anything malformed throws
// LinkError; callers (the ?jam= handler) catch and fall through to a normal load.

import { CELLS, SYNTH_CELL_START, isSynthCell } from './constants.js'
import { PITCH_VALID_MAX } from './constants.js'
import type { Wire } from './types.js'

const VERSION = 1
const PATTERN_BYTES = 18 // 144 bits
const HEADER_BYTES = 1 + PATTERN_BYTES + 1 // version + pattern + synthCount
const MAX_SYNTH = CELLS - SYNTH_CELL_START // 16

export class LinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LinkError'
  }
}

const NOTE_MASK = 0x7fn
const WORD_MASK = 0xffffn

/** Pack a Wire into the v1 byte payload. */
function pack(wire: Wire): Uint8Array {
  // Collect lit synth notes (sparse) and serialise the pattern to 18 LE bytes.
  const synth: Array<[number, number]> = []
  for (let id = SYNTH_CELL_START; id < CELLS; id++) {
    if (((wire.pattern >> BigInt(id)) & 1n) === 0n) continue
    const word = (wire.synthData >> BigInt((id - SYNTH_CELL_START) * 16)) & WORD_MASK
    synth.push([id, Number(word & NOTE_MASK)])
  }

  const out = new Uint8Array(HEADER_BYTES + synth.length * 2)
  out[0] = VERSION
  for (let j = 0; j < PATTERN_BYTES; j++) {
    out[1 + j] = Number((wire.pattern >> BigInt(j * 8)) & 0xffn)
  }
  out[1 + PATTERN_BYTES] = synth.length
  let o = HEADER_BYTES
  for (const [id, midi] of synth) {
    out[o++] = id
    out[o++] = midi
  }
  return out
}

/** Parse the v1 byte payload back into a Wire, validating every field. */
function unpack(bytes: Uint8Array): Wire {
  if (bytes.length < HEADER_BYTES) throw new LinkError('payload too short')
  if (bytes[0] !== VERSION) throw new LinkError(`unsupported version ${bytes[0]}`)

  let pattern = 0n
  for (let j = 0; j < PATTERN_BYTES; j++) {
    pattern |= BigInt(bytes[1 + j]!) << BigInt(j * 8)
  }

  const synthCount = bytes[1 + PATTERN_BYTES]!
  if (synthCount > MAX_SYNTH) throw new LinkError(`synthCount ${synthCount} > ${MAX_SYNTH}`)
  if (bytes.length !== HEADER_BYTES + synthCount * 2) {
    throw new LinkError('length does not match synthCount')
  }

  let synthData = 0n
  let o = HEADER_BYTES
  for (let k = 0; k < synthCount; k++) {
    const id = bytes[o++]!
    const midi = bytes[o++]!
    if (!isSynthCell(id) || id >= CELLS) throw new LinkError(`bad synth cellId ${id}`)
    if (midi > PITCH_VALID_MAX) throw new LinkError(`bad midi ${midi}`)
    // The corresponding pattern bit must be set — a note for an unlit cell is
    // incoherent and would silently desync the preview.
    if (((pattern >> BigInt(id)) & 1n) === 0n) throw new LinkError(`note for unlit cell ${id}`)
    synthData |= (BigInt(midi) & NOTE_MASK) << BigInt((id - SYNTH_CELL_START) * 16)
  }

  return { pattern, synthData }
}

/** Build the full deep link: `${origin}/?jam=<base64url>`. */
export function toLink(wire: Wire, origin: string): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}/?jam=${base64urlEncode(pack(wire))}`
}

/** Just the `?jam=` param value (base64url), without an origin. */
export function toJamParam(wire: Wire): string {
  return base64urlEncode(pack(wire))
}

/**
 * Decode a jam payload back into a Wire. Accepts either the raw base64url param
 * or a full URL containing `?jam=` / `&jam=`. Throws LinkError on anything
 * malformed — callers should catch and fall through to a normal load.
 */
export function fromLink(jam: string): Wire {
  let param = jam.trim()
  const m = /[?&]jam=([^&#]+)/.exec(param)
  if (m) param = m[1]!
  if (!param) throw new LinkError('empty jam param')
  return unpack(base64urlDecode(param))
}

// ───── base64url (no padding) — zero-dep, works in Node and the browser ─────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64_LOOKUP: Record<string, number> = (() => {
  const t: Record<string, number> = {}
  for (let i = 0; i < B64.length; i++) t[B64[i]!] = i
  return t
})()

function base64urlEncode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0
    const triple = (b0 << 16) | (b1 << 8) | b2
    const n = bytes.length - i
    out += B64[(triple >> 18) & 0x3f]!
    out += B64[(triple >> 12) & 0x3f]!
    if (n > 1) out += B64[(triple >> 6) & 0x3f]!
    if (n > 2) out += B64[triple & 0x3f]!
  }
  return out
}

function base64urlDecode(str: string): Uint8Array {
  const clean = str.replace(/[^A-Za-z0-9\-_]/g, '')
  const n = clean.length
  if (n % 4 === 1) throw new LinkError('invalid base64url length')
  const outLen = Math.floor((n * 3) / 4)
  const out = new Uint8Array(outLen)
  let o = 0
  for (let i = 0; i < n; i += 4) {
    const c0 = B64_LOOKUP[clean[i]!]
    const c1 = B64_LOOKUP[clean[i + 1]!]
    const c2 = i + 2 < n ? B64_LOOKUP[clean[i + 2]!] : 0
    const c3 = i + 3 < n ? B64_LOOKUP[clean[i + 3]!] : 0
    if (c0 === undefined || c1 === undefined || c2 === undefined || c3 === undefined) {
      throw new LinkError('invalid base64url char')
    }
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3
    if (o < outLen) out[o++] = (triple >> 16) & 0xff
    if (o < outLen) out[o++] = (triple >> 8) & 0xff
    if (o < outLen) out[o++] = triple & 0xff
  }
  return out
}
