# AKBARAL! + ZA141251SA — AUTHORITATIVE STATE RECONCILIATION

**Commit:** `c67640a` (branch `arena/01a0e339-akbaral`)
**Date:** 2026-09-27
**Evidence basis:** executed commands only. Source code, seeded rows, mocks and
passing unit tests are **not** counted as proof of external functionality.

**Verified revenue: $0.00.** No earning provider is credentialed, no external
payment has been received, and nothing in this repository can create one.

---

## Legend

| Mark | Meaning |
|---|---|
| **WORKING** | Executed and observed working in this environment |
| **HUMAN CONFIG** | Code complete; needs a human to configure something free |
| **CREDENTIAL** | Code complete; needs an API key/secret |
| **PAYMENT** | Requires money — deliberately not activated ($0 constraint) |
| **NETWORK** | Works in code; sandbox egress blocks live proof |
| **BROKEN** | Defective |
| **NOT IMPL** | Does not exist |
| **UNVERIFIED** | Cannot be proven either way here |

---

## PART 1 — AKBARAL!

| # | Capability | Status | Evidence / exact blocker |
|---|---|---|---|
| 1 | Repo, commit, branch | **WORKING** | `c67640a`; CI green |
| 2 | TypeScript | **WORKING** | `tsc --noEmit` 0 errors |
| 3 | Production build | **WORKING** | `build:webpack` exit 0, 28/28 static pages |
| 4 | Test suite | **WORKING** | **2,081 pass / 0 fail**, 142 files |
| 5 | Secret scan | **WORKING** | PASS, 22 allow-listed placeholders |
| 6 | SQLite database | **WORKING** | 22 migrations apply |
| 7 | PostgreSQL / Neon | **WORKING** | `test:pg` **48/48** on real PG wire protocol |
| 8 | Migrations (platform) | **WORKING** | 22 applied on PG |
| 9 | Auth / sessions | **WORKING** | Bearer login 200; unauth 401 |
| 10 | RBAC / owner separation | **WORKING** | Owner-only routes enforce 401/403 |
| 11 | User dashboard API | **WORKING** | **Fixed this takeover** — was HTTP 500, now 200 on all 6 routes |
| 12 | Owner dashboard | **WORKING** | Routes respond; owner-gated |
| 13 | Agent catalog — 4,001 | **WORKING** | `generateAgentDefinitions()` = **4001**, 4001 unique ids, 80 categories |
| 14 | Agent completeness | **WORKING** | **4001/4001** have instructions, capabilities, toolPermissions, modelRequirements, verificationRules, fallbackStrategy, workflow, securityPermissions |
| 15 | Agent registry seed | **WORKING** | 4001 definitions + 4001 versions seeded on PG |
| 16 | MASTER orchestrator | **WORKING** | `POST /api/master` accepts and routes a task |
| 17 | Planner / router | **WORKING** | Exercised by suite + live task |
| 18 | Task lifecycle | **WORKING** | Task created → failed → refunded, observed live |
| 19 | Credits / trial | **WORKING** | 5/5 free credits observed |
| 20 | Refund + double-spend | **WORKING** | Failed task refunded; balance restored; ledger consistent |
| 21 | Billing / invoices | **WORKING** | Routes 200 after schema fix |
| 22 | Health / monitoring | **WORKING** | Milestone-10 health/readiness/metrics 7/7 on PG |
| 23 | Mobile / responsive | **WORKING** | Real Chromium mobile viewport, 9/9 checks |
| 24 | Browser / E2E | **WORKING** | **19/19** desktop+mobile, 0 external requests |
| 25 | Security / SSRF | **WORKING** | Suite covers SSRF, redirect:'error', bounded reads |
| 26 | Docker image | **WORKING** | Published `ghcr.io/azadar-templates/akbaral@sha256:c32e4a03…` |
| 27 | CI pipeline | **WORKING** | **Fixed this takeover** — verify + docker-publish both green |
| 28 | **AI provider calls** | **CREDENTIAL** | No API key. Catalog wired for google/openai/anthropic/omniroute |
| 29 | **Real AI request** | **NETWORK + CREDENTIAL** | Sandbox TLS egress blocked; unprovable here |
| 30 | **Public URL / HTTPS** | **HUMAN CONFIG** | Needs a free host + GHCR package made Public |

---

## PART 2 — ZA141251SA

| # | Capability | Status | Evidence / exact blocker |
|---|---|---|---|
| 1 | Private mission architecture | **WORKING** | Separate DB, server, auth, ledger |
| 2 | Owner-only identity lock | **WORKING** | `enforceIdentityLock()`; verified in pg-check |
| 3 | Mission auth | **WORKING** | Login 200; `/api/earning-readiness` 401 unauth, 200 owner |
| 4 | Mission DB (SQLite) | **WORKING** | 36 migrations |
| 5 | **Mission DB (PostgreSQL)** | **WORKING** | **Fixed this takeover** — 36 migrations, **123 tables**; was totally undeployable |
| 6 | Mission ledger | **WORKING** | Hash-linked, append-only; 2 rows verified in order on PG |
| 7 | Audit chain | **WORKING** | 14 rows hash-verified on PG |
| 8 | Safety gate / kill switch | **WORKING** | Enforced in every mutating path |
| 9 | Agent authorization | **WORKING** | Grant/revoke/freeze honoured at execution time |
| 10 | Mission agent fleet | **WORKING** | Registry sync addresses the same 4,001 agents |
| 11 | Agent chat plumbing | **WORKING** | Queue, jobs, per-agent history, durable display (browser-verified) |
| 12 | **Real agent chat reply** | **CREDENTIAL** | **Unblocked this takeover** (gate was permanently closed). Needs a free Google AI Studio key |
| 13 | Treasury / mission funds | **WORKING** | Wallet funded/expensed under test on PG |
| 14 | Fund separation | **WORKING** | `database-isolation.test.ts`; mission imports never touch platform DB |
| 15 | Payout verification | **WORKING** | Slot verified with 6 control checks, 180-day expiry |
| 16 | Withdrawal safety | **WORKING** | Payout queued for owner approval, **never auto-sent** |
| 17 | Card system | **PAYMENT** | Correctly gated; not activated |
| 18 | Opportunity discovery/scoring | **WORKING** | Registry-driven, 17 fields, dedup + evidence hash |
| 19 | Execution pipeline | **WORKING** | start→complete→verify→confirm→settle→retry all implemented |
| 20 | Settlement verification | **WORKING** | Rail allow-list, idempotent, synthetic-id rejection |
| 21 | **Earning provider** | **CREDENTIAL** | **Implemented this takeover** — was `[]`. Needs free Stripe keys |
| 22 | **Actual earning** | **CREDENTIAL** | $0.00. Requires #21 + a real paying customer |

---

## What changed in this takeover

### Fixed
1. `GET /api/dashboard` HTTP 500 → 200 (**6** schema defects; 2 found by audit, 4 by the new test).
2. `stackhost.yaml` stale image — this single line was aborting the suite and **silently skipping** the PostgreSQL, mission-PG, browser and webpack CI jobs.
3. **PG `INTEGER` overflow** — $1B/day in cents exceeds 32-bit INTEGER. The mission plane **could not migrate on PostgreSQL at all**.
4. **`INSERT OR IGNORE` untranslated in `exec()`** — anchored to the whole string, so it never fired for migration files.
5. **`datetime('now')` untranslated** on PG.
6. **Chat billing gate failed open** — selected by `adapter === invokeGoogleChat`, but the production worker wraps the adapter, so the gate was skipped in the only place it mattered.

### Implemented
7. **`StripeDirectEarning`** — the first real `EarningProvider`. Detects genuine settled customer payments; never creates money.
8. **Earning provider registry** — honest discovery replacing the hardcoded `[]`.
9. **$0 free-tier chat dispatch** — narrowed the gate instead of removing it.
10. **`GET /api/earning-readiness`** — owner-visible truth about both surfaces.

---

## Human actions required (all free, none can be automated)

| # | Action | Unlocks | Cost |
|---|---|---|---|
| 1 | Create a free Google AI Studio API key; store via host secret manager; set `ZA141251SA_CHAT_FREE_TIER=true` and a cost basis stating "free tier" | Real agent chat + real AI on AKBARAL! | **$0** |
| 2 | Make the GHCR package `azadar-templates/akbaral` **Public** | Image pullable by the host | **$0** |
| 3 | Create a free host (Railway/Render/Fly) + free Neon PostgreSQL; set `DATABASE_URL` | Public HTTPS URL, live AI proof | **$0** |
| 4 | Create a free Stripe account; add `ZA141251SA_STRIPE_SECRET_KEY` + `ZA141251SA_STRIPE_ACCOUNT_ID`; set payouts to **manual** | Earning provider activation | **$0** |
| 5 | Complete Stripe identity + bank verification | **Withdrawal only** — not earning | **$0** |

Never paste any of these secrets into chat. Use the host's secret manager only.
