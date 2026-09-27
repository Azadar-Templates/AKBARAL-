# AKBARAL! + ZA141251SA — A–Z Takeover Audit
**Date:** 2026-09-27 · **Branch:** `arena/01a0e339-akbaral` · **Commit:** `c7cbca8317ea55759e802dd956030d63445c0aef`

> Method: nothing in this report is taken from source comments or prior reports. Every
> claim marked WORKING was produced by booting the real application, migrating a real
> database, calling the real HTTP APIs and reading the real responses. Where the sandbox
> could not reach the outside world, the item is marked BLOCKED BY RUNTIME/NETWORK — not
> "working".

---

## 0. Environment reality check (this determines what could be tested at all)

Outbound egress from this sandbox is **allowlisted**, verified by direct TLS probes:

| Host | Result |
|---|---|
| registry.npmjs.org | 200 |
| api.github.com | 200 |
| api.openai.com | TLS reset (blocked) |
| api.anthropic.com | TLS reset (blocked) |
| generativelanguage.googleapis.com | TLS reset (blocked) |
| openrouter.ai | TLS reset (blocked) |
| api.stripe.com | TLS reset (blocked) |
| api.groq.com / duckduckgo.com / huggingface.co | TLS reset (blocked) |

**Consequence:** real AI calls, real search calls, real Stripe calls and real payout calls
**cannot be proven from here**, regardless of credentials. Those items are classified
BLOCKED BY RUNTIME/NETWORK and must be re-tested from the production host.

---

## PART 1 — AKBARAL!

### 1. Repository / branch / commit — **WORKING**
- 704 tracked files, 386 TS/TSX source files, 139 test files.
- Working tree clean at audit start and end.
- Architecture: Express API (`src/index.ts`, port 4000) + Next.js 16 shell (port 3000) that
  hosts a 4,527-line vanilla-JS SPA (`public/app.js`). Next `page.tsx` files are thin
  routable shells — **this is deliberate, not a stub**; all screens are real and API-driven.

### 2. Frontend / backend / database / migrations / APIs — **WORKING**
- **247 registered API routes** across 33 routers.
- 22 platform migrations (`db/migrations-pg/`) applied cleanly from scratch — verified.
- 33 mission migrations (`db/migrations-mission/`) applied cleanly — **123 tables** created.
- Dual-engine driver (`src/db/driver.ts`): SQLite for dev, PostgreSQL for production, with a
  single unit-tested dialect translation layer. Real and well-built.
- **Production build: PASS** (`npm run build` → tsc backend + Next build, exit 0, 28 routes emitted).

### 3. Auth / sessions / RBAC / owner separation — **WORKING**
Live-tested, real HTTP:
- register → 200, login → JWT access token issued, `/api/me` → 200 with trial + subscription.
- Unauthenticated `/api/agents` → 401. Customer hitting `/api/owner` → **403**. Customer hitting
  `/api/economy` → **403**. Customer hitting the mission plane → **404** (plane does not exist for them).
- `scripts/verify-owner-identity.mjs` on a clean DB with the API booted correctly:
  **17 passed / 1 failed** — the single failure is "owner workflow COMPLETES", caused only by the
  missing AI provider key. Owner promotion via `AKBARAL_OWNER_EMAIL`, one-way promotion, audit row,
  "exactly one owner account", and "seeded staff rows carry no password" all **PASS**.

### 4. MASTER architecture — **WORKING (to the provider boundary)**
Full chain executed live with `POST /api/master`:
Goal → Goal Analyzer → Planner → Orchestrator → Agent Router → Specialist → Tool stage →
Model Router → Verifier → Lifecycle → Credits.
- Real response returned a workflow id, a queued job, an intent analysis and a real step graph
  that routed to `research-researcher-002`.
- Goal analysis correctly **degraded honestly** to the deterministic rule engine and *said so*:
  `"Model analysis unavailable (AI providers are not configured…)"`.
- `verify-agent-fleet.mjs`: **MASTER routed to 18 distinct real registry agents across multiple
  categories, goal-dependent routing confirmed, every execution produced a result document, and
  each result disclosed its execution mode.** Only the model-backed completion failed.

### 5. Agents — **WORKING. Exact count: 4,001.**
- Generated from **80 real domain blueprints × 50 specialization archetypes + 1 flagship** =
  4,001. Verified by seeding: `agent registry -> 4001 definitions, 4001 versions inserted (db total 4001)`.
- Direct DB count after seed: **4,001 agents, all platform-owned (`owner_id IS NULL`)**.
- Each carries a distinct slug, name, category, specialization, system instructions, capabilities,
  inputs/outputs, model requirements, tool permissions, workflow, verification rules, security
  permissions, cost metadata, fallback strategy and eval config. **Not duplicates.**
- Agent #001 `web-research-001` exists, is platform-owned and published.
- **Executable: all 4,001 are routable and dispatchable today** (proved by live routing to 18 of
  them). **Zero can currently complete model-backed work** — no AI credential.

### 6. Agent Factory / lifecycle — **WORKING BUT NEEDS HUMAN CONFIG**
`src/orchestrator/agent-factory.ts` + `src/routes/factory.ts` present, versioning + checksum-gated
`insertAgentVersion` verified in the seed path. Custom agent creation works; produced agents cannot
*run* without a provider key. Note: `GET /api/factory` is 404 — factory routes are on sub-paths only.

### 7–11. Dashboards / workspace / marketplace / tasks
- **User dashboard: BROKEN.** See G1 below — `GET /api/dashboard` returns **HTTP 500**.
- **Owner dashboard: WORKING** (403-gated correctly for customers; owner read verified by
  verify-owner-identity 17/18).
- **MASTER workspace: WORKING** — `/master`, `/workspace` routable, refresh-safe, API-fed.
- **Agent World / Marketplace: WORKING** — `/api/marketplace` 200 with real agents; `/api/world`
  200 with an honest empty favourites set (**no fake data**).
- **Tasks lifecycle: WORKING** — task created, ran, failed honestly with the exact provider reason,
  terminal state recorded, result document produced (1,295 chars), specialist task linked.

### 12–13. Credits / trial / billing / refunds / double-spend — **WORKING (excellent)**
`scripts/verify-user-journey.mjs`: **20/20 PASS**, including:
- "a task that ends in failure does not consume the credit" — before=5, after=5.
- "a cancelled task refunds its reserved credit" — before=5, after=5.
- "credits follow the real workflow outcome, never the request".
Independently reconfirmed by me: after a failed MASTER run, `freeCreditsRemaining` was still 5/5.
Refunds are idempotent (`refundTaskCredit` refuses doubles) and crash-recovery refunds exist.
Plans (`free`/`pro`/`enterprise`) are real DB rows served by `/api/billing/plans`.

### 14. AI providers and exact models — **BLOCKED BY MISSING CREDENTIAL**
**4 providers, 12 models**, all confirmed live via `GET /api/models` (`configured: false` for all four):

| Provider | Env key | Models |
|---|---|---|
| OmniRoute Gateway (local 127.0.0.1:20128) | `OMNIROUTE_API_KEY` | `auto`, `qwen3-coder-plus`, `deepseek-v3`, `llama-4-scout`, `kimi-k2` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o`, `gpt-4o-mini`, `dall-e-3` |
| Anthropic | `ANTHROPIC_API_KEY` | `c3.5-sonnet` |
| Google AI | `GOOGLE_API_KEY` | `gemini-3.8-flash`, `gemini-3.5-flash`, `gemini-3.1-flash-lite` |

### 15–17. Tools / integrations / research / media — **PARTIALLY WORKING**
**18 registered tools**, confirmed live via `GET /api/tools`:
`web_search, page_fetch, code_repository_read, file_parse_text, knowledge_search, excel_build,
image_render, youtube_publish, instagram_publish, x_post, shopify_product, twilio_message,
stripe_payment, http_request, json_transform, text_analyze, csv_parse, maps_place`.
- Credential-free tools (`http_request`, `code_repository_read`, `json_transform`, `text_analyze`,
  `csv_parse`, `file_parse_text`, `excel_build`) report `implemented: true, credentialConfigured: true`
  → **WORKING**.
- Search providers implemented: Tavily / Brave / Serper / Google CSE + keyless fallback
  (`src/agents/search-providers.ts`) → **BLOCKED BY MISSING CREDENTIAL + NETWORK**.
- Publishing (YouTube/Instagram/TikTok/X), Shopify, Twilio, Stripe tool → **BLOCKED BY MISSING CREDENTIAL**.
- Image/video/audio: only `dall-e-3` + `image_render`. **There is no video or audio provider in the
  catalog at all** → NOT IMPLEMENTED (see H2).

### 18. Provider fallback — **WORKING (degradation path), UNVERIFIED (provider-to-provider)**
The fallback *to the honest-failure path* is proven: the router selected a model, found no
credential, and the executor failed closed with `provider_not_configured` **and refunded**.
Actual provider-A→provider-B failover cannot be proven with zero providers configured.

### 19–20. Credential config / egress — **WORKING BY DESIGN**
Every credential is read from `process.env` only. **No secret is ever read from the database** and
none is accepted over an API. `npm run scan:secrets` → **PASS** (22 allow-listed synthetic
placeholders, no real secret markers). `.env.example` documents every key. This satisfies the
"never request human secrets in chat" rule correctly.
Required egress in production: the 4 AI hosts, one search host, `api.stripe.com`, SMTP, and the
social Graph APIs.

### 21. Stripe / payments — **WORKING BUT NEEDS HUMAN CONFIG**
- `src/billing/stripe.ts` implements the real `Stripe-Signature` scheme: HMAC-SHA256 over
  `${t}.${rawBody}`, tolerance window replay protection, constant-time compare, multi-`v1` rotation
  support, `v0` ignored, raw body preserved. This is correct, not a stub.
- `src/billing/providers.ts` calls the real `https://api.stripe.com/v1/checkout/sessions` and the
  real Razorpay orders endpoint; both return honest `provider_not_configured` without keys.
- **Genuinely usable the moment `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `AKBARAL_SITE_URL` exist.**
  Stripe account creation is free; no upfront investment required.

### 22–23. Domain / HTTPS / hosting — **WORKING BUT NEEDS HUMAN CONFIG (+ one BROKEN item)**
- Six documented free hosting paths in `deploy/`: ClawCloud, Render, Zeabur, Caasify, SnapDeploy,
  Oracle free VM, plus Modal. All $0.
- `.github/workflows/docker-publish.yml` builds and pushes to GHCR on every push — **verified green
  in real CI** (run 36325509372, 1m21s, success). This is genuinely free on a public repo.
- `AKBARAL_SITE_URL` unset → robots/sitemap/checkout redirects fall back to a placeholder host.
- **`stackhost.yaml` is broken/stale — see G2.**

### 24. PostgreSQL / Neon — **WORKING BUT NEEDS HUMAN CONFIG**
Migrations, dialect translation, a PGlite-backed PG test harness (`npm run test:pg`) and parity
tests all exist and the SQLite path is proven end-to-end. A real Neon URL was not available here,
so **PostgreSQL in production is UNVERIFIED from this sandbox** (CI's PG steps were skipped because
the SQLite suite failed first — see G2).

### 25. Monitoring / health / logs — **WORKING**
- `GET /api/health` → `{"status":"ok","checks":[{"name":"database","ok":true}],"uptimeSeconds":22}`.
- `GET /api/ready` → real 503 until migrated, 200 after. Correct fail-closed readiness.
- `/api/metrics` gated to admin/super_admin. Structured JSON request logs confirmed in stdout.
- Nightly verified backup loop + `db:backup`/`db:restore`.

### 26. Mobile / responsive — **WORKING**
`npm run audit:responsive:selftest` planted 4 regressions (grid-guard, overflow, small-target,
tiny-text) and **detected 4/4** — the gate provably can fail, so it is a real gate.

### 27. Browser / E2E — **NOT IMPLEMENTED (as browser E2E)**
`@playwright/test` and `@sparticuz/chromium` are dependencies, but **there is no
`playwright.config.*` anywhere in the repo and no `.spec.ts` browser suite.** What exists instead is
a strong set of real HTTP journey scripts (`verify-user-journey`, `verify-owner-identity`,
`verify-agent-fleet`, `verify-refresh-deeplinks`) plus `scripts/mission-browser-check.ts` for the
mission dashboard only. Honest classification: **no AKBARAL! browser E2E**.

### 28. TypeScript / build / test / secret scan
| Check | Result |
|---|---|
| `npm run typecheck` | **PASS**, 0 errors |
| `npm run build` | **PASS** |
| `npm run scan:secrets` | **PASS** |
| Full test suite | **1,982 tests / 143 suites — 1,972 pass, 1 fail, 9 cancelled** |

The 9 "cancelled" are two suites (`agents/access`, `agents/registry`) that only fail when all 139
files share one process — they **pass** under the project's own runner. **There is exactly one
genuine test failure: `src/app/stackhost-deploy.test.ts` (see G2).**

### 29. Security / SSRF / credentials — **WORKING**
Executed `assertPublicHttpUrl` live against real attack inputs:

| Input | Result |
|---|---|
| `http://169.254.169.254/latest/meta-data/` | **BLOCKED** — private host (cloud metadata) |
| `http://127.0.0.1:4000/api/health` | **BLOCKED** — private host |
| `http://10.0.0.5/` | **BLOCKED** — private host |
| `file:///etc/passwd` | **BLOCKED** — only http/https |
| `https://example.com/ok` | ALLOW |

Plus: three-plane isolation tests, role-separation tests, attack-surface tests, mission cash-boundary
tests — all in the passing suite. Secret scan clean. RBAC verified live.

### 30. AKBARAL! launch readiness — **NOT READY.** 1 broken endpoint + 3 credential gaps. See Section I.

---

## PART 2 — ZA141251SA (private mission)

Booted for real: `mission:init` created the DB (123 tables), then `mission:serve` on :4141.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Private mission architecture | **WORKING** | Own DB, own schema, own 33 migrations, own server, own auth. |
| 2 | Owner-only identity lock | **WORKING** | `verify-mission-identity-lock.mjs` → **17 passed / 0 failed**. |
| 3 | Mission authentication | **WORKING** | Intruder login → `identity_restricted`, and the refusal **does not disclose the configured email**. Owner login → token + CSRF token + expiry. scrypt hashing, SHA-256 session storage, rotation. |
| 4 | Mission DB and ledger | **WORKING** | `ledger chain verified (0 rows)`, `audit chain verified`, explicit `seq` ordering for PG parity. |
| 5 | Mission safety gate | **WORKING** | 15 prohibitions compiled in and **not configuration-overridable** (fake identities, KYC/AML bypass, sanctions evasion, fraud, fake engagement, bought followers, unauthorized transfers, laundering, credential theft, spam, ToS violation, impersonation, …). |
| 6 | Agent authorization | **WORKING** | Agent-scoped access links; cross-agent conversation read → 403. |
| 7 | Mission Agent Fleet | **WORKING** | `GET /api/agents` → `{"total":4001}` synced into the mission plane. |
| 8 | Agent Chat | **WORKING (one-way only)** | Owner message persisted with seq, idempotency key, audit. |
| 9 | Per-agent conversation history | **WORKING** | Cursor-paginated per-agent history verified. |
| 10 | Real provider chat readiness | **BLOCKED BY MISSING CREDENTIAL** | `chat-config` → `{"config":null,"workerLivenessVerified":false,"providerActivated":false}`; history → `automaticReplies:false`. **Agents cannot reply.** |
| 11 | Real agent work execution | **BLOCKED BY MISSING CREDENTIAL** | Same provider gate as AKBARAL!. |
| 12 | Legitimate earning routes | **NOT IMPLEMENTED (wiring)** | See J1 — **zero `EarningProvider` implementations exist**. |
| 13 | Verified external payment detection | **WORKING BUT NEEDS HUMAN CONFIG** | `MissionStripe implements MoneyProvider` is real; needs `ZA141251SA_STRIPE_SECRET_KEY`. |
| 14 | Verified revenue ledger | **WORKING** | I attempted to inject $500 fake revenue: **refused** — `provider_verification_required: "legacy notes cannot fund or settle real payments"`. Treasury read **0 cents across 0 wallets**. No fake money anywhere. |
| 15 | Withdrawal methods | **BLOCKED BY MISSING CREDENTIAL** | 4 payout slots provisioned, 0 verified; payouts refuse until an owner-verified destination exists. |
| 16 | Card system | **BLOCKED BY PAYMENT** | Depends on a funded Stripe account. Correctly inert. |
| 17 | Treasury / mission funds | **WORKING** | Real wallets, real balances, all zero. Policy: depth≤3, children≤8, agents≤5000, $100/day cap, $25 approval threshold. |
| 18 | Separation from AKBARAL customer funds | **WORKING** | Overview states and enforces: *"not read, not written — AKBARAL! customer revenue is a different database and treasury"*. Separate DB file, separate sessions, separate ledger. Customer hitting the mission plane got **404**. |
| 19 | Owner dashboard | **WORKING** | Overview, treasury, agents, money, policy all returned real data. |
| 20 | Security / audit / recovery | **WORKING** | Hash-chained audit verified; kill switch present; identity-lock sweep recorded. |
| 21 | Mission production deployment | **WORKING BUT NEEDS HUMAN CONFIG** | Runs today; needs the 5 `ZA141251SA_*` env values on a host. |
| 22 | Actual earning readiness | **NOT IMPLEMENTED** | `/api/money` self-reports blocked: `live_connection_not_tested`, `earning_connector_not_configured`, `vendor_payment_connector_not_configured`, `real_opportunity_assignments_require_owner_review`. |

---

# WHAT IS ACTUALLY LEFT

## A. WORKING NOW
1. Repo, TypeScript (0 errors), production build, secret scan.
2. 1,972/1,982 tests passing.
3. 22 platform + 33 mission migrations applying cleanly from zero.
4. **4,001 agents** seeded, routable, goal-dependently dispatched to 18 distinct specialists live.
5. Full MASTER chain up to the model call, with honest degradation and disclosure.
6. Auth, sessions, JWT, RBAC, owner promotion (17/18), three-plane isolation (403/403/404).
7. **Credits, trial, refunds, cancellation refunds, double-spend protection — 20/20.**
8. SSRF defence — proven against cloud-metadata, loopback, RFC1918 and `file://`.
9. Health + readiness + structured logs + backups.
10. Responsive gate (self-test 4/4).
11. Marketplace, Agent World, owner dashboard, MASTER workspace, tasks.
12. ZA141251SA: identity lock **17/17**, mission auth, 4,001-agent fleet, chat persistence + history,
    hash-chained audit, ledger integrity, treasury, plane separation, **fake-revenue refusal**.
13. GHCR image publishing in CI — green, free, no card.

## B. HUMAN ACTION REQUIRED (unavoidable — a human must hold these accounts)
1. `GOOGLE_API_KEY` — Google AI Studio Gemini key. **FREE tier. Unblocks everything AI.**
2. `SESSION_SECRET` — `openssl rand -base64 48` in the host secret store. **FREE.**
3. `DATABASE_URL` — Neon free tier. **FREE.**
4. `AKBARAL_OWNER_EMAIL` — owner identity. **FREE.**
5. `AKBARAL_SITE_URL` + domain/TLS — free subdomain from the host. **FREE.**
6. `TAVILY_API_KEY` (or Brave/Serper) — free tier. **FREE.**
7. Stripe account + `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. **FREE to open.**
8. `ZA141251SA_*` (5 values) + `npm run mission:init` + verify one payout slot. **FREE.**
9. SMTP for password reset (optional; honest 503 until then). **FREE tier available.**

**None of these may be pasted into chat — all go into the host's secret store.**

## C. FREE FIXES AVAILABLE (code-only, $0, I can do these)
1. **G1** — add the missing `tasks.agent_category` + `tasks.credits_consumed` columns (one migration)
   or rewrite the 4 queries in `src/routes/user-dashboard.ts`. Plus a regression test for
   `GET /api/dashboard` (there is currently none).
2. **G2** — reconcile `stackhost.yaml` with `src/app/stackhost-deploy.test.ts` (registry + stale SHA).
3. **G3** — compute `moneyOverview().readiness` from real configuration instead of the hardcoded
   all-false literal at `src/mission/money.ts:394`.
4. **G4** — update the stale `scripts/verify-mission-money.mjs` to the `/api/money` surface.
5. **H1** — add a `playwright.config.ts` + a real browser E2E suite (deps already installed).
6. **J1** — implement the first `EarningProvider` (the mission's whole earning path is otherwise inert).
7. Make `GET /api/factory` return the factory index instead of 404.

## D. BLOCKED BY NETWORK/HOST
1. Real Gemini/OpenAI/Anthropic/OmniRoute request — all four hosts TLS-blocked here.
2. Real search provider request — all search hosts blocked.
3. Real Stripe API call — `api.stripe.com` blocked.
4. Real payout/withdrawal call — blocked.
5. PostgreSQL/Neon production verification — no reachable PG instance.
**All five must be re-run from the production host. None is a code defect.**

## E. BLOCKED BY CREDENTIALS
1. Every model-backed agent execution (all 4,001) — no AI key.
2. MASTER task completion — `verify-agent-fleet` completed 0/8 goals, steps 0/28, for this reason alone.
3. Web research with a real provider.
4. ZA141251SA agent chat replies — `providerActivated:false`, `automaticReplies:false`.
5. Mission verified-payment detection — no `ZA141251SA_STRIPE_SECRET_KEY`.
6. Publishing tools (YouTube/Instagram/TikTok/X), Shopify, Twilio.
7. Email (password reset / verification) — honest 503.

## F. BLOCKED BY PAYMENT
1. **Mission card issuing** — requires a funded Stripe balance. Correctly inert; fund only from
   verified mission revenue later.
2. Paid search tiers and paid model tiers — **not needed**; free tiers cover launch.
3. Paid hosting — **not needed**; six free paths are documented in `deploy/`.
**Nothing on the launch path requires a card.**

## G. BROKEN / NEEDS CODE FIX
**G1 — `GET /api/dashboard` returns HTTP 500. (CRITICAL — the user dashboard is dead.)**
- Reason: `SELECT id, title, status, agent_category, …, credits_consumed FROM tasks` references two
  columns that **exist in no migration**. Live response: `{"error":{"code":"internal_error","message":"no such column: agent_category"}}`.
- File: `src/routes/user-dashboard.ts` lines 40, 130, 250, 291.
- Verified schema of `tasks`: `id, title, description, status, priority, type, input_data,
  output_data, error_message, started_at, completed_at, user_id, project_id, agent_id, created_at, updated_at`.
- Why it was missed: **no test covers this route.** 1,972 passing tests did not catch it.
- Fix: FREE, code-only, no human action.

**G2 — `stackhost.yaml` contradicts its own contract test. (The single real test failure.)**
- `stackhost.yaml` pins `mrzain555/akbaral:c8bcf07d…` (Docker Hub) but
  `src/app/stackhost-deploy.test.ts:120` asserts `ghcr.io/azadar-templates/akbaral:…`.
- Two further real problems: the CI publishes to `ghcr.io/azadar-templates/akbaral-` (**trailing dash**,
  which the regex would reject anyway), and the mirror workflow's `DEST_SHA` is `2917b939…` — a
  **different, stale SHA** from the one in `stackhost.yaml`. The Docker Hub mirror also depends on
  `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` secrets.
- Impact: this failure **aborts the CI suite before the PostgreSQL, mission-PG, browser and webpack-build
  jobs ever run** (confirmed: run 36325509380, those 7 steps show `-` = skipped). So one stale string is
  costing you all PostgreSQL production verification.
- Fix: FREE, code-only.

**G3 — mission money readiness is hardcoded.** `src/mission/money.ts:394` returns
`readiness:{liveConnectionTested:false, earningConnectorConfigured:false, …}` as a **literal**. It will
report "blocked" forever even after the owner configures everything. Display-only (the real gate is at
line 502), so it is not a safety hole — but it makes the owner dashboard permanently misleading. FREE fix.

**G4 — `scripts/verify-mission-money.mjs` is stale.** It drives legacy `/api/wallets/fund`,
`/api/expenses`, `/api/revenue`, which were deliberately hardened to `409 provider_verification_required`.
Result: 20+ false failures. The *system* is correct; the *script* is out of date. FREE fix.

**G5 — `GET /api/factory` → 404.** Minor; sub-routes work. FREE fix.

## H. NOT IMPLEMENTED
**H1 — AKBARAL! browser/E2E tests.** No `playwright.config.*`, no browser specs, despite
`@playwright/test` + `@sparticuz/chromium` being installed. Only the mission dashboard has a Chromium
check. FREE to add.

**H2 — Video and audio generation.** The model catalog has **4 providers / 12 models with no video and
no audio/speech provider at all**; only `dall-e-3` (image) exists. The `ProviderSpec` type declares
`'video' | 'audio' | 'speech'` but nothing implements them. Agents whose domain implies video/audio
cannot produce it.

**H3 — Mission earning connectors.** See J1. Extensive workflow *scaffolding* exists for Awin, Upwork,
Fiverr, Contra, Toptal and Freelancer (contracts, DB tables, migrations 0018–0031) — but **none is
registered as an `EarningProvider`**, so none can ever run.

## I. AKBARAL! LAUNCH BLOCKERS (4)
1. **G1** — `/api/dashboard` 500. *Code fix, FREE, no human needed.*
2. **No AI provider credential** — all 4,001 agents can route but none can complete. *Human, FREE.*
3. **No production database + `SESSION_SECRET`** — sessions die on redeploy, data lost on rebuild. *Human, FREE.*
4. **No public URL / TLS** — no `AKBARAL_SITE_URL`; checkout redirects and robots/sitemap point at a
   placeholder. *Human, FREE.*

(Non-blocking for launch: search key, Stripe, SMTP — each degrades honestly.)

## J. ZA141251SA REAL-EARNING BLOCKERS (4)
1. **J1 — No `EarningProvider` implementation exists anywhere in the codebase.**
   `grep -rn "implements EarningProvider" src` → **zero results**. And
   `scripts/mission-money-worker.ts:17` calls `moneyWorkerTick(actor, [provider], [])` — the earning
   array is **literally empty**. Every queued earning job therefore falls through to
   `blocked='earning_connector_not_configured'`. **The mission cannot earn one cent today, with or
   without credentials.** *Code fix, FREE, but substantial.*
2. **No AI credential** — agents cannot even do the work they'd be paid for; chat is one-way.
3. **No `ZA141251SA_STRIPE_SECRET_KEY`** — no verified inbound payment can be detected, and the ledger
   (correctly) refuses everything else.
4. **No verified payout destination** — 4 slots provisioned, 0 verified; withdrawal refuses.

## K. EXACT NEXT STEPS IN ORDER
**Phase 1 — free code fixes, no human, no money (me):**
1. Fix **G1**: add the migration for `tasks.agent_category` + `tasks.credits_consumed` (or fix the
   queries), and add the missing `GET /api/dashboard` regression test.
2. Fix **G2**: align `stackhost.yaml` and its test on one registry + one current SHA. This re-enables
   the PostgreSQL / mission-PG / browser / webpack CI jobs.
3. Re-run typecheck + full suite → target **1,982/1,982**.
4. Fix **G3** (computed readiness), **G4** (stale script), **G5** (factory index).

**Phase 2 — human, $0, ~30 minutes:**
5. Create a **Google AI Studio** Gemini key (free tier) → set `GOOGLE_API_KEY` in the host secret store.
6. `openssl rand -base64 48` → `SESSION_SECRET`. Set `AKBARAL_OWNER_EMAIL`.
7. Create a **Neon free** database → `DATABASE_URL`; run `npm run db:migrate && npm run db:seed`.
8. Deploy the GHCR image to one free host (`deploy/free-clawcloud` or `deploy/free-render`); take the
   free subdomain → `AKBARAL_SITE_URL`. Confirm `/api/health` and `/api/ready` are 200 over HTTPS.

**Phase 3 — prove reality on the real host (not from this sandbox):**
9. Run one real MASTER task → expect `completed`, not `provider_not_configured`.
10. Re-run `verify-agent-fleet.mjs` → expect **8/8 goals, 28/28 steps**.
11. Re-run `launch:check` → expect readiness well above the current 11.1%.

**Phase 4 — revenue (still $0 upfront):**
12. Free **Tavily** key → real web research.
13. Open **Stripe** (free), set key + webhook secret → AKBARAL! can take its first real payment.

**Phase 5 — mission earning:**
14. Set the 5 `ZA141251SA_*` values, run `mission:init`, verify one payout slot.
15. **Implement the first real `EarningProvider`** and register it in `mission-money-worker.ts`.
    Start with exactly one legitimate channel end-to-end (recommended: direct client work settled by
    Stripe invoice — it reuses the already-working `MissionStripe` MoneyProvider and needs no
    third-party marketplace API approval).
16. Only after verified revenue lands in the mission ledger: consider card issuing.

## L. FINAL LAUNCH READINESS
**AKBARAL! — NOT PRODUCTION READY.**
Evidence-based: the build compiles, 1,972 tests pass, 4,001 agents seed and route, auth/RBAC/credits/
SSRF are proven by live execution. But the **user dashboard returns HTTP 500 right now**, and **not one
agent has ever completed a model-backed task** — I have no evidence of a single successful AI response,
because no provider was reachable or configured. Verdict: **strong, honest, well-engineered platform,
one code fix and four config values away from a credible launch — but not ready today.**

**ZA141251SA — NOT EARNING-READY, and further away than AKBARAL!.**
Evidence-based: identity lock 17/17, fake revenue actively refused, ledger and audit chains verified,
funds correctly isolated, 4,001 agents present. The *safety* architecture is genuinely excellent. But
the mission has **no earning connector implementation at all** — the money worker is called with an
empty earning-provider array. Verdict: **safe, honest, and currently incapable of earning anything.**

> I will not call either system production-ready. The safety and integrity layers have real evidence
> behind them. The revenue and AI-execution layers have none.

---

# THE 8 ANSWERS

**1. Exact current commit** — `c7cbca8317ea55759e802dd956030d63445c0aef` on `arena/01a0e339-akbaral`
(branched from `main`; merge of PR #10).

**2. Exact test count / pass / fail** — **1,982 tests, 143 suites: 1,972 pass, 1 fail, 9 cancelled.**
The 1 genuine failure is `src/app/stackhost-deploy.test.ts`. The 9 cancelled belong to 2 suites that
only collide under a single shared process and pass under the project's own runner.
Typecheck 0 errors · production build PASS · secret scan PASS.

**3. Exact agent count** — **4,001.** (80 domains × 50 specializations + flagship `web-research-001`.)
Confirmed three ways: generator count, seed output (`4001 definitions, 4001 versions`), and a direct DB
count (`4001`, all `owner_id IS NULL`). Mission plane reports the same `{"total":4001}`.

**4. Exact provider / tool readiness** —
- **AI: 4 providers / 12 models. 0 of 4 configured. 0 of 12 usable.**
- **Tools: 18 registered. 7 credential-free and working. 11 blocked on credentials.**
- **Search: 4 providers + keyless fallback. 0 configured.**
- **Payments: Stripe + Razorpay implemented correctly. 0 configured.**
- **Image: 1 model (`dall-e-3`), unconfigured. Video: 0. Audio/speech: 0.**
- **Mission earning connectors: 0 implemented.**

**5. Exact number of remaining blockers** — **8.**
4 AKBARAL! launch blockers + 4 ZA141251SA earning blockers. (Plus 5 non-blocking defects: G3, G4, G5,
H1, H2.)

**6. THE single most important blocker preventing AKBARAL! from going live** —
> **No AI provider credential.** All 4,001 agents route correctly, plan correctly, and then fail
> closed with `provider_not_configured` — 0 of 8 MASTER goals completed, 0 of 28 workflow steps
> executed. A platform where no agent can complete a task is not a platform.
> **Fix: one free Google AI Studio Gemini key set as `GOOGLE_API_KEY` in the host secret store.**
> (G1, the dashboard 500, is the most urgent *code* blocker — but I can fix that myself for free; the
> credential is the one thing I cannot.)

**7. THE single most important blocker preventing ZA141251SA agents from doing real external work/earning** —
> **No `EarningProvider` implementation exists.** `grep -rn "implements EarningProvider" src` returns
> zero results, and `scripts/mission-money-worker.ts:17` passes an **empty array** as the earning
> providers. Every earning job dies at `earning_connector_not_configured`. This is not a credential
> problem — **no credential on earth would make it earn**, because there is nothing to execute.
> **Fix: implement and register one real earning connector.** Free to build, no card required.

**8. Shortest path to both operational at $0 upfront** —
> **Day 1 (me, free, no human):** fix G1 (dashboard 500) and G2 (stackhost/CI), which also unblocks all
> the skipped PostgreSQL CI verification. Re-run the suite to 1,982/1,982.
> **Day 1 (you, free, ~30 min):** Google AI Studio Gemini key, `openssl rand -base64 48` session secret,
> Neon free Postgres, owner email — all into the host secret store, never into chat. Deploy the
> already-green GHCR image to ClawCloud/Render free tier, take the free HTTPS subdomain.
> **Day 1 verification:** one real MASTER task completing, and `verify-agent-fleet` at 8/8. **AKBARAL! is
> then live and genuinely functional at $0.**
> **Day 2 (free):** Tavily free key (real research) + Stripe account (free to open) → AKBARAL! can take
> real customer money. **This is your first legitimate revenue and it funds everything else.**
> **Day 3+ (me, free):** build ONE real `EarningProvider` — direct client work invoiced through the
> already-working `MissionStripe` provider, since it needs no marketplace API approval and no upfront
> fee. Set the `ZA141251SA_*` values, verify one payout slot.
> **Only then**, funded strictly by verified mission revenue, consider card issuing.
> **Total upfront personal investment: $0. Every step above uses a free tier or existing free CI.**
