# AKBARAL! + ZA141251SA Professional Rebuild Implementation Plan

**Date:** 2026-10-03  
**Branch:** `arena/01a0ff96-akbaral`  
**Baseline commit:** `d90c315aeb869e4a2a57e9fc4a0fea8adbb93824`  
**Public product:** **AKBARAL!**  
**Tagline:** **One Intelligence. Every Solution.**  
**Private mission:** **ZA141251SA** — never exposed in public/customer UI, authentication, billing, or customer money.

This is a forward implementation plan from the current repository. It does not treat missing UI commits as recoverable history and does not restart working platform systems.

---

## Status legend

- **VERIFIED** — evidenced in the current checkout and, where stated, production.
- **CODE COMPLETE** — implemented and covered by current tests.
- **TEST COMPLETE** — required automated checks pass.
- **PUBLISHED** — commit/image exists in the designated remote registry.
- **DEPLOYED** — the intended artifact is running in the target environment.
- **LIVE VERIFIED** — exercised against the running target with real dependencies.
- **BLOCKED** — cannot advance without a named dependency.
- **OWNER ACTION REQUIRED** — identity, KYC, secret, account, policy, approval, or spending decision only the owner may perform.
- **EXTERNAL APPROVAL REQUIRED** — platform/provider review or authorization is required.

These states must never be collapsed. In particular, registered agents are not automatically work-ready or earning.

---

# Phase 1 — Foundation Verification

## Phase status: COMPLETE for architecture discovery

### 1.1 Current top-level structure

| Path | Current purpose | Decision |
|---|---|---|
| `.github/workflows/` | Verification, image publishing, production checks, keep-alive, bounty sandbox and bounded mission worker workflows | Retain and harden; do not replace wholesale |
| `src/app/` | Next.js App Router pages, layouts, route handlers and React components | Primary web UI rebuild location |
| `src/app/_components/` | Shared React UI components | Expand into the canonical web component library |
| `src/routes/` | Express REST API routers | Retain API contracts; add only versioned/validated gaps |
| `src/orchestrator/` | Goal analysis, planner, MASTER flow, execution, queue, verification, recovery and factory | Retain and production-verify |
| `src/agents/` | 4,001-agent catalog, registry and search/research adapters | Retain |
| `src/models/` | Model catalog, providers, routing, retry/fallback and OmniRoute integration | Retain and live-verify |
| `src/tools/` | Tool registry and concrete tool handlers | Retain; extend only with real handlers |
| `src/auth/` | Public AKBARAL! authentication, OAuth and fixed-owner bootstrap | Retain |
| `src/billing/` | Plans, credits, Stripe/Razorpay checkout, webhooks and invoices | Retain; finish provider activation and Razorpay client gap |
| `src/realtime/` | WebSocket/SSE execution logs | Retain |
| `src/workforce/` | Public-platform private workforce controls, assignments, wallets and execution | Retain but keep distinct from ZA141251SA private runtime |
| `src/economy/` | Owner-controlled platform economy and treasury reporting | Retain; enforce mission-money separation |
| `src/mission/` | Private ZA141251SA database, auth, policy, treasury, earning, connectors, settlement and safety | Retain as private service boundary |
| `src/mission/earning/` | Opportunity discovery, connectors, allocator, scheduler, provider readiness and bounty pipeline | Retain and activate only after runtime evidence |
| `src/push/` | Expo push registration/delivery and automation notifications | Retain |
| `src/security/` | Password, webhook, attack-surface and isolation controls | Retain |
| `src/db/` | Portable SQLite/PostgreSQL driver, repositories and migrations | Retain; production target should be PostgreSQL for shared workers |
| `db/migrations/` | Main AKBARAL! SQLite schema, 22 migrations | Existing supported path |
| `db/migrations-pg/` | Main AKBARAL! PostgreSQL schema, 22 migrations | Preferred production/shared path |
| `db/migrations-mission/` | Separate ZA141251SA schema, 41 migrations | Private mission only |
| `db/seeds/` | Registry/platform seed data | Retain with provenance checks |
| `mobile/` | Expo React Native application | Existing native app; do not recreate |
| `mission-dashboard/` | Private mission static dashboard assets | Migrate deliberately into the private mission UI, never public Next routes |
| `public/` | Legacy SPA controller/styles and cinematic hero media | Reuse media/behavior selectively; phase out as the primary component architecture |
| `design-system/` | Cross-platform design tokens and generated consumers | Make canonical for web/mobile/private dashboard |
| `scripts/` | Startup, migrations, verification, mission workers and smoke probes | Retain; remove duplicate/obsolete scripts only after replacement evidence |
| `deploy/`, `Dockerfile`, `docker-compose.production.yml`, `stackhost.yaml` | Deployment targets and container contracts | Retain; Railway remains current production target |
| `sandbox/` | Bounty execution isolation image/source | Retain immutable-digest execution boundary |
| `docs/`, `artifacts/` | Documentation, historical audits and implementation evidence | Keep history, add dated source-of-truth documents |

### 1.2 Verified technology stack

#### Web frontend — VERIFIED

- Next.js **16.3.4**, App Router
- React **19.2.8**
- TypeScript
- Framer Motion installed
- Current UI is mixed:
  - server-rendered Next/React pages in `src/app/`;
  - large legacy controller/styles in `public/app.js` and `public/styles.css`.

**Rebuild decision:** converge new UI into typed React components under `src/app/` and `src/app/_components/`. Keep legacy assets only behind compatibility boundaries until route parity is proven.

#### Backend — VERIFIED

- Node.js 22
- Express **4.21.2**
- REST API under `/api/*`
- WebSocket and SSE real-time execution streams
- Durable execution queue and schedulers
- Next.js rewrites `/api`, `/uploads`, and `/ws` to the Express service.

#### Database — VERIFIED architecture; production engine requires explicit evidence

- Portable database layer supporting both:
  - SQLite (`node:sqlite`);
  - PostgreSQL (`pg` through the repository bridge).
- Docker default is currently `DATABASE_URL=file:/data/akbaral.db`.
- Separate mission database is `ZA141251SA_DATABASE_URL`, with its own schema and migrations.
- PostgreSQL compatibility suites pass for main and mission paths.

**Production decision:** use separate PostgreSQL databases for public AKBARAL! and ZA141251SA before enabling a GitHub-hosted mission worker. A Railway-local SQLite file cannot be shared safely with an external worker.

#### Mobile — VERIFIED

- Existing Expo **51** / React Native **0.74.1** app.
- React Navigation bottom tabs.
- AsyncStorage, notifications, deep links, WebView and SSE client.
- Existing screens: Login, Dashboard, MASTER, Workspace, Agents, Tasks, Automations, Billing and Settings.
- iOS bundle ID and Android package: `ai.akbaral.mobile`.

**Decision:** evolve the existing React Native app. Do not create a second mobile codebase. Add PWA support only if it produces a separately testable benefit.

### 1.3 Current UI locations

- Main shell/landing: `src/app/page.tsx`
- Public pages: `src/app/(public)/*`
- App pages: `src/app/{dashboard,master,workspace,projects,billing,owner,admin}/*`
- Authentication: `src/app/{signin,signup}/*`
- Shared components: `src/app/_components/*`
- Legacy runtime UI: `public/app.js`, `public/styles.css`
- Cinematic media: `public/media/hero-loop.mp4`, `public/media/hero-poster.jpg`
- Design tokens: `design-system/tokens.json`, generated web/mobile/iOS consumers
- Private mission dashboard: `mission-dashboard/{index.html,app.js,styles.css}`

### 1.4 API architecture

Main mounted endpoint families:

| Prefix | Purpose |
|---|---|
| `/api/health`, `/api/ready` | Liveness/readiness and build identity |
| `/api/auth`, `/api/auth/oauth` | Registration, login, refresh, verification, reset and OAuth |
| `/api/me` | Current account/session |
| `/api/public` | Public agent catalog and registry statistics |
| `/api/agents` | Authenticated agent discovery/details |
| `/api/master` | MASTER request/plan/run interfaces |
| `/api/tasks` | Tasks and lifecycle |
| `/api/workflows` | Workflow creation, execution, cancellation and status |
| `/api/executions/:id/events` | SSE execution stream |
| `/ws/executions/:executionId` | WebSocket execution stream |
| `/api/projects`, `/api/files`, `/uploads/*` | Projects, files, artifacts and downloads |
| `/api/tools`, `/api/models` | Tool/model readiness and routing |
| `/api/factory` | Agent templates, creation, tests, versions and lifecycle |
| `/api/automations` | Scheduled automations and runs |
| `/api/billing` | Plans, account, usage, credits, invoices and payment webhooks |
| `/api/dashboard` | Customer dashboard aggregates/history |
| `/api/notifications` | Notification delivery/read state and push registration |
| `/api/marketplace`, `/api/world` | Published agents and customer agent world |
| `/api/crm` | Contacts, pipelines, deals, campaigns and employees |
| `/api/contact`, `/api/feedback`, task ratings | Public contact and trust flows |
| `/api/admin` | Admin-only operations, providers, queues, flags and emergency stop |
| `/api/owner` | Public-platform owner diagnostics and activation reporting |
| `/api/economy`, `/api/workforce` | Owner-only platform economy/workforce controls |
| private mission `/api/*` on its own process | ZA141251SA owner, agents, treasury, opportunities, resources, earning, safety and health |

A generated machine-readable endpoint inventory must become a CI artifact in Phase 3; documentation must not rely on hand-maintained lists alone.

### 1.5 Current evidence baseline

- Production, GitHub `main`, and local baseline all identify commit `d90c315aeb869e4a2a57e9fc4a0fea8adbb93824`.
- Production `/api/health` and `/api/ready` pass.
- Production registry reports 4,001 agents and 80 categories.
- Current suite: **2,256/2,256 tests passing**.
- Typecheck passes.
- Mission PostgreSQL verification passes.
- Paid checkout is not configured in production.
- Real Gemini readiness is unknown.
- Mission worker is skipped and is not earning.
- At the audited baseline, the simplified new UI was not present; Phase 2A now supplies the forward-built design foundation and landing experience.

---

# Architectural target

## Public plane

`Browser / Mobile → Next.js or React Native → Express API → public AKBARAL! PostgreSQL → queue/providers/tools`

Contains customer accounts, customer credits, subscriptions, projects, files, tasks and artifacts. It must never expose ZA141251SA data or money.

## Private mission plane

`Private owner client → private mission service → separate ZA141251SA PostgreSQL → bounded workers/connectors → verified settlement → mission treasury`

Contains owner authentication, mission workforce, provider credentials, opportunities, settlements, treasury, wallets and audit chains. No public customer token authenticates here.

## Execution plane

`Queued work → policy check → agent router → provider/tool execution → verification → artifact → success charge or failure refund`

External bounty execution remains inside the immutable sandbox image. Submission, KYC, account acceptance and payout actions remain human/owner gated wherever platform rules require them.

---

# Phase 2 — UI/UX Professional Rebuild

## Objective

Build a coherent, typed React interface without redesigning core backend behavior. Public visuals must never reveal ZA141251SA.

## 2.1 Design-system consolidation

1. Make `design-system/tokens.json` the source of truth for color, typography, spacing, motion and elevation.
2. Add typed web primitives under `src/app/_components/ui/`:
   - `Button`, `IconButton`, `Input`, `Textarea`, `Tabs`, `Dialog`, `Drawer`;
   - `Sidebar`, `TopBar`, `UsageMeter`, `StatusBadge`, `EmptyState`;
   - `ChatThread`, `Composer`, `ArtifactPreview`, `DownloadAction`.
3. Add motion utilities that always honor `prefers-reduced-motion`.
4. Enforce WCAG AA contrast, keyboard operation, visible focus, semantic headings and screen-reader announcements.
5. Remove public runtime dependence on DOM string injection as each route reaches parity.

### Proposed component structure

```text
src/app/_components/
  ui/
  brand/
  landing/
  shell/
  chat/
  work/
  preview/
  billing/
  auth/
  dashboard/
  accessibility/
```

## 2.2 Landing page

Use the reference site for interaction qualities—not copied branding, code, imagery or content:

- restrained editorial pacing;
- full-viewport sections;
- scroll-linked transitions;
- strong typographic hierarchy;
- cinematic media and progressive disclosure.

Create six original public AKBARAL! scenes:

1. **Intelligence Core** — AKBARAL! mark, tagline and primary actions.
2. **Goal Understanding** — a request resolving into structured intent.
3. **Planning** — an ordered plan assembling from the goal.
4. **Agent Constellation** — selected specialists, not a claim that all 4,001 are working.
5. **Execution & Verification** — real tools, provider state and evidence gates.
6. **Delivered Work** — verified artifact moving into the Work canvas.

Requirements:

- `Start Free Trial` and `See Plans` CTAs;
- existing hero poster/video reused only where composition supports the new scene system;
- Canvas/SVG/CSS effects owned by the repository;
- no private mission references;
- static poster/fully readable content under reduced motion;
- no animation required to access information;
- mobile GPU/CPU budget and visibility pausing.

## 2.3 Main Chat interface

Layout:

- left sidebar: new chat, history, search, dashboard/settings navigation;
- main thread: user and AKBARAL! messages, citations, execution states and artifacts;
- sticky bottom composer: attachments, send, cancellation and accessibility labels;
- bottom mode control: `Chat` and `Work`.

Truthful entitlement rule:

- `Chat` does not consume Work task credits;
- it may be called “unlimited” only after provider quota, abuse protection and plan policy genuinely support that claim;
- otherwise display `Chat` without a false unlimited promise;
- `Work` starts with five successful free tasks during the 30-day trial and charges only verified successful executions.

## 2.4 Work mode

Desktop:

- left: conversation and workflow state;
- right: artifact preview with tabs for Preview, Files, Code, Data/Charts and Media;
- resize support and accessible panel switching.

Mobile:

- full-width Chat/Preview pane switch;
- persistent export/download action;
- keyboard-safe composer and touch targets at least 44px.

Preview types must be backed by real artifacts:

- website: sandboxed HTML preview;
- code: syntax-safe text and downloadable stored files;
- charts: data-backed chart artifact with source/time metadata;
- video: stored playable media only; scripts/guidance must be labeled as documents, not video creation;
- app: static/code preview or WebView artifact, never claim a native build unless one exists;
- download: server-stored bytes with ownership checks and correct content type.

## 2.5 Dashboard/auth/pricing

Dashboard:

- trial window and successful Work usage;
- remaining task credits;
- recent chats and Work tasks;
- upgrade action shown only when a payment provider is genuinely available;
- settings/security entry.

Authentication:

- email/password;
- Google OAuth when configured;
- honest unavailable state otherwise;
- no owner role assignment through public registration.

Pricing target:

| Plan | Price | Successful Work tasks |
|---|---:|---:|
| Free Trial | $0 | 5 / 30 days |
| Starter | $10 | 25 |
| Pro | $50 | 100 |
| Business | $90 | 250 |
| Scale | $200 | 750 |
| Enterprise | $400 | 2,000 |

Migrations already contain these tier prices/counts; Phase 2 verifies API and UI parity rather than creating a second pricing source.

## 2.6 Private mission dashboard

Serve only from the private mission service. Implement:

- separate owner login;
- fleet readiness stages: registered → work-ready → provider-ready → tool-ready → eligible → assigned → working → verified → externally paid;
- per-agent detail/chat;
- treasury, wallets, ledger reconciliation and evidence;
- opportunity and connector readiness;
- owner approvals, human-action tasks, payout destinations;
- kill switch, budgets, spending limits and audit trail.

Never place this dashboard in public navigation or bundle mission data into customer APIs.

## Phase 2 acceptance gates

- responsive widths 320–1920px;
- keyboard-only route completion;
- reduced-motion visual test;
- no horizontal overflow;
- Core Web Vitals budget defined and measured;
- existing customer routes remain functional;
- public source/assets contain no `ZA141251SA` string;
- visual regression snapshots for all six scenes and Chat/Work states;
- no placeholder preview labeled as real output.

---

# Phase 3 — Core Engine Completion and Live Verification

## 3.1 MASTER pipeline

Retain and verify the existing path:

```text
Goal Understanding
→ Planner
→ MASTER Orchestrator
→ Agent Router
→ Specialist Agent
→ Tool/Provider Execution
→ Verification
→ Artifact/Result
→ Credit commit or refund
```

Work items:

1. Publish a versioned request/result schema.
2. Make every transition idempotent and audit-linked.
3. Add explicit deadlines and cancellation propagation.
4. Persist provider/tool receipts without secrets.
5. Require verifier evidence before `completed`.
6. Add an end-to-end production canary using an owner-authorized disposable project.

## 3.2 Agent registry/readiness

Do not regenerate the 4,001 contracts. Build on the verified registry.

Add an environment-aware readiness materialization/report:

- contract integrity;
- model provider availability;
- tool handler availability;
- credential/resource readiness;
- policy eligibility;
- assignment/execution/settlement state.

No headline may call all 4,001 “working” or “earning.”

## 3.3 Providers

Primary:

```text
GOOGLE_API_KEY
```

Fallbacks, when independently configured:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
OMNIROUTE_ENABLED
OMNIROUTE_API_KEY
```

Implementation gates:

- live model discovery before selecting a model ID;
- bounded retry for 408/429/5xx;
- no retry for invalid credentials, safety blocks or dead model IDs;
- circuit breaker/provider health;
- per-user/per-agent budgets;
- no secret values in browser bundles, logs or database receipts;
- at least one free-tier-capable provider for the zero-upfront target, while clearly reporting quota exhaustion.

## 3.4 Real work capabilities

### Website builder

- complete HTML/CSS/JS or project-file artifacts;
- sandboxed preview;
- version history;
- download/export;
- security scan and output verification.

### Research

- current/latest intent detection;
- URL-backed citations;
- retrieval timestamp and source date;
- corroboration/conflict/future-date checks;
- honest current-data-unavailable response.

### Code/app development

- repository-scoped reads/writes only after authorization;
- diff artifact, tests and build evidence;
- no deployment without an explicit target permission.

### Data/trading charts

- informational analysis only;
- no autonomous trading, custody or guaranteed recommendations;
- licensed/free data source or owner-provided data;
- source, symbol, timezone and timestamp shown;
- stale-data gate.

### Video/media

- scripts/storyboards/edit plans are document outputs;
- actual media requires a real configured renderer or local open-source worker;
- preview/download only when stored media bytes exist;
- capability reports degraded when no renderer is available.

## 3.5 Credits and billing

Retain atomic reserve/commit/refund logic. Verify:

- reserve before Work execution;
- commit exactly once after verified success;
- refund exactly once on failure/cancel/recovery;
- no negative balance;
- replay-safe provider webhooks;
- invoices and external references reconciled.

Public Stripe variables:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
AKBARAL_SITE_URL
AKBARAL_CHECKOUT_SUCCESS_URL        # optional override
AKBARAL_CHECKOUT_CANCEL_URL         # optional override
```

Razorpay variables:

```text
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
BILLING_WEBHOOK_SECRET
```

Razorpay remains unavailable for a Pakistan merchant unless the owner has a genuinely eligible merchant entity. The missing browser Checkout integration must be completed before it is shown as usable.

## Phase 3 acceptance gates

- unit/integration suite green;
- PostgreSQL suite green;
- real provider canary returns non-fixture output;
- provider failure produces honest error and credit refund;
- website artifact previews/downloads from stored bytes;
- current-data research passes freshness verification;
- endpoint inventory generated in CI;
- no real-provider test runs without an explicit cost ceiling.

---

# Phase 4 — ZA141251SA Mission Activation

## 4.1 Infrastructure

Deploy as a separate private service with a separate PostgreSQL database.

Required baseline:

```text
ZA141251SA_DATABASE_URL
ZA141251SA_SESSION_SECRET
ZA141251SA_CREDENTIAL_KEY
ZA141251SA_OWNER_EMAIL=zanaveed555@gmail.com
ZA141251SA_OWNER_PASSWORD
ZA141251SA_BIND_HOST
ZA141251SA_PORT
```

Rules:

- no public AKBARAL! token accepted;
- owner identity lock verified at startup;
- health reports owner count, vault, audit and ledger integrity;
- private network/tunnel only;
- backups encrypted and restore-tested.

## 4.2 Workforce

The target is **4,001 registered mission workforce profiles**, not a false assertion that 4,001 agents are earning.

For each agent:

- unique mission identity and contract;
- scoped capabilities/tools;
- mini wallet and hard budget;
- parent/depth/sub-agent limits;
- provider/resource readiness;
- immutable audit trail;
- pause/freeze/revoke state.

Agents must never perform owner KYC. Sub-agent creation remains policy- and owner-budget-gated.

## 4.3 Earning engine

Pipeline:

```text
discover
→ qualify
→ platform/TOS/country eligibility
→ identity/KYC boundary
→ owner permissions
→ provider/resource readiness
→ exclusive assignment
→ real work
→ independent verification
→ human submission where required
→ monitor
→ external payment evidence
→ settlement verification
→ mission ledger
```

Connector states:

- API permitted;
- human-assisted;
- restricted;
- not an earning source;
- blocked/unconfigured.

Do not implement prohibited auto-bidding, fake reviews, spam, account sharing, credential abuse, KYC bypass or unauthorized scraping. Upwork/Fiverr/Freelancer/MTurk and similar platforms remain human-gated wherever their rules require account actions or submission.

### GitHub bounty path

Before enabling:

1. shared mission PostgreSQL reachable by Railway and GitHub Actions;
2. required Actions variables/secrets present;
3. immutable sandbox digest verified;
4. GitHub identity/repository permissions scoped;
5. one manual bounded dry run;
6. owner approval remains required for candidate/PR submission where designed.

Only then set:

```text
ZA141251SA_BOUNTY_WORKER_ENABLED=true
```

## 4.4 Treasury/wallets

- mission treasury and per-agent wallets;
- external receipts only after independent provider evidence;
- internal transfers never counted as revenue;
- daily reconciliation and hash-chain verification;
- liabilities/refunds/disputes represented explicitly;
- payout destinations tokenized/fingerprinted through providers—never store raw card details;
- owner approval immediately before payout send;
- manual payout schedule;
- kill switch rechecked at request and approval.

Mission Stripe requires dedicated live credentials:

```text
ZA141251SA_STRIPE_SECRET_KEY=sk_live_...
ZA141251SA_STRIPE_ACCOUNT_ID=acct_...
ZA141251SA_MONEY_WORKER_ENABLED=true
```

Test-mode Stripe must remain unable to create mission revenue.

## Phase 4 acceptance gates

- private health passes;
- exactly one permitted owner;
- public token rejected by mission service;
- mission token rejected by public service;
- audit and ledger chains verify;
- worker disabled by default;
- synthetic test money cannot become revenue;
- one legitimate opportunity can reach a truthful blocked/human-action/ready state;
- no settlement without immutable external reference;
- no payout without owner approval;
- revenue remains `$0.00` until real external evidence exists.

---

# Phase 5 — Mobile Application

## Decision: extend existing Expo React Native application

### Work plan

1. Upgrade Expo/React Native only after compatibility tests.
2. Share design tokens generated from `design-system/tokens.json`.
3. Implement the same Chat/Work information architecture.
4. Use SSE with reconnect/cursor recovery; WebSocket where supported.
5. Cache read-only history, project metadata and downloaded artifacts.
6. Queue no irreversible Work action offline; require online confirmation.
7. Push notifications for completed/failed/owner-action-required events.
8. Secure token storage using platform secure storage rather than plain AsyncStorage.
9. Deep links for auth callbacks, task details and artifacts.
10. Add tablet split-preview layout.

### Store readiness

Google Play and Apple readiness require:

- owner developer accounts;
- signing keys/certificates;
- privacy policy and data-safety disclosures;
- screenshots/metadata;
- physical-device tests;
- review approval.

These cannot truthfully be marked complete under a strict `$0` personal-spend constraint because Apple/Google developer enrollment may require external fees. Build artifacts can be made store-ready; actual publication remains owner/external approval dependent.

## Phase 5 acceptance gates

- Android/iOS typecheck and build;
- auth/session rotation;
- Chat/Work parity for supported artifact types;
- reduced motion and screen-reader labels;
- offline read-only behavior;
- push receipt on physical devices;
- no localhost browser-facing URLs;
- signed release only after owner-controlled signing setup.

---

# Phase 6 — Testing and Verification

## Test layers

1. **Unit:** pure planner/router/policy/accounting/UI state.
2. **Contract:** providers, tools, connectors and artifact schemas.
3. **Integration:** Express + database + queue + migrations.
4. **PostgreSQL:** both public and mission schemas.
5. **E2E:** browser registration → Chat → Work → artifact → download; failure/refund path.
6. **Live provider:** bounded Gemini/search/payment test with explicit opt-in.
7. **Security:** auth, RBAC, CSRF/OAuth state, SSRF, webhooks, secret scanning, injection, tenant isolation.
8. **Performance:** bundle, LCP/INP/CLS, API latency, queue throughput and memory.
9. **Mobile:** emulator plus physical Android/iOS tests.
10. **Recovery:** interrupted tasks, backup restore, ledger reconciliation and worker restart.

## Required CI gates

```text
npm ci
npm run typecheck
npm test
npm run test:pg
npm run mission:pg-check
npm run scan:secrets
npm run audit:registry
npm run audit:responsive
npm run audit:routes
npm run build
```

Live tests must be separately gated because they consume quotas, create external objects, or require credentials.

## Security completion rule

“No vulnerabilities” cannot be guaranteed absolutely. Completion means:

- no known critical/high findings in supported dependencies and application audit;
- documented threat model;
- resolved penetration-test findings;
- secret scanning clean;
- dependency and image scanning clean;
- residual risks documented and accepted by owner.

---

# Phase 7 — Deployment and Controlled Activation

## 7.1 Public Railway service

1. Build immutable image with commit stamp.
2. Configure public PostgreSQL and persistent uploads/backups.
3. Run migrations before traffic.
4. Verify `/api/health`, `/api/ready`, root, auth and public registry.
5. Run bounded authenticated MASTER canary.
6. Verify current-data research and failure/refund path.
7. Verify payment capability only after lawful provider configuration.

## 7.2 Private mission service

1. Separate service/database/secrets/network policy.
2. Provision and verify only `zanaveed555@gmail.com`.
3. Verify vault, ledger, audit and kill switch.
4. Sync registry and materialize wallets without funding or invented earnings.
5. Keep workers disabled until connector/provider readiness is evidenced.

## 7.3 CI/CD

- PR: typecheck, unit/integration, security, build and migration parity.
- `main`: immutable image publish.
- production: explicit environment approval, deploy exact digest, post-deploy health and build identity.
- rollback: previous immutable digest plus compatible migration policy.
- mission workers: independent explicit enable flags and bounded concurrency.

## 7.4 Mission activation ladder

1. discovery-only;
2. qualification-only;
3. owner-approved assignment;
4. sandbox execution;
5. verified draft;
6. human submission where required;
7. payment monitoring;
8. settlement verification;
9. treasury posting;
10. controlled expansion only after first real settlement.

Never jump directly from 4,001 registered agents to autonomous earning.

---

# Environment-variable inventory

## Public required/runtime

```text
NODE_ENV
DATABASE_URL
SESSION_SECRET
HOST
PORT
AKBARAL_SITE_URL
AKBARAL_PUBLIC_WEB_URL
NEXT_BACKEND_URL
AKBARAL_WEB_PORT                  # container/orchestration contract
AKBARAL_API_PORT                  # container/orchestration contract
AKBARAL_UPLOAD_DIR
BACKUP_DIR
CORS_ORIGINS
TRUST_PROXY
```

Not every entry is mandatory in every topology: `HOST`/`PORT` have local defaults, while the `AKBARAL_*_PORT` variables belong to orchestration scripts. Production must set explicit values instead of relying on development defaults.

## Public model/search providers

```text
GOOGLE_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
OMNIROUTE_ENABLED
OMNIROUTE_API_KEY
TAVILY_API_KEY
BRAVE_SEARCH_API_KEY
SERPER_API_KEY
```

At least one real model provider is required for real execution. Search provider requirements depend on the selected adapter.

## Public authentication/OAuth

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
MS_CLIENT_ID
MS_CLIENT_SECRET
FACEBOOK_CLIENT_ID
FACEBOOK_CLIENT_SECRET
APPLE_CLIENT_ID
APPLE_CLIENT_SECRET
```

Only configured providers should be presented as usable.

## Public billing

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
BILLING_WEBHOOK_SECRET
AKBARAL_CHECKOUT_SUCCESS_URL
AKBARAL_CHECKOUT_CANCEL_URL
```

## Public email/push

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_PASS                         # legacy compatibility alias; standardize on one
SMTP_FROM
SMTP_SECURE
AKBARAL_EXPO_PUSH_URL
EXPO_PUBLIC_API_BASE_URL          # mobile build-time public API origin
```

## Private mission

```text
ZA141251SA_DATABASE_URL
ZA141251SA_SESSION_SECRET
ZA141251SA_CREDENTIAL_KEY
ZA141251SA_OWNER_EMAIL
ZA141251SA_OWNER_PASSWORD
ZA141251SA_SITE_URL
ZA141251SA_BIND_HOST
ZA141251SA_PORT
ZA141251SA_CURRENCY
ZA141251SA_MISSION_SERVER_ENABLED
ZA141251SA_MONEY_WORKER_ENABLED
ZA141251SA_CHAT_WORKER_ENABLED
ZA141251SA_BOUNTY_WORKER_ENABLED
ZA141251SA_STRIPE_SECRET_KEY
ZA141251SA_STRIPE_ACCOUNT_ID
GITHUB_TOKEN                       # workflow-scoped, least privilege; GH_TOKEN is also accepted by gh
ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST
ZA141251SA_BOUNTY_SANDBOX_RUNTIME
```

Secrets must be placed directly in the relevant host secret manager, never chat, source, build output or client bundles.

---

# Database schema strategy

## Public AKBARAL!

Existing domains already include:

- users, sessions, tokens, OAuth and entitlements;
- plans, subscriptions, credits, invoices, payments and billing events;
- agents, categories, versions, tools, marketplace and reviews;
- tasks, workflows, steps, executions, logs and execution queue;
- projects, files, versions, artifacts and knowledge;
- automations and runs;
- CRM, campaigns and AI employees;
- notifications and device tokens;
- owner/admin audit, security and feature flags;
- workforce profiles, opportunities, assignments, execution, revenue and settlements.

Do not create replacement tables for the UI rebuild. Add migrations only for proven missing contracts such as normalized conversation/thread metadata or artifact preview metadata.

## Private ZA141251SA

Existing domains already include:

- mission owner, sessions, identity lock and access links;
- agents, contracts, chat, resources and credentials;
- wallets, ledger, cash accounts, liabilities and audit chains;
- policy, approvals, safety violations and authorization trail;
- opportunities, discovery, matching, allocator and scheduler;
- earning jobs/executions/intelligence/provider readiness;
- Stripe-verified receipts, settlements, payouts and payout-slot verification;
- platform-specific workflows and GitHub bounty execution/monitoring.

Any schema change must preserve strict database separation and receive SQLite/PostgreSQL parity tests where both engines remain supported.

---

# Planned file changes

Exact modified files will be finalized per small reviewable phase. Anticipated additions:

```text
src/app/_components/ui/*
src/app/_components/landing/*
src/app/_components/shell/*
src/app/_components/chat/*
src/app/_components/work/*
src/app/_components/preview/*
src/app/_components/dashboard/*
src/app/_components/auth/*
src/app/_components/billing/*
src/app/_lib/*
src/app/manifest.ts                    # only if PWA is approved
src/app/*/*.test.tsx                   # component/route contracts
scripts/generate-endpoint-inventory.mjs
docs/API_ENDPOINT_INVENTORY.md
```

Likely modifications:

```text
src/app/page.tsx
src/app/layout.tsx
src/app/master/page.tsx
src/app/workspace/page.tsx
src/app/dashboard/page.tsx
src/app/signin/page.tsx
src/app/signup/page.tsx
src/app/(public)/pricing/page.tsx
public/styles.css                       # compatibility reduction, then removal from new routes
public/app.js                           # compatibility reduction, then removal from new routes
design-system/tokens.json
design-system/build.mjs
mobile/App.tsx
mobile/src/screens/*
mobile/src/components/ui.tsx
mobile/src/theme.ts
mobile/src/api/client.ts
mission-dashboard/*
.github/workflows/verify.yml
.github/workflows/production-verify.yml
```

Core engine files are modified only when a failing contract or live verification identifies a concrete gap.

---

# Constraint analysis

## Feasible at zero upfront personal investment

- repository development and tests;
- current Railway resources if an existing free allocation remains available;
- GitHub Actions within account limits;
- Google AI Studio free-tier usage where available;
- local/open-source fixtures for tests;
- public discovery APIs that explicitly permit use;
- static/media assets created in-repository.

## Cannot be guaranteed at zero cost

- truly unlimited model-backed chat;
- high-volume image/video generation;
- payment processing without transaction fees;
- Apple/Google developer enrollment and store publication;
- paid marketplace bids/connects;
- long-term hosting beyond provider free-tier policy;
- revenue or external payment.

The product must degrade honestly when free quota is exhausted. No paid service is activated and no owner money is spent without explicit owner approval.

---

# Phase completion reporting template

At the end of every implementation phase, publish exactly:

```text
PHASE
CODE COMPLETE
TEST COMPLETE
PUBLISHED
DEPLOYED
LIVE VERIFIED
BLOCKED
OWNER ACTION REQUIRED
EXTERNAL APPROVAL REQUIRED
FILES ADDED
FILES MODIFIED
MIGRATIONS
TEST EVIDENCE
DEPLOYMENT IDENTITY
REAL MONEY
ONE NEXT ACTION
```

No phase is “complete” because code exists alone.

---

# Current deliverable status

## Completed now

- Phase 1 repository/stack/mobile/UI/API/database/deployment architecture verified.
- Professional rebuild architecture and phased implementation plan documented.
- Current baseline and strict public/private boundaries recorded.
- Phase 2A design-system foundation and six-scene public cinematic landing page implemented on branch `arena/01a0ff96-akbaral`.
- Phase 2A verification: typecheck, production build, secret scan, 2,263-test suite, and responsive audits at 320px and 1440px pass.

## Not yet implemented

- Phase 2B Chat/Work application-shell rebuild and remaining Phase 2 customer surfaces;
- provider credentials or external accounts;
- production database migration;
- mission runtime activation;
- app-store publication;
- worker enablement;
- earning execution or settlement.

## Real money

- Verified external mission revenue remains **$0.00**.
- No earning, settlement or payout is claimed by this plan.

## One next action

Implement **Phase 2B: the typed Chat/Work application shell**, preserving current API and engine behavior and requiring real artifact-backed previews before replacing the legacy application route.
