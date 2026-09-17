# MASTER BUILD #2 — PRODUCTION BLOCKER CLOSURE REPORT
**Date:** 2026-09-14 (Asia/Karachi) · **Internal freeze target:** 2026-09-16 · **Launch target:** 2026-09-18

> Verified facts only. Fixtures are labelled as fixtures. Unconfigured providers are marked **BLOCKED** — nothing is faked.

## 1. Final commit SHA
**`637f660`** — "launch blocker closure: search hardening, full-journey QA lock, 2 real bug fixes, real-Gemini CI path, codename scrub" (13 files, +931/−44). Pushed to `origin/arena/01a085d2-akbaral`.

## 2. Full test count / result
- **SQLite suite (`npm test`): 398/398 pass, 0 fail** (was 376 → +15 user-journey, +6 search hardening, +1 codename lock)
- **PostgreSQL suite (`npm run test:pg`, PGlite wire-protocol harness): 21/21 pass, 0 skipped** (incl. new FTS regression parity case)

## 3. Typecheck
`tsc --noEmit`: **clean** (run after every change set).

## 4. Production build
`npm run build` (Next): **OK**. docker-publish CI for `637f660` (run 34785257283): **completed / success**.

## 5. Live deployment result
**BLOCKED — no live production URL exists.** Confirmed this session: all five historical `production-verify` runs fail fast because the legacy Modal workspace is disabled and `PRODUCTION_BASE_URL` is not set; Render/Zeabur retired earlier (card-gated / no free compute). The Docker image builds and publishes green from every push. Standing user-side step: create the SnapDeploy container per `deploy/free-snapdeploy/DEPLOYMENT.md` (repo `Azadar-Templates/AKBARAL-`, branch `arena/01a085d2-akbaral`, port 3000, Small; env `DATABASE_URL` Neon, `SESSION_SECRET`, `AKBARAL_OWNER_EMAIL`, `TRUST_PROXY=1`, `DISABLE_BACKUP_CRON=1`, `SEED_DATABASE=true` only if Neon is empty) → send me the URL → I run the deployed-artifact E2E immediately (workflow re-runs on every tooling push; `workflow_dispatch` unlocks once the workflow file reaches the default branch).

## 6. Gemini real-provider result
Two honest evidence channels, both wired and **ready but blocked**:
- **Deployed-artifact E2E** (`scripts/verify-production-e2e.mjs` via `production-verify`): BLOCKED on the production URL (§5). On the live local preview stack it passes **all checks** in fixture mode (labelled, not production evidence): plan→run→verify→render, exactly 1 credit consumed, no key material on any surface.
- **NEW direct channel** (`scripts/verify-gemini-direct.ts`): real request/response, real SSE streaming, credential-failure classification (deliberately invalid key → status-classified `ProviderCallError`), unconfigured classification, usage accounting — runs from the egress-capable GH runner when `GOOGLE_API_KEY` exists as a repository secret. CI run 34785257325 proves the gate works: `secret-gate` success → `real-gemini-direct` **skipped** (the key is not a repo secret — it lives only in the production host's secret store). Adding it as a repo secret activates the job with zero further changes.
- Timeout/retry/429/5xx/4xx-classification/MAX_TOKENS/RECITATION/blocked-prompt handling is verified by the unit battery (`provider-hardening.test.ts`, 10 tests: header-only key transport, fast-fail timeout, honest status buckets, 429/5xx retryable vs 4xx permanent, blocked/empty responses, 404 model diagnosis, bundle scanning).

## 7. Search provider result
**Hardened and production-ready; no external provider credential in this environment (default endpoint is public DuckDuckGo HTML — needs no key).** PHASE 2 additions, all test-locked (11/11 in `web-research.test.ts`): query sanitization (control chars, whitespace, 400-char cap), one controlled retry for transient failures only (5xx/429/network; 4xx terminal), in-process sliding-window rate limit (`AKBARAL_SEARCH_RATE_LIMIT`, default 60/min), production HTTPS transport policy (cleartext search endpoints refused in production unless an internal provider is explicitly trusted), non-http(s) result dropping (javascript:/relative/odd schemes), SSRF protections unchanged (per-hop redirect validation, private-host blocking, provider-proxy scoping). Server-side only; honest empty/unavailable handling; zero fabricated results or citations.

## 8. Payment/provider status
**Architecture production-ready; providers honestly unconfigured.** Existing: six-tier USD plan catalog, trial grants, manual credit orders (due invoice, never auto-granted), Stripe + Razorpay checkout when credentials exist, signed webhooks (generic HMAC + Razorpay dual verification), event-id idempotency, failure handling with no credit grant, refund with atomic reversal, invoice PDFs (owner-scoped), usage statements, admin overview — 18 tests in `billing.test.ts`. Required credentials (`STRIPE_SECRET_KEY` / `RAZORPAY_KEY_ID`+`RAZORPAY_KEY_SECRET`, `BILLING_WEBHOOK_SECRET`): **not set** → those paths return `provider_not_configured` honestly. No fake payments.

## 9. Free-task accounting verification
Verified end-to-end at HTTP level by the new journey test: **Free Trial = exactly 5** at signup; **success consumes exactly 1** (5→4→3 across two successful runs); **provider failure refunds** (credits unchanged after a failed run); **no client-side bypass** (rogue PATCH refused; credits server-controlled); exhaustion → `requires_pro` without consuming (unit-locked in billing tests); usage statement accurate.

## 10. Security audit result
- Secret scan: only placeholder/fixture patterns (values never printed); `.env` is the documented example copy.
- Security headers: X-Frame-Options DENY, CSP, CORS allowlist (existing, verified in place).
- Source maps: browser source maps off (Next default, unset); no route serves `dist/*.map`.
- Client bundle: no credential key names or key-shaped literals (test-locked); no Google key material on any E2E response surface.
- AuthN/AuthZ: anonymous 401s, cross-tenant indistinguishable 404s (task, project, upload, knowledge), refresh rotation with immediate revocation of the pre-rotation token, logout revocation — all journey-locked.
- SQL: parameterized throughout; the FTS MATCH expression is now sanitized+quoted (bug fix #1).
- **Two real bugs found & fixed by the QA pass:** (1) knowledge search 500 on hyphenated/special queries (FTS5 expression injection → sanitized, both engines, PG parity locked); (2) public category counts included private user-created agents (count leak → registry-only counts, contract-consistent).

## 11. ZA141251SA isolation result
- All `/api/economy/*` + mission-chat routes: owner/super_admin only (401 anonymous, 403 user/admin, 200 owner — journey + economy + mission-chat batteries).
- **Codename scrubbed from every client-served surface** (SSR page headings, app.js, styles.css) — the hidden console section no longer carries "ZA141251SA"; regression-locked so it can never reappear in page.tsx/layout.tsx/app.js/styles.css/tokens.css. Live public HTML and app.js verified codename-free.
- No public nav entry, no public API, no docs/metadata exposure; no sitemap/robots exist (nothing to leak); treasury providers unconfigured → honest $0/disabled; kill switch + disabled-by-default policy locked by tests.

## 12. 4,001+ agent registry verification
`syncAgentRegistry()` reports **4,001 agents** (seeded, idempotent); public catalog test asserts `total ≥ 4000`; journey test explores the registry and resolves `web-research-001` detail. Factory + marketplace flows verified over HTTP.

## 13. Responsive/mobile result
**Test-locked contract** (`responsive-contract.test.ts`, 10 tests): two-zone workspace collapsing under 1080px, bounded execution console, min()-guarded grids for 320px viewports, pricing grid 3→2→1, progressive gutters, flexing toolbar inputs. No Android packaging exists in the repo → skipped per your instruction (web platform priority).

## 14. Exact remaining blockers
1. **Production URL (user-side):** create the SnapDeploy container per `deploy/free-snapdeploy/DEPLOYMENT.md` → send the URL. Everything else on that path is ready (image builds green, E2E + workflow wired).
2. **`GOOGLE_API_KEY` as a GitHub repo secret (user-side, optional but recommended):** activates the new `real-gemini-direct` CI job for real-provider evidence on every tooling push. (Never paste it in chat — add it in the GitHub UI.)
3. **Payment provider credentials (optional for launch):** Stripe/Razorpay + `BILLING_WEBHOOK_SECRET` — until set, purchases stay manual-invoice only (honest).
4. **Treasury/external-work providers for ZA141251SA:** unconfigured → disabled and reported honestly ($0). Never faked.

## 15. Exact files/areas changed (`637f660`)
- `src/agents/web-research.ts` + `web-research.test.ts` + `src/test-support/research-fixture.ts` — PHASE 2 search hardening + 6 new tests + fixture modes (nested-env restore fix)
- `src/app/user-journey.test.ts` (NEW) — 15-test full-journey QA lock
- `src/db/platform-repositories.ts` — FTS sanitization bug fix (`ftsSafeQuery`, both search paths)
- `src/db/postgres.integration.test.ts` — FTS regression parity case
- `src/agents/registry.ts` — registry-only public category counts (bug fix #2)
- `public/app.js`, `src/app/page.tsx`, `public/styles.css` — codename scrub (genericized owner-console copy)
- `src/app/preview-stack.test.ts` — codename exposure regression lock
- `scripts/verify-gemini-direct.ts` (NEW) + `.github/workflows/production-verify.yml` — real-Gemini direct evidence channel behind a secret-presence gate

## 16. Code-freeze readiness
**Yes for the sandbox-side codebase** — every launch-critical gap that does not depend on an external account/credential is closed, tested (398 + 21), built, and pushed; two real bugs were found and fixed by the QA pass itself. What remains before launch is exactly the user-side provisioning in §14 (deployment URL first — it gates the final deployed-artifact verification, which §14 of the build contract requires before any "production-ready" claim).
