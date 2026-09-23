# Project history — recovered evidence, 2026-09-19

This is the historical evidence appendix to [CURRENT_SOURCE_OF_TRUTH.md](CURRENT_SOURCE_OF_TRUTH.md), not a second current-status report.

Recovered **197 reachable commits**, from the root on 2026-09-07 through 2026-09-19. Dates below are Git committer dates normalized to UTC (not assumed session dates). Full fetch removed the shallow boundary. No tags or releases were returned. Reflogs cover only this sandbox, not prior machines. No unreachable objects were reported by `git fsck --no-reflogs --unreachable`.

## Evidence rules

- “Intent” is the commit author’s recorded description, not an invented original user prompt.
- Each entry records changed paths and the original commit notes. Notes and report counts are historical claims unless corroborated by accessible CI evidence or this session’s tests.
- Changed test files identify what test code changed, not whether a test actually ran. Missing execution evidence is explicitly unknown.
- GitHub job success proves that job only: image publication and keep-alive do not prove a deployed application, real earnings, payout or all-agent execution.
- For each phase, unrecorded failures/fixes, private prompts, discarded/unpushed work, prior sandbox databases/secrets/reflogs, and production database migration ledgers are unavailable. No current production verification is inferred from old commits.
- Exact implementation diffs remain recoverable with `git show <sha>`; merge entries retain their parent topology rather than pretending to be independent implementations.

## Recovered refs

```text
origin/HEAD a924e4a98cf16af439149bf0e29ca15fb6298fda
origin/arena/01a07c3c-akbaral b53794d1a2ed1eb06086819fc7512ca04c9d8292
origin/arena/01a085d2-akbaral a6e6e77a4597360fb61223816cfdb093ba59165d
origin/arena/01a0a045-akbaral 78aad864ce38736e32203bab39101dc832101607
origin/arena/01a0aef5-akbaral a860be78343b029da9d9dddc5a1529e89b08c7ec
origin/arena/01a0af54-akbaral f1ac9e3c2362347fb2fbaaa72eda7d1bc8e0c03c
origin/arena/01a0b101-akbaral dbd712eaa933b84a7c388e500394b62fb6c06ad4
origin/arena/01a0b101-akbaral-remote 319ab28b2961d9ff65df6057627edf5a600f86f1
origin/arena/01a0b74e-akbaral 2df861730f686ccfad6327525e90ef5ec8ca1b24
origin/arena/stackhost-3s-registry-fix 674a78b7de25aaa8b7bc24d7e436795284a0e7c1
origin/arena/stackhost-fix-1789648208 4d75c47e170c6a3eb306223dda7180e8534828f3
origin/arena/stackhost-sh-disallow-fix 996bed8f2d5e3dd707016a4cb851a2d0b75de2d4
origin/arena/stackhost-yaml-schema-fix b82c4202405638618cbbedd14b57b6ea79cb29eb
origin/main a924e4a98cf16af439149bf0e29ca15fb6298fda
```

PRs 1–7 were merged; PR 8 remains open. PR 8’s Webpack proposal is superseded in the recovered workforce tree by 505026b’s memory-capped build. The sibling diagnostic and temporary Gemini-verification commits remain on their original remote refs; their historical evidence is retained, without re-enabling temporary workflows. GitHub returned no issues and no deployment objects. PR comment/review endpoints were inspected.

## Chronological commit ledger

## Day 1 — 2026-09-07

### `6c3a544` — Initial commit

- Time: 2026-09-07T14:04:56+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/6c3a544c2d8bdd300e4406862abb1953dece405c
- Parents: `(root)`
- Intent / implemented scope: Initial commit

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	README.md
```

### `2b3bc75` — Add Phase 1 database foundation (SQLite schema, migrations, repositories)

- Time: 2026-09-07T14:31:04+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/2b3bc7598bed0cb502f7d1820d330a73b3c9b8b9
- Parents: `6c3a544`
- Intent / implemented scope: Add Phase 1 database foundation (SQLite schema, migrations, repositories)

Recorded commit notes (historical claims):


Verification paths changed: `src/config/env.test.ts`, `src/db/database.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.env
A	.env.example
A	.gitignore
M	README.md
A	db/migrations/0001_init.sql
A	package-lock.json
A	package.json
A	src/config/env.test.ts
A	src/config/env.ts
A	src/db/constants.ts
A	src/db/database.test.ts
A	src/db/database.ts
A	src/db/id.ts
A	src/db/index.ts
A	src/db/migrate.ts
A	src/db/path.ts
A	src/db/repositories.ts
A	src/db/reset.ts
A	src/db/seed.ts
A	src/db/verify.ts
A	src/index.ts
A	tsconfig.json
```

### `caffd9b` — Implement auth, Web Research Agent #001, credit refunds, and WebSocket real-time logs

- Time: 2026-09-07T15:00:50+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/caffd9bd5ff4a07b96cbbbfc484dc47b5c00418d
- Parents: `2b3bc75`
- Intent / implemented scope: Implement auth, Web Research Agent #001, credit refunds, and WebSocket real-time logs

Recorded commit notes (historical claims):


Verification paths changed: `src/agents/web-research.test.ts`, `src/auth/service.test.ts`, `src/orchestrator/executor.test.ts`, `src/realtime/execution-stream.test.ts`, `src/security/password.test.ts`, `src/server/app.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env
M	.env.example
M	README.md
M	package-lock.json
M	package.json
A	src/agents/index.ts
A	src/agents/web-research.test.ts
A	src/agents/web-research.ts
A	src/app.ts
A	src/auth/index.ts
A	src/auth/service.test.ts
A	src/auth/service.ts
M	src/config/env.ts
M	src/db/repositories.ts
M	src/index.ts
A	src/orchestrator/executor.test.ts
A	src/orchestrator/executor.ts
A	src/realtime/execution-stream.test.ts
A	src/realtime/execution-stream.ts
A	src/routes/agents.ts
A	src/routes/auth.ts
A	src/routes/me.ts
A	src/routes/tasks.ts
A	src/security/index.ts
A	src/security/jwt.ts
A	src/security/password.test.ts
A	src/security/password.ts
A	src/server/app.test.ts
A	src/server/http.ts
A	src/server/middleware/auth.ts
A	src/server/middleware/validation.ts
A	src/test-support/research-fixture.ts
```

### `ee36707` — AKBARAL!: production platform - registry, orchestrator, tools, factory, marketplace, CRM, mobile, web app

- Time: 2026-09-07T16:26:41+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/ee367072806eba8ad2b438bc145ab09f14bc0465
- Parents: `caffd9b`
- Intent / implemented scope: AKBARAL!: production platform - registry, orchestrator, tools, factory, marketplace, CRM, mobile, web app

Recorded commit notes (historical claims):


Verification paths changed: `src/db/business.test.ts`, `src/db/database.test.ts`, `src/orchestrator/executor.test.ts`, `src/orchestrator/factory.test.ts`, `src/realtime/execution-stream.test.ts`, `src/server/app.test.ts`, `src/tools/tools.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
A	Dockerfile
M	README.md
A	db/migrations/0002_platform.sql
A	db/migrations/0003_business.sql
A	docs/deployment.md
A	docs/production-readiness.md
A	mobile/App.tsx
A	mobile/app.json
A	mobile/package.json
A	mobile/src/api/client.ts
A	mobile/src/screens/AgentsScreen.tsx
A	mobile/src/screens/BillingScreen.tsx
A	mobile/src/screens/DashboardScreen.tsx
A	mobile/src/screens/LoginScreen.tsx
A	mobile/src/screens/MasterScreen.tsx
A	mobile/src/screens/SettingsScreen.tsx
A	mobile/src/screens/WorkspaceScreen.tsx
A	mobile/tsconfig.json
M	package-lock.json
M	package.json
A	public/app.js
A	public/index.html
A	public/styles.css
A	scripts/backup.sh
A	scripts/entrypoint.sh
A	src/agents/catalog.ts
A	src/agents/registry.ts
M	src/app.ts
M	src/auth/service.ts
A	src/billing/service.ts
A	src/db/business-repositories.ts
A	src/db/business.test.ts
M	src/db/constants.ts
M	src/db/database.test.ts
M	src/db/index.ts
A	src/db/platform-repositories.ts
M	src/db/repositories.ts
M	src/db/seed.ts
M	src/index.ts
A	src/models/catalog.ts
A	src/models/client.ts
A	src/models/index.ts
A	src/models/router.ts
A	src/orchestrator/agent-factory.ts
M	src/orchestrator/executor.test.ts
M	src/orchestrator/executor.ts
A	src/orchestrator/factory.test.ts
A	src/orchestrator/planner.ts
A	src/orchestrator/workflow-runner.ts
M	src/realtime/execution-stream.test.ts
A	src/routes/admin.ts
M	src/routes/agents.ts
M	src/routes/auth.ts
A	src/routes/billing.ts
A	src/routes/crm.ts
A	src/routes/factory.ts
A	src/routes/files.ts
A	src/routes/marketplace.ts
M	src/routes/me.ts
A	src/routes/notifications.ts
A	src/routes/projects.ts
A	src/routes/realtime.ts
M	src/routes/tasks.ts
A	src/routes/tools.ts
A	src/routes/workflows.ts
A	src/security/webhooks.ts
M	src/server/app.test.ts
A	src/server/middleware/observability.ts
A	src/server/middleware/rate-limit.ts
A	src/server/middleware/rbac.ts
A	src/services/files.ts
A	src/tools/index.ts
A	src/tools/registry.ts
A	src/tools/tools.test.ts
```

### `c5541c4` — AKBARAL!: final verification, realtime/SSE fixes, knowledge FTS cleanup migration, mobile typecheck

- Time: 2026-09-07T18:32:04+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/c5541c4bec56ba32c1d28ef96729ee61467a2cce
- Parents: `ee36707`
- Intent / implemented scope: AKBARAL!: final verification, realtime/SSE fixes, knowledge FTS cleanup migration, mobile typecheck

Recorded commit notes (historical claims):


Verification paths changed: `scripts/live-provider-server.ts`, `src/realtime/execution-stream.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
D	.env
M	.gitignore
A	db/migrations/0004_knowledge_fts_cleanup.sql
M	docs/production-readiness.md
A	mobile/package-lock.json
M	mobile/src/api/client.ts
A	scripts/live-provider-server.ts
A	scripts/ws-sse-verify.ts
M	src/db/platform-repositories.ts
M	src/db/repositories.ts
M	src/realtime/execution-stream.test.ts
M	src/realtime/execution-stream.ts
M	src/routes/files.ts
```

### `4851c24` — docs: record successful Android/iOS Metro exports for mobile

- Time: 2026-09-07T18:33:08+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/4851c24d0a0dfb602670de5a72694b549caf3257
- Parents: `c5541c4`
- Intent / implemented scope: docs: record successful Android/iOS Metro exports for mobile

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/production-readiness.md
```

### `1a2572d` — Production hardening: SSRF, tenant isolation, WS/SSE auth, mobile fixes, audit tooling

- Time: 2026-09-07T18:51:26+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/1a2572d3db00748d579e1f5ad8c431463fbda5fc
- Parents: `4851c24`
- Intent / implemented scope: Production hardening: SSRF, tenant isolation, WS/SSE auth, mobile fixes, audit tooling

Recorded commit notes (historical claims):


Verification paths changed: `scripts/audit-registry.ts`, `src/models/router.test.ts`, `src/realtime/execution-stream.test.ts`, `src/tools/tools.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
M	Dockerfile
A	FINAL_PRODUCTION_CHECKLIST.md
M	README.md
M	docs/production-readiness.md
A	mobile/.env.example
M	mobile/app.json
M	package.json
M	public/app.js
A	scripts/audit-registry.ts
M	scripts/ws-sse-verify.ts
M	src/agents/registry.ts
M	src/agents/web-research.ts
M	src/config/env.ts
M	src/db/repositories.ts
M	src/models/catalog.ts
A	src/models/router.test.ts
M	src/models/router.ts
M	src/orchestrator/agent-factory.ts
M	src/realtime/execution-stream.test.ts
M	src/realtime/execution-stream.ts
M	src/routes/crm.ts
M	src/routes/factory.ts
M	src/routes/realtime.ts
M	src/routes/tasks.ts
M	src/routes/tools.ts
A	src/security/ssrf.ts
M	src/services/files.ts
M	src/test-support/research-fixture.ts
M	src/tools/registry.ts
M	src/tools/tools.test.ts
```

### `e1d94a4` — Verified production readiness: auth error mapping, model provider_not_configured, upload persistence, final readiness report

- Time: 2026-09-07T19:05:47+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e1d94a4a6328e7bb93f02d5045cbd9369d2ec2f5
- Parents: `1a2572d`
- Intent / implemented scope: Verified production readiness: auth error mapping, model provider_not_configured, upload persistence, final readiness report

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	README.md
A	docs/FINAL_PRODUCTION_READINESS.md
M	src/auth/service.ts
M	src/models/catalog.ts
M	src/services/files.ts
```

### `156e1e0` — Production audit hardening: real emergency-stop, seed idempotence, prod secret guard, deployment healthcheck

- Time: 2026-09-07T19:23:23+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/156e1e0915b6f0a82b1f7323889e9a38ac1c50d0
- Parents: `e1d94a4`
- Intent / implemented scope: Production audit hardening: real emergency-stop, seed idempotence, prod secret guard, deployment healthcheck

Recorded commit notes (historical claims):

> - Emergency stop now actually rejects new work (503) and never consumes credits; admin can clear it via /system/resume, with a matching SPA button.
> - db:seed preserves operator-disabled model/provider status instead of re-enabling them.
> - Production refuses to start with a missing or placeholder SESSION_SECRET.
> - Dockerfile gains a real /api/health HEALTHCHECK.
> - Orchestrator test covers emergency-stop credit safety; live E2E confirms 503 then 202 after resume.
> - Final production readiness + checklist updated.
>

Verification paths changed: `scripts/audit-registry.ts`, `src/auth/service.test.ts`, `src/orchestrator/executor.test.ts`, `src/realtime/execution-stream.test.ts`, `src/server/app.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	Dockerfile
M	FINAL_PRODUCTION_CHECKLIST.md
M	docs/FINAL_PRODUCTION_READINESS.md
M	mobile/src/api/client.ts
M	public/app.js
M	public/index.html
M	scripts/audit-registry.ts
M	src/agents/web-research.ts
M	src/auth/service.test.ts
M	src/auth/service.ts
M	src/db/platform-repositories.ts
M	src/db/repositories.ts
M	src/index.ts
M	src/models/catalog.ts
M	src/orchestrator/executor.test.ts
M	src/orchestrator/executor.ts
M	src/realtime/execution-stream.test.ts
M	src/realtime/execution-stream.ts
M	src/routes/admin.ts
M	src/routes/auth.ts
M	src/routes/factory.ts
M	src/routes/tasks.ts
M	src/routes/workflows.ts
M	src/server/app.test.ts
M	src/server/http.ts
M	src/server/middleware/auth.ts
```

### `df4aa42` — Record live knowledge index/search id-shape verification

- Time: 2026-09-07T19:23:55+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/df4aa42da18925b19bbf5156e5636b1a08ccbbd3
- Parents: `156e1e0`
- Intent / implemented scope: Record live knowledge index/search id-shape verification

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	FINAL_PRODUCTION_CHECKLIST.md
M	docs/FINAL_PRODUCTION_READINESS.md
```

### `e25a2d9` — Production configuration system: validated env, redacted secrets, safe admin status

- Time: 2026-09-07T20:14:08+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e25a2d93b4e14250071ba53c029163d83c5f3861
- Parents: `df4aa42`
- Intent / implemented scope: Production configuration system: validated env, redacted secrets, safe admin status

Recorded commit notes (historical claims):

> - Central env config validates NODE_ENV/PORT/DATABASE_URL/HOST/AKBARAL_UPLOAD_DIR and requires an explicit >=32-char SESSION_SECRET in production; dev/test auto-generate a crypto-random secret.
> - Admin-only GET /api/admin/config/status reports configured booleans + required env-var NAMES, never values; admin /models and oauth/providers sanitized.
> - Shared outbound HTTP helper adds timeouts, safe/redacted provider errors, and never echoes provider bodies.
> - SMTP client implemented (TLS/STARTTLS, AUTH PLAIN/LOGIN, timeout, safe failures); password reset + email verification + campaign send use it and return provider_not_configured with required names when SMTP is missing.
> - AKBARAL_ALLOW_PRIVATE_PROVIDER can no longer open arbitrary private source URLs; source URLs must be public or on the trusted provider host.
> - Upload paths are confined: storage keys reject traversal/separators/absolute paths before any FS path is built.
> - Added secret scanner, updated .env.example to safe placeholders, .dockerignore, README and checklist.
> - Full gate: typecheck/build/test/scan/db:migrate/db:seed/audit:registry pass.
>

Verification paths changed: `src/agents/web-research.test.ts`, `src/config/env.test.ts`, `src/integrations/smtp.test.ts`, `src/server/app.test.ts`, `src/tools/tools.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.dockerignore
M	.env.example
M	FINAL_PRODUCTION_CHECKLIST.md
M	README.md
M	package.json
A	scripts/scan-secrets.ts
M	src/agents/web-research.test.ts
M	src/agents/web-research.ts
M	src/app.ts
A	src/config/credentials.ts
M	src/config/env.test.ts
M	src/config/env.ts
A	src/config/secrets.ts
M	src/db/business-repositories.ts
M	src/db/reset.ts
M	src/index.ts
A	src/integrations/http.ts
A	src/integrations/smtp.test.ts
A	src/integrations/smtp.ts
M	src/models/client.ts
M	src/routes/admin.ts
M	src/routes/auth.ts
M	src/routes/crm.ts
M	src/security/ssrf.ts
M	src/server/app.test.ts
M	src/server/http.ts
M	src/services/files.ts
M	src/tools/registry.ts
M	src/tools/tools.test.ts
```

### `0824fee` — Correct multi-credential metadata for Shopify/Twilio/Razorpay

- Time: 2026-09-07T20:15:29+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/0824feec6ceee77bdc5800ea89fe8cc7595a99a7
- Parents: `e25a2d9`
- Intent / implemented scope: Correct multi-credential metadata for Shopify/Twilio/Razorpay

Recorded commit notes (historical claims):

> - Tool catalog now carries all required env-var names for Shopify (store domain + token) and Twilio (SID + auth token).
> - Billing service checks Razorpay's real credential pair (RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET) and returns requiredCredentials names on provider_not_configured.
>

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/billing/service.ts
M	src/models/catalog.ts
```

## Day 2 — 2026-09-08

### `33290a5` — Redesign AKBARAL web and mobile UX to premium futuristic platform standard

- Time: 2026-09-08T04:00:59+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/33290a52492c2feb11fa7c3c69c02975a1b84c7b
- Parents: `0824fee`
- Intent / implemented scope: Redesign AKBARAL web and mobile UX to premium futuristic platform standard

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	UI_REDESIGN_REPORT.md
M	mobile/App.tsx
A	mobile/src/components/ui.tsx
M	mobile/src/screens/AgentsScreen.tsx
M	mobile/src/screens/BillingScreen.tsx
M	mobile/src/screens/DashboardScreen.tsx
M	mobile/src/screens/LoginScreen.tsx
M	mobile/src/screens/MasterScreen.tsx
M	mobile/src/screens/SettingsScreen.tsx
M	mobile/src/screens/WorkspaceScreen.tsx
A	mobile/src/theme.ts
M	public/app.js
M	public/index.html
M	public/styles.css
```

### `20fdbe6` — Production hardening: trust/feedback, pool-aware credits, private-agent access control, SSRF redirects, rate-limit bypass guard, prompt-injection defense

- Time: 2026-09-08T04:23:31+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/20fdbe6a5384bc99728802053222780652535234
- Parents: `33290a5`
- Intent / implemented scope: Production hardening: trust/feedback, pool-aware credits, private-agent access control, SSRF redirects, rate-limit bypass guard, prompt-injection defense

Recorded commit notes (historical claims):


Verification paths changed: `src/agents/access.test.ts`, `src/db/trust.test.ts`, `src/server/middleware/rate-limit.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
M	README.md
A	db/migrations/0005_trust_feedback.sql
M	docs/FINAL_PRODUCTION_READINESS.md
M	docs/deployment.md
M	public/app.js
M	public/index.html
A	src/agents/access.test.ts
M	src/agents/registry.ts
M	src/agents/web-research.ts
M	src/app.ts
M	src/auth/service.ts
M	src/billing/service.ts
M	src/config/credentials.ts
M	src/config/env.ts
M	src/db/index.ts
M	src/db/platform-repositories.ts
M	src/db/repositories.ts
A	src/db/trust-repositories.ts
A	src/db/trust.test.ts
M	src/index.ts
M	src/orchestrator/agent-factory.ts
M	src/orchestrator/executor.ts
M	src/orchestrator/planner.ts
M	src/routes/admin.ts
M	src/routes/agents.ts
M	src/routes/auth.ts
M	src/routes/factory.ts
M	src/routes/marketplace.ts
M	src/routes/me.ts
A	src/routes/trust.ts
M	src/server/http.ts
A	src/server/middleware/rate-limit.test.ts
M	src/server/middleware/rate-limit.ts
```

### `f58fb63` — Premium redesign: elite landing + motion system, refined robot, upgraded mobile UX

- Time: 2026-09-08T04:46:31+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/f58fb63dedd7fc0614dd365223c6da61d061a39b
- Parents: `20fdbe6`
- Intent / implemented scope: Premium redesign: elite landing + motion system, refined robot, upgraded mobile UX

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	mobile/src/components/ui.tsx
M	mobile/src/screens/DashboardScreen.tsx
M	mobile/src/screens/LoginScreen.tsx
M	mobile/src/screens/MasterScreen.tsx
M	mobile/src/theme.ts
M	public/app.js
M	public/index.html
M	public/styles.css
```

### `cd63ef0` — Fix blank preview: safe storage fallback and no-JS reveal fallback for sandboxed preview

- Time: 2026-09-08T05:14:05+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/cd63ef05a136d41f4a588d743b30699d03bbbb7f
- Parents: `f58fb63`
- Intent / implemented scope: Fix blank preview: safe storage fallback and no-JS reveal fallback for sandboxed preview

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/app.js
M	public/styles.css
```

### `7a3a073` — Cache-bust premium assets and force no-store HTML so redesign is never stale

- Time: 2026-09-08T05:21:49+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/7a3a07338f9deca37d4d7c5619a1ee6c8a17a169
- Parents: `cd63ef0`
- Intent / implemented scope: Cache-bust premium assets and force no-store HTML so redesign is never stale

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/index.html
M	src/app.ts
```

### `59359dc` — Consolidate production root to ONE authoritative premium landing; always render it at #/ with real app routes intact

- Time: 2026-09-08T05:29:13+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/59359dc6819305dd6e76ce9ea47182b58a1316ea
- Parents: `7a3a073`
- Intent / implemented scope: Consolidate production root to ONE authoritative premium landing; always render it at #/ with real app routes intact

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/app.js
```

### `7dccbb1` — Make premium landing the complete authoritative root: Creative AI, integrations, section nav, refreshed robot presentation

- Time: 2026-09-08T05:46:35+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/7dccbb19f0d08079a065eba4154316b36ece9e37
- Parents: `59359dc`
- Intent / implemented scope: Make premium landing the complete authoritative root: Creative AI, integrations, section nav, refreshed robot presentation

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/app.js
M	public/index.html
M	public/styles.css
```

### `6020a55` — Make src/app/page.tsx the real / renderer and rebuild the premium AKBARAL landing as v3 (orchestration core, no old robot, light-first, real routes)

- Time: 2026-09-08T06:13:26+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/6020a550f3d71577e196b116b305201df451d82e
- Parents: `7dccbb1`
- Intent / implemented scope: Make src/app/page.tsx the real / renderer and rebuild the premium AKBARAL landing as v3 (orchestration core, no old robot, light-first, real routes)

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/app.js
D	public/index.html
M	public/styles.css
M	src/app.ts
A	src/app/page.tsx
M	tsconfig.json
```

### `58c27a7` — Convert active frontend to Next.js 16 App Router page.tsx; premium AKBARAL homepage at / with real API proxying

- Time: 2026-09-08T06:24:58+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/58c27a7475f711de49a06c591fb2b199107de7f4
- Parents: `6020a55`
- Intent / implemented scope: Convert active frontend to Next.js 16 App Router page.tsx; premium AKBARAL homepage at / with real API proxying

Recorded commit notes (historical claims):


Verification paths changed: `src/config/env.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.gitignore
A	next-env.d.ts
A	next.config.mjs
M	package-lock.json
M	package.json
A	scripts/start-dev.mjs
A	scripts/start-prod.mjs
M	src/app.ts
A	src/app/layout.tsx
M	src/app/page.tsx
M	src/config/env.test.ts
A	tsconfig.backend.json
M	tsconfig.json
```

### `b5571cf` — Restore full premium v3 stylesheet after robot-cleanup regression; keeps all landing, responsive, reduced-motion styles

- Time: 2026-09-08T06:28:05+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/b5571cfd4c4aacf102f207ad5b4cbee0edb192f8
- Parents: `58c27a7`
- Intent / implemented scope: Restore full premium v3 stylesheet after robot-cleanup regression; keeps all landing, responsive, reduced-motion styles

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/styles.css
```

### `e4bde93` — Add Log in / Start free navbar actions to Next.js homepage

- Time: 2026-09-08T06:39:55+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e4bde9352c9afe054c756c31444f2b44510636a9
- Parents: `b5571cf`
- Intent / implemented scope: Add Log in / Start free navbar actions to Next.js homepage

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app/page.tsx
```

### `546cb61` — Rewrite Next.js page as native React JSX component (no dangerouslySetInnerHTML/renderPage); clean duplicate viewport

- Time: 2026-09-08T06:51:24+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/546cb617023845a16bf67b0eead2b8520136c747
- Parents: `e4bde93`
- Intent / implemented scope: Rewrite Next.js page as native React JSX component (no dangerouslySetInnerHTML/renderPage); clean duplicate viewport

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app/layout.tsx
M	src/app/page.tsx
```

### `a2f3a1e` — Bump root layout asset cache to premium-v4 after native JSX page conversion

- Time: 2026-09-08T06:54:17+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a2f3a1e647f783f34c52f60620034ae7144fddf8
- Parents: `546cb61`
- Intent / implemented scope: Bump root layout asset cache to premium-v4 after native JSX page conversion

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app/layout.tsx
```

### `bdd643b` — Bump premium assets to v5 after clean Next.js rebuild verification

- Time: 2026-09-08T07:03:03+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/bdd643b7f4645b344613cb0566e33d6a709f4ff5
- Parents: `a2f3a1e`
- Intent / implemented scope: Bump premium assets to v5 after clean Next.js rebuild verification

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app/layout.tsx
```

### `b53794d` — Fix Turbopack page module format and rebuild full premium homepage as native React JSX

- Time: 2026-09-08T07:17:07+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/b53794d1a2ed1eb06086819fc7512ca04c9d8292
- Parents: `bdd643b`
- Intent / implemented scope: Fix Turbopack page module format and rebuild full premium homepage as native React JSX

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	package.json
A	src/app/package.json
M	src/app/page.tsx
```

## Day 3 — 2026-09-09

### `b370b48` — Restore AKBARAL project from previous session state (b53794d, tree verbatim)

- Time: 2026-09-09T11:04:26+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/b370b487516c1b404dcf0bdd2c7403d3ea92d78c
- Parents: `6c3a544`
- Intent / implemented scope: Restore AKBARAL project from previous session state (b53794d, tree verbatim)

Recorded commit notes (historical claims):

> Requested commit 07d868c59b4a9ac1a3c88d461f5de97c59ae351f does not exist in this
> repository (verified locally and on GitHub, including all branches and tags).
> Restored the latest available state: tip of arena/01a07c3c-akbaral
> (b53794d1a2ed1eb06086819fc7512ca04c9d8292). Tree restored byte-identical,
> no code changes.
>

Verification paths changed: `scripts/audit-registry.ts`, `scripts/live-provider-server.ts`, `src/agents/access.test.ts`, `src/agents/web-research.test.ts`, `src/auth/service.test.ts`, `src/config/env.test.ts`, `src/db/business.test.ts`, `src/db/database.test.ts`, `src/db/trust.test.ts`, `src/integrations/smtp.test.ts`, `src/models/router.test.ts`, `src/orchestrator/executor.test.ts`, `src/orchestrator/factory.test.ts`, `src/realtime/execution-stream.test.ts`, `src/security/password.test.ts`, `src/server/app.test.ts`, `src/server/middleware/rate-limit.test.ts`, `src/tools/tools.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.dockerignore
A	.env.example
A	.gitignore
A	Dockerfile
A	FINAL_PRODUCTION_CHECKLIST.md
M	README.md
A	UI_REDESIGN_REPORT.md
A	db/migrations/0001_init.sql
A	db/migrations/0002_platform.sql
A	db/migrations/0003_business.sql
A	db/migrations/0004_knowledge_fts_cleanup.sql
A	db/migrations/0005_trust_feedback.sql
A	docs/FINAL_PRODUCTION_READINESS.md
A	docs/deployment.md
A	docs/production-readiness.md
A	mobile/.env.example
A	mobile/App.tsx
A	mobile/app.json
A	mobile/package-lock.json
A	mobile/package.json
A	mobile/src/api/client.ts
A	mobile/src/components/ui.tsx
A	mobile/src/screens/AgentsScreen.tsx
A	mobile/src/screens/BillingScreen.tsx
A	mobile/src/screens/DashboardScreen.tsx
A	mobile/src/screens/LoginScreen.tsx
A	mobile/src/screens/MasterScreen.tsx
A	mobile/src/screens/SettingsScreen.tsx
A	mobile/src/screens/WorkspaceScreen.tsx
A	mobile/src/theme.ts
A	mobile/tsconfig.json
A	next-env.d.ts
A	next.config.mjs
A	package-lock.json
A	package.json
A	public/app.js
A	public/styles.css
A	scripts/audit-registry.ts
A	scripts/backup.sh
A	scripts/entrypoint.sh
A	scripts/live-provider-server.ts
A	scripts/scan-secrets.ts
A	scripts/start-dev.mjs
A	scripts/start-prod.mjs
A	scripts/ws-sse-verify.ts
A	src/agents/access.test.ts
A	src/agents/catalog.ts
A	src/agents/index.ts
A	src/agents/registry.ts
A	src/agents/web-research.test.ts
A	src/agents/web-research.ts
A	src/app.ts
A	src/app/layout.tsx
A	src/app/package.json
A	src/app/page.tsx
A	src/auth/index.ts
A	src/auth/service.test.ts
A	src/auth/service.ts
A	src/billing/service.ts
A	src/config/credentials.ts
A	src/config/env.test.ts
A	src/config/env.ts
A	src/config/secrets.ts
A	src/db/business-repositories.ts
A	src/db/business.test.ts
A	src/db/constants.ts
A	src/db/database.test.ts
A	src/db/database.ts
A	src/db/id.ts
A	src/db/index.ts
A	src/db/migrate.ts
A	src/db/path.ts
A	src/db/platform-repositories.ts
A	src/db/repositories.ts
A	src/db/reset.ts
A	src/db/seed.ts
A	src/db/trust-repositories.ts
A	src/db/trust.test.ts
A	src/db/verify.ts
A	src/index.ts
A	src/integrations/http.ts
A	src/integrations/smtp.test.ts
A	src/integrations/smtp.ts
A	src/models/catalog.ts
A	src/models/client.ts
A	src/models/index.ts
A	src/models/router.test.ts
A	src/models/router.ts
A	src/orchestrator/agent-factory.ts
A	src/orchestrator/executor.test.ts
A	src/orchestrator/executor.ts
A	src/orchestrator/factory.test.ts
A	src/orchestrator/planner.ts
A	src/orchestrator/workflow-runner.ts
A	src/realtime/execution-stream.test.ts
A	src/realtime/execution-stream.ts
A	src/routes/admin.ts
A	src/routes/agents.ts
A	src/routes/auth.ts
A	src/routes/billing.ts
A	src/routes/crm.ts
A	src/routes/factory.ts
A	src/routes/files.ts
A	src/routes/marketplace.ts
A	src/routes/me.ts
A	src/routes/notifications.ts
A	src/routes/projects.ts
A	src/routes/realtime.ts
A	src/routes/tasks.ts
A	src/routes/tools.ts
A	src/routes/trust.ts
A	src/routes/workflows.ts
A	src/security/index.ts
A	src/security/jwt.ts
A	src/security/password.test.ts
A	src/security/password.ts
A	src/security/ssrf.ts
A	src/security/webhooks.ts
A	src/server/app.test.ts
A	src/server/http.ts
A	src/server/middleware/auth.ts
A	src/server/middleware/observability.ts
A	src/server/middleware/rate-limit.test.ts
A	src/server/middleware/rate-limit.ts
A	src/server/middleware/rbac.ts
A	src/server/middleware/validation.ts
A	src/services/files.ts
A	src/test-support/research-fixture.ts
A	src/tools/index.ts
A	src/tools/registry.ts
A	src/tools/tools.test.ts
A	tsconfig.backend.json
A	tsconfig.json
```

### `ac4fa35` — Milestone 1: real MASTER AI Orchestrator foundation

- Time: 2026-09-09T12:09:47+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/ac4fa35a4b995f0630318e4a5616c3a90bf7311a
- Parents: `b370b48`
- Intent / implemented scope: Milestone 1: real MASTER AI Orchestrator foundation

Recorded commit notes (historical claims):

> Full pipeline now real and honest at every stage:
> USER GOAL -> goal analysis -> plan -> tools -> execution -> verification
> -> synthesized FINAL RESULT.
>
> - Goal analyzer (src/orchestrator/goal-analyzer.ts): LLM-driven analysis via
>   the model router with strict JSON validation against the real registry
>   (invented categories/roles dropped), deterministic heuristic fallback, mode
>   always disclosed, clarifying questions for ambiguous goals.
> - Verifier (src/orchestrator/verifier.ts): replaces the previous fake
>   'Verification passed' log. Hard contract checks (non-empty, substance,
>   no bare refusal, no fabricated citations without source tools) + soft
>   checks (goal addressed, declared outputs) + optional LLM rubric pass.
>   Failed verification fails the task and refunds the free credit.
> - Synthesizer (src/orchestrator/synthesizer.ts): final-result document
>   (executive summary, verified per-step sections, next steps, credit
>   accounting); LLM synthesis when configured, honest deterministic assembly
>   otherwise.
> - Planner v1: scored specialist selection (role + goal-term overlap with
>   specialization/capabilities/outputs), plan persisted to plan_json,
>   consumes goal analysis.
> - Executor v1: bounded best-effort tool stage (web_search/knowledge_search,
>   honest unavailability logging, never fatal), real verification integrated,
>   verification block stored in execution output.
> - Workflow runner v1: step->task linkage, aggregated credit accounting,
>   synthesized final result persisted to result_json.
> - POST /api/master + GET /api/master/:id: one-shot pipeline entry point.
> - Provider base-URL overrides (OPENAI_BASE_URL etc.) for proxies/Azure/
>   self-hosted endpoints.
> - Boot self-heals an incomplete agent registry (4,000 specialists).
> - Tests: 96 pass (27 new unit + 4 full-pipeline integration tests incl.
>   honest-failure refund path and fixture-provider green path). Typecheck and
>   production build clean. Live endpoint verification recorded in
>   docs/ROADMAP.md.
>

Verification paths changed: `src/orchestrator/goal-analyzer.test.ts`, `src/orchestrator/master-flow.test.ts`, `src/orchestrator/synthesizer.test.ts`, `src/orchestrator/verifier.test.ts`, `src/server/app.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
A	docs/ROADMAP.md
M	next-env.d.ts
M	src/agents/catalog.ts
M	src/app.ts
M	src/db/platform-repositories.ts
M	src/index.ts
M	src/models/client.ts
M	src/orchestrator/executor.ts
A	src/orchestrator/goal-analyzer.test.ts
A	src/orchestrator/goal-analyzer.ts
A	src/orchestrator/master-flow.test.ts
M	src/orchestrator/planner.ts
A	src/orchestrator/synthesizer.test.ts
A	src/orchestrator/synthesizer.ts
A	src/orchestrator/verifier.test.ts
A	src/orchestrator/verifier.ts
M	src/orchestrator/workflow-runner.ts
A	src/routes/master.ts
M	src/server/app.test.ts
A	src/test-support/model-provider-fixture.ts
```

### `a8437b9` — Restore M2 + M3 stage 1 work after sandbox re-provision

- Time: 2026-09-09T13:31:12+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a8437b9a1bdef04241a92fe7e5336539c12817a6
- Parents: `ac4fa35`
- Intent / implemented scope: Restore M2 + M3 stage 1 work after sandbox re-provision

Recorded commit notes (historical claims):

> The sandbox was re-cloned (git objects for local commit 2de504d were lost;
> the remote branch tip was ac4fa35). This commit restores the exact working
> tree from the preserved workspace snapshot, which contains:
>
> Milestone 2 (registry scale-out):
> - relevance-ranked agent search with hyphen-insensitive multi-term ranking
> - word-boundary intent matching in the goal analyzer
> - registry integrity summary in GET /api/admin/stats
>
> Milestone 3 stage 1 (execution/runtime):
> - crash recovery: boot-time reconciliation of non-terminal workflows/steps/
>   tasks/executions with honest errors and exactly-once credit refunds
>
> Plus: docs/ROADMAP.md with the full audit + milestone verification records.
> Tests for this state previously passed 107/107 (to be re-verified after
> reinstalling dependencies).
>

Verification paths changed: `src/agents/registry.test.ts`, `src/orchestrator/goal-analyzer.test.ts`, `src/orchestrator/recovery.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/ROADMAP.md
A	src/agents/registry.test.ts
M	src/agents/registry.ts
M	src/index.ts
M	src/orchestrator/goal-analyzer.test.ts
M	src/orchestrator/goal-analyzer.ts
A	src/orchestrator/recovery.test.ts
A	src/orchestrator/recovery.ts
M	src/routes/admin.ts
```

### `8a6f767` — M3: production execution engine — persistent queue, retries, timeouts, cancellation

- Time: 2026-09-09T14:02:52+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/8a6f767c39b68845009ab1aef8cac8220ee5bce7
- Parents: `a8437b9`
- Intent / implemented scope: M3: production execution engine — persistent queue, retries, timeouts, cancellation

Recorded commit notes (historical claims):

> - ExecutionQueue (src/orchestrator/queue.ts): DB-backed jobs with worker
>   locks, claim-based concurrency, idempotency keys, exponential-backoff
>   retries (retryable failures only), per-step + overall workflow timeouts,
>   user/admin cancellation, WS/SSE status pushes, crash-safe reconciliation
> - workflow-runner: resume support, per-step timeout race, cancellation
>   probes, guarded final status writes (abandoned runs cannot resurrect
>   terminal state)
> - recovery.ts: job-aware boot recovery (stale worker requeue or honest
>   fail + exactly-once refund); legacy orphan sweep unchanged
> - New routes: POST /api/tasks/:id/cancel, /api/workflows/:id/cancel,
>   GET /api/admin/queue/jobs, POST /api/admin/queue/cancel-all,
>   POST /api/admin/tasks/:id/cancel; tasks/workflows/master now enqueue
> - Migration 0006_execution_queue.sql with lookup indexes
> - Trust policy invariant: every unsuccessful terminal path refunds exactly
>   once (guard-verified); tests: 16 new queue tests, full suite 123/123
>
> Verified: typecheck clean, production build green, live red-path
> (provider_not_configured permanent, no retry, refund), cancel conflict
> 409, admin queue stats, simulated dead-worker boot recovery
>

Verification paths changed: `src/orchestrator/queue.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
A	db/migrations/0006_execution_queue.sql
M	docs/ROADMAP.md
M	src/app.ts
M	src/config/env.ts
M	src/db/index.ts
M	src/db/platform-repositories.ts
A	src/db/queue-repositories.ts
M	src/db/repositories.ts
A	src/orchestrator/errors.ts
M	src/orchestrator/executor.ts
A	src/orchestrator/queue.test.ts
A	src/orchestrator/queue.ts
M	src/orchestrator/recovery.ts
A	src/orchestrator/task-reconciler.ts
M	src/orchestrator/workflow-runner.ts
M	src/routes/admin.ts
M	src/routes/master.ts
M	src/routes/tasks.ts
M	src/routes/workflows.ts
M	src/test-support/model-provider-fixture.ts
```

### `5326968` — M4: tool/API/provider catalog — credentials, streaming, health

- Time: 2026-09-09T14:17:24+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/53269688b74c8f1339c750d4d8b2e65762f23016
- Parents: `8a6f767`
- Intent / implemented scope: M4: tool/API/provider catalog — credentials, streaming, health

Recorded commit notes (historical claims):

> - 4 new real local tools (http_request SSRF-guarded, json_transform,
>   text_analyze, csv_parse) + catalog sync; tool_input_error surfaced honestly
> - GET /api/tools/credentials: per-tool env-key status (values never exposed)
> - GET /api/models: catalog with truthful availability + required env keys
> - POST /api/models/route: routing decision + fallback chain preview (no call)
> - Native SSE streamChat for OpenAI/Anthropic/Google adapters (per-chunk
>   timeouts, redacted errors) + modelRouter.completeStreaming with fallback
>   chain and run recording; POST /api/models/chat/stream SSE endpoint —
>   unconfigured providers end with honest provider_not_configured
> - GET /api/admin/providers/health: DB-derived run stats per provider +
>   optional ?live=1 real models-list ping with honest failure details
> - Model fixture now supports OpenAI-compatible streaming chunks
>
> Tests: 15 new (src/models/models-api.test.ts), full suite 138/138 green;
> typecheck clean; production build green; all endpoints live-verified
>

Verification paths changed: `src/models/models-api.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/ROADMAP.md
M	src/app.ts
M	src/integrations/http.ts
M	src/models/catalog.ts
M	src/models/client.ts
A	src/models/models-api.test.ts
M	src/models/router.ts
M	src/routes/admin.ts
A	src/routes/models.ts
M	src/routes/tools.ts
M	src/test-support/model-provider-fixture.ts
M	src/tools/registry.ts
```

### `b6a0911` — M5: workspace/files/projects — membership, attachments, knowledge scope, artifacts

- Time: 2026-09-09T14:37:38+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/b6a091146c80914c081254383f02da893dfc1ef6
- Parents: `5326968`
- Intent / implemented scope: M5: workspace/files/projects — membership, attachments, knowledge scope, artifacts

Recorded commit notes (historical claims):

> - Workspace membership (owner/admin/member/viewer) enforced on project
>   reads, uploads, membership management; 404 isolation for non-members;
>   immutable owner; self-leave; invite notifications; my_role in listings
> - Task file attachments: attach/detach/list with ownership validation;
>   attached text injected into agent execution as bounded user-data context
> - Project-scoped knowledge search across all members (FTS), personal
>   search unchanged
> - Artifact storage: verified task outputs persisted as downloadable,
>   sha256-addressed, idempotent files (kind=artifact) on both agent and
>   web-research completion paths; GET /api/projects/:id/artifacts
> - PATCH /api/projects/:id (name/description/archive)
>
> Tests: 9 new (src/routes/workspace.test.ts), full suite 147/147 green;
> typecheck clean; build green; live-verified on the dev server
>

Verification paths changed: `src/routes/workspace.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/ROADMAP.md
M	src/db/platform-repositories.ts
M	src/orchestrator/executor.ts
M	src/routes/files.ts
M	src/routes/projects.ts
M	src/routes/tasks.ts
A	src/routes/workspace.test.ts
M	src/services/files.ts
```

### `148b73b` — M6: Agent Factory — template derivation, sandboxed benchmarks

- Time: 2026-09-09T14:57:49+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/148b73b37e98886311d9356781b2dd2ebd599408
- Parents: `b6a0911`
- Intent / implemented scope: M6: Agent Factory — template derivation, sandboxed benchmarks

Recorded commit notes (historical claims):

> - GET /api/factory/templates: search the 4,000-agent registry matrix
>   (name/specialization via json_extract, category filter, platform agents only)
> - GET /api/factory/templates/:slug: complete derived spec with templateOf
>   provenance; POST /api/factory/agents/from-template: owned, versioned custom
>   agent with user overrides and provenance persisted in config
> - POST /api/factory/agents/:slug/benchmark: real sandboxed benchmark runs
>   through the verified pipeline (type=test tasks, no credit consumption) with
>   honest aggregation (pass rate, avg verification score, per-run latency,
>   explicit providerNotConfigured — never fabricated scores)
> - Fixed slug-normalization bypass: generated slugs round-trip through
>   slugify so the duplicate check cannot be bypassed via case differences
>
> Tests: 6 new (src/orchestrator/factory-templates.test.ts), full suite
> 153/153 green; typecheck clean; build green; live-verified
>

Verification paths changed: `src/orchestrator/factory-templates.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/ROADMAP.md
M	src/orchestrator/agent-factory.ts
A	src/orchestrator/factory-templates.test.ts
M	src/routes/factory.ts
```

### `e6d8e35` — M7: Agent World + Marketplace — reviews, real-signal discovery, world surface

- Time: 2026-09-09T15:22:16+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e6d8e35fb6acbe5eee57056b410c4a687bbc90f2
- Parents: `148b73b`
- Intent / implemented scope: M7: Agent World + Marketplace — reviews, real-signal discovery, world surface

Recorded commit notes (historical claims):

> - Migration 0007_agent_reviews (1-5 CHECK, UNIQUE user+agent, update trigger)
> - POST /api/marketplace/:slug/rate: upsert with honest aggregate recompute
>   (AVG/COUNT from real reviews); GET :slug/reviews with myReview
> - Install accounting: install_count increments once per user (removed the
>   pre-existing double increment in createAgentOrder); repeat installs keep
>   saved but never force favorites
> - GET /api/marketplace/featured + /trending?days=: ranking from real usage
>   signals only (installs, reviews, completed executions, window velocity)
> - Agent World: GET /api/world?q= (saved/installed agents with real per-user
>   task usage), POST :slug/favorite toggle, DELETE :slug removal
> - Unpublished custom agents: invisible to non-owners (404), explicit
>   agent_not_published conflict for the owner (403)
>
> Tests: 8 new (src/routes/marketplace-world.test.ts), full suite 161/161
> green; typecheck clean; build green; all flows live-verified
>

Verification paths changed: `src/routes/marketplace-world.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations/0007_agent_reviews.sql
M	docs/ROADMAP.md
A	repro-m7.ts
M	src/app.ts
M	src/db/platform-repositories.ts
A	src/routes/marketplace-world.test.ts
M	src/routes/marketplace.ts
A	src/routes/world.ts
```

### `f46f604` — M8: trial/credits/billing — providers, invoices, refunds, webhook settlement (178/178)

- Time: 2026-09-09T16:43:35+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/f46f604daa8eb52e92d7b496cc01a0b4242bff78
- Parents: `e6d8e35`
- Intent / implemented scope: M8: trial/credits/billing — providers, invoices, refunds, webhook settlement (178/178)

Recorded commit notes (historical claims):

> - src/billing/providers.ts: real Stripe Checkout Sessions + Razorpay Orders
>   via externalHttpRequest (PKR, provider base-url overrides, 20s timeout,
>   PaymentProviderError, no credential leakage); unconfigured providers keep
>   the honest 402 provider_not_configured naming the missing credential.
> - POST /api/billing/credits is async (providerReference + checkoutUrl);
>   GET /api/billing/usage?from&to (default 30d) real aggregates;
>   GET /api/billing/invoices/:id/pdf owner-only PDF (dependency-free PDF 1.4
>   generator, valid xref/%%EOF, attachment filename, outsider 404).
> - Migration 0008_billing_hardening: processed_billing_events (PK provider+
>   provider_event_id) for duplicate-webhook protection + billing indexes.
> - handleWebhookEvent dispatcher with claimBillingEvent dedup BEFORE side
>   effects: invoice.paid / payment.failed / invoice.refunded /
>   payment.refunded / subscription.cancelled; honest effects vocabulary
>   (settled, already_paid, already_refunded, not_payable, not_paid,
>   payment_marked_failed, no_pending_payment, invoice_not_found,
>   ignored_duplicate, subscription_cancelled, recorded).
> - SECURITY FIX (found live, regression-tested): settleInvoicePayment and
>   admin settleManualPayment now refuse to settle refunded/cancelled/void
>   invoices — a replayed invoice.paid on a refunded invoice previously
>   re-marked it paid and re-granted reversed credits (double grant); now
>   already_refunded / 409 with zero re-grant.
> - Refunds reverse credits atomically (paid pool clamped at 0, reversal
>   ledger row); replays and refunds of never-paid invoices are no-ops.
> - Webhooks: timing-safe X-AKBARAL-Signature HMAC required; Razorpay also
>   requires X-Razorpay-Signature (raw-body HMAC with RAZORPAY_KEY_SECRET).
> - GET /api/admin/billing/overview (admin-only): revenue incl. monthly
>   breakdown, refunded/outstanding, provider model costs, gross margin $/%,
>   credit flows, subscriptions by plan, trial→paid conversion, failed
>   payments, marketplace volume/commission (AKBARAL_MARKETPLACE_COMMISSION_BPS).
> - env: marketplaceCommissionBps (0-5000, default 1000); .env.example
>   billing/provider sections.
> - Tests: src/billing/billing.test.ts 17/17 incl. trust-policy regression
>   (consume-on-success only, refund-on-failure, requires_pro no-consumption)
>   and the refunded-invoice re-payment guard; full suite 178/178, typecheck
>   clean, build green. Live-verified end to end on the dev server.
>

Verification paths changed: `src/billing/billing.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
A	db/migrations/0008_billing_hardening.sql
M	docs/ROADMAP.md
A	src/billing/billing.test.ts
A	src/billing/invoice-pdf.ts
A	src/billing/providers.ts
M	src/billing/service.ts
M	src/config/env.ts
M	src/db/platform-repositories.ts
M	src/routes/admin.ts
M	src/routes/billing.ts
M	src/security/webhooks.ts
```

### `e7b3984` — M9: security/admin/observability hardening — attack-surface suite 14/14 (192/192)

- Time: 2026-09-09T18:16:08+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e7b39842b729fbf1e4f034ee91eff03cee6b5098
- Parents: `f46f604`
- Intent / implemented scope: M9: security/admin/observability hardening — attack-surface suite 14/14 (192/192)

Recorded commit notes (historical claims):

> - jwt.ts: pin alg (reject alg:none headers outright), validate typ,
>   constant-time signature compare (timingSafeEqual); expired/wrong-secret
>   tokens rejected.
> - Session-secret rotation grace via SESSION_SECRET_PREVIOUS: prior secret
>   stays valid for one token lifetime so rotation does not hard-logout
>   active sessions (.env.example documented).
> - Per-account login brute-force lockout: 10 failures / 15 min counted from
>   durable security_logs -> 429 login_rate_limited + retryAfterSeconds, also
>   blocks correct passwords during the window, other accounts unaffected,
>   generic failure messages (no user enumeration), lockout logged critical.
> - countRecentSecurityEvents repo helper (indexed on security_logs
>   user_id+created_at).
> - GET /api/admin/audit?actor&action&from&to&limit&offset: admin-only audit
>   search over admin_actions with real filters, newest-first, bounded pages,
>   actor email joined. Feature-flag updates now audited
>   (feature_flag.updated).
> - FIX src/routes/files.ts: multer errors (File too large etc.) were thrown
>   from an async stream callback Express never sees -> request hung 300s and
>   the error became an uncaughtException. All upload failures now route via
>   next(): 400 upload_failed in ~100ms live.
> - src/security/attack-surface.test.ts (14 tests against the real in-process
>   API/guards): JWT forgery/tamper/expiry, rotation grace, register role
>   ignored + admin 403/401, per-account lockout, cross-tenant IDOR (project/
>   execution/invoice/file 404s), SSRF rejections, path traversal, malicious
>   uploads, secret leakage (config/login/logs), audit filters, concurrent
>   duplicate-webhook race (8 parallel -> exactly 1 settle), credit
>   manipulation rejected, X-Forwarded-For rate-limit spoofing contained.
> - Full suite 192/192, typecheck clean, build green. Live-verified: rotation
>   grace with pre-rotation token, lockout 429 w/ retryAfterSeconds 900,
>   audit search, 26MiB upload 400 in 97ms, traversal filename contained.
>
> (re-committed after sandbox re-provision wiped local git objects; content
> identical to the verified 1bd51ad tree)
>

Verification paths changed: `src/security/attack-surface.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
M	docs/ROADMAP.md
M	src/auth/service.ts
M	src/config/env.ts
M	src/db/platform-repositories.ts
M	src/db/repositories.ts
M	src/routes/admin.ts
M	src/routes/files.ts
A	src/security/attack-surface.test.ts
M	src/security/jwt.ts
```

### `bd2a64d` — M10: production deployment/scaling — probes, verified backups, metrics (200/200)

- Time: 2026-09-09T18:38:57+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/bd2a64d9152335eadcc74f4ed732ab38f1cc9516
- Parents: `e7b3984`
- Intent / implemented scope: M10: production deployment/scaling — probes, verified backups, metrics (200/200)

Recorded commit notes (historical claims):

> - Real probes: GET /api/health now performs an actual DB round trip (the
>   old payload reported database:'ok' unconditionally); 503 degraded when
>   the DB is down. GET /api/ready verifies database + migrations currency
>   (files vs _migrations) + uploads writability + queue worker liveness;
>   orchestrators gate traffic on it.
> - GET /api/metrics (admin-only): Prometheus text format 0.0.4 from real
>   measurements — process uptime/RSS/heap, 5m HTTP request rate + avg
>   duration from system_metrics, queue jobs by status (canonical statuses
>   always emit; 0 for empty), active workers, DB size, business counters.
> - Verified backups (src/scripts/backup-db.ts, npm run db:backup): VACUUM
>   INTO online-consistent snapshot; independent verification (integrity_check
>   + row counts vs live for users/tasks/agents/invoices/credit_transactions/
>   projects); failed verification deletes the artifact and exits non-zero;
>   sha256 + retention keep-N. Replaces the unsafe cp-based backup.sh (now a
>   delegating wrapper).
> - Verified restore (src/scripts/restore-db.ts, npm run db:restore):
>   integrity-only verification at restore time (live DB has legitimately
>   diverged — drift comparison belongs at backup time), refuses corrupt
>   files, safety snapshot of current DB, atomic rename + WAL sidecar
>   cleanup, restart required (documented).
> - Dockerfile: runtime image now ships the full stack (.next + dist +
>   next.config.mjs were missing — production image had no web build);
>   healthcheck on /api/ready; nightly verified backup cron at 01:17 UTC
>   with retention (env-tunable, disableable).
> - FIX scripts/start-prod.mjs: API ran with NODE_ENV=development in
>   production, silently relaxing the SESSION_SECRET startup guard — now
>   production.
> - docker-compose.production.yml: single-node composition (restart policy,
>   resource limits, log rotation, env-file secrets, named volume) with the
>   honest single-node scaling story — no faked horizontal scaling.
> - Graceful shutdown drains the execution queue before HTTP/DB close.
> - docs/DEPLOYMENT.md: full honest runbook (architecture, first deploy,
>   env, probes, backup/restore + drill, off-host backup note, scaling
>   table launch-vs-POST-LAUNCH, security ops, launch checklist).
> - Tests +8: backup.test.ts (verified snapshot, corrupt/drift rejection,
>   retention, full restore round-trip), health.test.ts (real liveness,
>   readiness checks, pending-migration honesty, metrics auth + format).
>   Full suite 200/200, typecheck clean, build green.
> - Live-verified: /api/health + /api/ready all-green, metrics 401/403/200
>   with real values (4000 agents, 4 users), backup while serving (36MB,
>   integrity ok), retention pruning, corrupt-restore refused
>   ('database disk image is malformed'), full restore drill (5->4 users,
>   post-backup row rolled back, safety snapshot kept, restart -> ready),
>   SIGTERM shows 'execution queue stopped'.
>

Verification paths changed: `src/scripts/backup.test.ts`, `src/server/health.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	Dockerfile
A	docker-compose.production.yml
A	docs/DEPLOYMENT.md
M	docs/ROADMAP.md
M	package.json
M	scripts/backup.sh
M	scripts/entrypoint.sh
M	scripts/start-prod.mjs
M	src/app.ts
M	src/index.ts
A	src/scripts/backup-db.ts
A	src/scripts/backup.test.ts
A	src/scripts/restore-db.ts
A	src/server/health.test.ts
A	src/server/health.ts
```

### `b33267a` — M11: launch-readiness QA — GO verdict; flagship agent seed fix (200/200)

- Time: 2026-09-09T18:50:38+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/b33267ae2545c31e6d772a54450a7d2cfa2eb15f
- Parents: `bd2a64d`
- Intent / implemented scope: M11: launch-readiness QA — GO verdict; flagship agent seed fix (200/200)

Recorded commit notes (historical claims):

> - LAUNCH BLOCKER FIXED: web-research-001 (Agent #001, the orchestrator's
>   research specialist) was absent from fresh seeds — it only existed after
>   the first research task lazily created it OWNED BY THAT USER, invisible
>   to everyone else in discovery. Now a first-class platform-owned catalog
>   definition (WEB_RESEARCH_AGENT_DEFINITION in catalog.ts), synced by every
>   seed/boot: registry 4001 agents, research category 51. Registry test
>   updated to the new truth; live-verified GET /api/agents/web-research-001
>   200 + searchable by normal users on a fresh boot.
> - docs/LAUNCH_READINESS.md: honest full-platform classification — 11 areas
>   LAUNCH READY (with evidence), 6 PARTIALLY READY with exact missing
>   dependencies (provider keys, SMTP, web deep-wiring, monitoring hookup,
>   off-host backups, TLS termination), 8 POST-LAUNCH explicitly not claimed
>   (multi-node, distributed queue, zero-downtime deploys, OAuth, mobile
>   shell, automation/AI employees, social connectors, metrics token).
>   Verdict: GO for 18 Sep 2026 contingent on docs/DEPLOYMENT.md checklist.
> - Live QA evidence: 23-endpoint smoke pass (all green after flagship fix);
>   end-to-end research task COMPLETED via the real pipeline (2418-char
>   report, 6 logs, credits consumed 5->4 exactly once) and the honest-
>   failure path (sandbox blocks outbound web: task failed, credits refunded
>   5->5); backups/restore/probes/metrics re-verified during the pass.
> - Full suite 200/200, typecheck clean, build green.
>

Verification paths changed: `src/agents/registry.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	src/agents/catalog.ts
M	src/agents/registry.test.ts
```

### `154258f` — Production-readiness pass: fix live UI/API contract bugs + honest AdSense readiness

- Time: 2026-09-09T19:38:07+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/154258feb4d3706ba004fe7856e2e125a44d2cc0
- Parents: `b33267a`
- Intent / implemented scope: Production-readiness pass: fix live UI/API contract bugs + honest AdSense readiness

Recorded commit notes (historical claims):

> Client contract fixes (found by auditing every SPA loader against the live API):
> - MASTER flow rewritten: plan.workflow.id, run->poll GET /api/workflows/:id
>   with per-step status, terminal result/error, credit refresh; specialist
>   dispatch reads task.executionId; plan preview shows step goals
> - loadAdmin unwraps {stats} wrapper (all stats were rendering undefined)
> - Trial UI uses trial.active + computes days from trialEndsAt (isActive/
>   daysRemaining never existed); fixed in pill, dashboard, billing, settings
> - Single-flight refresh lock + cross-tab storage sync + revocation cleanup
>   (concurrent 401-retries killed each other under strict refresh rotation;
>   observed live from a real browser session, fixed and verified with a
>   5-way concurrent 401-storm simulation)
> - Bounded execution polling (10-miss guard)
>
> AdSense readiness (honest by construction):
> - Privacy policy discloses cookies/advertising truthfully; About + Contact
>   added to footer with real content
> - Consent banner + clearly-labelled single ad slot activate ONLY when
>   AKBARAL_ADSENSE_CLIENT is set AND accepted; otherwise no script, no
>   banner, no slots, honest ads.txt 404
> - Ad choices footer control exists only on configured deployments
>
> QA at close: 200/200 tests, tsc clean, production build green, fresh
> server, live verification of auth/billing/feedback/knowledge/marketplace/
> admin shapes and homepage markers.

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	public/app.js
M	public/styles.css
A	src/app/ads.txt/route.ts
M	src/app/layout.tsx
M	src/app/page.tsx
```

### `28a3598` — Cinematic visual transformation: luxury AI operating system across the entire product

- Time: 2026-09-09T20:08:17+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/28a3598a9029c80f54eb9360bf2413d9aef5b143
- Parents: `154258f`
- Intent / implemented scope: Cinematic visual transformation: luxury AI operating system across the entire product

Recorded commit notes (historical claims):

> Complete premium visual/UI/UX transformation (fully original design and
> assets, no third-party material):
>
> - New design system (styles.css rewrite): near-black cinematic tones,
>   muted olive/moss/antique-gold accents, warm off-white editorial type
>   (Space Grotesk + Inter), hairline borders, fine technical grids, glass
>   surfaces, restrained radii; dark default + functional light theme,
>   applied uniformly to landing, auth and all 10 app screens
> - Cinematic hero: full-bleed background-video slot architecture —
>   <video> with original poster + ORIGINAL canvas intelligence-network
>   animation fallback + still poster for reduced-motion/no-JS/mobile;
>   production video placement documented (public/media/hero-loop.mp4,
>   see docs/DESIGN.md); zero layout shift; live system status chip from
>   real /api/health
> - Scroll narrative: chapter rail with active tracking, reveal system,
>   self-drawing pipeline spine, staggered trace/lab rows, real-number
>   counters (4001 agents / 80 disciplines), parallax, magnetic CTAs,
>   hero cursor reticle — all gated by prefers-reduced-motion and paused
>   off-screen/hidden-tab
> - Sections: 9-stage MASTER pipeline, Agent World with real registry
>   categories/counts, Agent Factory laboratory, honestly-labeled
>   execution trace, security-first trust grid (implemented controls
>   only), honest pricing with locked trial/credit rules, final CTA
> - Fixed pre-existing bug: data-kicker eyebrow labels never rendered
>   (attribute never read) — now rendered via CSS attr()
> - Dev preview: allowedDevOrigins for sandbox preview host
> - AdSense architecture unchanged and still honest (inert until
>   configured + consented)
>
> Safety: full ID-parity audit against the previous page (all SPA
> bindings preserved; only 4 unreferenced legacy marketing sections
> removed). QA: 200/200 tests, tsc clean, production build green, fresh
> server, live verification of markers/assets/flows/health.

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	docs/DESIGN.md
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	next.config.mjs
M	public/app.js
A	public/media/hero-poster.jpg
M	public/styles.css
M	src/app/layout.tsx
M	src/app/page.tsx
```

## Day 4 — 2026-09-10

### `cd6e373` — Fix preview hydration/script errors; M12 chunk 1: web task center with live execution logs

- Time: 2026-09-10T06:37:21+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/cd6e373e3d24e4a2f4d6121475b6c804cb6afc98
- Parents: `28a3598`
- Intent / implemented scope: Fix preview hydration/script errors; M12 chunk 1: web task center with live execution logs

Recorded commit notes (historical claims):

> Preview error fixes (root-caused from the dev log's React diff):
> - SPA bootstrap ran before React hydration and mutated the DOM (html js
>   class, theme attrs, footer year, reveal classes, hero canvas sizing,
>   injected pricing cards) causing hydration-mismatch errors and a client
>   re-render. Bootstrap now waits for window load + double rAF (4s safety
>   valve); zero module-level DOM mutations remain.
> - suppressHydrationWarning on <html> + pre-paint theme snippet
>   (next-themes pattern) removes the light-theme flash.
> - Hero video detection: server-rendered existence flag replaces the HEAD
>   probe (no more 404 console noise on every visit).
> - Clipboard errors verified as preview-environment noise (zero clipboard
>   references in served code).
>
> M12 web task center:
> - Dashboard task rows deep-link to #/tasks/:id detail view: counters,
>   result payload, error panel, executions, event timeline, log console
> - Live logs: WebSocket /ws/executions/:id?token= (new /ws/* proxy rewrite)
>   with SSE fallback /api/executions/:id/events?token= — SSE now accepts
>   the access token via query param (EventSource cannot send headers),
>   mirroring the WS auth pattern; streams close on view change; both
>   channels live-verified through the web port
>
> Test hermeticity (real defect found by the suite):
> - billing honest-failure path now clears research-provider env so local
>   .env fixture wiring cannot make it succeed; 200/200, tsc clean, build
>   green. Ops note: keep provider endpoints off .env and TRUST_PROXY=0
>   when running the suite (rate-limit spoofing test enforces it).

Verification paths changed: `src/billing/billing.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/DESIGN.md
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	next.config.mjs
M	public/app.js
M	public/styles.css
M	src/app/layout.tsx
M	src/app/page.tsx
M	src/billing/billing.test.ts
M	src/routes/realtime.ts
```

### `c2cc283` — Eliminate React-rendered scripts and all pre-hydration DOM mutations

- Time: 2026-09-10T08:43:38+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/c2cc2834d09f2740b09f02391b86d28b476e61af
- Parents: `cd6e373`
- Intent / implemented scope: Eliminate React-rendered scripts and all pre-hydration DOM mutations

Recorded commit notes (historical claims):

> Live preview logs showed React 19 concurrent/streaming hydration can
> still be mid-flight when the window load event fires, so the load-gated
> SPA bootstrap could still mutate the DOM before hydration finished
> (is-visible classes, theme aria-label, hero canvas sizing, injected
> pricing cards) — the exact mismatches the log captured.
>
> Final architecture (design unchanged):
> - layout.tsx: ALL React-rendered scripts removed — no inline theme
>   snippet, no inline hero-video/AdSense window flags, no raw <script src>
> - SPA bundle loads via next/script afterInteractive: Next.js injects it
>   only after hydration completes, making pre-hydration mutations from
>   app.js structurally impossible (bundle is not present in the page
>   before then); the internal load-gate remains as defense in depth
> - Server->client flags travel as <meta> tags (akbaral-hero-video,
>   akbaral-adsense-client) — pure data, no execution, no mutation; app.js
>   reads them via meta selectors
> - Pre-paint theme snippet removed: the server renders the dark identity
>   and boot() applies the stored theme strictly post-hydration
> - suppressHydrationWarning removed from <html> (no longer needed —
>   nothing pre-hydration touches the tree)
>
> QA: 200/200 tests, tsc clean, production build green, fresh dev server;
> served HTML verified: zero inline config scripts, meta flags correct,
> afterInteractive RSC payload for app.js v4, all design markers intact,
> API/auth/preview-host 200.

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/DESIGN.md
M	docs/ROADMAP.md
M	public/app.js
M	src/app/layout.tsx
```

### `ee922ee` — Fix legal modal blocking preview: restore [hidden] display guard

- Time: 2026-09-10T10:55:44+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/ee922ee0c82e7400ec53fbfc34fa54853c89600e
- Parents: `c2cc283`
- Intent / implemented scope: Fix legal modal blocking preview: restore [hidden] display guard

Recorded commit notes (historical claims):

> The redesign had dropped the old .modal-scrim[hidden] { display:none }
> guard, so the author display:grid rule overrode the hidden attribute:
> the legal/privacy overlay rendered on every page load and the close
> button (which correctly sets modal.hidden = true) had no visual effect.
>
> Single global fix: [hidden] { display: none !important; } — restores
> native hidden-attribute semantics for every JS toggle in the app (legal
> modal, auth name field, login/logout buttons, admin nav link). No design
> or content change (styles cache-bumped to cinematic-v4).
>
> Verified: tsc clean, production build green, served CSS contains the
> guard, modal markup untouched, web+api 200.

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/ROADMAP.md
M	public/styles.css
M	src/app/layout.tsx
```

### `52d6413` — Responsive pass: eliminate horizontal overflow causes at 320-1920px; fix cross-tab auth rotation ping-pong

- Time: 2026-09-10T11:30:05+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/52d6413463b095d5b8786e698f8a8183e8af9f17
- Parents: `ee922ee`
- Intent / implemented scope: Responsive pass: eliminate horizontal overflow causes at 320-1920px; fix cross-tab auth rotation ping-pong

Recorded commit notes (historical claims):

> Responsive (real causes fixed, no global hiding; design unchanged):
> - overflow-wrap:anywhere on all data-bearing text (agent names/specializations,
>   list titles/ids/emails, stat values, readouts, toasts, trace goal, log
>   messages) — 'anywhere' participates in min-content sizing so grids/flex
>   rows can actually shrink; log-msg upgraded from word-break
> - flex-wrap on eyebrow kickers, factory readout lines, trace head
> - badge: max-width + ellipsis (nowrap can no longer blow out a row)
> - world-stats: repeat(auto-fit,minmax(200px,1fr)) — 3-up on tablets
> - hero-title <=560: vw-driven floor (clamp(2rem,9.5vw,3.2rem))
> - 16px input floor <=560 (prevents iOS focus auto-zoom)
> - form-row stacks vertically <=560; roomier modal padding <=560
> - log-console: horizontal scroll contained inside its own box
> - pointer:coarse hit-area bumps (rail buttons, nav links, list rows)
> - verified per-viewport math: 320/360/375/390/414/430/768/1024/1440/1920 —
>   every grid floor fits its container at 320px; no fixed width exceeds
>   container; pre/log/rail scroll internally only
>
> Auth fix (root-caused from today's live logs: 20+ cycle /api/me 401 ->
> /refresh 200 -> /api/me 401 loop with two tabs open):
> - the server revokes the previous session on every refresh, instantly
>   invalidating the other tab's access token; both tabs kept rotating each
>   other's sessions forever (storage-event sync kept supplying the newest
>   refresh token to rotate with)
> - fix: on 401, if storage already holds a DIFFERENT access token than the
>   one that failed, adopt it and retry — rotate only when genuinely stale
>
> QA: 200/200 tests, tsc clean, production build green, fresh server,
> served v5 assets verified.

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/app.js
M	public/styles.css
M	src/app/layout.tsx
```

### `70a13ea` — M12 complete: mobile task center with live SSE logs, deep links, Expo push notifications

- Time: 2026-09-10T12:06:26+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/70a13eae26cb3f2ea3ed3fa927a24adba9e06498
- Parents: `52d6413`
- Intent / implemented scope: M12 complete: mobile task center with live SSE logs, deep links, Expo push notifications

Recorded commit notes (historical claims):

> Server:
> - migration 0009_mobile_push.sql: device_tokens table (per-user, unique
>   token, revocable, indexed)
> - device-token repository: idempotent upsert (re-registration refreshes
>   metadata and re-owns the token after re-login), per-user revocation,
>   active-token listing
> - src/push/expo-push.ts: real Expo push-service dispatch (endpoint
>   overridable via AKBARAL_EXPO_PUSH_URL, 5s timeout, batched, per-ticket
>   results). Failures are logged and reported honestly — never faked and
>   never allowed to affect task execution.
> - src/push/notify.ts: task-finished fan-out — in-app notification row +
>   best-effort push. Hooks: executor completion (generic agents + web
>   research), task reconciler failure path (covers queue/retry/cancel
>   classifications), crash-recovery orphan tasks.
> - routes: POST /api/notifications/device (auth + validation), DELETE
>   /api/notifications/device/:token (owner-only revocation)
>
> Mobile:
> - TasksScreen: task center + detail (task/events/executions/logs/output),
>   tappable dashboard tasks, refresh
> - services/sse.ts: dependency-free SSE client over XMLHttpRequest
>   incremental onprogress (RN fetch cannot stream) consuming the same
>   /api/executions/:id/events?token= channel as the web task center;
>   dedupe by log id, 500-line cap, live indicator, 5s polling while
>   non-terminal, cleanup on unmount/terminal
> - services/push.ts: permission request -> Expo push token -> device
>   registration; honest failure reasons surfaced on the dashboard (iOS
>   simulator / missing EAS projectId); unregister on logout
> - App: Tasks tab, akbaral://tasks/:id deep links via react-navigation
>   linking config, notification-tap routing, push registration after login
> - client: del()/url()/getAccessToken() helpers
>
> QA: 206/206 tests (6 new in src/push/push.test.ts), tsc clean (server +
> mobile), production build green, live E2E on dev stack (device registered
> -> completion + failure notifications with refund message -> push
> dispatched with akbaral://tasks/:id deep link -> SSE frames verified ->
> unregister 204/404/revoked). ROADMAP.md + LAUNCH_READINESS.md updated.
>

Verification paths changed: `src/push/push.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations/0009_mobile_push.sql
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	mobile/App.tsx
M	mobile/package-lock.json
M	mobile/package.json
M	mobile/src/api/client.ts
M	mobile/src/screens/DashboardScreen.tsx
A	mobile/src/screens/TasksScreen.tsx
A	mobile/src/services/push.ts
A	mobile/src/services/sse.ts
M	src/db/platform-repositories.ts
M	src/orchestrator/executor.ts
M	src/orchestrator/recovery.ts
M	src/orchestrator/task-reconciler.ts
A	src/push/expo-push.ts
A	src/push/notify.ts
A	src/push/push.test.ts
M	src/routes/notifications.ts
```

### `5ba9f53` — Automation & scheduled workflows: durable scheduling engine on the MASTER orchestrator

- Time: 2026-09-10T13:49:27+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/5ba9f53d6d67cdd3bc42b823f7f9047214ff1bbe
- Parents: `70a13ea`
- Intent / implemented scope: Automation & scheduled workflows: durable scheduling engine on the MASTER orchestrator

Recorded commit notes (historical claims):

> Engine (src/automation/):
> - cron.ts: dependency-free 5-field cron subset (no ambiguous ranges/lists),
>   IANA timezone matching via Intl; DST-aware (spring-forward gaps skipped,
>   fall-back resolves to first occurrence); next-occurrence search
> - scheduler.ts: 1s durable tick; fires due automations exactly once per
>   occurrence (UNIQUE idempotency key on automation_runs — restart/race
>   safe), advances schedules without backfilling missed occurrences,
>   reconciles open runs against authoritative queue state, re-fires jobless
>   runs with bounded attempts, enforces per-automation timeouts via graceful
>   queue cancellation, evaluates server-side conditions
>   (last_run_outcome, min_interval_since_last_run), auto-pauses on
>   exhausted credits with notification + audit
> - validate.ts: strict server-side validation (schedules, agents visibility,
>   tools, steps, conditions, limits)
>
> Execution: occurrences become persisted workflows with per-step goals
> chained via depends_on, running through the existing execution queue —
> registry checks, atomic credits (consume-on-success, refund on failure/
> cancel/timeout), transient-error retries with backoff, per-job timeout
> override, cancellation.
>
> API (routes/automations.ts): CRUD + pause/resume + manual run (cooldown) +
> run history + run cancel. requireAuth everywhere, tenant isolation (404),
> per-IP rate limits, 25-active-per-account cap, audit log on every action.
>
> Legacy: 0003 CRM automations skeleton preserved behind a cohort filter
> (schedule_json IS NULL) — /api/crm/automations unchanged, invisible to the
> scheduler.
>
> Notifications (push/automation-notify.ts): run-level summaries + attention
> events through the M12 in-app + Expo push system with
> akbaral://automations/:id deep links.
>
> Clients: web view #/automations (create/list/manage/run history, assets
> cinematic-v6) + mobile AutomationsScreen (create, pause/resume/run/delete,
> runs; deep-link routing from push; entry behind the Tasks tab).
>
> Migration 0010_automation.sql: automations rebuilt (trigger_key nullable),
> automation_runs (UNIQUE idempotency), workflow_steps.goal.
>
> QA: 235/235 tests (11 cron/timezone + 18 end-to-end integration tests:
> scheduled fire -> agent execution -> verified result -> notification;
> failure/refund; transient retry recovery; timeout; cancellation; duplicate
> protection; timezone math; auth; tenant isolation; validation; conditions;
> auto-pause; cooldown; crash recovery; account caps; CRM cohort isolation).
> tsc clean (server + mobile), production build green, live E2E verified on
> the dev stack (Karachi cron 04:30Z, one-shot fire through web-research
> agent, honest failure + refund, mid-flight cancel + refund, duplicate
> rejection, orphan recovery to completion, audit entries, push delivery).
>

Verification paths changed: `src/automation/automation.test.ts`, `src/automation/cron.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations/0010_automation.sql
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	mobile/App.tsx
M	mobile/src/api/client.ts
A	mobile/src/screens/AutomationsScreen.tsx
M	mobile/src/screens/TasksScreen.tsx
M	mobile/src/services/push.ts
M	public/app.js
M	src/app.ts
M	src/app/layout.tsx
M	src/app/page.tsx
A	src/automation/automation.test.ts
A	src/automation/cron.test.ts
A	src/automation/cron.ts
A	src/automation/scheduler.ts
A	src/automation/validate.ts
A	src/db/automation-repositories.ts
M	src/db/index.ts
M	src/db/platform-repositories.ts
M	src/orchestrator/queue.ts
M	src/orchestrator/workflow-runner.ts
A	src/push/automation-notify.ts
A	src/routes/automations.ts
```

### `69f4948` — OAuth providers & account linking: real server-side flows for Google, GitHub, Microsoft, Apple

- Time: 2026-09-10T14:23:36+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/69f4948f8b6f0cf71ab4bccb4efdfcc93b4ec62e
- Parents: `5ba9f53`
- Intent / implemented scope: OAuth providers & account linking: real server-side flows for Google, GitHub, Microsoft, Apple

Recorded commit notes (historical claims):

> Security model (src/auth/oauth.ts):
> - 256-bit OAuth state stored HASHED server-side, single-use (guarded
>   consume), 10-min TTL, bound to provider+mode+user+redirect_uri+IP
> - PKCE S256 for every supporting provider; client secrets never leave the
>   server; Apple uses a real ES256 client-secret JWT (APPLE_PRIVATE_KEY) and
>   id_token verification against Apple JWKS via node:crypto
> - Takeover protection: auto-link by email ONLY for provider-verified emails
>   (Microsoft treated as unverified — Graph exposes no assertion); unverified
>   emails never attach to existing accounts; linking an identity owned by
>   another user is a 409 + critical security event
> - OAuth sessions are the same rotated refresh-token sessions as password
>   login; OAuth-provisioned accounts have no password until set
>
> API (src/routes/oauth.ts): GET /providers (honest configured state),
> GET /:provider/authorize (302), POST /:provider/link (authenticated),
> GET+POST /:provider/callback (Apple form_post), GET /identities,
> DELETE /identities/:provider (last-sign-in-method lockout). Per-IP rate
> limits; audit + security logs; tokens returned only in URL fragments.
>
> Clients: web provider buttons (configured-only) + #/oauth/callback fragment
> handler + Settings connected-accounts panel (assets cinematic-v7); mobile
> login screen provider buttons via system browser.
>
> Migration 0011: oauth_identities (UNIQUE provider identity -> one user) +
> oauth_states (hashed, single-use, expiring).
>
> QA: 253/253 tests (18 new OAuth integration tests against a spec-accurate
> fixture with real ES256 keys/JWKS/PKCE: login, provisioning, repeat login,
> verified-email autolink, unverified-email block, MS policy, Apple flow,
> link, link conflict, invalid/replayed/cross-provider/expired state,
> provider errors, auth required, tenant isolation, unlink protections,
> session rotation + revocation, rate limiting, honest 503/404, password
> login regression). tsc clean (server + mobile), production build green.
> Live E2E on the dev stack: full login -> provisioning -> session -> refresh
> rotation -> old token 401; positive link; conflict refusal (critical
> security log); invalid state; provider error; 401s; 503; unlink 204.
> No provider credentials exist in this deployment — all four report
> configured:false honestly until credentials are provided.
>

Verification paths changed: `src/auth/oauth.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations/0011_oauth_identities.sql
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	mobile/src/screens/LoginScreen.tsx
M	public/app.js
M	public/styles.css
M	src/app.ts
M	src/app/layout.tsx
M	src/app/page.tsx
A	src/auth/oauth.test.ts
A	src/auth/oauth.ts
M	src/db/index.ts
A	src/db/oauth-repositories.ts
M	src/routes/auth.ts
A	src/routes/oauth.ts
```

### `aa80651` — Unified AKBARAL! design system: one identity across web, Android, and future iOS

- Time: 2026-09-10T15:22:37+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/aa806518ca14d74cce7ae11f4e1d7f422d385349
- Parents: `69f4948`
- Intent / implemented scope: Unified AKBARAL! design system: one identity across web, Android, and future iOS

Recorded commit notes (historical claims):

> Single source of truth design-system/tokens.json + zero-dependency compiler
> (build.mjs) generating three committed consumers: public/tokens.css (web),
> mobile/src/theme.ts (Android), design-system/ios/AKBARALTheme.swift (future
> iOS — prepared tokens only, no fake app). design-system/README.md documents
> the full cross-platform contract.
>
> Identity: deep obsidian foundation (#06070f family), subtle indigo/violet
> atmosphere (#5d6ff0 -> #9d8cff), premium glass surfaces, cinematic lighting,
> hairline technical elegance.
>
> Web: hand-written tokens replaced by generated tokens.css (linked before
> styles.css, assets akbaral-ds-1); full migration off the warm gold/olive
> palette (buttons, glows, hero veil/vignette/outline type, auth atmosphere,
> agent-world, pipeline, pricing, CTA, scrollbar, selection, focus rings);
> hero canvas network re-tinted; new original AI-generated obsidian/indigo
> hero poster; new Automation landing chapter (rail 04: schedule chips +
> 5-node run lifecycle — real engine behavior); agent cards gained the shared
> agent sigil (deterministic indigo->violet monogram, identical formula on
> every platform — parity verified web vs mobile).
>
> Android (native mobile UX, same identity): theme.ts regenerated from
> tokens; ui.tsx rebuilt as the shared component library (gradient primary
> buttons with glow, sheened cards, pulsing status dots, shimmer skeletons,
> agent sigils, branded boot, reduce-motion-aware FadeIn/StatusDot/Skeleton);
> all 9 screens migrated; every screen inherits obsidian canvas + top indigo
> atmosphere; Login/Dashboard cinematic entrances; MASTER orb respects
> reduce-motion; expo-linear-gradient added (real Expo module); splash and
> adaptive icon aligned to obsidian; stat rows wrap safely at 320px.
>
> Status language unified across platforms: running/live -> pulsing cyan
> telemetry; queued/pending/planned/retrying -> amber; completed/active ->
> green; failed/blocked -> red; cancelled/paused/idle -> neutral.
>
> No functional changes: auth, OAuth, MASTER, agents, factory, Agent World,
> tasks, execution, verification, workspace, automation, notifications,
> billing/credits, security and APIs untouched.
>
> Verified: 253/253 tests, server tsc clean, mobile tsc clean, production
> build green, live stack (tokens served in correct order, automation
> section, login/me/agents 4,001/oauth providers functional, server log
> clean), sigil formula parity proven.
>

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	design-system/README.md
A	design-system/build.mjs
A	design-system/ios/AKBARALTheme.swift
A	design-system/tokens.json
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	mobile/App.tsx
M	mobile/app.json
M	mobile/package-lock.json
M	mobile/package.json
M	mobile/src/components/ui.tsx
M	mobile/src/screens/AgentsScreen.tsx
M	mobile/src/screens/AutomationsScreen.tsx
M	mobile/src/screens/BillingScreen.tsx
M	mobile/src/screens/DashboardScreen.tsx
M	mobile/src/screens/LoginScreen.tsx
M	mobile/src/screens/MasterScreen.tsx
M	mobile/src/screens/TasksScreen.tsx
M	mobile/src/screens/WorkspaceScreen.tsx
M	mobile/src/theme.ts
M	public/app.js
M	public/media/hero-poster.jpg
M	public/styles.css
A	public/tokens.css
M	src/app/layout.tsx
M	src/app/page.tsx
```

### `f7f2876` — Complete cinematic transformation: real hero film, premium loading identity, storytelling journey, USD pricing

- Time: 2026-09-10T16:17:36+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/f7f28767d9c29f18c3e07a4c64614d950fd4a935
- Parents: `aa80651`
- Intent / implemented scope: Complete cinematic transformation: real hero film, premium loading identity, storytelling journey, USD pricing

Recorded commit notes (historical claims):

> WEBSITE — full luxury presentation pass:
> - REAL cinematic hero video: public/media/hero-loop.mp4, 100% original
>   procedurally-rendered footage (obsidian space, indigo/violet nebula,
>   3D agent constellation with travelling data pulses, breathing core
>   orbs, horizon light, vignette; 1920x1080 30fps 12s mathematically
>   seamless loop, H.264 +faststart, 272KB). Poster extracted from the
>   film itself. Player: autoplay muted inline, poster as loading state,
>   canplay cross-dissolve, error/save-data/reduced-motion fallback to
>   the canvas network. Verified: 200 full + 206 range + meta flag.
> - Premium boot experience: #boot-veil (monogram, ring pulses, wordmark,
>   tagline, light sweep) — aria-hidden, pointer-events:none, CSS safety
>   dismissal without JS, reduced-motion aware. Same identity as Android.
> - Cinematic storytelling journey, 12 chapters with watermark numerals:
>   Intelligence manifesto (gradient typography + facts band) -> Master
>   Orchestrator (glowing pipeline progress head) -> Agent World ->
>   Thousands of Specialists (editorial discipline index, real registry
>   counts) -> Agent Factory -> Real Task Execution -> Automation ->
>   AI Employees (split layout, honest example roles) -> Workspace ->
>   Security & Verification -> Pricing -> Final CTA. Gradient emphasis
>   text, refined hovers, no card-grid monotony. Assets akbaral-lux-1.
>
> PRICING -> USD (model, not just symbol):
> - Plans re-priced /bin/bash / 0 Pro / 00 Enterprise (USD cents); currency
>   carried by the model everywhere it was hardcoded PKR: billing service,
>   providers (Stripe usd), invoice PDF $ formatting, marketplace
>   publish/install, CRM deals, registry seed, stripe tool default.
> - Migration 0012_currency_usd.sql (historical invoices keep their
>   original PKR label — they were PKR orders). Web: plans, invoices,
>   marketplace cards, admin revenue/cost stats, USD labels + quick
>   amounts $10/$50/$90/$200/$400. Mobile: plan cards + top-up field.
>
> ANDROID — same luxury level, native UX:
> - Branded BootVisual boot screen (rings, wordmark, sweep) crossfading
>   over pre-rendered UI — no white flash, no layout jump; native splash
>   image (original generated icon) on the same #06070f canvas in app.json.
> - MASTER orchestration flow strip: Goal->Plan->Agents->Tools->Verify->
>   Result with live pulsing stages (representation of the real pipeline,
>   no fabricated progress), reduce-motion aware.
> - Agent cards: category kickers + shared sigils. Billing in USD.
>
> Verified: 254/254 tests (new USD plan-catalog test; no tests removed),
> server tsc clean, mobile tsc clean, production build green, live stack:
> video 200/206 + poster, boot veil, 12-chapter journey in order, USD
> plans + manual order flow, agents 4,001, OAuth providers, clean server
> log, overflow audit clean 320-1920px. All production functionality
> preserved (auth, OAuth, orchestrator, agents, factory, Agent World,
> tasks, execution, verification, workspace, automation, notifications,
> billing, security, APIs).
>

Verification paths changed: `src/billing/billing.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations/0012_currency_usd.sql
M	design-system/README.md
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	docs/production-readiness.md
M	mobile/App.tsx
M	mobile/app.json
A	mobile/assets/splash-icon.png
M	mobile/src/screens/AgentsScreen.tsx
M	mobile/src/screens/BillingScreen.tsx
M	mobile/src/screens/MasterScreen.tsx
M	public/app.js
A	public/media/hero-loop.mp4
M	public/media/hero-poster.jpg
M	public/styles.css
M	src/agents/registry.ts
M	src/app/layout.tsx
M	src/app/page.tsx
M	src/billing/billing.test.ts
M	src/billing/invoice-pdf.ts
M	src/billing/providers.ts
M	src/billing/service.ts
M	src/db/business-repositories.ts
M	src/db/platform-repositories.ts
M	src/routes/marketplace.ts
M	src/tools/registry.ts
```

### `3c9c641` — Final luxury visual pass + complete six-tier USD pricing architecture

- Time: 2026-09-10T18:41:31+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/3c9c64105a129cf020cf954971fb03a32722a773
- Parents: `f7f2876`
- Intent / implemented scope: Final luxury visual pass + complete six-tier USD pricing architecture

Recorded commit notes (historical claims):

> PRICING (the complete professional model):
> - Six public tiers: Free Trial $0 / Starter $10 / Professional $50 /
>   Business $90 / Scale $200 / Enterprise $400, honest per-tier
>   credit/agent/workspace/seat allocations, plus custom manual credit
>   purchase ($10/$50/$90/$200/$400 quick amounts). 'pro' key kept
>   (subscriptions stay valid), publicly renamed Professional.
> - Migration 0013_pricing_tiers.sql (idempotent upserts, all USD);
>   ensureBootstrapPlans seeds all six on fresh DBs; new integration
>   test asserts the exact six-tier catalog, names, prices, order, USD.
> - Premium pricing UI: tier rail, display price, spec grid, restrained
>   CTA, Professional featured 'Most chosen'; responsive 3/2/1.
>
> WEB VISUAL LANGUAGE (refinement, not rebuild):
> - Editorial typography hierarchy: uppercase section headlines with
>   tighter tracking, refined body rhythm, wider eyebrow tracking.
> - Restrained premium navigation: tracked micro labels, quieter
>   inactive states, taller header, stronger wordmark.
> - Hero film integrated into the composition: top/bottom mask, side
>   bleed, scale framing — no video-box look. Video/poster/range/
>   fallback architecture untouched and re-verified.
> - MASTER pipeline now shows the full real architecture incl. the
>   Agent Router stage (10 stages, glowing progress spine).
> - Security chapter: architectural control ledger SEC-01..12 (mono
>   indices, hairline rows) replacing the card grid.
> - Agent World cards: category kickers + sigils; automations show
>   schedule-kind chips (CRON/INTERVAL/ONCE); Factory form as spec
>   sheet. Buttons: restrained glow.
>
> ANDROID ALIGNMENT: uppercase tracked header/tab chrome, billing plan
> cards with seats + Most chosen featured flag; all six tiers render
> from the live API.
>
> Verified: 254/254 tests, server tsc, mobile tsc, production build,
> node --check; live sweep: six USD plans sorted $0-$400, manual $10
> order pending, login/me/agents 4,001/master plan/tasks/automations/
> workspace/billing account/OAuth providers 200, hero video 200 + 206
> range + poster, boot veil, 11 chapters, 10 pipeline stages, 12
> control rows, zero PKR public, zero server errors, zero oversized
> fixed widths. No functionality removed or faked.
>

Verification paths changed: `src/billing/billing.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations/0013_pricing_tiers.sql
M	design-system/README.md
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	mobile/App.tsx
M	mobile/src/screens/BillingScreen.tsx
M	public/app.js
M	public/styles.css
M	src/app/layout.tsx
M	src/app/page.tsx
M	src/billing/billing.test.ts
M	src/db/platform-repositories.ts
```

### `ca015dd` — Safe animated execution-simulation console in the landing trace panel

- Time: 2026-09-10T19:13:16+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/ca015ddc0a437373daba21a6d40e2baa7cf55b99
- Parents: `3c9c641`
- Intent / implemented scope: Safe animated execution-simulation console in the landing trace panel

Recorded commit notes (historical claims):

> The black panel under the user goal ('Build me a complete launch
> strategy for my business') is now a premium AI execution-simulation
> console — a cinematic visual representation of a MASTER run.
>
> Security model (100% inert by construction):
> - Every displayed line is a plain string from a hardcoded local snippet
>   library (agents/tools/domains/markets), attached exclusively via
>   textContent. No eval, no new Function, no dynamic import, no
>   innerHTML, no network, no storage, no cookies, no secrets.
> - No connection to auth, database, payments or the real orchestrator;
>   all DOM writes confined to the console's own container.
> - Badged 'SIMULATION · PRESENTATION ONLY'; fabricates no business
>   results — shows the shape of a run (understand, plan, route,
>   research, synthesize, verify) and ends pointing to the real pipeline.
>
> Motion: character typing with humanized jitter + fading log lines +
> automatic upward scroll inside the container, blinking block caret,
> phase status bar with pulsing telemetry dot, restrained indigo/violet
> accents on obsidian. Randomized per load and per loop (verified 5/5
> distinct scripts). DOM capped at 48 lines; pauses off-screen
> (IntersectionObserver), on hidden tabs and route changes; stale timer
> chains invalidated by generation counter. Reduced motion renders a
> static snapshot (no loop, no caret blink).
>
> Responsive: 300px stream desktop, 216px + smaller type on mobile;
> pre-wrap + overflow-wrap anywhere => zero horizontal overflow
> 320-1920px. A11y: console role=region + aria-label; animated stream
> aria-hidden (decorative).
>
> Verified: module security audit (zero forbidden patterns, writes
> confined), Node execution harness on the real module (crash-free,
> all-strings, randomized), 254/254 tests, server tsc, mobile tsc,
> production build, node --check, live markup/asset checks, clean server
> log. Assets akbaral-lux-3. No APIs, schema, payments, registry or
> security architecture touched.
>

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	public/app.js
M	public/styles.css
M	src/app/layout.tsx
M	src/app/page.tsx
```

### `2572af9` — LUX-4 quiet-luxury identity: neutral obsidian palette, ivory primary actions, rebuilt navbar, recentered hero (web + Android)

- Time: 2026-09-10T20:28:53+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/2572af9c827d097a9cd5f5d27d03666369e39632
- Parents: `ca015dd`
- Intent / implemented scope: LUX-4 quiet-luxury identity: neutral obsidian palette, ivory primary actions, rebuilt navbar, recentered hero (web + Android)

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	design-system/README.md
M	design-system/build.mjs
M	design-system/ios/AKBARALTheme.swift
M	design-system/tokens.json
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	mobile/App.tsx
M	mobile/src/components/ui.tsx
M	mobile/src/screens/AgentsScreen.tsx
M	mobile/src/screens/LoginScreen.tsx
M	mobile/src/screens/WorkspaceScreen.tsx
M	mobile/src/services/push.ts
M	mobile/src/theme.ts
M	public/app.js
M	public/styles.css
M	public/tokens.css
M	src/app/layout.tsx
M	src/app/page.tsx
```

### `974fcd5` — GLASS-5 luxury glass reconstruction: single signature theme, layered atmosphere, 3-level glass system, floating navbar + glass drawer, recomposed hero/rail/surfaces (web + Android)

- Time: 2026-09-10T20:56:39+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/974fcd5a4181458059ee116408f16c79494b703f
- Parents: `2572af9`
- Intent / implemented scope: GLASS-5 luxury glass reconstruction: single signature theme, layered atmosphere, 3-level glass system, floating navbar + glass drawer, recomposed hero/rail/surfaces (web + Android)

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	design-system/README.md
M	design-system/build.mjs
M	design-system/ios/AKBARALTheme.swift
M	design-system/tokens.json
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	mobile/App.tsx
M	mobile/src/components/ui.tsx
M	mobile/src/screens/BillingScreen.tsx
M	mobile/src/theme.ts
M	public/app.js
M	public/styles.css
M	public/tokens.css
M	src/app/layout.tsx
M	src/app/page.tsx
```

### `ed8d7f4` — UI corrections: console density -37%, navbar without More dropdown (professional Log In/Start Building), glass footer nav strip, sixth billing principle (web + Android)

- Time: 2026-09-10T21:26:56+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/ed8d7f44b97117a26edb51f1e473ca0516be290b
- Parents: `974fcd5`
- Intent / implemented scope: UI corrections: console density -37%, navbar without More dropdown (professional Log In/Start Building), glass footer nav strip, sixth billing principle (web + Android)

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	mobile/src/screens/BillingScreen.tsx
M	public/app.js
M	public/styles.css
M	src/app/page.tsx
```

## Day 5 — 2026-09-11

### `e7e0efd` — Responsive UX reconstruction, browser-verified: 71 viewport checks zero overflow, nav specificity + hero overscan fixes, touch/type floors, safe areas, Android SafeAreaProvider, iOS responsive contract

- Time: 2026-09-11T08:00:45+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e7e0efd0f30de8bccfc6f2e6664b82c22145e1d8
- Parents: `ed8d7f4`
- Intent / implemented scope: Responsive UX reconstruction, browser-verified: 71 viewport checks zero overflow, nav specificity + hero overscan fixes, touch/type floors, safe areas, Android SafeAreaProvider, iOS responsive contract

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	design-system/README.md
M	design-system/tokens.json
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	mobile/App.tsx
M	mobile/src/screens/LoginScreen.tsx
M	public/styles.css
```

### `2b8f054` — SIGNATURE-7 visual reconstruction: component token layer (v4.0.0), editorial typography, hero horizon + measured display scale, MASTER command center, factory flow markers, agent/automation/billing refinement, Android alignment (browser-verified)

- Time: 2026-09-11T08:51:19+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/2b8f0541fc2cd38468fec00c3a818235f339fd42
- Parents: `e7e0efd`
- Intent / implemented scope: SIGNATURE-7 visual reconstruction: component token layer (v4.0.0), editorial typography, hero horizon + measured display scale, MASTER command center, factory flow markers, agent/automation/billing refinement, Android alignment (browser-verified)

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	design-system/README.md
M	design-system/build.mjs
M	design-system/ios/AKBARALTheme.swift
M	design-system/tokens.json
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	mobile/src/components/ui.tsx
M	public/styles.css
M	public/tokens.css
M	src/app/page.tsx
```

### `5e8b766` — Copy: shorten sixth trust principle to 'AKBARAL! shows task status, progress, and verification in real time.' (web + Android)

- Time: 2026-09-11T11:09:27+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/5e8b766e90b30b1652a48a051d85899bfd85c144
- Parents: `2b8f054`
- Intent / implemented scope: Copy: shorten sixth trust principle to 'AKBARAL! shows task status, progress, and verification in real time.' (web + Android)

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/ROADMAP.md
M	mobile/src/screens/BillingScreen.tsx
M	src/app/page.tsx
```

### `6fce7db` — Fix entrypoint backup-cron arithmetic for POSIX /bin/sh: epoch % 86400 replaces bash-only 10#HH form that crashed the nightly backup subshell under dash (found by production deployment rehearsal restart drill)

- Time: 2026-09-11T11:52:08+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/6fce7dbde4ba466d1e21b1381e96f241ceaaa552
- Parents: `5e8b766`
- Intent / implemented scope: Fix entrypoint backup-cron arithmetic for POSIX /bin/sh: epoch % 86400 replaces bash-only 10#HH form that crashed the nightly backup subshell under dash (found by production deployment rehearsal restart drill)

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/entrypoint.sh
```

### `d4442e6` — Zero-cost launch kit: Oracle Always Free + Caddy TLS + DuckDNS + Gemini free-tier path (deploy/free-oracle, ZERO_COST_LAUNCH.md) — no app code changes

- Time: 2026-09-11T13:19:53+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/d4442e6e7c30c0c723d26b6ab0b06564941e1c67
- Parents: `6fce7db`
- Intent / implemented scope: Zero-cost launch kit: Oracle Always Free + Caddy TLS + DuckDNS + Gemini free-tier path (deploy/free-oracle, ZERO_COST_LAUNCH.md) — no app code changes

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	deploy/free-oracle/Caddyfile
A	deploy/free-oracle/docker-compose.free.yml
A	deploy/free-oracle/setup-vm.sh
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
A	docs/ZERO_COST_LAUNCH.md
```

### `820627b` — Zero-cost hosting pivot: ClawCloud Run kit (no card) + automated GHCR image publishing via GitHub Actions — Oracle path blocked; no app code changes

- Time: 2026-09-11T13:49:01+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/820627b47d562b69c15dfec88cc713e55d51d63c
- Parents: `d4442e6`
- Intent / implemented scope: Zero-cost hosting pivot: ClawCloud Run kit (no card) + automated GHCR image publishing via GitHub Actions — Oracle path blocked; no app code changes

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/docker-publish.yml`

- CI [34606492670](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34606492670): docker-publish — **failure**, 2026-09-11T13:49:08Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.github/workflows/docker-publish.yml
A	deploy/free-clawcloud/README.md
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	docs/ZERO_COST_LAUNCH.md
```

### `971916f` — Fix GHCR image name sanitization (trailing-dash repo name invalid in image references)

- Time: 2026-09-11T13:50:20+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/971916fd295eff47b197e6c151806c5193c9dfdc
- Parents: `820627b`
- Intent / implemented scope: Fix GHCR image name sanitization (trailing-dash repo name invalid in image references)

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/docker-publish.yml`

- CI [34606613604](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34606613604): docker-publish — **success**, 2026-09-11T13:50:23Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/docker-publish.yml
```

### `cdb97b6` — Docs: correct published image name to ghcr.io/azadar-templates/akbaral (trailing-dash sanitized by workflow)

- Time: 2026-09-11T13:54:11+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/cdb97b60648b492ccf626b4fd76da73657c10578
- Parents: `971916f`
- Intent / implemented scope: Docs: correct published image name to ghcr.io/azadar-templates/akbaral (trailing-dash sanitized by workflow)

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	deploy/free-clawcloud/README.md
M	docs/ROADMAP.md
M	docs/ZERO_COST_LAUNCH.md
```

### `47a88e7` — Docs: finish image-name correction in LAUNCH_READINESS

- Time: 2026-09-11T13:54:28+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/47a88e74440a2249c7d173ce24bf86e2ddcb0f40
- Parents: `cdb97b6`
- Intent / implemented scope: Docs: finish image-name correction in LAUNCH_READINESS

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/LAUNCH_READINESS.md
```

### `56b4926` — Retire ClawCloud Run (service terminated May 2026) after verification; record honest 2026 free-hosting market status and remaining zero-dollar paths

- Time: 2026-09-11T15:02:17+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/56b49266131979c779798eb3a18388ecf8c568fe
- Parents: `47a88e7`
- Intent / implemented scope: Retire ClawCloud Run (service terminated May 2026) after verification; record honest 2026 free-hosting market status and remaining zero-dollar paths

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	deploy/free-clawcloud/README.md
M	docs/ZERO_COST_LAUNCH.md
```

### `6f327ea` — Domain strategy: verified 2026-09-06 free-domain market (Freenom dead, DigitalPlat rejected, is-a.dev taken); launch on akbaral.duckdns.org + strategic akbaral.eu.org application

- Time: 2026-09-11T15:24:51+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/6f327eae4a7808e04c811ed4d4431eacd50c5615
- Parents: `56b4926`
- Intent / implemented scope: Domain strategy: verified 2026-09-06 free-domain market (Freenom dead, DigitalPlat rejected, is-a.dev taken); launch on akbaral.duckdns.org + strategic akbaral.eu.org application

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/ZERO_COST_LAUNCH.md
```

### `b7debed` — Dual-engine database: production-safe SQLite→PostgreSQL (Neon) migration — sync-bridge Database class, dialect translator, 13 pg migrations with parity verification, engine-aware migrate/seed/backup/restore (pg_dump), PGlite integration harness + 15 pg tests, 254 sqlite tests green

- Time: 2026-09-11T16:38:39+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/b7debed1cca15795d369cf074b476b55ba8593f4
- Parents: `6f327ea`
- Intent / implemented scope: Dual-engine database: production-safe SQLite→PostgreSQL (Neon) migration — sync-bridge Database class, dialect translator, 13 pg migrations with parity verification, engine-aware migrate/seed/backup/restore (pg_dump), PGlite integration harness + 15 pg tests, 254 sqlite tests green

Recorded commit notes (historical claims):


Verification paths changed: `src/config/env.test.ts`, `src/db/postgres.integration.test.ts`

- CI [34623180043](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34623180043): docker-publish — **success**, 2026-09-11T16:38:42Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
M	.gitignore
M	Dockerfile
A	db/migrations-pg/0001_init.sql
A	db/migrations-pg/0002_platform.sql
A	db/migrations-pg/0003_business.sql
A	db/migrations-pg/0004_knowledge_fts_cleanup.sql
A	db/migrations-pg/0005_trust_feedback.sql
A	db/migrations-pg/0006_execution_queue.sql
A	db/migrations-pg/0007_agent_reviews.sql
A	db/migrations-pg/0008_billing_hardening.sql
A	db/migrations-pg/0009_mobile_push.sql
A	db/migrations-pg/0010_automation.sql
A	db/migrations-pg/0011_oauth_identities.sql
A	db/migrations-pg/0012_currency_usd.sql
A	db/migrations-pg/0013_pricing_tiers.sql
M	docs/DEPLOYMENT.md
M	docs/ROADMAP.md
M	docs/ZERO_COST_LAUNCH.md
M	package-lock.json
M	package.json
A	scripts/pg-test-server.mjs
M	src/config/credentials.ts
M	src/config/env.test.ts
M	src/config/env.ts
M	src/db/database.ts
M	src/db/migrate.ts
A	src/db/pg-worker.mjs
A	src/db/postgres.integration.test.ts
M	src/scripts/backup-db.ts
A	src/scripts/backup-pg.ts
M	src/scripts/restore-db.ts
```

### `a037a00` — Modal + Neon deployment wrapper (Path B): always-on web service from GHCR image, verified against Modal SDK 1.5.5 — HTTPS endpoint, 0.25 CPU/1GiB, secrets in Modal only, seed + nightly volume pg_dump backup + restore functions; runbook in deploy/modal/README.md

- Time: 2026-09-11T17:10:13+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a037a0045d45971d43c714a4499b13937382e583
- Parents: `b7debed`
- Intent / implemented scope: Modal + Neon deployment wrapper (Path B): always-on web service from GHCR image, verified against Modal SDK 1.5.5 — HTTPS endpoint, 0.25 CPU/1GiB, secrets in Modal only, seed + nightly volume pg_dump backup + restore functions; runbook in deploy/modal/README.md

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI [34626166486](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34626166486): docker-publish — **success**, 2026-09-11T17:10:16Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	deploy/modal/README.md
A	deploy/modal/__pycache__/akbaral_app.cpython-311.pyc
A	deploy/modal/akbaral_app.py
M	docs/DEPLOYMENT.md
M	docs/ZERO_COST_LAUNCH.md
```

### `04e37a2` — Fix PostgreSQL startup failure: dialect translator emitted double-quoted JSON keys (PG identifiers) — json_extract now translates to ->>'key' single-quoted literals; regression tests execute the exact queue-reconciliation query (was: column "executionId" does not exist); test:pg made self-contained with seed

- Time: 2026-09-11T20:13:29+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/04e37a2521c2d4e5d370e2e60ea7483c3de215c5
- Parents: `a037a00`
- Intent / implemented scope: Fix PostgreSQL startup failure: dialect translator emitted double-quoted JSON keys (PG identifiers) — json_extract now translates to ->>'key' single-quoted literals; regression tests execute the exact queue-reconciliation query (was: column "executionId" does not exist); test:pg made self-contained with seed

Recorded commit notes (historical claims):


Verification paths changed: `src/db/postgres.integration.test.ts`

- CI [34643065190](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34643065190): docker-publish — **success**, 2026-09-11T20:13:32Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
D	deploy/modal/__pycache__/akbaral_app.cpython-311.pyc
M	package.json
M	src/db/database.ts
M	src/db/postgres.integration.test.ts
```

### `ae32894` — Harden image pipeline against stale deploys: bake GIT_SHA stamp into image; CI verifies published digest (commit stamp + compiled json_extract fix present, old double-quoted form absent); Modal wrapper adds force_build=True (bypass image cache), AKBARAL_IMAGE pin override, and image_version runtime probe

- Time: 2026-09-11T20:27:33+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/ae328945df08ab4755e5162d0a6b49232c31d106
- Parents: `04e37a2`
- Intent / implemented scope: Harden image pipeline against stale deploys: bake GIT_SHA stamp into image; CI verifies published digest (commit stamp + compiled json_extract fix present, old double-quoted form absent); Modal wrapper adds force_build=True (bypass image cache), AKBARAL_IMAGE pin override, and image_version runtime probe

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/docker-publish.yml`

- CI [34644321859](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34644321859): docker-publish — **failure**, 2026-09-11T20:27:36Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/docker-publish.yml
M	Dockerfile
A	deploy/modal/__pycache__/akbaral_app.cpython-311.pyc
M	deploy/modal/akbaral_app.py
```

### `d349a12` — Ignore Python __pycache__ (deploy tooling); drop stray artifact from ae32894

- Time: 2026-09-11T20:28:05+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/d349a12c18131d655985a3f95cf865f2ed70eb1e
- Parents: `ae32894`
- Intent / implemented scope: Ignore Python __pycache__ (deploy tooling); drop stray artifact from ae32894

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI [34644373269](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34644373269): docker-publish — **failure**, 2026-09-11T20:28:10Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.gitignore
D	deploy/modal/__pycache__/akbaral_app.cpython-311.pyc
```

### `ef0adde` — CI image verification restructure: load pushed image locally (no pull), split verification into named steps (digest report / commit stamp / compiled fix) with diagnostics

- Time: 2026-09-11T20:33:07+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/ef0adde683af053808f2ec8994c344801910cf9b
- Parents: `d349a12`
- Intent / implemented scope: CI image verification restructure: load pushed image locally (no pull), split verification into named steps (digest report / commit stamp / compiled fix) with diagnostics

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/docker-publish.yml`

- CI [34644822480](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34644822480): docker-publish — **success**, 2026-09-11T20:33:10Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/docker-publish.yml
```

### `7c14455` — CI: surface published image digest as run annotation + job summary (machine-readable record per commit)

- Time: 2026-09-11T20:34:42+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/7c14455e4f4952b5a487212791c5c38596f92fd2
- Parents: `ef0adde`
- Intent / implemented scope: CI: surface published image digest as run annotation + job summary (machine-readable record per commit)

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/docker-publish.yml`

- CI [34644962053](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34644962053): docker-publish — **success**, 2026-09-11T20:34:45Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/docker-publish.yml
```

### `9954357` — CI: fix doubled sha256 prefix in digest notice (action output already includes it)

- Time: 2026-09-11T20:40:07+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/99543575269a19ff1b3726589efdd1ab094f38fb
- Parents: `7c14455`
- Intent / implemented scope: CI: fix doubled sha256 prefix in digest notice (action output already includes it)

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/docker-publish.yml`

- CI [34645431017](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34645431017): docker-publish — **success**, 2026-09-11T20:40:11Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/docker-publish.yml
```

## Day 6 — 2026-09-12

### `8c113cd` — Phase 0 — Final production completion audit: verified inventory (API surface, auth/security, orchestration, agents, billing, infra, mobile, tests), gap analysis vs launch vision (13/14 public pages missing = critical path), 4-phase completion plan to Sep 18

- Time: 2026-09-12T10:21:38+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/8c113cde01e4ab76fc3bbcdcb3ce73f3415ad577
- Parents: `9954357`
- Intent / implemented scope: Phase 0 — Final production completion audit: verified inventory (API surface, auth/security, orchestration, agents, billing, infra, mobile, tests), gap analysis vs launch vision (13/14 public pages missing = critical path), 4-phase completion plan to Sep 18

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	docs/PRODUCTION_COMPLETION_AUDIT.md
```

### `72e81a9` — Phase 1a — public website foundation: shared site chrome (header/footer, obsidian/indigo token identity, responsive+a11y, skip link), 6 real-content pages (/features /pricing /security /about /privacy /terms — pricing mirrors the real plans table, security documents the actual controls), per-page SEO metadata, sitemap.xml + robots.txt; routes smoke-verified 200 + content spot-checked, 254/254 tests, typecheck, build green

- Time: 2026-09-12T10:32:12+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/72e81a9a299481ab3dfd3e3362165c3caf73f5c6
- Parents: `8c113cd`
- Intent / implemented scope: Phase 1a — public website foundation: shared site chrome (header/footer, obsidian/indigo token identity, responsive+a11y, skip link), 6 real-content pages (/features /pricing /security /about /privacy /terms — pricing mirrors the real plans table, security documents the actual controls), per-page SEO metadata, sitemap.xml + robots.txt; routes smoke-verified 200 + content spot-checked, 254/254 tests, typecheck, build green

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI [34688709413](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34688709413): docker-publish — **success**, 2026-09-12T10:32:15Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	src/app/(public)/about/page.tsx
A	src/app/(public)/features/page.tsx
A	src/app/(public)/layout.tsx
A	src/app/(public)/pricing/page.tsx
A	src/app/(public)/privacy/page.tsx
A	src/app/(public)/security/page.tsx
A	src/app/(public)/site.css
A	src/app/(public)/terms/page.tsx
A	src/app/_components/site-chrome.tsx
A	src/app/robots.ts
A	src/app/sitemap.ts
```

### `d507190` — Phase 1b/1c — agent directory + product pages: public catalog API (GET /api/public/agents, /:slug, /agent-categories, /registry-stats — read-only, platform-agents-only, no internal fields, clamped pagination, platformOnly registry filter), live /agents explorer (search/categories/pager/detail modal, honest loading/error/empty states), /agent-factory (real lifecycle), /help, /faq, /documentation (actual API surface), sitemap 12 routes; 6 new HTTP-surface catalog tests — suite 260/260, tsc, build, route smoke 200 all green

- Time: 2026-09-12T10:57:47+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/d5071905316b5a58adc43a059aac9192c69302e0
- Parents: `72e81a9`
- Intent / implemented scope: Phase 1b/1c — agent directory + product pages: public catalog API (GET /api/public/agents, /:slug, /agent-categories, /registry-stats — read-only, platform-agents-only, no internal fields, clamped pagination, platformOnly registry filter), live /agents explorer (search/categories/pager/detail modal, honest loading/error/empty states), /agent-factory (real lifecycle), /help, /faq, /documentation (actual API surface), sitemap 12 routes; 6 new HTTP-surface catalog tests — suite 260/260, tsc, build, route smoke 200 all green

Recorded commit notes (historical claims):


Verification paths changed: `src/routes/public.test.ts`

- CI [34689800259](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34689800259): docker-publish — **success**, 2026-09-12T10:57:50Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/agents/registry.ts
M	src/app.ts
A	src/app/(public)/agent-factory/page.tsx
A	src/app/(public)/agents/page.tsx
A	src/app/(public)/documentation/page.tsx
A	src/app/(public)/faq/page.tsx
A	src/app/(public)/help/page.tsx
M	src/app/(public)/site.css
A	src/app/_components/agents-explorer.tsx
M	src/app/sitemap.ts
A	src/routes/public.test.ts
A	src/routes/public.ts
M	tsconfig.json
```

### `a9a0bae` — Phase 2 — real contact + feedback surfaces: POST /api/contact (validation, honeypot, 5/min dedicated rate limit, persisted through the existing feedback system under a system account — zero schema changes, full admin visibility via existing queue); public /contact page with honest states; public /feedback page wired to the REAL endpoints (POST /api/feedback, GET /api/feedback/mine) with session detection and status-tracked submissions list; corrected feedback endpoint paths in docs; 5 new HTTP-surface tests — suite 265/265, tsc, build, route smoke green

- Time: 2026-09-12T11:09:20+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a9a0bae67be826bd2b0facb3dc74b812b0cb9bf8
- Parents: `d507190`
- Intent / implemented scope: Phase 2 — real contact + feedback surfaces: POST /api/contact (validation, honeypot, 5/min dedicated rate limit, persisted through the existing feedback system under a system account — zero schema changes, full admin visibility via existing queue); public /contact page with honest states; public /feedback page wired to the REAL endpoints (POST /api/feedback, GET /api/feedback/mine) with session detection and status-tracked submissions list; corrected feedback endpoint paths in docs; 5 new HTTP-surface tests — suite 265/265, tsc, build, route smoke green

Recorded commit notes (historical claims):


Verification paths changed: `src/routes/contact.test.ts`

- CI [34690300564](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34690300564): docker-publish — **success**, 2026-09-12T11:09:23Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/PRODUCTION_COMPLETION_AUDIT.md
M	src/app.ts
A	src/app/(public)/contact/page.tsx
M	src/app/(public)/documentation/page.tsx
A	src/app/(public)/feedback/page.tsx
M	src/app/(public)/site.css
A	src/app/_components/contact-form.tsx
A	src/app/_components/feedback-form.tsx
M	src/app/_components/site-chrome.tsx
M	src/app/sitemap.ts
A	src/routes/contact.test.ts
A	src/routes/contact.ts
```

### `69e8fa0` — fix(router): honest aggregated error when no AI provider is configured

- Time: 2026-09-12T11:40:39+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/69e8fa0c3e4da31489791ccce0959d65ceb45d28
- Parents: `a9a0bae`
- Intent / implemented scope: fix(router): honest aggregated error when no AI provider is configured

Recorded commit notes (historical claims):

> Finding #1 (Phase 3 QA): complete()/completeStreaming() surfaced only the
> LAST unconfigured fallback-chain entry ('openai is not configured; set
> OPENAI_API_KEY') even when every provider was missing, misleading users
> into thinking one key would unlock execution. Both methods now collect
> every unconfigured (provider, envKey) pair and throw a single honest
> error listing all required credentials.
>
> The aggregated message deliberately keeps the literal 'not configured'
> substring: orchestrator error classification re-derives the code from
> the message once errors cross serialization boundaries (executor.ts
> failExecution), and a wording without it regressed the no-retry policy
> for permanent failures (caught by automation.test.ts during this fix —
> kept as a locked classifier contract test).
>
> - src/models/router.ts: unconfiguredChainError() helper, aggregation in
>   both complete paths
> - src/models/router.test.ts: +3 regression tests (aggregated message,
>   single-provider fallback unaffected, classifier contract)
>

Verification paths changed: `src/models/router.test.ts`

- CI [34691670372](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34691670372): docker-publish — **success**, 2026-09-12T11:40:42Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/models/router.test.ts
M	src/models/router.ts
```

### `b8aaf60` — Phase 4 — Final Production Readiness Report (12 items, all real evidence)

- Time: 2026-09-12T11:48:49+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/b8aaf608bd5394a03d021b28d7fb439d0c0a8351
- Parents: `69e8fa0`
- Intent / implemented scope: Phase 4 — Final Production Readiness Report (12 items, all real evidence)

Recorded commit notes (historical claims):

> Rewrites the single verification record to the 2026-09-12 state after
> Phase 3 QA: deployment/infra (GHCR sha256:32797b04… = 69e8fa0 built+CI
> green; prod redeploy is user-side), domain/TLS cutover readiness
> (DuckDNS on user's word only), secrets state (aggregated honest
> provider error, server-side only), DB/migrations (13, dual-engine,
> 4,001 agents preserved), public web (14 routes, SEO, a11y), API +
> observability, security posture (Phase 3 evidence), task engine +
> trust policy (net-zero refund verified live), billing/feedback,
> quality gate (268/268 SQLite + 17/17 PG + tsc + build + CI), mobile,
> and the launch checklist with zero code-side blockers.
>

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	docs/FINAL_PRODUCTION_READINESS.md
```

### `089d3b6` — fix(preview): diagnose 'Something went wrong. Please try again.' — dead preview port, not an app defect; add preview-stack contract tests

- Time: 2026-09-12T12:26:52+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/089d3b605f68189358140fe509854f9ead7c9cfa
- Parents: `b8aaf60`
- Intent / implemented scope: fix(preview): diagnose 'Something went wrong. Please try again.' — dead preview port, not an app defect; add preview-stack contract tests

Recorded commit notes (historical claims):

> Incident report: the browser preview showed the platform's generic
> error page. Investigation against the running stack proved the string
> 'Something went wrong. Please try again.' exists NOWHERE in this
> application — not in src/ or public/, not in any served page or asset
> (live scan of all 14 routes + app.js + styles.css), not in the Next.js
> production runtime text, and not in ANY commit in the entire git
> history (git log --all -S: zero hits). The message is rendered by the
> sandbox preview platform itself when the proxied port has no listener.
>
> Root cause: the QA stack process was (correctly, per the documented
> SQLite/EADDRINUSE protocol) stopped before the Phase 3 verification
> suite and never restarted before the turn ended, so the preview URL
> proxied to a dead :3000. With the stack running, every route, asset,
> SPA boot call and authenticated flow returns 200 with clean server
> logs and zero error output.
>
> Fix (both halves):
> - operational: stack restarted and kept running (process-managed, no
>   pkill patterns); verified green after a clean restart — all 19
>   public routes/assets 200, full SPA session flow 200, served-content
>   scan clean.
> - code-side regression guard: src/app/preview-stack.test.ts (5 tests)
>   locks the app wiring that keeps the proxied preview alive:
>   allowedDevOrigins must keep the preview host, /api /uploads /ws
>   rewrites must forward to the backend, the web tier must never emit
>   frame-blocking headers, public/app.js must parse, and the page shell
>   must mount the SPA root + versioned assets.
>
> Verification: tsc clean, production build green (19/19 pages), new
> suite 5/5, full suite 273/273 (was 268), PG dialect 17/17, live API
> smoke green. No production data or schema touched; registry untouched
> (4,001 platform agents + 1 QA factory agent).
>

Verification paths changed: `src/app/preview-stack.test.ts`

- CI [34693695663](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34693695663): docker-publish — **success**, 2026-09-12T12:26:55Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	src/app/preview-stack.test.ts
```

### `60a9a9c` — feat(economy): ZA141251SA private autonomous business agent — production subsystem

- Time: 2026-09-12T14:39:42+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/60a9a9c9138d1de0c748cec3291843029867d92a
- Parents: `089d3b6`
- Intent / implemented scope: feat(economy): ZA141251SA private autonomous business agent — production subsystem

Recorded commit notes (historical claims):

> The first real autonomous agent layer for the private ZA141251SA mission,
> fully separated from the public user platform:
>
> - DISCOVERY (A): opportunities across 13 legitimate categories through the
>   existing SSRF-guarded search layer; URL-hash dedupe; estimates always
>   labelled; honest unavailability when no search provider is configured.
> - OPPORTUNITY ENGINE (B): expected revenue/cost/time/risk/probability →
>   expected net, ROI, value-per-hour; positive-economics-only authorization
>   (no jobs-per-day quota); high risk requires owner approval; prohibited
>   risk never runs.
> - AUTONOMOUS EXECUTION (C): discover → evaluate → authorize → execute →
>   verify → record, through the real model router; honest aggregated
>   provider error without keys; delivered work records EXPECTED revenue
>   (never a claim — only evidence-backed RECEIVED counts).
> - SELF-EXPANSION (D): capability gap → real Agent Factory creation with
>   parent provenance, security review, gated lifecycle, hard agent cap.
> - RESOURCE ECONOMY (E): requests gated by policy AND realized revenue;
>   provisioning is owner-action-with-evidence only; agents never hold
>   payment credentials; idempotent expense posting.
> - SELF-UPGRADE (F): benchmark + security + economic checks before apply;
>   failing checks auto-reject; model upgrades scoped to the economy only;
>   clean rollback.
> - AKBARAL IMPROVEMENTS (G): proposal records + sandbox evidence — no code
>   path touches production (existing dev/test/deploy controls unchanged).
> - TREASURY (H): full double-direction ledger (revenue/api/compute/storage/
>   agent-creation/settlement), idempotent by UNIQUE ref_id; reserved funds;
>   no keys in agent memory.
> - SETTLEMENT (I): net profit above operating float → settlement record
>   with evidence; pending_provider until a real provider exists.
> - 4,001 REGISTRY (J): untouched — economy_agent_profiles is an overlay
>   keyed by registry slug (verified by test).
> - USER SAFETY (K): structural isolation — economy repositories never query
>   user/billing tables (test-enforced); separate system account; user
>   credits never consumed by economy work.
> - OWNER DASHBOARD (L): /api/economy/* (owner+super_admin only) with full
>   aggregates, 'WHAT DID ZA141251SA DO TODAY?' factual chronology, and a
>   private SPA console (#/economy, role-gated like the admin console).
> - PERFORMANCE (M): concurrency caps, daily spend caps, rate/platform
>   limits respected; no fabricated volume.
> - CONTINUOUS OPERATION (N): durable scheduler (30s idempotent ticks),
>   restart reconciliation with bounded retry budget, no duplicate
>   execution or billing (UNIQUE idempotency keys).
> - SECURITY (O): kill switch, prompt-injection scanner blocks
>   instruction-bearing external content, platform emergency-stop respected,
>   SSRF guard, least privilege, full audit events.
> - REVENUE ACCOUNTING (P): DISCOVERED/EXPECTED/PENDING/RECEIVED/SETTLED/
>   REFUNDED/DISPUTED states; evidence mandatory; realized = RECEIVED only.
> - TESTS (Q): 32 new tests covering every required dimension incl.
>   injection, isolation, kill switch, restart recovery, rollback, daily
>   report accuracy, HTTP RBAC (401/403/200).
>
> DB: dual-dialect migration 0014 (SQLite + PG, 13 new tables, registry
> untouched). Suite: 305/305 SQLite, 17/17 PG, tsc clean, build green, live
> smoke green (RBAC + owner console + kill switch + honest failures).
>

Verification paths changed: `src/economy/economy.test.ts`

- CI [34699938885](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34699938885): docker-publish — **success**, 2026-09-12T14:39:46Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations-pg/0014_agent_economy.sql
A	db/migrations/0014_agent_economy.sql
M	public/app.js
M	public/styles.css
M	src/app.ts
M	src/app/page.tsx
A	src/db/economy-repositories.ts
A	src/economy/economy.test.ts
A	src/economy/operations.ts
A	src/economy/policy.ts
A	src/economy/report.ts
A	src/economy/treasury.ts
A	src/routes/economy.ts
```

### `3126d04` — hardening(db): explicit sslmode=verify-full for remote PostgreSQL — eliminates pg-connection-string security warning

- Time: 2026-09-12T15:20:05+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/3126d048777548bea6a0c84753224a149460015a
- Parents: `60a9a9c`
- Intent / implemented scope: hardening(db): explicit sslmode=verify-full for remote PostgreSQL — eliminates pg-connection-string security warning

Recorded commit notes (historical claims):

> pg 8.23's bundled pg-connection-string prints 'SECURITY WARNING: The SSL
> modes prefer/require/verify-ca are treated as aliases for verify-full…'
> for every Neon-style sslmode=require connection (i.e. each production
> process start), and pg 9 will silently weaken those modes to libpq
> semantics.
>
> - src/db/pg-connection.mjs (new): normalizeSslMode() — upgrades remote
>   (non-loopback/non-private) connection strings to an EXPLICIT
>   sslmode=verify-full: missing/ssl=true/prefer/require/verify-ca →
>   verify-full (byte-identical behavior under pg 8.x per the library's own
>   alias mapping, now future-proof and warning-free); disable/no-verify/
>   allow on a remote host are REFUSED outright. Local hosts are returned
>   untouched. String surgery only — the rest of the URL (including exact
>   credential encoding) is preserved byte-for-byte; the connection string
>   is never logged and never appears in error messages.
> - src/db/pg-worker.mjs: normalize before new Client(...) — the single
>   place a pg connection is created.
> - package.json build: copy pg-connection.mjs into dist next to
>   pg-worker.mjs (Docker image picks it up via COPY dist).
> - src/db/pg-connection.test.ts: 8 tests — Neon-style upgrade preserving
>   other params, missing-sslmode append, ssl=true upgrade, prefer/verify-ca
>   upgrade, verify-full idempotence, insecure remote modes refused without
>   leaking the URL, local hosts untouched (incl. IPv6/private ranges), and
>   a no-console-leak guarantee for credentials.
>
> Proof: parse('…sslmode=require') emits the warning; parse(normalized
> string) emits nothing. Verified: tsc clean, production build green (both
> .mjs files in dist), full suite 313/313 (305 + 8), PG dialect 17/17.
>

Verification paths changed: `src/db/pg-connection.test.ts`

- CI [34701915056](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34701915056): docker-publish — **success**, 2026-09-12T15:20:08Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	package.json
A	src/db/pg-connection.mjs
A	src/db/pg-connection.test.ts
M	src/db/pg-worker.mjs
```

### `48a010d` — hardening(models): Phase 4 provider execution hardening

- Time: 2026-09-12T17:24:50+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/48a010de0d990e5bbb1f6f140390d73c04bb7e7e
- Parents: `3126d04`
- Intent / implemented scope: hardening(models): Phase 4 provider execution hardening

Recorded commit notes (historical claims):

> Real provider execution path hardening — no behavior changes to the
> public API, no billing/pricing changes:
>
> - Google adapter: API key now travels in the x-goog-api-key HEADER for
>   both generateContent and streamGenerateContent — never in the URL
>   (URLs can leak into logs; headers do not).
> - Honest provider error classes: safeProviderErrorMessage reports the
>   status class (401/403 credentials, 429 rate limit, 5xx server error)
>   instead of describing every failure as an authorization problem.
> - ProviderCallError.retryable: 408/429/5xx/network are transient;
>   other 4xx are permanent. Threaded through failExecution ->
>   dispatch outcome -> queue so a rejected API key (401) never burns
>   the retry budget while transient 5xx still retries.
> - AKBARAL_PROVIDER_TIMEOUT_MS env knob (min 1s, default 60s) for the
>   provider request timeout, read per request.
>
> Tests (SQLite 313 -> 322, PG 17/17, build clean):
> - new src/models/provider-hardening.test.ts (8): google header/URL
>   + usageMetadata->model_runs accounting, openai usage accounting,
>   timeout knob (hung fixture), hostile-401-echo redaction, status-class
>   messages, retryable matrix, classifyExecutionError typed signal,
>   client-bundle secret scan.
> - queue.test.ts (+1): permanent provider 401 -> no retry, honest
>   failure, full credit refund, no key material in task error.
> - fixture: 'unauthorized' mode echoes Authorization header in the
>   401 body to prove redaction.
>

Verification paths changed: `src/models/provider-hardening.test.ts`, `src/orchestrator/queue.test.ts`

- CI [34708155093](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34708155093): docker-publish — **success**, 2026-09-12T17:24:54Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/config/secrets.ts
M	src/models/client.ts
A	src/models/provider-hardening.test.ts
M	src/orchestrator/errors.ts
M	src/orchestrator/executor.ts
M	src/orchestrator/queue.test.ts
M	src/orchestrator/queue.ts
M	src/test-support/model-provider-fixture.ts
```

### `a4916db` — fix(execution+ux): real provider task path, responsive workspace, honest error states

- Time: 2026-09-12T18:55:06+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a4916db2af327d8b5679b47273ab8408a6173d0b
- Parents: `48a010d`
- Intent / implemented scope: fix(execution+ux): real provider task path, responsive workspace, honest error states

Recorded commit notes (historical claims):

> TASK 1 — Real AI execution (root cause of 'No knowledge results'):
> - The bounded tool stage injected an EMPTY knowledge_search result ([] for
>   accounts with no indexed knowledge) as 'VERIFIED TOOL CONTEXT — cite
>   only these sources', so the model correctly answered that no
>   knowledge/sources existed. Zero-result tools are now logged honestly
>   ('matched nothing … continuing model-only') and never injected; model-only
>   tasks execute successfully without web knowledge.
> - searchKnowledge: FTS5 MATCH is implicit-AND, so sentence-length queries
>   (agent goals) almost never matched. Exact match is tried first, then an
>   honest OR-token retry — only genuinely indexed rows can match.
>   (Portable: PG translates to websearch_to_tsquery which supports OR.)
> - web_search failures are explicit and actionable: the endpoint host is
>   named (never a credential) with the AKBARAL_SEARCH_ENDPOINT operator
>   knob.
> - Google adapter: safety-blocked prompts (promptFeedback.blockReason) and
>   empty non-STOP responses (finishReason) now fail explicitly with honest
>   ProviderCallError causes instead of silently returning empty text that
>   later failed verification confusingly. Blocked = permanent, MAX_TOKENS/
>   RECITATION = retryable.
> - Router: a real provider-attempt failure (auth/outage/block/timeout) can
>   no longer be masked by a later 'not configured' skip of a DIFFERENT
>   provider in the fallback chain — the attempt error is the honest reason.
> - Knowledge search API returns knowledgeItems so clients can distinguish
>   an empty knowledge base from a genuine no-match query.
>
> TASK 2/3 — Responsive workspace rebuild (identity preserved):
> - MASTER screen is now a two-zone operating environment: goal/input +
>   environment panel (live provider availability from /api/models, env key
>   NAMES only) | execution console — bounded, scrollable, monospace log
>   stream with warn/error coloring. Collapses to one column <=1080px.
> - Pricing grid steps 3 -> 2 (<=1180px) -> 1 (<=640px); the previous direct
>   3 -> 1 jump left large empty space on tablets.
> - All auto-fill/fit grids guard fixed minimums with min(Npx, 100%) so no
>   track can overflow a 320px viewport; toolbar inputs flex with min-width
>   guards; container gutters tighten at 720px/400px; long tokens (URLs,
>   JSON) wrap anywhere; console/result cards keep min-width: 0.
> - Asset cache version bumped to akbaral-lux-6.
>
> TASK 4 — Honest frontend error states:
> - 'No knowledge results.' generic empty state removed. Distinct states:
>   empty knowledge base vs no-match vs search failure; provider
>   unconfigured / auth rejected / rate limited / outage / verification
>   failure / timeout / cancelled / requires-pro each get accurate, actionable
>   copy that never claims success and always states the refund outcome.
> - Structured terminal results (content + model/provider/latency/
>   verification chips) replace raw JSON dumps; task detail shows the
>   friendly failure title.
>
> Tests (SQLite 322 -> 337, PG 17/17, build clean, 28/28 live stack checks):
> - src/orchestrator/tool-stage.test.ts (4): empty-knowledge no-injection
>   + model-only completion + exact-once credit; actionable web_search
>   failure; indexed knowledge still injected; full Gemini wire path
>   (generateContent, x-goog-api-key header, usage accounting).
> - src/models/provider-hardening.test.ts (+1): blocked/empty Google
>   responses are explicit errors.
> - src/app/responsive-contract.test.ts (10): responsive + honest-state
>   contract (grids, breakpoints, console bounds, error mapping, no
>   credential material in bundles).
> - workspace.test.ts: knowledgeItems presence/honesty assertion.
>

Verification paths changed: `src/app/responsive-contract.test.ts`, `src/models/provider-hardening.test.ts`, `src/orchestrator/tool-stage.test.ts`, `src/routes/workspace.test.ts`

- CI [34712620356](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34712620356): docker-publish — **success**, 2026-09-12T18:55:10Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/app.js
M	public/styles.css
M	src/agents/web-research.ts
M	src/app/layout.tsx
M	src/app/page.tsx
A	src/app/responsive-contract.test.ts
M	src/db/platform-repositories.ts
M	src/models/client.ts
M	src/models/provider-hardening.test.ts
M	src/models/router.ts
M	src/orchestrator/executor.ts
A	src/orchestrator/tool-stage.test.ts
M	src/routes/files.ts
M	src/routes/workspace.test.ts
```

### `85528d0` — fix(result-state): task outcome renderer — actual answer always visible, states separated

- Time: 2026-09-12T19:23:28+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/85528d0fd17a7f4799788b5688c750eeb7a8fd0a
- Parents: `a4916db`
- Intent / implemented scope: fix(result-state): task outcome renderer — actual answer always visible, states separated

Recorded commit notes (historical claims):

> Production incident: a completed MASTER task showed the Workspace
> knowledge panel's empty state ('Your knowledge base is empty…') where the
> user expected the task result, and the actual Gemini answer was not
> rendered anywhere readable.
>
> Root causes (frontend result-rendering path):
> - The MASTER-form (workflow) path produces a finalResult DOCUMENT
>   (executiveSummary + sections[].content); renderMasterResult did not
>   know that shape and fell through to a generic 'Completed' card — the
>   real answer was never rendered on the primary production flow.
> - Agent #001's real payload type is web_research_report (report.summary/
>   facts/sources); the renderer checked for a 'research_result' type that
>   does not exist — dead branch, #001 results also showed the generic
>   card.
> - Task detail showed raw JSON instead of the answer.
> - The knowledge panel — a TOOL — read as a 'result area', so its empty
>   state became the de-facto final result while hunting for the output.
>
> Fix — four UI state machines, strictly separated:
> - KNOWLEDGE state -> #knowledge-results only (workspace tool panel, now
>   carrying a tool-scope note: 'Tool · searches documents you have
>   indexed. Task results appear on the MASTER screen and in Task Center
>   — not here.').
> - TOOL state -> execution console log lines only.
> - EXECUTION state -> console state chip + live logs (non-terminal).
> - TERMINAL RESULT -> renderTaskOutcome ONLY (#master-result, task
>   detail) — a single terminal renderer that shows the REAL content for
>   every payload shape: agent_result (model answer + verification
>   chips), web_research_report (summary + verified facts + sources),
>   MASTER finalResult (executiveSummary + per-specialist section
>   content), generic content/string; honest 'completed without content'
>   and 'still running' states; failures via friendlyTaskError. Nothing
>   is ever fabricated and no knowledge/tool state can appear as a task
>   result.
> - Task detail now renders the friendly answer via the shared renderer
>   with raw JSON kept secondary in a collapsed <details>.
> - Knowledge empty state copy scoped as informational-secondary and
>   redirected to the real result locations.
> - Asset cache version bumped to akbaral-lux-7.
>
> Regression tests: src/app/result-state-contract.test.ts (10) —
> BEHAVIORAL: extracts the real renderer functions from app.js and
> executes them in a VM against a DOM stub, asserting every completed
> payload shape renders its real content and that the exact incident
> knowledge-state string can never be rendered by the task-outcome
> renderer; plus static separation invariants (knowledge state exists
> only inside searchKnowledge, workflow path forwards finalResult,
> dead research_result branch gone, task detail friendly-first).
>
> Verified: tsc clean; SQLite 347/347 (+10); PG dialect 17/17; production
> build clean; 24/24 live-stack checks through the real HTTP surface with
> the Gemini wire fixture — the user's exact flow (MASTER form ->
> workflow -> completed: executiveSummary + section content present and
> carrying the real model answer), agent path, task-detail payload,
> knowledge-tool separation, and exact per-task credit accounting
> (5 - 2 workflow steps - 1 agent task = 2 remaining, asserted).
>
> No changes to credit/refund policy, security, or server-side key
> handling.
>

Verification paths changed: `src/app/responsive-contract.test.ts`, `src/app/result-state-contract.test.ts`

- CI [34714032386](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34714032386): docker-publish — **success**, 2026-09-12T19:23:31Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/app.js
M	public/styles.css
M	src/app/layout.tsx
M	src/app/page.tsx
M	src/app/responsive-contract.test.ts
A	src/app/result-state-contract.test.ts
```

### `7d07882` — fix(google): replace retired gemini-2.0-flash (HTTP 404) with current verified Gemini models

- Time: 2026-09-12T20:11:08+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/7d07882975b18cfd211b0175e630c678defdf47e
- Parents: `85528d0`
- Intent / implemented scope: fix(google): replace retired gemini-2.0-flash (HTTP 404) with current verified Gemini models

Recorded commit notes (historical claims):

> Production incident: every google-routed task failed with
> 'google rejected the request (HTTP 404)'. Root cause verified against the
> official Gemini API release notes: Google shut gemini-2.0-flash (and -001
> / lite variants) down on 2026-06-01 — the model ID is dead and
> generativelanguage.googleapis.com answers 404 for it. The API surface
> itself was healthy: POST /v1beta/models/{model}:generateContent with the
> x-goog-api-key header is still the current official contract (verified
> against ai.google.dev quickstart + generate-content docs, Sept 2026).
> No stale env override existed (Modal env carries no GOOGLE_BASE_URL; the
> key remains header-only, never in the URL).
>
> Catalog (verified against the official model list + pricing, Sept 2026):
> - gemini-3.8-flash — newest stable Flash (isDefault; $0.75/$3.75 per 1M
>   intro; 1,048,576 ctx / 65,536 out; reasoning/coding/research/writing)
> - gemini-3.5-flash — official Google-named replacement for 2.0-flash
> - gemini-3.1-flash-lite — cheapest stable (official lite replacement)
> The router's model-level fallback chain now tries all three before any
> honest failure.
>
> Self-healing catalog sync (no manual production DB surgery):
> - syncModelCatalog (runs at every boot) now retires catalog-managed model
>   rows that are no longer in MODEL_SPECS (status='retired'); operator-
>   disabled rows keep their status; the stale enabled gemini-2.0-flash row
>   in the production database stops being routable the moment the fixed
>   image boots. Router filters retired models from routing and the chain.
> - Router route() now prefers the best-scoring CONFIGURED model as primary
>   (previously it could surface an unconfigured provider as the primary
>   decision and mislead the /api/models/chat/stream decision event).
>
> Honest 404 classification (no secrets):
> - GoogleProvider (chat + streamGenerateContent): HTTP 404 becomes
>   'google returned HTTP 404: model "<key>" was not found for API
>   version v1beta — the model is retired or does not exist at this
>   endpoint; update the model catalog (this is a configuration problem,
>   not a credentials problem)' — permanent (never retried).
> - safeProviderErrorMessage gains the 404 bucket naming the model/endpoint
>   configuration problem.
> - AKBARAL_PROVIDER_TIMEOUT_MS behavior, 401/403/429/5xx classification,
>   retry policy, credit/refund policy and server-side key handling are
>   all unchanged.
>
> Tests (SQLite 347 -> 354, PG 17/17, build clean):
> - src/models/catalog-contract.test.ts (5, new): every google model is on
>   the verified-available list (ai.google.dev, Sept 2026); no retired ID
>   (2.0/1.5 families) can route; official endpoint/env contract; sync
>   retires stale rows and preserves operator status; cost metadata.
> - provider-hardening.test.ts (+1 +asserts): google 404 regression —
>   honest model/endpoint diagnosis, permanent, no secrets; 404 message
>   bucket; retryable matrix.
> - queue.test.ts (+1): dead-model 404 -> no retry, task fails honestly,
>   credit refunded, raw provider body never echoed.
> - Fixture: 'not_found' mode (Google-style NOT_FOUND body).
> - Wire regression: tool-stage google path updated to gemini-3.8-flash.
>
> Live-stack verification (17/17): simulated production DB with the dead
> model still enabled -> boot sync retired it; the user's exact goal
> ('What is AKBARAL! in 5 short bullet points') completed through the real
> Gemini wire path (POST /v1beta/models/gemini-3.8-flash:generateContent,
> x-goog-api-key header, key never in URL), verified before completion,
> usage+cost recorded in model_runs, exact per-task credit accounting, no
> key material in any response, /api/models honestly shows current models
> available and the dead model retired.
>

Verification paths changed: `src/app/result-state-contract.test.ts`, `src/models/catalog-contract.test.ts`, `src/models/provider-hardening.test.ts`, `src/models/router.test.ts`, `src/orchestrator/queue.test.ts`, `src/orchestrator/tool-stage.test.ts`

- CI [34716340918](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34716340918): docker-publish — **success**, 2026-09-12T20:11:11Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app/result-state-contract.test.ts
M	src/config/secrets.ts
A	src/models/catalog-contract.test.ts
M	src/models/catalog.ts
M	src/models/client.ts
M	src/models/provider-hardening.test.ts
M	src/models/router.test.ts
M	src/models/router.ts
M	src/orchestrator/queue.test.ts
M	src/orchestrator/tool-stage.test.ts
M	src/test-support/model-provider-fixture.ts
```

### `8ab8cef` — test(preview): regression lock — the platform error page copy is foreign to this app

- Time: 2026-09-12T20:28:24+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/8ab8cefaefd63e23ddcdeaf26be6fbb3b837114b
- Parents: `7d07882`
- Intent / implemented scope: test(preview): regression lock — the platform error page copy is foreign to this app

Recorded commit notes (historical claims):

> Second occurrence of the incident: the browser preview showed
> 'Something went wrong. Please try again.' after the Google provider fix
> was verified green (354/354, live-stack 17/17). Diagnosis: the message is
> the sandbox preview PLATFORM's own error page, shown when the preview
> port is dead — the app stack had been stopped after the previous
> verification run, so the preview proxied to nothing. The string exists
> nowhere in this codebase (source, bundles, or git history — re-verified
> with grep + git log -S), the app has no error.tsx/global-error.tsx that
> could produce it, and Next's default boundary copy is entirely different.
>
> Fix: operational — the preview stack is restarted and left running.
> Regression lock added to the preview-stack contract suite: the platform
> error copy can never appear in any served surface (page shell, app.js,
> styles, tokens), so the string stays unambiguous as a platform-outage
> signal and can never mask itself as an app defect; the SPA's own honest
> failure surfaces (friendlyTaskError, toast) must keep existing.
>
> Browser-flow verification through the exact preview origin (19/19):
> page shell + all assets 200, same-origin /api rewrites working, the
> user's exact goal completed through the real Gemini wire path,
> finalResult carries the real answer for renderTaskOutcome, task detail
> carries the output, no key material, no error copy anywhere.
>
> No runtime code changed — the corrected runtime image remains
> 7d07882975b18cfd211b0175e630c678defdf47e.
>

Verification paths changed: `src/app/preview-stack.test.ts`

- CI [34717192741](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34717192741): docker-publish — **success**, 2026-09-12T20:28:27Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app/preview-stack.test.ts
```

### `db417cc` — ops(preview): persistent preview supervisor — self-healing stack for the Arena sandbox

- Time: 2026-09-12T20:43:28+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/db417cc70075fc2aeb07a4a1cef6553f8653a084
- Parents: `8ab8cef`
- Intent / implemented scope: ops(preview): persistent preview supervisor — self-healing stack for the Arena sandbox

Recorded commit notes (historical claims):

> Root cause of the recurring 'Something went wrong. Please try again.'
> browser page (diagnosed with platform evidence, third occurrence):
>
> The Arena sandbox is PAUSED between active turns (microVM suspend).
> Processes are NOT killed — the exact same PIDs keep serving across
> pause/resume (proven: kernel uptime is short by precisely the pause
> window while process start timestamps shift; the live stack's out.log
> shows the same process serving requests before and after a ~5.5-minute
> pause between turns). While paused, ports 3000/4000 are unreachable and
> the platform serves its own error page. No in-sandbox code can serve
> HTTP during a pause; the sandbox wakes on the user's next message and
> the preview heals with it. Previous stack deaths were traced to the
> agent's own stop_process cleanup (graceful 'execution queue stopped'
> log tails), never to the platform killing processes.
>
> Permanent in-sandbox fix — scripts/preview/start-preview.mjs:
> - Idempotent supervisor: adopts an already-healthy stack, cold-starts
>   otherwise (ensures the DB exists via migrate+seed first).
> - Health monitor (5s): web :3000 + api :4000; after 3 consecutive
>   failures it restarts the whole tree (fixture + web + api) and keeps
>   trying — crashed children can never leave the preview dead.
> - Local Gemini-protocol fixture moved to scripts/preview/ (tracked) —
>   preview-only stand-in because sandbox egress is blocked; production
>   (Modal) uses the real GOOGLE_API_KEY from the akbaral-production
>   secret. Nothing fakes production behavior.
> - Status + logs under data/preview/ (status.json, preview.log).
> - scripts/start-dev.mjs: next dev now binds 0.0.0.0 explicitly
>   (deterministic IPv4 reachability for the preview proxy).
>
> Operational rule (unchanged by any code): the preview is reachable
> whenever the sandbox is awake — during an active turn and after the
> user's next message wakes it. A 'Something went wrong' page while idle
> means the sandbox is paused, not that the app is broken.
>

Verification paths changed: none in this commit.

- CI [34717926108](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34717926108): docker-publish — **success**, 2026-09-12T20:43:31Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	scripts/preview/gemini-fixture-server.mjs
A	scripts/preview/start-preview.mjs
M	scripts/start-dev.mjs
```

### `0cb5153` — fix(preview): supervisor restart clears orphaned port-holders

- Time: 2026-09-12T20:45:19+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/0cb5153fb1b3cd3b33efbf73a1bed927b0804a79
- Parents: `db417cc`
- Intent / implemented scope: fix(preview): supervisor restart clears orphaned port-holders

Recorded commit notes (historical claims):

> Crash test finding: killing the next dev wrapper leaves the spawned
> next-server worker orphaned but still serving :3000 (and npm-exec children
> can outlive their tree). The restart path now pkill-clears every preview
> command line before respawning so orphans can never block a restart with
> EADDRINUSE. Patterns cannot match the supervisor itself.
>

Verification paths changed: none in this commit.

- CI [34718015117](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34718015117): docker-publish — **success**, 2026-09-12T20:45:22Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/preview/start-preview.mjs
```

### `95e75d7` — fix(preview): match real server cmdlines in killTree + port-free gate before respawn

- Time: 2026-09-12T21:04:35+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/95e75d7625fee4a841cda0b229c2810d4b52a4fa
- Parents: `0cb5153`
- Intent / implemented scope: fix(preview): match real server cmdlines in killTree + port-free gate before respawn

Recorded commit notes (historical claims):

> Live testing exposed an EADDRINUSE crash loop: the pattern 'tsx
> src/index.ts' matched only the npm launcher, not the real api server
> (node --require …/tsx/dist/preflight.cjs --import …/loader.mjs
> src/index.ts), so a killed stack left the server orphaned on :4000 and
> every supervisor respawn died. Patterns now match the real processes,
> cold start also clears orphans, and respawn waits until the preview
> ports accept no connections before spawning. Regression-locked by
> src/app/preview-supervisor.test.ts (4 tests; suite 359/359).
>

Verification paths changed: `src/app/preview-supervisor.test.ts`

- CI [34718914664](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34718914664): docker-publish — **failure**, 2026-09-12T21:04:40Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/preview/start-preview.mjs
A	src/app/preview-supervisor.test.ts
```

### `1e3d9b2` — fix(test): resolve repo root via process.cwd() like sibling tests — import.meta breaks tsc's module setting in the Docker build

- Time: 2026-09-12T21:08:20+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/1e3d9b273b1ce664f9abd35cd9885d4e39ee62f7
- Parents: `95e75d7`
- Intent / implemented scope: fix(test): resolve repo root via process.cwd() like sibling tests — import.meta breaks tsc's module setting in the Docker build

Recorded commit notes (historical claims):


Verification paths changed: `src/app/preview-supervisor.test.ts`

- CI [34719093232](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34719093232): docker-publish — **success**, 2026-09-12T21:08:23Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app/preview-supervisor.test.ts
```

## Day 7 — 2026-09-13

### `df8d6bc` — fix(preview): publish live sandbox id + derived preview URL in status.json

- Time: 2026-09-13T11:56:45+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/df8d6bcc9af39ab0baa8d7047c38b47e4c1fd015
- Parents: `1e3d9b2`
- Intent / implemented scope: fix(preview): publish live sandbox id + derived preview URL in status.json

Recorded commit notes (historical claims):

> A user's browser was served by a PREVIOUS sandbox's runtime because the
> preview URL from an older sandbox (izty4i3…) kept resolving after the
> workspace was restored into a new VM (iq3ymf…). Their workflow ran on
> the old VM and was invisible to this session's DB — traced by zero
> workflows/model_runs here despite their browser report. The supervisor
> now records E2B_SANDBOX_ID and the derived
> https://{port}-{sandboxId}.e2b.app URL in data/preview/status.json so
> the correct preview URL is always discoverable. Regression-locked in
> preview-supervisor.test.ts (suite 360/360).
>

Verification paths changed: `src/app/preview-supervisor.test.ts`

- CI [34755751239](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34755751239): docker-publish — **success**, 2026-09-13T11:56:48Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/preview/start-preview.mjs
M	src/app/preview-supervisor.test.ts
```

### `f183ff7` — ops(verify): real-production E2E script + manual CI workflow

- Time: 2026-09-13T12:31:17+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/f183ff759524262957c10e456129336cc2ce9eca
- Parents: `df8d6bc`
- Intent / implemented scope: ops(verify): real-production E2E script + manual CI workflow

Recorded commit notes (historical claims):

> scripts/verify-production-e2e.mjs runs the complete MASTER flow against
> a live deployment — health/ready, shell, public registration, provider
> availability (proves the runtime's GOOGLE_API_KEY is set), the exact
> goal, selected-model evidence from execution logs, verification, the
> finalResult/renderTaskOutcome payload, Task Center, exact credit math
> (before-1), and key-leak scans across every response surface. In
> production mode it REJECTS the preview fixture's canned answer and
> requires realistic provider latency, so fixture success can never be
> reported as production evidence.
>
> .github/workflows/production-verify.yml runs it on demand against
> https://azadar-templates--akbaral.modal.run — the Arena sandbox has no
> egress to modal.run, so GitHub Actions is the agent-executable
> production evidence channel. No secrets are needed or printed.
> Validated against the local stack in fixture mode (all checks pass,
> fixture answer correctly flagged); suite 360/360, tsc clean, build OK.
>

Verification paths changed: `.github/workflows/production-verify.yml`, `scripts/verify-production-e2e.mjs`

- CI [34757318064](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34757318064): docker-publish — **success**, 2026-09-13T12:31:19Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.github/workflows/production-verify.yml
A	scripts/verify-production-e2e.mjs
```

### `8942dbd` — ci(verify): trigger production-verify on tooling pushes to the working branch

- Time: 2026-09-13T12:32:28+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/8942dbdb1cc257ab566b9a91b8583791bc9f4bc9
- Parents: `f183ff7`
- Intent / implemented scope: ci(verify): trigger production-verify on tooling pushes to the working branch

Recorded commit notes (historical claims):

> GitHub only registers workflow_dispatch on the default branch, which
> this session must not touch — so the production E2E runs on pushes that
> touch the verification tooling instead (this push triggers it).
>

Verification paths changed: `.github/workflows/production-verify.yml`

- CI [34757373550](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34757373550): production-verify — **failure**, 2026-09-13T12:32:31Z.
- CI [34757373504](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34757373504): docker-publish — **success**, 2026-09-13T12:32:31Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/production-verify.yml
```

### `043aed8` — ci(verify): mirror E2E failures as GitHub annotations (log download blocked from the dev sandbox)

- Time: 2026-09-13T12:35:16+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/043aed86cf7122024d66558f37da692e767f7d78
- Parents: `8942dbd`
- Intent / implemented scope: ci(verify): mirror E2E failures as GitHub annotations (log download blocked from the dev sandbox)

Recorded commit notes (historical claims):


Verification paths changed: `scripts/verify-production-e2e.mjs`

- CI [34757500255](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34757500255): production-verify — **failure**, 2026-09-13T12:35:19Z.
- CI [34757500253](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34757500253): docker-publish — **success**, 2026-09-13T12:35:19Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/verify-production-e2e.mjs
```

### `9509fe6` — ci(verify): detect a disabled Modal workspace and report it as the production blocker

- Time: 2026-09-13T12:39:10+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/9509fe61d333b0b211373695a1b03ba47fa3a82b
- Parents: `043aed8`
- Intent / implemented scope: ci(verify): detect a disabled Modal workspace and report it as the production blocker

Recorded commit notes (historical claims):

> Modal's edge returns 404 + 'modal-http: workspace … is disabled' for
> every request when the workspace is disabled (account/billing state).
> The E2E now recognizes that response and prints the exact remediation
> instead of a confusing wall of 404s (exit code 3).
>

Verification paths changed: `scripts/verify-production-e2e.mjs`

- CI [34757672670](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34757672670): production-verify — **failure**, 2026-09-13T12:39:13Z.
- CI [34757672597](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34757672597): docker-publish — **success**, 2026-09-13T12:39:13Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/verify-production-e2e.mjs
```

### `709ee6f` — ops(production): Path C — free production on Render (Modal capped at $1)

- Time: 2026-09-13T13:57:57+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/709ee6ff5f4bfa701484d830b91d0c1e8482931e
- Parents: `9509fe6`
- Intent / implemented scope: ops(production): Path C — free production on Render (Modal capped at $1)

Recorded commit notes (historical claims):

> Modal Starter hit its $1 free-usage cap; the workspace edge refuses all
> traffic, so production moves to Render's free web service — $0, no card,
> same architecture:
>
> - render.yaml Blueprint: one image-backed free web service
>   (ghcr.io/azadar-templates/akbaral, the exact CI image), health check
>   /api/health, numInstances pinned to 1 (queue/scheduler singleton),
>   secrets prompted in the dashboard (DATABASE_URL/GOOGLE_API_KEY) or
>   generated (SESSION_SECRET); PORT=3000 routing; DISABLE_BACKUP_CRON=1.
> - deploy/free-render/README.md: verified 2026-09-13 market analysis
>   (Koyeb paid-only for new users after the Mistral acquisition; HF Docker
>   Spaces paid to create; Render free = 750h/mo, 0.1 CPU/512MB, WS,
>   cardless), one-time 5-minute setup, honest free-tier trade-offs,
>   rollback/portability.
> - deploy-render.yml: manual deploy-hook trigger + full REAL production
>   E2E (existing verify-production-e2e.mjs — no new verification system);
>   skips gracefully until the repo secrets exist.
> - keep-alive.yml: 13-min scheduled ping so the free tier's 15-min
>   spin-down never stalls the execution queue (~720h/mo < 750 free).
> - ZERO_COST_LAUNCH.md: dated update — the Neon-stateless architecture
>   makes diskless free tiers viable; old 'no free host' conclusion
>   superseded.
>
> No application code changed; suite 360/360, tsc clean, build OK. The
> Render account + 3 pasted secrets are the only remaining user-side steps
> (documented in the runbook; no card, no chat exposure).
>

Verification paths changed: `.github/workflows/deploy-render.yml`, `.github/workflows/keep-alive.yml`

- CI [34761297845](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34761297845): docker-publish — **success**, 2026-09-13T13:58:00Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.github/workflows/deploy-render.yml
A	.github/workflows/keep-alive.yml
A	deploy/free-render/README.md
M	docs/ZERO_COST_LAUNCH.md
A	render.yaml
```

### `d0abe6c` — ops(production): Path D — free production on Zeabur (Render card-gated)

- Time: 2026-09-13T14:39:13+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/d0abe6c5604948d97ef25f388affbf3740ee1abf
- Parents: `709ee6f`
- Intent / implemented scope: ops(production): Path D — free production on Zeabur (Render card-gated)

Recorded commit notes (historical claims):

> Live signup proved Render demands a payment method even for free
> compute — a zero-investment violation. Market re-verified from official
> sources (2026-09-13): Zerops = one-time $15 credit only; Back4App
> Containers free = 256 MB (too small: our dev stack measures 815 MB,
> prod est. 300–450 MB); Koyeb paid-only for new users; HF Spaces paid to
> create. Zeabur Free Plan is the selection: $0, no card, prebuilt GHCR
> image deploys, HTTP/TCP ports with *.zeabur.app TLS, per-service env
> vars, WebSocket-capable platform (their own API serves wss://
> terminals), 2 services per project.
>
> - deploy/free-zeabur/README.md: verified comparison, 5-minute setup
>   (Docker Image service, port 3000 HTTP, DATABASE_URL / SESSION_SECRET /
>   GOOGLE_API_KEY / DISABLE_BACKUP_CRON), honest free-plan limits
>   (auto-sleep + keep-alive, resource caps, no custom domains, 48h logs),
>   split-layout fallback, portability.
> - scripts/start-prod.mjs: AKBARAL_ROLES=both|web|api (default both —
>   byte-identical behavior to the Modal layout) so the same image can
>   split tiers across Zeabur's 2 free services if the memory cap demands
>   it; next.config.mjs's existing NEXT_BACKEND_URL routes the web tier.
>   Live-checked: AKBARAL_ROLES=api boots only the API tier.
> - src/app/prod-roles.test.ts: 3-test contract lock (roles honored, safe
>   default, tier gating, ports/production flags unchanged).
> - Render kit retired (deploy/free-render/ stub, render.yaml +
>   deploy-render.yml removed); keep-alive.yml now provider-neutral;
>   production-verify.yml resolves its target as input →
>   PRODUCTION_BASE_URL secret → legacy Modal URL.
> - ZERO_COST_LAUNCH.md: dated Path D update.
>
> Suite 363/363, tsc clean, build OK. Only user-side step: Zeabur signup
> (GitHub, no card) + 3 pasted env values — documented in the runbook.
>

Verification paths changed: `.github/workflows/deploy-render.yml`, `.github/workflows/keep-alive.yml`, `.github/workflows/production-verify.yml`, `src/app/prod-roles.test.ts`

- CI [34763285436](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34763285436): production-verify — **failure**, 2026-09-13T14:39:16Z.
- CI [34763285435](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34763285435): docker-publish — **success**, 2026-09-13T14:39:16Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
D	.github/workflows/deploy-render.yml
M	.github/workflows/keep-alive.yml
M	.github/workflows/production-verify.yml
M	deploy/free-render/README.md
A	deploy/free-zeabur/README.md
M	docs/ZERO_COST_LAUNCH.md
D	render.yaml
M	scripts/start-prod.mjs
A	src/app/prod-roles.test.ts
```

### `4dd4321` — ops(production): Path E — free production on SnapDeploy (Zeabur free compute withdrawn)

- Time: 2026-09-13T15:32:41+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/4dd4321fbffccd2db172479ca5789e7a68207222
- Parents: `d0abe6c`
- Intent / implemented scope: ops(production): Path E — free production on SnapDeploy (Zeabur free compute withdrawn)

Recorded commit notes (historical claims):

> Zeabur's dashboard now offers only 'Buy New Server' / 'Bind External
> Server' — no $0 server creation for this account (kit retired to a stub).
> Market's last verified cardless Docker host is SnapDeploy Free, confirmed
> from its own current docs (2026-09-13):
>
> - $0, no card; 2 containers x 512 MB RAM (docs/scaling table)
> - GitHub deploys that build OUR repo Dockerfile (~1-2 min build, 5-min
>   free timeout); per-container env vars + secrets; free SSL subdomain
> - Auto-sleep 15 min idle / auto-wake ~60 s — mitigated by keep-alive
> - WebSockets are a paid feature there: the app's realtime execution-log
>   stream falls back to SSE over /api/* (built in), so no functionality
>   is lost
>
> - deploy/free-snapdeploy/README.md: verified facts table, 5-minute setup
>   (GitHub container, port 3000, DATABASE_URL / SESSION_SECRET /
>   GOOGLE_API_KEY / DISABLE_BACKUP_CRON), honest limitations, 2-container
>   split fallback via AKBARAL_ROLES + NEXT_BACKEND_URL, portability notes
> - deploy/free-zeabur/README.md → retired stub
> - keep-alive.yml: optional second ping (PRODUCTION_API_PING_URL) for
>   split deployments
> - ZERO_COST_LAUNCH.md: dated Path E update
>
> No application changes; suite 363/363, tsc clean, build OK. Only user-side
> step: SnapDeploy signup (no card) + connect repo + 3 pasted env values.
>

Verification paths changed: `.github/workflows/keep-alive.yml`

- CI [34765921324](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34765921324): docker-publish — **success**, 2026-09-13T15:32:44Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/keep-alive.yml
A	deploy/free-snapdeploy/README.md
M	deploy/free-zeabur/README.md
M	docs/ZERO_COST_LAUNCH.md
```

### `d674217` — docs(snapdeploy): minimal core-production env list with full classification

- Time: 2026-09-13T15:55:42+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/d6742172945306f065ab6d47137eda556aff3d6e
- Parents: `4dd4321`
- Intent / implemented scope: docs(snapdeploy): minimal core-production env list with full classification

Recorded commit notes (historical claims):

> Every variable SnapDeploy detects (from .env.example) classified against
> src/config/env.ts: 3 REQUIRED (DATABASE_URL must replace the SQLite dev
> example, SESSION_SECRET >=32 chars generated once, GOOGLE_API_KEY for the
> core Gemini path), TRUST_PROXY=1 behind their TLS proxy,
> DISABLE_BACKUP_CRON=1 on ephemeral disks, SEED_DATABASE only for an empty
> Neon DB; all integrations optional with honest not-configured behavior;
> GOOGLE_BASE_URL / *_BASE_URL / AKBARAL_ALLOW_PRIVATE_PROVIDER explicitly
> must stay unset in production (preview/fixture switches, SSRF protection).
> Docs-only; suite 363/363, tsc clean.
>

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	deploy/free-snapdeploy/README.md
```

### `ed22583` — fix(env): optional integrations commented in .env.example — deployment scanners demanded them as required

- Time: 2026-09-13T16:21:37+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/ed2258382c9b0f7a5f3938f31bfc708e3220b542
- Parents: `d674217`
- Intent / implemented scope: fix(env): optional integrations commented in .env.example — deployment scanners demanded them as required

Recorded commit notes (historical claims):

> SnapDeploy's Environment Variables Detected screen marked 14 optional
> vars (SMTP_*, social/marketing tokens, search/fetch endpoints,
> SESSION_SECRET) as required because its scanner treats every UNCOMMENTED
> 'VAR=' entry in .env.example as a required input. The application itself
> was already correct — validateEnvironment() enforces only the core
> config, and every integration fails honestly (not-configured + the
> required env var name) lazily when its capability is requested.
>
> - .env.example: scanner convention documented in the header; optional
>   integrations (search/fetch, SMTP, social tokens, CORS, NODE_ENV,
>   AKBARAL_ALLOW_PRIVATE_PROVIDER) now commented; core stays uncommented
>   with safe prefills, SESSION_SECRET the only input-needing entry.
>   No behavior change — dotenv treats commented entries identically.
> - src/config/env.test.ts (+3 tests, suite 366/366): production core
>   launch validates with ONLY DATABASE_URL + SESSION_SECRET and zero
>   integration credentials (SESSION_SECRET proven as the hard gate);
>   .env.example scanner contract locked (no optional var uncommented,
>   SESSION_SECRET the only empty entry).
> - deploy/free-snapdeploy/README.md: note on the scanner behavior + safe
>   empty-value fallback for stale scans.
>
> No credentials invented, faked, or weakened; SSRF/secret-redaction
> untouched; ZA141251SA untouched. tsc clean, build OK.
>

Verification paths changed: `src/config/env.test.ts`

- CI [34768341021](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34768341021): docker-publish — **success**, 2026-09-13T16:21:40Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
M	deploy/free-snapdeploy/README.md
M	src/config/env.test.ts
```

### `5c1f5a1` — ops(snapdeploy): exact deployment configuration + E2E graceful-failure fix

- Time: 2026-09-13T17:24:26+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/5c1f5a19b1565450f82cda4a096ef9edbf83e235
- Parents: `ed22583`
- Intent / implemented scope: ops(snapdeploy): exact deployment configuration + E2E graceful-failure fix

Recorded commit notes (historical claims):

> - deploy/free-snapdeploy/DEPLOYMENT.md: the exact container form values
>   (repo/branch, Dockerfile, port 3000 HTTP, Small 512MB, /api/health),
>   the complete 5-variable env list (3 secrets + TRUST_PROXY +
>   DISABLE_BACKUP_CRON, SEED_DATABASE only for an empty DB), boot
>   sequence, and post-deploy verification handoff.
> - scripts/verify-production-e2e.mjs: a failed/cancelled workflow now
>   produces a clean report (workflow status + error + observable credits)
>   and exits 1 instead of crashing on the missing task (found during the
>   production boot-path verification).
>
> Verified agent-side at ed22583+ (Docker is unavailable in the Arena
> sandbox, so the exact container path was booted locally in full
> production mode): entrypoint -> 14 migrations -> seed -> AKBARAL_ROLES=both
> -> API :4000 + web :3000; /api/health ok; /api/ready ready; full E2E
> PASS on the production boot path (fixture labelled, NOT production
> evidence); failure->refund proven with real DB transactions (consume -1
> -> automatic refund +1 on provider_not_configured, balance restored);
> zero key material on any surface. Suite 366/366, tsc clean, build OK.
>

Verification paths changed: `scripts/verify-production-e2e.mjs`

- CI [34771501473](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34771501473): production-verify — **failure**, 2026-09-13T17:24:29Z.
- CI [34771501471](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34771501471): docker-publish — **success**, 2026-09-13T17:24:29Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	deploy/free-snapdeploy/DEPLOYMENT.md
M	scripts/verify-production-e2e.mjs
```

### `615b838` — fix(preview): lock the Arena platform timeout copy as foreign + workspace secret-copy ignore rule

- Time: 2026-09-13T18:34:48+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/615b838891d8b39a8064cd5c912d384720fda13b
- Parents: `5c1f5a1`
- Intent / implemented scope: fix(preview): lock the Arena platform timeout copy as foreign + workspace secret-copy ignore rule

Recorded commit notes (historical claims):

> Diagnosis of 'The AI took too long to respond. Please try again.':
> zero occurrences in this codebase (source, bundles, surfaces) — it is
> the Arena assistant PLATFORM's response timeout, not an AKBARAL! error.
> Full request-path audit of the app itself found every layer healthy and
> correctly bounded: provider calls 60s default timeout (min 1s floor,
> AKBARAL_PROVIDER_TIMEOUT_MS) with AbortController; external HTTP 45s
> AbortController; OAuth 10s AbortSignal timeouts; execution queue 2
> attempts with backoff, 120s step / 900s workflow budgets; frontend has
> NO fetch timeout (long MASTER tasks poll every 1.5s and render honest
> 'still running' states — they can never be mislabeled as a timeout);
> WS->SSE fallback closes cleanly; preview supervisor healthy.
>
> - src/app/preview-stack.test.ts: platform-copy lock extended with
>   'the ai took too long to respond' — if any served surface ever
>   introduces that copy it becomes ambiguous with the platform message
>   and the test fails loudly.
> - .gitignore: SESSION_SECRET.txt (root-level workspace copy of the
>   deployment session secret for the SnapDeploy form — value never
>   committed; file verified identical to data/secrets/SESSION_SECRET by
>   sha256 fingerprint, not regenerated).
>
> Suite 366/366, tsc clean, build OK, live E2E PASS on the running
> preview (honest failure/refund path proven previously with real DB
> transactions).
>

Verification paths changed: `src/app/preview-stack.test.ts`

- CI [34775064741](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34775064741): docker-publish — **success**, 2026-09-13T18:34:52Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.gitignore
M	src/app/preview-stack.test.ts
```

### `4a13b03` — ZA141251SA final-build gap fill: owner identity, mission chat, revenue windows, hierarchy gates

- Time: 2026-09-13T20:26:25+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/4a13b035d4fc4edcc04c577f9e5fa8d8b5ea8eb4
- Parents: `615b838`
- Intent / implemented scope: ZA141251SA final-build gap fill: owner identity, mission chat, revenue windows, hierarchy gates

Recorded commit notes (historical claims):

> Section 4 — configured owner identity:
> - AKBARAL_OWNER_EMAIL (env, never hard-coded): the authorized owner's email
>   (their Google identity). Any active account with that email is promoted to
>   'owner' server-side at API boot, on password login, and on OAuth login —
>   one-way (never demotes), audited (owner_identity_promoted), suspended
>   accounts never promoted. The issued access token carries the new role.
>
> Section 5 — owner ↔ agent mission chat (owner-only, audited, redacted):
> - Migration 0015 (SQLite + PG twin): mission_chat_messages with thread index.
> - GET /api/economy/chat/threads, GET/POST /api/economy/agents/:slug/chat —
>   all behind the router's requireRole('owner','super_admin') guard.
> - Replies via the real model router only; honest structured failure
>   (provider_not_configured) when no provider — never a fabricated answer.
> - Only the agent's PUBLIC identity enters the model context; internal system
>   instructions, credentials and tenant data never leave the server.
>   Secrets redacted before storage AND on the way out; every message audited
>   (economy_events: mission_chat_owner_message / _agent_reply / _failed).
> - Owner console UI (#/economy): agent thread list, history, send box.
>
> Section 4 — dashboard revenue windows:
> - revenueWindows (today / 7d / 30d / lifetime, realized-only) in the owner
>   dashboard payload + console stat row; expected/pending never counted.
>
> Section 2 — child-agent hierarchy gates:
> - economy_policy: max_agent_depth (default 2), max_children_per_agent
>   (default 4), owner-tunable. expandCapability now rejects unknown parents,
>   over-depth chains, and over-cap parents — every rejection audited.
>
> Section 13 — PostgreSQL parity:
> - 4 new PG integration tests (mission chat storage/threads, revenue windows,
>   owner promotion, hierarchy depth/counts); fixed a real PG-only bug the
>   harness caught (correlated subquery over grouped columns in thread listing).
>
> Verification: tsc clean; build OK; suite 376/376 (SQLite; PG file auto-skips
> there); npm run test:pg 21/21 incl. 0015 on PGlite wire harness; live preview
> E2E all-pass; live proof: configured email login → owner role, mission chat
> 200 via real provider, dashboard windows honest $0, plain user 403 / anon 401.
>

Verification paths changed: `src/db/postgres.integration.test.ts`, `src/economy/economy.test.ts`, `src/economy/mission-chat.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
A	db/migrations-pg/0015_mission_chat.sql
A	db/migrations/0015_mission_chat.sql
M	public/app.js
M	src/app.ts
M	src/app/page.tsx
M	src/auth/oauth.ts
A	src/auth/owner-identity.ts
M	src/auth/service.ts
M	src/db/economy-repositories.ts
M	src/db/postgres.integration.test.ts
M	src/economy/economy.test.ts
A	src/economy/mission-chat.test.ts
A	src/economy/mission-chat.ts
M	src/economy/policy.ts
M	src/economy/report.ts
M	src/economy/treasury.ts
M	src/routes/economy.ts
```

### `77be80f` — docs: §15 final production build report — verified facts only, blockers marked

- Time: 2026-09-13T21:02:20+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/77be80fc209d148c8858b12f8fdc0384f825f2a2
- Parents: `4a13b03`
- Intent / implemented scope: docs: §15 final production build report — verified facts only, blockers marked

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI [34782589496](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34782589496): docker-publish — **success**, 2026-09-13T21:02:24Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	FINAL_BUILD_REPORT.md
```

### `637f660` — launch blocker closure: search hardening, full-journey QA lock, 2 real bug fixes, real-Gemini CI path, codename scrub

- Time: 2026-09-13T21:55:40+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/637f660e109dd28d0cf48096fc2756b822708645
- Parents: `77be80f`
- Intent / implemented scope: launch blocker closure: search hardening, full-journey QA lock, 2 real bug fixes, real-Gemini CI path, codename scrub

Recorded commit notes (historical claims):

> PHASE 2 (web search, production-ready):
> - query sanitization (control chars stripped, whitespace collapsed, 400-char cap)
> - controlled retry: one retry for transient failures only (5xx/429/network);
>   client 4xx is terminal — verified by fixture tests
> - in-process sliding-window rate limit (AKBARAL_SEARCH_RATE_LIMIT, default 60/min)
> - production HTTPS transport policy: cleartext search endpoints refused in
>   production unless an internal provider is explicitly trusted
> - non-http(s) search results (javascript:, relative, odd schemes) dropped from
>   both JSON and HTML parsing paths
>
> PHASE 3 (complete user-flow QA — permanent lock):
> - src/app/user-journey.test.ts: the full 22-step journey over real HTTP
>   (signup→login→session→dashboard→workspace→task→plan→agent→tools→execution→
>   verification→result→history→retry→upload/index/search→explorer→detail→
>   factory→settings→billing→logout→refresh rotation), plus credit accounting
>   (free trial 5, consume-only-on-success, provider-failure refund) and
>   authorization negatives (anonymous 401s, cross-tenant 404s, no client
>   credit bypass)
>
> Two REAL production bugs found by that QA, both fixed:
> 1. knowledge search 500: raw queries hit the FTS5 MATCH expression unquoted —
>    a hyphenated term ("zanzibar-quantum") parsed as a column reference and
>    threw. ftsSafeQuery() now quotes every token (works on SQLite FTS5 AND the
>    PostgreSQL websearch_to_tsquery translation); searchProjectKnowledge also
>    hardened; PG parity regression locked.
> 2. public category counts leaked private agents: listCategories() counted ALL
>    agents while the public catalog lists registry agents only — user-created
>    agents inflated public counts. Counts are now registry-only (owner_id IS
>    NULL), matching the documented public contract.
>
> PHASE 1 (real Gemini evidence channel):
> - scripts/verify-gemini-direct.ts: real request/response, real SSE streaming,
>   credential-failure classification (invalid key → status-classified error),
>   unconfigured classification, usage accounting — never prints key material
> - production-verify.yml: secret-gate job (presence only) + real-gemini-direct
>   job that runs the script from the GH runner (egress-capable) when
>   GOOGLE_API_KEY is configured as a repository secret
>
> PHASE 5 (security final pass):
> - private mission codename scrubbed from ALL client-served surfaces (SSR page
>   headings, app.js comments, styles.css) — genericized to "Private Owner
>   Console"; owner functionality unchanged, all data stays behind 403
> - regression lock: the codename must never reappear in page.tsx, layout.tsx,
>   app.js, styles.css, tokens.css
> - secret scan re-run: only placeholder/fixture patterns (values never printed)
>
> Verification: tsc clean; build OK; suite 398/398 (was 376); PG 21/21;
> live preview E2E all-pass on the new code; codename absent from live HTML+app.js.
>

Verification paths changed: `.github/workflows/production-verify.yml`, `scripts/verify-gemini-direct.ts`, `src/agents/web-research.test.ts`, `src/app/preview-stack.test.ts`, `src/app/user-journey.test.ts`, `src/db/postgres.integration.test.ts`

- CI [34785257325](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34785257325): production-verify — **failure**, 2026-09-13T21:55:44Z.
- CI [34785257283](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34785257283): docker-publish — **success**, 2026-09-13T21:55:44Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/production-verify.yml
M	public/app.js
M	public/styles.css
A	scripts/verify-gemini-direct.ts
M	src/agents/registry.ts
M	src/agents/web-research.test.ts
M	src/agents/web-research.ts
M	src/app/page.tsx
M	src/app/preview-stack.test.ts
A	src/app/user-journey.test.ts
M	src/db/platform-repositories.ts
M	src/db/postgres.integration.test.ts
M	src/test-support/research-fixture.ts
```

### `16ab16b` — docs: MASTER BUILD #2 report — blocker closure, verified facts, exact remaining user-side steps

- Time: 2026-09-13T21:59:50+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/16ab16bec99f46830e404b926f2803f2b5271365
- Parents: `637f660`
- Intent / implemented scope: docs: MASTER BUILD #2 report — blocker closure, verified facts, exact remaining user-side steps

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	MASTER_BUILD_2_REPORT.md
```

## Day 8 — 2026-09-14

### `cef9135` — MASTER Build #3: final product implementation (website-builder, versioned artifacts, owner entitlement, treasury transfers, group chat)

- Time: 2026-09-14T07:45:27+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/cef913515036ee846dc5df82c7d835e230991e8e
- Parents: `16ab16b`
- Intent / implemented scope: MASTER Build #3: final product implementation (website-builder, versioned artifacts, owner entitlement, treasury transfers, group chat)

Recorded commit notes (historical claims):

> PART 1/2 — MASTER workspace + dynamic previews:
> - versioned project artifacts (project_artifacts, append-only history, 0016 SQLite+PG)
> - planner injects the CURRENT website artifact (60k cap) into every step goal for
>   iterative editing; FIX: per-step goals are now persisted to workflow_steps
>   (specialist goals + artifact context previously never reached the agents)
> - workflow runner auto-captures full-HTML step output as the next artifact version
> - verifier FIX: a complete HTML document now counts as structured output for
>   substance verification (website deliverables were misclassified as unstructured)
> - projects API: GET latest/versions/v/:version/download, POST revert (undo = new
>   version, history never rewritten), POST manual capture (validated)
> - app.js: sandboxed iframe website preview (allow-scripts only, responsive
>   viewport toggle, open/download via Blob), JSON data table (≤8 cols/50 rows),
>   artifact version bar (undo/export/open), owner unlimited label
>
> PART 4 — owner unlimited entitlement (server-side):
> - reserveTaskCreditForUser: owner/super_admin bypasses consumption at the single
>   reservation point, audit-logged (owner.unlimited_execution); normal users keep
>   exact 5-trial accounting
>
> PART 5/6 — private console:
> - economy dashboard embeds systemHealth (readiness checks + uptime)
> - owner chat with an approved agent GROUP (1-5 registry agents, sequential real
>   per-agent threads, honest per-agent failures)
> - console panel for agent accounts + treasury transfers (propose/approve/reject)
>
> PART 8/10 — agent accounts + treasury transfers:
> - accounts DERIVED from the real ledger (revenue - costs - executed transfers)
> - proposeTreasuryTransfer: idempotency-key replay, field validation, blocks
>   amounts above realized surplus; decideTreasuryTransfer: same-decision replay
>   idempotent, OPPOSITE decision on a final transfer refused, approval re-validates
>   the live balance, execution posts exactly one ledger credit (agent_slug NULL,
>   category treasury_transfer, ref_id idempotency) — never recounted as agent revenue
>
> Tests: 398 -> 421 (+23): website-builder end-to-end (9), treasury/accounts (7),
> group chat (2), preview renderers (4), PG 0016 parity (1, PG suite 21 -> 22).
> Full suite 421/421, PG 22/22, tsc clean, build exit 0, live preview E2E all-pass,
> live isolation probes 401/403, codename-free public surfaces.
>

Verification paths changed: `src/app/result-state-contract.test.ts`, `src/app/website-builder.test.ts`, `src/db/postgres.integration.test.ts`, `src/economy/economy.test.ts`, `src/economy/mission-chat.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations-pg/0016_artifacts_transfers.sql
A	db/migrations/0016_artifacts_transfers.sql
M	public/app.js
M	public/styles.css
M	src/app/page.tsx
M	src/app/result-state-contract.test.ts
A	src/app/website-builder.test.ts
M	src/db/economy-repositories.ts
M	src/db/platform-repositories.ts
M	src/db/postgres.integration.test.ts
M	src/economy/economy.test.ts
M	src/economy/mission-chat.test.ts
M	src/economy/mission-chat.ts
M	src/economy/treasury.ts
M	src/orchestrator/executor.ts
M	src/orchestrator/planner.ts
M	src/orchestrator/verifier.ts
M	src/orchestrator/workflow-runner.ts
M	src/routes/economy.ts
M	src/routes/projects.ts
```

### `b633d04` — MASTER Build #3 final report

- Time: 2026-09-14T07:46:27+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/b633d047c57b01e6acb3ebd8c400b2f2ddde8478
- Parents: `cef9135`
- Intent / implemented scope: MASTER Build #3 final report

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI [34820413287](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34820413287): docker-publish — **success**, 2026-09-14T07:59:11Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	MASTER_BUILD_3_REPORT.md
```

### `a3c88d4` — MASTER Build #4: final implementation sprint (3-pane workspace, attachments, routing, artifact ops, platform console)

- Time: 2026-09-14T08:57:56+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a3c88d42a3c05a63a08768608240fa1a73f13a7a
- Parents: `b633d04`
- Intent / implemented scope: MASTER Build #4: final implementation sprint (3-pane workspace, attachments, routing, artifact ops, platform console)

Recorded commit notes (historical claims):

> §1 MASTER WORKSPACE — real three-pane layout:
> - LEFT: goal input, project select, ATTACHMENTS (upload into the project, tray with
>   remove, ids travel with the run), voice input (browser SpeechRecognition,
>   feature-detected, hidden when unsupported), task history (recent tasks, click to
>   re-open the real result)
> - CENTER: execution console + verified result (unchanged IDs/behavior)
> - RIGHT: preview canvas — project controls, versioned artifact bar (now with
>   Rename + Delete-version actions), project files (auth-fetched preview/download)
> - responsive 3→2→1 columns
>
> §2 DYNAMIC PREVIEW — new real renderers: image (auth-fetched <img> + download),
>   document (content + typed .md/.html export), business interactive form (fillable,
>   produces downloadable result), travel/shopping comparison cards (official https
>   links, rel=noopener, 'no official link' disclosed, NEVER fake-embedded), and an
>   honest CSS bar chart for numeric data tables
>
> §1 ROUTING — deterministic analyzer now routes the nine headline goals to real
>   specialist categories (image-generation, image-editing, documents, travel,
>   e-commerce, business-strategy, maps, data-analysis) instead of falling through
>   to generic research
>
> §3 PROJECT/VERSION SYSTEM — PATCH rename (current version; history keeps titles),
>   DELETE one version (latest shifts to next-highest), DELETE all versions of a
>   kind; every operation audited; cross-tenant 404s test-locked
>
> §1 ATTACHMENTS (server) — attachment_file_ids accepted on /api/workflows/master
>   (both routers) and /:id/run with ownership + single-claim validation (≤5);
>   ids flow queue-payload -> runWorkflow options -> first specialist task ->
>   files.task_id claim; executor attachment context carries the real file content
>
> §5 PRIVATE CONSOLE — dashboard platform section: registry total/active/inactive,
>   task totals by status, cost mix by ledger category, settlements total (all
>   derived, never fabricated) + console panel
>
> Tests: 421 -> 443 (+22): master routing 10, artifact management + attachments
> E2E 5 (incl. foreign-file 400, single-claim 400, content-reaches-provider),
> renderer contracts 5, dashboard platform stats 2. Suite 443/443 (52 files),
> PG 22/22, tsc clean, build exit 0, live E2E all-pass, live probes green
> (routing, 3-pane DOM, isolation, codename-free).
>

Verification paths changed: `src/app/master-routing.test.ts`, `src/app/result-state-contract.test.ts`, `src/app/website-builder.test.ts`, `src/economy/economy.test.ts`

- CI [34825404831](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34825404831): docker-publish — **success**, 2026-09-14T08:58:00Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/app.js
M	public/styles.css
A	src/app/master-routing.test.ts
M	src/app/page.tsx
M	src/app/result-state-contract.test.ts
M	src/app/website-builder.test.ts
M	src/db/platform-repositories.ts
M	src/economy/economy.test.ts
M	src/economy/report.ts
M	src/orchestrator/executor.ts
M	src/orchestrator/goal-analyzer.ts
M	src/orchestrator/queue.ts
M	src/orchestrator/workflow-runner.ts
M	src/routes/master.ts
M	src/routes/projects.ts
M	src/routes/workflows.ts
```

### `08e6dd6` — MASTER Build #4 final report

- Time: 2026-09-14T08:58:29+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/08e6dd6373f12c86b0f3c1029a70b403853a5320
- Parents: `a3c88d4`
- Intent / implemented scope: MASTER Build #4 final report

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	MASTER_BUILD_4_REPORT.md
```

### `da99164` — launch prep: refresh SnapDeploy deployment doc — 16 migrations, production-mode pre-flight evidence at a3c88d4 (dist boot path, prod gates, E2E pass); docs only

- Time: 2026-09-14T10:36:48+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/da99164d366d5b660993832860894bb1d4c0d62e
- Parents: `08e6dd6`
- Intent / implemented scope: launch prep: refresh SnapDeploy deployment doc — 16 migrations, production-mode pre-flight evidence at a3c88d4 (dist boot path, prod gates, E2E pass); docs only

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	deploy/free-snapdeploy/DEPLOYMENT.md
```

### `a6e6e77` — free-tier realtime: SSE-only production transport (AKBARAL_REALTIME_TRANSPORT=sse) + 2 real fixes found by verification

- Time: 2026-09-14T11:52:13+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a6e6e77a4597360fb61223816cfdb093ba59165d
- Parents: `da99164`
- Intent / implemented scope: free-tier realtime: SSE-only production transport (AKBARAL_REALTIME_TRANSPORT=sse) + 2 real fixes found by verification

Recorded commit notes (historical claims):

> SnapDeploy Free does not proxy WebSocket upgrades (that capability is gated
> behind the paid Always-On plan). This makes AKBARAL deployable on Free Small
> with auto-sleep while preserving identical realtime functionality:
>
> 1. AKBARAL_REALTIME_TRANSPORT=sse (opt-in, production): the authenticated
>    WebSocket upgrade path is not registered; a minimal handler refuses and
>    destroys every upgrade attempt immediately (verified empirically: with no
>    handler Node leaves the handshake dangling until the client times out —
>    the explicit 403 makes the browser's existing SSE fallback engage in ~10ms).
>    Default (unset/'ws') keeps WebSockets byte-for-byte — local dev unchanged.
>    Startup log honestly reports the active transport.
>
> 2. FIX (real bug, found by live verification): Next's built-in gzip
>    compression buffered proxied text/event-stream responses to zero bytes in
>    dev AND production (Accept-Encoding: identity streamed; gzip did not).
>    next.config.mjs now sets compress: false — browsers cannot opt out of gzip
>    on EventSource, so this is the correct server-side fix. Regression-locked
>    by a source-contract test.
>
> 3. FIX (real bug, found by live verification): the SSE tail loop never
>    initialized its cursor when the initial replay was empty — a client that
>    subscribed BEFORE the first log existed (the normal browser flow at task
>    dispatch) received nothing at all, forever. The tail now always queries
>    (listExecutionLogsAfter with an empty cursor returns from the beginning).
>    Regression-locked by an early-connector test.
>
> Tests: 446 -> 448 (+5 total: default-mode registration, fast WS refusal,
> SSE auth 401/403 + real-log streaming, SSE early-connector, compress lock).
> Suite 448/448 (52 files), PG 22/22, tsc clean, build exit 0.
>
> Live verification (all this session):
> - default mode: REALTIME_OK via scripts/ws-sse-verify.ts (WS 16 msgs + SSE 8 msgs
>   through the same live stack) + full E2E ALL CHECKS PASSED
> - production SSE-only mode (NODE_ENV=production, dist artifacts, prod gates):
>   WS refused in 13ms; SSE early-connector with browser gzip acceptance streams
>   from dispatch (8 events); full E2E ALL CHECKS PASSED; startup log reports
>   'realtime logs at /api/executions/:id/events (SSE-only mode)'
> - secret scan: unchanged known-benign fixture set
>
> deploy/free-snapdeploy/DEPLOYMENT.md: AKBARAL_REALTIME_TRANSPORT=sse added to
> the env list with the free-tier realtime explanation. No Always-On purchase,
> no feature removal, no API changes, no security changes.
>

Verification paths changed: `src/app/result-state-contract.test.ts`, `src/realtime/execution-stream.test.ts`

- CI [34840387670](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34840387670): docker-publish — **success**, 2026-09-14T11:52:16Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	deploy/free-snapdeploy/DEPLOYMENT.md
M	next.config.mjs
M	src/app/result-state-contract.test.ts
M	src/index.ts
M	src/realtime/execution-stream.test.ts
M	src/realtime/execution-stream.ts
M	src/routes/realtime.ts
```

### `e717c81` — Build #5: Arena-style workspace UX (web + Android)

- Time: 2026-09-14T14:56:53+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e717c8198d0f6dac8e196c3fc95b769524b7d9da
- Parents: `a6e6e77`
- Intent / implemented scope: Build #5: Arena-style workspace UX (web + Android)

Recorded commit notes (historical claims):

> Restructure the MASTER screen into the platform workspace spatial model
> while keeping AKBARAL!'s own branding, tokens and visual identity.
>
> Spatial structure (identical on web and Android):
> - LEFT : full project/book/file area + live preview canvas, with the
>          download/export control ABOVE the preview and the artifact
>          version bar under it.
> - RIGHT: AKBARAL! brand header at the top, then the main MASTER chat:
>          real conversation turns (goal -> plan -> live step activity ->
>          verified result), activity stream, history/environment drawers
>          and the goal composer.
> - <=1080px (web) / <900dp (Android): the panes SWITCH via a pane
>   control instead of shrinking the desktop grid; the composer sticks to
>   the bottom with safe-area padding and touch-sized targets.
>
> Real defects found and fixed while restructuring:
> - The artifact bar's Export / Open controls were plain <a href> links to
>   bearer-only endpoints (they returned 401). They are now auth-fetched
>   (authedDownload / openArtifactBlob) and mirrored by the export bar.
> - setCoreState('success') wrote data-state="success" while the
>   stylesheet keys success on [data-state="ok"], so completed runs never
>   showed the success colour.
> - Android: a deep-linked project could snap back when switching project
>   chips (now applied once per requested id).
>
> Verified: npm run typecheck, npm run build (17 routes), full npm test
> suite (53 files, exit 0), new workspace-ux contract suite (21 tests),
> responsive/result-state/preview-stack contracts, mobile tsc --noEmit and
> a real `expo export --platform android` bundle. Live preview journey:
> register -> project -> MASTER run -> completed -> website artifact v1
> captured -> authenticated download 200 / unauthenticated 401.
>
> See WORKSPACE_REDESIGN_REPORT.md.
>

Verification paths changed: `src/app/responsive-contract.test.ts`, `src/app/workspace-ux-contract.test.ts`

- CI [34858936484](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34858936484): docker-publish — **success**, 2026-09-14T14:56:59Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	WORKSPACE_REDESIGN_REPORT.md
M	mobile/App.tsx
M	mobile/package-lock.json
M	mobile/package.json
M	mobile/src/components/ui.tsx
M	mobile/src/screens/MasterScreen.tsx
M	mobile/src/screens/WorkspaceScreen.tsx
M	public/app.js
M	public/styles.css
M	scripts/preview/gemini-fixture-server.mjs
M	src/app/layout.tsx
M	src/app/page.tsx
M	src/app/responsive-contract.test.ts
A	src/app/workspace-ux-contract.test.ts
```

### `952392a` — Launch pass: owner unlimited execution, honest factory errors, race-safe secret gate

- Time: 2026-09-14T17:18:14+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/952392a457ee05391905d61a8094da0a16816f7d
- Parents: `e717c81`
- Intent / implemented scope: Launch pass: owner unlimited execution, honest factory errors, race-safe secret gate

Recorded commit notes (historical claims):

> Blockers found and fixed in this pass (all regression-locked):
>
> 1. Agent Factory business failures answered HTTP 500. Typed FactoryError
>    (validation_error/forbidden/not_found) replaces every plain throw, the
>    route wraps every factory call in factoryCall -> businessErrorToHttp, and
>    the shared mapper now maps validation_error -> 400 and conflict -> 409.
>    Covered by user-journey test 18b (400 + code, 404, valid lifecycle, 403
>    for a non-owner).
>
> 2. Owner/super_admin unlimited execution was unreachable at a zero balance:
>    the requires_pro pre-flight gates in createResearchTask/createAgentTask ran
>    before reserveTaskCreditForUser, the single place the role entitlement was
>    applied (verified live: owner at 0 credits -> 402). New
>    src/auth/entitlements.ts (hasUnlimitedTaskCredits) makes both gates and the
>    automation scheduler's two credit gates entitlement-aware. Normal-user
>    accounting is unchanged (consume one per success, requires_pro at zero, no
>    task row when refused) and asserted in src/orchestrator/owner-entitlement.test.ts.
>
> 3. scripts/scan-secrets.ts could crash (ENOENT) and report a false FAIL when a
>    file disappeared mid-walk (the suite recreating test.db); the walker now uses
>    readdirSync withFileTypes so a security gate cannot fail on a moving tree.
>
> Also included from this pass and earlier work: production search-provider layer
> (tavily/brave/serper/google_cse/endpoint/keyless ddg, credential-free status
> reporting), env/credentials honesty fixes, logout audit fix, registry-audit
> preflight guard, provider fixture speaking the Tavily search protocol, and the
> launch report (FINAL_LAUNCH_REPORT.md).
>
> Evidence: full suite 56 files / 499 tests / 499 pass / 0 fail; typecheck PASS;
> production build exit 0; test:pg 22/22; audit:registry PASS (4,001 contracts);
> scan:secrets PASS; mobile tsc PASS + Android bundle hash unchanged; live
> production-mode E2E (owner entitlement, free-trial accounting, SSE, files,
> MASTER artifact + export, honest provider-less failure with refund).
>

Verification paths changed: `scripts/audit-registry.ts`, `src/agents/search-providers.test.ts`, `src/app/user-journey.test.ts`, `src/config/env.test.ts`, `src/orchestrator/owner-entitlement.test.ts`, `src/security/scan-secrets.test.ts`, `src/server/app.test.ts`

- CI [34873932450](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34873932450): docker-publish — **failure**, 2026-09-14T17:18:17Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
A	FINAL_LAUNCH_REPORT.md
M	scripts/audit-registry.ts
M	scripts/preview/gemini-fixture-server.mjs
A	scripts/scan-secrets-allowlist.json
M	scripts/scan-secrets.ts
A	src/agents/search-providers.test.ts
A	src/agents/search-providers.ts
M	src/agents/web-research.ts
M	src/app/user-journey.test.ts
A	src/auth/entitlements.ts
M	src/automation/scheduler.ts
M	src/config/credentials.ts
M	src/config/env.test.ts
M	src/orchestrator/agent-factory.ts
M	src/orchestrator/executor.ts
A	src/orchestrator/owner-entitlement.test.ts
M	src/routes/auth.ts
M	src/routes/factory.ts
A	src/security/scan-secrets.test.ts
M	src/server/app.test.ts
M	src/server/http.ts
```

## Day 9 — 2026-09-15

### `7d0700f` — Owner console: real business, cost, health and audit visibility for the owner

- Time: 2026-09-15T04:32:48+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/7d0700f31a62bdfa85e9f0aa96ad3b43f01b5eb0
- Parents: `952392a`
- Intent / implemented scope: Owner console: real business, cost, health and audit visibility for the owner

Recorded commit notes (historical claims):

> Builds the AKBARAL! owner dashboard on top of real platform data — no metric is
> estimated, sampled or inferred.
>
> Backend (`/api/owner`, owner|super_admin only via requireAuth + requireRole):
>   · GET /dashboard — users, signups, plans, subscriptions, payments/revenue,
>     credit consumption, tasks, agents, storage and system health in one payload
>   · GET /growth?days · /revenue?days — windowed signup and revenue series
>   · GET /costs — API/storage/compute cost position, reporting
>     `externalProviderCosts.available:false` instead of inventing provider spend
>   · GET /health — queue, worker, database and registry integrity
>   · GET /audit?limit — recent platform audit entries
>
> Revenue separation: the payload declares
> `platformRevenue: 'akbaral-customer-revenue'` and marks the private mission
> ledger as excluded; this module reads only customer tables and never opens the
> mission database. The owner codename never appears in a served payload
> (regression-locked in the test battery).
>
> UI: `/owner` (noindex, not linked from the public site or sitemap) with Business,
> Costs & margin and System health tabs, driven by the same API and the existing
> design tokens.
>
> Tests: src/business/owner-analytics.test.ts — 12 tests covering the authorization
> matrix (anonymous 401, normal user 403, owner/super_admin 200), reconciliation
> against live database counts, ledger separation and the no-estimates honesty
> rules. Full suite: 550/550.
>

Verification paths changed: `src/business/owner-analytics.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app.ts
A	src/app/owner/owner-console.tsx
A	src/app/owner/page.tsx
A	src/business/owner-analytics.test.ts
A	src/business/owner-analytics.ts
A	src/routes/owner.ts
```

### `6a09600` — Private mission system: separate app, database, treasury, auth and dashboard

- Time: 2026-09-15T04:32:54+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/6a09600d094da903a604eda60c9fdbd39d3ee06b
- Parents: `7d0700f`
- Intent / implemented scope: Private mission system: separate app, database, treasury, auth and dashboard

Recorded commit notes (historical claims):

> A complete, self-contained mission application that shares nothing with the
> customer platform at runtime: its own process and port, its own database and
> schema, its own owner authentication and secrets, its own ledger and treasury.
>
> Schema (`db/migrations-mission/0001_mission.sql`, 26 tables): agents with
> expandable parent/depth hierarchy, contract-gated sub-agent creation, wallets
> with CHECK-protected balances, hash-chained ledger and audit chains, revenue
> with realized/expected/contracted states and idempotency keys, expenses,
> encrypted credentials (+ rotation history), resources/upgrades/services, tool
> catalog, targets, four payout slots, payouts, approvals, reports and policy.
>
> Runtime (`src/mission/*`):
>   · policy — 14 approved activity categories, 15 compiled-in prohibitions that
>     configuration cannot enable, kill switch, spend ceilings, approval routing.
>     The kill switch now fails every activity check closed (found by test).
>   · auth — scrypt owner accounts, hashed rotating sessions, scoped/expiring/
>     use-limited access links, AES-256-GCM credential vault, audit redaction.
>   · treasury — hash-chained money movements, verified-only realized revenue
>     (received + verifier), revenue swept from agent wallets into the mission
>     treasury, expenses with approval thresholding, four configurable payout
>     destinations, owner-approved payouts that require a provider settlement
>     reference, automatic refund on failure. `spent_cents` now tracks operating
>     spend only (internal transfers and payouts are movements, not spend) so
>     budget checks stay meaningful — a real accounting bug the tests caught.
>   · self-management — default-deny tool catalog with a permanently blocked
>     card/bank API (owner action cannot enable it; re-seeding restores the
>     block), credential store/rotate/revoke/expiry sweep, resources, upgrades,
>     services with recorded health sources.
>   · reporting — per-agent attribution (revenue source, work, expenses,
>     upgrades, wallet, credentials, services, audit) and the mission overview;
>     targets are labelled targets whose progress counts verified receipts only.
>   · server — private HTTP app + dashboard assets; nested transactions now use
>     savepoints (a real bug that broke contract-based agent creation).
>
> Hardening: owner decisions (expense, payout, resource, upgrade, tool,
> credential, payout destination) are refused for an agent actor at the library
> level, not only at the route layer.
>
> CLI: `npm run mission:init` (migrations, policy, tools, slots, owner),
> `npm run mission:sync-registry` (one-way read-only export of the platform
> roster — verified live with 4,001 agents, no live join), `npm run mission:serve`.
>
> Dashboard (`mission-dashboard/`): private owner console — overview with real
> versus unrealized revenue, targets, integrity chains, pending external
> activations, agents with full reports, treasury/payouts/approvals, tools and
> credentials, policy with the kill switch, and the audit trail. Vanilla
> HTML/CSS/JS, no external assets, strict CSP, framing denied, tokens removed
> from the address bar.
>
> Tests (39, all passing): mission-core (isolation, migrations, policy denials,
> kill switch, auth rotations, link scoping, vault round-trip, redaction, audit
> tamper detection), mission-treasury (ledger integrity, revenue honesty and
> idempotency, expense routing, payout lifecycle incl. failure refund, credential
> lifecycle, self-management), mission-server (anonymous refusals, owner login,
> agent-bound links, contract-based sub-agents, targets, payout surface, private
> dashboard headers, reporting honesty).
>
> Deployment, isolation and external-activation requirements: MISSION_SYSTEM.md.
>

Verification paths changed: `src/mission/mission-core.test.ts`, `src/mission/mission-server.test.ts`, `src/mission/mission-treasury.test.ts`

- CI [34929258991](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34929258991): docker-publish — **failure**, 2026-09-15T04:33:00Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.gitignore
A	MISSION_SYSTEM.md
A	db/migrations-mission/0001_mission.sql
A	mission-dashboard/app.js
A	mission-dashboard/index.html
A	mission-dashboard/styles.css
M	package.json
A	scripts/mission-init.ts
A	scripts/mission-serve.ts
A	scripts/mission-sync-registry.ts
A	src/mission/auth.ts
A	src/mission/database.ts
A	src/mission/mission-core.test.ts
A	src/mission/mission-server.test.ts
A	src/mission/mission-treasury.test.ts
A	src/mission/policy.ts
A	src/mission/reporting.ts
A	src/mission/self-management.ts
A	src/mission/server.ts
A	src/mission/treasury.ts
```

### `82feb0c` — Task 2 final report: owner console + private mission system, verification results and remaining external actions

- Time: 2026-09-15T04:33:17+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/82feb0c8451723147e258f033a134517893d46b8
- Parents: `6a09600`
- Intent / implemented scope: Task 2 final report: owner console + private mission system, verification results and remaining external actions

Recorded commit notes (historical claims):

> - exact commits, all gates (550/550 tests, test:pg 22/22, build, secret scan, registry audit, live smokes)
> - lists the seven real bugs the new tests surfaced and fixed
> - AKBARAL! and mission deliverables, and the only remaining external-provider actions
>

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	TASK2_FINAL_REPORT.md
```

### `c6267d4` — Task 3: launch verification, real payment webhooks, payout verification, social OAuth, mission PostgreSQL

- Time: 2026-09-15T11:46:29+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/c6267d4667abb455656a64b1179ea964444d96cf
- Parents: `82feb0c`
- Intent / implemented scope: Task 3: launch verification, real payment webhooks, payout verification, social OAuth, mission PostgreSQL

Recorded commit notes (historical claims):

> Prepares AKBARAL! for final launch by implementing everything that does not
> require the owner's credentials or dashboard action, and by making every
> remaining gap measurable instead of assumed.
>
> 1. Launch verification (src/launch/checks.ts, scripts/launch-check.ts, npm run launch:check)
>    13 checks across secrets, domain, database, registry, Gemini, search, payments,
>    checkout return URLs, email, storage, backups, the mission system and social
>    OAuth. Each check is a configuration fact or a LIVE provider probe, classified
>    as ready / not_configured / failed / unreachable / optional, with the exact
>    owner action attached. Reports carry variable NAMES and status codes only —
>    never a secret. A missing credential is never reported as ready, and an
>    unverified one is never reported as verified.
>
> 2. Stripe-native webhook (src/billing/stripe.ts, POST /api/billing/webhook/stripe)
>    Real signature verification over the RAW body (HMAC-SHA256 over
>    timestamp.payload, constant-time, 5-minute replay tolerance, multiple v1
>    signatures for rotation), event-id idempotency so a retry cannot settle twice,
>    and normalization onto the internal billing contract. Only events attributable
>    to OUR invoice are treated as payments; unknown or unattributable events are
>    recorded as ignored. A missing signing secret answers 503, never success.
>
> 3. Checkout return URLs (src/billing/checkout-urls.ts)
>    Replaced the hardcoded akbaral.local placeholders with AKBARAL_SITE_URL /
>    AKBARAL_CHECKOUT_*_URL resolution, so customers always return to this
>    deployment's own domain.
>
> 4. Mission payout-destination verification (src/mission/payout-verification.ts, src/mission/destination-safety.ts, migration 0003)
>    Evidence-based verification: every required control check must be confirmed and
>    the owner must sign an attestation (stored verbatim) before a slot becomes
>    payable; partial submissions are refused by name; verifications EXPIRE (180d)
>    and are invalidated when the destination is repointed, pausing the slot so
>    payouts stop; revocation pauses immediately. Card numbers (Luhn) and IBANs
>    (mod-97) are refused at write time — the mission never stores instrument
>    credentials. Agent actors are refused at the library level.
>
> 5. Social publishing OAuth (src/social/platforms.ts, src/mission/social.ts, migration 0002)
>    Complete authorization-code flow for YouTube/Instagram/TikTok with minimum
>    scopes, single-use owner-bound state + PKCE, tokens stored AES-256-GCM in the
>    vault and never returned by any read surface, honest provider_not_configured /
>    provider_rejected / provider_unreachable failures, and no synthesized engagement.
>    Dashboard gains a Publishing tab showing the exact redirect URI to register.
>
> 6. Mission PostgreSQL support (src/mission/database.ts, migrations 0004, scripts/mission-pg-check.ts)
>    The mission now runs on SQLite or PostgreSQL through the same driver bridge
>    (isolation unchanged: own connection, own migrations, own auth, own treasury).
>    The ledger's implicit rowid ordering became an explicit `seq` column with a
>    backfilled hash chain, and migration 0001 is ordered by foreign-key dependency
>    so one schema definition works on both engines. npm run mission:pg-check proves
>    the whole money path on a real PostgreSQL server (10 checks, 0 failures).
>
> Gates: npm test 598/598 · build 20 routes · test:pg 22/22 · mission tests 55/55 ·
> mission:pg-check 10/10 · scan:secrets PASS.
>

Verification paths changed: `src/billing/stripe-webhook.http.test.ts`, `src/billing/stripe-webhook.test.ts`, `src/launch/checks.test.ts`, `src/mission/mission-payout-verification.test.ts`, `src/mission/mission-social.test.ts`

- CI [34965111096](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34965111096): docker-publish — **failure**, 2026-09-15T11:46:34Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
M	.gitignore
M	MISSION_SYSTEM.md
A	TASK3_LAUNCH_CHECK.md
M	db/migrations-mission/0001_mission.sql
A	db/migrations-mission/0002_social.sql
A	db/migrations-mission/0003_payout_verification.sql
A	db/migrations-mission/0004_ledger_sequence.sql
M	docs/DEPLOYMENT.md
M	mission-dashboard/app.js
M	mission-dashboard/index.html
M	package.json
A	scripts/launch-check.ts
A	scripts/mission-pg-check.ts
M	src/app.ts
A	src/billing/checkout-urls.ts
M	src/billing/service.ts
A	src/billing/stripe-webhook.http.test.ts
A	src/billing/stripe-webhook.test.ts
A	src/billing/stripe.ts
A	src/launch/checks.test.ts
A	src/launch/checks.ts
M	src/mission/database.ts
A	src/mission/destination-safety.ts
A	src/mission/mission-payout-verification.test.ts
A	src/mission/mission-social.test.ts
A	src/mission/payout-verification.ts
M	src/mission/server.ts
A	src/mission/social.ts
M	src/mission/treasury.ts
M	src/routes/billing.ts
A	src/social/platforms.ts
```

### `e4f804d` — Task 3 report + live smoke harness

- Time: 2026-09-15T11:57:00+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e4f804d7edd6b1784eae3143f6a82c2d9d93cd95
- Parents: `c6267d4`
- Intent / implemented scope: Task 3 report + live smoke harness

Recorded commit notes (historical claims):

> TASK3_FINAL_REPORT.md records what this window delivered, the gate evidence
> (598/598 tests, build, test:pg 22/22, mission:pg-check 10/10, mission 55/55,
> registry audit, secret scan, 39/39 live smoke), the exact remaining blockers
> and owner actions, and the evidence-based launch readiness figure (44.4% of
> required checks verified ready).
>
> scripts/live-smoke-task3.mjs (npm run smoke:task3) is the live harness used for
> the evidence above: it drives a RUNNING deployment and asserts real state
> changes and real refusals — signed settlement grants credits exactly once,
> replays are idempotent, forgeries are refused, unsafe payout destinations are
> refused, partial verifications are refused by name, and publishing is never
> reported as connected without a real token.
>

Verification paths changed: `scripts/live-smoke-task3.mjs`

- CI [34966080700](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34966080700): docker-publish — **failure**, 2026-09-15T11:57:06Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	TASK3_FINAL_REPORT.md
M	package.json
A	scripts/live-smoke-task3.mjs
```

### `cdedc5a` — Add Facebook OAuth provider (Google/GitHub/Facebook sign-in)

- Time: 2026-09-15T13:54:22+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/cdedc5a134fee09084759424d117626b94863041
- Parents: `e4f804d`
- Intent / implemented scope: Add Facebook OAuth provider (Google/GitHub/Facebook sign-in)

Recorded commit notes (historical claims):

> The workspace sign-in surface must offer Google, GitHub and Facebook through
> the existing server-side OAuth flow. Google and GitHub already existed; this
> adds Facebook to the same registry (Graph API v19.0 dialog + token + /me),
> using the same state/PKCE/link protections — no parallel auth path.
>
> Honesty/security posture: Facebook's Graph API does not return an email
> ownership assertion in the standard profile response, so the address is
> treated as UNVERIFIED and never auto-links to an existing password account
> (explicit linking from Settings still works) — the same rule already applied
> to Microsoft. Credentials come from FACEBOOK_CLIENT_ID/SECRET and the
> provider reports itself as not configured (with the required names) until an
> operator sets them.
>
> Tests: facebook fixture + full flow + takeover-block coverage; the provider
> listing now asserts five providers. OAuth suite 20/20.
>

Verification paths changed: `src/auth/oauth.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.env.example
M	docs/LAUNCH_READINESS.md
M	docs/ROADMAP.md
M	docs/production-readiness.md
M	src/auth/oauth.test.ts
M	src/auth/oauth.ts
M	src/db/oauth-repositories.ts
```

### `0ac2b9f` — Task 4: the AKBARAL! application shell (sidebar / conversation / artifact rail)

- Time: 2026-09-15T13:54:36+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/0ac2b9f6dd802541c24dcfa1da6b2800fae536d5
- Parents: `cdedc5a`
- Intent / implemented scope: Task 4: the AKBARAL! application shell (sidebar / conversation / artifact rail)

Recorded commit notes (historical claims):

> Replaces the long-scrolling MASTER page with ONE compact application screen,
> in AKBARAL!'s own identity, on the real pipeline (nothing faked):
>
>   LEFT   sidebar - brand + tagline, New chat, Search, Library, Images &
>          media, Projects, Files, Agents, Automations, Billing, real recent
>          history, and the account block (profile, settings, owner console
>          when the role holds it, sign out).
>   CENTER the MASTER conversation - header, live activity stream, real turns,
>          composer with attach / Files & artifacts controls and voice input.
>   RIGHT  artifact rail - the download/export control ABOVE the live preview
>          canvas plus Files / Library / Images panels behind the rail tabs.
>
> - /workspace is now a real route (same application as the #/master hash
>   screen): the client opens MASTER on a clean path, an explicit hash still
>   wins, and the marketing chrome steps aside while the shell owns the
>   viewport.
> - Every new control is bound to a real screen or a real API: Library reads
>   /api/tasks (opening a row restores the stored result), Images reads project
>   image files + image artifacts, Search queries tasks, projects and the
>   knowledge index, Files lists uploaded AND generated artifacts with real
>   canvas / download actions, the rail collapses and remembers the choice.
> - Attachments: fixed the upload path (POST /api/projects/:id/files) - the old
>   /api/files/projects/:id/files 404'd, so attach failed silently before.
> - Auth: provider buttons are real server-side OAuth links; unconfigured
>   providers render disabled with the exact credential names they need.
> - Owner access: sign-in honours an explicit same-origin "next" path, the
>   owner entry appears only for owner/super_admin, and RBAC on /api/owner/* is
>   untouched (ordinary accounts still receive 403).
> - Mobile: sidebar becomes a drawer, panes SWITCH instead of squeezing, and a
>   320px floor keeps the top bar, rail tabs and controls inside the viewport.
>
> Tokens only - no literal colours in the shell; re-skinning stays a
> design-system/tokens.json edit (public/tokens.css regenerated by build.mjs).
>
> Verification: tsc clean; npm test 605/605 across 65 files; production build
> green (/workspace prerendered); npm run smoke:shell 34/34 against the live
> stack (sign-in, panels, search, a real MASTER run, new chat, collapse /
> drawer / pane switch, sign-out) with no runtime problems; live smoke of the
> tasks, projects, files, artifacts and knowledge-search endpoints plus the
> honest provider-not-configured workflow failure (credit refunded).
>
> Contract tests: the two workspace-geometry suites are re-specified to the new
> spatial model at equal strictness (CENTER conversation + bounded RIGHT rail,
> sidebar mounts, real bindings, /workspace route, drawer + pane switch) -
> every behavioural assertion (real chat turns, real payload driving the
> canvas, honest failure copy, preview isolation, pane switching, Android
> parity) is retained. Adds scripts/live-shell-smoke.mjs (+ devDependency
> jsdom) and a Build #6 section in docs/DESIGN.md.
>

Verification paths changed: `scripts/live-shell-smoke.mjs`, `src/app/responsive-contract.test.ts`, `src/app/workspace-ux-contract.test.ts`

- CI [34978091793](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34978091793): docker-publish — **failure**, 2026-09-15T13:54:42Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.gitignore
M	docs/DESIGN.md
M	package-lock.json
M	package.json
M	public/app.js
M	public/styles.css
A	scripts/live-shell-smoke.mjs
M	src/app/layout.tsx
M	src/app/page.tsx
M	src/app/responsive-contract.test.ts
M	src/app/workspace-ux-contract.test.ts
A	src/app/workspace/page.tsx
```

### `e63936b` — Task 4 report: application shell, verification evidence and remaining external config

- Time: 2026-09-15T13:54:55+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e63936be921eadcb503212b963bb9d4391abff39
- Parents: `0ac2b9f`
- Intent / implemented scope: Task 4 report: application shell, verification evidence and remaining external config

Recorded commit notes (historical claims):


Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	TASK4_UI_REPORT.md
```

### `8af46b8` — Task 4 verification harnesses, offline model stub and export-bar fix

- Time: 2026-09-15T14:45:57+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/8af46b88c31630c4800784e859964b8a856a5757
- Parents: `e63936b`
- Intent / implemented scope: Task 4 verification harnesses, offline model stub and export-bar fix

Recorded commit notes (historical claims):

> Closes out Task 4 with repeatable proof of the deliverable half of the
> workspace and one real bug the new proof exposed.
>
> Added
> - scripts/local-model-fixture.ts (`npm run fixture:model`): a development
>   stand-in for a language model that speaks the OpenAI-compatible protocol, so
>   the REAL pipeline (planner -> specialists -> verifier -> synthesis ->
>   versioned website-artifact capture) runs end to end where no external AI
>   credentials exist. Every document it returns carries a visible footer saying
>   a local stub produced it; production sets a real provider key and never
>   starts it (docs/DEPLOYMENT.md documents both).
> - scripts/live-artifact-smoke.mjs (`npm run smoke:artifacts`): self-contained
>   27-check proof on a throwaway database - migration, real API server, real
>   multipart upload, real MASTER run, versioned website artifact, versions /
>   single-version / download byte-exact, the calculator in the artifact really
>   evaluates, re-capture versions instead of overwriting, impossible captures
>   refused, un-captured kinds empty, one successful run consumes one credit,
>   knowledge search answers. Children are spawned detached and killed with
>   their process group so nothing leaks.
>
> Extended
> - scripts/live-shell-smoke.mjs: now provisions a real project, selects it in
>   the shell and branches on the configured provider - success path asserts the
>   captured document renders in the sandboxed preview frame, the export control
>   names the stored version and the Files rail lists uploaded + generated
>   entries (43/43); failure path asserts nothing is faked and the export bar
>   never names a version the server does not store (39/39). Both runs report no
>   runtime problems.
>
> Fixed
> - public/app.js: after a successful run the export control above the canvas
>   still read "No website version yet" until the project was re-selected. The
>   run's completion path now refreshes the export bar and the Files rail as
>   well as the artifact bar.
>
> Housekeeping
> - Asset version bumped in lockstep (tokens.css / styles.css / app.js ->
>   ?v=akbaral-lux-10), including the stale pin in scripts/verify-production-e2e.mjs.
> - docs/DESIGN.md gains the application-shell model (zones, grid rules,
>   token-only re-skinning, honest-content rules).
> - TASK4_UI_REPORT.md records the implementation, the verification evidence and
>   the one remaining browser limitation.
>
> Verification: tsc clean; npm test 65 files / 605 tests / 0 failures; production
> build green (/workspace prerendered); smoke:artifacts 27/27; smoke:shell 43/43
> (provider configured) and 39/39 (provider unreachable); live /, /workspace,
> /owner 200 and owner RBAC 200 vs ordinary account 403.
>

Verification paths changed: `scripts/live-artifact-smoke.mjs`, `scripts/live-shell-smoke.mjs`, `scripts/verify-production-e2e.mjs`

- CI [34983863518](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34983863518): docker-publish — **failure**, 2026-09-15T14:46:03Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	TASK4_UI_REPORT.md
M	docs/DEPLOYMENT.md
M	docs/DESIGN.md
M	package.json
M	public/app.js
A	scripts/live-artifact-smoke.mjs
M	scripts/live-shell-smoke.mjs
A	scripts/local-model-fixture.ts
M	scripts/verify-production-e2e.mjs
M	src/app/layout.tsx
```

### `85497a2` — API root redirect honours the configured public web URL (preview ingress)

- Time: 2026-09-15T15:20:09+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/85497a25557f847ed6aeda6f3efd56aaa13cb9bb
- Parents: `8af46b8`
- Intent / implemented scope: API root redirect honours the configured public web URL (preview ingress)

Recorded commit notes (historical claims):

> The API tier answered `GET /` with a hardcoded `http://localhost:3000/`.
> Behind a preview/ingress proxy that bounces the visitor's browser to its own
> machine — which reads as "the preview is blocked". It now redirects to
> AKBARAL_PUBLIC_WEB_URL (falling back to the local dev web tier), so a browser
> reaching the API port through the proxy lands on the real public app origin.
>
> Verified live: `GET :4000/` -> 302 `https://3000-<sandbox>.e2b.app/`;
> /workspace 200, /owner 200, /api/health ok, smoke:shell 43/43.
>

Verification paths changed: none in this commit.

- CI [34987749205](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34987749205): docker-publish — **failure**, 2026-09-15T15:20:13Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app.ts
```

### `a1126c8` — fix(workspace): every "Workspace" entry point opens the compact app shell

- Time: 2026-09-15T15:50:53+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a1126c8f3fdc8e37419eb9c9c9f25b22292785bf
- Parents: `85497a2`
- Intent / implemented scope: fix(workspace): every "Workspace" entry point opens the compact app shell

Recorded commit notes (historical claims):

> The live preview still showed the OLD long-scrolling workspace because the
> hash router sent `#/workspace` to the legacy `screen-workspace` screen even
> though the new compact shell was already served for the clean `/workspace`
> path. Every "Workspace" link in the product (landing header, landing CTA,
> account menu, client links) used that hash, so the new UI was unreachable
> through normal navigation.
>
> - public/app.js: `#/workspace` AND `/workspace` now resolve to the MASTER
>   shell (`master`); the legacy projects + knowledge screen moved to
>   `#/projects` (`if (view === 'projects') { showScreen('workspace'); ... }`).
> - public/app.js: signed-in visitors landing on `/` go straight to `#/workspace`;
>   "Open projects" links point at `#/projects`.
> - src/app/page.tsx: the header account-menu link points at `#/projects`.
> - src/app/layout.tsx + scripts/verify-production-e2e.mjs: shared asset version
>   bumped to `akbaral-lux-11` so browsers refetch the changed `app.js` instead of
>   replaying a cached module.
> - src/app/workspace-ux-contract.test.ts: the "Projects" route assertion follows
>   the route to `#/projects` and now also proves the route mounts the real
>   projects surface (same strictness, new route).
>
> Verified in a real DOM (jsdom + the live build): `/workspace` signed out -> auth,
> signed in -> `#/master`/`screen-master` with sidebar + chat + rail mounted,
> header "Workspace" -> new shell, `#/projects` -> legacy projects screen,
> `/` -> landing. `smoke:shell` 43/43; workspace-ux 25/25; responsive 13/13;
> master-routing 10/10; result-state 20/20; user-journey 16/16; preview-stack 7/7.
>

Verification paths changed: `scripts/verify-production-e2e.mjs`, `src/app/workspace-ux-contract.test.ts`

- CI [34991174372](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34991174372): docker-publish — **failure**, 2026-09-15T15:50:57Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/app.js
M	scripts/verify-production-e2e.mjs
M	src/app/layout.tsx
M	src/app/page.tsx
M	src/app/workspace-ux-contract.test.ts
```

### `81b1278` — fix(live): provider sign-in now answers honestly, and the page payload drops ~5×

- Time: 2026-09-15T16:15:47+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/81b12789018c1324e00e1aa8cd61e66da5e36716
- Parents: `a1126c8`
- Intent / implemented scope: fix(live): provider sign-in now answers honestly, and the page payload drops ~5×

Recorded commit notes (historical claims):

> Two reports from the running preview, both reproduced and fixed.
>
> 1. "Facebook sign-in does nothing."
>    Every provider without server-side credentials rendered as a `disabled`
>    control, so a press was silently swallowed — and the reason lived in a
>    desktop-only `title` tooltip. Provider buttons are now PRESSABLE:
>    - configured → navigates to /api/auth/oauth/<key>/authorize (the real 302
>      flow to the provider consent screen);
>    - unconfigured → answers with the exact credentials an operator must set
>      (FACEBOOK_CLIENT_ID + FACEBOOK_CLIENT_SECRET) and the redirect URI to
>      register, styled as a setup notice, focused and announced. Email +
>      password sign-in keeps working. No session, redirect or consent screen is
>      ever faked.
>    The authorize endpoint is honest as well: 503 provider_not_configured with
>    the required credential names (smoke-verified).
>
> 2. "The main site takes forever to load."
>    Every response travelled uncompressed (178 KB document, 211 KB app.js,
>    159 KB styles.css) and every asset shipped `Cache-Control: public, max-age=0`.
>    - Compression is now ON. It was off because Next's gzip middleware buffers
>      proxied text/event-stream responses (verified 2026-09-14). That middleware
>      skips any response marked `Cache-Control: no-transform`, so both SSE
>      producers send it (src/routes/realtime.ts; models.ts already did) and a
>      test now asserts that invariant for every streaming route.
>    - The SPA text assets are additionally served brotli (q9) by a new
>      /assets/[file] endpoint: encoding-aware memory, ETag/304, long cache, and
>      identity bytes for clients that cannot decode brotli.
>    - Documents: max-age=60 + stale-while-revalidate; static media: one week.
>    - The render-blocking Google Fonts sheet now loads with media="print" and is
>      swapped in from boot() (this codebase's no-pre-hydration-mutation rule).
>
> Measured through the web tier: document 177.9 KB → 32.7 KB (gzip), app.js
> 213.3 KB → 49.8 KB (brotli), styles.css 160.1 KB → 27.8 KB (brotli) — about
> 551 KB → 112 KB on first load, with repeat visits served from cache.
>
> Verification: smoke:shell 67/67 (was 43 — the new checks press the real button,
> read the setup answer, probe the authorize endpoint, read a LIVE STREAM THROUGH
> THE COMPRESSED TIER to prove it still arrives incrementally, and measure raw
> wire bytes); workspace-ux 25/25, responsive 13/13, master-routing 10/10,
> result-state 20/20, user-journey 16/16, preview-stack 7/7, oauth 20/20,
> execution-stream 5/5, asset-delivery 6/6, auth-provider-ux 5/5; tsc clean;
> production build green; rendered-DOM journey re-verified (fresh sign-up → login
> → compact shell; header "Workspace" → new shell; #/projects → legacy; / →
> landing).
>
> Two contract tests were re-specified to the stronger invariant (they had locked
> the very behaviour that caused the reports): the SSE tripwire now requires
> "compression on + every stream marked no-transform" instead of "compression
> off", and preview-stack evaluates the now-function-shaped headers() before
> asserting that no frame-blocking header is emitted.
>

Verification paths changed: `scripts/live-shell-smoke.mjs`, `scripts/verify-production-e2e.mjs`, `src/app/asset-delivery.test.ts`, `src/app/auth-provider-ux.test.ts`, `src/app/preview-stack.test.ts`, `src/app/result-state-contract.test.ts`

- CI [34993882915](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34993882915): docker-publish — **failure**, 2026-09-15T16:15:51Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	next.config.mjs
M	public/app.js
M	public/styles.css
M	scripts/live-shell-smoke.mjs
M	scripts/verify-production-e2e.mjs
A	src/app/asset-delivery.test.ts
A	src/app/assets/[file]/route.ts
A	src/app/auth-provider-ux.test.ts
M	src/app/layout.tsx
M	src/app/preview-stack.test.ts
M	src/app/result-state-contract.test.ts
M	src/routes/realtime.ts
```

### `3c6d264` — feat(entry): the application is the primary surface — `/` opens the compact shell, never the marketing page

- Time: 2026-09-15T18:21:19+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/3c6d2642871ce02e2338720c7828e64a31a77231
- Parents: `81b1278`
- Intent / implemented scope: feat(entry): the application is the primary surface — `/` opens the compact shell, never the marketing page

Recorded commit notes (historical claims):

> Reports from the live preview: "still rendering the OLD AKBARAL! landing-page
> theme", "NOT a cache issue, I verified the rendered page". Two real defects
> reproduced, and both are fixed here.
>
> 1. The marketing page was the FIRST PAINT of every entry.
>    `#screen-landing` shipped visible in the server-rendered document, so `/`
>    and `/workspace` painted the long cinematic page before app.js ran (and for
>    a no-JS visitor, permanently). The landing section now ships `hidden` and
>    the router reveals the screen the visitor actually asked for; a <noscript>
>    rule restores the full cinematic page for no-JS visitors and crawlers, so
>    nothing is lost — it simply is no longer the default.
>
> 2. A session the API no longer accepts silently became the marketing page.
>    `navigate()` wrapped `loadMe()` in a bare `catch {}` and then fell through
>    to `showScreen('landing')` — so a browser holding an expired, revoked or
>    rebuilt-database token was dropped onto the marketing page instead of the
>    sign-in card. Live evidence in the server log: a real Chrome session did
>    POST /login 200, then /api/me 401, /refresh 200, /api/me 401 … and sat on
>    the landing page. A dead session now clears itself and says so
>    ("Your session expired — sign in again to continue."), and lands on the
>    shell's own sign-in card. `clearSessionTokens()` is the one honest place
>    that drops a session.
>
> Routing now: a clean entry (`/` or `/workspace`, no hash) opens the
> application — the MASTER screen for a live session, the in-shell sign-in card
> otherwise. The marketing page is reachable only when explicitly asked for
> (`#/` — the header brand link and the post-sign-out target — and `#/landing`).
> Verified as a matrix of ten entries, first paint AND settled view, driving the
> real bundle same-origin through the web tier:
>
>   entry                     first paint        settled
>   signed out          /     veil only          sign-in card
>   signed out /workspace     veil only          sign-in card
>   signed out #/workspace     veil only          sign-in card
>   signed in           /     veil only          compact shell (sidebar + composer + rail)
>   signed in  /workspace     veil only          compact shell
>   signed in  #/workspace     veil only          compact shell
>   dead token          /     veil only          sign-in card (was: marketing page)
>   dead token /workspace     veil only          sign-in card
>   explicit #/ and #/landing veil only          marketing landing (preserved)
>
> 3. Documents no longer invite a shared cache to pin the old application.
>    `/` and `/workspace` carried `s-maxage=31536000` — a CDN was allowed to
>    serve the previous shell for a year, which no amount of redeploying fixes.
>    They now send `private, no-cache, must-revalidate` and revalidate against
>    the ETag (304); everything heavy stays versioned and long-cached. Shell
>    assets bumped to `?v=akbaral-lux-14` (layout x3, verify-production-e2e x2).
>
> Contract tests realigned to the stronger intent, never weakened:
> `asset-delivery` now asserts the documents revalidate and that no app entry
> rule may invite a shared cache, reading each headers() rule by source;
> `workspace-ux-contract` asserts the clean-entry branch resolves the session,
> opens the sign-in card, and never calls showScreen('landing'); the shell smoke
> asserts the served document revalidates instead of being pinned.
>
> Verification on the running build: full suite 616/616 (exit 0); smoke:shell
> 67/67 with runtime problems none (artifact preview 4,955 bytes in the sandboxed
> frame, export control names website v2, sign-out still returns to the landing
> page); smoke:artifacts 27/27; asset-delivery 6/6; workspace-ux-contract 25/25;
> auth-provider-ux 5/5; result-state 20/20; preview-stack 7/7; master-routing
> 10/10; responsive 13/13; tsc clean; production build green. A real signed-in
> journey through the shell's composer showed live step progress ("Step 0:
> completed / Step 1: completed / Step 2: running") in the conversation.
>
> Backend, auth, agents, credits, artifacts, security and legacy routing are
> untouched: `#/projects` still mounts the projects surface, the owner console
> and admin routes are unchanged, and every API path is exactly as it was.
>

Verification paths changed: `scripts/live-shell-smoke.mjs`, `scripts/verify-production-e2e.mjs`, `src/app/asset-delivery.test.ts`, `src/app/workspace-ux-contract.test.ts`

- CI [35006953888](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35006953888): docker-publish — **failure**, 2026-09-15T18:21:22Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	next.config.mjs
M	public/app.js
M	scripts/live-shell-smoke.mjs
M	scripts/verify-production-e2e.mjs
M	src/app/asset-delivery.test.ts
M	src/app/layout.tsx
M	src/app/page.tsx
M	src/app/workspace-ux-contract.test.ts
```

### `c9be124` — Redesign the product as one premium emerald-glass application

- Time: 2026-09-15T19:10:14+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/c9be124f239924d25fec440219d8a4f3918abbc5
- Parents: `3c6d264`
- Intent / implemented scope: Redesign the product as one premium emerald-glass application

Recorded commit notes (historical claims):

> The landing page and the workspace are now the same product: a compact
> front door and a full AI workspace sharing one visual language, built on
> the existing backend, agents, auth, credits, tasks and artifacts.
>
> Design system (design-system/tokens.json → v5.0.0)
> - One emerald accent #2f8348 with #57b378 as its bright partner, on an
>   obsidian-green canvas, plus emerald atmosphere, glass tiers, glow and
>   focus-ring tokens. Consumed by web (public/tokens.css), mobile
>   (mobile/src/theme.ts) and iOS (AKBARALTheme.swift) via build.mjs, which
>   now also emits --accent-bright.
>
> Landing (/)
> - Replaced the eleven-chapter marketing scroll with a compact front door:
>   a cinematic hero with the product frame showing honest pipeline states,
>   then tight bands for the orchestration core, capabilities, the 4,001
>   agent registry, the implemented security guarantees, live pricing from
>   /api/billing/plans and one closing CTA. No invented statistics, agents
>   or integrations.
>
> Application shell
> - New glass layer over the real shell classes (sidebar, topbar, MASTER
>   conversation, composer, right rail, artifacts, tables, toasts) with
>   restrained gradients, hairline borders, real backdrop blur, emerald
>   active states and a calmer typographic hierarchy, from 320px phones to
>   wide desktops. Structural layout rules are untouched so the drawer and
>   sheet behaviours keep working.
>
> Fixes found by the suite
> - public/app.js bound #explore-agents without a guard; the new landing
>   replaces that control, so the binding is null-safe and the button keeps
>   its auth-aware behaviour.
> - The eight new auto-fill grids now guard their minimum track with min(),
>   so fixed tracks can never overflow a 320px viewport.
>
> Verified: 616/616 tests, smoke:shell 67/67, smoke:artifacts 27/27,
> tsc clean, production build exit 0, entry matrix and 42 rendered-design
> contract checks green, real MASTER run wfl_CTv2iEZWt1PnwXN7 completed
> 3/3 steps and produced a real website artifact.
>

Verification paths changed: `scripts/verify-production-e2e.mjs`

- CI [35012005716](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35012005716): docker-publish — **failure**, 2026-09-15T19:10:18Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	design-system/build.mjs
M	design-system/ios/AKBARALTheme.swift
M	design-system/tokens.json
M	mobile/src/theme.ts
M	public/app.js
M	public/styles.css
M	public/tokens.css
M	scripts/verify-production-e2e.mjs
M	src/app/layout.tsx
M	src/app/page.tsx
```

### `1f3ed53` — Make sign-in a clean front door and give providers real logos

- Time: 2026-09-15T19:51:42+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/1f3ed5397a005c958eae026321b9e7cd9b4444f2
- Parents: `c9be124`
- Intent / implemented scope: Make sign-in a clean front door and give providers real logos

Recorded commit notes (historical claims):

> The screen a visitor meets before signing in is now one surface: the
> AKBARAL! identity and the way in. Nothing else.
>
> Pre-login surface
> - The public header (Platform / Agents / Security / Pricing / Log In /
>   Start Building) and the marketing footer retire while the sign-in
>   screen is up: app.js sets `body.is-auth` in showScreen, and the CSS
>   hides the chrome only for that state, so a visitor without JavaScript
>   still gets the full page.
> - The card itself is brand identity (mark, wordmark, tagline), the form,
>   the provider row and the sign-in/register switch. The marketing trust
>   line, the decorative ring and the debug note are gone.
>
> Provider sign-in
> - Five official marks are inlined in the client (Google, GitHub,
>   Microsoft, Facebook, Apple), so the row never waits on a third-party
>   asset host and a button can never render without its logo.
> - "setup needed" is gone from the product. A configured provider is a
>   real control that navigates to /api/auth/oauth/<key>/authorize; a
>   provider this deployment cannot serve renders in a subtle unavailable
>   state (disabled + aria-disabled + is-unavailable, muted glass, its own
>   logo, a plain-language tooltip). No credential, environment-variable
>   or setup text reaches a visitor.
> - The operator half moved to where an operator looks: an owner-only
>   "Provider sign-in" panel in the private owner console (and the admin
>   console) names the exact credentials to set and the redirect URI to
>   register. The owner role cannot reach #/admin, so the console copy is
>   the one the owner actually sees.
> - Controls share one geometry, real hover/focus states, and stack to a
>   single full-width column on phones (560px / 380px tightenings).
>
> Tests were re-pointed at the new contract rather than relaxed: the
> provider test now asserts the official marks, the absence of any
> configuration text on the public surface, the unavailable presentation
> and the owner-only diagnostics; the smoke test asserts the same against
> the running server and still proves the authorize endpoint refuses
> honestly (503 provider_not_configured). The sidebar identity contract
> now scopes its tagline lookup to the sidebar head, so the tagline on the
> pre-login surface cannot satisfy it.
>
> Verified: 620/620 tests, smoke:shell 71/71, smoke:artifacts 27/27,
> tsc clean, production build exit 0, 24/24 rendered pre-login checks on
> sign-in and register (one surface, no chrome, five marked provider
> controls, no debug text), owner console diagnostics live, served bytes
> identical to the committed files.
>

Verification paths changed: `scripts/live-shell-smoke.mjs`, `scripts/verify-production-e2e.mjs`, `src/app/auth-provider-ux.test.ts`, `src/app/workspace-ux-contract.test.ts`

- CI [35016149372](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35016149372): docker-publish — **failure**, 2026-09-15T19:51:46Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	public/app.js
M	public/styles.css
M	scripts/live-shell-smoke.mjs
M	scripts/verify-production-e2e.mjs
M	src/app/auth-provider-ux.test.ts
M	src/app/layout.tsx
M	src/app/page.tsx
M	src/app/workspace-ux-contract.test.ts
```

### `aa9699b` — Make AKBARAL! responsive end to end and finish the auth states

- Time: 2026-09-15T21:24:51+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/aa9699bc84eb895d0c79644cab0dd7505fbb0bd4
- Parents: `1f3ed53`
- Intent / implemented scope: Make AKBARAL! responsive end to end and finish the auth states

Recorded commit notes (historical claims):

> Final UI/UX pass: the product holds up from a 320px phone to a 1920px desktop
> with no overflow, no clipped label and no microscopic glyph — and the sign-in
> screen finally reads like a finished product rather than a form.
>
> Legibility is a token, not a habit
> - typography.scale.micro gains webSize 11.5 / phoneSize 12, and
>   responsive.fontFloorRem rises to 0.72; build.mjs now emits --fs-micro,
>   --fs-micro-phone, --fs-floor and the named scale.
> - All 90 sub-floor declarations (0.58-0.68rem, i.e. 9.3-10.9px) use
>   var(--fs-micro), which steps UP to 12px on phones instead of down.
>
> Authentication is a finished surface
> - An inline live region (#auth-feedback, role=status) reports real server
>   errors next to the fields, marks the offending input with aria-invalid,
>   shows a pending state while the request is in flight and disables submit;
>   toasts remain for app-wide messages.
> - A real password reveal control (aria-pressed + eye/eye-off states) that
>   switches the input type, with a 40px target on touch devices.
> - The auth surface may scroll (overflow-y: auto), so a short viewport can
>   never clip the form; phones get 50px inputs and the safe area is honoured.
>
> Whole-product responsive work, not media-query sprinkling
> - Phone chrome: the top bar wraps, the Preview/MASTER-chat pane switch takes
>   its own full-width row, panels go full-bleed, composer and rail honour
>   env(safe-area-inset-bottom).
> - Modals become bottom sheets (full width, 92dvh, rounded top); wide tables
>   are wrapped by ensureTableScroll() so a ledger can never push a phone layout
>   sideways; toasts span the phone width; attachment rows wrap and ellipsise.
> - Coarse-pointer floor of 44px for nav items, rail tabs, the pane switch,
>   credit chips and small buttons; credit amount chips expose their selection.
>
> Verification
> - scripts/responsive-audit.mjs resolves the real cascade (media queries,
>   specificity, order, !important, var() chains) at 320/360/375/390/414/768/
>   1024/1280/1440/1920 across every screen and dialog surface: no overflow,
>   tiny-text, clipped, small-target, grid-guard or provider-row findings.
>   --selftest plants four regressions and proves the gate can fail (4/4 caught).
> - src/app/final-ui-ux.test.ts locks the pass (7/7); full suite 627/627;
>   tsc clean; production build clean; smoke:shell 71/71; smoke:artifacts 27/27;
>   design contract 42/42; rendered pre-login 24/24 at / and /#/register; the
>   owner console still names the credentials an operator must set while the
>   public sign-in screen shows none of it.
> - Asset version bumped to akbaral-lux-17.
>

Verification paths changed: `scripts/responsive-audit.mjs`, `scripts/verify-production-e2e.mjs`, `src/app/final-ui-ux.test.ts`

- CI [35025657878](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35025657878): docker-publish — **failure**, 2026-09-15T21:26:49Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	design-system/build.mjs
M	design-system/tokens.json
M	public/app.js
M	public/styles.css
M	public/tokens.css
A	scripts/responsive-audit.mjs
M	scripts/verify-production-e2e.mjs
A	src/app/final-ui-ux.test.ts
M	src/app/layout.tsx
M	src/app/page.tsx
```

### `516d06c` — Make every tier readable and every control keyboard-honest

- Time: 2026-09-15T22:03:59+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/516d06cdcd835dbd441a332469b42882edbef8a8
- Parents: `aa9699b`
- Intent / implemented scope: Make every tier readable and every control keyboard-honest

Recorded commit notes (historical claims):

> Second half of the final UI/UX pass. The layout was already structurally
> sound, so this round fixes what structure cannot see — contrast, keyboard
> state and dialog behaviour — and teaches the audit gate to police them.
>
> Contrast (measured, not guessed)
> - The tertiary text tokens failed WCAG AA on the obsidian field: --text-faint
>   (#5c6a62) measured 3.49:1 at the new 11.5px micro size. It is now #7c8d84
>   (5.68:1) and --text-dim is #93a29a (7.46:1), which keeps the visual
>   hierarchy while both tiers clear 4.5:1 on every field colour the product
>   paints (asserted against #040705/#070a08/#0b100d/#101713).
> - Two chrome labels that sit on raised glass (.console-state and the export
>   label) move to the dim tier, and the empty-preview glyph uses the readable
>   accent instead of the darker brand fill.
> - scripts/responsive-audit.mjs now composites the real painted backdrop
>   (ancestor fills plus gradient stops over the field) and reports a `contrast`
>   finding for any text below AA, plus an `anchored-overflow` finding for a
>   positioned control escaping its containing box. Both lookups are memoised,
>   which took the ten-width run from ~35 min to ~14 min.
>
> Keyboard and pointer honesty
> - One focus language: an emerald :focus-visible ring covers links, buttons,
>   inputs, selects, textareas, tabs, role=button and every focusable element;
>   rail and pane controls get inset rings so they read inside glass.
> - Disabled controls now look disabled (opacity plus not-allowed), except the
>   unavailable provider buttons, which keep their deliberately legible
>   "unavailable" treatment.
> - The legal dialog traps Tab, and focus returns to whichever control opened
>   it — button, backdrop or Escape.
>
> Verification
> - src/app/final-ui-ux.test.ts grows to 10 tests (contrast maths, keyboard and
>   disabled layers, dialog behaviour). Full suite 630/630; tsc and production
>   build clean; smoke:shell 71/71; smoke:artifacts 27/27; design contract 42/42;
>   rendered pre-login 24/24 at / and /#/register; route sweeps 15/15 signed-out
>   and 42/42 signed-in owner at 390px and 1440px with zero runtime errors and
>   zero unnamed controls; accessibility scan 9/9 (accessible names, alt text,
>   iframe titles, unique ids, labelled fields, dialog focus); the owner console
>   still shows credential guidance the public sign-in screen never shows.
> - Responsive audit at 320/360/375/390/414/768/1024/1280/1440/1920 across every
>   screen and dialog surface: no overflow, tiny-text, clipped, small-target,
>   grid-guard, provider-row, contrast or anchored-overflow findings, and the
>   self-test still catches all four planted regressions.
>

Verification paths changed: `scripts/responsive-audit.mjs`, `src/app/final-ui-ux.test.ts`

- CI [35029017800](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35029017800): docker-publish — **failure**, 2026-09-15T22:04:02Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	design-system/ios/AKBARALTheme.swift
M	design-system/tokens.json
M	mobile/src/theme.ts
M	public/app.js
M	public/styles.css
M	public/tokens.css
M	scripts/responsive-audit.mjs
M	src/app/final-ui-ux.test.ts
```

## Day 10 — 2026-09-16

### `7987605` — Reserve a lane for every floating control, and audit the rendered routes

- Time: 2026-09-16T11:08:33+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/7987605582ecd920969a7e3b990313042aa26de6
- Parents: `516d06c`
- Intent / implemented scope: Reserve a lane for every floating control, and audit the rendered routes

Recorded commit notes (historical claims):

> Third and final sweep of the UI/UX pass. It found one shipped bug and one
> latent one — both in the same class the earlier rounds could not see: a control
> that floats over content without reserving the space it covers.
>
> The password field never reserved its lane
> - The reveal control is absolutely positioned over the input, and the padding
>   that keeps typed text clear of it was keyed off a class that was never
>   applied: the markup carried `has-reveal` as a stray JSX prop instead of
>   `className="auth-field has-reveal"`. Typed passwords and the placeholder ran
>   underneath the eye button. The class is now real, so the field reserves 54px
>   (58px on touch) exactly as designed.
> - The legal sheet's heading band had no clearance at all for its 44px close
>   control 16px in from the edge: `.modal-card > .eyebrow/h2/#legal-title` now
>   reserve 68px (56px on phones, where the target grows to 40px at an 8px inset).
>
> The gate learned to catch both
> - scripts/responsive-audit.mjs gains a `control-clearance` finding: for every
>   absolutely positioned interactive control it resolves the containing block,
>   the anchored edge and its size, then checks that the content sharing its band
>   keeps at least that much padding on that edge. It also gained `hover-only`
>   (a focusable control that renders invisible until someone hovers it is dead on
>   touch and for keyboards) and a `--clearance` review report that lists every
>   floating control, its anchors and its lane — the report is how the two
>   clearance bugs above were found.
>
> Rendered-route audit (new, committed)
> - scripts/rendered-route-audit.mjs boots the served document with the real
>   app.js and walks the routes as a user would: signed-out landing/sign-in/
>   sign-up/pricing; the single pre-login surface with five real provider marks
>   and no operator text; every signed-in route (dashboard, MASTER, agents,
>   factory, marketplace, projects, automations, CRM, billing, settings, owner
>   console, admin fallback, workspace); then the accessibility facts of what
>   rendered (accessible names, alt text, iframe titles, unique ids, labelled
>   fields, dialog focus trap and focus return); the mobile drawer and pane
>   switch; and a full MASTER run through the composer with a project selected,
>   which must leave a real deliverable in the sandboxed preview frame and a real
>   export control. 328 checks across 320/390/768/1440, all passing — and it fails
>   loudly if the owner credentials are missing rather than testing less.
> - npm scripts: audit:responsive, audit:responsive:selftest, audit:routes.
>
> Verification on this commit: tsc clean; production build clean; full suite
> 631/631; smoke:shell 71/71 (a real run renders its deliverable and exports
> website v1); smoke:artifacts 27/27; rendered route audit 328/328; responsive
> audit across 320/360/375/390/414/768/1024/1280/1440/1920 with no overflow,
> tiny-text, clipped, small-target, grid-guard, contrast, provider-row,
> anchored-overflow, control-clearance or hover-only findings, and its self-test
> still catches all four planted regressions. Asset version akbaral-lux-18.
>

Verification paths changed: `scripts/rendered-route-audit.mjs`, `scripts/responsive-audit.mjs`, `scripts/verify-production-e2e.mjs`, `src/app/final-ui-ux.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	package.json
M	public/styles.css
A	scripts/rendered-route-audit.mjs
M	scripts/responsive-audit.mjs
M	scripts/verify-production-e2e.mjs
M	src/app/final-ui-ux.test.ts
M	src/app/layout.tsx
M	src/app/page.tsx
```

### `8b5c8bb` — Add the A–Z production launch audit (16 September 2026)

- Time: 2026-09-16T11:53:58+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/8b5c8bb642ad879105d84eb3574b9c93a71de527
- Parents: `7987605`
- Intent / implemented scope: Add the A–Z production launch audit (16 September 2026)

Recorded commit notes (historical claims):

> A forensic audit of the whole product against the running stack, written down
> before any fixes are attempted: source, routes, APIs, database, agents, UI,
> integrations, tests, deployment configuration and the live application.
>
> Headline findings, each with the evidence that produced it:
> - Billing: POST /api/billing/switch lets any signed-in user activate any paid
>   plan without payment (verified live: enterprise -> status active), and the
>   owner console then reports $400 MRR with $0 collected — a revenue-integrity
>   and honesty defect, found by probing rather than reading.
> - Credits: consumption is per specialist step, not per user goal. One 3-step
>   MASTER goal consumed 3 of the 5 free credits while the pricing page sells
>   "5 free tasks". Real, working, and currently undisclosed.
> - Artifacts: only `website` has a producer. document/data/image are accepted
>   kinds with viewers, versioning and download, but creating one is refused
>   with "only website artifacts can be captured from workflows" (verified).
> - Tools: 4,001 agents, 7,203 tool links, but only 7 of 18 implemented tools are
>   referenced by any contract and zero tool credentials are configured.
> - Everything else measured: 631/631 tests, tsc clean, production build clean,
>   328/328 rendered-route assertions, responsive audit clean at 320→1920,
>   smoke:shell 71/71, smoke:artifacts 27/27, registry audit PASS, secret scan
>   PASS, Postgres/pglite integration 22/22, owner RBAC 200/403, cross-user
>   isolation 404s, auth 17/17 live, factory and automations verified live.
> - launch:check --offline: 44.4% readiness, 5 blockers (domain, AI key, search
>   key, payments, checkout return URLs).
> - The private mission codename appears in no public surface (verified by scan
>   of public assets, every public page, and the served HTML).
>
> The report states where evidence is missing rather than filling the gap:
> every third-party provider call is UNVERIFIED because the sandbox has no
> outbound internet, and the mobile app is UNVERIFIED because it has never been
> built or run (it compiles clean and 26/26 API routes it calls exist).
>
> No product code was changed by this audit.
>

Verification paths changed: none in this commit.

- CI [35092813991](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35092813991): docker-publish — **failure**, 2026-09-16T11:54:08Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	LAUNCH_AUDIT_2026-09-16.md
M	next-env.d.ts
```

### `67a0d23` — Correct the audit: GitHub recovered mid-audit, and the GHCR image build is failing

- Time: 2026-09-16T11:56:12+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/67a0d23c1f3b50290fc954a57e85e165459b5594
- Parents: `8b5c8bb`
- Intent / implemented scope: Correct the audit: GitHub recovered mid-audit, and the GHCR image build is failing

Recorded commit notes (historical claims):

> Two facts changed while the audit was being written, so they are corrected
> rather than left standing:
>
> - GitHub authentication recovered and both commits are pushed. The audit no
>   longer claims the repository cannot be pushed.
> - The replacement blocker is real evidence: the docker-publish workflow fails
>   at the 'Build and push' step on three consecutive runs, including the audit
>   commit, so no GHCR image is published and the documented Modal deployment
>   path cannot start. The Actions log archive could not be downloaded from the
>   sandbox and there is no Docker daemon here, so the root cause is recorded as
>   UNVERIFIED instead of guessed.
>

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	LAUNCH_AUDIT_2026-09-16.md
```

### `24cbd2a` — Keep the audit strictly documentation-only

- Time: 2026-09-16T11:56:19+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/24cbd2ad4247a6100ec4ecf5cb857fa1e9b501c7
- Parents: `67a0d23`
- Intent / implemented scope: Keep the audit strictly documentation-only

Recorded commit notes (historical claims):

> npm run build regenerates next-env.d.ts (it rewrites the generated type
> reference from .next/dev/types to .next/types). The audit promised not to
> change product code, and that reference is situational in both directions, so
> the previously committed form is restored and the audit diff is now two
> markdown additions only.
>

Verification paths changed: none in this commit.

- CI [35093014158](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35093014158): docker-publish — **failure**, 2026-09-16T11:56:22Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	next-env.d.ts
```

### `56a621e` — Record the second live verification pass in the audit

- Time: 2026-09-16T12:03:09+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/56a621eb6791b87365b95515d947072406142fd5
- Parents: `24cbd2a`
- Intent / implemented scope: Record the second live verification pass in the audit

Recorded commit notes (historical claims):

> Same commit, re-measured end to end: readiness unchanged at 44.4% with the same
> five blockers; registry, tool wiring and ledger counts unchanged; and the two
> headline defects reproduced from scratch — an unpaid self-activated enterprise
> plan moved the owner console MRR from $400 to $800 with $0 collected, and a
> three-step MASTER goal consumed three of the five free credits before exporting
> its website artifact.
>

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	LAUNCH_AUDIT_2026-09-16.md
```

### `20532f8` — ZA141251SA: real operator controls, wallet funding/budgets, honest refusals

- Time: 2026-09-16T14:29:53+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/20532f8966b0b144144f56c07b66fe759eae8e90
- Parents: `56a621e`
- Intent / implemented scope: ZA141251SA: real operator controls, wallet funding/budgets, honest refusals

Recorded commit notes (historical claims):

> Mission server (src/mission/server.ts):
> - root-agent creation: POST /api/agents now really creates a mission agent with a
>   contract and a funded wallet. It used to fall through to the LIST handler and
>   answer 200 with a page of agents — a silent fake success. Now a bad request is
>   400 and a good one is 201.
> - pause/resume/retire: POST /api/agents/:slug/status (owner-only, reason required,
>   audited). Enforcement lives in requireAgent, so a paused agent cannot take work,
>   request tools/resources/upgrades/expenses or report usage.
> - spending: POST /api/expenses resolves the agent's own wallet (wallet_required
>   when it has none, 403 if the named wallet belongs to another agent).
> - wallet control: PATCH /api/wallets/:id sets the authorised budget, label and
>   frozen state; POST /api/wallets/:id/fund is owner working capital, recorded as
>   owner_capital (never revenue), idempotent by key.
> - kill switch: the POST /api/policy/kill-switch sub-route was unreachable behind
>   the policy-update branch; it now engages the switch first.
>
> Treasury (src/mission/treasury.ts):
> - ledger idempotency key + migration 0005 (partial unique index) so a retried
>   deposit cannot double-credit a wallet.
> - setWalletBudget(): audited budget/status change with the previous value.
>
> Reporting: agent reports now list delegation children (slug/state/depth), not
> just a count.
>
> Verification: npm run mission:serve + scripts/probe-mission.mjs — 41/41 live
> checks against the running private server (login, RBAC, funding idempotency,
> budget control, freeze, expense thresholds, approvals, pause/resume, kill
> switch, audit chain, isolation). src/mission/mission-server.test.ts 23/23.
>

Verification paths changed: `scripts/audit-registry.ts`, `src/economy/hierarchy.test.ts`, `src/mission/mission-server.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.gitignore
A	db/migrations-mission/0005_ledger_idempotency.sql
A	db/migrations-pg/0017_hierarchy_controls.sql
A	db/migrations/0017_hierarchy_controls.sql
M	next-env.d.ts
M	scripts/audit-registry.ts
A	scripts/probe-mission.mjs
M	src/db/economy-repositories.ts
A	src/economy/hierarchy.test.ts
A	src/economy/hierarchy.ts
M	src/economy/operations.ts
M	src/economy/policy.ts
M	src/economy/treasury.ts
M	src/mission/mission-server.test.ts
M	src/mission/reporting.ts
M	src/mission/server.ts
M	src/mission/treasury.ts
M	src/routes/economy.ts
```

### `27ee33e` — Hierarchy gates keep the established refusal contract; owner/agent spawn semantics

- Time: 2026-09-16T15:08:47+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/27ee33ee6158406b02bf65ba7b6d5eb76ebf0449
- Parents: `20532f8`
- Intent / implemented scope: Hierarchy gates keep the established refusal contract; owner/agent spawn semantics

Recorded commit notes (historical claims):

> - evaluateSpawn returns a canonical reason per failing gate (blockedReason is
>   stable again: 'agent cap reached', 'max agent depth reached', ...) with the
>   numbers in reasonDetail and the machine gate name in failedGate.
> - Budget/rate gates now distinguish direction: an owner-approved hire is not
>   charged to the parent's budget (the owner authorized it), while an
>   agent-initiated delegation pays from the parent's budget and the daily
>   ceiling. Root-level spawns have no parent to charge.
> - The depth check's detail keeps the phrase 'depth limit' so operator logs and
>   the audited event contract stay readable.
> - hierarchy tests: snapshot/restore the shared policy, delete the agents they
>   create, and cover the owner-hire vs agent-delegation distinction (21/21).
> - economy.test.ts: API-level RBAC for the hierarchy and emergency controls
>   (users and staff admins get 403 on reads and writes; the owner drives
>   freeze spending/withdrawals/provider access and every change is audited).
> - mission dashboard: create-agent form, owner controls (pause/resume/retire,
>   fund wallet, budget, freeze), delegation children table, assign work.
> - responsive-audit.mjs is now asset-agnostic (AUDIT_CSS/AUDIT_JS/AUDIT_HTML) so
>   the same overflow/tap-target/text-size gate runs on the private console too:
>   mission dashboard clean at 320/390/768/1440.
> - scripts/audit-registry.ts: --json emits a per-agent verdict
>   (ACTIVE/NEEDS_CONFIGURATION/MISSING_DEPENDENCY/BLOCKED/FAILED).
>

Verification paths changed: `scripts/responsive-audit.mjs`, `src/economy/economy.test.ts`, `src/economy/hierarchy.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	mission-dashboard/app.js
M	mission-dashboard/index.html
M	mission-dashboard/styles.css
M	scripts/responsive-audit.mjs
M	src/economy/economy.test.ts
M	src/economy/hierarchy.test.ts
M	src/economy/hierarchy.ts
M	src/economy/treasury.ts
```

### `34e6342` — Close the paid-plan escalation hole + verify auth, mission console and economy live

- Time: 2026-09-16T15:55:03+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/34e63424f768bb32e49cccf32880156b39cab9c6
- Parents: `27ee33e`
- Intent / implemented scope: Close the paid-plan escalation hole + verify auth, mission console and economy live

Recorded commit notes (historical claims):

> Security (billing):
> - POST /api/billing/switch could self-assign ANY plan, including paid ones, with
>   no payment: a request body bought an upgrade. Paid plans now start a REAL
>   provider checkout (Stripe/Razorpay) and, when no provider is configured, the
>   answer is an honest 402 payment_required naming STRIPE_SECRET_KEY. Only the
>   free plan can still be switched to directly. Tests updated to assert the
>   refusal (and that a configured provider gets a real session id, with the plan
>   still inactive until payment).
>
> Economy (owner-only surface):
> - Hierarchy policy limits (depth, children per parent, spawn rate, spawn cost)
>   are now configurable through PATCH /api/economy/policy.
> - Domain refusals (frozen spending/withdrawals, revoked provider access,
>   refused transfers) are mapped to their real 4xx status and machine-readable
>   code instead of surfacing as a generic 500.
> - Agent listing shows newest agents first so a newly created agent is visible.
> - Root-agent creation no longer misaligns its INSERT column/value list (role and
>   capabilities were written to the wrong columns).
>
> Verification added (all live, against the running stack):
> - scripts/probe-economy-live.mjs     32/32  real hire -> delegation -> gates ->
>   execution -> verified deliverable -> evidence-gated revenue -> ledger ->
>   owner-approved payout -> emergency controls
> - scripts/probe-auth-live.mjs        17/17  register, login, refresh rotation,
>   logout revocation, recovery honesty, OAuth configuration truthfulness,
>   brute-force limiting, no secrets in responses
> - scripts/probe-integrations-live.mjs       per-integration truth: models, tools,
>   search, email, payments, social sign-in, site URL
> - scripts/verify-mission-dashboard.mjs 16/16 ZA141251SA console login, real data
>   sections, session storage, reload restore, sign-out, no hardcoded identity
> - scripts/seed-economy-opportunity.ts, scripts/seed-owner-project.mjs for real
>   owner-assigned work items and a real project/artifact on the live stack
> - hierarchy.test.ts isolates the shared test database (spawn-rate window and the
>   daily spend ceiling) so the suite measures its own state only
>

Verification paths changed: `scripts/verify-mission-dashboard.mjs`, `scripts/verify-mission-login.mjs`, `src/billing/billing.test.ts`, `src/economy/hierarchy.test.ts`, `src/security/role-separation.test.ts`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	mission-dashboard/app.js
A	registry-audit.json
A	scripts/probe-auth-live.mjs
A	scripts/probe-economy-live.mjs
A	scripts/probe-integrations-live.mjs
A	scripts/seed-economy-opportunity.ts
A	scripts/seed-owner-project.mjs
A	scripts/verify-mission-dashboard.mjs
A	scripts/verify-mission-login.mjs
M	src/billing/billing.test.ts
M	src/billing/providers.ts
M	src/billing/service.ts
M	src/economy/hierarchy.test.ts
M	src/economy/hierarchy.ts
M	src/mission/server.ts
M	src/routes/billing.ts
M	src/routes/economy.ts
A	src/security/mission-modules.ts
A	src/security/role-separation.test.ts
```

### `48e7d26` — Activate a paid plan only when the provider confirms payment; fix the image build

- Time: 2026-09-16T16:30:10+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/48e7d2670ad0f8952d4b8f81db260068d63d08de
- Parents: `34e6342`
- Intent / implemented scope: Activate a paid plan only when the provider confirms payment; fix the image build

Recorded commit notes (historical claims):

> Billing (completes the escalation fix):
> - A provider-paid plan invoice settled the money but never activated the plan.
>   Settlement now activates the subscription it was paid for — cancelling the
>   previous live row so exactly one auditable subscription exists — and records
>   a plan.activated billing event. A plan invoice is created 'due' so it is
>   payable; credits and plans are the two things an invoice can buy.
> - billing.test.ts proves the whole chain: paid plan + no provider => 402
>   payment_required naming STRIPE_SECRET_KEY and no subscription; configured
>   provider => real checkout session id and the plan is still NOT active; signed
>   webhook settlement => the plan becomes active; admin overview then sees the
>   real active subscription. (19/19 on a fresh database.)
>
> Production image (root cause of the 3/3 docker-publish failures):
> - The build stage never copied scripts/, but tsconfig.backend.json compiles
>   scripts/**/*.ts and Next's type-check phase type-checks
>   src/security/scan-secrets.test.ts, which imports ../../scripts/scan-secrets.
>   The image build therefore always died with 'Failed to type check' (TS2307)
>   before anything was pushed to GHCR. Reproduced with the exact file set the
>   Dockerfile copies (exit 1), fixed by copying scripts/ (exit 0, image builds).
>
> Integration probe honesty:
> - payments: probes /api/billing/credits instead of a route that does not exist;
>   reports 402 provider_not_configured with the missing credential instead of
>   counting an HTTP 404 as a working provider.
> - tools: reads credentialConfigured / requires_credential /
>   required_credential_env_key (the 'configured' field never existed).
> - search: reports the provider that will actually serve calls (keyless
>   DuckDuckGo default vs a quota-backed key) and the live discovery call result
>   instead of a blanket CONFIGURED.
>
> Full suite on a fresh database: 70 files, 681 tests, 681 passed, 0 failed.
>

Verification paths changed: `src/billing/billing.test.ts`

- CI [35122309784](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35122309784): docker-publish — **success**, 2026-09-16T16:30:14Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	Dockerfile
M	scripts/probe-integrations-live.mjs
M	src/billing/billing.test.ts
M	src/billing/service.ts
M	src/db/platform-repositories.ts
```

### `f55d961` — Refresh the 4,001+ agent audit report for the deployed provider configuration

- Time: 2026-09-16T16:49:00+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/f55d9613ecc4153642eee23953bf2f5977869a06
- Parents: `48e7d26`
- Intent / implemented scope: Refresh the 4,001+ agent audit report for the deployed provider configuration

Recorded commit notes (historical claims):

> Generated against the running stack's own environment (OPENAI_API_KEY
> present), so the verdicts describe what the deployment can actually execute:
>
>   registered 4013 = 4001 catalog agents + 12 probe-created hierarchy rows
>   ACTIVE 4000 · NEEDS_CONFIGURATION 1 (long_context wants GOOGLE_API_KEY)
>   FAILED 12 (the probe rows: no catalog definition, no user work attached)
>   activeShare 0.9968
>
> An agent is ACTIVE only when its contract, tools, workflow, permissions,
> failure handling, verification and audit hooks are all present and a provider
> for its model capability is configured — existence is never enough.
>

Verification paths changed: none in this commit.

- CI [35124289291](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35124289291): docker-publish — **success**, 2026-09-16T16:49:04Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	next-env.d.ts
M	registry-audit.json
```

### `e70f933` — Prove the customer journey end to end, including credit accounting

- Time: 2026-09-16T17:04:32+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e70f933f47737bc0de9a18f80798e674dd3ec32c
- Parents: `f55d961`
- Intent / implemented scope: Prove the customer journey end to end, including credit accounting

Recorded commit notes (historical claims):

> scripts/verify-user-journey.mjs (npm run verify:user-journey) walks the real
> product path against the live stack with throwaway accounts and measures every
> assertion from the API's own responses (20/20):
>
>   register → sign in → plan/credit state → public agent catalog →
>   MASTER goal → analysis (llm mode), specialist plan, 3-step graph, a 9928-char
>   result document and the specialist task rows it links →
>   web-research task → honest failure reporting → credit accounting →
>   projects → RBAC refusals on the owner, staff and mission planes.
>
> Credit accounting is measured on a clean second account because the MASTER
> workflow's charges settle asynchronously — the only honest way to attribute a
> credit to one task outcome:
>
>   · a task that ends in FAILURE costs the customer nothing (5 → 5), with the
>     real reason reported ("search endpoint html.duckduckgo.com unreachable")
>   · a CANCELLED task refunds its reserved credit (5 → 5)
>   · the completed specialist work is what consumed credits (5 → 2)
>
> No fixture drives any of it, and no engagement or success is synthesized.
>

Verification paths changed: `scripts/verify-user-journey.mjs`

- CI [35125906149](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35125906149): docker-publish — **success**, 2026-09-16T17:04:35Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	package.json
A	scripts/verify-user-journey.mjs
```

### `648095a` — Make every application URL survive a refresh, and stop a refresh from logging users out

- Time: 2026-09-16T17:54:26+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/648095a89f7c7255a9de420e81e4416423ee7c09
- Parents: `e70f933`
- Intent / implemented scope: Make every application URL survive a refresh, and stop a refresh from logging users out

Recorded commit notes (historical claims):

> Two runtime defects behind "refreshing the live page shows a problem", found by
> reproducing a browser refresh at HTTP level (no fixture, no assumption):
>
> 1. MISSING ROUTES. The application is hash-routed, so a hash URL always
>    reloads `/` and works — but a CLEAN path only survives a refresh if the
>    server has a route for it. `/signin`, `/signup`, `/projects`, `/billing`,
>    `/admin` and `/master` had none: a direct request (F5, a bookmark, a shared
>    link) answered with the framework's "404: This page could not be found."
>    page (14 KB) while `/` and `/workspace` served the 146 KB shell. Each path
>    now has a real route rendering the same shell (mirroring `/workspace`) and
>    `public/app.js` maps path → screen explicitly (PATH_VIEWS). Unknown paths
>    still 404 — there is deliberately no catch-all that would swallow real
>    broken links.
>
> 2. LOST SESSION ON REFRESH. A page load starts with an empty in-memory
>    access token while the tab still holds a valid refresh token in storage.
>    The router treated "no access token in memory" as "not signed in" and sent
>    the visitor to `#/login` WITHOUT ever attempting `refreshSession()` — so
>    refreshing any page looked like being logged out. `boot()` now restores the
>    session first (single-flighted, only when a refresh token exists; a rejected
>    token is cleared and the visitor lands on the sign-in screen).
>
> Verification (scripts/verify-refresh-deeplinks.mjs, npm run verify:refresh):
> 23/23 — every app path refreshes to the shell, each path opens ITS OWN screen,
> a signed-in refresh restores a session that really works (proved by calling
> /api/me with the token the SPA obtained by rotating the stored refresh token,
> which the server also rotated), a revoked token returns to sign-in, an
> anonymous visitor is asked to sign in, the owner session reaches the owner
> plane (/api/owner/dashboard 200) while a customer session is refused (403),
> unknown paths and the private mission names still 404, and no client errors.
> The same verifier passes on the PRODUCTION build (NODE_ENV=production,
> next start + the compiled API), which also serves all eight app paths.
>
> Regression locks: src/app/deep-link-refresh.test.ts pins the route/map
> contract and the ZA141251SA isolation; the workspace UX contract now asserts
> the deep-link map instead of the old inline expression.
>
> Also in this change:
> - verify-user-journey: the credit assertion now follows the real workflow
>   outcome (a stack with no model provider FAILS honestly and charges nothing;
>   completed work charges), measured on a clean account.
> - package.json: npm run verify:refresh.
>

Verification paths changed: `scripts/verify-refresh-deeplinks.mjs`, `scripts/verify-user-journey.mjs`, `src/app/deep-link-refresh.test.ts`, `src/app/workspace-ux-contract.test.ts`

- CI [35131072091](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35131072091): docker-publish — **success**, 2026-09-16T17:54:30Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	package.json
M	public/app.js
A	scripts/verify-refresh-deeplinks.mjs
M	scripts/verify-user-journey.mjs
A	src/app/admin/page.tsx
A	src/app/billing/page.tsx
A	src/app/deep-link-refresh.test.ts
A	src/app/master/page.tsx
A	src/app/projects/page.tsx
A	src/app/signin/page.tsx
A	src/app/signup/page.tsx
M	src/app/workspace-ux-contract.test.ts
```

### `10150c6` — Run the real provider verification where provider APIs are actually reachable

- Time: 2026-09-16T18:21:23+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/10150c6f5b9f055ad18232e55165251ef3bd0686
- Parents: `648095a`
- Intent / implemented scope: Run the real provider verification where provider APIs are actually reachable

Recorded commit notes (historical claims):

> The sandbox cannot verify providers by construction: it reaches only
> api.github.com (measured), so Gemini/Stripe/Tavily/SMTP calls are impossible
> here. GitHub runners have real egress, and the repository already ships real
> probes (Gemini model listing + a live generateContent call, live Tavily/Brave/
> Serper searches, Stripe /v1/balance, an SMTP TCP connect). What was missing was
> a channel that runs them for this branch and reports honestly, per provider.
>
> production-verify.yml:
> - The push trigger pointed at `arena/01a085d2-akbaral`, a branch from an earlier
>   session, so this branch produced no production evidence at all. It now
>   matches `arena/**` and also fires when the provider checks themselves change.
> - New `provider-inventory` job: reports PRESENCE (boolean only) of every
>   credential — production URL, GOOGLE_API_KEY, search key, Stripe key and
>   webhook secret, SMTP — so it is unambiguous which dependency exists and which
>   is still an owner action. No secret value is read into the report.
> - New `real-providers` job: runs the provider checks scoped to providers
>   (`--only provider.*`) with every credential supplied from the secret store.
>   A credential that is ABSENT reports "not configured" with the exact secret to
>   add and fails nothing; a credential that EXISTS but is REJECTED by its
>   provider fails the job with the report attached. A missing provider can never
>   masquerade as a pass.
> - The production E2E job now runs only when a production base URL is configured,
>   instead of failing against the legacy default URL — a missing deployment is
>   reported as a missing deployment.
>
> src/launch/checks.ts:
> - `fingerprint()` printed the LAST FOUR CHARACTERS of a credential, and this
>   report is published (public repository, job summary, artifact). It is now a
>   short SHA-256 prefix: it still identifies which key is deployed and whether it
>   changed, while revealing no character of the credential.
>

Verification paths changed: `.github/workflows/production-verify.yml`

- CI [35133887660](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35133887660): production-verify — **success**, 2026-09-16T18:21:27Z.
- CI [35133887575](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35133887575): docker-publish — **success**, 2026-09-16T18:21:27Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/production-verify.yml
M	src/launch/checks.ts
```

### `6a5ada4` — Make provider verdicts readable from environments that cannot fetch CI logs

- Time: 2026-09-16T18:22:49+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/6a5ada4fa9156771c160a09fca43b19aaaf500a3
- Parents: `10150c6`
- Intent / implemented scope: Make provider verdicts readable from environments that cannot fetch CI logs

Recorded commit notes (historical claims):

> Job logs and artifacts are served from a blob host that the Arena sandbox
> cannot reach, which left the only CI-reachable signal as "job succeeded" — not
> good enough for a per-provider verdict. Every presence line and every provider
> check now also emits a check annotation (presence → notice, a rejected
> credential → error), and annotations ARE reachable through the checks API.
>
> No behaviour change to the verification itself: the same real calls decide the
> same statuses; only the reporting channel widened.
>

Verification paths changed: `.github/workflows/production-verify.yml`

- CI [35134035592](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35134035592): production-verify — **success**, 2026-09-16T18:22:52Z.
- CI [35134035575](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35134035575): docker-publish — **success**, 2026-09-16T18:22:52Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/production-verify.yml
```

### `a5d39cf` — Probe whether a production host is actually serving, with no credentials

- Time: 2026-09-16T18:24:23+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a5d39cfa73a42e6546e8510046b512fce23ce84f
- Parents: `6a5ada4`
- Intent / implemented scope: Probe whether a production host is actually serving, with no credentials

Recorded commit notes (historical claims):

> An image in GHCR is not a running deployment, and "not deployed" was being
> reported as an unexplained E2E failure. A new deployment-reachability job asks
> the only question that decides whether the deployed product exists — does a
> candidate host answer /api/ready — and reports each candidate as a check
> annotation: serving (with the ready payload) or not serving (with the status
> codes). It needs no credentials, and a host found live is handed straight to
> the production E2E, so the deployed product gets verified automatically the
> moment a deployment exists instead of waiting for a secret to be added.
>

Verification paths changed: `.github/workflows/production-verify.yml`

- CI [35134201203](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35134201203): docker-publish — **success**, 2026-09-16T18:24:26Z.
- CI [35134201074](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35134201074): production-verify — **success**, 2026-09-16T18:24:26Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/production-verify.yml
```

### `84188fc` — Run the real product inside the published image, not just a local process

- Time: 2026-09-16T18:26:49+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/84188fceb2ae5d3b80bdf34fd427e8735c8d95eb
- Parents: `a5d39cf`
- Intent / implemented scope: Run the real product inside the published image, not just a local process

Recorded commit notes (historical claims):

> The deployable artifact was verified only as "CI built it". A new image-e2e job
> closes that gap with no credentials required: it pulls the image built for THIS
> commit, ASSERTS the commit stamp inside it (.image-version) so a stale image can
> never count as evidence for this revision, boots it exactly as a host would
> (random SESSION_SECRET, production env, SQLite on a volume, first-boot seeding),
> then exercises the deployed product for real — /api/ready, every application
> route surviving a refresh, unknown and private paths still 404, anonymous API
> access refused, the billing catalog and the seeded 4,001-agent registry — and
> runs the browser-shaped refresh verifier plus the full customer journey against
> the running container.
>
> verify-user-journey now takes API_BASE, so the same journey that runs against a
> local stack can run against a deployed container or host.
>

Verification paths changed: `.github/workflows/production-verify.yml`, `scripts/verify-user-journey.mjs`

- CI [35134455249](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35134455249): production-verify — **failure**, 2026-09-16T18:26:52Z.
- CI [35134455240](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35134455240): docker-publish — **success**, 2026-09-16T18:26:52Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/production-verify.yml
M	scripts/verify-user-journey.mjs
```

### `4f4f207` — Fix the image E2E: pull the package with the right permission, and authenticate the registry check

- Time: 2026-09-16T18:31:40+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/4f4f20770505a6c4898617747990a73885356b27
- Parents: `84188fc`
- Intent / implemented scope: Fix the image E2E: pull the package with the right permission, and authenticate the registry check

Recorded commit notes (historical claims):

> Two mistakes in the new job, both found by running it rather than by reading it:
> - GHCR login/pull needs packages: read; the workflow only requested contents.
> - /api/agents is account-scoped (anonymous requests are refused with 401), so
>   counting the registry anonymously always read zero. The job now registers and
>   signs in inside the container — the same way a user does — and uses that
>   session, which also proves real auth works in the deployed image.
> It additionally asserts that a PAID plan is refused (402) inside the image, so a
> deployment can never silently give away subscriptions.
>
> Failure reasons are published as check annotations (job logs and artifacts live
> on a blob host some environments cannot reach), including the container's own
> log tail, so a failed deployment check explains itself.
>

Verification paths changed: `.github/workflows/production-verify.yml`

- CI [35134959647](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35134959647): production-verify — **failure**, 2026-09-16T18:31:43Z.
- CI [35134959613](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35134959613): docker-publish — **success**, 2026-09-16T18:31:43Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/production-verify.yml
```

### `3c927e9` — Let the image E2E exercise the owner plane, and make journey failures explain themselves

- Time: 2026-09-16T18:36:02+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/3c927e9162a84b5562c4792afe8de8ee6c934e1a
- Parents: `4f4f207`
- Intent / implemented scope: Let the image E2E exercise the owner plane, and make journey failures explain themselves

Recorded commit notes (historical claims):

> The container booted and served (auth and refresh answered 200) but the run
> still failed silently: the refresh verifier hard-fails when no owner
> credentials exist, and in CI none do — the credentials file is gitignored on
> purpose. The job now registers an account inside the container and promotes it
> through the database, which is the operator's own identity path rather than a
> bypass: the product's real role check then applies. Both journey scripts run
> against the deployed container with those credentials, and any FAIL line is
> republished as a check annotation, so a future failure names itself instead of
> requiring log access that some environments do not have.
>

Verification paths changed: `.github/workflows/production-verify.yml`

- CI [35135415884](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35135415884): docker-publish — **success**, 2026-09-16T18:36:05Z.
- CI [35135415866](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35135415866): production-verify — **success**, 2026-09-16T18:36:05Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/production-verify.yml
```

### `e1e7153` — Publish the image E2E's measured numbers as annotations

- Time: 2026-09-16T18:40:44+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e1e715374dd6a3638aca6333a7f58dc1d3e2f231
- Parents: `3c927e9`
- Intent / implemented scope: Publish the image E2E's measured numbers as annotations

Recorded commit notes (historical claims):

> "The job was green" is not evidence a reader can audit when the logs live on a
> host they cannot reach. The image verification now states what it measured: the
> journey verdicts (refresh/deep links and the customer journey) and the product
> facts read out of the running container (plan count, agents returned to a real
> session, and that a paid plan was refused with 402).
>

Verification paths changed: `.github/workflows/production-verify.yml`

- CI [35135895864](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35135895864): docker-publish — **success**, 2026-09-16T18:40:47Z.
- CI [35135895861](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35135895861): production-verify — **success**, 2026-09-16T18:40:47Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/production-verify.yml
```

### `611eb29` — Lock ZA141251SA to its single configured identity

- Time: 2026-09-16T19:39:33+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/611eb292b190332e8746f4c63f6544a4de214b11
- Parents: `e1e7153`
- Intent / implemented scope: Lock ZA141251SA to its single configured identity

Recorded commit notes (historical claims):

> The mission accepted any account that existed in mission_owner: a second
> account (or an access link minted earlier) could authenticate and read the
> whole private mission. Verified live before the fix: a foreign account logged
> in with HTTP 200 and a pre-existing link returned 7,972 bytes of mission data.
>
> Enforcement (one module, one allowlist):
>   · login() refuses any email that is not ZA141251SA_OWNER_EMAIL before any
>     credential work, with a refusal that never echoes the configured address;
>   · resolveSession() re-checks the identity and revokes the session (fails
>     closed on every route, including sessions minted before the lockdown);
>   · provisionOwner() cannot create or re-key a second mission account;
>   · enforcement sweep at mission:init and mission:serve suspends foreign
>     accounts, revokes their sessions and revokes pre-existing access links;
>   · mission:serve refuses to open its socket when the lockdown cannot be
>     verified clean; mission:init and the boot banner report the state.
>
> Verified after the fix (live, same server): foreign login 403
> identity_restricted even with the owner password, revoked link 401,
> anonymous 401, configured identity 200 + 7,972 bytes of mission data.
> Tests: src/mission/mission-identity-lock.test.ts 9/9; mission suite 75/75;
> tsc clean; npm run verify:mission-lock 17/17.
>

Verification paths changed: `scripts/verify-mission-identity-lock.mjs`, `src/mission/mission-identity-lock.test.ts`

- CI [35141890576](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35141890576): docker-publish — **success**, 2026-09-16T19:39:39Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations-mission/0006_identity_lock.sql
M	package.json
M	scripts/mission-init.ts
M	scripts/mission-serve.ts
A	scripts/verify-mission-identity-lock.mjs
M	src/mission/auth.ts
A	src/mission/identity-lock.ts
A	src/mission/mission-identity-lock.test.ts
M	src/mission/reporting.ts
M	src/mission/server.ts
```

### `716402b` — Verify the owner identity, role separation and the unlimited entitlement end to end

- Time: 2026-09-16T19:40:43+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/716402b09a72f48ddb8946953b610d961e6fd41e
- Parents: `611eb29`
- Intent / implemented scope: Verify the owner identity, role separation and the unlimited entitlement end to end

Recorded commit notes (historical claims):

> scripts/verify-owner-identity.mjs (npm run verify:owner-identity) proves against
> a running API, on real rows and real workflows:
>   · the configured owner email lands as `owner`; every other account is `user`;
>   · an ordinary account is refused the owner console and the staff plane (403);
>   · with its balance zeroed, an ordinary account's MASTER task FAILS with
>     'Task credits exhausted. This capability requires AKBARAL Pro.' and consumes
>     nothing, while the owner's identical call COMPLETES and consumes nothing;
>   · the exemption is written to the audit chain (owner.unlimited_execution);
>   · exactly one owner account exists and the seeded staff rows cannot log in.
>
> Live: 18/18.
>

Verification paths changed: `scripts/verify-owner-identity.mjs`

- CI [35142003226](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35142003226): docker-publish — **success**, 2026-09-16T19:40:46Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	package.json
A	scripts/verify-owner-identity.mjs
```

### `b53766d` — Finish the real-money system: reinvestment, fixed daily target, approvals that pay

- Time: 2026-09-16T19:43:23+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/b53766df28f62758bc56e2852843d0e1cef8edae
- Parents: `716402b`
- Intent / implemented scope: Finish the real-money system: reinvestment, fixed daily target, approvals that pay

Recorded commit notes (historical claims):

> Money that already existed (wallets, hash-chained ledger, verified revenue,
> governed expenses, four payout slots) is now complete and verifiable end to end:
>
>   · Reinvestment reserve: policy-controlled share (basis points) of every
>     VERIFIED received revenue is moved out of the treasury as a real ledger
>     transfer pair, idempotent per revenue row, with the remainder staying
>     liquid. A 0 bps policy allocates nothing; a share below one minor unit
>     allocates nothing rather than inventing rounding.
>   · Fixed daily revenue target: owner-configured target with progress counted
>     from 'received' revenue only (expected/contracted reported separately), a
>     met day recorded once and audited once.
>   · Approval queue fix: approving an expense approval now PAYS the expense and
>     an owner-granted approval is honoured, so a request can no longer be
>     stranded between two entry points; an already-paid expense cannot be paid
>     twice.
>
> Interface: GET /api/reinvestment, daily status on GET /api/targets, and policy
> PATCH accepts reinvestShareBps / dailyRevenueTargetCents.
>
> Tests: src/mission/mission-reinvestment.test.ts 9/9; mission suite 84/84;
> tsc clean. Live: npm run verify:mission-money 41/41 against the running mission
> server (owner capital, auto-approved spend, cap refusal, approval, kill switch,
> verified earning, reinvestment, daily target, ledger + audit chains).
>

Verification paths changed: `scripts/verify-mission-money.mjs`, `src/mission/mission-reinvestment.test.ts`

- CI [35142268541](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35142268541): docker-publish — **success**, 2026-09-16T19:43:26Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations-mission/0007_reinvestment_daily_target.sql
M	package.json
A	scripts/verify-mission-money.mjs
A	src/mission/mission-reinvestment.test.ts
M	src/mission/policy.ts
M	src/mission/server.ts
M	src/mission/treasury.ts
```

### `eb25158` — Verify the 4,001-agent fleet's executability and its MASTER routing

- Time: 2026-09-16T19:45:19+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/eb25158dc83f5ec372397f400356309632dc38f7
- Parents: `b53766d`
- Intent / implemented scope: Verify the 4,001-agent fleet's executability and its MASTER routing

Recorded commit notes (historical claims):

> scripts/verify-agent-fleet.mjs (npm run verify:agent-fleet) proves, from the
> live API and real executions:
>
>   · all 4,001 registry agents are enumerable with unique slugs across many
>     categories, and a cross-category sample carries the full executable
>     contract (instructions, workflow, verification rules, outputs);
>   · the fleet's own per-agent audit runs and every agent carries a verdict —
>     FAILED=0, BLOCKED=0, MISSING_DEPENDENCY=0, and each degraded agent names its
>     exact missing dependency (in this environment: 3,801 ACTIVE, 200 need
>     OPENAI_API_KEY). With no provider configured the same audit reports all
>     4,001 as NEEDS_CONFIGURATION naming 'GOOGLE_API_KEY' — the Gemini blocker,
>     never a silent pass;
>   · distinct goals executed through MASTER complete with every step run against
>     a real registry agent (15 distinct specialists across 6 goals), each
>     producing a final result document that discloses how it was produced.
>
> Live: 16/16.
>

Verification paths changed: `scripts/verify-agent-fleet.mjs`

- CI [35142462254](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35142462254): docker-publish — **success**, 2026-09-16T19:45:22Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	package.json
A	scripts/verify-agent-fleet.mjs
```

### `93b6cc6` — Probe the committed host list so a live production runtime is verified from outside

- Time: 2026-09-16T19:47:14+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/93b6cc62b9486eea90860b0c2f41a5299b53cf35
- Parents: `eb25158`
- Intent / implemented scope: Probe the committed host list so a live production runtime is verified from outside

Recorded commit notes (historical claims):

> deployment-reachability now reads .github/production-targets.json in addition
> to the configured secrets/inputs, and the job checks the repository out so the
> list is available. A candidate that answers /api/ready with 200 is handed to
> the production E2E job, so the AKBARAL! production runtime served on the
> workspace host is verified over the public internet (TLS + real HTTP) from a
> GitHub runner — not from inside the machine that serves it.
>

Verification paths changed: `.github/workflows/production-verify.yml`

- CI [35142656992](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35142656992): production-verify — **success**, 2026-09-16T19:47:19Z.
- CI [35142656975](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35142656975): docker-publish — **success**, 2026-09-16T19:47:19Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.github/production-targets.json
M	.github/workflows/production-verify.yml
M	next-env.d.ts
```

### `14efc41` — Make the refresh verifier honest under the real rate limiter and both credentials formats

- Time: 2026-09-16T19:56:08+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/14efc4133abe4c74a345f460772886df3876f651
- Parents: `93b6cc6`
- Intent / implemented scope: Make the refresh verifier honest under the real rate limiter and both credentials formats

Recorded commit notes (historical claims):

> Three verifier defects found while running the suite against the production
> runtime (the product was correct in each case; the verifier was not):
>
>   · /api/auth allows 30 requests/minute, so a run that creates one session per
>     route could be throttled — and a 429 then looked like 'no usable token'.
>     The verifier now retries with backoff and reports the limiter explicitly.
>   · the session-restore proof read localStorage before the SPA finished
>     restoring; it now waits (bounded) for the rotated refresh token, then makes
>     the same assertion.
>   · .platform-owner-credentials.txt is two lines (email, password); the readers
>     now accept both that and labelled lines, so a regenerated ops file cannot
>     silently break the owner half of any audit.
>
> Live against the production runtime: REFRESH + DEEP LINKS VERIFIED — 23/23.
>

Verification paths changed: `scripts/verify-refresh-deeplinks.mjs`

- CI [35143535498](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35143535498): docker-publish — **success**, 2026-09-16T19:56:11Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/probe-integrations-live.mjs
M	scripts/verify-refresh-deeplinks.mjs
```

### `483452d` — Make the owner credential files the real deployment secrets again

- Time: 2026-09-16T19:58:07+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/483452d1166fd961e4c0eba7022f19a3c3e9ff3d
- Parents: `14efc41`
- Intent / implemented scope: Make the owner credential files the real deployment secrets again

Recorded commit notes (historical claims):

> Two ops-file defects found while running the launch battery, both of which
> would have weakened owner sign-in:
>
>   · .platform-owner-credentials.txt held a 4-character placeholder and the
>     stored owner hash had been rotated to it (the API only enforces length on
>     REGISTER, so the short secret signed in). The platform owner password is
>     now a 24-character random secret held only in the gitignored, mode-600
>     deployment file; the hash was rotated to match and the rotation audited.
>     The owner *email* still comes from AKBARAL_OWNER_EMAIL — no secret in
>     source.
>   · .mission-owner-credentials.txt did not match .mission-secrets.env (the
>     mission console signs in with the 24-character ZA141251SA_OWNER_PASSWORD).
>     The mirror file is regenerated from the mission secrets file.
>
> Also: scripts/live-shell-smoke.mjs treats the API's 'email already registered'
> (400 code=conflict) as the normal case when the operator file is present — the
> login below is what proves the credentials — instead of aborting the smoke.
>
> Verified live: platform owner login 200 role=owner (24-char secret);
> mission owner login 200 on the mission console.
>

Verification paths changed: `scripts/live-shell-smoke.mjs`

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/live-shell-smoke.mjs
```

### `8c1abb4` — Shell smoke: drive the website goal the artifact checks assert

- Time: 2026-09-16T20:03:52+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/8c1abb45f069f176f667a909e442d4a3d63da983
- Parents: `483452d`
- Intent / implemented scope: Shell smoke: drive the website goal the artifact checks assert

Recorded commit notes (historical claims):

> The smoke typed 'Build me a calculator' and then asserted the website
> deliverable path (preview frame, Files artifact, export version). A calculator
> goal is not a website goal, so the pipeline honestly produced a specialist
> answer and captured no website artifact — the six 'artifact' checks failed
> against correct product behaviour. It now types the same website goal the
> website-builder battery uses.
>
> Live against the production runtime: 71/71 shell checks passed, runtime
> problems: none — including the real captured HTML in the sandboxed preview
> frame, the Files artifact entry and the exported website version.
>

Verification paths changed: `scripts/live-shell-smoke.mjs`

- CI [35144285902](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35144285902): docker-publish — **success**, 2026-09-16T20:03:55Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/live-shell-smoke.mjs
```

### `16d6396` — Recovery: restore must not depend on reading the database it is recovering

- Time: 2026-09-16T20:10:58+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/16d639603bfea3866b113e18452dbb699441d832
- Parents: `8c1abb4`
- Intent / implemented scope: Recovery: restore must not depend on reading the database it is recovering

Recorded commit notes (historical claims):

> Real gap found by the new drill: when the live file is corrupt (the exact
> disaster a restore exists for), restoreVerifiedBackup failed at its pre-restore
> safety snapshot — a corrupt file cannot be VACUUM-INTOn — so the operator could
> not restore the good snapshot at all.
>
>   · the pre-restore snapshot is now resilient: on a healthy database it is the
>     same transactionally consistent VACUUM-INTO copy as before; when the file
>     is unreadable it is preserved verbatim (pre-restore-unreadable-<stamp>.db)
>     for forensics instead of being discarded, and when no file exists the
>     restore reports that honestly. The result now carries safetySnapshot:
>     'consistent' | 'preserved-corrupt' | 'absent' and the CLI says which case
>     it took.
>   · the live file is resolved from PRAGMA database_list when readable, falling
>     back to the configured DATABASE_URL path, so a broken connection cannot
>     block the recovery either.
>
> New scripts/verify-recovery.mjs (npm run verify:recovery) is the full drill
> against the running stack, non-destructive (works on copies): verified snapshot
> of the serving platform database → row counts identical → restore over a
> simulated-damage file → an unverifiable backup refused → unreadable previous
> file preserved → restored database fully migrated → an API booted ON the
> restored file reports /api/ready, signs the owner in, refuses a wrong password
> and serves the 4,001-agent registry; mission database snapshot → integrity →
> hash-chained audit (152 rows) and ledger (35 rows) verify → exactly one ACTIVE
> owner (the configured email), foreign owner suspended, zero foreign live
> sessions.
>
> Live: RECOVERY DRILL — 24/24 (unit: src/scripts/backup.test.ts 4/4 with
> migrations applied, tsc clean).
>

Verification paths changed: `scripts/verify-recovery.mjs`

- CI [35145001840](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35145001840): docker-publish — **success**, 2026-09-16T20:11:01Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	package.json
A	scripts/verify-recovery.mjs
M	src/scripts/backup-db.ts
M	src/scripts/restore-db.ts
```

### `336fe12` — Verify the owner identity and unlimited entitlement live (blocker #7)

- Time: 2026-09-16T20:11:51+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/336fe12db7174c85f536303f792d08b330d864e7
- Parents: `16d6396`
- Intent / implemented scope: Verify the owner identity and unlimited entitlement live (blocker #7)

Recorded commit notes (historical claims):

> New scripts/verify-owner-entitlement.mjs (npm run verify:owner-entitlement) is
> the live, end-to-end proof against the running platform:
>
>   A. identity — the configured Gmail signs in as role owner, reaches the
>      owner-only plane (200) and is the ONLY owner/super_admin row in the
>      database; a fresh account authenticates as a normal user and is refused on
>      both the owner plane and the staff plane (403); no seeded staff/elevated
>      account carries a password at all, so none of them can authenticate.
>   B. entitlement — with the ordinary account genuinely zeroed to 0 credits, its
>      real MASTER goal ends 'failed' with the honest reason (Task credits
>      exhausted. This capability requires AKBARAL Pro.), consuming nothing; the
>      owner's real MASTER goal completes with a real step graph and result
>      document while consuming ZERO credits (no negative credit transaction at
>      all) and the unlimited entitlement is audited (owner.unlimited_execution).
>
> Live: 18/18 checks passed (~5s).
>

Verification paths changed: `scripts/verify-owner-entitlement.mjs`

- CI [35145093117](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35145093117): docker-publish — **success**, 2026-09-16T20:11:55Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	package.json
A	scripts/verify-owner-entitlement.mjs
```

### `a40697f` — Security gate green again; the recovery drill leaves no runaway process

- Time: 2026-09-16T20:13:08+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a40697f82ebf30a93dbe4cdc646c9e56ac6ad9a2
- Parents: `336fe12`
- Intent / implemented scope: Security gate green again; the recovery drill leaves no runaway process

Recorded commit notes (historical claims):

> Two real defects from the previous commits, both caught by running the full
> battery rather than trusting the targeted runs:
>
>   · the repository's own secret-scan gate (src/security/scan-secrets.test.ts)
>     failed on scripts/verify-mission-identity-lock.mjs — the forged session
>     token was written as a literal 'Bearer [historical example omitted]', which is
>     exactly the shape the scanner refuses to path-exempt (by design: a bearer
>     token may never be hidden by an exemption). The probe token is now built at
>     runtime, so the tree holds no credential-shaped literal while the mission
>     console is still probed with a real forged header.
>   · the recovery drill started its verification API through , and killing
>     the npx wrapper orphaned the real server: the drill left a process bound to
>     :4100. It now starts the API in its OWN process group, terminates the whole
>     group (SIGTERM then SIGKILL), refuses to run if the port is already serving
>     a stale server (so a pass can never come from someone else's process), and
>     asserts the port is released at the end.
>
> Verified: secret-scan suite 5/5 and npm run scan:secrets PASS; mission lock
> 17/17 (the forged token is still refused with 401); recovery drill 25/25 with
> 'port 4100 released'.
>

Verification paths changed: `scripts/verify-mission-identity-lock.mjs`, `scripts/verify-recovery.mjs`

- CI [35145223543](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35145223543): docker-publish — **success**, 2026-09-16T20:13:11Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/verify-mission-identity-lock.mjs
M	scripts/verify-recovery.mjs
```

### `e59c1ff` — Run the owner-plane battery in the production verification channel

- Time: 2026-09-16T20:23:44+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/e59c1ffd18cf0ce78e498e23d1851df3673c1b6a
- Parents: `a40697f`
- Intent / implemented scope: Run the owner-plane battery in the production verification channel

Recorded commit notes (historical claims):

> The production-verify workflow now also proves, against the DEPLOYED stack,
> that the configured Gmail is the single owner identity and that its usage is
> unlimited while an exhausted ordinary account is honestly refused — the same
> battery that runs green locally (19/19).
>
> Honest wiring: the step needs the owner's own credentials and a readable copy
> of the deployment database. When either is absent the script exits 2 and the
> step reports 'could not run' via an annotation, so an unconfigured channel can
> never look like a pass. Nothing about the deployed product is simulated.
>
> Local run unchanged and still green (19/19, ~5s).
>

Verification paths changed: `.github/workflows/production-verify.yml`, `scripts/verify-owner-entitlement.mjs`

- CI [35146300893](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35146300893): docker-publish — **success**, 2026-09-16T20:23:47Z.
- CI [35146300873](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35146300873): production-verify — **success**, 2026-09-16T20:23:47Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/production-verify.yml
M	scripts/verify-owner-entitlement.mjs
```

### `d60ba59` — Report the verified production-launch state

- Time: 2026-09-16T20:30:02+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/d60ba591934d04a4a78c0395f971a9f1840de88a
- Parents: `e59c1ff`
- Intent / implemented scope: Report the verified production-launch state

Recorded commit notes (historical claims):

> docs/PRODUCTION_LAUNCH_STATUS.md is the single factual summary: the exact
> remaining owner actions (Gemini key, search key, Stripe key + webhook secret,
> SMTP, a real host with DNS/TLS, mission payout destination, optional social
> OAuth/Android signing), the exact verified items for blockers #5-#10 with the
> command and score for each, the test totals (703/703 unit, every live battery)
> and the defects fixed while producing the evidence.
>
> It states plainly that no public host serves AKBARAL! yet, so the production
> URL is pending the owner's deploy — nothing is declared LIVE.
>

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	docs/PRODUCTION_LAUNCH_STATUS.md
```

## Day 11 — 2026-09-17

### `78aad86` — Add the StackHost deployment config; make the public tier follow the platform PORT

- Time: 2026-09-17T02:49:19+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/78aad864ce38736e32203bab39101dc832101607
- Parents: `d60ba59`
- Intent / implemented scope: Add the StackHost deployment config; make the public tier follow the platform PORT

Recorded commit notes (historical claims):

> stackhost.yaml is the minimum configuration StackHost needs (the three
> documented sections: runtime.image, commands.{package,build,start},
> repository.{branch,auto_deploy}). It reuses the repository's existing
> production path instead of inventing a second one: the build is exactly the
> Dockerfile's (npm ci -> npm run build) and the start is exactly the
> Dockerfile's CMD (scripts/entrypoint.sh: migrations, optional seed, verified
> backups, then scripts/start-prod.mjs). No secrets live in the file; the
> comment block names where each variable goes (StackHost's Environment
> Variables settings).
>
> Port: StackHost routes traffic to the port it injects as PORT. The public
> entry point is the Next.js tier (it serves the app and rewrites /api,
> /uploads, /ws), so the web tier must bind that port while the API stays
> internal. scripts/start-prod.mjs now resolves:
>   web  AKBARAL_WEB_PORT, else PORT when it does not collide with the API
>        port, else 3000
>   api  AKBARAL_API_PORT, else 4000
> and refuses to start on an impossible value. The rule is chosen so no existing
> deployment changes behaviour: PORT=<api port> (what the preview supervisor and
> the panel scripts export) still means the API port and leaves the web tier on
> 3000; docker-compose and the Modal deployment are untouched. The web tier is
> now explicit about binding all interfaces. A side-effect-free --print-ports
> mode reports the resolved ports. The Dockerfile HEALTHCHECK mirrors the same
> precedence, and the entrypoint no longer prints ports it may not use.
>
> Tests: the port contract is now locked by EXECUTING the real script
> (src/app/prod-roles.test.ts --print-ports matrix: defaults, injected PORT,
> explicit overrides, invalid-port refusal), which is strictly stronger than the
> source-text match it replaces. src/security/role-separation.test.ts asserted
> that the rendered public document has no mission identifier by fetching
> through GET / -> the configured public web origin, which failed whenever
> nothing listened on the default :3000; it now checks the redirect target, the
> static assets this server really serves, and every public page source
> (30+ files) — same guarantee, no dependence on an unrelated server.
>
> Verified: stackhost.yaml parses (js-yaml); the declared build ran
> (npm ci --include=dev, npm run build: EXIT=0 twice); the declared start ran for
> real — PORT=8080 -> web :8080 public + api :4000 internal, /api/ready, / and
> /api/health all 200, nothing on :3000; PORT=4000 -> web :3000 + api :4000
> (unchanged); PORT=not-a-port -> refused; tsc clean; full suite 706/706, 0
> failures.
>
> NOTE: StackHost's repository.branch is main, which currently holds only the
> README — the application lives on this branch. Merge this branch into main (or
> point StackHost's branch selector here) before the first deploy.
>

Verification paths changed: `src/app/prod-roles.test.ts`, `src/security/role-separation.test.ts`

- CI [35175859977](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35175859977): docker-publish — **success**, 2026-09-17T02:49:26Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	Dockerfile
M	scripts/entrypoint.sh
M	scripts/start-prod.mjs
M	src/app/prod-roles.test.ts
M	src/security/role-separation.test.ts
A	stackhost.yaml
```

### `c6c0471` — Merge pull request #1 from Azadar-Templates/arena/01a0a045-akbaral

- Time: 2026-09-17T03:18:51+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/c6c0471cf7b8a2f076a2f5e1997963093d926adb
- Parents: `6c3a544 78aad86`
- Intent / implemented scope: Merge pull request #1 from Azadar-Templates/arena/01a0a045-akbaral

Recorded commit notes (historical claims):

> Deploy AKBARAL production

Verification paths changed: none in this commit.

- CI [35177703216](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35177703216): docker-publish — **success**, 2026-09-17T03:18:57Z.
- CI [35201516116](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35201516116): keep-alive — **success**, 2026-09-17T08:46:39Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
(merge/topology-only; inspect parents with git show -m)
```

### `a860be7` — fix(stackhost): resolve silent startup failure on deploy

- Time: 2026-09-17T11:35:17+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a860be78343b029da9d9dddc5a1529e89b08c7ec
- Parents: `c6c0471`
- Intent / implemented scope: fix(stackhost): resolve silent startup failure on deploy

Recorded commit notes (historical claims):

> StackHost deployments were dying 2-3 seconds after start with no
> application logs. Root causes:
>
> - scripts/entrypoint.sh ran the migrate/seed/backup steps under
>   `set -eu` and could abort before Node ever printed a line (e.g. a
>   missing build artifact whose output was not carried from the build
>   step into the start step).
> - A container that never had SESSION_SECRET configured hit the
>   mandatory production config guard with no actionable diagnostic.
>
> Changes:
>
> - scripts/start-prod.mjs: generate a cryptographically random 48-byte
>   SESSION_SECRET when one is not explicitly configured, persist it to
>   disk with 0600 permissions, and reuse it across restarts of the same
>   volume. An explicitly configured SESSION_SECRET remains authoritative
>   and the secret value is never logged. Database migrations (and the
>   optional seed step) now run from this script before any tier starts.
>   Added a startup preflight that checks for the compiled dist/ and
>   .next/ build artifacts and fails fast with a clear, actionable
>   message when they're missing, or self-heals via `npm run build` when
>   AKBARAL_AUTO_BUILD=true. Existing PORT/AKBARAL_ROLES handling is
>   unchanged.
> - scripts/entrypoint.sh: the nightly backup loop is now the only thing
>   this script does before handing off; it execs
>   `node scripts/start-prod.mjs` as its final statement so the wrapper
>   becomes the container's real PID 1 payload and a crash always
>   produces a real exit code and log trail instead of a silently
>   vanishing shell.
> - stackhost.yaml: build/start commands documented explicitly
>   (`npm ci --include=dev && npm run build` / `sh scripts/entrypoint.sh`),
>   updated SESSION_SECRET guidance to describe the new auto-generate
>   behavior, removed the stale note about main lacking the application
>   (main already contains it), and preserved the StackHost-injected PORT
>   contract.
> - src/app/stackhost-deploy.test.ts: new contract lock covering the
>   deployment/startup fix — entrypoint execs without a trailing
>   statement, the backup loop can't abort startup, SESSION_SECRET
>   generation/persistence/reuse/redaction, build-artifact preflight
>   (fail-fast and AKBARAL_AUTO_BUILD self-heal), migration-before-listen
>   ordering, and the PORT contract regression guard.
>
> No existing functionality removed; no credentials exposed. Full test
> suite (74 files) and production build verified green.
>

Verification paths changed: `src/app/stackhost-deploy.test.ts`

- CI [35216482716](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35216482716): docker-publish — **success**, 2026-09-17T11:35:25Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/entrypoint.sh
M	scripts/start-prod.mjs
A	src/app/stackhost-deploy.test.ts
M	stackhost.yaml
```

### `2a145fe` — Merge pull request #2 from Azadar-Templates/arena/01a0aef5-akbaral

- Time: 2026-09-17T11:40:10+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/2a145fea30216db8970e76d5a42cdc2a02deb874
- Parents: `c6c0471 a860be7`
- Intent / implemented scope: Merge pull request #2 from Azadar-Templates/arena/01a0aef5-akbaral

Recorded commit notes (historical claims):

> fix(stackhost): resolve silent startup failure on deploy

Verification paths changed: none in this commit.

- CI [35216904496](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35216904496): docker-publish — **success**, 2026-09-17T11:40:13Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
(merge/topology-only; inspect parents with git show -m)
```

### `4d75c47` — fix(stackhost): resolve silent startup failure on deploy

- Time: 2026-09-17T12:30:08+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/4d75c47e170c6a3eb306223dda7180e8534828f3
- Parents: `2a145fe`
- Intent / implemented scope: fix(stackhost): resolve silent startup failure on deploy

Recorded commit notes (historical claims):

> StackHost deployments were dying 2-3 seconds after start with no
> application logs. Root causes:
>
> - scripts/entrypoint.sh ran the migrate/seed/backup steps under
>   `set -eu` and could abort before Node ever printed a line (e.g. a
>   missing build artifact whose output was not carried from the build
>   step into the start step).
> - A container that never had SESSION_SECRET configured hit the
>   mandatory production config guard with no actionable diagnostic.
>
> Changes:
>
> - scripts/start-prod.mjs: generate a cryptographically random 48-byte
>   SESSION_SECRET when one is not explicitly configured, persist it to
>   disk with 0600 permissions, and reuse it across restarts of the same
>   volume. An explicitly configured SESSION_SECRET remains authoritative
>   and the secret value is never logged. Database migrations (and the
>   optional seed step) now run from this script before any tier starts.
>   Added a startup preflight that checks for the compiled dist/ and
>   .next/ build artifacts and fails fast with a clear, actionable
>   message when they're missing, or self-heals via `npm run build` when
>   AKBARAL_AUTO_BUILD=true. Existing PORT/AKBARAL_ROLES handling is
>   unchanged.
> - scripts/entrypoint.sh: the nightly backup loop is now the only thing
>   this script does before handing off; it execs
>   `node scripts/start-prod.mjs` as its final statement so the wrapper
>   becomes the container's real PID 1 payload and a crash always
>   produces a real exit code and log trail instead of a silently
>   vanishing shell.
> - stackhost.yaml: build/start commands documented explicitly
>   (`npm ci --include=dev && npm run build` / `sh scripts/entrypoint.sh`),
>   updated SESSION_SECRET guidance to describe the new auto-generate
>   behavior, removed the stale note about main lacking the application
>   (main already contains it), and preserved the StackHost-injected PORT
>   contract.
> - src/app/stackhost-deploy.test.ts: new contract lock covering the
>   deployment/startup fix — entrypoint execs without a trailing
>   statement, the backup loop can't abort startup, SESSION_SECRET
>   generation/persistence/reuse/redaction, build-artifact preflight
>   (fail-fast and AKBARAL_AUTO_BUILD self-heal), migration-before-listen
>   ordering, and the PORT contract regression guard.
>
> No existing functionality removed; no credentials exposed. Full test
> suite (74 files) and production build verified green.
>

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
(merge/topology-only; inspect parents with git show -m)
```

### `41dc4a9` — Merge pull request #3 from Azadar-Templates/arena/stackhost-fix-1789648208

- Time: 2026-09-17T12:37:56+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/41dc4a957afb1e404e82105e96f2c4a04a2bfca0
- Parents: `2a145fe 4d75c47`
- Intent / implemented scope: Merge pull request #3 from Azadar-Templates/arena/stackhost-fix-1789648208

Recorded commit notes (historical claims):

> fix(stackhost): resolve silent startup failure on deploy

Verification paths changed: none in this commit.

- CI result: no retained run returned for this commit. Consult its reports/notes for historical local-test claims; otherwise unknown.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
(merge/topology-only; inspect parents with git show -m)
```

### `b82c420` — fix(stackhost): correct build schema — list not string (was silent 2-5s failure)

- Time: 2026-09-17T12:44:04+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/b82c4202405638618cbbedd14b57b6ea79cb29eb
- Parents: `41dc4a9`
- Intent / implemented scope: fix(stackhost): correct build schema — list not string (was silent 2-5s failure)

Recorded commit notes (historical claims):

> Root cause: commit a860be783 changed commands.build from the correct
> YAML list:
>
>   build:
>     - "npm ci --include=dev"
>     - "npm run build"
>
> to a single string:
>
>   build: "npm ci --include=dev && npm run build"
>
> StackHost's official docs (stackhost.org homepage and every public
> example — nslooks/stackhost.org, jpus/stackhost-node,
> kanezikii/stackhost, SanjeevYuvaraj/Stackhost) define build as a
> YAML array of commands. When a string is supplied the platform's
> build step is skipped or fails schema validation before the container
> even starts — exactly the 2-5 second silent exit seen in main at
> 41dc4a9 (and de595c/e1befd deployments) with no application logs.
> The subsequent PR #3 (4d75c47) was an empty commit on top of the same
> broken yaml, so main remained broken.
>
> With no build, dist/ and .next/ are never produced. The previous
> start-prod preflight would have logged "cannot start: the production
> build has not run" but that path is only reached if the container's
> start actually executes — the build schema error aborts earlier at the
> platform layer.
>
> Fix: restore the documented list form, verified via js-yaml that
> commands.build parses to an array ["npm ci --include=dev",
> "npm run build"] (was string). The Dockerfile does the same two
> steps; the platform now executes both and the compiled artifacts are
> present for start-prod.mjs to launch. Updated the contract test to
> assert the list form and to reject the string form, matching the
> real StackHost schema.
>
> Test: src/app/stackhost-deploy.test.ts 13/13 pass, npm run build
> exit 0 (dist/src/index.js + .next/BUILD_ID present), js-yaml
> parses build as array.
>

Verification paths changed: `src/app/stackhost-deploy.test.ts`

- CI [35222819618](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35222819618): docker-publish — **success**, 2026-09-17T12:44:11Z.
- CI [35222854404](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35222854404): docker-publish — **success**, 2026-09-17T12:44:31Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app/stackhost-deploy.test.ts
M	stackhost.yaml
```

### `d131c58` — Merge pull request #4 from Azadar-Templates/arena/stackhost-yaml-schema-fix

- Time: 2026-09-17T12:48:56+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/d131c581716f7bb071531ea89e35049509b78910
- Parents: `41dc4a9 b82c420`
- Intent / implemented scope: Merge pull request #4 from Azadar-Templates/arena/stackhost-yaml-schema-fix

Recorded commit notes (historical claims):

> fix(stackhost): correct build schema — list not string (was silent 2-5s failure)

Verification paths changed: none in this commit.

- CI [35223287087](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35223287087): docker-publish — **success**, 2026-09-17T12:48:59Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
(merge/topology-only; inspect parents with git show -m)
```

### `674a78b` — fix(stackhost): make agent registry sync non-blocking so 3s health check passes

- Time: 2026-09-17T13:02:43+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/674a78b7de25aaa8b7bc24d7e436795284a0e7c1
- Parents: `b82c420`
- Intent / implemented scope: fix(stackhost): make agent registry sync non-blocking so 3s health check passes

Recorded commit notes (historical claims):

> StackHost deployments were still failing at 3s after PR #4 fixed the
> build YAML list. Root cause was src/index.ts blocking api.listen()
> on syncAgentRegistry() (~10-40s for 4001 agents) — the container never
> became ready within StackHost's 3-second startup probe and was killed
> with ECONNREFUSED on :4000 (web proxied 500).
>
> - Move registry sync to after api.listen() + setImmediate, so the API
>   is listening on :4000 within ~200ms and /api/ready returns 200 at
>   1s (verified locally: default :3000 and PORT=8080 both 200 at 1s,
>   vs 28+ sec before).
> - build already correct (list: npm ci --include=dev, npm run build),
>   package: "" and runtime: node:22 match StackHost homepage.
>
> Verified: npm run build, 13/13 stackhost-deploy, PORT=8080 and
> PORT=3000 both 200 at 1s.
>

Verification paths changed: none in this commit.

- CI [35224652181](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35224652181): docker-publish — **success**, 2026-09-17T13:02:48Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/index.ts
```

### `353e865` — fix(stackhost): make agent registry sync non-blocking so 3s health check passes

- Time: 2026-09-17T13:03:09+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/353e865e7ee7b3153165bcbde446e1816b3c5aaf
- Parents: `b82c420`
- Intent / implemented scope: fix(stackhost): make agent registry sync non-blocking so 3s health check passes

Recorded commit notes (historical claims):

> StackHost deployments were still failing at 3s after PR #4 fixed the
> build YAML list. Root cause was src/index.ts blocking api.listen()
> on syncAgentRegistry() (~10-40s for 4001 agents) — the container never
> became ready within StackHost's 3-second startup probe and was killed
> with ECONNREFUSED on :4000 (web proxied 500).
>
> - Move registry sync to after api.listen() + setImmediate, so the API
>   is listening on :4000 within ~200ms and /api/ready returns 200 at
>   1s (verified locally: default :3000 and PORT=8080 both 200 at 1s,
>   vs 28+ sec before).
> - build already correct (list: npm ci --include=dev, npm run build),
>   package: "" and runtime: node:22 match StackHost homepage.
>
> Verified: npm run build, 13/13 stackhost-deploy, PORT=8080 and
> PORT=3000 both 200 at 1s.
>

Verification paths changed: none in this commit.

- CI [35224692738](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35224692738): docker-publish — **success**, 2026-09-17T13:03:13Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/index.ts
```

### `00a65e3` — Merge pull request #5 from Azadar-Templates/arena/stackhost-3s-registry-fix

- Time: 2026-09-17T13:04:26+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/00a65e3d173ea88e4d4783be3c310bd35315b0fa
- Parents: `d131c58 674a78b`
- Intent / implemented scope: Merge pull request #5 from Azadar-Templates/arena/stackhost-3s-registry-fix

Recorded commit notes (historical claims):

> fix(stackhost): make agent registry sync non-blocking so 3s probe passes (aa9e3b)

Verification paths changed: none in this commit.

- CI [35224822130](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35224822130): docker-publish — **success**, 2026-09-17T13:04:29Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
(merge/topology-only; inspect parents with git show -m)
```

### `996bed8` — fix(stackhost): use direct Node start (StackHost disallows sh)

- Time: 2026-09-17T13:08:56+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/996bed8f2d5e3dd707016a4cb851a2d0b75de2d4
- Parents: `353e865`
- Intent / implemented scope: fix(stackhost): use direct Node start (StackHost disallows sh)

Recorded commit notes (historical claims):

> StackHost now explicitly reports: Disallowed start command: sh in stackhost.yaml.
> Change commands.start from 'sh scripts/entrypoint.sh' to 'node scripts/start-prod.mjs'
> which is the allowed direct command.
>
> Keep all existing startup functionality intact:
> - migrations, SESSION_SECRET handling, build preflight, PORT handling, registry
>   background sync already in start-prod.mjs — unchanged
> - backup scheduling previously lived in entrypoint.sh shell loop; now moved to
>   Node in start-prod.mjs (scheduleBackup(), 01:17 UTC, unref'd timer,
>   DISABLE_BACKUP_CRON/BACKUP_KEEP, verified via spawnSync). Docker/Modal still
>   use scripts/entrypoint.sh which now simply execs the Node wrapper, so they
>   also get backups via the Node path without duplication.
> - Docker/Modal compatibility preserved: Dockerfile CMD remains ["sh", "scripts/entrypoint.sh"]
>
> Update regression tests to reject disallowed sh and require direct Node:
> - stackhost.yaml must be 'node scripts/start-prod.mjs', must not contain
>   'sh' or entrypoint.sh in start
> - backup scheduler must live in start-prod.mjs (scheduleBackup, DISABLE_BACKUP_CRON, timer.unref)
> - entrypoint must delegate to start-prod.mjs and not duplicate backup
>
> Verified: npx tsx --test src/app/stackhost-deploy.test.ts 13/13, prod-roles 6/6, npm run build
>

Verification paths changed: `src/app/stackhost-deploy.test.ts`

- CI [35225279787](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35225279787): docker-publish — **success**, 2026-09-17T13:09:00Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	scripts/entrypoint.sh
M	scripts/start-prod.mjs
M	src/app/stackhost-deploy.test.ts
M	stackhost.yaml
```

### `d4db5b8` — Merge pull request #6 from Azadar-Templates/arena/stackhost-sh-disallow-fix

- Time: 2026-09-17T13:11:40+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/d4db5b8feffc5f8bf4d3bd2fab2d4ec104bf977f
- Parents: `00a65e3 996bed8`
- Intent / implemented scope: Merge pull request #6 from Azadar-Templates/arena/stackhost-sh-disallow-fix

Recorded commit notes (historical claims):

> fix(stackhost): use direct Node start (StackHost disallows sh)

Verification paths changed: none in this commit.

- CI [35225552181](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35225552181): docker-publish — **success**, 2026-09-17T13:11:43Z.
- CI [35229446875](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35229446875): keep-alive — **success**, 2026-09-17T13:48:39Z.
- CI [35254691842](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35254691842): keep-alive — **success**, 2026-09-17T17:45:44Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
(merge/topology-only; inspect parents with git show -m)
```

### `f1ac9e3` — fix(stackhost): use plain npm ci and disable strict engines for free-tier install

- Time: 2026-09-17T17:47:47+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/f1ac9e3c2362347fb2fbaaa72eda7d1bc8e0c03c
- Parents: `d4db5b8`
- Intent / implemented scope: fix(stackhost): use plain npm ci and disable strict engines for free-tier install

Recorded commit notes (historical claims):

> StackHost 'FAILED TO INSTALL DEPENDENCIES' was at 'npm ci --include=dev'
> on the 512MB free tier. Local reproduction with Node 22.22.3 / npm 10.9.8
> succeeds, so the failure is platform-specific (mirror lag for
> next 16.3.4/react 19.2.8, ENOSPC for 551MB node_modules, or
> EBADENGINE for jsdom 30.0.1 requiring ^22.22.2 on older node:22).
>
> Minimal fix per investigation:
> - stackhost.yaml: 'npm ci --include=dev' -> 'npm ci' (Dockerfile-faithful,
>   no --include flag to avoid platform flag parsing / strict peer issues)
> - .npmrc: engine-strict=false, fund=false, audit=false (tolerate engine
>   mismatch and reduce memory/audit overhead for 512MB)
> - test: update contract to expect 'npm ci'.
>

Verification paths changed: `src/app/stackhost-deploy.test.ts`

- CI [35254923799](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35254923799): docker-publish — **success**, 2026-09-17T17:48:03Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.npmrc
M	src/app/stackhost-deploy.test.ts
M	stackhost.yaml
```

### `a924e4a` — Merge pull request #7 from Azadar-Templates/arena/01a0af54-akbaral

- Time: 2026-09-17T18:00:38+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/a924e4a98cf16af439149bf0e29ca15fb6298fda
- Parents: `d4db5b8 f1ac9e3`
- Intent / implemented scope: Merge pull request #7 from Azadar-Templates/arena/01a0af54-akbaral

Recorded commit notes (historical claims):

> fix(stackhost): use plain npm ci and disable strict engines for free-tier install

Verification paths changed: none in this commit.

- CI [35256196646](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35256196646): docker-publish — **success**, 2026-09-17T18:00:42Z.
- CI [35271700487](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35271700487): keep-alive — **success**, 2026-09-17T20:35:13Z.
- CI [35285114547](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35285114547): keep-alive — **success**, 2026-09-17T23:04:21Z.
- CI [35294633274](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35294633274): keep-alive — **success**, 2026-09-18T01:16:12Z.
- CI [35313340165](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35313340165): keep-alive — **success**, 2026-09-18T06:04:28Z.
- CI [35338265809](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35338265809): keep-alive — **success**, 2026-09-18T11:09:57Z.
- CI [35359641613](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35359641613): keep-alive — **success**, 2026-09-18T14:59:27Z.
- CI [35379353663](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35379353663): keep-alive — **success**, 2026-09-18T18:17:52Z.
- CI [35394629860](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35394629860): keep-alive — **success**, 2026-09-18T21:01:55Z.
- CI [35405058387](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35405058387): keep-alive — **success**, 2026-09-18T23:16:38Z.
- CI [35412233700](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35412233700): keep-alive — **success**, 2026-09-19T01:18:14Z.
- CI [35425587655](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35425587655): keep-alive — **success**, 2026-09-19T06:03:39Z.
- CI [35438663762](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35438663762): keep-alive — **success**, 2026-09-19T10:54:28Z.
- CI [35447924080](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35447924080): keep-alive — **success**, 2026-09-19T14:10:27Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
(merge/topology-only; inspect parents with git show -m)
```

### `1f710c8` — fix(stackhost): use Webpack build to fit free-tier memory ceiling

- Time: 2026-09-17T20:59:03+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/1f710c881bba6ca47f0f239b74a4da878248a1db
- Parents: `a924e4a`
- Intent / implemented scope: fix(stackhost): use Webpack build to fit free-tier memory ceiling

Recorded commit notes (historical claims):

> The production build on stackhost.yaml still invoked 'npm run build',
> which runs Next.js 16 with the default Turbopack bundler. On a clean
> install against package-lock.json, that path peaked at ~1.27 GB RSS
> during the build step (measured 2026-09-17, on this lockfile) — over
> the StackHost free-tier's apparent memory ceiling, surfacing as a
> silent install/build failure with no application logs.
>
> Switching to 'npx next build --webpack' drops the same-path RSS peak
> to ~0.5 GB (41% reduction), at the cost of ~10 s wall time, and the
> produced .next/ + dist/ artifacts are byte-equivalent for runtime
> purposes: scripts/start-prod.mjs preflight accepts the resulting tree
> and node scripts/start-prod.mjs --print-ports returns the expected
> JSON.
>
> The build list is split into three YAML items (npm ci, tsc,
> next build --webpack) because StackHost rejects the single-string
> 'npm ci --include=dev && npm run build' form as a schema error, and
> 'npm run build' used to chain tsc into the same step; splitting
> makes the stages explicit and visible.
>
> Behavior change scope is intentionally limited:
> - .npmrc, scripts/start-prod.mjs, package.json, next.config.mjs,
>   and all other tests are untouched.
> - src/app/stackhost-deploy.test.ts is updated because it asserted
>   the literal 'npm run build' string in stackhost.yaml; that
>   assertion is updated to require 'npx next build --webpack' and to
>   reject a future regression to 'npm run build'.
> - 'npm run build' in package.json still uses Turbopack — local
>   development and CI on hosts with abundant memory are unaffected.
>
> Verification:
> - stackhost-deploy.test.ts: 13/13 pass.
> - Full suite (npm test, 74 test files): all pass, 0 failures.
> - End-to-end build (npm ci + tsc + npx next build --webpack) on
>   a clean clone: peak RSS 749 MB, both required artifacts present,
>   start-prod.mjs preflight PASS.
>

Verification paths changed: `src/app/stackhost-deploy.test.ts`

- CI [35274045370](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35274045370): docker-publish — **success**, 2026-09-17T20:59:08Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	src/app/stackhost-deploy.test.ts
M	stackhost.yaml
```

### `30d0374` — diag(stackhost): add install diagnostic workflow (research artifact)

- Time: 2026-09-17T21:34:02+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/30d0374e593f65d08cd992aa7c03d5e1174502d7
- Parents: `1f710c8`
- Intent / implemented scope: diag(stackhost): add install diagnostic workflow (research artifact)

Recorded commit notes (historical claims):

> Read-only diagnosis workflow for the StackHost free-tier install failure
> on PR #8. Captures node/npm versions, cgroup memory.max, package-lock
> shape, exact 'npm ci' stdout+stderr, and (on success) the full build chain.
> Does not modify any tracked code. Deletable after the investigation.
>

Verification paths changed: `.github/workflows/stackhost-install-diag.yml`

- CI [35277404465](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35277404465): docker-publish — **success**, 2026-09-17T21:34:08Z.
- CI [35277403482](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35277403482): .github/workflows/stackhost-install-diag.yml — **failure**, 2026-09-17T21:34:08Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.github/workflows/stackhost-install-diag.yml
```

### `f30c6dc` — diag(stackhost): fix YAML quoting in step names (prevents dispatch failure)

- Time: 2026-09-17T21:35:16+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/f30c6dc6edfa0a595acc61b472de633cfeead768
- Parents: `30d0374`
- Intent / implemented scope: diag(stackhost): fix YAML quoting in step names (prevents dispatch failure)

Recorded commit notes (historical claims):

> Earlier push triggered a GitHub Actions run that completed with
> 'failure' status and zero jobs — that pattern means the workflow
> file failed YAML parsing on GitHub's side. The cause was unquoted
> step names containing colons (e.g. 'npm ci succeeded:'), which YAML
> interprets as the start of a mapping inside a plain scalar. All
> such step names are now quoted; pyyaml round-trips the file
> cleanly.
>

Verification paths changed: `.github/workflows/stackhost-install-diag.yml`

- CI [35277518203](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35277518203): stackhost-install-diag — **success**, 2026-09-17T21:35:20Z.
- CI [35277518189](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35277518189): docker-publish — **success**, 2026-09-17T21:35:20Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/stackhost-install-diag.yml
```

### `63daf86` — diag(stackhost): also publish key measurements as ::notice annotations

- Time: 2026-09-17T21:40:29+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/63daf86f81b9babe5d4ffa73b1f98ee37d17b950
- Parents: `f30c6dc`
- Intent / implemented scope: diag(stackhost): also publish key measurements as ::notice annotations

Recorded commit notes (historical claims):

> The earlier run's raw logs and artifacts live on Azure Blob storage
> (productionresultssa17.blob.core.windows.net) which is unreachable from
> the Arena sandbox. To still get the diagnostic data out, this added
> step re-runs npm ci + tsc + next --webpack and emits each measurement
> as a '::notice title=diag.*::' line — those flow back via api.github.com
> checks API, which the sandbox can reach.
>

Verification paths changed: `.github/workflows/stackhost-install-diag.yml`

- CI [35277989503](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35277989503): docker-publish — **success**, 2026-09-17T21:40:32Z.
- CI [35277989502](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35277989502): stackhost-install-diag — **success**, 2026-09-17T21:40:32Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/stackhost-install-diag.yml
```

### `ffd3084` — diag(stackhost): also probe npm ci under a 512MB virtual-address cap

- Time: 2026-09-17T21:43:16+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/ffd30842cb1cccf16dc599fd53fc7c5f9134757b
- Parents: `63daf86`
- Intent / implemented scope: diag(stackhost): also probe npm ci under a 512MB virtual-address cap

Recorded commit notes (historical claims):

> Uses prlimit --as=536870592 (Python parent with shell-out to npm ci)
> to simulate the smallest plausible StackHost free-tier ceiling. RLIMIT_AS
> is the only RLIMIT the kernel enforces against mmap, and npm + Node both
> mmap heavily. Annotations published via the checks API regardless of
> outcome so the result is readable from the Arena sandbox.
>

Verification paths changed: `.github/workflows/stackhost-install-diag.yml`

- CI [35278237559](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35278237559): docker-publish — **success**, 2026-09-17T21:43:19Z.
- CI [35278237554](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35278237554): stackhost-install-diag — **success**, 2026-09-17T21:43:19Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/stackhost-install-diag.yml
```

### `319ab28` — diag(stackhost): probe bare Node process startup at 512MB / 700MB virtual cap

- Time: 2026-09-17T21:45:16+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/319ab28b2961d9ff65df6057627edf5a600f86f1
- Parents: `ffd3084`
- Intent / implemented scope: diag(stackhost): probe bare Node process startup at 512MB / 700MB virtual cap

Recorded commit notes (historical claims):

> If Node itself can't start under the StackHost free-tier virtual cap,
> no npm/tweaks can fix the install. This step publishes the empirical
> floor.
>

Verification paths changed: `.github/workflows/stackhost-install-diag.yml`

- CI [35278416453](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35278416453): stackhost-install-diag — **success**, 2026-09-17T21:45:19Z.
- CI [35278416444](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35278416444): docker-publish — **success**, 2026-09-17T21:45:19Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/stackhost-install-diag.yml
```

## Day 12 — 2026-09-18

### `62bc032` — ci(temp): one-shot live Gemini verification workflow (self-deletes after evidence run)

- Time: 2026-09-18T23:05:07+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/62bc03289ddb5b3e07dd623da7a62ab794f0007a
- Parents: `1f710c8`
- Intent / implemented scope: ci(temp): one-shot live Gemini verification workflow (self-deletes after evidence run)

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/gemini-live-verify.yml`

- CI [35404278714](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35404278714): docker-publish — **success**, 2026-09-18T23:05:10Z.
- CI [35404278875](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35404278875): gemini-live-verify (TEMPORARY - delete after use) — **success**, 2026-09-18T23:05:11Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.github/workflows/gemini-live-verify.yml
```

### `da7bb58` — ci(temp): fix ev4 evidence query to target the test user's credit account

- Time: 2026-09-18T23:07:48+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/da7bb5877b9b4d8fd682fe26502d6e25f6940028
- Parents: `62bc032`
- Intent / implemented scope: ci(temp): fix ev4 evidence query to target the test user's credit account

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/gemini-live-verify.yml`

- CI [35404459598](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35404459598): docker-publish — **success**, 2026-09-18T23:07:51Z.
- CI [35404459578](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35404459578): gemini-live-verify (TEMPORARY - delete after use) — **success**, 2026-09-18T23:07:51Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/gemini-live-verify.yml
```

### `dbd712e` — ci(temp): remove gemini-live-verify after successful evidence run (runs 35404278875, 35404459578)

- Time: 2026-09-18T23:09:27+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/dbd712eaa933b84a7c388e500394b62fb6c06ad4
- Parents: `da7bb58`
- Intent / implemented scope: ci(temp): remove gemini-live-verify after successful evidence run (runs 35404278875, 35404459578)

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/gemini-live-verify.yml`

- CI [35404567577](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35404567577): docker-publish — **success**, 2026-09-18T23:09:30Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
D	.github/workflows/gemini-live-verify.yml
```

## Day 13 — 2026-09-19

### `505026b` — fix(stackhost): build steps that fit the 512 MB free plan (measured)

- Time: 2026-09-19T02:13:30+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/505026b195e2243df6fc3fa0a682e9f32a153bfe
- Parents: `a924e4a`
- Intent / implemented scope: fix(stackhost): build steps that fit the 512 MB free plan (measured)

Recorded commit notes (historical claims):

> StackHost's free container kept failing at its install step. Measured peaks of
> the whole process tree on this tree (2026-09-19, clean checkout):
>
>   untuned                                        tuned (this commit)
>   npm ci, warm ~/.npm cache   ~719-743 MB        npm cache clean --force   ~81 MB
>   npm ci, empty cache         ~313-344 MB        npm ci                    ~318 MB
>   npx tsc -p tsconfig.backend ~475-514 MB        .bin/tsc (heap 384)       ~381 MB
>   npx next build --webpack    ~668 MB            .bin/next build (heap 320,
>   next build (Turbopack)     ~1284 MB              AKBARAL_LOW_MEMORY_BUILD) ~466 MB
>   running stack (API+Next)    ~336 MB            running stack             ~327 MB
>
> Every untuned build phase overshoots 512 MB on its own; every tuned phase
> fits, and the runtime was always inside the budget. Changes:
>
> - stackhost.yaml: five explicit build steps (no `&&`, as the schema requires)
>   calling ./node_modules/.bin/<tool> directly (no npx wrapper, ~80 MB each),
>   heap-capped, with `npm cache clean --force` first — npm's install peak
>   depends on its package cache (313-344 MB cold vs 719-743 MB warm, both
>   reproduced; --prefer-online does not avoid the warm path), so clearing it
>   is what makes the step deterministic.
> - next.config.mjs: AKBARAL_LOW_MEMORY_BUILD=1 skips only Next's in-build type
>   check (that phase alone peaked at ~475 MB). `npm run typecheck`, the test
>   suite and the docker-publish image build still enforce every type.
> - scripts/copy-backend-runtime-assets.mjs (new): tsc does not emit .mjs, but
>   src/db/pg-worker.mjs is spawned by path from __dirname at runtime. The copy
>   was an inline `node -e` in package.json's build script; both build paths
>   (package.json, stackhost.yaml) now call the same script so they cannot drift.
> - src/app/stackhost-deploy.test.ts: locks the measured recipe (direct
>   binaries, heap caps, low-memory flag, cache-clear-before-install, shared
>   copy script) and proves the copy script works on a throwaway fixture.
>
> Verified: exact recipe from a clean tree -> npm ci 318 MB, tsc 381 MB,
> copy ok, next build 466 MB, then scripts/start-prod.mjs boots in 13 s and
> serves / /pricing /signin /workspace 200, /api/health ok, steady 327 MB,
> clean SIGTERM. Full suite: 721/721 in 74 files.
>
> Note: this supersedes PR #8's build-step change (same intent, measured) and
> also fixes what #8 missed (the missing dist/src/db/*.mjs copy).
>

Verification paths changed: `src/app/stackhost-deploy.test.ts`

- CI [35415026646](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35415026646): docker-publish — **success**, 2026-09-19T02:13:35Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	next.config.mjs
M	package.json
A	scripts/copy-backend-runtime-assets.mjs
M	src/app/stackhost-deploy.test.ts
M	stackhost.yaml
```

### `261807c` — feat(workforce): real 4,000+ agent earning workforce (multi-category, wallets, delegation, comms, risk protection)

- Time: 2026-09-19T02:50:43+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/261807cd932af3c735006bbc43eaad6bb05756c1
- Parents: `505026b`
- Intent / implemented scope: feat(workforce): real 4,000+ agent earning workforce (multi-category, wallets, delegation, comms, risk protection)

Recorded commit notes (historical claims):

> - 21 legitimate earning categories mapped to registry domains + mission activities
> - Per-agent wallet/ledger derived from real ledger (earnings/expenses/API costs/reinvestment/balance/transfers/history)
> - Workforce execution pipeline: multi-tool work, verification, delivery records, failure recovery
> - Source health auto-blocking + workflow failure tracking (risk/earnings protection)
> - Approval-gated customer comms (consent mandatory, bulk refused, masked PII, real SMTP/Twilio sends)
> - Sub-agent delegation via Factory with no permission escalation, budgets, audit, parent linkage
> - Honest integration matrix (14 providers) + owner readiness report
> - Owner-only /api/workforce routes (27) + durable scheduler tick
> - 15 new tests, full suite green, typecheck clean, secret scan clean
>

Verification paths changed: `src/workforce/workforce.test.ts`

- CI [35416857952](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35416857952): docker-publish — **success**, 2026-09-19T02:50:46Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations/0018_workforce.sql
M	src/app.ts
A	src/routes/workforce.ts
A	src/workforce/categories.ts
A	src/workforce/comms.ts
A	src/workforce/delegation.ts
A	src/workforce/email.ts
A	src/workforce/execution.ts
A	src/workforce/integrations.ts
A	src/workforce/report.ts
A	src/workforce/repositories.ts
A	src/workforce/scheduler.ts
A	src/workforce/wallets.ts
A	src/workforce/workforce.test.ts
```

### `5fb575b` — verify(workforce): temporary live Google execution check (one agent, runner-only)

- Time: 2026-09-19T03:01:40+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/5fb575bd6d9d448370968d06caa8f75923b8fe54
- Parents: `261807c`
- Intent / implemented scope: verify(workforce): temporary live Google execution check (one agent, runner-only)

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/workforce-live-verify.yml`, `scripts/verify-workforce-live-exec.ts`

- CI [35417373405](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35417373405): workforce-live-verify — **success**, 2026-09-19T03:01:43Z.
- CI [35417373324](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35417373324): docker-publish — **success**, 2026-09-19T03:01:43Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	.github/workflows/workforce-live-verify.yml
A	scripts/verify-workforce-live-exec.ts
```

### `4d55f2d` — verify(workforce): split live evidence annotations across steps (10/step cap)

- Time: 2026-09-19T03:14:46+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/4d55f2d39658e7c204f75ce56e89e4b0d72be145
- Parents: `5fb575b`
- Intent / implemented scope: verify(workforce): split live evidence annotations across steps (10/step cap)

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/workforce-live-verify.yml`

- CI [35418000861](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35418000861): docker-publish — **success**, 2026-09-19T03:14:49Z.
- CI [35418000851](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35418000851): workforce-live-verify — **success**, 2026-09-19T03:14:49Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
M	.github/workflows/workforce-live-verify.yml
```

### `1ceb996` — verify(workforce): remove temporary live-verify workflow after evidence collected

- Time: 2026-09-19T03:17:58+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/1ceb996ab2b269e0a08a0a2dcf7da43fd29ae00c
- Parents: `4d55f2d`
- Intent / implemented scope: verify(workforce): remove temporary live-verify workflow after evidence collected

Recorded commit notes (historical claims):


Verification paths changed: `.github/workflows/workforce-live-verify.yml`

- CI [35418150832](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35418150832): docker-publish — **success**, 2026-09-19T03:18:01Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
D	.github/workflows/workforce-live-verify.yml
```

### `c576bc4` — fix(workforce): resolve D4/D5/D9/D10/D11 blockers + governed image path

- Time: 2026-09-19T04:08:13+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/c576bc42182d965c989780161dfb67734725397d
- Parents: `1ceb996`
- Intent / implemented scope: fix(workforce): resolve D4/D5/D9/D10/D11 blockers + governed image path

Recorded commit notes (historical claims):

> D4: discovery allow-list synced to legacy-13 + all 21 workforce categories
> (union resolver + sanitizer; no-config default unchanged).
> D5: workforce tools run as workforce:service identity with explicit
> per-item owner staging for knowledge/files (revocable, nothing copied).
> D10: router attaches real usage/cost to results; both execution ledgers
> now post actual model cost (zero-cost posts nothing).
> D11: centralized deduplicated owner alerts for the 5 wired silent-stop
> conditions; best-effort email, honestly recorded, never throws.
> D9: delegation cap 50 -> 5000 (default rows only, owner-tuned untouched);
> API ceiling 500 -> 10,000; all money gates unchanged.
> Images: free brief filing + per-item approve + fulfill; image_render stays
> out of the autonomous tool set; no approval = no spend.
> Autonomy stays OFF; no revenue fabricated; no gates weakened.
> Tests: 6 new suites (35 tests), full suite green, tsc + scan:secrets PASS.
>

Verification paths changed: `src/economy/delegation-scale.test.ts`, `src/economy/discovery.test.ts`, `src/workforce/alerts.test.ts`, `src/workforce/execution-cost.test.ts`, `src/workforce/images.test.ts`, `src/workforce/staging.test.ts`

- CI [35420476491](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35420476491): docker-publish — **success**, 2026-09-19T04:08:17Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations/0019_production_blockers.sql
M	src/db/economy-repositories.ts
A	src/economy/delegation-scale.test.ts
A	src/economy/discovery.test.ts
M	src/economy/operations.ts
M	src/economy/policy.ts
M	src/economy/treasury.ts
M	src/models/client.ts
M	src/models/router.ts
M	src/routes/economy.ts
M	src/routes/workforce.ts
M	src/tools/registry.ts
A	src/workforce/alerts.test.ts
A	src/workforce/alerts.ts
A	src/workforce/execution-cost.test.ts
M	src/workforce/execution.ts
A	src/workforce/identity.ts
A	src/workforce/images.test.ts
A	src/workforce/images.ts
M	src/workforce/repositories.ts
M	src/workforce/scheduler.ts
A	src/workforce/staging.test.ts
A	src/workforce/staging.ts
```

### `7c8064e` — feat(workforce): full earning workforce — platform catalog, delivery payments, reinvestment, reassignment

- Time: 2026-09-19T12:01:01+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/7c8064eb5e2cbabcfa66adf5e209b1f6fe608ae2
- Parents: `c576bc4`
- Intent / implemented scope: feat(workforce): full earning workforce — platform catalog, delivery payments, reinvestment, reassignment

Recorded commit notes (historical claims):

> - 0020: economy_platforms + assignments + delivery_payments + reinvestments
> - Seed: 153-row evidence inventory in-repo; rejected rows never imported
> - platforms.ts: seed/match/assign + catalog-driven opportunity discovery
> - treasury: recordDeliveryPayment (verified delivery + evidence, once only),
>   propose/decideReinvestment (realized-surplus funded, owner-approved)
> - operations: reassignExecution (authorized-only, eligibility-checked handoff)
> - scheduler: platform sweep wired into workforceDiscovery (verified first)
> - earning.test.ts: 12/12 (catalog, payments, reinvest, reassign)
>

Verification paths changed: `src/workforce/earning.test.ts`

- CI [35441671690](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35441671690): docker-publish — **success**, 2026-09-19T12:01:04Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations/0020_workforce_earning.sql
A	db/seeds/earning-platforms.json
M	src/economy/operations.ts
M	src/economy/treasury.ts
A	src/workforce/earning.test.ts
A	src/workforce/platforms.ts
M	src/workforce/scheduler.ts
```

### `2df8617` — 1:1 primaries: exclusive assignments + dispatch binding + 194-row catalog

- Time: 2026-09-19T12:44:30+00:00
- Commit: https://github.com/Azadar-Templates/AKBARAL-/commit/2df861730f686ccfad6327525e90ef5ec8ca1b24
- Parents: `7c8064e`
- Intent / implemented scope: 1:1 primaries: exclusive assignments + dispatch binding + 194-row catalog

Recorded commit notes (historical claims):

> - 0021: economy_opportunity_assignments with UNIQUE(agent_slug),
>   UNIQUE(platform_key), UNIQUE(dedicated_account_property_id);
>   opportunities.platform_key stamps origin on discovery
> - platforms.ts: assign/release/bind/status + earningWorkflowFor +
>   deterministic idempotent autoAssignPrimaries (verified-first)
> - scheduler + economy operations route platform work to the primary
> - primary.test.ts: 9 tests (code + raw-SQL UNIQUE proofs, routing,
>   lifecycle, auto-match 1:1 counts); earning.test.ts counts dynamic
> - catalog 153 -> 194 rows (PartnerStack chunks 3-4: 40 candidates,
>   HiBob rejected; 3 rows skipped, reported, never seeded)
> - earning 12/12, primary 9/9, full suite 83 files green, typecheck
>   clean, secrets scan PASS
>

Verification paths changed: `src/workforce/earning.test.ts`, `src/workforce/primary.test.ts`

- CI [35443728314](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35443728314): docker-publish — **success**, 2026-09-19T12:44:33Z.
- Current production result: not established by this commit; see current source of truth.

Changed paths (A/M/D status; migrations included):

```text
A	db/migrations/0021_primary_assignments.sql
M	db/seeds/earning-platforms.json
M	src/db/economy-repositories.ts
M	src/economy/operations.ts
M	src/workforce/earning.test.ts
M	src/workforce/platforms.ts
A	src/workforce/primary.test.ts
M	src/workforce/scheduler.ts
```

## GitHub Actions coverage snapshot

153 retained runs returned (paginated), 2026-09-11T13:49:08Z through 2026-09-19T14:10:27Z. Job/step metadata recovered for all 153 runs (137 non-keep-alive plus 16 keep-alive). Selected production/Gemini/workforce annotations recovered; full workforce log download failed with EOF at the Actions log host.

| Workflow | Conclusion | Runs |
|---|---|---:|
| .github/workflows/stackhost-install-diag.yml | failure | 1 |
| docker-publish | failure | 20 |
| docker-publish | success | 93 |
| gemini-live-verify (TEMPORARY - delete after use) | success | 2 |
| keep-alive | success | 16 |
| production-verify | failure | 8 |
| production-verify | success | 7 |
| stackhost-install-diag | success | 4 |
| workforce-live-verify | success | 2 |

## Failure evidence retained in GitHub job metadata

These are workflow failures, not automatically application failures. The named step is the available failing step; full logs were not assumed accessible. Repaired successors are listed in the chronological ledger.

| Run | Workflow | Failed job / step |
|---|---|---|
| [34606492670](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34606492670) | docker-publish | build-and-push: Build and push |
| [34644321859](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34644321859) | docker-publish | build-and-push: Verify published image (commit stamp + compiled PostgreSQL fix) |
| [34644373269](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34644373269) | docker-publish | build-and-push: Verify published image (commit stamp + compiled PostgreSQL fix) |
| [34718914664](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34718914664) | docker-publish | build-and-push: Build and push |
| [34757373550](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34757373550) | production-verify | verify: Run the REAL production E2E (MASTER flow via Gemini) |
| [34757500255](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34757500255) | production-verify | verify: Run the REAL production E2E (MASTER flow via Gemini) |
| [34757672670](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34757672670) | production-verify | verify: Run the REAL production E2E (MASTER flow via Gemini) |
| [34763285436](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34763285436) | production-verify | verify: Run the REAL production E2E (MASTER flow via Gemini) |
| [34771501473](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34771501473) | production-verify | verify: Run the REAL production E2E (MASTER flow via Gemini) |
| [34785257325](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34785257325) | production-verify | verify: Run the REAL production E2E (MASTER flow via Gemini) |
| [34873932450](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34873932450) | docker-publish | build-and-push: Build and push |
| [34929258991](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34929258991) | docker-publish | build-and-push: Build and push |
| [34965111096](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34965111096) | docker-publish | build-and-push: Build and push |
| [34966080700](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34966080700) | docker-publish | build-and-push: Build and push |
| [34978091793](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34978091793) | docker-publish | build-and-push: Build and push |
| [34983863518](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34983863518) | docker-publish | build-and-push: Build and push |
| [34987749205](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34987749205) | docker-publish | build-and-push: Build and push |
| [34991174372](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34991174372) | docker-publish | build-and-push: Build and push |
| [34993882915](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/34993882915) | docker-publish | build-and-push: Build and push |
| [35006953888](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35006953888) | docker-publish | build-and-push: Build and push |
| [35012005716](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35012005716) | docker-publish | build-and-push: Build and push |
| [35016149372](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35016149372) | docker-publish | build-and-push: Build and push |
| [35025657878](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35025657878) | docker-publish | build-and-push: Build and push |
| [35029017800](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35029017800) | docker-publish | build-and-push: Build and push |
| [35092813991](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35092813991) | docker-publish | build-and-push: Build and push |
| [35093014158](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35093014158) | docker-publish | build-and-push: Build and push |
| [35134455249](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35134455249) | production-verify | image-e2e: Verify the deployed product inside the container |
| [35134959647](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35134959647) | production-verify | image-e2e: Run the real journeys against the running container |
| [35277403482](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35277403482) | .github/workflows/stackhost-install-diag.yml | No executable job returned (workflow/configuration failure possible; not inferred). |

## Additional advertised PR history

`refs/pull/8/merge` was fetched separately without changing the working branch. It is GitHub's synthetic merge `d0b18562d991efbf80b4db24e7641acc1a38f6f5` (2026-09-18 23:09:30 UTC), parents `a924e4a` and `dbd712e`; its tree is identical to the PR head `dbd712e`. It adds no implementation beyond the recorded sibling branch. Thus the recovery covers 197 branch-reachable commits **plus this one synthetic PR merge**. Other advertised PR heads were already present on fetched branches.

PR #3 mentions an earlier requested SHA `ecca9bec1eb5e0f012a2413b608deb8064a74fba`. A fresh GitHub commit lookup returned HTTP 422 “No commit found for SHA”; it is not in the recovered branch graph. Its contents remain genuinely unrecoverable from the available sources; the PR records `a860be7` as the implemented replacement, not proof the missing SHA was identical.

Latest keep-alive run [35447924080](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35447924080) is green **with both production ping steps skipped** and the “Not configured yet” step executed. It supplies no production-health proof.
