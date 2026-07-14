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

  IDLE   → if shouldJam: take the next groove off the rotation, rent its cells
  ACTIVE → human joins (humanCells > 0) → stop renewing (cede the floor)
           room empties (activeVisitors == 0) → stop renewing (fade out)
           groove held for GROOVE_HOLD_MS → rotate to the next one
           else → renew the current groove's cells as they near expiry
  ```

  "Stop renewing" needs no teardown — the short rentals expire on their own
  within a loop or two, so the bot always **fades musically** rather than
  vanishing. If conditions return it re-activates on the next tick.

### The rotation

The bot walks a flat pool with a monotonic counter (`POOL=genres|setlist|mixed`):

- **genres** — `loopgen`'s procedural templates (house / boom-bap / techno / dnb).
  Sparse and drum-led: 1–2 synth notes for melody, biased **off the kick row** so
  a newcomer's first tap never collides with the bot.
- **setlist** — `loopgen`'s hand-authored tunes: Seven Nation Army, We Will Rock
  You, Thunder Clap, Olé Olé Olé, Batucada, Ode to Joy, La Marseillaise. Plus
  anything you paste into `SETLIST_LINKS` as a `?jam=` deep link (the MCP
  `build_loop` output). A tune is **melody-first**: its synth row is rendered
  whole and drums are dropped before notes, because Seven Nation Army without its
  riff is not Seven Nation Army.

Both come from `loopclub-loopgen` — the same musical brain the MCP server and the
frontend use — so the bot plays idiomatic loops, not random cells.

The rotation counter is **monotonic and clock-seeded**, deliberately. The first
version indexed the genre list by `cycle % 4` while firing the swap on
`cycle % 4 === 0`: with four genres the two moduli aliased and *every* swap landed
on `pool[0]`. The bot played house, only house, forever.

### What it costs

Rent is charged per cell per loop, so a lit cell costs `rentPerLoop` (0.004 USDm)
every 4-second loop — **0.001 USDm/second**. Burn is `cells lit × seconds held`
and nothing else; renting for longer isn't cheaper, it just pays further ahead.
Per hour of *continuous* jamming: a 6-cell genre groove ≈ 22 USDm, a 14-cell tune
≈ 50 USDm. The bot only jams while a visitor is present and no human holds a cell,
so real spend is a fraction of that — but on a busy day the fraction isn't small.
`HOURLY_RENT_CAP_USDM` is the governor: when the hour's budget is spent, the bot
fades and sits out until the window frees.

### What bounds it

- **Crawlers/scrapers don't run JS** → never beat → never counted. Only real
  browsers running the SPA register as visitors.
- **The seeder never beats itself**, so it can't self-trigger (the classic
  always-on failure mode).
- **Fail-safe direction:** if beats stop arriving (collector restart, tunnel
  down) active → 0 → the bot goes **silent**, not runaway. Visitors re-beat
  within 15 s and it resumes. Silence-on-failure is the correct bias.
- **Daily rent cap** (`DAILY_RENT_CAP_USDM`) and **dry-run** (`DRY_RUN`) bound
  the blast radius of a logic bug during rollout.

### A beat is a claim, not a proof

This section used to say "safe by construction," and it was wrong. `/beat` is a
public endpoint — a static frontend can't hold a secret — so **anyone who reads
the bundle can POST a beat**, and a beat makes robodj spend real USDm. CORS did
not stop this: those headers are a contract the *browser* enforces, and a forger
doesn't use a browser. One `curl` bought a fake visitor.

What's there now, in order of what it actually buys:

1. `PRESENCE_ALLOW_ORIGIN` — a comma-separated allowlist, **checked server-side**
   and rejected with 403. Stops every beat from a page we don't own and every
   naive script. A forged `Origin:` header still gets through, which is why it
   isn't the last line.
2. `PRESENCE_MAX_BEATS_PER_MIN` (40) and `PRESENCE_MAX_SESSIONS_PER_IP` (8), keyed
   on `CF-Connecting-IP` — one host can't fake a crowd or flood the collector. A
   real tab beats 4×/min, so these are loose on purpose: they bound abuse without
   ever policing a visitor. (The socket address is useless as a key here: behind
   the tunnel every connection arrives from 127.0.0.1.)
3. **The rent caps are the real perimeter.** Presence decides *whether* robodj
   plays; `HOURLY_RENT_CAP_USDM` / `DAILY_RENT_CAP_USDM` decide what that can ever
   cost. A determined forger can still keep the bot playing to an empty room — the
   cap is what makes that merely annoying instead of expensive. Treat presence as
   advisory and the caps as the boundary, never the other way round.

### The caps have a memory now (`ledger.ts`)

And they need one, because they are the *only* fence. The wallet isn't: the funder
tops the seeder back up to `FUND_TARGET_USDM` whenever it drops below the low
watermark, so the balance is a faucet. Everything that stands between a runaway
loop and the contract's whole balance is `HOURLY_RENT_CAP_USDM`.

Those windows used to live in RAM, and the unit is `Restart=always` /
`RestartSec=5`. So every bounce forgave the hour: the watchdog fires, the process
comes back five seconds later with `daySpent = 0`, and the cap it enforces is a cap
on an *uptime*, not on a day. A crash-looping bot could spend its hourly budget
twelve times a minute without ever breaking a rule — every individual rent is
legal; only the sequence is wrong.

`RENT_STATE_PATH` fixes that. One small JSON file, written after every spend
(atomically — tmp + rename, so a `kill -9` mid-write leaves the old ledger rather
than a truncated one), read back at boot. A restart now *remembers*.

- **`DRY_RUN` never writes it.** A cost-modelling run books its imaginary spend in
  memory only, so it can't eat the live bot's budget.
- **A corrupt ledger doesn't wedge the bot.** It's quarantined to `.corrupt`,
  logged loudly, and the bot starts from zero — availability over accounting, but
  never silently.
- The boot log tells you what it remembers: `[jam] ledger …: 12.40 USDm this hour,
  108.00 today — caps 60/h, 400/day`.

## Requests — "play Seven Nation Army next"

`REQUESTS_ENABLED=true` turns the presence collector into a request desk as well:
`GET /repertoire` (the chips the frontend renders) and `POST /request { id, groove }`.
A queued request jumps the rotation and plays within a tick or two; the frontend's
`RequestStrip` renders nothing at all unless `/repertoire` says the feature is on,
so there's no flag to keep in sync on the web side. Asking is free — robodj pays.

**A request names a groove. It never carries a spec.** That sentence is the whole
security model, and it's worth being precise about why.

A groove's cost is `cells × rentPerLoop × rentLoops` — so **cost lives in the
arguments**. If a visitor could hand robodj a *spec* (free text via an LLM, a
`?jam=` link, a raw track list), then "make it a wall of sound" is one request that
lights 144 cells instead of 6: same call, same shape, same schema, **24× the
rent**. Nothing in a rate limiter or a JSON schema would notice, because neither of
them reads the arguments for money.

So the vocabulary is closed: a request may only name a groove already in the
rotation pool, and the cell count is `REQUEST_CELLS` — a number *you* set, applied
through the same `chooseCells` trim every other groove goes through
(`loopbot.play()`). The requester picks the tune; the seeder picks the price.

The rest are rate bounds, because requests change how *often* robodj rents:

| knob | default | what it stops |
|---|---|---|
| `REQUEST_QUEUE_MAX` | 8 | continuous rotation-on-demand |
| `REQUEST_COOLDOWN_MS` | 60 000 | one visitor holding the floor (keyed on `CF-Connecting-IP` — a session id is free to mint, an address isn't) |
| `REQUEST_TTL_MS` | 120 000 | paying for a request nobody stayed to hear |

And the rent caps remain the ceiling above all of it. This is a rate limiter, not a
budget: it decides how often robodj is *asked*, not how much it can ever spend.

## The brain — `MCP_URL` and the chokepoint

Unset, `loopgen` renders grooves in-process, as it always has. Set, **every groove
— a visitor's request and the idle pulse alike — is rendered by calling
`build_loop` on the MCP server**, and the bot plays the loop that comes back
(decoded from the returned deep link, so if something in the path rewrote the loop,
we play the version that was approved rather than the one we asked for).

Why route an encode call over the network at all? Because it makes the MCP call a
**chokepoint**: one place every spec robodj will ever play must pass through,
carrying the argument that decides the money. Put a proxy in front of it — a
gateway, a policy engine, an audit log — and it can see and price every future
spend *before* a single `toggle()` is signed. Point `MCP_URL` at the proxy instead
of the server and robodj's code doesn't change by one line.

Two rules make it real, and both are in `brain.ts`:

1. **Everything goes through it.** The idle pulse too, not just requests. A
   chokepoint with a second door is not a chokepoint — it's a suggestion with good
   PR.
2. **It fails closed.** If the call errors or times out, robodj plays *nothing*. It
   does not fall back to the local renderer, because a control you can bypass by
   knocking the proxy over isn't one. Silence is the right failure direction, and
   it's the same bias the presence collector already takes.

## Layout

```
src/
  index.ts      entrypoint — wires it all together, handles shutdown
  config.ts     env parsing (the only secret is SEEDER_PRIVATE_KEY)
  chain.ts      viem public/event/wallet clients for MegaETH
  abi.ts        the Loopclub + USDm ABI subset the seeder touches
  grid.ts       on-chain ownership map (headless port of useLiveGrid.ts)
  presence.ts   in-process /beat collector + TTL active-visitor count (+ the
                request desk: GET /repertoire, POST /request)
  requests.ts   the request queue — the closed vocabulary and the rate bounds
  brain.ts      where a spec comes from: loopgen in-process, or build_loop over
                MCP (the chokepoint — fails closed)
  ledger.ts     durable rent-cap windows (survive Restart=always)
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

## Keeping the wallet funded (the funder)

The bot pays rent on every `toggle()`, so the seeder wallet slowly drains. The
Loopclub contract, meanwhile, *accumulates* the unattributed slice of all rent
(the rent paid into `toggle()` is never auto-routed, plus split rounding dust),
withdrawable by the owner via `sweepUnattributed(to, amount)`. `src/fund.ts`
closes that loop: when the seeder balance dips below a low watermark it sweeps
just enough contract USDm into the seeder to reach a target. Run it on a timer
and the seeder never runs dry.

It is a **separate one-shot process** from the bot and signs with the **owner**
key (the only key allowed to sweep) — never the seeder key. The seeder's own
public address is the top-up destination, passed as `SEEDER_ADDRESS` (no seeder
private key needed by the funder).

**Safety.** Not all of the contract's USDm is sweepable — pending secondary
royalties (`depositRoyalty` minus `claimRoyalty`) are earmarked for holders. The
funder replays `RoyaltyDeposited` / `RoyaltyClaimed` events incrementally (the
cursor + totals are cached in `funder-state.json`) and never sweeps into that
reserve, plus an optional `FUND_RESERVE_BUFFER_USDM` cushion. It also verifies
the signing key is the on-chain `owner()` before doing anything.

```bash
# Dry-run first: compute the decision, send nothing.
OWNER_PRIVATE_KEY=0x<owner-32-bytes> \
SEEDER_ADDRESS=0x<seeder-public-address> \
FUND_LOW_USDM=10 FUND_TARGET_USDM=50 DRY_RUN=true \
npm run fund          # or `npm run fund:dev` to run from source via tsx
```

Automate it with the timer (no-op when the balance is fine, so frequent runs
are harmless):

The deploy files carry a `/home/<user>/` placeholder (the repo holds no real
username), so substitute your home dir **on copy** — copying them verbatim
leaves a literal `<user>` in the path and the unit fails with `203/EXEC`. The
`.timer` has no paths, so it copies as-is:

```bash
sed "s|/home/<user>/|$HOME/|g" deploy/loopclub-funder.service > ~/.config/systemd/user/loopclub-funder.service
cp deploy/loopclub-funder.timer ~/.config/systemd/user/
cp deploy/funder.env.example    ~/.config/loopclub/funder.env
chmod 600 ~/.config/loopclub/funder.env   # then edit in the OWNER key + seeder address
systemctl --user daemon-reload
systemctl --user enable --now loopclub-funder.timer   # default: every 6h
systemctl --user start loopclub-funder.service        # fire once now
journalctl --user -u loopclub-funder.service -f
```

> The unit's `node` path also pins a version (`v22.22.0`). If `node -v` differs
> on your box, fix the `ExecStart` / `PATH` version too (or point them at
> `$(which node)`).

> The funder tops up **USDm** only. The seeder also needs a little native ETH
> for gas on each `toggle()`; that is not swept from the contract (the contract
> holds no ETH) — keep a small ETH float on the seeder separately.
