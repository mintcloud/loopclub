# loopclub seeder — presence-gated cold-start loopbot

A tiny Node service that keeps the loopclub grid from ever looking dead. It
**jams the live grid on-chain only while a real person is on the site** and the
human area of the grid is empty — then fades out musically when the room empties
or a human starts playing.

This is strictly better than an always-on bot: the on-chain ledger only ever
fills with bot loops *while a human was actually watching* (clean provenance —
"every loop in history happened in front of a real person"), and idle cost is
zero.

## How it works

One process, two halves:

- **Presence collector** — an HTTP `POST /beat` endpoint. The frontend
  (`usePresence` hook) mints an ephemeral session id and beats it on load + every
  15 s. We keep an in-memory `Map<id, lastSeen>`; nothing is ever persisted.
  **Active visitors = sessions seen in the last 30 s.** That TTL is the
  hysteresis: a refresh re-beats well under it (no flicker); a closed tab drops
  off within it.
- **Jam controller** — a 3 s control loop holding an on-chain ownership map
  (ported from the frontend's `useLiveGrid`: a multicall snapshot + `CellRented`
  event stream + a 20 s reconcile). Each tick:

  ```
  shouldJam = (activeVisitors >= 1) AND (humanCells == 0)

  IDLE   → if shouldJam: pick a groove, rent ~6 free cells for 8 loops (~32 s)
  ACTIVE → human joins (humanCells > 0) → stop renewing (cede the floor)
           room empties (activeVisitors == 0) → stop renewing (fade out)
           else → renew cells nearing expiry; swap groove every 4th cycle
  ```

  "Stop renewing" needs no teardown — the short rentals expire on their own
  within a loop or two, so the bot always **fades musically** rather than
  vanishing. If conditions return it re-activates on the next tick.

Grooves come from `loopclub-loopgen`'s genre templates (house / boom-bap /
techno / dnb) — the same musical brain the MCP server and frontend use — so the
bot plays idiomatic loops, not random cells. Every groove keeps 1–2 synth notes
(melody) and biases **off the kick row**, so a newcomer's first tap always has
room and never collides with the bot.

### Why it's safe by construction

- **Crawlers/scrapers don't run JS** → never beat → never counted. Only real
  browsers running the SPA register as visitors.
- **The seeder never beats itself**, so it can't self-trigger (the classic
  always-on failure mode).
- **Fail-safe direction:** if beats stop arriving (collector restart, tunnel
  down) active → 0 → the bot goes **silent**, not runaway. Visitors re-beat
  within 15 s and it resumes. Silence-on-failure is the correct bias.
- **Daily rent cap** (`DAILY_RENT_CAP_USDM`) and **dry-run** (`DRY_RUN`) bound
  the blast radius of a logic bug during rollout.

## Layout

```
src/
  index.ts      entrypoint — wires it all together, handles shutdown
  config.ts     env parsing (the only secret is SEEDER_PRIVATE_KEY)
  chain.ts      viem public/event/wallet clients for MegaETH
  abi.ts        the Loopclub + USDm ABI subset the seeder touches
  grid.ts       on-chain ownership map (headless port of useLiveGrid.ts)
  presence.ts   in-process /beat collector + TTL active-visitor count
  jam.ts        groove selection (loopgen) + rent execution (toggle/approve)
  loopbot.ts    the presence-gated state machine
  notify.ts     internal self-watchdog (restart-on-hang, dependency-free)
deploy/
  loopclub-seeder.service          systemd user unit
  seeder.env.example               config template (copy to ~/.config/loopclub/)
  cloudflared-ingress.example.yml  one tunnel ingress line for /beat
```

## Build order (how this was rolled out)

1. **Seeder skeleton** — grid map + jam/renew/fade against the contract, run
   with `FORCE_ACTIVE=true DRY_RUN=true` to prove the on-chain behaviour with no
   spend and no heartbeat yet.
2. **Presence collector** — `/beat` + TTL map in the same process; drop
   `FORCE_ACTIVE` so the real visitor count drives it.
3. **Frontend hook** (`usePresence`) + tunnel ingress + `VITE_PRESENCE_URL`.
4. **systemd unit** + linger; verify a `kill -9` triggers auto-restart.
5. **Fund the wallet** with a few USDm, set `DAILY_RENT_CAP_USDM`, flip
   `DRY_RUN=false`, and watch `journalctl` while loading the site fresh.

## Run locally

```bash
npm install
npm run build

# Dry-run against mainnet with a throwaway key — watches the real grid, sends
# nothing. FORCE_ACTIVE makes it behave as if a visitor is present.
SEEDER_PRIVATE_KEY=0x<32-bytes> \
RPC_URL=https://mainnet.megaeth.com/rpc \
LOOPCLUB_ADDRESS=0x1030D1a60e248E280294d1b04394f706904E3631 \
DRY_RUN=true FORCE_ACTIVE=true \
npm start
```

`npm run dev` runs the same via `tsx watch`. Outside systemd the internal
watchdog still works; `NOTIFY_SOCKET` is simply unset.

## Deploy (VPS, no sudo / no Docker)

See `deploy/loopclub-seeder.service` for the full ritual. In short:

```bash
mkdir -p ~/.config/systemd/user ~/.config/loopclub
cp deploy/loopclub-seeder.service ~/.config/systemd/user/
cp deploy/seeder.env.example      ~/.config/loopclub/seeder.env
chmod 600 ~/.config/loopclub/seeder.env   # then edit in the real key
loginctl enable-linger <user>
systemctl --user daemon-reload
systemctl --user enable --now loopclub-seeder
journalctl --user -u loopclub-seeder -f
```

Then add the one presence ingress line from
`deploy/cloudflared-ingress.example.yml` to `~/.cloudflared/config.yml` and set
`VITE_PRESENCE_URL=https://presence.<your-tunnel-domain>` in Vercel.
