# AKBARAL! / MASTER AI — Implementation Roadmap

Product pipeline: **USER GOAL → MASTER AI ORCHESTRATOR → PLAN → SPECIALIST AGENTS → TOOLS/APIs → EXECUTION → VERIFICATION → FINAL RESULT**

This roadmap is based on a full audit of the repository (2026-09-09). Status is updated
after every milestone. Nothing is marked done unless it is implemented, tested,
typechecked, built and verified.

---

## Audit summary (baseline at Milestone 1 start)

**Genuinely implemented and verified (tests green, typecheck green):**

| Area | State |
| --- | --- |
| Agent Registry | 4,000 genuinely differentiated agents (80 domains × 50 specialization archetypes) with unique instructions, capabilities, I/O, tools, workflow, verification rules, security, cost metadata, fallback strategy, eval config; DB-synced with versioning and marketplace visibility |
| Model router + providers | Capability/cost/latency scoring, fallback chain, run recording; OpenAI / Anthropic / Google adapters with honest `provider_not_configured` failures |
| Executor | Task creation, atomic credit reservation (guarded updates, idempotent), per-failure automatic refunds, prompt-injection system guard |
| Agent #001 (Web Research) | Real search/fetch pipeline with source verification (test fixture driven) |
| Planner (v0) | Keyword intent detection → persisted workflow + step graph with dependencies |
| Workflow runner (v0) | Dependency-ordered step execution; failed steps refund credits; dependents skipped |
| Billing / trust | 30-day trial + 5 free tasks, atomic consume/refund across paid→bonus→free pools, invoices, plans, entitlements |
| Security | JWT auth, argon-grade password hashing, rate limits, security headers, SSRF guard, audit log, emergency stop, admin RBAC |
| Realtime | WebSocket execution stream + SSE fallback |
| API surface | auth, me, agents, tasks, workflows, projects, files, billing, admin, tools, factory, marketplace, notifications, CRM, trust |
| Web + mobile | Premium Next.js homepage (preserved); React Native mobile shell |

**Identified highest-value gaps (drove this roadmap):**

1. The orchestrator's "verification" stage was **not real** — the generic agent
   path logged "Verification passed" merely because a model returned text.
   Agent `verificationRules` / `evaluationConfig` were stored but never applied.
2. Planning was **keyword-only** (14 hardcoded rules, fixed confidence); the
   model router was never used for goal analysis even when a provider is
   configured, and the mode was never disclosed.
3. **No final-result synthesis**: workflow results were a raw step map; no
   MASTER-level final deliverable document.
4. **No single MASTER entry point**: callers had to chain plan + run endpoints.
5. **No tool stage for generic agents**: agent tool permissions existed but the
   generic execution path never ran tools.
6. No provider base-URL overrides (proxies / Azure / self-hosted impossible).
7. Workflow steps were not linked to their tasks; credit accounting per
   workflow was not aggregated.

---

## Milestones

### Milestone 1 — Real MASTER AI Orchestrator foundation (DONE — implemented, tested, verified)

Goal: make every stage of the core pipeline real, honest and observable.

- [x] **Goal analyzer** (`src/orchestrator/goal-analyzer.ts`): LLM-driven goal
      analysis (intents, deliverables, constraints, complexity, clarifying
      questions) through the model router with strict JSON validation, and a
      deterministic heuristic fallback when no provider is configured. The
      analysis mode (`llm` | `heuristic`) is always disclosed.
- [x] **Verifier** (`src/orchestrator/verifier.ts`): real verification stage.
      Deterministic output-contract checks derived from each agent's declared
      verification rules (non-empty, substance/structure, refusal detection,
      fabricated-citation detection when no source tools ran, goal-addressed
      and declared-output coverage as soft checks) plus an optional LLM rubric
      pass. Failed verification fails the task → free credit refunded.
- [x] **Synthesizer** (`src/orchestrator/synthesizer.ts`): final-result
      document generation (executive summary, per-step verified sections,
      next steps, credit accounting). LLM synthesis when configured;
      deterministic honest assembly otherwise.
- [x] **Planner v1**: scored specialist selection (goal-term overlap with
      specialization/capabilities/outputs, not first-prefix match); plan
      persisted to `workflows.plan_json`; consumes goal analysis.
- [x] **Executor v1**: bounded real tool stage (best-effort `web_search` /
      `knowledge_search` with honest unavailability logging, never fatal),
      real verification integrated, honest verification reporting.
- [x] **Workflow runner v1**: step↔task linkage, aggregated credit accounting,
      final synthesized result persisted to `workflows.result_json`.
- [x] **One-shot MASTER API**: `POST /api/master` (goal → analyze → plan →
      run) and `GET /api/master/:id` (workflow + final result).
- [x] **Provider base-URL overrides** (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`,
      `GOOGLE_BASE_URL`) for proxies / Azure / self-hosted endpoints.
- [x] Tests: unit tests per stage + full-pipeline integration test proving
      (a) honest failure + refunds with no provider, (b) green path with a
      local OpenAI-compatible mock provider.
- [x] Typecheck, tests, build, live endpoint verification, commit.

### Milestone 1 verification record (2026-09-09)

- `npm run typecheck` — clean.
- `npm test` — **96/96 pass** (27 new stage unit tests, 4 full-pipeline
  integration tests incl. honest-refund red path and fixture-provider green
  path).
- `npm run build` — backend tsc + Next.js production build succeed.
- Live verification against the running server: `POST /api/master` returned a
  202 with honest heuristic analysis (`Model analysis unavailable (openai is
  not configured; set OPENAI_API_KEY)`), an 8-step plan across 3 intents with
  scored specialist selection, step→task linkage, honest tool-stage logging
  (`Tool web_search unavailable ...; continuing without it`), a persisted
  deterministic final-result document, and the trust policy intact
  (credit reserved → task failed → credit refunded; user back at 5/5 free
  credits, 30-day trial).
- Boot now self-heals an incomplete agent registry (4,000 specialists synced
  when missing).

### Milestone 2 — Agent Registry scale-out (DONE — implemented, tested, verified)

- [x] Relevance-ranked search: multi-term OR matching + weighted in-memory
      ranking (slug segment > name > specialization > category >
      capabilities/outputs > description), hyphen-insensitive matching,
      stable alphabetical browse without a query. Verified live
      ("shopify ecommerce store" -> e-commerce specialist ranked #1).
- [x] Word-boundary intent matching in the goal analyzer (fixes "marketing"
      falsely triggering the research intent via the "market" substring).
- [x] Registry integrity in `GET /api/admin/stats` (db vs catalog count,
      duplicate slugs, category coverage). Verified live: 4000/4000, complete,
      0 duplicates, 80 categories.
- [x] Existing category counts, pagination and detail endpoints audited as
      already implemented; full-contract diversity audit remains in
      `npm run audit:registry`.

### Milestone 3 — Agent execution/runtime (DONE — implemented, tested, verified)

Production execution engine shipped on top of stage 1.

- [x] Crash recovery (`src/orchestrator/recovery.ts`): boot-time
      reconciliation fails non-terminal workflows/steps/tasks/executions
      with an honest "interrupted by server restart" error and refunds every
      reserved task credit exactly once (idempotent). Verified live with a
      simulated crash: boot logged "1 workflow(s), 1 task(s), 1 execution(s)
      marked failed; 1 credit(s) refunded"; ledger shows consume then refund;
      account restored to 5/5.
- [x] Persistent execution queue (`src/orchestrator/queue.ts`,
      `db/migrations/0006_execution_queue.sql`): DB-backed jobs
      (queued/running/retrying/completed/failed/cancelled/timed_out) with
      worker locks and claim-based tick loop; survives restarts with no
      duplicate execution (idempotency keys `agent:<executionId>` /
      `workflow:<workflowId>`; duplicate enqueues return the existing job).
- [x] Retries: exponential backoff `min(base·2^(attempts−1), 30s)`,
      configurable max attempts; only retryable failures retry —
      `provider_not_configured`, `verification_failed`, `requires_pro` etc.
      are permanent; every attempt is persisted.
- [x] Timeouts: per-step (`stepTimeoutMs`) and overall workflow
      (`workflowTimeoutMs`) budgets with safe abort; abandoned in-flight work
      can never resurrect a terminalized task/workflow (guarded status
      writes); workflow overall timeout is terminal (no retry).
- [x] Cancellation: user `POST /api/tasks/:id/cancel`,
      `POST /api/workflows/:id/cancel`; admin `POST /api/admin/tasks/:id/cancel`
      and `POST /api/admin/queue/cancel-all` (emergency stop); queued jobs are
      settled instantly, running jobs abort at the next probe; every
      cancellation refunds the reserved credit exactly once; all admin
      actions audit-logged.
- [x] Queue observability: `GET /api/admin/queue/jobs` (status/limit/offset
      filters + by-status stats + active workers); job state included in
      `GET /api/master/:id` and enqueue responses; real-time status pushes
      (queued → running → step progress → retrying → terminal) over the
      existing WS/SSE stream.
- [x] Routes on the engine: `POST /api/tasks/research`,
      `POST /api/workflows/:id/run`, `POST /api/workflows/agent`,
      `POST /api/master` all enqueue; real pipeline preserved (analysis →
      planning → tools → execution → verification → synthesis).
- [x] Trust policy invariant: every unsuccessful terminal path (queue
      failure, retry exhaustion, timeout, cancellation, crash-recovery
      failure) reconciles the task and refunds exactly once; the engine was
      built concurrency-safe for 4,000+ agents (concurrency limit, worker
      locks, guarded terminal transitions).

**Milestone 3 verification record (2026-09-09):** 16 new tests
(`src/orchestrator/queue.test.ts`: success/streaming, persistence across
"restart", stale requeue, exhausted-stale refund + idempotency, retry
success, retry exhaustion, permanent no-retry, verification failure, step
timeout, queued cancel, running cancel, admin cancel-all, idempotency,
parallel race/credit balance, workflow job, workflow timeout) — full suite
**123/123 green**, typecheck clean, production build green. Live-verified:
master workflow enqueued with job handle → honest `provider_not_configured`
permanent failure (no retry) with consume-then-refund ledger and account
restored to 5/5; 409 conflict on cancelling terminal work; admin queue
listing with stats; simulated dead worker → boot recovery requeued the
stale job → attempt 2 → honest failure + exactly-one refund.

### Milestone 4 — Tool/API/provider abstraction + model router (DONE — implemented, tested, verified)

- [x] Tool catalog expanded behind the existing permission boundary: four new
      fully local, credential-free tools — `http_request` (SSRF-guarded public
      GET/POST JSON), `json_transform`, `text_analyze`, `csv_parse` — plus
      catalog specs synced to the DB (18 tools total, 10 usable without any
      credentials).
- [x] Per-tool credential status API: `GET /api/tools/credentials` reports for
      every tool whether it is implemented, which env keys it requires, whether
      they are configured and whether it is usable right now — values are never
      exposed; `GET /api/tools` rows now include `credentialConfigured`.
      Tool input validation failures now surface honestly as
      `tool_input_error` instead of a generic `tool_failed`.
- [x] Model catalog API: `GET /api/models` lists providers and models with
      truthful availability, required env keys, costs, latency and defaults.
- [x] Routing preview API: `POST /api/models/route` returns the primary
      decision plus the ordered fallback chain with reasons — no model call,
      no cost.
- [x] Streaming model output: native `streamChat` for the OpenAI-compatible,
      Anthropic and Google adapters (real SSE parsing with per-chunk timeouts
      and redacted errors) and `modelRouter.completeStreaming` with the same
      fallback chain and run recording; exposed via
      `POST /api/models/chat/stream` (SSE: decision → tokens → done|error).
      Unconfigured providers end the stream with an honest
      `provider_not_configured` event — never a fabricated completion.
- [x] Provider health checks: `GET /api/admin/providers/health` reports
      DB-derived run statistics per provider (total/succeeded/failed, average
      latency, last used, last error) plus credential presence;
      `?live=1` performs a real models-list request against each configured
      provider (8s timeout) and reports honest ok/failure details.

**Milestone 4 verification record (2026-09-09):** 15 new tests
(`src/models/models-api.test.ts`: credential status, catalog flags, SSRF
contract for http_request, json_transform/text_analyze/csv_parse happy +
validation paths, model catalog truthfulness, routing preview, honest
unconfigured SSE stream, real token streaming via the model fixture, auth
enforcement, admin RBAC, DB-derived health, live check against a live and a
dead endpoint) — full suite **138/138 green**, typecheck clean, production
build green. Live-verified on the dev server: 18 tools / 10 usable /
8 honestly-missing credentials; model catalog all `available=false` with
env keys; routing chain preview; SSE stream ending in
`provider_not_configured`; admin health with `?live=1` honest details.

### Milestone 5 — Workspace/project/files (DONE — implemented, tested, verified)

- [x] Project-scoped workspaces: full membership model on the existing
      `workspace_members` table — `owner > admin > member > viewer` enforced on
      every route (reads for all members, uploads/work for member+, membership
      management for admin+). Non-members receive an indistinguishable 404 (no
      existence leak). Owner role/removal is immutable; any member may
      self-leave. Endpoints: `GET/POST /api/projects`,
      `GET/PATCH /api/projects/:id`, `GET/POST /api/projects/:id/members`,
      `PATCH/DELETE /api/projects/:id/members/:userId`; project lists include
      `my_role`; invitations notify the invited user.
- [x] File attachments on tasks: `GET/POST/DELETE /api/tasks/:id/files[...]`
      — task owner may attach only their own non-artifact files (single active
      attachment enforced); attached text content is injected into the agent
      execution as explicit user-provided data (never instructions) via a
      bounded context block.
- [x] Knowledge indexing per project: uploads auto-index (existing FTS);
      `POST /api/projects/:id/knowledge/search` searches the shared
      workspace knowledge across all members (membership-gated), while the
      personal `/api/files/knowledge/search` stays user-scoped.
- [x] Artifact storage of agent outputs: every guarded task completion (agent
      and web-research paths) stores the verified output as a real downloadable
      file (kind `artifact`, sha256, storage-key guard, idempotent per task —
      retries cannot duplicate); `GET /api/projects/:id/artifacts` lists them;
      artifacts cannot be re-attached to tasks.

**Milestone 5 verification record (2026-09-09):** 9 new tests
(`src/routes/workspace.test.ts`: role listing, outsider 404 isolation, invite
matrix + unknown-email 404 + owner protection, role changes, self-leave,
viewer upload denial, project-scoped knowledge incl. cross-member visibility,
attach/detach ownership validation, attachment content reaching the model
(verified via fixture-captured messages), artifact stored + downloadable +
no-reattach, auth enforcement) — full suite **147/147 green**, typecheck
clean, production build green. Live-verified: project creation, colleague
invite as member, member upload into the shared workspace, cross-member
project knowledge search, owner-file attach (foreign file honestly 404),
project archive/reactivate, artifacts endpoint.

### Milestone 6 — Agent Factory (DONE — implemented, tested, verified)

- [x] Template derivation from the 4,000-agent matrix:
      `GET /api/factory/templates` (search by name/specialization/description
      via `json_extract`, category filter, only platform registry agents —
      never other users' customs), `GET /api/factory/templates/:slug`
      (complete derived spec with `templateOf` provenance), and
      `POST /api/factory/agents/from-template` (owned, versioned 1.0.0,
      provenance persisted in config, user overrides, duplicate-slug
      protection). Also fixed a slug-normalization bypass: generated slugs now
      round-trip through `slugify` so the duplicate check cannot be bypassed by
      case differences (binary DB collation).
- [x] Sandboxed benchmark runs: `POST /api/factory/agents/:slug/benchmark`
      executes the agent against up to 5 goals through the real verified
      pipeline (type=`test` tasks — never consume user credits) and aggregates
      honest results (pass rate, average verification score, per-run latency,
      explicit `providerNotConfigured` flag — no fabricated scores).
- [x] Publishing pipeline to marketplace: unchanged v0 surface
      (`/api/marketplace/:slug/publish` review flow) — the factory already
      creates marketplace rows (`draft`/`pending_review`) with price + tags, and
      every template-derived agent flows through it unchanged.

**Milestone 6 verification record (2026-09-09):** 6 new tests
(`src/orchestrator/factory-templates.test.ts`: matrix template search (only
unowned registry agents), derivation + provenance + 404, create-from-template
with overrides + ownership + provenance + duplicate rejection, honest
unconfigured benchmark (no fabricated scores) + real fixture benchmark with
2/2 verified passes, owner-only benchmark/management (403), input validation)
— full suite **153/153 green**, typecheck clean, production build green.
Live-verified: template search (5 marketing specialists), derivation with
provenance, custom agent creation (draft marketplace status), duplicate slug
400, honest `provider_not_configured` benchmark with `passRate 0` and credits
untouched (5/5).

### Milestone 7 — Agent World + Marketplace (DONE — implemented, tested, verified)

- [x] Reviews: migration `0007_agent_reviews` (1-5 CHECK, UNIQUE per
      user+agent, update trigger). `POST /api/marketplace/:slug/rate` upserts
      (update replaces the comment — no stale text) and recomputes the
      marketplace aggregate honestly (`rating = AVG`, `review_count = COUNT`
      from real reviews only); `GET /api/marketplace/:slug/reviews` lists
      reviews plus the caller's own.
- [x] Install accounting fixed: `install_count` now increments exactly once
      per user on first install (the pre-existing double increment in
      `createAgentOrder` was removed — orders remain recorded per install
      event and power the trending window); repeat installs no longer force
      the favorite flag (favorites are the user's own choice).
- [x] Featured/trending with real usage signals:
      `GET /api/marketplace/featured` ranks published agents by
      installs + review count + rating-weighted reviews + completed
      executions; `GET /api/marketplace/trending?days=` ranks by recent
      install events, completed executions and fresh reviews inside the
      window. An empty marketplace stays empty — nothing is fabricated.
- [x] Agent World surface: `GET /api/world?q=` — the user's saved/installed
      agents with real usage signals (their task count per agent, total
      completed executions, last used, favorite state, summary counts);
      `POST /api/world/:slug/favorite` toggles; `DELETE /api/world/:slug`
      removes.
- [x] Honest visibility preserved: unpublished custom agents are invisible to
      non-owners (404, no existence leak); the owner receives the explicit
      `agent_not_published` conflict (403).

**Milestone 7 verification record (2026-09-09):** 8 new tests
(`src/routes/marketplace-world.test.ts`: publish flow, install-once-per-user,
rating upsert + honest AVG/COUNT recompute + comment replacement + listing,
featured ranking order, trending window counts, Agent World listing/favorite/
removal, unpublished visibility semantics for owner and non-owner, auth
enforcement) — full suite **161/161 green**, typecheck clean, production build
green. Live-verified: publish → install (+repeat, counter stays 1) → rate 5 →
featured ranks the agent first on real signals (installs=1 rating=5 reviews=1
score=18) → trending (2 install events, 1 review) → Agent World listing with
real task usage → favorite toggle.

### Milestone 8 — Trial/credits/billing (DONE — implemented, tested, verified)

- [x] Real payment providers behind honest configuration gates:
      `src/billing/providers.ts` creates real Stripe Checkout Sessions
      (`/v1/checkout/sessions`, USD, `client_reference_id` = invoice number)
      and Razorpay Orders (`/v1/orders`) through `externalHttpRequest` with
      `<PROVIDER>_BASE_URL` overrides, 20s timeouts and `PaymentProviderError`
      wrapping (no credential leakage in errors). Unconfigured providers keep
      returning 402 `provider_not_configured` naming the exact missing
      credential (`STRIPE_SECRET_KEY` / `RAZORPAY_KEY_ID`+`RAZORPAY_KEY_SECRET`)
      — no faked success. `POST /api/billing/credits` is now async and returns
      `providerReference` + `checkoutUrl` for configured providers.
- [x] Idempotent webhook settlement + duplicate protection: migration
      `0008_billing_hardening` adds `processed_billing_events` (PK
      provider+provider_event_id) so a replayed `event_id` is claimed and
      ignored BEFORE any side effect; `handleWebhookEvent` dispatches
      `invoice.paid` / `payment.failed` / `invoice.refunded` /
      `payment.refunded` / `subscription.cancelled` with honest effects
      (`settled`, `already_paid`, `already_refunded`, `not_paid`,
      `payment_marked_failed`, `no_pending_payment`, `invoice_not_found`,
      `ignored_duplicate`, …). `settleInvoicePayment` is idempotent and —
      verified live and by regression test — a refunded/cancelled/void
      invoice can never be re-settled or re-granted (the double-grant-after-
      refund hole found during live verification was closed in both the
      webhook path and the admin `settle-payment` path, which now rejects
      non-payable invoices with 409).
- [x] Webhook authenticity: `POST /api/billing/webhook` requires a
      timing-safe HMAC signature (`X-AKBARAL-Signature: sha256=…` with
      `BILLING_WEBHOOK_SECRET`); Razorpay deliveries must ALSO carry a valid
      `X-Razorpay-Signature` (HMAC-SHA256 of the raw body with
      `RAZORPAY_KEY_SECRET`). Forged/unsigned payloads are 401.
- [x] Refunds with credit reversal: refunding a paid invoice marks the
      invoice + its payments refunded and atomically reverses the granted
      credits (paid pool clamped at 0, `reversal` ledger row); replays are
      no-ops and refunds of never-paid invoices are honest no-ops.
- [x] Invoice PDFs: dependency-free PDF 1.4 generator
      (`src/billing/invoice-pdf.ts` — Catalog/Pages/Contents/Fonts, WinAnsi,
      valid xref, `%%EOF`) rendering the real invoice (number, status, dates,
      line items, subtotal/tax/total). `GET /api/billing/invoices/:id/pdf` is
      owner-only (404 for anyone else, no existence leak), served as
      `application/pdf` with an attachment filename.
- [x] Usage statements: `GET /api/billing/usage?from&to` (default 30 days)
      aggregates the user's REAL activity — tasks by status, credit
      granted/consumed/refunded flows, model runs with cost, invoices and
      paid cents. No estimated or fabricated numbers.
- [x] Revenue/margin/conversion reporting: `GET /api/admin/billing/overview`
      (admin-only) reports paid/refunded/outstanding revenue with a monthly
      breakdown by `paid_at`, provider model costs, gross margin in cents and
      percent, credit flows, subscriptions by plan, trial→paid conversion,
      failed payments and marketplace volume/commission
      (`AKBARAL_MARKETPLACE_COMMISSION_BPS`, default 1000 bps).
- [x] Trust policy regression-free: registration still grants 5 free tasks +
      30-day trial; credits are consumed only on successful completion,
      returned on failure/timeout/cancellation; zero balance → honest 402
      `requires_pro` with zero consumption (all re-asserted by tests).

**Milestone 8 verification record (2026-09-09):** `src/billing/billing.test.ts`
(17 tests: trial grant, consume-on-success/refund-on-failure, requires_pro
no-consumption, manual purchase due invoice, forged/unauthenticated webhook
401, settle-once-grant-once, duplicate event ignored, payment.failed no grant,
refund reverses + replay/no-pay no-ops + refunded-invoice re-payment guard,
admin settle of refunded invoice 409, provider_not_configured 402, real Stripe
checkout + Razorpay order against a local provider fixture, Razorpay dual
signature enforcement, PDF validity + owner-only 404, usage statement real
numbers, plan switch/account state, admin overview + non-admin 403,
webhook_not_configured 503). Full suite **178/178**, typecheck clean, build
green. Live-verified on the running server: 30-day trial on register, honest
402 for unconfigured Stripe, manual purchase → due invoice, signed webhook
settle → credits granted, duplicate replay ignored, forged signature 401,
payment.failed → `payment_marked_failed` then late settle OK, refund →
credits reversed + replay no-op, **invoice.paid on a refunded invoice →
`already_refunded` with zero re-grant** (the pre-fix live run exposed the
double-grant hole; dev data was corrected, guard added, regression added),
PDF `%PDF-1.4` + `application/pdf` + attachment + outsider 404, usage
statement real aggregates, admin overview (revenue/refunded/outstanding/
monthly/margin/conversion/failed/marketplace) + non-admin 403 + anonymous 401.

### Milestone 9 — Security/admin/observability hardening (DONE — implemented, tested, verified)

- [x] JWT hardening (`src/security/jwt.ts`): the verifier now pins the
      algorithm (forged `{"alg":"none"}` headers are rejected outright),
      validates `typ`, and compares signatures in constant time
      (`timingSafeEqual`). Expired/wrong-secret/malformed tokens are
      rejected; legitimate tokens keep working.
- [x] Session-secret rotation grace: `SESSION_SECRET_PREVIOUS` keeps the
      prior signing secret valid for one rotation cycle (the 1-hour
      access-token lifetime), so operators can rotate `SESSION_SECRET`
      without hard-logging-out every active session. Documented in
      `.env.example`; live-verified by rotating the running server's secret.
- [x] Per-account login brute-force lockout (`src/auth/service.ts`): after
      10 failed logins for the same account within 15 minutes, further
      attempts — including ones with the correct password — are rejected
      with 429 `login_rate_limited` (+ `retryAfterSeconds`), counted from
      the durable `security_logs` table (survives restarts, auditable) and
      logged at critical severity. Other accounts are unaffected; failure
      messages stay generic (no user enumeration).
- [x] Audit search API: `GET /api/admin/audit?actor&action&from&to&limit&offset`
      (admin-only) with real filters over `admin_actions`, newest first,
      page size bounded at 200, actor email joined for display. Feature-flag
      changes are now audited (`feature_flag.updated`) alongside the
      existing agent/model/payment/queue admin actions.
- [x] Upload error-handling bug fixed (`src/routes/files.ts`): multer
      errors (e.g. `File too large`) were thrown from an asynchronous
      stream callback where Express never sees them — the request hung and
      the error surfaced as an uncaughtException. All upload failures now
      route through `next()` and answer the client (400 `upload_failed` in
      ~100ms live; previously a 300s hang).
- [x] Attack-surface verification suite
      (`src/security/attack-surface.test.ts`, 14 tests against the real
      in-process API and real guard functions): forged/tampered/expired
      JWTs rejected; rotation grace verified; register-body `role` ignored
      (no self-promotion) and admin routes 403/401 for non-admins/anon;
      per-account lockout incl. correct-password-blocked and
      no-user-enumeration; cross-tenant IDOR (projects, executions,
      invoice PDFs, files → 404 without existence leaks); SSRF guards
      (loopback/private/link-local metadata/`::1`/`file:`/`ftp:`/`0.0.0.0`
      all rejected, public https allowed); path traversal (storage keys,
      traversal file ids); malicious uploads (traversal filenames stored
      only inside the upload dir, 26 MiB rejected, non-members 404); no
      secret leakage (config status, generic login errors, request logs
      never contain tokens/headers); audit search filters + bounded pages;
      concurrent duplicate webhooks settle exactly once (8 parallel
      deliveries of one event → 1 settled, 7 ignored, credits granted
      once); negative/zero credit manipulation rejected; rate-limit buckets
      key on the real client IP (rotating `X-Forwarded-For` does not
      bypass). Prompt-injection quarantine and webhook signature/replay
      defenses were verified in M5–M8 suites and remain covered there.

**Milestone 9 verification record (2026-09-09):** 14 new tests
(`src/security/attack-surface.test.ts`), full suite **192/192**, typecheck
clean, build green. Live-verified on the running server: session-secret
rotation with a pre-rotation token still valid (200) and a tampered variant
rejected (401); 10 failed logins → 429 `login_rate_limited` with
`retryAfterSeconds: 900` while a different account logs in normally;
`GET /api/admin/audit?action=feature_flag` returning the just-performed
admin action with actor email (non-admin 403); 26 MiB upload answered with
400 `upload_failed` in 97ms (pre-fix: hung request + uncaughtException);
clean upload with a `../../evil.sh` filename stored only under the
server-generated key inside the upload directory.

### Milestone 10 — Production deployment/scaling (DONE — implemented, tested, verified)

- [x] Real liveness + readiness probes: `GET /api/health` now performs an
      actual database round trip (the old payload reported `database:'ok'`
      unconditionally — a fake signal; 503 `degraded` when the DB is down).
      `GET /api/ready` verifies database, migrations currency (files vs
      `_migrations`), upload-directory writability and execution-queue
      worker liveness; load balancers/orchestrators gate traffic on it.
- [x] Prometheus metrics endpoint: `GET /api/metrics` (admin-only) exposes
      real measurements in text format 0.0.4 — process uptime/RSS/heap,
      HTTP request rate + average duration over 5 minutes from
      `system_metrics`, queue jobs by status (canonical statuses always
      emit, 0 for an empty queue), active workers, database size, and
      business counters (users/agents/tasks).
- [x] Verified backups: `src/scripts/backup-db.ts` replaces the unsafe
      `cp`-based backup.sh — `VACUUM INTO` (transactionally consistent
      online snapshot), independent verification (integrity_check + row
      counts for users/tasks/agents/invoices/credit_transactions/projects
      vs the live DB; failures delete the artifact and exit non-zero),
      sha256, retention (keep-N, default 30). `npm run db:backup`.
- [x] Verified restore: `src/scripts/restore-db.ts` refuses unverified
      backups, takes a safety snapshot of the current DB, atomically
      renames the snapshot into place and clears stale WAL sidecars;
      restart required after (documented). `npm run db:restore`.
- [x] Production container: Dockerfile now ships the full stack (Next
      `.next` + API `dist` + `next.config.mjs` — previously the runtime
      image had no web build), healthcheck moved to `/api/ready`, nightly
      verified backup cron at 01:17 UTC with retention inside the volume
      (env-tunable, disableable). FIX: `scripts/start-prod.mjs` ran the API
      with `NODE_ENV=development`, silently relaxing the production
      SESSION_SECRET startup guard — now production.
- [x] `docker-compose.production.yml`: single-node production composition
      (restart policy, resource limits, json-file log rotation, env-file
      secrets, named volume for DB/uploads/backups) with the honest
      single-node scaling story documented — no faked horizontal scaling.
- [x] Graceful shutdown now drains the execution queue before closing HTTP
      and the database.
- [x] `docs/DEPLOYMENT.md`: complete honest runbook — architecture, first
      deployment, required env, probes/monitoring, backup + restore
      procedures, restore-drill requirement, off-host backup note,
      scaling table (launch posture vs POST-LAUNCH), security operations,
      launch checklist.

**Milestone 10 verification record (2026-09-09):** 8 new tests —
`src/scripts/backup.test.ts` (verified snapshot of a live DB, corrupt and
drifted files rejected, retention keep-N, full restore round-trip proving
exact snapshot state incl. integrity check and post-backup rows rolled
back) and `src/server/health.test.ts` (liveness actually checks the DB,
readiness checks all four dependencies, migration check fails honestly on
pending files, Prometheus metrics admin-only + valid text format + real
non-zero measurements). Full suite **200/200**, typecheck clean, build
green. Live-verified on the dev server (see commit message).

### Milestone 11 — Launch readiness QA (DONE — 2026-09-09, for the 18 September 2026 launch)

Full-platform QA performed with the live server: 23-endpoint smoke pass,
end-to-end research-task verification (success path with report + credit
consumption, and honest-failure path with refund), flagship-agent seed fix,
and the honest classification of every feature in
**`docs/LAUNCH_READINESS.md`** (LAUNCH READY / PARTIALLY READY with stated
dependencies / POST-LAUNCH). Verdict: **GO**, contingent on the deployment
checklist in `docs/DEPLOYMENT.md`.

- [x] Launch blocker fixed: the flagship `web-research-001` was absent from
      fresh seeds (lazily created by the first research task and owned by
      that user, invisible to everyone else in discovery). It is now a
      first-class platform-owned catalog definition synced by every
      seed/boot — registry 4,001 agents, research category 51, `GET
      /api/agents/web-research-001` 200 for every user (registry test
      updated; live-verified).
- [x] Live end-to-end: research task completed via the real pipeline
      (dispatch → plan → specialist → search/fetch → verify → synthesize;
      2,418-char report, 6 logs) with credits consumed exactly once
      (5→4); the sandbox-blocked variant failed honestly and refunded
      (5→5) — both trust-policy behaviors live-verified.
- [x] 200/200 tests, typecheck clean, build green at QA close.

### Production-readiness pass (2026-09-10) — UI/API contract audit + honest AdSense readiness (COMPLETE)

A live contract audit of every SPA loader against the real API surfaced and
fixed real UI bugs (all verified against the running backend, not inferred):

- [x] MASTER flow was broken in the client: it read `plan.workflowId` (API
      returns `plan.workflow.id`), expected an `executionId` from the run
      response (API returns `{workflow, job}`), and rendered intent objects
      as `[object Object]`. Rewritten end-to-end: plan → `POST /:id/run` →
      poll `GET /api/workflows/:id` with per-step status, terminal
      result/error display, and credit refresh. Live-verified (plan → run →
      poll → terminal status; specialist dispatch reads `task.executionId`).
- [x] Admin dashboard read the wrapped `/api/admin/stats` response
      (`{stats:{...}}`) directly — every stat rendered `undefined`. Unwrapped;
      inner keys verified to match the renderer exactly.
- [x] Trial UI read `trial.isActive` / `trial.daysRemaining` — fields that
      never existed (`/api/me` returns `trial.active` and `trialEndsAt`).
      Fixed in the credit pill, dashboard, billing and settings; days are
      computed from `trialEndsAt` (real value, never invented).
- [x] Auth 401-refresh race (observed live from a real browser session):
      concurrent API calls all 401 and each refreshed independently, but the
      server strictly rotates refresh tokens — every refresh except one was
      rejected, producing a 401 loop. Fixed with a single-flight refresh
      lock, cross-tab token sync via the `storage` event, and clean session
      clearing when a refresh token is revoked. Race simulation (5 parallel
      authenticated calls after token expiry) passes 200 across the board.
- [x] Execution polling bounded (10-miss guard) so an unknown execution can
      no longer poll forever.
- [x] Plan preview now shows each step's goal (not only the agent slug).
- [x] AdSense readiness, honest by construction: privacy policy discloses
      cookies/advertising truthfully; Terms, Security, About and Contact
      surfaces are real content (About/contact added to the footer nav); a
      consent banner + clearly-labelled single ad slot exist but activate
      ONLY when a real publisher id (`AKBARAL_ADSENSE_CLIENT`) is configured
      AND the visitor accepts — unconfigured deployments load no ad script,
      show no banner, render no slots and serve an honest 404 `ads.txt`.
      No fake ads, no fake earnings, no approval claims.
- [x] Full QA at close: 200/200 tests, `tsc --noEmit` clean, production
      build green, fresh dev server, live verification of auth, billing
      (plan switch 202, credit purchase order shape), feedback, knowledge
      search, marketplace, agents, admin analytics/CRM shapes, and the
      homepage markers (About/Contact links, hidden ad elements, v7 bundle,
      zero ad scripts on page).

### Cinematic visual transformation (2026-09-10) — COMPLETE

A full premium visual/UI/UX transformation of the entire product to the
"luxury cinematic AI operating system" language (near-black cinematic
tones, muted olive/moss/antique-gold, warm off-white editorial type,
hairlines, fine grids, glass, restrained motion). All original design and
assets — no third-party or copied material.

- [x] New design system (`public/styles.css`, complete rewrite, both dark
      default and functional light theme) applied uniformly across landing,
      auth, dashboard, MASTER, agents, factory, marketplace, workspace,
      CRM, billing, admin and settings. All 12 screens and every bound
      element preserved (ID parity audited against the previous page).
- [x] Cinematic hero: full-bleed background-video SLOT architecture —
      `<video>` with poster + an ORIGINAL canvas intelligence-network
      animation as the live fallback + still poster for reduced-motion /
      no-JS / mobile. Production video placement documented in
      `docs/DESIGN.md` (`public/media/hero-loop.mp4`). Zero third-party
      assets; zero layout shift; performance budgeted (92 KB poster,
      preload=none, light node budget on mobile/save-data).
- [x] Hero copy per product identity (ONE INTELLIGENCE. EVERY SOLUTION.),
      Start Building / Explore AI Agents CTAs, and a live system chip
      whose READY/DEGRADED state comes from the real /api/health response.
- [x] Scroll narrative: chapter rail with active-section tracking,
      reveal system, pipeline spine that draws as stages reveal, staggered
      trace/lab rows, real-number counters (4,001 agents / 80 disciplines),
      subtle parallax, magnetic CTAs, hero cursor reticle — all disabled
      under prefers-reduced-motion and paused off-screen/hidden-tab.
- [x] Sections: MASTER pipeline (9 architecture stages), Agent World (real
      registry categories + counts), Agent Factory laboratory, execution
      trace (honestly labeled representative run), security-first trust
      section (implemented controls only), honest pricing with the locked
      trial/credit rules, final CTA.
- [x] Fixed a pre-existing bug surfaced by the redesign: `data-kicker`
      eyebrow labels were never rendered (no JS ever read the attribute) —
      now rendered via CSS `attr()`.
- [x] Dev preview hardening: `allowedDevOrigins` for the sandbox preview
      host so proxied dev resources are not cross-origin blocked.
- [x] AdSense architecture untouched and still honest (inert until
      configured + consented). No fake ads, no fake metrics.
- [x] QA: 200/200 tests, typecheck clean, production build green, fresh
      server, live marker/asset/navigation/flow verification (documented
      in LAUNCH_READINESS.md).

### Milestone 12 — Web/mobile integration (IN PROGRESS)

Wire the web app + mobile shell fully to the MASTER API (task center, live
logs, results), deep links, push notifications.

**Chunk 1 — web task center with live execution logs (2026-09-10, DONE):**

- [x] Preview-error triage: React hydration mismatches were caused by the SPA
      bootstrap executing before hydration and mutating the DOM (theme
      attribute, footer year, reveal classes, hero canvas sizing, injected
      pricing cards, a leftover module-level `js` class). The bootstrap now
      waits for the window load event + double rAF (with a 4s safety valve);
      zero module-level DOM mutations remain; `suppressHydrationWarning` on
      `<html>` plus a pre-paint theme snippet (next-themes pattern) remove
      the theme flash. The hero video 404 probe was replaced with a
      server-rendered existence flag (no console noise; requires dev
      restart/rebuild to pick up a newly added video file).
- [x] Task center: dashboard task rows are deep links (`#/tasks/:id`) to a
      full task detail view — status/execution/duration/log counters, result
      payload, error panel, executions, event timeline and an execution log
      console (level-colored, 500-line cap, live counter).
- [x] Live logs: primary WebSocket channel `/ws/executions/:id?token=`
      (same-origin, proxied via a new `/ws/*` rewrite) with automatic SSE
      fallback `/api/executions/:id/events?token=` — the SSE route now also
      accepts the access token as a query parameter (EventSource cannot send
      headers), mirroring the WebSocket auth pattern. Streams close on view
      change. Both channels live-verified through the web port.
- [x] Test-suite hermeticity hardened (real defect found by the suite): the
      billing "no provider configured" path now also clears
      AKBARAL_SEARCH/PAGE_FETCH/ALLOW_PRIVATE_PROVIDER env, so a developer's
      local `.env` fixture wiring can no longer make the honest-failure path
      succeed. Full suite 200/200.

**Chunk 1a — hydration fix completed (2026-09-10):** live preview logs
showed React 19's concurrent/streaming hydration can still be mid-flight
when the window `load` event fires, so the load-gated bootstrap could
mutate the DOM before hydration finished. Final architecture: ALL
React-rendered scripts removed from the layout — the SPA bundle now loads
via `next/script` `afterInteractive` (Next.js injects it only after
hydration completes, making pre-hydration mutations structurally
impossible), server→client flags (hero video, AdSense id) travel as
`<meta>` tags read by the client, the pre-paint theme snippet is gone
(theme applies post-hydration from boot), and `suppressHydrationWarning`
was removed as no longer needed. Design unchanged; 200/200 tests,
typecheck clean, build green; preview verified.

- [x] Hotfix (2026-09-10): the legal/privacy modal blocked the preview —
      the redesign had dropped the old `.modal-scrim[hidden]` display guard,
      so the author `display:grid` rule overrode the `hidden` attribute
      (overlay rendered on every load; the close button set `hidden` but CSS
      ignored it). Fixed with a single global `[hidden] { display: none
      !important; }` rule, restoring native hidden semantics for every
      toggle (modal, auth name field, login/logout buttons, admin nav link).
      No design or content change; tsc + build + live verification green.

**M12 chunk 2 (mobile) — COMPLETE.** The Expo app now carries the same
capability surface as the web client:

- **Task center** (`mobile/src/screens/TasksScreen.tsx`): task list from
  `GET /api/tasks`, full detail (`GET /api/tasks/:id` — task, events,
  executions, logs), output rendering, tappable recent tasks on the
  dashboard.
- **Live logs** (`mobile/src/services/sse.ts`): dependency-free SSE client
  (XMLHttpRequest + incremental `onprogress` parsing, since RN fetch cannot
  stream) consuming the SAME channel as the web task center —
  `GET /api/executions/:id/events?token=` — with dedupe by log id, a
  500-line cap, `● live` indicator, 5s task polling while non-terminal, and
  subscription cleanup on unmount/terminal state.
- **Deep links**: `akbaral://tasks/:id` (scheme already declared in
  `mobile/app.json`); react-navigation `linking` config routes it to the
  Tasks tab detail view; notification taps route through the same path.
- **Push notifications**: `mobile/src/services/push.ts` registers the device
  (permission request → Expo push token → `POST /api/notifications/device`);
  registration failures surface honestly on the dashboard (e.g. iOS
  simulator or missing EAS projectId) instead of being faked; logout
  unregisters (`DELETE /api/notifications/device/:token`).
- **Server side**: migration `0009_mobile_push.sql` (`device_tokens` table),
  `src/push/expo-push.ts` (real Expo push-service dispatch, endpoint
  overridable via `AKBARAL_EXPO_PUSH_URL`, failures logged and reported —
  never faked, never allowed to break task execution), `src/push/notify.ts`
  (in-app notification row + push fan-out on task completion/failure from
  the executor, task reconciler and crash recovery), device registration
  routes (auth + validation + idempotent re-registration + ownership
  transfer on re-login, per-user revocation).
- **Verification**: 206/206 tests (6 new in `src/push/push.test.ts` covering
  auth, validation, persistence, ownership transfer, unregistration,
  completion/failure notifications, push dispatch with deep link, and push-
  endpoint-failure honesty), tsc clean (server + mobile), production build
  green, live end-to-end on the dev stack (device registered → task
  completed → in-app row + push dispatched with `akbaral://tasks/:id`;
  honest failure path with refund message; SSE frames verified; unregister
  → 204/404/revoked).

**Remaining after M12:** none for this milestone — M12 is complete.

**Automation & Scheduled Workflows — COMPLETE.** Real production scheduling
on the existing orchestrator (no parallel system):

- **Schedules** (`src/automation/cron.ts`, `validate.ts`): one-time (`once`),
  recurring cron (strict 5-field subset: `*`, step, single value — no
  ambiguous ranges/lists) and fixed intervals. Timezone handling is real:
  IANA zones via Intl, DST-aware — spring-forward gaps are skipped (Vixie
  semantics), fall-back ambiguity resolves to the first occurrence; naive
  local timestamps are interpreted in the automation's timezone and rejected
  if they do not exist.
- **Engine** (`src/automation/scheduler.ts`): 1s durable tick — fires due
  automations exactly once per occurrence (UNIQUE idempotency key on
  `automation_runs`; restart- and race-safe), advances schedules without
  backfilling missed occurrences, reconciles open runs against the
  authoritative queue/workflow state (this is what makes restarts and crashes
  safe), re-fires jobless runs with a bounded attempt budget, and enforces
  per-automation timeouts via a graceful queue cancellation.
- **Execution**: each occurrence becomes a persisted workflow whose steps are
  the automation's steps (per-step goals chain 1→n through
  `depends_on`) and runs through the existing execution queue — agent
  registry visibility checks, atomic credit reservation, consume-on-success,
  automatic refunds, job retries with exponential backoff (only for transient
  errors), per-job timeout override, cancellation.
- **Conditions**: `last_run_outcome` and `min_interval_since_last_run` gates
  evaluated server-side before firing; unmet conditions skip the occurrence
  with a recorded reason (visible in the run history), never fail it.
- **Resource controls**: credit pre-flight auto-pauses an automation (with a
  notification + audit entry) when the owner has no task credits, instead of
  looping uselessly; manual triggers are cooldown-limited; max 25 active
  automations per account; per-IP rate limits on the router.
- **API** (`src/routes/automations.ts`): full CRUD + pause/resume + manual
  run + run history + run cancellation. Auth on every route, strict
  server-side validation of all input, tenant isolation (cross-user access is
  an indistinguishable 404), audit logging on every state change.
- **Legacy note**: the 0003 CRM `automations` skeleton (trigger_key rows) is
  preserved in the same table behind a cohort filter (`schedule_json IS
  NULL`) — `/api/crm/automations` keeps working untouched and CRM rows are
  invisible to the scheduler.
- **Notifications**: run-level completion/failure/cancellation summaries and
  attention events flow through the M12 system (in-app row + Expo push with
  `akbaral://automations/:id` deep links), in addition to the existing
  per-task notifications from each step.
- **Clients**: new web view (`#/automations`, `#/automations/:id` — create
  form, list, pause/resume/run-now/delete, run history; assets at
  `cinematic-v6`) and mobile AutomationsScreen (behind the Tasks tab; create,
  manage, run history; deep-link routing from push notifications).
- **Migration** `0010_automation.sql`: evolves `automations` (rebuilt to relax
  the legacy trigger_key NOT NULL) + `automation_runs` (UNIQUE idempotency)
  + `workflow_steps.goal`.
- **Verification**: 235/235 tests (11 cron/timezone unit tests + 18
  end-to-end automation integration tests covering the full matrix: scheduled
  fire → agent execution → verified result → notification, failure/refund,
  transient retry recovery, timeout, cancellation, duplicate protection,
  timezone math, auth, tenant isolation, validation, conditions, auto-pause,
  cooldown, crash recovery, per-account caps, CRM cohort isolation),
  tsc clean (server + mobile), production build green, live E2E on the dev
  stack (cron next-run at 04:30Z for 09:30 Karachi; one-shot scheduled fire
  executed through the web-research agent with verified sources; honest
  provider_not_configured failure with refund; mid-flight cancel with refund;
  duplicate occurrence rejected; orphan run recovered and completed; audit
  log entries for every action; push notifications delivered with deep
  links).

**OAuth providers & account linking — COMPLETE.** Real OAuth 2.0 flows,
fully server-side, for Google, GitHub, Microsoft and Apple:

- **Security model** (`src/auth/oauth.ts`): 256-bit `state` stored HASHED
  server-side, single-use (guarded consume), 10-minute TTL, bound to provider
  + mode + user + exact redirect_uri + IP; PKCE S256 everywhere supported;
  client secrets never leave the server. Apple uses a real ES256
  client-secret JWT (APPLE_PRIVATE_KEY) and id_token verification against
  Apple's JWKS through node:crypto.
- **Account resolution with takeover protection**: auto-link by email ONLY
  when the provider asserts the email is verified (Google userinfo
  email_verified, GitHub verified primary email, Apple id_token claim;
  Microsoft Graph exposes no verified assertion — policy treats it as
  unverified). Unverified provider emails never attach to existing password
  accounts; linking an identity owned by another user is a 409 + critical
  security event.
- **Provisioning**: OAuth sign-in creates a real account (password_hash
  NULL — password login stays available once a password is set) with the
  standard trial credits; sessions are the same rotated refresh-token
  sessions as password login.
- **API** (`src/routes/oauth.ts`): GET /providers (honest configured state),
  GET /:provider/authorize (login, 302), POST /:provider/link
  (authenticated link start, returns the consent URL), GET+POST
  /:provider/callback (Apple form_post), GET /identities,
  DELETE /identities/:provider (refuses to remove the last sign-in method).
  Per-IP rate limits on every public route; audit + security logs for all
  events; credentials returned to the SPA only in the URL fragment (never
  query strings or logs).
- **Clients**: web — provider buttons on the sign-in card (only for
  configured providers), `#/oauth/callback` fragment handler, Settings →
  Connected accounts (list/link/unlink with lockout protection; assets
  `cinematic-v7`); mobile — provider buttons on the login screen via the
  system browser.
- **Migration** `0011_oauth_identities.sql`: `oauth_identities` (UNIQUE
  provider identity → one user) + `oauth_states` (hashed, single-use).
- **Providers configured?** None in this deployment — all four are
  implemented for real but report `configured: false` until their
  credentials exist (GOOGLE_CLIENT_ID/SECRET, GITHUB_*, MS_*, APPLE_* +
  key). The machinery is verified end-to-end by 18 integration tests
  against a spec-accurate local OAuth fixture (real ES256 keys, JWKS, PKCE
  verification, per-provider profile shapes) plus live E2E.
- **Verification**: 253/253 tests, tsc clean (server + mobile), production
  build green, live E2E on the dev stack (full login → provisioning →
  session → refresh rotation → old token death; positive link; conflict
  refusal with critical security log; invalid state; provider error;
  unauthenticated 401s; unconfigured 503; unlink 204).

---

## Milestone 11 — Unified AKBARAL! Design System (COMPLETE)

**One visual identity across website, Android app and the future iOS app.**
Obsidian foundation · indigo/violet atmosphere · premium glass · cinematic
lighting · technical elegance. "One Intelligence. Every Solution."

- **Single source of truth**: `design-system/tokens.json` + zero-dependency
  compiler `node design-system/build.mjs` generating three committed
  consumers — `public/tokens.css` (web), `mobile/src/theme.ts` (Android),
  `design-system/ios/AKBARALTheme.swift` (future iOS; tokens only, no fake
  app). `design-system/README.md` documents the full contract (colors,
  typography, spacing, radii, glass, status language, agent identity,
  iconography, motion, responsive rules).
- **Website**: all hand-written tokens replaced by the generated
  `tokens.css` (linked before `styles.css`; assets `akbaral-ds-1`). Full
  palette migration from the warm gold/olive system to obsidian +
  indigo/violet: buttons (indigo→violet gradient primary), glows, hero
  (veil/vignette/outline type), auth atmosphere, agent-world/factory/
  pipeline/pricing/CTA sections, scrollbar, selection, focus rings.
  Hero canvas network re-tinted (indigo links, violet/silver nodes); new
  original AI-generated obsidian/indigo hero poster. New **Automation**
  landing chapter (rail item 04; cron/interval/one-shot chips, 5-node run
  lifecycle chain — all real engine behavior). Agent cards gained the
  shared **agent sigil** (deterministic indigo→violet monogram; identical
  formula on every platform — verified identical output web vs mobile).
- **Android (native mobile UX, same identity)**: `mobile/src/theme.ts`
  regenerated from tokens; `ui.tsx` rebuilt as the shared component
  library (gradient primary buttons with glow, sheened cards, pulsing
  status dots/badges, shimmer skeletons, agent sigils, branded boot,
  reduce-motion-aware `FadeIn`/`StatusDot`/`Skeleton` via
  `AccessibilityInfo`). All 9 screens migrated + elevated: every screen
  inherits the obsidian canvas + top indigo atmosphere (`ScreenShell`);
  Agents/Tasks/Automations/Billing load with skeleton shimmer; Agents
  rows show agent sigils; Dashboard opens with brand row + cinematic
  entrance; Login gets full atmosphere gradient + staged entrance;
  MASTER orb respects reduce-motion. `expo-linear-gradient` added (real
  Expo module). Splash/adaptive-icon aligned to obsidian `#06070f`.
- **Status language unified** (identical mapping web + mobile + iOS):
  running/live → pulsing cyan telemetry; queued/pending/planned/retrying →
  amber; completed/active/enabled → green; failed/blocked/disabled → red;
  cancelled/paused/idle → neutral.
- **Verification**: 253/253 tests, server tsc clean, mobile tsc clean,
  production build green, live stack verified (tokens.css served, head
  link order correct, automation section + rail, login/me/agents(4,001)/
  oauth providers functional, server log clean), sigil formula parity
  proven across platforms. No functional changes to any API, flow or
  test; all existing production functionality preserved.

---

## Milestone 12 — Complete cinematic transformation (COMPLETE)

World-class luxury presentation across the website and the Android app:
real cinematic hero film, premium loading identity, full storytelling
journey, and the public pricing model moved to USD.

- **Real cinematic hero video**: `public/media/hero-loop.mp4` — 100%
  original, procedurally rendered footage (obsidian space, indigo/violet
  nebula, 3D agent constellation with data pulses, breathing core orbs,
  horizon band, vignette; 1920×1080/30fps/12s seamless loop, H.264
  +faststart, ~272 KB). No stock footage, no licensing questions, no fake
  URLs. Poster extracted from the film itself. Player: autoplay muted
  looped inline, poster = loading state, cross-dissolve on `canplay`,
  graceful fallback to the canvas network on error/save-data/reduced
  motion; 206 range requests verified for iOS.
- **Premium loading experience**: one boot identity on every surface —
  web `#boot-veil` (monogram, ring pulses, wordmark, light sweep;
  aria-hidden, pointer-events:none, CSS safety dismissal without JS,
  reduced-motion aware) and Android `BootVisual` (same choreography,
  crossfades over the pre-rendered UI — no white flash, no layout jump)
  plus a branded native splash image in app.json on the same obsidian
  canvas.
- **Cinematic storytelling journey** (12 chapters, 01–11 + CTA):
  Intelligence manifesto (giant gradient typography + facts band) →
  Master Orchestrator (pipeline with glowing progress head) → Agent
  World → Thousands of Specialists (editorial discipline index with real
  registry counts) → Agent Factory → Real Task Execution → Automation →
  AI Employees (split layout, honest example roles) → Workspace →
  Security & Verification → Pricing → Final CTA. Chapter watermark
  numerals, gradient emphasis text, refined hover states, no
  repeated-card-grid monotony.
- **Pricing → USD**: plan catalog re-priced ($0 / $50 Pro / $400
  Enterprise, USD cents), currency flows from the model instead of
  hardcoded PKR (billing service, providers incl. Stripe `usd`, invoice
  PDF `$` formatting, marketplace publish/install, CRM deals, registry
  seed, stripe tool default); migration `0012_currency_usd.sql`; web
  (plans, invoices, marketplace cards, admin revenue/cost stats, USD
  labels + quick-amount chips $10/$50/$90/$200/$400) and mobile
  (plan cards, top-up field) updated; historical invoices keep their
  original PKR label (they were PKR orders — nothing is misstated).
- **Android luxury pass**: premium BootScreen, MASTER orchestration flow
  strip (Goal→Plan→Agents→Tools→Verify→Result with live pulsing stages —
  a representation of the real pipeline, no fabricated progress), agent
  cards with category kickers + sigils, USD billing.
- **Verification**: 254/254 tests (incl. new USD plan-catalog test),
  server tsc clean, mobile tsc clean, production build green, live stack
  verified (video 200 + 206 range + poster, boot veil, 12-chapter
  journey in order, USD plans/order flow, agents 4,001, OAuth providers,
  clean server log), overflow audit clean at 320–1920px, reduced-motion
  settled. No functional changes to any flow; all production
  functionality preserved.

---

## Milestone 13 — Final luxury visual pass + complete pricing architecture (COMPLETE)

The final visual quality pass over the entire ecosystem, on top of f7f2876.

- **Complete pricing architecture (USD)**: the six-tier public catalog —
  Free Trial $0 · Starter $10 · Professional $50 · Business $90 ·
  Scale $200 · Enterprise $400 — with honest per-tier credit/agent/
  workspace/seat allocations, plus the custom manual credit purchase
  path ($10/$50/$90/$200/$400 quick amounts). 'pro' keeps its key
  (existing subscriptions stay valid) and is publicly renamed
  "Professional". Migration `0013_pricing_tiers.sql` (idempotent
  upserts, all rows USD); `ensureBootstrapPlans` seeds all six on
  fresh databases; new six-tier catalog integration test.
- **Web visual language refinements**: editorial typography hierarchy
  (display/headline uppercase scale with tighter tracking, refined
  body rhythm), restrained premium navigation (tracked micro labels,
  quieter inactive states, taller header), restrained button glow,
  hero film fully integrated into the composition (top/bottom mask,
  side bleed into the canvas, scale framing) instead of a video box.
- **MASTER pipeline**: now represents the full real architecture with
  the Agent Router stage — Goal → Understanding → Planner → Master
  Orchestrator → Agent Router → Specialist Agents → Tools → Execution
  → Verification → Result (10 stages, glowing progress spine).
- **Security chapter**: trust-card grid replaced by an architectural
  control ledger (SEC-01..SEC-12, mono indices, hairline rows) —
  restrained, technical, only real implemented controls.
- **Agent World**: cards carry a category kicker (mono, telemetry)
  above the name + shared sigils; automation rows show schedule-kind
  chips (CRON/INTERVAL/ONCE); Agent Factory form reads as a spec
  sheet (SPEC header tag).
- **Pricing UI**: six premium tier cards (tier rail, large USD price,
  description, spec grid, restrained CTA; Professional featured with
  "Most chosen" flag) — responsive 3/2/1 columns.
- **Android alignment**: uppercase tracked header titles and tab
  labels, billing plan cards show seats + "Most chosen" featured
  flag; all six tiers render from the live API.
- **Verification**: 254/254 tests (six-tier catalog test included),
  server tsc, mobile tsc, production build, node --check all green;
  live sweep: 6 USD plans sorted $0-$400, manual $10 order pending,
  login/me/agents 4,001/master plan/tasks/automations/workspace/
  billing account/OAuth providers all 200, hero video 200 + 206
  range + poster, boot veil, 11 chapters, 10 pipeline stages, 12
  control ledger rows, zero PKR in served pages, zero errors in the
  server log, zero 4-digit fixed widths.

---

## Milestone 13.1 — Safe animated execution-simulation console (COMPLETE)

The black panel under the landing page's user goal ("Build me a complete
launch strategy for my business") is now a premium AI execution-simulation
console — a visual, cinematic representation of a MASTER run.

- **100% inert by construction**: every displayed line is a plain string
  from a hardcoded local snippet library (agents, tools, domains, markets),
  attached exclusively via `textContent`. No eval / new Function / dynamic
  import / innerHTML / network / storage / cookies / secrets; no
  connection to auth, database, payments or the real orchestrator; writes
  confined to its own container. Clearly badged "SIMULATION ·
  PRESENTATION ONLY" and it fabricates no business results — it shows the
  SHAPE of a run (understand → plan → route → research → synthesize →
  verify), ending with "the real pipeline runs in your workspace".
- **Premium motion**: character typing with humanized jitter + whole log
  lines fading in + automatic upward stream scroll (inside its own
  container), blinking block caret, phase status bar with pulsing
  telemetry dot, restrained indigo/violet/telemetry accents on obsidian.
- **Randomized per load and per loop** (verified: 5/5 distinct scripts);
  DOM capped at 48 lines; pauses off-screen (IntersectionObserver), on
  hidden tabs, and on route changes; stale timer chains invalidated by
  generation counter. Reduced motion renders a static snapshot (no loop).
- **Responsive**: 300px stream desktop → 216px + smaller type on mobile;
  `pre-wrap + overflow-wrap: anywhere` → zero horizontal overflow at
  320–1920px. A11y: console `role="region"` + aria-label; the animated
  stream is `aria-hidden` (decorative).
- **Verification**: security audit (zero forbidden patterns in the module,
  all DOM writes confined), engine executed in a Node harness (crash-free,
  all-strings, randomized), 254/254 tests, server + mobile tsc, production
  build, `node --check`, live markup/asset checks, clean server log.
  Assets `akbaral-lux-3`.

### M14 — LUX-4 quiet-luxury visual identity (2026-09-11)

A full replacement of the visual language across web and Android, per the
24-point brief:

- **Palette**: neutral obsidian surfaces (`#050506 → #17171d`, no blue
  tint), muted silver lines, restrained indigo/violet accent
  (`#7378e8/#9790f2`), soft-telemetry cyan, and a new **ivory primary
  action** (`#ececee` gradient, dark label) that inverts in light theme.
  No neon, no glassmorphism-heavy look, no gamer aesthetics.
- **Typography**: Sora display + Inter text + Space Grotesk Mono
  technical; sharper radius system (4/8/12/18) for an architectural feel.
- **Navbar rebuilt**: one aligned row — wordmark · landing set
  (Platform/Agents/Security/Pricing) while signed out · app set
  (Dashboard/MASTER/Agents/Workspace/Automations/Billing + More
  dropdown: Factory/Marketplace/CRM/Settings/Admin) while signed in ·
  theme/credits/log in/Start Building. Premium compact dropdown with
  flattened sub-items ≤1023px; nav compression 1024–1280px; no wrap
  disasters 320→ultrawide.
- **Hero recentered**: center-weighted cinematic composition, larger
  display scale (up to 7rem), centered actions/meta, center-focused
  veil. Hero video untouched (kept exactly as committed).
- **Buttons/cards/forms**: ivory primary buttons web + Android, quieter
  hovers (-1px lift, soft shadows), neutral editorial eyebrows,
  obsidian form fields, architectural radii everywhere.
- **Android**: same tokens regenerated (theme.ts + iOS Swift theme),
  ivory primary button with dark label, old hardcoded atmospheres
  swept to the new palette, notification color aligned.
- Design-system version 2.0.0; assets `akbaral-lux-4`.

---

## Verification protocol (every milestone)

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. Live API endpoint verification against the running server
5. Commit with an exact description of what is genuinely implemented
