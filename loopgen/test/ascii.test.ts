import { describe, it, expect } from 'vitest'
import { toAscii } from '../src/ascii.js'
import { encode } from '../src/codec.js'

describe('toAscii', () => {
  it('renders all 9 track rows plus a header', () => {
    const grid = toAscii(encode({ version: 1, tracks: [{ instrument: 'kick', steps: [0, 4, 8, 12] }] }))
    const lines = grid.split('\n')
    expect(lines.length).toBe(10) // header + 9 tracks
    for (const label of ['kick', 'snare', 'hat', 'synth']) {
      expect(grid).toContain(label)
    }
  })

  it('shows lit drum cells and the synth note name', () => {
    const grid = toAscii(
      encode({
        version: 1,
        tracks: [
          { instrument: 'kick', steps: [0] },
          { instrument: 'synth', notes: [{ step: 0, pitch: 'C3' }] },
        ],
      }),
    )
    expect(grid).toContain('◼') // lit kick
    expect(grid).toContain('C3') // synth note name on the synth row
  })
})
