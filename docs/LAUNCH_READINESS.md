# AKBARAL! / MASTER AI — Launch Readiness QA (18 September 2026)

Assessment date: 9 September 2026 · Suite: **200/200 tests**, typecheck clean,
build green · Live verification performed against the running platform
(API :4000 + web :3000) on 2026-09-09.

Rules used: nothing is marked ready that was not tested or live-verified; no
cosmetic redesign was performed; no capability is faked. Where a feature
depends on production-only inputs (provider keys, SMTP, outbound network),
the dependency is stated.

---

## LAUNCH READY

### 1. Core platform & authentication
Register/login/refresh-token rotation/logout; scrypt password hashing;
1-hour signed JWTs with algorithm pinning and constant-time signature
comparison; server-side session revocation; per-account brute-force lockout
(10 failures/15 min → 429, durable in `security_logs`); generic failure
messages (no user enumeration).
Evidence: `src/auth/service.test.ts`, `src/security/attack-surface.test.ts`
(14/14), `src/server/app.test.ts`; live logins throughout 2026-09-09.

### 2. Trust & credit policy (locked, regression-tested)
30-day trial + 5 free tasks granted at registration; credits consumed ONLY
on successful completion; refunded on failure, verification failure,
timeout, cancellation-before-completion and crash-recovery failure;
Pro-required resource unavailability consumes nothing (honest 402
`requires_pro`); atomic idempotent server-side accounting; no negative
balances, no double refunds.
Evidence: `src/db/trust.test.ts`, `src/billing/billing.test.ts`;
**live-verified twice today**: sandbox-blocked search → task `failed` →
credits refunded 5→5; fixture-backed run → `completed` (2,418-char report,
6 log entries) → credits consumed 5→4.

### 3. Research execution (Agent #001)
Dispatch → queue (concurrency 1–8) → planning → specialist routing to
`web-research-001` → real web search/fetch with SSRF guards → source
extraction → verification → synthesis; exponential-backoff retries; per-step
and overall time budgets; crash recovery requeues interrupted jobs on boot;
WebSocket/SSE streaming logs; honest `failed` status with refund when the
environment cannot serve the request.
Evidence: `src/orchestrator/*` suites (executor/queue/recovery/factory/
goal-analyzer/master-flow/synthesizer/verifier), `src/server/app.test.ts`
(full HTTP round-trip); live end-to-end pass and honest-failure pass today.
Note: requires outbound network in production (the QA sandbox blocks it —
the platform fails honestly and refunds, by design).

### 4. Agent registry & discovery
4,001 agents (4,000 generated specialists + flagship **web-research-001**,
now a first-class platform-owned catalog definition — the launch-QA smoke
pass caught that a fresh seed previously omitted the flagship until the
first task lazily created it owned by one user; fixed, tested, live-verified:
`GET /api/agents/web-research-001` → 200, discoverable by every user).
80 categories; ranked multi-term search; honest visibility (unpublished
custom agents 404 to non-owners without existence leaks).
Evidence: `src/agents/registry.test.ts` (updated for 4001/51), access tests;
live 200s on search/detail/categories.

### 5. Marketplace & Agent World
Featured + trending from REAL usage signals (installs, reviews, rating
weight, completed executions, recent windows); reviews with 1–5 CHECK
constraint, one per user (upsert replaces comment), aggregate recomputed
from real rows only; install counted exactly once per user; Agent World
surface (saved/installed agents with the user's real usage, favorites,
removal).
Evidence: `src/routes/marketplace-world.test.ts` (8/8); live 200s.

### 6. Agent Factory
Custom agent creation with validation (including prompt-injection/secret/
permission safety checks on configuration), versioning, publish-to-
marketplace with owner-only visibility semantics.
Evidence: `src/orchestrator/factory.test.ts`, `factory-templates.test.ts`.

### 7. Workspace, files & knowledge
Projects with owner/member/viewer roles; uploads sanitized (filename
traversal contained, 25 MiB limit, storage keys validated against the
upload root), download disposition encoding; knowledge indexing and search;
SSRF-safe web tools (`assertAllowedSourceUrl`: loopback/private/link-local/
metadata/`file:`/`ftp:` all rejected — verified in the attack suite).
Evidence: `src/routes/workspace.test.ts`, `src/security/attack-surface.test.ts`;
live oversize-upload 400 in 97 ms (a pre-QA bug that hung requests 300 s
was found by the suite and fixed in M9).

### 8. Billing & monetization
Subscription lifecycle (free/pro/enterprise plans, trialing → active);
custom-credit purchase via manual settlement or **real** Stripe Checkout /
Razorpay Order creation (providers honestly return 402
`provider_not_configured` naming the missing credential until keys are
set); signed webhook settlement — timing-safe HMAC, Razorpay dual-signature,
duplicate-event protection (`processed_billing_events`), idempotent settle,
refund with atomic credit reversal, and the refunded-invoice re-settle
guard (double-grant hole found and fixed during M8 live verification);
owner-only invoice PDFs (dependency-free PDF 1.4 generator); usage
statements from real aggregates; admin revenue/margin/conversion overview;
marketplace commission reporting (bps-configurable).
Evidence: `src/billing/billing.test.ts` (17/17 incl. trust-policy
regressions); full live lifecycle on 2026-09-09 (purchase → settle →
duplicate → failure → refund → replay → PDF → usage → overview → 402
honesty → refunded-invoice guard).

### 9. Security posture
M9 attack-surface suite (14/14) covering JWT forgery/tamper/expiry,
register-body role escalation, admin authz (403/401), per-account lockout,
cross-tenant IDOR (projects/executions/invoices/files), SSRF, path
traversal, malicious uploads, secret leakage (config status, login errors,
request logs), audit-search integrity, concurrent duplicate-webhook race
(8 parallel deliveries → exactly 1 settlement), credit manipulation, and
rate-limit `X-Forwarded-For` spoofing containment. Plus prompt-injection
quarantine in every model prompt boundary (goal-analyzer, executor,
synthesizer, factory) verified in their suites. No “unhackable” claims —
practical controls, tested.

### 10. Admin & observability
Stats, analytics (revenue/cost/margin), provider health (DB-derived + optional
live probe), queue observability + admin cancellation, emergency stop,
feature flags (audited), agent/model status controls (audited), payment
settlement (guarded), billing overview, audit search with filters and
bounded pages. Structured JSON request logs without tokens/headers.
Evidence: admin suites + live 200s on all admin endpoints (non-admin 403,
anonymous 401).

### 11. Production operations (M10)
`GET /api/health` (real DB probe, 503 degraded) and `GET /api/ready`
(DB + migrations + uploads + queue worker) — live all-green;
`GET /api/metrics` Prometheus endpoint (admin-only, real measurements) —
live 401/403/200 verified; **verified backups** (`VACUUM INTO` +
integrity + row-count verification + retention) — live backup while
serving (36 MB, integrity ok, 4,001 agents), corrupt-restore refused
(“database disk image is malformed”), **full restore drill executed live**
(5→4 users with post-backup row rolled back, safety snapshot kept, restart
→ ready); graceful shutdown drains the queue (observed on SIGTERM);
`docker-compose.production.yml` + hardened Dockerfile (full stack in the
runtime image, `/api/ready` healthcheck, nightly verified backup cron);
`docs/DEPLOYMENT.md` runbook.

---

## PARTIALLY READY (launchable with stated dependencies)

| Feature | Status | What is missing |
| --- | --- | --- |
| Payment providers | Code complete & live-tested against real API shapes; **needs production Stripe/Razorpay keys (PKR) and webhook endpoints registered in the provider dashboards**. Until then the platform honestly returns 402 `provider_not_configured`; manual settlement works. | Production credentials + provider-side webhook URL configuration. |
| Email flows (password reset, verification) | Implemented; **needs production SMTP credentials**. Without SMTP the flow returns an honest dev token (development only). | SMTP credentials in `.env.production`. |
| Web app | Premium homepage (preserved, 200 live) + SPA shell served from `public/`, `/api` proxied through Next. Deep wiring of every platform surface into the web UI (task center, live logs, results views) is Milestone 12. | Full API wiring in the web UI — use the API/SPA until M12 lands. |
| Monitoring hookup | `/api/metrics` + `/api/ready` are ready; scraping requires the admin bearer token. | Wire Prometheus/Grafana (or equivalent) at deploy; dedicated read-only metrics token is POST-LAUNCH. |
| Off-host backups | Verified on-volume backups (nightly cron in-container) + restore drill procedure. | Schedule the documented off-host copy (`/data/backups` → external storage) in production; off-site automation is POST-LAUNCH. |
| TLS termination | App binds 0.0.0.0 and honors `TRUST_PROXY`; no bundled TLS proxy. | Terminate TLS in front (Caddy/nginx/ALB) and set `TRUST_PROXY=1` per the runbook. |

## POST-LAUNCH (explicitly not claimed for 18 September)

1. **Horizontal scaling / multi-node** — single-node SQLite deployment by
   design; PostgreSQL migration via the thin repository layer is the
   documented path.
2. **Distributed execution queue** (Redis/Postgres-backed workers) — current
   queue is in-process.
3. **Zero-downtime deploys** — migrations run at boot; deploys take a brief
   restart window on a single node.
4. **OAuth login** (Google/GitHub/Apple/Microsoft) — `/api/auth/oauth/providers`
   honestly reports providers as not configured; the flows are not wired.
5. **Mobile shell** — Expo app skeleton exists (`mobile/`); full MASTER API
   wiring, deep links, push notifications are Milestone 12+.
6. **Automation / AI employees** — scheduled/recurring workflows, trigger
   system, long-lived agent budgets: not implemented.
7. **Social/marketing integrations** (YouTube/Instagram/X/Shopify/Twilio) —
   surfaced honestly as credentials required by specialist agents; no
   built-in connectors.
8. Dedicated read-only metrics token; automated off-site backup replication;
   secret-rotation automation tooling.

---

## Launch blockers found during this QA — all fixed and re-verified

1. **Flagship agent missing from fresh seeds** (`web-research-001` was only
   created lazily, owned by the first task's user and invisible to everyone
   else in discovery). Fixed: it is now a first-class platform-owned catalog
   definition (`WEB_RESEARCH_AGENT_DEFINITION`), synced by every seed/boot
   (registry now 4,001; research category 51). Tests updated, live-verified.
2. (Carried from M9) **Upload error handling** hung requests 300 s and
   leaked uncaughtExceptions — fixed (`next()` routing, 400 in ~100 ms).
3. (Carried from M8) **Refunded-invoice re-settlement double-grant** — fixed
   with the not-payable guard + regression tests.
4. (Carried from M10) **Production image had no web build** and the API ran
   `NODE_ENV=development` in production start — both fixed.

## Go/No-Go verdict

**GO for 18 September 2026**, contingent on the deployment checklist in
`docs/DEPLOYMENT.md` (production secrets, provider credentials as available,
TLS, monitoring hookup, off-host backup schedule, restore drill on staging).
The platform launches as an honest single-node deployment with a locked
trust policy, tested security posture, verified backups, and monetization
that works today via manual settlement and activates per provider the
moment real credentials are configured.
