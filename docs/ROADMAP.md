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

### Milestone 3 — Agent execution/runtime (stage 1 DONE)

- [x] Crash recovery (`src/orchestrator/recovery.ts`): boot-time
      reconciliation fails non-terminal workflows/steps/tasks/executions
      with an honest "interrupted by server restart" error and refunds every
      reserved task credit exactly once (idempotent). Verified live with a
      simulated crash: boot logged "1 workflow(s), 1 task(s), 1 execution(s)
      marked failed; 1 credit(s) refunded"; ledger shows consume then refund;
      account restored to 5/5.
- [ ] Persistent execution queue (survives restarts), worker concurrency
      limits, retries with backoff, timeout enforcement, cancellation,
      execution metrics.

### Milestone 3 — Agent execution/runtime (PLANNED)

Persistent execution queue (survives restarts), worker concurrency limits,
retries with backoff, timeout enforcement, cancellation, execution metrics.

### Milestone 4 — Tool/API/provider abstraction + model router (PLANNED)

Expand tool catalog behind the permission boundary, per-tool credential status
API, streaming model output, provider health checks, cost dashboards.

### Milestone 5 — Workspace/project/files (PLANNED)

Project-scoped workspaces, file attachments on tasks, knowledge indexing per
project, artifact storage of agent outputs.

### Milestone 6 — Agent Factory (PLANNED)

Custom agent creation from user specs (exists in v0): extend with template
derivation from the 4,000-agent matrix, sandboxed benchmark runs, publishing
pipeline to marketplace.

### Milestone 7 — Agent World + Marketplace (PLANNED)

Agent World discovery surface, marketplace install/save/rate flows, featured/
trending ranking with real usage signals.

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
