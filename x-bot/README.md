# loopclub X growth bot

Daily poster for `@loopclub` on X, built around the cold-start strategy in
[`docs/x-growth-strategy.md`](../docs/x-growth-strategy.md) (core idea: the
account is a field recorder for the one live grid, not a brand account —
report what actually happened, and let the Press Pool turn players into
paid co-creators who distribute for you).

## What's here

- `src/x_client.py` — OAuth 1.0a X client (text + image posting)
- `src/grid_image.py` — renders a loopclub grid into a branded PNG from the
  `describe_loop`/`build_loop` MCP tool's JSON output. No browser needed.
- `src/grid_capture.py` — screenshots/records the *live* grid with a headless
  browser. **Currently blocked, see below.**
- `src/post_next.py` — posts the next queued item from `content/queue.json`
- `content/queue.json` — 14 days of posts, written from the strategy doc.
  Two are ready to post today (real, live "Open Verse" loops); the rest are
  either plain text or explicitly marked `manual` because they need real
  on-chain numbers the bot doesn't fabricate.
- `deploy/` — systemd user service + timer (same no-Docker, no-sudo pattern
  as `seeder/` and `mcp/` on this VPS) + credential template.

## Setup

1. **Create/access the `@loopclub` X account** (or whatever handle you're
   using — none of this assumes a specific handle).

2. **X Developer Portal → new App** (developer.x.com):
   - User authentication settings → OAuth 1.0a, permissions = **Read and write**
   - Keys and tokens → generate **API Key & Secret**, then **Access Token &
     Secret** (generate the access token *after* setting Read+write, or
     regenerate it if you flip permissions after the token already exists —
     otherwise it's silently read-only).
   - OAuth 1.0a (not the OAuth2 PKCE flow telegram-agent's twitter-digest
     uses) because it's a single fixed account with no interactive login,
     and it's what the v1.1 media upload endpoint needs regardless.

3. **Install credentials on the VPS:**
   ```bash
   mkdir -p ~/.config/loopclub
   cp deploy/env.example ~/.config/loopclub/x-bot.env
   chmod 600 ~/.config/loopclub/x-bot.env
   # edit in the 4 real values
   ```

4. **Verify auth:**
   ```bash
   set -a; source ~/.config/loopclub/x-bot.env; set +a
   /home/theo/telegram-agent/venv/bin/python3 src/x_client.py
   # should print: [x_client] authenticated as @<handle> (id ...)
   ```

5. **Install the daily timer:**
   ```bash
   mkdir -p ~/.config/systemd/user
   cp deploy/loopclub-x-bot.service deploy/loopclub-x-bot.timer ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now loopclub-x-bot.timer
   journalctl --user -u loopclub-x-bot -f
   ```
   Fires once/day at 14:30 UTC (edit the `.timer` file's `OnCalendar` to taste).
   Each run posts the next `queued` item in `content/queue.json` and marks it
   `posted`. When the queue runs dry it exits quietly (check logs weekly and
   top it up — see "Keeping the queue full" below).

## Blocked: browser capture

`grid_capture.py` (screenshots/video of the *live* grid — the Day 4 "unedited
capture" post, arguably the single highest-leverage asset per the strategy
doc) needs Chromium system libraries this VPS doesn't have and installing
them needs `sudo`, which this agent doesn't have on this box. One-time fix,
run manually:

```bash
sudo /home/theo/telegram-agent/venv/bin/playwright install-deps chromium
# or, if that subcommand isn't available on this Playwright version:
sudo apt-get install -y libnspr4 libnss3 libasound2t64
```

After that, `grid_capture.py` works as-is (already tested against the real
Chromium binary — it only fails on the missing shared libs, nothing else).
Until then, `content/queue.json` marks every post that needs a live capture
or chain-read as `media.type: "manual"` so the bot won't silently post
placeholder numbers or skip the image — it just skips those posts.

## The Press Pool needs a funded wallet

The strategy's core growth loop (`docs/x-growth-strategy.md` §2) is the
account pressing real community loops with treasury funds so co-creators get
paid and have a reason to distribute. That needs:
- A small hot wallet with USDm, ~5–10 USDm/week is enough per the strategy doc
- Someone (Theo, for now) watching for good community-recorded Series and
  calling `press(seriesId)` — not automated here; this is a judgment call
  ("is this loop good"), not a cron job

## Keeping the queue full

`content/queue.json` is meant to be edited directly — append new `{day,
angle, text, media, status: "queued"}` objects to `posts`. Two content types
that don't need any new tooling:
- **New Open Verses** — use the `loopclub` MCP tool (`build_loop`) to design
  a new incomplete pattern, get its JSON back, save it, then:
  ```bash
  python3 src/grid_image.py --json new-verse.json --out content/media/verse-00N.png \
    --title "open verse 00N" --subtitle "<N cells claimed — <what's open>"
  ```
- **Plain "anatomy" posts** — no media needed, just append text. Keep the
  voice: mechanics stated flat, no rhetorical questions, no hype adjectives.

Posts needing real chain data (grid reports, press receipts, weekly ledgers)
need a small read-only script against the Loopclub contract — not built yet;
`contracts/` in the main repo has the ABI. That's the next piece of
automation worth building once the account is live and this becomes the
bottleneck.
