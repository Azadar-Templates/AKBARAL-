# RESUME CHECKPOINT — AKBARAL! + ZA141251SA

Purpose: let any session continue **without repeating the audit**. Everything
below is verified-by-execution state, not intention.

**Checkpoint commit:** `8a86515` on `arena/01a0e339-akbaral`
**Remote HEAD:** `8a86515` (confirmed identical via `git ls-remote`)
**Working tree:** clean
**Date:** 2026-09-27

---

## 1. STATUS: THE AUDIT AND RECONCILIATION ARE COMPLETE

Do **not** re-run them. Deliverables already in the repo:

| File | Contains |
|---|---|
| `AUDIT_2026-09-27_TAKEOVER.md` | Original A–Z audit, sections A–L |
| `TAKEOVER_STATE_2026-09-27.md` | **Authoritative A–Z reconciliation**, both planes, one status per capability |
| `CHECKPOINT.md` | This file |

---

## 2. COMMITS (all pushed, all CI-green)

| Commit | Summary | verify | docker-publish |
|---|---|---|---|
| `6068b6e` | Dashboard 500 + 6 schema defects; CI unblock; 3 PostgreSQL defects | ✅ | ✅ |
| `c67640a` | **Real earning provider**; $0 free-tier chat; closed gate bypass | ✅ | ✅ |
| `8a86515` | Immutable digest pin; state reconciliation | ✅ | ✅ |

---

## 3. VERIFICATION SNAPSHOT — do not redo

| Check | Result |
|---|---|
| Full suite | **2,081 pass / 0 fail / 0 cancelled** (142 files) |
| TypeScript | 0 errors |
| `test:pg` (real PostgreSQL) | **48 / 48** |
| `mission:pg-check` | **10 steps, 0 failures + 75 tests** — 36 migrations, 123 tables |
| Browser (real Chromium) | **19 / 19** desktop + mobile, 0 external requests |
| `build:webpack` | PASS (28/28 static pages) |
| Secret scan | PASS |
| CI | verify + docker-publish green on all three commits |

**Deployed image (immutable):**
`ghcr.io/azadar-templates/akbaral@sha256:8502cd0a0e6916c2208ee01dc7a25e30bd3e44d00b118022ae2fed0602056fa4`

**VERIFIED REVENUE: $0.00.** No provider credentialed; no external payment received.

---

## 4. KEY IMPLEMENTATION FACTS

- `src/mission/earning/providers/stripe-direct-earning.ts` — first real
  `EarningProvider`. **Detects** settled customer charges; never creates money.
  Shares the id `stripe-mission` with `MissionStripe` because `runEarning()`
  requires `opportunity.provider === earning.id === payments.id`.
- `src/mission/earning/providers/registry.ts` — replaced the hardcoded `[]` in
  `scripts/mission-money-worker.ts`. Activates only on real live credentials.
- `src/mission/chat-provider.ts` — free-tier dispatch requires opt-in **and** a
  free-tier model **and** a free-tier cost basis. Paid usage still fail-closed.
  `LIVE_CHAT_ADAPTER` tag replaced the `adapter === invokeGoogleChat` identity
  check, which **failed open** through the production worker's wrapper.
- `GET /api/earning-readiness` — owner-authenticated; 401 unauthenticated.

---

## 5. REMAINING BLOCKERS — 5, all human, all $0

1. Free **Google AI Studio** key + `ZA141251SA_CHAT_FREE_TIER=true` → real AI + agent chat **(highest value)**
2. Make the GHCR package **Public**
3. Free host + free **Neon** PostgreSQL → public HTTPS
4. Free **Stripe** keys, payouts **manual** → earning activation
5. Stripe identity/bank verification → **withdrawal only**

Secrets go through the host secret manager. Never into chat or Git.

---

## 6. OPERATIONAL RULES FOR THE NEXT SESSION

- **Never block a single tool call for minutes.** `gh run watch` ran 933 s in one
  call and is the most likely cause of the Arena stream failure. Poll with
  `gh run view <id> --json status,conclusion -q .` instead, in short calls.
- `npm run build` (Turbopack) OOM-kills in this sandbox regardless of tree
  state — **environmental, not a regression**. Use `npm run build:webpack`.
- Playwright CDN is egress-blocked; use `MISSION_BROWSER_NPM_RUNTIME=true`
  (bundled `@sparticuz/chromium`).
- Mission API uses **Bearer tokens**, not cookies. Mission routes are not
  prefixed `/api/mission/*`.
- Direct HTTPS to AI/payment providers is blocked here — provider connectivity
  is **UNVERIFIED**, never "failing".
- Run the suite via `scripts/test-resumable.mjs` (`npm test`), not one
  `node --test` process.
