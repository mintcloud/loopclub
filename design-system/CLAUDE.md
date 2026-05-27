# Handoff brief for Claude Code

You are integrating the **Loopchain design system** (this folder) into the
loopchain `frontend/` app (the sibling folder in this repo).

The frontend currently has all its visual styles inline in
`frontend/src/index.css` (~1170 lines), with the original first-cut design
language (navy `#0a0a12` background, violet primary buttons, flat cells, no
wordmark). The new design system implements:

- **A new visual language** (pure-black stage, liquid-chrome wordmark, silver
  chrome buttons, LED-bezel grid cells, Space Mono everywhere).
- **A proper structure** — tokens (CSS custom properties) split from components
  (utility classes) for clean diffability and override.

**Your job:** wire the frontend to consume this design system, deleting the
duplicated/older styles from `frontend/src/index.css`. Visual result should
match the new language (see `design-system/README.md` for the design spec).

---

## Step 1 — Decide on workspace wiring

Check the loopchain repo root for a `package.json`:

- **If it has `"workspaces": [...]`**: add `"design-system"` to the array. The
  frontend can then `import 'loopchain-design-system'` after running install.

- **If it does NOT have a workspaces config and you don't want to add one**:
  use a relative-path import instead. In `frontend/src/main.tsx`:
  ```ts
  import '../../design-system/index.css';
  ```
  And in any file that needs the logo asset:
  ```ts
  import logoUrl from '../../design-system/assets/loopclub-logo.png';
  ```
  This is fine — Vite resolves it.

Pick whichever is simpler for the current repo. The relative-path approach is
zero-config and recommended if there's no existing workspace setup.

---

## Step 2 — Import the design system

In `frontend/src/main.tsx`, add the CSS import **before** the existing
`import './index.css'` line:

```ts
import '../../design-system/index.css';
import './index.css';   // (will be slimmed in step 3)
```

Order matters: the design system goes first so any remaining frontend rules
can override if needed during the migration.

---

## Step 3 — Strip duplicated rules from `frontend/src/index.css`

The design system now owns every rule that came from the original index.css.
**Delete from `frontend/src/index.css`** the following blocks (they're all
re-implemented in design-system, better):

- The `:root { … }` block at the top (lines 1–26)
- `button { … }`, `button.primary { … }`, `button.hot { … }` (lines ~31–60)
- `.app { … }` (it's a layout helper, **keep this** in frontend — it's app-level)
- `.header { … }` and `.header h1 { … }` — keep `.header`'s flexbox, **delete** the `.header h1` rule (we use `<img class="wordmark">` now)
- `.balance` (move to design-system later if reused; for now keep)
- `.grid { … }`, `.grid .label`, `.track-dot`, `.cell { … }`, `.cell.on*`, `.cell.playing`, `.cell.beat-1`, `.cell.pending`, `.cell.just-landed`, `@keyframes pendingPulse`, `@keyframes landPop`, `.step-num*` (lines ~85–225)
- `.toast` (lines ~145ish)
- `.modal-bg`, `.modal`, `.modal h3`, `.modal input/select`, `.modal .row`, `.share-url*`
- `.pitch-picker*`, `.keyboard*`, `.key*`, `.keyboard-blacks`, `.keyboard-caption`, `.keyboard-whites`
- `.controls`
- `.playback-banner*`, `.pb-status`, `.pb-cta*`, `.pb-headline`, `.pb-sub`, `.pb-press`
- `.library*`, `.tab*`, `.library-grid`, `.loop-card*`, `.token-id`, `.loop-card-head`, `.loop-card-foot`, `.card-actions*`, `.role-badges`, `.role-badge*`
- `.mini-grid`, `.mini-row`, `.mini-cell*`
- `.popover-layer`, `.cell-popover`, `.popover-head`, `.popover-title`, `.popover-x`, `.popover-duration`, `.popover-cost`, `.popover-actions`, `.popover-arrow`, `.popover-claimed`, `.claimed-owner`, `.claimed-dot`, `kbd`
- `.sync-badge*`, `.sync-dot`, `@keyframes blockPulse`, `@keyframes dim`
- `.fastmode-btn*`, `.fastmode-badge*`, `.fastmode-bolt`, `.fastmode-off`, `@keyframes boltPulse`
- `.contrib-strip*`, `.contrib-label`, `.contrib-list`, `.contrib-chip*`, `.contrib-dot`, `.contrib-count`
- `.row-tools*`, `.row-tools-grid*`, `.rt-label`, `.rt-cost`, `.row-tools-euclid*`
- `.renew-strip*`, `.renew-counts`, `.rc*`
- The `@keyframes pendingPulse`, `expirePulse`, `landPop` block

**Keep** in `frontend/src/index.css`:
- `.app { … }` (layout container)
- `.header { … }` (the flex/border-bottom, NOT the `h1` rule)
- Any rule whose selector contains a frontend-only state class I haven't listed (read carefully — when in doubt, leave it and check whether the design-system version is more correct).

After this step `frontend/src/index.css` should shrink from ~1170 lines to
maybe ~100 lines (just `.app`, `.header`, and any leftover app-specific layout).

---

## Step 4 — Swap class names in the React tree

A handful of components currently use `className="primary"` for the primary
CTA. The design system's primary is now `.btn-chrome`. **Replace** in JSX:

| Search                                           | Replace with                                  |
|--------------------------------------------------|-----------------------------------------------|
| `className="primary"`                            | `className="btn-chrome"`                      |
| `className={canRecord ? 'primary' : ''}`         | `className={canRecord ? 'btn-chrome' : 'btn'}` |
| `className="hot"`                                | `className="btn-hot"`                         |
| `className={... ? 'hot' : 'primary'}`            | `className={... ? 'btn-hot' : 'btn-chrome'}`  |
| `className="primary pb-press"`                   | `className="btn-chrome pb-press"`             |
| `className="hot pb-press"`                       | `className="btn-hot pb-press"`                |
| `className="tab"` / `className="tab active"`     | keep as is — these are library tabs, scoped   |

Files to check: `App.tsx`, `CellPopover.tsx`, `Library.tsx`,
`PlaybackBanner.tsx` (if present), `RenewStrip.tsx`, `RowToolsPopover.tsx`.

Also: bare `<button>` (no className) currently inherits the default ghost
style. That still works — the design system defines `.btn` as a class but the
old `button { … }` rules already styled bare buttons identically. To be
cleaner, **add `className="btn"` to every bare `<button>`**. Optional but
recommended.

---

## Step 5 — Replace the header `<h1>Loopchain</h1>` with the wordmark image

In `frontend/src/App.tsx`, find:
```tsx
<h1>Loopchain</h1>
```

Replace with:
```tsx
<img className="wordmark" src={logoUrl} alt="loop club" />
```

(where `logoUrl` is the import you added in Step 2, or `'/loopclub-logo.png'`
if you copied the PNG into `frontend/public/` instead).

If you prefer the PNG to live in `frontend/public/` rather than imported,
`cp design-system/assets/loopclub-logo.png frontend/public/`
and use `src="/loopclub-logo.png"` — equivalent.

---

## Step 6 — Sanity check (visual)

Run `npm run dev` and verify:

- Header shows the chrome wordmark (not text)
- Background is pure black (not navy)
- Primary buttons look like silver metal — bright top, dark trough in the lower third, flat label
- Grid cells: off cells look recessed (subtle inner shadow); on cells halate in their track colour
- Sync badge / fast mode pill / role badges look like silver chrome chips
- Body font is Space Mono (rounder than the previous JetBrains)
- Track labels show a `⋯` glyph on hover (row-tools affordance)

If something looks like it's reverted to the old style, check
`frontend/src/index.css` — a leftover duplicate rule is winning the cascade.
Delete it.

---

## Step 7 — Move app-specific rules into design-system (optional follow-up)

If you find rules in `frontend/src/index.css` that are clearly system-level
(e.g. `.balance`, `.header-left`, or any utility used by 2+ components), feel
free to migrate them into the appropriate `design-system/components/*.css`
file. Open a PR with the change so the design system catches up.

The design system intentionally does NOT contain:
- App-level layout (`.app`, the `.header` flex skeleton, `.header-left`)
- Privy / wallet-specific UI (`.wallet-modal-actions`, the disconnect button)
- Anything that depends on contract / chain state

These belong in the frontend.

> **Top-bar reorg (PR #4) — already migrated.** The header's two grouped
> clusters — `.deck-controls` (the Play / Audition / Press pad tray) and
> `.account-group` (balance + `.wallet-btn`), plus the grid-anchored
> `.sync-badge` positioning — now live in `components/topbar.css`. They were
> added app-side before this design system existed and the handoff predates
> that PR, so the clusters were folded in afterwards and re-expressed in
> tokens (chrome surface, `--r-lg` radii, `--space-*`, `--fs-*`). The two
> clusters share `--topbar-cluster-h` so the header reads as one aligned
> strip. The `.header` flex skeleton itself stays app-level — only the
> reusable clusters moved.

---

## Notes / gotchas

- **The 5 alternate track colours** (`clap`, `open-hat`, `cowbell`, `crash`, `ride`) are present in tokens and `.cell.on.<track>` selectors. If the frontend's `TRACK_LABELS` ever grows beyond `kick/snare/hat/synth`, the design system is already ready.
- **`--font-readout`** is aliased to `--font-mono` by default. To audition a tracker font on just counters (block #, USDm balance, step numbers), set on a scope:
  ```css
  .app { --font-readout: 'Major Mono Display', monospace; }
  ```
- **The kick/snare/hat/synth labels** in the existing frontend currently render as plain text — the design system provides `.track-dot.<track>` as the canonical accompanying dot. If you want the colour dots back in the row labels (they were in the original product), wrap track labels:
  ```tsx
  <div className="label track-tools"><span className={`track-dot ${trackName}`} />{trackName}</div>
  ```
- **The original design uses pure-violet `.cell.on { background: var(--accent) }` as the default.** The new design system's `.cell.on` requires a track variant (or `.mine` / `.other`) to set `--led`. If you find a code path that lights cells without specifying a track, add the track class.

---

## Done — what to push

Single PR with:
1. New folder `design-system/` (this folder, untouched)
2. Modified `frontend/src/main.tsx` — import design-system CSS
3. Slimmed-down `frontend/src/index.css` — only app-specific layout
4. JSX changes from Steps 4–5
5. (If using workspaces) updated root `package.json`

No version bumps needed — both packages are internal.

Ping the design-system author if any token feels wrong; the iteration history
is preserved in the parent Claude project that produced this folder.
