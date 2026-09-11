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
| Payment providers | Code complete & live-tested against real API shapes; **needs production Stripe/Razorpay keys (USD) and webhook endpoints registered in the provider dashboards**. Until then the platform honestly returns 402 `provider_not_configured`; manual settlement works. | Production credentials + provider-side webhook URL configuration. |
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
4. **OAuth login** (Google/GitHub/Apple/Microsoft) — fully implemented
   (state/CSRF + PKCE, server-side secrets, verified-email auto-link with
   takeover protection, account linking, unlink with lockout protection,
   Apple ES256/JWKS verification). Requires deployment credentials
   (GOOGLE_CLIENT_ID/SECRET, GITHUB_*, MS_*, APPLE_* + private key) to go
   live; until then `/api/auth/oauth/providers` honestly reports them as
   unconfigured and no buttons are rendered.
5. **Mobile shell** — Expo app (`mobile/`) is wired to the full MASTER API:
   auth, dashboard, MASTER, task center with live SSE logs, agents,
   workspace, billing, settings; deep links (`akbaral://tasks/:id`) and
   Expo push notifications (device registration + honest failure
   reporting). Remaining for store release: an EAS build with a projectId
   (required for real Expo push tokens) and app-store assets.
6. **Automation / AI employees** — scheduled/recurring workflows ARE
   implemented (one-time, timezone-aware cron and interval schedules,
   multi-step agent workflows through the MASTER orchestrator, retries,
   timeouts, refunds, notifications, crash recovery; web + mobile clients).
   Remaining for later: event-driven triggers beyond schedules (webhooks,
   task.completed hooks) and long-lived agent budgets. Legacy CRM
   trigger-key automations remain a data skeleton (no execution), unchanged.
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

## Launch blockers found during the 2026-09-10 production-readiness pass — all fixed and re-verified

These were **client/UI contract bugs** found by auditing every SPA loader
against the live API (not by tests alone — all 200 tests were green while
these shipped broken):

1. **MASTER orchestration was unusable from the web app**: wrong field reads
   (`plan.workflowId`, `body.executionId`, no `executionId` in the run
   response) plus `[object Object]` plan rendering. Rewritten and
   live-verified (plan → run → per-step poll → terminal result → credit
   refresh).
2. **Admin dashboard showed `undefined` for every stat** — the client read
   the wrapped `{stats:{...}}` response directly. Unwrapped; inner keys
   verified against the renderer.
3. **Trial state never displayed** — the client checked `trial.isActive` /
   `trial.daysRemaining`, fields that do not exist (`trial.active`,
   `trialEndsAt`). Fixed everywhere; days computed from the real timestamp.
4. **Auth 401 refresh loop (observed from a real browser)** — concurrent
   callers refreshed independently under strict refresh-token rotation and
   killed each other's sessions. Fixed with single-flight refresh +
   cross-tab sync; verified with a 5-way concurrent 401-storm simulation.
5. **Unbounded execution polling** on unknown executions — bounded (10-miss
   guard).

AdSense readiness added honestly: truthful cookie/advertising disclosure in
the privacy policy, real About/Contact surfaces, and a consent-gated ad
architecture that is fully inert (no script, no slots, no banner, honest
`ads.txt` 404) until a real `AKBARAL_ADSENSE_CLIENT` publisher id is
configured. No approval is claimed or implied.

## Cinematic visual transformation QA (2026-09-10)

Full visual transformation verified with the same rigor as functional
changes:

1. **Zero functional regressions by construction:** every element ID and
   binding the SPA uses was inventoried before the rewrite and re-verified
   after (automated ID-parity check; the only removed IDs were four legacy
   marketing sections nothing references). All 12 screens, all forms, all
   flows intact.
2. **Live verification:** homepage serves all new cinematic markers; all
   static assets 200 (poster 92 KB, CSS 51 KB, JS 68 KB); hero video slot
   correctly falls back to the original canvas animation (no video asset
   present); real /api/health drives the hero status chip; login → /me →
   agents (4,001) verified through the Next proxy; all scroll targets and
   route targets resolve.
3. **Performance discipline:** transform/opacity-only animations, rAF
   throttling, passive listeners, animation paused off-screen and on
   hidden tabs, light node budget on mobile/save-data, `preload=none`
   video, `display=swap` fonts, no third-party JS on the page.
4. **Accessibility:** single h1, ordered headings, skip link, aria labels,
   keyboard-operable controls with visible focus, contrast-checked palette,
   full prefers-reduced-motion support (poster-only hero, instant reveals).
5. **Honesty preserved:** real counters only, representative trace clearly
   labeled, implemented security controls only, advertising still inert
   until configured + consented.

## Preview-error & hermeticity pass (2026-09-10)

1. **React hydration mismatches (live preview)** — root-caused from the dev
   log's React diff output: the SPA bootstrap executed before hydration and
   mutated the DOM. Fixed structurally (bootstrap gated on load + double
   rAF; zero module-level DOM mutations; `suppressHydrationWarning` + pre-
   paint theme snippet on `<html>`). The mismatch class is now impossible
   by construction.
2. **Console 404 noise** — the hero-video HEAD probe was replaced by a
   server-rendered existence flag.
3. **Clipboard errors** — verified the served code never touches the
   clipboard API (zero references); those errors originate from the
   embedded-preview environment, not the application.
4. **Test hermeticity defect (found by the suite, real)** — a local `.env`
   wiring live research providers could make the billing honest-failure
   path succeed; the suite now clears research-provider env explicitly.
   Full suite 200/200, typecheck clean, production build green.
5. **Deployment note:** keep `AKBARAL_SEARCH_ENDPOINT` /
   `AKBARAL_PAGE_FETCH_ENDPOINT` / provider credentials OUT of `.env` when
   running the test suite in the same checkout (pass them on the dev
   server's process env instead), and keep `TRUST_PROXY="0"` unless behind
   a trusted proxy — the rate-limit spoofing test enforces exactly this.

## Go/No-Go verdict

**GO for 18 September 2026**, contingent on the deployment checklist in
`docs/DEPLOYMENT.md` (production secrets, provider credentials as available,
TLS, monitoring hookup, off-host backup schedule, restore drill on staging).
The platform launches as an honest single-node deployment with a locked
trust policy, tested security posture, verified backups, and monetization
that works today via manual settlement and activates per provider the
moment real credentials are configured.

## Unified design system pass — web + Android + future iOS (2026-09-10)

The website and the Android app now share ONE design system, compiled from
a single token source (`design-system/tokens.json`):

1. **One identity, native feel**: identical palette (obsidian
   `#06070f` family, indigo `#5d6ff0` → violet `#9d8cff` accent, cyan
   telemetry), spacing, radii, status language, agent sigils and motion
   semantics on both platforms; the mobile app keeps a native mobile UX
   (bottom tabs, native scroll, system font) rather than a shrunken site.
2. **iOS is prepared, not faked**: generated `AKBARALTheme.swift` tokens
   exist; there is no iOS app and none is claimed.
3. **No functionality touched**: authentication, OAuth, MASTER, agents,
   Agent Factory, Agent World, tasks, execution, verification, workspace,
   automation, notifications, billing/credits, security and APIs all
   unchanged — verified by the full suite (253/253), both typechecks and
   the production build, plus live login/me/agents/OAuth checks.
4. **Responsive + motion discipline maintained**: 320–430px + tablet
   rules intact on web (new sections follow the same container-scroll
   discipline); mobile layouts are flexbox-native at all widths; all new
   motion (entrances, pulses, shimmers) honors reduced-motion on both
   platforms and runs on native drivers/compositor-only properties.
5. **Assets**: new original AI-generated hero poster (obsidian/indigo);
   asset cache version `akbaral-ds-1`.

## Cinematic transformation pass — hero film, loading identity, USD (2026-09-10)

1. **Real hero video, not a placeholder**: original procedurally-rendered
   film (12 s seamless loop, 272 KB) served and verified live — 200 on
   full fetch, **206 on range requests** (iOS-safe), poster extracted
   from the film, `canplay` cross-dissolve, error/save-data/reduced-motion
   fallback to the canvas network. The `akbaral-hero-video` flag only
   exists because the file exists.
2. **Loading identity ships on web + Android** (and is specified for iOS
   in the design system): branded boot veil with ring pulses and light
   sweep; Android crossfades over pre-rendered UI — no white flash, no
   layout jump; native splash image on the same `#06070f` canvas.
3. **Pricing is USD everywhere** ($0/$50/$400 plans; USD quick-amounts;
   invoices, marketplace, admin stats, mobile). The model carries USD
   cents end-to-end (verified live: plans endpoint + manual purchase
   order both USD); historical dev invoices keep their original PKR
   label. Migration 0012 applied to the dev DB.
4. **No functionality broken**: full suite 254/254, both typechecks and
   the production build green; live smoke of auth, purchase order,
   registry (4,001), OAuth providers; server log clean; no test was
   removed or weakened (the currency model legitimately changed —
   assertions were updated and a new USD catalog test added).

## Final luxury visual pass + six-tier pricing (2026-09-10, M13)

1. **Pricing architecture complete and live**: six USD tiers
   ($0/$10/$50/$90/$200/$400) with honest per-tier allocations plus
   custom manual credit purchase; verified live on the dev stack and
   by a new integration test. No PKR anywhere public; historical
   dev invoices keep their original PKR label.
2. **Visual system final**: editorial typography hierarchy, restrained
   navigation, integrated hero film (masked edges, no video-box look),
   Agent Router pipeline stage, security control ledger, category-
   kickered agent cards, spec-sheet factory form, schedule-kind chips,
   premium six-tier pricing cards; Android aligned (tracked chrome,
   seats + featured flag in billing).
3. **Functional integrity re-verified end to end**: 254/254 tests,
   both typechecks, production build, and a live sweep across auth,
   billing (plans + manual order), registry (4,001), MASTER planning,
   tasks, automations, workspace, OAuth providers — all clean, server
   log free of errors.
4. **Responsive/motion discipline**: no fixed oversized widths; new
   grids collapse 3→2→1; all new transitions settle under
   prefers-reduced-motion; a11y rules (skip link, focus-visible,
   aria labels) intact.

## Execution-simulation console (2026-09-10, M13.1)

The landing execution chapter now includes an animated simulation console
under the user goal. It is presentation-only by construction (hardcoded
inert strings, textContent-only rendering, zero connection to any real
system) and explicitly badged "SIMULATION · PRESENTATION ONLY" — no fake
task completion, no fabricated business results. Performance-safe
(off-screen/tab-hidden pauses, capped DOM, one timer chain) and fully
settled under prefers-reduced-motion (static snapshot). Verified by a
static security audit, a Node execution harness (randomized, crash-free,
all-strings), the full test suite, both typechecks, the production build
and live asset checks.

## LUX-4 quiet-luxury identity (2026-09-11, M14)

Complete visual-language replacement (web + Android): neutral obsidian
surfaces, muted silver lines, restrained indigo/violet accent and an ivory
primary action that inverts in light theme; Sora/Inter/Grotesk-Mono type
system; rebuilt single-row navbar with landing/app sets and a More
dropdown (flattened in the ≤1023px mobile menu); recentered cinematic
hero (video unchanged); architectural radii and quieter card/button
motion across all surfaces. Verified: 254/254 tests, server + mobile
typechecks, production build, live sweep (nav markup, tokens with ivory,
hero video 200/206, six USD plans, 4,001-agent registry, demo console
markers, QA auth round-trip). Functional behavior unchanged.

## GLASS-5 luxury glass reconstruction (2026-09-11, M15)

Full visual reconstruction to a layered glass system: single signature
theme (theme switching completely removed — toggle, settings row, JS
engine, light tokens), fixed composited atmosphere with grain, a
three-level glass material system across every surface, floating glass
navbar + glass sheet drawer, recentered cinematic hero (video kept),
sticky glass chapter rail, harmonized translucent surfaces everywhere,
and the Android app rebuilt on the same atmosphere + glass language
with native UX. Verified: 254/254 tests, server + mobile typechecks,
production build, live sweep (no theme UI, glass tokens live, hero
video 200/206, six USD plans, 4,001 agents, console markers, QA auth
round-trip, zero server errors). Functionality unchanged; console
safety model untouched.

## Final UI corrections (2026-09-11, M15.1)

Console density reduced 37-39% (188px/132px stream, inert engine
re-audited untouched); More dropdown removed for a professional
one-row navbar (Log In / Start Building always visible, real routes;
Start-Building-now-hides-when-authed bug fixed); footer rebuilt as a
glass navigation strip with professional System-status link; sixth
billing principle (real capability disclosure) added on web + Android
with identical wording. Verified: 254/254 tests, both typechecks,
production build, live sweep (nav-more gone, glass footer present,
principle 06 present, USD six-tier pricing, 4,001 agents, real login
round-trip, /api/health 200, no theme switch).

## Responsive UX reconstruction, browser-verified (2026-09-11, M16)

First genuinely browser-verified responsive pass (headless Chromium +
puppeteer-core against the production build): 71 route×viewport checks
across 320-3440px, zero real horizontal overflow (scroll-lock verified,
clipping-ancestor-aware offender audit). Fixed: desktop-bar leakage of
sheet-only nav links at 1024px (specificity bug), hero video overscan
overflow, boot-sweep overflow, uneven footer chips. Enforced floors: no
visible text under ~10px, 40px/44px touch targets, safe-area insets on
anchored surfaces, lighter glass blur on mobile, per-class hero/panel
compositions. Android: SafeAreaProvider + inset-aware tab bar/login.
iOS: responsive contract added to the design tokens (no fake app).
Full battery green: 254/254 tests, both typechecks, production build,
node --check, live API sweep (4,001 agents, six USD plans, auth, health).
