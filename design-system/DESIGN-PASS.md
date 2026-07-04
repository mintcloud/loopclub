# DESIGN PASS — the coherence cut

*Fable · guest art direction · 2026-07-04 · branch `feat/fable-ui-refresh`*

Before/after: `.shots/baseline-desktop.png` → `.shots/final-desktop.png` (and `-mobile`).

---

## What I found

The design system is good. The *assembly* had drifted, and the drift had one
root cause: **every feature that shipped promoted itself.** Fast mode arrived
and took chrome. The library tabs took chrome. Card actions took chrome. The
connect nudge invented its own green, the jam banner its own blue-teal
gradient, the fund button its own orange. Each decision was locally
defensible; the sum was an app where the header alone held five mirrors and
the page held six accent systems. A drum machine where every surface is a
polished pad isn't an instrument — it's a chandelier.

Three specific diseases:

1. **Chrome inflation.** Play/Stop/Press, Connect, Fund, the fast-mode pill,
   the library tabs, six card chips, both banner buttons — all liquid metal.
   The eye had nowhere to land. "Primary" had stopped meaning anything.
2. **Tint soup.** #3ce08c (connect green), a blue-teal jam gradient, #FF6521
   (fund orange), #ff6b4a (hot orange-red), rgba(120,220,160) (audition
   green) — five ad-hoc accents on top of a palette that already had violet,
   gold, mint, red and nine track LEDs.
3. **Voice drift.** Raw `ui-monospace, SFMono-Regular, Menlo` stacks in the
   fund/withdraw/claimed views, Gilroy-13px modal headings, a parallel bare
   `<button>` style in the frontend — the default-coder voice creeping back
   under the silkscreen.

## The direction — hardware honesty

Real hardware has a strict material grammar, and it's the grammar this app
was always reaching for:

- **Chrome is a verb.** A silver surface means *pressing this touches the
  machine*: the deck transport, the one money CTA in a context, a modal's
  single primary. At most one chrome control per context. Everything else
  gives the metal back.
- **One chip material — the silkscreen pill.** Near-transparent panel,
  hairline slate border (`--pill-bg` / `--pill-border`), pill radius,
  Michroma legend. Every status chip in the app is now this chip. State
  arrives as an LED dot or a tinted legend, never as a new surface.
- **Light is the only colour.** A colour means exactly one thing:
  **violet** = you · **mint `--go`** = live/on-chain · **gold** =
  ownership/money/expiring · **red** = urgent · **sky `--claude`** = Claude.
  Track LEDs colour *sound*, never UI state. No feature may invent a hex.
- **Engaged = pressed graphite + prismatic rim** — one grammar for "on",
  shared by deck pads, library tabs and the playing card/playhead. The
  prism stays the brand signature and stays earned.

## What changed, component by component

### Tokens (`tokens/colors.css`)
- New semantic block: `--go` (mint, = the contrib/hat lamp), `--claude`
  (sky, = the synth lamp), `--ok`, plus the discipline documented in-file.
- New chip material tokens: `--pill-bg`, `--pill-border`.

### Buttons (`components/buttons.css`)
- Chrome discipline written into the header comment — chrome is rationed.
- The bare-`<button>` fallback moved here from the frontend, wrapped in
  `:where()` so it has **zero specificity**: one canonical ghost recipe that
  any classed style beats without a fight. (Side effect, intentional: bare
  `button:hover` can no longer repaint classed controls' borders.)

### Strips & badges (`components/strips-badges.css`) — the chip vocabulary
- `.chrome-pill`, `.fastmode-btn`, `.fastmode-badge`: **de-chromed** into
  silkscreen pills. Armed fast-mode earns a mint hairline + mint bolt (it's
  a *live* state — same lamp as the sync dot). The class name `chrome-pill`
  is kept for compat; the comment marks it legacy.
- `.sync-badge` dot now `--go` (was `--hat` — same light, right name).
- `.contrib-chip`: addresses are true readouts → Space Mono; chip surface on
  the shared pill tokens.
- `.rc` counts: shared pill tokens; LED-tinted text unchanged (mint/gold).

### Library (`components/library.css`)
- **Tabs de-chromed** → silkscreen pills; the active tab is the one engaged
  surface: pressed graphite + prism rim, mirroring `.deck-btn.active`.
- **Card actions de-chromed** → quiet chips printed on the plate. The gold
  "See Edition NFT" chip is now *the only metal on a card* — the minted
  token is the jewel, and now it reads like one. (It needed its own
  `background-blend-mode` restated once the base chip stopped blending —
  without it the gold marble rendered opaque grey.)
- `.role-badge` joins the chip vocabulary: pill radius, Michroma 8px,
  LED-tinted (gold owned / mint contrib).

### Banners (`components/banner-modal-toast.css` + `frontend/src/index.css`)
- **One banner shell** — the brushed graphite band. The connect banner's
  green gradient and the jam banner's blue-teal gradient are gone; identity
  is now the status LED dot + a coloured hairline (mint = live, sky =
  Claude, prism rim = playing, exclusively).
- `.pb-back` ("back to live jam") demoted from chrome to a silkscreen pill —
  each banner now holds exactly one metal: the press CTA.
- Status dots re-lamped: `#3ce08c` → `--go`, `#ff6b4a` → `--hot`; quiet
  stays gold. Added a sky dot rule for the jam banner.

### Frontend overrides (`frontend/src/index.css`)
- Parallel bare-`<button>` style **deleted** (design system owns it now).
- `.fund-btn` pulse ring: bespoke orange → `--owned` gold. Money wears the
  money colour.
- `.fund-bal`, `.mono`, `.claimed-owner`: raw monospace stacks →
  `var(--font-mono)`. `.fund-bridge h4` / `.fund-deposit-h`: Gilroy 13px →
  Michroma silkscreen, matching `.modal h3`.
- `.jam-claude-btn`: private gradient → standard pill + sky hairline (tied
  to the jam banner through the LED code, not a bespoke wash).
- Audition flash + tier-row hovers: stray greens → `--go` mint.
- App shell / header gaps snapped to the 4px scale (`--space-*`).
- **Mobile legibility fix:** when the press CTA label wraps on phones, the
  second line used to sink into the chrome gradient's dark band. Wrapped
  `.btn-chrome.pb-press` now wears the midline-safe chip chrome — printed
  ink at any line count. (Scoped so `.btn-hot` keeps its red.)

### Grid (`components/cells-grid.css`)
- **Untouched visually** — the faceplate is the crown jewel and it stays.
- The commented OPTION A/B mobile fork is resolved: flat stage is the
  committed phone material (matching the flat phone cards); the dead
  graphite branch is deleted.

### JSX (2 lines, `App.tsx`)
- `className="btn-chrome pb-back"` → `"btn pb-back"` (both banners). That's
  the entire React diff.

### Docs
- `README.md`: chrome discipline, silkscreen pill, and the LED code added to
  the design-language section; component + token cheatsheets updated.
- `CLAUDE.md`: the visual sanity checklist no longer tells an integrator to
  make badges chrome.

## What I deliberately did not touch

The LED grid and its halation. The wordmark treatment. The film grain, the
holo sticker, the faceplate screws and glint — the imperfections are the
point and they survive. `--hot` red still means exactly one thing. The
share-modal Copy keeps the chunky chrome (it's that modal's one primary).

## Things to look at, Theo

1. **Fund modal internals** still hold three chromes (bridge link / copy /
   withdraw). I stopped at the two-line JSX budget — same demotion pattern
   applies if you agree (make Copy the primary, bridge + withdraw quiet).
2. **`.chrome-pill` is now a misnomer** — it renders silkscreen. Kept for
   compat; rename to `.pill` whenever you're touching those call sites.
3. **Fast-mode armed = mint hairline** is my call (armed session key is a
   *live* state). If you read ⚡ as money-adjacent, the gold variant is a
   one-line change in strips-badges.css.
4. The de-chromed tabs/chips change hover behaviour from brightness-lift to
   border-brighten — worth a feel-check in the real app, not just stills.
5. I could not run `npm run build` in this worktree (no node_modules); the
   CSS is validated by the gallery renders and the JSX diff is two className
   strings, but give it the usual build on your side.
