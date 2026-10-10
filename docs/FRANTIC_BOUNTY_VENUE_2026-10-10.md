# Frantic: a second bounty venue, read-only until an owner swears in (2026-10-10)

## Why this venue at all

A live survey of the GitHub bounty pool the same day found no legitimate, unclaimed,
payable issue: the strong candidates were farms, clones, or honeypots (`$3,000` bait in a
Tenstorrent clone; a "fix `parse_duration`" live-fire trap; issue-number-inflated
auto-generated boards), and the two leads previously accepted by discovery were both
already handed to other contributors. Searching harder did not change that.

One real alternative surfaced inside the noise. **Frantic** is an agent-native bounty venue
that mirrors its board into a GitHub repository (`auscaster/frantic-board`) but declares
its own API as the contract, in its own words:

> "Do not use issue comments or social threads as the Frantic board protocol. The Frantic
> API, MCP read surface, bounty pages, and receipt ledger are the venue record."

That sentence is the reason this repository needs a separate reader instead of reusing the
GitHub-issue workflow: the mirrored issues are a projection, and claiming through them would
work the wrong contract on the wrong surface.

## Board state, read live on 2026-10-10 (`GET /v1/board`, `GET /v1/policy`)

```
founded 2026-07-09 · day 94 · live true · bounties_open 6
funded_usd 802 · season_total_usd 1898 · moved_usd 1302.85 (settled on the public ledger)
operators_enlisted 1344 · sworn_count 504
policy: rent_cents_per_day 1000 · welcome_runway_days 5 · max_runway_days 30 · live_cap 30000c
```

`moved_usd` is the venue's own settled-total figure, and every payout it claims resolves to
a public receipt (`/r/<ref>`). That is the property our result-verification gate has always
demanded: **external acceptance evidence exists as a third-party artifact, not as our
status column.**

| Bounty | Price | Slots | Claim gate state | Fleet verdict |
| --- | --- | --- | --- | --- |
| #130 Answer live Reddit threads with a dated fact from an open registry | $3 | 10/10 open | `requires_identity` | **refused** — the deliverable is an automated post on someone else's platform |
| #128 Earn a citation for an open data registry on a real external site | $8 | 11/15 open | `requires_identity` | **refused** — same class (third-party posting / SEO artifact) |
| #129 Earn a citation on an external page that already ranks | $16 | 9/10 open | `requires_identity` + prior paid bounty | **refused** — same class |
| #127 Publish an original piece on a site AI engines cite | $20 | 2/5 open | `requires_identity` + prior paid bounty | **refused** — publication on a third-party site |
| #97 "Your first bounty is on the house" | $10 rebate | 5/5 open | `requires_identity` | **refused** — pays only after the owner funds real work; self-dealing is explicitly forfeited |
| #33 Publish Sourcey docs for a maintained OSS library | $20 | 1/1 open | `requires_identity` + prior paid bounty | **the only genuine engineering task on the board** |

Every row — including the $3 one — is gated on `requires_identity`:

> "This paid bounty is $10 or less. It can be claimed after contact identity is verified."

So the board is not short of work; it is short of **a sworn-in operator**. No code we write
can produce that identity without acting as the owner, which is out of bounds by standing
instruction.

## Rules that decide eligibility (venue side, quoted)

* `$0` goodwill work: `agent_kid` + `agent_token` only.
* Paid work **≤ $10**: token **plus** verified contact (email) or `runx` GitHub identity.
* Paid work **> $10**: verified identity **plus** a GitHub account ≥ 90 days old with
  visible public activity, or one successful paid bounty.
* "One identity means one operator. Do not use multiple handles, emails, wallets, or agents
  to bypass caps, cooldowns, or payout limits." — the venue forbids exactly the account
  farming our own rules forbid.
* "Frantic pays you and never charges you: runway is earned by working, the money only ever
  flows to your wallet." `rent` is a clock (`rent_cents_per_day` prices the *deadline*, not
  an invoice); entry costs nothing, and no card or paid activation is involved. Verified in
  `/v1/policy` and `/SKILL.md`; nothing was registered to confirm it by doing.
* Claims use a fuse: a new claimant gets ~1 hour (up to 6 earned, or the poster's
  `claim_window_minutes`), so an abandoned claim burns the slot for everyone.

## Why #33 is a real task and how it actually fails people

Work: run the open-source generator `sourcey` (npm `sourcey`, v3.6.12, bin `sourcey`,
AGPL-3.0-only) against a **maintained third-party** OSS library at a pinned commit, host
the generated docs on a credible durable domain, and deliver `public_url`, `evidence_json`,
`receipt_ref`, `report`. Nine machine checks gate acceptance (JSON validity, `runx` CLI
≥ 0.6.13 recorded in `observations`, minimum evidence items, `url.live` with a
**1,000,000-byte response cap**, `url.public_surface` host reputation, `markdown.min_bullets`).

The live ledger for #33 shows 40 rejected attempts and 32 expirations. The rejections are
instructive, and every one of them is a defect our own gates already care about:

* oversized artifact → `public_url_live: response exceeds max_bytes policy (1003520 > 1000000)`
* hosting on `*.github.io` → "a blocked free/preview host… fails the bounty's own bullet"
* documenting your own fork of a library → "not a public proof on someone else's maintained library"
* an `evidence.json`/`report.md` that 404s at the delivered URL → rejected on review

The failure mode is not "the code was wrong"; it is **evidence that does not hold up
externally**. That is exactly the class of mistake `result-verification.ts` was written to
refuse, which is why this venue is worth integrating rather than ignoring.

## What was built today

* `src/mission/earning/frantic-board.ts` — a read-only client (`/v1/board`, `/v1/policy`,
  `/v1/bounties/{ref}`), host-pinned, size-capped, JSON-validated, with a screen that
  attaches quoted evidence to each verdict. It performs **no** signup, claim, delivery or
  payout call, and it refuses any method other than `GET` before I/O.
* `npm run board:frantic` (`scripts/mission-frantic-board.ts`) — prints the board, the
  economy, and a per-bounty verdict: `eligible_for_agent_work`, `blocked_by_owner_action`,
  `refused_policy`, `unverifiable`. `--json` for machines. A host without egress reports
  `frantic_transport_failure` and says *unverified*, never *empty*.
* `src/mission/earning/frantic-board.test.ts` — 7 tests on fixtures shaped from the live
  payload, including: rows without a number/title are dropped, absent acceptance text is
  `unverifiable`, third-party-posting and rebate bounties are policy refusals, the `> $10`
  tier stays blocked until a prior settled bounty exists, traversal-shaped references cannot
  escape the allowlisted read path, and only `GET` is ever issued.

Executed here: `npx tsx --test src/mission/earning/frantic-board.test.ts` → 7/7;
`npx tsc --noEmit -p tsconfig.json` → clean; `npx tsx scripts/mission-frantic-board.ts` →
`board unavailable: frantic_transport_failure` (the sandbox has no route to that host; only
`api.github.com` answers), which is the failure path the tests pin.

## Exact owner actions to reach the first claim

1. **Enlist** at `https://gofrantic.com/#enlist` (or `POST /v1/signup`) with the operator's
   public GitHub handle, a deliverable owner email, and an agent name. The response returns a
   one-time `agent_token` — store it in the mission credential vault
   (dashboard → Tools & credentials), never in chat, Git, or an artifact.
2. **Seal the identity**: click the emailed verification link (Signal). Optionally post the
   Oath comment from the claimed GitHub account and star the board repo (Lantern) — these are
   trust marks, not payout levers.
3. **Read `claimEligibility`** (`GET /v1/agents/{kid}/status`) and record which tier is open.
   ≤ $10 opens with email verification; the $20 tier also needs the account-age/activity
   proof or one settled paid bounty. Do not create extra identities to move between tiers —
   the venue forbids it and so do we.
4. **Choose the payout route** on the venue: x402/wallet (native) or a Stripe Connect bank
   off-ramp (optional). Then verify the matching `mission_payout_slots` row with the
   destination's own reference so our ledger and theirs describe the same destination.
5. **Decide the hosting surface for #33**: `public_url` must be a durable, credible home, and
   the payload must stay under 1 MB. The Railway service already serves static paths and is
   the obvious candidate; that is a production change, so it needs an explicit go-ahead.
6. **Allow the run**: the delivery needs `sourcey` (npm) inside the sandbox. Adding a package
   to the sandbox image is a supply-chain decision — say the word and it goes through
   `.github/workflows/bounty-sandbox-publish.yml` with a pinned digest.

Until step 2 exists, `board:frantic` will keep reporting every row as
`blocked_by_owner_action`, and the autonomous engine stays off — that is the intended state,
not a regression.

## What this file deliberately does not claim

No account was created, no bounty was claimed, no artifact was delivered, and no money
moved. The venue figures above are its own published numbers, read once, for the record.
