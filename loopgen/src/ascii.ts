// Renders a Wire as a monospace 16×9 grid so the MCP client's Claude can "show
// its work" in chat before the user clicks the link (MCP spec doc 02 §3).

import {
  STEPS,
  SYNTH_TRACK,
  TRACK_LABELS,
  SYNTH_CELL_START,
} from './constants.js'
import { midiToName } from './pitch.js'
import type { Wire } from './types.js'

const LIT = '◼'
const OFF = '·'
const LABEL_W = 9 // left gutter width for track names ("open-hat" is 8 chars)

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length)
}

/**
 * ASCII grid for a Wire. Drum cells render as ◼/·; synth cells render their
 * note name when lit (truncated to 3 chars to keep columns aligned).
 */
export function toAscii(wire: Wire): string {
  const lines: string[] = []

  // Header: beat numbers on the quarter-note positions (steps 0,4,8,12).
  let header = ' '.repeat(LABEL_W)
  for (let step = 0; step < STEPS; step++) {
    const beat = step % 4 === 0 ? String(step / 4 + 1) : OFF
    header += pad(beat, 2)
  }
  lines.push(header)

  for (let track = 0; track < TRACK_LABELS.length; track++) {
    let row = pad(TRACK_LABELS[track]!, LABEL_W)
    for (let step = 0; step < STEPS; step++) {
      const id = track * STEPS + step
      const lit = ((wire.pattern >> BigInt(id)) & 1n) === 1n
      if (track === SYNTH_TRACK) {
        if (lit) {
          const word = (wire.synthData >> BigInt((id - SYNTH_CELL_START) * 16)) & 0x7fn
          row += pad(midiToName(Number(word)), 2)
        } else {
          row += pad(OFF, 2)
        }
      } else {
        row += pad(lit ? LIT : OFF, 2)
      }
    }
    lines.push(row)
  }

  return lines.join('\n')
}
