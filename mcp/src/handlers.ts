// Pure handler logic — no MCP protocol, no I/O. Factored out so it's unit-
// testable and so server.ts stays a thin registration layer. Everything musical
// lives in loopgen; these functions just shape inputs/outputs for the tools.

import {
  encode,
  decode,
  toLink,
  toAscii,
  cellCount,
  fromLink,
  midiToName,
  GENRES,
  type LoopSpec,
  type Track,
  type Wire,
} from 'loopclub-loopgen'

/** Production origin for emitted links. Override with LOOPCLUB_ORIGIN.
 *  Must be the APP subdomain (app.loopclub.xyz) — that's where the `?jam=`
 *  handler lives. The apex (loopclub.xyz) is the marketing landing page and
 *  ignores `?jam=`, so a link there silently drops the loop. */
export const ORIGIN = process.env.LOOPCLUB_ORIGIN ?? 'https://app.loopclub.xyz'

const RENT_NOTE =
  'Open the link to audition the loop free. Pressing the cells on-chain costs ' +
  'USDm rent, signed by you in the app — generated ≠ free.'

export interface BuildLoopInput {
  tracks: Track[]
  name?: string
}

export interface BuildLoopResult {
  deepLink: string
  asciiGrid: string
  cellCount: number
  instruments: string[]
  note: string
}

/** Core of `build_loop`: spec in → link + preview out. */
export function buildLoop(input: BuildLoopInput): BuildLoopResult {
  const spec: LoopSpec = { version: 1, tracks: input.tracks, name: input.name }
  const wire = encode(spec)
  const instruments = [...new Set(input.tracks.map((t) => t.instrument))]
  return {
    deepLink: toLink(wire, ORIGIN),
    asciiGrid: toAscii(wire),
    cellCount: cellCount(wire),
    instruments,
    note: RENT_NOTE,
  }
}

export interface DescribeLoopInput {
  link?: string
  pattern?: string
  synthData?: string
}

export interface DescribeLoopResult {
  description: string
  asciiGrid: string
  cellCount: number
  instruments: string[]
}

/** Resolve the input to a Wire, or throw a friendly Error. */
function resolveWire(input: DescribeLoopInput): Wire {
  if (input.link && input.link.trim()) {
    return fromLink(input.link) // throws LinkError on malformed input
  }
  if (input.pattern && input.pattern.trim()) {
    let pattern: bigint
    let synthData: bigint
    try {
      pattern = BigInt(input.pattern.trim())
      synthData = BigInt((input.synthData ?? '0').trim() || '0')
    } catch {
      throw new Error('pattern/synthData must be valid integers (decimal or 0x-hex)')
    }
    return { pattern, synthData }
  }
  throw new Error('provide either `link` (a ?jam= link) or `pattern` (+ optional `synthData`)')
}

/** Human-readable, one-line-per-track summary of a decoded loop. */
function humanDescription(spec: LoopSpec): string {
  if (spec.tracks.length === 0) return 'Empty loop — no cells lit.'
  const lines = spec.tracks.map((t) => {
    if (t.instrument === 'synth') {
      const notes = t.notes
        .slice()
        .sort((a, b) => a.step - b.step)
        .map((n) => `${midiToName(Number(n.pitch))}@${n.step}`)
        .join(', ')
      return `synth: ${notes}`
    }
    return `${t.instrument}: steps ${t.steps.slice().sort((a, b) => a - b).join(', ')}`
  })
  return lines.join('\n')
}

/** Core of `describe_loop`: a link or raw wire → readable summary + grid. */
export function describeLoop(input: DescribeLoopInput): DescribeLoopResult {
  const wire = resolveWire(input)
  const spec = decode(wire)
  return {
    description: humanDescription(spec),
    asciiGrid: toAscii(wire),
    cellCount: cellCount(wire),
    instruments: spec.tracks.map((t) => t.instrument),
  }
}

// ───── Resource contents ─────

/** loopclub://vocabulary — the rules, so Claude stays in-bounds. */
export function vocabularyText(): string {
  return [
    '# loopclub loop vocabulary',
    '',
    'A loop is a 16-step × 9-track grid (one bar of 16th notes).',
    '',
    '## Tracks (8 drums + 1 synth)',
    '- kick, snare, clap, hat, open-hat, cowbell, crash, ride — drum voices.',
    '  Give each a list of lit `steps` (0–15).',
    '- synth — the melodic row. Give it `notes`: one `{ step, pitch }` per active',
    '  step. It is MONOPHONIC per step (one pitch at a time).',
    '',
    '## Pitch',
    '- Express pitch as a MIDI number or a name like "C3", "F#3", "Eb2".',
    '- Stay within C1–C4 (MIDI 24–60). That is the range the in-app keyboard',
    '  shows and laptop speakers can voice; the default is C3 (48). Sub-bass',
    '  (C1/C2) reads as near-silent on laptops.',
    '',
    '## Make it musical, not random',
    '- Kick is the backbone (e.g. 4-on-the-floor: steps 0,4,8,12).',
    '- Snare/clap usually land on the backbeat (steps 4, 12).',
    '- Hats add motion (off-beats, or an even 8th/16th pulse).',
    '- A synth line should sit in one key — walk a scale, do not scatter notes.',
    '',
    '## Cost (be honest in your reply)',
    '- Auditioning the generated link is FREE.',
    '- Pressing cells on-chain costs USDm rent, signed by the user IN THE APP.',
    '  You never sign anything — you only produce the link.',
  ].join('\n')
}

/** loopclub://genres — worked examples Claude can pattern-match against. */
export function genresText(): string {
  const blocks = Object.keys(GENRES).map((name) => {
    const spec = GENRES[name]!()
    const wire = encode(spec)
    return [
      `## ${name}${spec.bpm ? ` (~${spec.bpm} bpm)` : ''}`,
      '```',
      toAscii(wire),
      '```',
      'spec:',
      '```json',
      JSON.stringify({ tracks: spec.tracks }, null, 2),
      '```',
    ].join('\n')
  })
  return ['# Genre starting points', '', 'Adapt these — do not copy verbatim every time.', '', ...blocks].join('\n')
}

/** loopclub://how-it-works — the lifecycle, so Claude frames its reply right. */
export function howItWorksText(): string {
  return [
    '# How a jammed loop becomes real',
    '',
    '1. You (Claude) call `build_loop` with the beat. It returns a `?jam=` link',
    '   that encodes the pattern — no chain, no keys, no signing.',
    '2. The user opens the link. loopclub loads the loop as a FREE, editable',
    '   preview and lets them audition it.',
    '3. To keep it, the user rents the cells — ONE signature in the app — which',
    '   presses the loop onto the live shared grid. Rent is paid in USDm, priced',
    '   per loop of duration.',
    '4. Some cells may already be taken by other players at click-time; the app',
    '   rents only the free ones and tells the user.',
    '',
    'So: the link is free to open and hear; committing costs USDm. Say so.',
  ].join('\n')
}

// ───── Prompt ─────

/** The `jam` prompt body, parameterised by genre/bpm. */
export function jamPromptText(genre?: string, bpm?: string): string {
  const g = genre?.trim() || 'house'
  const tempo = bpm?.trim() ? ` at ${bpm} bpm` : ''
  return (
    `Jam a ${g} loop${tempo}. Read loopclub://vocabulary and loopclub://genres ` +
    `first so it's idiomatic and in-key. Keep it musical: a kick/snare/hat ` +
    `backbone plus a synth line walking one scale (stay in C1–C4). Then call ` +
    `build_loop and give me the link, the ASCII grid, and a one-line note that ` +
    `auditioning is free but pressing the cells costs USDm rent.`
  )
}
