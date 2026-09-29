# MASTER MERGE PLAN — AKBARAL! + ZA141251SA unified workspace

**Companion to `artifacts/MASTER_PROJECT_STATE.md`. Read that first.**

This document describes how the two products can be understood and operated as **one coherent
project/workspace** while keeping every required separation intact. **No implementation changes were
made as part of producing this document.** It is a plan for your approval.

---

## 1. What "unified workspace" means here (and what it explicitly does not)

**Means:**
- One repository, one CI pipeline, one set of shared engineering conventions (test runner, migration
  tooling, TypeScript config, secret-scanning) that both AKBARAL! and ZA141251SA already use.
- One person (you, the owner) can reason about the whole system from a single `MASTER_PROJECT_STATE.md`
  instead of reconstructing it from 70+ scattered historical report files.
- Shared, genuinely stateless infrastructure code (password hashing, JWT primitives, SSRF guard, retry
  backoff, hash-chain utilities) may be reused by both planes **as library code with no shared state**.

**Does not mean, and this plan does not propose:**
- Merging the customer database and the mission database.
- Merging customer auth/session tokens with mission owner auth/session tokens.
- Making any ZA141251SA route, data, or UI element reachable without owner authentication.
- Deploying or initializing the mission.
- Sharing a Stripe account, a payout destination, or a credit ledger between the two planes.

The codebase already enforces this at the test level (`three-plane-isolation.test.ts`,
`mission-cash-boundary.test.ts`, `role-separation.test.ts`) — this plan preserves that architecture, it
does not relax it.

---

## 2. What is currently shared, and whether that sharing is safe

| Shared thing | Where | Safe to keep shared? |
|---|---|---|
| Node/TypeScript toolchain, `tsconfig*.json`, test runner (`scripts/test-resumable.mjs`) | repo root | Yes — build tooling only, no data |
| `src/security/password.ts`, `jwt.ts`, `ssrf.ts` | `src/security/` | Yes — pure functions, no shared state, each plane calls them with its own secrets/keys |
| Hash-chain primitive (`sha256`, chain verification pattern) | duplicated conceptually between platform audit logs and `src/mission/database.ts` | Yes to share the *algorithm*; **no** to share the *table or chain instance* — each plane's chain must stay independently verifiable |
| `src/orchestrator/recovery.ts` | used by both the customer task queue and referenced by mission docs | **Verify before assuming shared** — confirm at implementation time that mission recovery does not share an in-memory registry with customer recovery. Currently they appear to operate on different DB connections, which is the right shape; flagged as a P1 verification item, not a known bug. |
| Docker image / container | one image, one `Dockerfile` | Yes — the image contains both codebases, but only one process (`start-prod.mjs`) runs at boot, and it never starts the mission server. Running the mission requires a **separate, explicit** process (`npm run mission:serve`) with its own env vars. This is the correct shape: one artifact, two independently-activatable services. |
| CI (`verify.yml`) | tests both planes in the same workflow run | Fine — it is read-only verification, not a runtime merge. It even provisions **separate PostgreSQL databases per mission test suite** (12 distinct DB names in `verify.yml`) precisely to keep test-time isolation honest. |
| GHCR image repository | one repository, one set of tags | Fine, as long as no mission secret is ever baked into the image layers (confirmed: `scan:secrets` runs in CI on every push and passes) |

**Nothing found in this session merges money, auth, or the two databases.** The separation is real, not
aspirational.

---

## 3. Structural recommendation: keep the repo, formalize the boundary in docs + CI, do not restructure

Given the depth of existing isolation tests, **do not** propose splitting into two repositories — that
would cost far more (duplicated CI, duplicated dependency upgrades, lost shared security-primitive
review) than it would buy, and the isolation is already enforced at the test level, not just by
directory convention. Instead:

1. **Adopt `artifacts/MASTER_PROJECT_STATE.md` as the living source of truth**, superseding the practice
   of writing a new dated root-level `.md` report per session (there are ~35 of these at repo root
   today). Recommend: after your approval, move the historical ones into `docs/history/` (pure file
   move, no content change) so the repo root is navigable, and update this one file going forward.
2. **Formalize the three-plane boundary as a named CI gate**, not just a test file: `verify.yml` already
   runs `three-plane-isolation.test.ts` and `mission-cash-boundary.test.ts` inside the general suite;
   recommend pulling them into a clearly-named CI step (e.g. "Plane isolation gate — must pass before
   any merge") so a regression here is visually distinct from a generic test failure in the Actions UI.
3. **Never let `production-targets.json` or any CI workflow acquire a mission URL** until you explicitly
   decide to deploy the mission. Nothing in the current repo does this today — keep it that way.

---

## 4. Merge-gap remediation (the orphan branch from §2 of the state doc)

This is the most concrete, low-risk action available, and it is **not a mission action** — it only
affects the public AKBARAL! side (build-identity reporting, Railway CI target, research freshness,
Gemini hardening). Recommended sequence, **for your approval, not yet executed:**

1. Open a pull request from `arena/01a0e6a0-akbaral` into `main` (it is a strict fast-forward of 8
   commits with no conflicts detected against current `main`, since `main` is its own merge base).
2. Let `verify` and `docker-publish` run on that PR (they have already run and passed on that branch
   directly in the past, per §11 of the state doc, but should be re-verified on the PR itself).
3. Do **not** touch `production-targets.json` further — the Railway URL addition in that branch is
   exactly what should land.
4. Close PRs #8, #9, and #13 as superseded/stale (see §2.2 of the state doc for the exact evidence per
   PR) — these are pure GitHub housekeeping with zero code risk, but are still a decision for you.

This alone would close P0-1/P0-2/P0-3 from the previous session's list without writing a single new
line of code — it only requires merging work that already exists and already passed CI.

---

## 5. Duplicated infrastructure inventory (safe-to-share vs. must-stay-separate)

| Item | Customer (AKBARAL!) | Mission (ZA141251SA) | Recommendation |
|---|---|---|---|
| Auth token format | Rotating bearer + refresh, cookie-assisted | Rotating bearer only, no cookies | Keep separate implementations; both use `src/security/jwt.ts` primitives safely (stateless) |
| Database | SQLite (dev) / native PostgreSQL (prod), `db/migrations*/` | SQLite (dev) / native PostgreSQL (prod), `db/migrations-mission/` | Keep fully separate connections/migrations — already the case |
| Payment provider | AKBARAL Stripe account (customer billing) | A **separate, dedicated** mission Stripe account (per `docs/MISSION_VERIFIED_CASH.md`) | Never let these share an account or webhook secret. Confirm at activation time (owner action) that two distinct Stripe accounts exist. |
| Credential vault | None needed (OAuth app secrets only, env-level) | AES-256-GCM encrypted vault (`ZA141251SA_CREDENTIAL_KEY`) | Mission-only; do not generalize this into a shared "platform vault" without re-deriving the isolation tests |
| Retry/backoff logic | `src/models/retry.ts` | Same module, called independently for mission provider calls | Safe to share as a pure function |
| Recovery/queue | `src/orchestrator/queue.ts`, `recovery.ts` | Mission uses its own scheduler (`earning/continuous-scheduler.ts`), not the customer queue | Already separate; do not consolidate |

---

## 6. MASTER ROADMAP

Every item below cites the exact file/module, current state, the change required, dependencies, how to
verify it, and whether it needs an action only you (the owner) can take. Nothing here is invented to
pad the list — items are limited to gaps actually found this session.

### P0 — blockers preventing trustworthy production operation

**P0-0 was found in the second audit pass and is the most urgent item in this table** — it is the only P0
item that is a genuine code-level security defect (the others are configuration/ops decisions). Full detail
in `artifacts/MASTER_BLOCKERS.md` §B-1.

| # | Item | File/module | Current state | Required change | Depends on | Verification | Owner action needed? |
|---|---|---|---|---|---|---|---|
| P0-0 | `/api/boss/*` auth fails open, mounted on the public app | `src/app.ts` (mount), `src/routes/boss-dashboard.ts` (`requireMissionAuth`) | Reproduced locally (disposable sandbox): unauthenticated `GET /api/boss/overview` → HTTP 500, silently creates `mission.db` on disk; no HTTP-level auth test exists anywhere | Replace `requireMissionAuth` with the standard `requireAuth + requireRole('owner','super_admin')` idiom already used by `admin.ts`/`owner*.ts`/`economy.ts` (or make it fail **closed**, not open, when no token is configured); add an HTTP-level auth test for all 7 routes in the file | None (isolated, small change) | New test: unauthenticated request to each `/api/boss/*` route returns 401/403, never reaches the DB layer | **Yes — also confirm on the Railway dashboard whether `ZA141251SA_DASHBOARD_TOKEN`/`MISSION_DASHBOARD_TOKEN` is currently set; if unset, treat as an active incident** |
| P0-1 | Merge the orphaned branch | `arena/01a0e6a0-akbaral` → `main` | 8 commits ahead, unmerged, no PR | Open + merge a PR (see §4) | None | `verify` + `docker-publish` green on the PR; `production-e2e` should then find a build-identity endpoint | No (engineering-only), but you should approve the merge |
| P0-2 | Confirm/align the live Railway deployment env vars (search credential, Stripe webhook secret, `AKBARAL_SITE_URL`) | Railway service settings (outside this repo) | Search credential and Stripe webhook secret confirmed **absent on the live host** by `production-e2e`'s own failure message | Set `TAVILY_API_KEY` (or another supported search key), `STRIPE_WEBHOOK_SECRET`, `AKBARAL_SITE_URL` on the Railway service, then redeploy the image from P0-1 | P0-1 (so the redeploy also carries build-identity reporting) | Re-run `production-verify` against the Railway target; `production-e2e` should stop reporting "search tool could not run" and "build commit MISSING" | **Yes — this can only be done by the account owner in the Railway dashboard/GitHub secrets** |
| P0-3 | Resolve the Gemini model-id discrepancy (`gemini-3.8-flash` per `CHECKPOINT.md` vs. `gemini-3.5-flash` per the latest live CI log) | `src/models/catalog.ts` and/or mission chat config | Two dated sources disagree on the currently pinned model id | Grep the exact pinned id on `main` today and reconcile the two docs; confirm against Google's live model-list endpoint (already exercised by `real-gemini-direct`) | None | `real-gemini-direct` CI job passing with the reconciled id; contract test asserting the id is on Google's active list | No |
| P0-4 | Decide on stale open PRs #8, #9, #13 | GitHub PRs | Open, superseded per evidence in §2.2 of the state doc | Close (or explicitly re-justify keeping open) | None | N/A — GitHub housekeeping | **Yes — only a repo maintainer/owner can close a PR** |

### P1 — core production completion

| # | Item | File/module | Current state | Required change | Depends on | Verification | Owner action needed? |
|---|---|---|---|---|---|---|---|
| P1-1 | Stop shipping mission/owner console markup to unauthenticated visitors | `src/app/page.tsx` | Full `hidden`-attribute sections for the owner console render in the SSR HTML for every visitor (no data, but the feature surface is visible in page source) | Move owner/mission-only sections to a separate bundle/route fetched only after role confirmation, or server-render them out entirely for non-owner sessions | None | A logged-out `fetch` of `/` should not contain owner/mission section labels at all | No |
| P1-2 | Confirm Railway's exact deployed commit going forward | `src/server/health.ts` (post P0-1 merge) | Will exist once P0-1 lands | Wire the CI redeploy step to actually trigger a Railway redeploy on `main` push (currently Railway appears to pull independently; confirm the trigger mechanism) | P0-1 | `production-e2e`'s build-identity check reports the same commit as `main`'s HEAD | Possibly — depends on how Railway is currently wired to the repo (owner has that context) |
| P1-3 | Reconcile the two DB dialects' migration drift risk | `db/migrations/` vs `db/migrations-pg/` (22 files each, dual-maintained) | Both pass CI today, but every schema change requires hand-authoring two migration files | Add a CI check that fails if one dialect's migration count changes without the other's (a cheap guard, not a rewrite) | None | New CI step; test it by adding a migration to one dialect only and confirming CI fails | No |
| P1-4 | Independent-session `test:pg` / `mission:pg-check` / browser-check re-run | CI only, not re-run locally this session (no local Postgres/Chromium budget spent) | TESTED via CI on HEAD `4acd993`, not re-executed in this takeover session | If you want first-hand re-verification (not required — CI is real evidence), run `npm run test:pg && npm run mission:pg-check` with a local Postgres | None | Exit code 0 | No |
| P1-5 | Stripe activation path decision | `.env.example`, `src/billing/stripe.ts` | `STRIPE_WEBHOOK_SECRET` unset anywhere confirmed | Decide whether AKBARAL! billing goes live now (requires webhook secret + site URL) or remains explicitly "trial only" | P0-2 clarifies whether Railway even has the base Stripe key | `real-providers` CI shows `STRIPE_WEBHOOK_SECRET` configured; a real test checkout round-trips | **Yes — requires your Stripe dashboard access** |

### P2 — real capability expansion

| # | Item | File/module | Current state | Required change | Depends on | Verification | Owner action needed? |
|---|---|---|---|---|---|---|---|
| P2-1 | Mission first activation (if and when you decide to) | `scripts/mission-init.ts`, `mission-serve.ts` | CODE PRESENT, TESTED, **never run in production** | Explicit, owner-directed initialization on a **separate** host/process from AKBARAL!, with its own DB, its own Stripe account, KYC/payout verification completed first | P0/P1 items above are independent of this; mission activation should not be bundled with any AKBARAL! deployment work | `verify:mission-lock`, `verify:owner-identity`, `verify:mission-money` scripts, plus a live owner-only smoke test | **Yes — absolutely, and explicitly out of scope until you decide.** This plan does not schedule it as "next." |
| P2-2 | Real connector activation (any of the 57 cataloged) | `src/mission/earning/*` | CODE PRESENT, TESTED against fixtures; zero real credentials configured anywhere | For any single connector: owner creates the real account, completes that platform's own KYC, stores the credential in the mission vault, verifies `provider-readiness` reports it ready | P2-1 (mission must be running) | `earning-readiness` API reports the connector ready; first real settlement independently verified via `settlement-verification.ts` before any ledger credit | **Yes — every connector requires owner-held, real, human-verified accounts. No exceptions, no automation of this step.** |
| P2-3 | Resolve `src/orchestrator/recovery.ts` shared-vs-separate question flagged in §2 of this plan | `recovery.ts` | Appears correctly separated by DB connection; not exhaustively proven | Add an explicit isolation test (mirroring `three-plane-isolation.test.ts`'s pattern) asserting a stuck mission task recovery pass never touches the customer DB and vice versa | None | New passing test | No |

### P3 — optimization / hardening

| # | Item | File/module | Current state | Required change | Depends on | Verification | Owner action needed? |
|---|---|---|---|---|---|---|---|
| P3-1 | Consolidate the ~35 root-level historical `.md` reports | repo root | Present, noisy, sometimes contradictory dates | Move to `docs/history/` (pure relocation, `git mv`, no content edits) so `MASTER_PROJECT_STATE.md` is the one current-state document | None | `git status` clean after move; links from `docs/CURRENT_SOURCE_OF_TRUTH.md` updated | No |
| P3-2 | GHCR package visibility check | GitHub Packages settings | UNKNOWN from this sandbox (API calls 404'd, likely a permissions/scoping issue, not proof of private/absent) | Confirm in the GitHub UI whether the `akbaral-` container package is Public (needed for some hosts to pull without auth) | None | Visual confirmation in GitHub Packages settings | **Yes — only visible/changeable by a repo admin in the GitHub UI** |
| P3-3 | Dual retry-hardening convergence | `src/models/retry.ts` (main) vs. the enhanced version on the merged-in branch (P0-1) | Will self-resolve once P0-1 merges | No separate action if P0-1 lands as-is | P0-1 | `provider-hardening.test.ts` passing post-merge | No |

---

### Second-pass addendum: sibling thread resolved, tool-assignment note

- `src/routes/economy.ts` also imports mission-chat functions (`missionChatHistory/WithAgent/WithGroup`).
  Investigated this pass and **confirmed safe** — the whole router is behind
  `router.use(requireAuth, requireRole('owner','super_admin'))`, unlike `boss-dashboard.ts`. No action needed.
- 11 of the 18 registered tool handlers (`youtube_publish, instagram_publish, x_post, shopify_product,
  twilio_message, stripe_payment, http_request, json_transform, text_analyze, csv_parse, maps_place`) are not
  used by any of the 4,001 catalog agents; they belong to the separate workforce/primary platform-account
  agent population (`src/workforce/execution.ts`, `src/social/platforms.ts`). Documented here so the merge
  plan doesn't imply all 18 tools are catalog-agent-usable — see `MASTER_BLOCKERS.md` §B-6.

## 7. Explicit non-goals for this turn (per your instructions, honored)

- Mission was **not** initialized, started, or migrated.
- No database was reset, migrated, or seeded in a way that persists outside a temporary file that was
  deleted after use (`/tmp/akbaral-verify.db` was created for the registry re-measurement in §4 of the
  state doc and removed immediately after).
- No credentials were created, rotated, or read.
- No deployment was triggered, no Railway redeploy was requested, no image was pushed.
- No PR was opened, no PR was merged, no PR was closed.
- No money was spent, no payout was requested, no KYC was submitted.

**Waiting for your approval before any of the P0/P1/P2 items above are implemented.**
