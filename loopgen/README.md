# loopgen

loopclub's shared musical brain. A **pure TypeScript** library, **zero runtime
dependencies**, that converts between three representations:

```
  LoopSpec   ⇄   Wire { pattern, synthData }   ⇄   deep-link
 (human IR)        (on-chain wire format)            (?jam= transport)
```

It is the single source of truth for the grid bit-layout. The MCP server, the
frontend, and the seeder bot are all thin shells around it — so the encoding is
defined once and round-trips safely everywhere.

## Why it exists

- **MCP server** ("Jam with Claude") — the user's Claude reasons about music and
  calls `build_loop(spec)`; the server `encode`s it and emits a `toLink` URL. It
  holds no keys and signs nothing.
- **Frontend** — decodes a `?jam=` link with `fromLink` → `litCells` feeds the
  existing `previewCells` overlay; `synthPitches` is the `pitchMap` the jam-mode
  commit needs. The frontend's own bit-twiddling (`useLiveGrid`) should migrate
  onto this codec so there's one layout, not two.
- **Seeder bot** (later) — generates a `LoopSpec` (genres / euclid / scales) and
  signs it with a custodial key.

## The wire format (mirrors `contracts/src/Loopclub.sol`)

```
STEPS=16, TRACKS=9, CELLS=144, SYNTH_CELL_START=128
cellId = track*16 + step           (track 0..8, step 0..15)

pattern   : bit i set ⇔ cell i is lit  (144 meaningful bits)
synthData : 16-bit word per synth cell; word k (k = cellId-128) at bits
            [k*16 .. k*16+15]; bits 0-6 = 7-bit MIDI note (contract: cellData < 128)
```

**Two pitch ranges, deliberately separate:**
- *valid* — 0..127, the full 7-bit range the contract accepts. `encode`/`decode`
  round-trip this faithfully (the bot and other clients write the whole range).
- *playable* — C1..C4 (24..60), the subset the in-app keyboard exposes. Used
  only by the input adapters (`fromBasicPitch`, `scaleNotes`) to keep generated
  melodies audible and on-keyboard. The codec never folds.

## API

```ts
import { encode, decode, litCells, synthPitches, cellCount } from 'loopgen'
import { toLink, toJamParam, fromLink, LinkError } from 'loopgen'
import { toAscii } from 'loopgen'
import { euclid, scaleNotes, GENRES, humanize } from 'loopgen'
import { fromBasicPitch } from 'loopgen'
import { toMidi, midiToName, foldToPlayable } from 'loopgen'

const wire = encode({ version: 1, tracks: [
  { instrument: 'kick',  steps: [0, 4, 8, 12] },
  { instrument: 'synth', notes: [{ step: 0, pitch: 'C3' }] },
]})
toLink(wire, 'https://loopclub.xyz')   // → https://loopclub.xyz/?jam=ARER…
fromLink('https://loopclub.xyz/?jam=ARER…')   // → Wire (throws LinkError on bad input)
```

`fromLink` **validates hard** (version, length, cellId, midi, coherence) and
throws `LinkError` on anything malformed — it's untrusted URL input. Callers
catch and fall through to a normal load; never let it white-screen the app.

## Scripts

```bash
npm install
npm test         # vitest — 34 tests, codec/link round-trip + validation
npm run build    # tsc → dist/ (ESM + .d.ts)
npm run typecheck
```

## Consuming it (open decision — not wired yet)

The repo is currently flat (no root `package.json` / npm workspaces); a
rearchitecture is pending. So loopgen ships here as a **self-contained,
independently-testable package** and is **not yet wired into `frontend/`**. When
the MCP server (step 2) lands, pick one:

1. **npm workspaces** — add a root `package.json` with `workspaces`. Cleanest
   long-term; part of the pending rearchitecture.
2. **Relative-path / tsconfig alias** — `frontend` imports `../loopgen/src` via a
   path alias (how `design-system` is consumed today). Zero restructure.
3. **Publish** — `npm publish` and depend on the version. Only if we want it
   reusable outside the monorepo.

Recommendation: (2) now for the MCP server + frontend, fold into (1) during the
rearchitecture.
