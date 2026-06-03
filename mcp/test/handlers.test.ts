import { describe, it, expect } from 'vitest'
import {
  buildLoop,
  describeLoop,
  vocabularyText,
  genresText,
  howItWorksText,
  jamPromptText,
  ORIGIN,
} from '../src/handlers.js'
import { fromLink, encode, GENRES } from 'loopclub-loopgen'

describe('buildLoop', () => {
  it('returns a jam link that round-trips through loopgen', () => {
    const res = buildLoop({
      tracks: [
        { instrument: 'kick', steps: [0, 4, 8, 12] },
        { instrument: 'synth', notes: [{ step: 0, pitch: 'C3' }] },
      ],
      name: 'test',
    })
    expect(res.deepLink.startsWith(`${ORIGIN}/?jam=`)).toBe(true)
    expect(res.cellCount).toBe(5)
    expect(res.instruments).toEqual(['kick', 'synth'])
    // the emitted link decodes to the exact wire we encoded
    const wire = fromLink(res.deepLink)
    const expected = encode({
      version: 1,
      tracks: [
        { instrument: 'kick', steps: [0, 4, 8, 12] },
        { instrument: 'synth', notes: [{ step: 0, pitch: 'C3' }] },
      ],
    })
    expect(wire.pattern).toBe(expected.pattern)
    expect(wire.synthData).toBe(expected.synthData)
    expect(res.asciiGrid).toContain('kick')
    expect(res.note.toLowerCase()).toContain('free')
  })
})

describe('describeLoop', () => {
  it('round-trips a built link into a readable summary', () => {
    const { deepLink } = buildLoop({
      tracks: [
        { instrument: 'kick', steps: [0, 8] },
        { instrument: 'synth', notes: [{ step: 0, pitch: 'C3' }, { step: 8, pitch: 'Eb3' }] },
      ],
    })
    const res = describeLoop({ link: deepLink })
    expect(res.cellCount).toBe(4)
    expect(res.description).toContain('kick: steps 0, 8')
    expect(res.description).toContain('C3@0')
    // Eb3 round-trips to its sharp spelling (midiToName is sharp-spelled): D#3.
    expect(res.description).toContain('D#3@8')
    expect(res.instruments).toContain('synth')
  })

  it('accepts raw pattern/synthData bigints (hex)', () => {
    // kick on 0,4,8,12 → 0x1111
    const res = describeLoop({ pattern: '0x1111' })
    expect(res.cellCount).toBe(4)
    expect(res.description).toContain('kick: steps 0, 4, 8, 12')
  })

  it('throws on a malformed jam link', () => {
    expect(() => describeLoop({ link: 'https://loopclub.xyz/?jam=@@@bad@@@' })).toThrow()
  })

  it('throws when neither link nor pattern is given', () => {
    expect(() => describeLoop({})).toThrow(/provide either/)
  })
})

describe('resources + prompt', () => {
  it('vocabulary states the playable pitch range and the cost truth', () => {
    const v = vocabularyText()
    expect(v).toContain('C1–C4')
    expect(v.toLowerCase()).toContain('free')
    expect(v.toLowerCase()).toContain('usdm')
  })

  it('genres renders every loopgen template with a grid + spec', () => {
    const g = genresText()
    for (const name of Object.keys(GENRES)) expect(g).toContain(`## ${name}`)
    expect(g).toContain('```json')
  })

  it('how-it-works explains the free-audition / paid-press split', () => {
    expect(howItWorksText().toLowerCase()).toContain('audition')
    expect(howItWorksText().toLowerCase()).toContain('usdm')
  })

  it('jam prompt weaves in genre + bpm and points at the resources', () => {
    const p = jamPromptText('techno', '132')
    expect(p).toContain('techno')
    expect(p).toContain('132 bpm')
    expect(p).toContain('build_loop')
    expect(p).toContain('loopclub://vocabulary')
  })

  it('jam prompt defaults gracefully with no args', () => {
    expect(jamPromptText()).toContain('house')
  })
})
