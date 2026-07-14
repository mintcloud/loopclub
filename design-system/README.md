# loopclub Design System

> Y2K rave drum-machine: liquid metal, prismatic refraction, vivid LED
> instruments, deep-black stage. The visual system behind loopclub — a
> collaborative on-chain drum machine on MegaETH.

This package contains every visual token, component recipe, asset, and font
the loopclub app uses. The whole thing is plain CSS + assets — no build step,
no JS runtime, no React dependency. Frameworks pick it up by importing
`index.css`.

---

## What's in here

```
design-system/
├── README.md               ← this file (brand + visual guide)
├── CLAUDE.md               ← agent instructions for wiring into frontend
├── package.json
├── index.css               ← entry — @imports everything below
├── tokens/                 ← CSS custom properties only
│   ├── colors.css          ← surfaces, accents, instrument LEDs, role state
│   ├── chrome.css          ← chrome gradients, rainbow rim, hot CTA
│   ├── type.css            ← @font-face + family/scale/leading vars + .ds-* type classes
│   └── space.css           ← 4px scale, radii, shadows
├── components/             ← global utility classes built on tokens
│   ├── buttons.css         ← .btn, .btn-chrome, .btn-hot
│   ├── cells-grid.css      ← .cell (LED bezel), .mini-cell, .step-num, .grid
│   ├── popovers.css        ← .cell-popover, .row-tools, .keyboard
│   ├── strips-badges.css   ← .sync-badge, .chrome-pill, .fastmode-*, .contrib-*, .renew-strip
│   ├── library.css         ← .library, .loop-card, role badges, tabs
│   ├── banner-modal-toast.css ← .playback-banner, .modal, .toast, .wordmark
│   ├── topbar.css          ← .deck-controls, .deck-btn, .account-group, grid-anchored sync badge
│   └── flair.css           ← film grain overlay, .holo-sticker (the committed imperfections)
├── scripts/
│   └── gen-textures.py                 ← regenerates assets/textures (stdlib only)
├── assets/
│   ├── textures/                       ← raster liquid-metal / brushed / grain PNGs
│   ├── loopclub-logo.png               ← canonical wordmark (use this)
│   ├── loopclub-logo-transparent.png   ← legacy (pre-rebrand)
│   ├── loopclub-logo-cropped.png       ← legacy black-bg variant
│   ├── loopclub-logo-original.png      ← legacy original 1254² source
│   ├── og-cover.png                    ← legacy social card
│   └── logo-mark.svg                   ← legacy app mark
└── fonts/                              ← Gilroy .ttf, 14 cuts
```

---

## Design language — the 10-second version

- **Black stage** (`--bg: #020205`) so the chrome wordmark reflects.
- **Liquid-chrome wordmark** is the brand mark. **Always the PNG, never a recreation.** Mood is Daft Punk *Discovery* — polished mercury, rainbow rim, slightly molten contours.
- **Chrome surfaces** (`var(--chrome-surface-button)` + `background-blend-mode: var(--chrome-blend)`) for primary actions. Every chrome fill carries a raster liquid-metal texture over its gradient — a perfectly even vector gradient is the tell of machine-made chrome. Flat printed-legend text, dark band at ~75% so labels stay legible. Reads like a TR-808 pad / cassette deck button.
- **Chrome discipline — chrome is a verb.** Silver means "pressing this touches the machine": the deck transport, the one money CTA in a given context, a modal's single primary. At most ONE chrome control per context. Status chips, tabs and navigation are NOT chrome — when everything is chrome, nothing is.
- **The silkscreen pill** is the one quiet chip material: `--pill-bg` panel, `--pill-border` hairline, pill radius, Michroma legend. Sync badge, fast-mode, contributor chips, renew counts, role badges, the jam affordance — all the same chip, distinguished only by an LED dot or tinted legend.
- **Semantic LED code** — a colour means ONE thing: violet `--accent` = you · mint `--go` = live/on-chain/contributor · gold `--owned` = ownership/money/expiring · red `--hot` = urgent · sky `--claude` = Claude. Track LEDs colour sound, never UI state. Banners share one graphite shell and are coded by their LED dot + hairline, never by a private tinted background.
- **Prismatic rim is the signature.** The wordmark's oil-slick refraction rides every engaged/hover state: chrome button hover (`--rainbow-glow`), the active library tab, the playhead column (`--prism-halo`), the playing loop card. Violet `--accent` is demoted to one job: marking *your* cells.
- **The grid is a faceplate, not flat cells on black.** `.grid-wrap` is a brushed-metal plate with corner screws; cells are its LED windows.
- **Committed imperfections** (components/flair.css): film grain over the whole stage, one hand-placed glint on the faceplate, one rotated holo sticker in the header. Deliberate asymmetry — don't tidy them.
- **Vivid LED grid cells.** Off cells are recessed dark bezels; on cells halate in their track colour (kick coral / snare peach / hat mint / synth sky / clap orange / open-hat green / cowbell purple / crash pink / ride blue).
- **`--hot-fill`** red is reserved for one-shot urgent CTAs (press now, expiring rent).
- **Michroma** (`--font-tech`, Eurostile-Extended lineage — Dreamcast / Y2K OS) is the hero voice: every silkscreened legend (deck pads, tabs, track labels, chrome pills, modal headings), uppercase with `--ls-tech` tracking. **Gilroy** for body copy and small dense UI. Monos are for true readouts ONLY: **Major Mono Display** (`--font-readout`) on counters (step numbers — too cryptic for prose-adjacent readouts like the block badge, which wears Michroma), **Space Mono** (`--font-mono`) on addresses/code. A mono anywhere else is the default-coder voice creeping back.
- **Curated unicode glyph set** (`▶ ◼ ✦ ♪ ⚡ ▾ ↗ ✕ # · …`) — never emoji. `▾` (chevron) is the wallet/account-menu mark.
- **Voice** — lowercase, monospace, command-style. Em dash separator. "Your" not "we". No marketing words.

---

## Quick usage (vanilla HTML / standalone)

```html
<link rel="stylesheet" href="design-system/index.css">
<img class="wordmark" src="design-system/assets/loopclub-logo.png" alt="loop club">
<button class="btn-chrome">✦ press · 1 USDm</button>
<span class="chrome-pill">⚡ fast · 47m</span> <!-- silkscreen pill (legacy class name) -->
```

## Quick usage (from the loopclub `frontend/`)

See `CLAUDE.md` for the integration steps. Short version:
```ts
// frontend/src/main.tsx
import 'design-system/index.css';
import logoUrl from 'design-system/assets/loopclub-logo.png';
```

---

## Component cheatsheet

| Class                          | What it is                                |
|--------------------------------|-------------------------------------------|
| `.btn`                         | ghost / default / cancel                  |
| `.btn-chrome`                  | primary CTA — silver chrome               |
| `.btn-hot`                     | urgent CTA — LED red                      |
| `.chrome-pill`                 | silkscreen status pill (legacy name — no longer chrome) |
| `.sync-badge` + `.sync-dot`    | block-pulse heartbeat (mint LED)          |
| `.fastmode-btn` / `.fastmode-badge` | session-key fast mode (silkscreen pill; armed = mint) |
| `.cell` + `.cell.on.<track>`   | LED grid cell                             |
| `.cell.playing`                | white outline + prismatic halo on the current step |
| `.cell.preview`                | dashed silver outline on hovered fills    |
| `.cell.pending`                | optimistic tx in flight                   |
| `.cell.beat-1`                 | chrome stripe on every 4th step           |
| `.grid` + `.step-num`          | 16-step matrix layout                     |
| `.mini-cell` + `.mini-row`     | thumbnail grid (loop cards)               |
| `.cell-popover`                | toggle / claimed-by-other popover         |
| `.row-tools`                   | per-row fill popover (4·on·4 / euclid)    |
| `.keyboard`                    | synth-row pitch picker (white/black keys) |
| `.loop-card` + role variants   | library card (default / owned / contrib / playing) |
| `.tab` / `.tab.active`         | library tabs — silkscreen pills; active = pressed graphite + prism rim |
| `.role-badge.owned/.contrib`   | NFT / contributor badge (silkscreen pill, LED-tinted) |
| `.card-actions` + `.nft-link`  | card chips — quiet silkscreen; the gold NFT chip is the card's one metal |
| `.pb-back`                     | banner secondary nav — silkscreen pill (pair with `.btn`) |
| `.contrib-strip` + `.contrib-chip` | per-wallet colour key under the grid   |
| `.renew-strip` + `.rc.*`       | recent cells + one-click renew            |
| `.deck-controls` + `.deck-btn` | header deck-pad tray (Play / Audition / Press) |
| `.deck-btn.active`             | engaged deck pad — dark pressed-chrome reflection |
| `.account-group` + `.wallet-btn` | header chip — funds readout + ▾ wallet pill |
| `.connect-btn`                 | pre-auth CTA — `.btn-chrome` at deck-pad height (matches the Stop/Play/Press pads) |
| `.grid-wrap` + `.sync-badge`   | grid-anchored block-pulse heartbeat       |
| `.playback-banner` + `.pb-*`   | replay state banner above the grid        |
| `.modal-bg` + `.modal`         | centred dialog                            |
| `.toast`                       | bottom-centred transient status           |
| `.wordmark`                    | header img with drop shadow               |
| `.holo-sticker`                | rotated chrome chip with rainbow rim (header garnish) |

All component CSS is in `components/*.css` — every rule is commented with the
intent. Read those files directly when you need detail.

---

## Token cheatsheet

```css
/* Surfaces */
--bg --bg-elev --panel --panel-2 --border --text --muted

/* Brand violet */
--accent --accent-dim

/* Instrument LEDs */
--kick --snare --hat --synth --clap --open-hat --cowbell --crash --ride

/* Role / state — the semantic LED code (one meaning per colour) */
--accent (you) --go (live) --owned (ownership/money) --hot (urgent) --claude (jam)
--contrib --danger --ok

/* Silkscreen pill — the one quiet chip material */
--pill-bg --pill-border

/* Chrome system */
--chrome-fill --chrome-fill-button --chrome-fill-pressed --chrome-border --chrome-shadow
--rainbow-rim --rainbow-glow
--hot-fill --hot-border --hot-glow
--focus-halo --focus-halo-hot   /* keyboard focus rings — never the system blue */

/* MegaETH soft palette (decorative) */
--moon-white --full-moon --night-sky --peach --coral --hot-pink --magenta
--mint-soft --teal-mint --sky-soft --cyan-soft

/* Spacing (4px scale) — --space-1 through --space-12 */
/* Radii — --r-xs --r-sm --r-md --r-lg --r-pill */
/* Shadows — --shadow-popover --shadow-glow-accent --shadow-glow-owned --shadow-glow-hot */

/* Type */
--font-display --font-body --font-mono --font-readout
--fs-h1 --fs-h2 --fs-h3 --fs-body --fs-ui --fs-meta --fs-mono --fs-micro --fs-nano
```

---

## Iterating

Edit a token in `tokens/colors.css` (or `tokens/chrome.css` etc.) — every
component that uses that variable updates automatically. Components themselves
live in `components/*.css`; they only reference tokens, never raw values.

When in doubt, search `colors_and_type.css` and `ui_kits/loopclub/styles.css`
in the design-system source project for the original intent.
