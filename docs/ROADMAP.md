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

### Milestone 8 — Trial/credits/billing (PLANNED)

Payment provider integrations (Stripe/Razorpay) behind the existing honest
`provider_not_configured` paths, subscription lifecycle, invoice PDFs, usage
statements. Trust policy (30 days + 5 free tasks, refund-on-failure,
atomic server-side credits) is already enforced and must stay regression-free.

### Milestone 9 — Automation / AI Employees (PLANNED)

Scheduled/recurring workflows, trigger system (webhook/time/event), long-lived
"AI employee" agent configurations with budgets and guardrails.

### Milestone 10 — Security/RBAC/audit/rate limits (PLANNED)

Role hierarchy beyond user/admin, per-route permission matrix, audit search
API, adaptive rate limits, secret rotation tooling.

### Milestone 11 — Admin/monitoring/evaluation (PLANNED)

Admin console APIs for registry/model/cost/execution metrics, agent evaluation
harness running `evaluationConfig` suites, drift reports.

### Milestone 12 — Production deployment/scaling (PLANNED)

Docker hardening (base exists), horizontal-scale DB story, health/readiness
probes, backup/restore, zero-downtime migration policy.

### Milestone 13 — Web/mobile integration readiness (PLANNED)

Wire the web app + mobile shell fully to the MASTER API (task center, live
logs, results), deep links, push notifications.

---

## Verification protocol (every milestone)

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. Live API endpoint verification against the running server
5. Commit with an exact description of what is genuinely implemented
