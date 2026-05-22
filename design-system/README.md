# Loopchain Design System

> Liquid-chrome wordmark, vivid LED instruments, deep-black stage. The visual
> system behind Loopchain — a collaborative on-chain drum machine on MegaETH.

This package contains every visual token, component recipe, asset, and font
the Loopchain app uses. The whole thing is plain CSS + assets — no build step,
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
│   └── topbar.css          ← .deck-controls, .deck-btn, .account-group, grid-anchored sync badge
├── assets/
│   ├── loopchain-logo-transparent.png  ← canonical wordmark (use this)
│   ├── loopchain-logo-cropped.png      ← black-bg variant
│   ├── loopchain-logo.png              ← original 1254² source
│   ├── og-cover.png                    ← legacy social card
│   └── logo-mark.svg                   ← legacy app mark
└── fonts/                              ← Gilroy .ttf, 14 cuts
```

---

## Design language — the 10-second version

- **Black stage** (`--bg: #020205`) so the chrome wordmark reflects.
- **Liquid-chrome wordmark** is the brand mark. **Always the PNG, never a recreation.** Mood is Daft Punk *Discovery* — polished mercury, rainbow rim, slightly molten contours.
- **Chrome surfaces** (`var(--chrome-fill-button)`) for primary actions. Flat printed-legend text, dark band at ~75% so labels stay legible. Reads like a TR-808 pad / cassette deck button.
- **Vivid LED grid cells.** Off cells are recessed dark bezels; on cells halate in their track colour (kick coral / snare peach / hat mint / synth sky / clap orange / open-hat green / cowbell purple / crash pink / ride blue).
- **`--hot-fill`** red is reserved for one-shot urgent CTAs (press now, expiring rent).
- **Space Mono** everywhere in product chrome. **Gilroy** (heavy) for display/headings. JetBrains Mono + Major Mono Display loaded as alternates.
- **Curated unicode glyph set** (`▶ ◼ ✦ ♪ ⚡ ⊕ ↗ ✕ # · …`) — never emoji.
- **Voice** — lowercase, monospace, command-style. Em dash separator. "Your" not "we". No marketing words.

---

## Quick usage (vanilla HTML / standalone)

```html
<link rel="stylesheet" href="design-system/index.css">
<img class="wordmark" src="design-system/assets/loopchain-logo-transparent.png" alt="Loopchain">
<button class="btn-chrome">✦ press · 1 USDm</button>
<span class="chrome-pill">⚡ fast · 47m</span>
```

## Quick usage (from the loopchain `frontend/`)

See `CLAUDE.md` for the integration steps. Short version:
```ts
// frontend/src/main.tsx
import 'design-system/index.css';
import logoUrl from 'design-system/assets/loopchain-logo-transparent.png';
```

---

## Component cheatsheet

| Class                          | What it is                                |
|--------------------------------|-------------------------------------------|
| `.btn`                         | ghost / default / cancel                  |
| `.btn-chrome`                  | primary CTA — silver chrome               |
| `.btn-hot`                     | urgent CTA — LED red                      |
| `.chrome-pill`                 | static chrome status chip                 |
| `.sync-badge` + `.sync-dot`    | block-pulse heartbeat                     |
| `.fastmode-btn` / `.fastmode-badge` | session-key fast mode (chrome chip)  |
| `.cell` + `.cell.on.<track>`   | LED grid cell                             |
| `.cell.playing`                | white outline on the current step         |
| `.cell.preview`                | dashed violet outline on hovered fills    |
| `.cell.pending`                | optimistic tx in flight                   |
| `.cell.beat-1`                 | chrome stripe on every 4th step           |
| `.grid` + `.step-num`          | 16-step matrix layout                     |
| `.mini-cell` + `.mini-row`     | thumbnail grid (loop cards)               |
| `.cell-popover`                | toggle / claimed-by-other popover         |
| `.row-tools`                   | per-row fill popover (4·on·4 / euclid)    |
| `.keyboard`                    | synth-row pitch picker (white/black keys) |
| `.loop-card` + role variants   | library card (default / owned / contrib / playing) |
| `.role-badge.owned/.contrib`   | NFT / contributor badge                   |
| `.contrib-strip` + `.contrib-chip` | per-wallet colour key under the grid   |
| `.renew-strip` + `.rc.*`       | recent cells + one-click renew            |
| `.deck-controls` + `.deck-btn` | header deck-pad tray (Play / Audition / Press) |
| `.deck-btn.active`             | engaged deck pad — pressed-in + accent LED ring |
| `.account-group` + `.wallet-btn` | header chip — balance + "⊕ My wallet"   |
| `.grid-wrap` + `.sync-badge`   | grid-anchored block-pulse heartbeat       |
| `.playback-banner` + `.pb-*`   | replay state banner above the grid        |
| `.modal-bg` + `.modal`         | centred dialog                            |
| `.toast`                       | bottom-centred transient status           |
| `.wordmark`                    | header img with drop shadow               |

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

/* Role / state */
--owned --contrib --danger --hot

/* Chrome system */
--chrome-fill --chrome-fill-button --chrome-border --chrome-shadow
--rainbow-rim --rainbow-glow
--hot-fill --hot-border --hot-glow

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

When in doubt, search `colors_and_type.css` and `ui_kits/loopchain/styles.css`
in the design-system source project for the original intent.
