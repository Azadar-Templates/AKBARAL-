# AKBARAL! — FINAL LAUNCH PASS report

Date: 2026-09-14 · Branch: `arena/01a0a045-akbaral` · Base: `e717c81` (Build #5) + this pass

This is the honest, evidence-backed close-out of the ten-point launch audit. Every
number below was produced by a command run in this checkout; nothing is inferred,
and nothing that failed is described as passing.

---

## 1. Defects found in this pass and fixed

| # | Defect (as observed) | Root cause | Fix | Locked by |
|---|---|---|---|---|
| 1 | `POST /api/factory/agents/:slug/status` with an invalid status answered **HTTP 500** | `AgentFactory` threw plain `Error` with no `code`; the route called factory methods bare, so `businessErrorToHttp` fell through to `internal_error` | `FactoryError` (`validation_error` / `forbidden` / `not_found`) replacing all 22 throws; `factoryCall()` + `businessErrorToHttp` around every factory route; mapper gained `validation_error → 400` and `conflict → 409` | `src/app/user-journey.test.ts` test 18b (invalid status 400 + code, unknown version 404, valid lifecycle 200, outsider 403) |
| 2 | Owner / super_admin could not execute at a zero balance (**HTTP 402** despite unlimited entitlement) | The zero-balance pre-flight gates in `createResearchTask` and `createAgentTask` (`src/orchestrator/executor.ts`) threw `requires_pro` *before* `reserveTaskCreditForUser` — the only place the role entitlement was applied | New `src/auth/entitlements.ts` (`hasUnlimitedTaskCredits`); both pre-flight gates are entitlement-aware; the automation scheduler's two `trial.requiresPro` gates (auto-pause + manual run) are entitlement-aware as well | `src/orchestrator/owner-entitlement.test.ts` (7 tests: owner, super_admin, normal-user refusal, normal-user consumption, scheduler owner run, scheduler normal refusal, helper defaults) |
| 3 | `npm run scan:secrets` crashed `ENOENT … test.db-journal` and reported a false FAIL while the test suite recreated the DB | the walker stat'ed every entry individually, so a file removed mid-walk aborted the security gate | `fs.readdirSync(root, { withFileTypes: true })` — no second stat, scan can never fail because the tree changed underneath it | `src/security/scan-secrets.test.ts` (5 tests, incl. the tree-scan self-check) |

Normal-user credit enforcement is unchanged and re-asserted in the same tests:
zero balance → `requires_pro` with **no** task row created; 2 credits → 1 → 0 with
exactly one credit per execution.

## 2. Verification results (this build)

**Test suite — clean run on a freshly deleted `test.db`:**
`npm test` → **56 test files, 499 tests, 499 pass, 0 fail, 0 cancelled/skipped**, exit 0
(`/tmp/full-suite-final.log`; the previously reported `fail 5` was an invalid run caused
by deleting `test.db` while a suite was live — never done again).

**Other gates**

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (web/API) | PASS |
| `npm run build` | exit 0 (Next production build; `dist` contains the entitlement + factory fixes) |
| `npm run test:pg` (real PostgreSQL parity) | **22/22** on 4 of 5 runs; one earlier run showed 21/22 while the full suite ran concurrently and did not reproduce in any of the following 4 runs (including one run under the same concurrency) — reported as an unreproduced intermittent, not as a pass |
| `npm run scan:secrets` | PASS — `no real secret markers found in the working tree (22 allow-listed synthetic placeholders)` |
| `npm run audit:registry` | PASS — 4,001 contracts / 4,001 unique slugs / 4,001 unique system instructions |
| `mobile`: `npx tsc --noEmit` | exit 0 |
| `mobile`: `npx expo export --platform android` | OK — `AppEntry-bb61a1049edf8221711fccbd5e03db1c.hbc` (2.3 MB), **identical hash** to the pre-pass build, proving the completed Arena-style UI is untouched |
| Client-asset leak scan | 15 bundles / 618 KB → **0** secret-shaped matches |

**Live production-mode E2E** (stack `production-stack-keyed-search`, `NODE_ENV=production`,
`AKBARAL_REALTIME_TRANSPORT=sse`, keyed Tavily path over real HTTP transport):

- **Owner entitlement live**: owner at 0 credits → `POST /api/tasks/research` **202** (was 402) → task **completed**, balance stays 0, audit row `owner.unlimited_execution` written.
- **Normal-user enforcement live**: zero-credit normal user → **402 `requires_pro`**.
- **Free trial**: new account = 5 credits → research task **completed** → 4 credits (exactly one), 27 verified source URLs in the report.
- **SSE live transport**: 6 events streamed *during* execution (`system`/`log`/`verification`, incl. “Verification passed — result ready”, “Result stored as project artifact (8363 bytes)”), matching the persisted event rows; anonymous `GET /api/executions/:id/events` → **401**; WebSocket upgrade on both ports → **403** (SSE-only mode).
- **Files**: upload → authenticated download **byte-identical** with `attachment; filename="brief.md"`; anonymous **401**; cross-tenant **404**.
- **MASTER**: `POST /api/master` (website goal) → workflow **completed** → artifact website **v1, 2,538 chars**, real `<!doctype html>`, versions `[1]`, authenticated export **200** `text/html` attachment (2,545 B), anonymous export **401**.
- **Honest failure**: with no model/search credentials, a research task ends **failed** (never “completed”), the error names the missing provider env vars, there is **no** fabricated result, and the credit is restored 5 → 5; balance never goes negative.
- **Canonical CI script**: `AKBARAL_BASE_URL=… node scripts/verify-production-e2e.mjs --allow-fixture` → all checks pass, exactly one credit consumed, no key material on any surface (fixture answers are labelled; fixture mode is local-only evidence and is not claimed as production proof).

## 3. Production infrastructure status

Verified by inspection of `Dockerfile`, `docker-compose.production.yml`,
`scripts/entrypoint.sh`, `scripts/start-prod.mjs`, `deploy/modal/akbaral_app.py`:
multi-stage `node:22-slim`, `/data` volume (SQLite + uploads + backups),
`HEALTHCHECK /api/ready`, migrate → optional seed → backup cron → `start-prod`,
compose is a single intentional node (PostgreSQL migration documented as post-launch),
Modal runs the same image with the `akbaral-production` secret and root-owned `/data`
volume. Production boot refuses a weak `SESSION_SECRET`; SSE mode refuses every WS
upgrade by design. A non-root `USER` is **not** added: Modal mounts `/data` root-owned
and there is no Docker binary in this sandbox to validate the change — reported as a
hardening item rather than changed blind.

## 4. Remaining blockers / human actions

No code blocker remains for launch. The unavoidable external actions are only:

1. Provide production credentials to the deployment environment (`GOOGLE_API_KEY`, and a search key — only the env-var **names** are ever referenced in code): they must be set in the host/Modal secret store, never in the repo.
2. Point the deployment at a persistent database (`DATABASE_URL`, e.g. Modal+Neon) and set `AKBARAL_OWNER_EMAIL` for owner promotion.
3. Run the deployment once with `SEED_DATABASE=true` on an empty volume, then leave it `false`.
4. External reachability of Google/search providers is asserted only through the local protocol fixture here (this sandbox has no outbound egress) — one live call against the real providers from the deploy host closes that last gap.

## 5. Sandbox limits (stated, not hidden)

No outbound network (all egress probes fail), no Docker daemon, no headless browser,
and `node_modules` is not snapshotted — so provider calls are exercised over real HTTP
against local protocol fixtures, container images are verified by inspection rather
than by a build, and UI checks are type/build/export gates plus the live HTTP journeys.
