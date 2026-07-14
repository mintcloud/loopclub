# loopclub cold start — the field recorder strategy

Written by fable (claude-fable-5) in response to Theo's brief: build organic
X presence for loopclub from zero, target 1000 followers, daily posts
including media, VPS-hosted bot, programmatic posting available.

Two "Open Verse" loops referenced below are live, real, playable loops
generated via the loopclub MCP tool as part of writing this strategy:

- **Open verse 001** (kick/snare/hat, synth row empty, 9 cells): `https://app.loopclub.xyz/?jam=AQEFEBAAAEREAAAAAAAAAAAAAAA`
- **Open verse 002** (6-note C-minor bassline, all drum rows empty): `https://app.loopclub.xyz/?jam=AQAAAAAAAAAAAAAAAAAAAABJSQaAJIMkhieIK4spjic`

---

## 1. The core insight

**The account is not a brand account. It is the only witness to a place.**

Every product account on CT does the same thing: describes its product from
outside, in marketing tense ("we're building…"). loopclub has something no
other project has: **a single, live, public location where things actually
happen** — and those things are gone two minutes later unless someone writes
them down. That's a news beat, not a marketing calendar. Nobody else can
cover it because there's nothing else like it to cover.

So the account's job is to be the grid's field recorder and its patron:

- **Field recorder**: report what actually happened on the grid — real cell
  counts, real coordinates, real wallets, real txhashes. Never aspirational,
  never "imagine if." The credibility of every post is checkable on-chain,
  which is exactly the currency crypto CT trades in after three years of
  vaporware fatigue.
- **Patron**: spend treasury money pressing community loops. This is the
  part everyone will miss and it's the actual engine: **a press is a payout
  event, and payout events are the only tweets other people are financially
  motivated to retweet.** When the account presses a Series, co-creators get
  paid, and those humans now have (a) money, (b) a story, (c) a permanent
  royalty stream that grows if the loop gets more attention. You've
  converted a marketing expense (~1.25 USDm) into unpaid distributors. That's
  the cheapest CAC mechanism available, and it's native to the contract — no
  referral program bolted on.

The deep structural fact: **loopclub's royalty split already turns players
into promoters.** Anyone frozen into a Series earns from every future press,
forever, so every co-creator has skin in the game of that loop getting seen.
The cold-start job on X is not "build an audience for the brand." It's
**manufacture co-creators, then be the venue where their payouts get
announced.** Followers are a byproduct.

## 2. The growth loop: Open Verses + the Press Pool

**The participation mechanic — "Open Verses."** The account posts a real,
playable, deliberately *incomplete* loop as a `?jam=` link: drums with an
empty synth row, or a bassline with no drums. Anyone who opens it, rents the
missing cells, and gets recorded into a Series becomes a permanent
co-creator. It's exquisite corpse for beats, and the blank row is a better
CTA than any "try our app" copy — an unfinished groove is an itch. The two
links above are live examples, postable today.

**The commitment — the Press Pool.** Standing public promise, pinned:
*every week, the treasury presses at least one community-recorded Series to
edition #3.* That's a real, recurring, on-chain-verifiable payout to
whoever built the best loop that week. Rules stated once, flatly: play
cells, get recorded, get paid if it's good. No form, no Discord role, no
"tag 3 friends." The chain is the leaderboard.

**Why this loops:** open verse → strangers complete it → someone records →
account presses → co-creators get paid → co-creators quote-tweet the payout
("I own 4/12 cells of this") → their followers open the next open verse.
Each cycle mints new people with permanent financial exposure to loopclub
being known.

**First 100 followers with zero audience — the wedge is MegaETH, full
stop.** loopclub is one of very few live consumer apps on MegaETH mainnet
where the chain's speed is *audible* — a 16th-note grid where every cell is
a write is the single best latency demo MegaETH could ask for. Ecosystem
accounts RT ecosystem apps; MegaETH's account is large and hungry for
exactly this proof. Concretely, week 1:

1. Post the unedited screen-capture video (Day 4 in the content plan below)
   and reply with it under MegaETH's own performance threads — not as
   promo, as evidence. One ecosystem RT is realistically 50–200 followers.
2. Theo spends 15 min/day replying from the account in three rooms: MegaETH
   ecosystem threads, on-chain music CT (sound.xyz/songcamp diaspora), and
   gen-art CT (ArtBlocks people are constitutionally wired for "state frozen
   at mint, never repeats"). Replies carry jam links, not slogans.
3. Targeted patronage: when any account with >2k followers plays and gets
   recorded, press their loop *unprompted* and tweet the receipt at them.
   People reliably retweet evidence that they earned money making music.

## 3. The daily content system

One main post per day from the bot (media on most days), plus Theo's 15 min
of manual replies. Weekly rotation:

| Format | Freq | Media generation |
|---|---|---|
| **Grid report** — shipping-forecast-style state of the grid: cells alive, contested coordinates, notable renewals | 2×/wk | Screenshot of live grid, timestamped; numbers from chain reads |
| **Open verse** — incomplete loop, playable link | 2×/wk | Rendered grid image + the real `?jam=` link |
| **Press receipt** — treasury presses a Series; payout split, wallets, txhash | 1×/wk (Press Pool) + event-driven | Screenshot of the Series page + explorer link |
| **Series ledger** — a community record() happened: grid of the frozen pattern, co-creator count, current edition price | event-driven | Rendered grid at recorded state |
| **Anatomy** — one mechanic stated flat (text-only is fine; these are the quotable ones) | 2×/wk | none, or a single annotated screenshot |
| **Live capture** — 20s screen recording *with audio* of the actual grid playing | 1×/wk | Screen recording; this is the highest-leverage asset, sound is the product |

The bot's daily job: read chain state → pick format by rotation + what
actually happened → generate media → post. Grid reports and receipts are
fully automatable; anatomy posts get drafted into a queue Theo approves
weekly (keeps voice tight, costs him 10 minutes).

**Hard rule: no post ever contains a number that isn't true on-chain.** The
day the account fakes a grid report is the day the entire positioning dies.

## 4. First 14 days

Voice rules applied: no hype adjectives, no rhetorical questions, mechanics
stated plainly. 11 of 14 are net-new angles versus prior approved tweet
batches. `[MEDIA]` marks assets. (Full text lives in
`x-bot/content/queue.json`, ready to post in order.)

1. **Recording is curation, not capture** — the recorder gets nothing, only cell-owners at freeze time get paid.
2. **Open verse 001** `[MEDIA: rendered, live link]` — 9 cells lit, synth row open.
3. **Priced vandalism** — full-grid spam costs ~$1/min, that's the whole moderation system.
4. **The unedited capture** `[MEDIA: 20s screen recording with audio]` — liveness as proof; the reply-post asset for MegaETH threads.
5. **The ninth buyer sets the price** — quadratic press curve specifics.
6. **Grid report 001** `[MEDIA: timestamped screenshot]` — new recurring format, real numbers only.
7. **First press receipt / Press Pool launch** `[MEDIA: Series + tx screenshot]` — patronage as policy.
8. **Accidental permanent equity** — the co-creator split freezes at record() block, no matter intent.
9. **Open verse 002** `[MEDIA: rendered, live link]` — bassline done, all drum rows open.
10. **Rent is attention** — cells expire in ~2 min; the grid has no memory except record().
11. **The contested coordinate** `[MEDIA: screenshot, cell circled]` — real most-renewed cell of the week.
12. **Most photographs are never taken** — most grid states vanish unrecorded; record() is the exception.
13. **Three continents, one bassline** `[MEDIA: synth row of a real multi-wallet Series]` — asynchronous strangers, no coordination.
14. **Week one ledger** `[MEDIA: stat card]` — real series/presses/USDm-paid/largest-payout numbers, contract address linked.

Days 6, 11, 13, 14 are **templates bound to reality** — the bot fills real
numbers or the post doesn't run. That discipline is the moat.

## 5. The 1000-follower math, honestly

Baseline for a niche crypto account posting well 1×/day with active replies:
**1–5 organic followers/day**. Pure grind gets you to 1000 in 8–12 months.
That's too slow, so the plan is grind + engineered spikes:

- **0 → ~150 (weeks 1–3):** MegaETH ecosystem replies + the Day 4 audio
  capture placed under the right threads. One ecosystem-account RT is the
  whole game here; loopclub is genuinely the best latency demo on that
  chain, so this is likely, not hopeful.
- **150 → ~450 (weeks 3–8):** Open Verse cycles + weekly Press Pool
  receipts. Each paid co-creator who quote-tweets is worth 10–50 followers
  from an adjacent audience. Gen-art and on-chain-music CT are small but
  extremely retweety.
- **450 → 1000 (months 2–4):** needs one or two hits — a capture video that
  travels, or a recognizable CT name getting recorded and paid. You can
  raise the odds of the second one: it costs ~1.25 USDm to press anyone's
  loop and hand them a reason to post.

**Realistic call: 1000 in 3–4 months.** Not 30 days — anyone promising that
for a product this structurally honest is describing bought followers.

**What would make me skeptical of 1000 as the goal itself:** it's the wrong
KPI. 1000 lurkers who never open the grid are worth less than 40 wallets
that play daily — because in this product, *players are the content* (grid
reports, series, payouts all require activity). If posts are landing but
growth stalls around 300–400, the constraint is grid liveliness, not tweet
quality. The fix is not ads (crypto follower ads buy bots) — it's **targeted
patronage at ~$50–100/month total**: commission 5–10 mid-tier music-CT and
MegaETH-CT accounts to *record a loop* — not to shill; they earn real
on-chain royalties and post about it because it's genuinely theirs.
Distribution through ownership is the whole thesis of the product. The
marketing should be made of the same material.

---

**What Theo needs to provide, in order:** (1) X developer credentials for
the bot; (2) a small treasury/hot-wallet budget for the Press Pool (~5–10
USDm/week covers it); (3) 15 min/day of human replies from the account for
the first three weeks — the bot can witness, but only a person can be in the
room. The two Open Verse links above are already live and can be posted
today.
