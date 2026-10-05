# AKBARAL! — arena.ai Parity Audit + Implementable Subset Plan
**Date:** 2026-10-05 · **Mode:** READ-ONLY AUDIT (no code, backend, UI, or env changes) · **Repo HEAD:** `f97c59f` (main)

> AKBARAL! is a separate product. Nothing here proposes forking arena.ai, copying its text, assets, logos, or model names. Only *capability categories* are compared.
> Mission ZA141251SA is explicitly out of scope.

---

## STEP 1 — External inventory (arena.ai, verifiable facts only)

**Fetch status: OK** (4 pages retrieved and parsed).

| # | Source page | Verifiable facts observed |
|---|---|---|
| A1 | `https://arena.ai/` | Top nav = **New Chat** (`/chat`), **Leaderboard** (`/leaderboard`), **Search** (`/history/search`). Mode switch **Chat** ("Ask the latest models anything") vs **Work** ("Let agents get work done for you"). Starter-prompt tiles: Create a landing page · Build a dashboard · Make a game · Design to Code (upload an image and have AI build it) · Build a fullstack app · Launch a storefront. Persistent disclosure banner: inputs processed by third-party AI, responses may be inaccurate, conversations disclosed to providers/publicly, opt-out via privacy email. reCAPTCHA on the entry surface. |
| A2 | `https://arena.ai/leaderboard` | Public ranked leaderboards segmented by category: Best Overall Agents, Best Coding Agents, Best WebDev Models, Best Agents for Work, Best Text Models, Best Image Generation, Best Video Generation. Per-model win-rate %. **Live Agent Sessions** feed showing per-session activity states ("Session complete", "Searching the web", "Running bash"). **Pareto Frontier** view with **$ cost per task** per model (e.g. $4.99/task … $0.04/task). Log-In entry point; Terms of Use / Privacy Policy / Cookies links. Blog + "Model Capabilities" video sections. |
| A3 | `https://arena.ai/blog/agent-mode/` (official product post) | Agent Mode = autonomous multi-step planning from one prompt. Built-in tool suite named explicitly: **web search, image generation, coding/technical assistance, file attachments, sandbox/bash environment**. Positioned against single-shot chat. Task mix published (coding 29%, research 11%, planning 11%, workflow automation ~4%). Agent traces feed a public agent leaderboard. |
| A4 | `https://arena.ai/agent` | Agent Mode surface. Feature badge: **"Connect your GitHub" (NEW)** with a Connect action. Same New Chat / Leaderboard / Search nav. |
| A5 | `https://arena.ai/pricing` | **404 — no public pricing page exists.** Login-gated product; no published tier table to compare against. |

**Derived arena.ai feature set (11 items):** F1 Chat · F2 Work/Agent mode · F3 Built-in tool suite (search, page fetch, image gen, code, bash sandbox) · F4 File attachments as model context · F5 Conversation history + history search · F6 Starter-prompt templates · F7 Model picker across many providers · F8 Public leaderboard / model comparison · F9 Live session activity feed (per-step status) · F10 GitHub connect for coding agents · F11 Per-task cost transparency · (F12 Auth/login, F13 Legal/consent disclosure).

---

## STEP 2 — Internal inventory (AKBARAL ground truth)

### 2.1 Pages / routes (Next.js App Router)
Workspace: `/chat` `src/app/chat/page.tsx` · `/work` `src/app/work/page.tsx` · `/workspace` · `/master` · `/projects` · `/files` · `/images` · `/agents` · `/automations` · `/dashboard` · `/billing` · `/pricing` · `/settings` · `/help` · `/admin` · `/owner` · `/signin` · `/signup` · landing `src/app/page.tsx`.
Public group `src/app/(public)/`: about, agent-factory, contact, documentation, faq, features, feedback, privacy, security, terms.
Shell + nav: `src/app/_components/app-shell.tsx:25-42` (NAV_ITEMS / OTHER_NAV_ITEMS), `:170-197` (sidebar render). Chat/Work UI: `src/app/_components/workbench/workbench-shell.tsx` (chat thread `:282`, composer dock `:286`).

### 2.2 API surface (Express, mounted in `src/app.ts:151-231`)
| Capability | Mount | Key endpoints (file:line) |
|---|---|---|
| Chat | `/api/chat` | `GET /` list conversations `src/routes/chat.ts:51`; `GET /:id` full transcript `:66`; `DELETE /:id` `:90`; `POST /stream` SSE + persistence `:98` |
| Work / task | `/api/master`, `/api/tasks`, `/api/workflows` | `GET /:id/events` SSE `src/routes/master.ts:109`; `GET /:id/export` ZIP `:162`; `GET /:id` `:179`; research task `src/routes/tasks.ts:40`; cancel `:82`; task files `:102-130`; workflow list/cancel `src/routes/workflows.ts:16,107` |
| Agents | `/api/agents`, `/api/factory` | `src/routes/agents.ts:12,19,29,41`; factory templates/versions/rollback `src/routes/factory.ts:27-192` |
| Files | `/api` (files router) | upload `src/routes/files.ts:11`; download `:42`; knowledge index `:56`; knowledge search `:85-87` |
| Projects / artifacts | `/api/projects` | list/create `src/routes/projects.ts:50,54`; artifacts CRUD + versions + revert + download `:215-380` |
| Images | — | no dedicated user image route; `/images` page filters image MIME from project files (`src/app/_components/data-surfaces.tsx:150-154`). `image_render` tool (DALL·E-3) exists at `src/tools/registry.ts:251-261` |
| Automations | `/api/automations` | list/get/pause/resume/delete/run/cancel/runs `src/routes/automations.ts:94-276` |
| Billing | `/api/billing` | plans `src/routes/billing.ts:17`; capabilities `:26`; account `:32`; switch `:47`; usage `:123`; invoice PDF `:134`; webhook `:224` |
| Auth | `/api/auth`, `/api/auth/oauth` | register/login/refresh/logout/verify-email `src/routes/auth.ts:26-231`; OAuth providers/callback/identities `src/routes/oauth.ts:91-226` |
| Models | `/api/models` | catalog + provider config + per-model `available` + `requiredEnvKey` `src/routes/models.ts:27-60` |
| Tools | `/api/tools` | implemented-tool list + credential status `src/routes/tools.ts:13,30,84` |
| Realtime | `/api/realtime` | execution event SSE `src/routes/realtime.ts:32` |
| Admin / owner / economy / workforce / marketplace / world / CRM / trust / notifications | various | `src/routes/admin.ts`, `owner.ts`, `economy.ts`, `workforce.ts`, `marketplace.ts`, `world.ts`, `crm.ts`, `trust.ts`, `notifications.ts` |

### 2.3 Data layer
24 SQL migrations in `db/migrations/` — notably `0023_chat_history.sql` (chat_conversations / chat_messages), `0016_artifacts_transfers.sql`, `0010_automation.sql`, `0011_oauth_identities.sql`, `0013_pricing_tiers.sql`, `0008_billing_hardening.sql`, `0006_execution_queue.sql`.

### 2.4 Integrations / modules / env
Models: `src/models/catalog.ts` — providers `omniroute, openai, anthropic, google` and models incl. `gpt-6-astra:223`, `claude-sonnet-4-6:247`, `gemini-3.8-flash:268`, `gemini-3.5-flash:283`, `gemini-3.1-flash-lite:298`, `dall-e-3:313`, plus `qwen3-coder-plus`, `deepseek-v3`, `llama-4-scout`, `kimi-k2`, `gpt-4o(-mini)`. Router/retry/hardening: `src/models/router.ts`, `retry.ts`, `omniroute.ts`.
Tools implemented (`src/tools/registry.ts`): `web_search`, `page_fetch`, `code_repository_read`, `image_render`, `knowledge_search`, `file_parse_text`, `csv_parse`, `excel_build`, `json_transform`, `text_analyze`, `http_request`, plus credential-gated `stripe_payment`, `twilio_message`, `x_post`, `instagram_publish`, `youtube_publish`, `shopify_product`, `maps_place`.
Search providers: `src/agents/search-providers.ts`, research: `src/agents/web-research.ts`. Email: `src/integrations/smtp.ts`. Billing providers: `src/billing/providers.ts`, `stripe.ts`, `capability-detection.ts` (Stripe + Razorpay readiness detection).
Env (from `src/config`): `DATABASE_URL`, `DATA_DIR`, `SESSION_SECRET(+_PREVIOUS)`, `CORS_ORIGINS`, `TRUST_PROXY`, `OMNIROUTE_*`, `AKBARAL_SEARCH_PROVIDER/ENDPOINT`, `AKBARAL_PAGE_FETCH_ENDPOINT`, `AKBARAL_UPLOAD_DIR`, `AKBARAL_PUBLIC_WEB_URL`, `AKBARAL_MARKETPLACE_COMMISSION_BPS`, `AKBARAL_ALLOW_PRIVATE_PROVIDER`, `ZA141251SA_*` (mission, out of scope).
Scripts: 40+ in `package.json` incl. `audit:responsive`, `scan:secrets`, `launch:check`, `verify:*`, `smoke:*`, `test:visual` (Playwright + axe at `tests/visual/workbench.accessibility.spec.ts`).

---

## STEP 3 — GAP TABLE

| # | arena.ai feature | Verdict | AKBARAL evidence / what is missing |
|---|---|---|---|
| F1 | Chat with frontier models (streaming) | **COVERED** | `/chat` → `POST /api/chat/stream` SSE with server-side persistence, `src/routes/chat.ts:98`; honest `provider_not_configured` instead of fake completions. |
| F2 | Work / Agent mode (one prompt → multi-step plan) | **COVERED** | `/work` → `POST /api/master` + staged SSE `src/routes/master.ts:109`, 6 visible stages, sandboxed artifact iframe, ZIP export `:162`, credit refund on failure. |
| F3 | Built-in tool suite (search, fetch, image gen, code read) | **PARTIAL** | 18 tools implemented (`src/tools/registry.ts`) and credential-gated honestly; **missing: the end user cannot see which tools ran during a task, and there is no bash/sandbox execution tool** (only `sandbox/github-bounty` scaffolding, no user-facing runtime). |
| F4 | File attachments used as model context | **PARTIAL (honesty risk)** | Work passes `attachment_file_ids` to `/api/master`. **Chat does not**: `src/routes/chat.ts` contains zero attachment handling, yet the Chat composer shows an "Upload image" button (`workbench-shell.tsx`). The file is stored in the project but never reaches the model — the UI implies a capability the backend does not provide. |
| F5 | Conversation history + history search | **PARTIAL** | Backend is complete and per-user scoped (`chat.ts:51/66/90`, migration `0023_chat_history.sql`) but **no UI consumes it** — no `/api/chat` call exists anywhere in `src/app/**`. No resume, no rename, no delete, no search endpoint (`GET /` is list-only, LIMIT 100). |
| F6 | Starter-prompt templates on entry | **PARTIAL** | Landing shows static capability chips (`src/app/_components/landing-reset.tsx:67`) that are labels only; the Chat/Work composers have **no** clickable starter prompts. |
| F7 | Multi-provider model picker | **PARTIAL** | `/api/models` returns the full catalog with real `available` + `requiredEnvKey` flags, but the Chat UI hard-filters to Google/Gemini only (`workbench-shell.tsx` models filter), hiding configured OpenAI/Anthropic/OmniRoute models. Work mode exposes no picker at all. |
| F8 | Public leaderboard / model ranking / A-B voting | **DEFER** | No ranking, voting, or benchmark-aggregation subsystem exists. Requires an evaluation corpus, vote integrity, and public-data policy — a different product category from AKBARAL's SaaS positioning. |
| F9 | Live session activity feed ("Running bash", "Searching the web") | **PARTIAL** | Per-execution SSE exists (`src/routes/realtime.ts:32`, `master.ts:109`) and stages render, but events are coarse (6 fixed stages); no per-tool-call step log surfaced to the user. |
| F10 | GitHub connect for coding agents | **GAP (owner decision)** | No GitHub OAuth app, no repo scopes, no PR/push pipeline. `code_repository_read` reads local paths only (`src/tools/registry.ts:179`). Owner must decide: register a GitHub OAuth app + host a callback + accept repo-write liability, or skip. |
| F11 | Per-task cost transparency ($ per task) | **PARTIAL** | Real per-model cost fields exist (`cost_input_per_million_cents`, `cost_output_per_million_cents`, `latency_ms`, `reliability` — `src/routes/models.ts:40-50`) and billing usage is tracked (`billing.ts:123`), but no user-facing per-task cost/credit receipt is rendered. |
| F12 | Auth / login (incl. social) | **COVERED** | Email+password with verification (`auth.ts:26-231`) and OAuth identities (`oauth.ts:91-226`). |
| F13 | AI-disclosure / consent banner | **PARTIAL** | Privacy/terms pages exist (`src/app/(public)/privacy`, `/terms`) and chat states "Chat never deducts Work task credits", but there is **no in-product disclosure that inputs are sent to third-party AI providers and may be inaccurate** at the point of input. |
| — | Pricing | **COVERED (AKBARAL ahead)** | arena.ai `/pricing` is 404; AKBARAL ships `/pricing`, `/api/billing/plans`, tiers migration `0013`, invoice PDFs, and provider-readiness detection. |

**Counts (14 rows):** COVERED = 4 (F1, F2, F12, pricing) · PARTIAL = 8 (F3, F4, F5, F6, F7, F9, F11, F13) · GAP (owner decision) = 1 (F10) · DEFER = 1 (F8).

---

## STEP 4 — IMPLEMENTABLE SUBSET (buildable today, no fakes, no new paid infra)

### 1. Chat history rail — resume, rename-free list, delete
- **Why:** the backend already exists and is unused; this is the largest value-per-line item in the repo.
- **Files:** `src/app/_components/workbench/workbench-shell.tsx` (new left rail inside chat column), `src/app/_components/workbench/workbench-shell.module.css`, optional `src/routes/chat.ts` (add `?q=` filter + `GET /api/chat/search`).
- **Surface:** UI rail listing `GET /api/chat` results (title + updated date); click → `GET /api/chat/:id` hydrates the thread and sets `conversationId`; trash → `DELETE /api/chat/:id`. Optional search box → `GET /api/chat?q=`.
- **Honesty guard:** renders only rows the API returns for the authenticated user; empty state says "No saved conversations yet." No placeholder/sample conversations, no client-side invention of titles.
- **Effort:** small (UI-only) / medium (if search endpoint added).
- **Tests:** contract test that the rail calls `/api/chat`, hydrate sets conversationId, delete removes the row; route tests for ownership scoping (404 for a non-owner) and `q` filtering; responsive 320px rail collapse.

### 2. Honest Chat attachments (close the F4 implied-capability gap)
- **Why:** today the Chat "Upload image" button stores a file the model never sees — this is the one place the UI over-promises.
- **Files:** `src/routes/chat.ts` (accept `attachment_file_ids`, resolve via `findProjectFile`, feed through `file_parse_text` / vision-capable model path), `src/models/catalog.ts` capability check, `workbench-shell.tsx` (disable upload + explain when the selected model lacks vision).
- **Surface:** `POST /api/chat/stream` gains optional `attachment_file_ids: string[]`; rejects ids not owned by the caller with 404; emits an SSE `attachment` event naming what was actually included.
- **Honesty guard:** if the active model has no vision/file capability, the composer disables upload with the real reason instead of silently dropping the file. Zero OCR/description fabrication.
- **Effort:** medium.
- **Tests:** ownership rejection, capability gating, SSE event contract, UI disabled-state test.

### 3. Real tool-activity log on Work tasks (AKBARAL's version of the "live session" feed)
- **Why:** F9/F3 — users cannot see what the agent actually did; the event stream already carries the data.
- **Files:** `src/routes/master.ts` / `src/routes/realtime.ts` (emit per-tool-call events: tool key, started/ok/failed, duration), `workbench-shell.tsx` (step list under the stages), module CSS.
- **Surface:** SSE event `{type:'tool', key, status, ms}`; UI renders an append-only list "web_search · ok · 1.2s".
- **Honesty guard:** entries are emitted by the executor only when a tool genuinely runs; failures render as failures (`provider_not_configured` shown verbatim), never hidden or retried silently in the UI.
- **Effort:** medium.
- **Tests:** executor emits one event per tool invocation; failed tool renders failed; no events when no tool runs.

### 4. Truthful model picker (all configured providers, with cost + availability)
- **Why:** F7/F11 — the catalog, availability flags, and cost fields already exist; the UI hides them.
- **Files:** `workbench-shell.tsx` (drop the Gemini-only filter, keep `available === true`), add a Work-mode picker, show `$/M tokens` + latency from `/api/models`.
- **Surface:** grouped `<select>` by provider; unavailable models listed in a disabled group with the real `requiredEnvKey` reason.
- **Honesty guard:** availability comes from `modelAvailable()` server-side; nothing is listed as usable without a configured credential; costs printed from catalog values, never estimated.
- **Effort:** small.
- **Tests:** only `available` models are selectable; disabled group shows requiredEnvKey; selected model is the one sent to `/api/chat/stream`.

### 5. Starter prompts + point-of-input AI disclosure
- **Why:** F6/F13 — measurable activation lift and a compliance improvement, both zero-infra.
- **Files:** `workbench-shell.tsx` (clickable starter chips above the thread when `messages.length === 0`; one-line disclosure under the composer), module CSS, `src/app/(public)/privacy` link.
- **Surface:** 6 AKBARAL-authored starter prompts (own wording, not arena's) that prefill the composer; disclosure line: inputs are sent to the configured AI provider and output may be inaccurate, linking `/privacy`.
- **Honesty guard:** chips only prefill text — they never claim a capability the tools do not have; the disclosure names the real provider of the selected model.
- **Effort:** small.
- **Tests:** chips render only on an empty thread and prefill exactly; disclosure present in DOM on chat and work; WCAG AA + ≥44px + 320px no-overflow assertions.

**Deliberately excluded:** GitHub connect (F10 — owner decision + OAuth app), bash/sandbox runtime (needs isolated container infra and a security review), public leaderboard/voting (F8 — different product).

---

## STEP 5 — STOP
No code was changed in this run. The only file written is this audit document. Awaiting owner selection of 1–3 subset items before implementation.
