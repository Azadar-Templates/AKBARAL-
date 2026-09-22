# OmniRoute FINAL API / PROVIDER INVENTORY — 2026-09-22

Brand: AKBARAL! — One Intelligence. Every Solution.
Mission: Universal AI platform, MASTER orchestrator, 4,001+ specialist agents.
Owner mission: ZA141251SA private, isolated.

This doc is the 8-section inventory required after OmniRoute Phases 2-5 implementation.
OmniRoute private sidecar: 127.0.0.1:20128 only, never public, honest telemetry.

---

## 1) Total providers via OmniRoute

- **Upstream claimed by OmniRoute v3.8.51 README**: 359 providers, 1312 models, 152 free in catalog, 19 routing strategies (auto cheapest viable, fallback, latency-aware, cost-aware, etc).
- **In AKBARAL! catalog (src/models/catalog.ts)**: 4 provider specs (omniroute, openai, anthropic, google) + 10 model specs:
  - `auto` (OmniRoute Auto — cheapest viable, default, quota-aware fallback) — primary when OMNIROUTE_ENABLED=1 + key present
  - `qwen3-coder-plus` (via OmniRoute free), `deepseek-v3`, `llama-4-scout` (Groq free path), `kimi-k2` (free)
  - Direct: `gpt-4o`, `gpt-4o-mini` (OpenAI), `c3.5-sonnet` (Anthropic), `gemini-3.8-flash` (default Google), `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `dall-e-3`
- **Total routable when OmniRoute configured**: up to 359 upstream via gateway + 3 direct providers as fallback. Direct never removed.
- **Free tier reality**: OmniRoute headline 1.62B tokens/mo is theoretical aggregate of documented tiers, not guaranteed. Re-audited biweekly, moves both ways. Providers can change ToS without notice, some prohibit proxy usage.

---

## 2) Required APIs / keys for production (honest)

Minimum to run production honestly (no fake):

- **DATABASE_URL**: required but has zero-config default `file:./data/akbaral.db` (SQLite). Postgres `postgres://` optional for production (Neon).
- **SESSION_SECRET**: required in production, >=32 chars, random. Dev/test auto-generated.
- **At least ONE LLM provider for MASTER/agents**:
  - `GOOGLE_API_KEY` **recommended** — free tier, no card, generous, powers Gemini 3.8 Flash default + Places. Honest provider_not_configured error until set.
  - OR `OPENAI_API_KEY` (paid, card required beyond trial)
  - OR `ANTHROPIC_API_KEY` (paid)
  - OR `OMNIROUTE_API_KEY` **when sidecar enabled** — generated locally when self-hosting OmniRoute gateway, stored encrypted in mission vault, never returned. Optional but enables auto-fallback/quota/cost controls.
- **Truth**: Platform boots with 0 LLM keys — every LLM call then fails with `provider_not_configured` listing required env names. No fabricated output.

So required count: **1 DATABASE_URL (default) + 1 SESSION_SECRET (prod) + 1 LLM key (GOOGLE_API_KEY free recommended)** = 3 env vars, but only 1 external account (Google AI) for minimal prod.

---

## 3) Optional APIs / keys

All optional — feature returns `provider_not_configured` + required var name when unset, never fakes:

- **OmniRoute tuning (optional, only when gateway enabled)**:
  - `OMNIROUTE_BASE_URL` default `http://127.0.0.1:20128/v1` (private only, must be 127.0.0.1 unless `AKBARAL_ALLOW_PRIVATE_PROVIDER=1`)
  - `OMNIROUTE_ENABLED` `0|1` — auto-enabled when `OMNIROUTE_API_KEY` present, set 1 to prefer gateway
  - `OMNIROUTE_DAILY_TOKEN_BUDGET` default 100000
  - `OMNIROUTE_MONTHLY_COST_CENTS` default 500 ($5)
  - `OMNIROUTE_RATE_LIMIT_RPM` default 10
  - `OMNIROUTE_MODEL_AUTO` default `auto` (cheapest viable) — can be `qwen3-coder-plus`, `deepseek-v3`, `llama-4-scout`, `kimi-k2`, etc.

- **Direct LLM (fallback)**:
  - `OPENAI_API_KEY`, `OPENAI_BASE_URL` (enterprise proxy)
  - `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`
  - `GOOGLE_API_KEY`, `GOOGLE_BASE_URL`

- **Search / fetch (optional)**:
  - `AKBARAL_SEARCH_PROVIDER` = tavily|brave|serper|google_cse|endpoint|duckduckgo
  - `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID`
  - `AKBARAL_SEARCH_ENDPOINT`, `AKBARAL_PAGE_FETCH_ENDPOINT`

- **Social / publishing (optional, restricted)**:
  - `YOUTUBE_ACCESS_TOKEN`, `YOUTUBE_CLIENT_ID/SECRET`
  - `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_CLIENT_ID/SECRET`
  - `X_BEARER_TOKEN`, `TIKTOK_CLIENT_KEY/SECRET`
  - `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`
  - `TWILIO_ACCOUNT_SID/AUTH_TOKEN`

- **Payments (optional)**:
  - `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_ID/SECRET`, `BILLING_WEBHOOK_SECRET`

- **Email / OAuth (optional)**:
  - `SMTP_HOST/USER/PASSWORD/FROM/PORT/SECURE`
  - `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/KEY_ID/TEAM_ID/PRIVATE_KEY`, `MS_CLIENT_ID/SECRET`

- **Core optional**:
  - `AKBARAL_UPLOAD_DIR`, `AKBARAL_PUBLIC_WEB_URL`, `CORS_ORIGINS`, `TRUST_PROXY`, `AKBARAL_OWNER_EMAIL`, `SESSION_SECRET_PREVIOUS`
  - Execution queue: `AKBARAL_QUEUE_CONCURRENCY`, `AKBARAL_EXECUTION_MAX_ATTEMPTS`, etc.
  - `AKBARAL_ADSENSE_CLIENT` (ads disabled when unset — honest)

---

## 4) Search / browser APIs

- **Search**:
  - Default: keyless DuckDuckGo HTML endpoint — works zero-config, but rate-limited from datacenter IPs.
  - Production recommended: ONE of Tavily, Brave, Serper, Google CSE (configure key, no code change).
  - Optional custom: `AKBARAL_SEARCH_ENDPOINT` compliant JSON search proxy.
  - Status reported via `integrationStatus('search')` with active provider label, never silent degradation — misconfigured explicit provider reports NOT configured with exact env names needed.

- **Page fetch / browser**:
  - Default: direct public fetch with SSRF protection (only public IPs, no private metadata).
  - Optional custom: `AKBARAL_PAGE_FETCH_ENDPOINT` fetch proxy.
  - `AKBARAL_ALLOW_PRIVATE_PROVIDER=1` only for trusted internal search/fetch provider host — private source URLs still rejected.

- **No built-in browser automation** — page_fetch extracts readable content, not headless browser. For browser automation, operator provides external service via HTTP tool (SSRF-guarded).

---

## 5) Email / payment / storage / database requirements

- **Email**: SMTP optional. Without SMTP, password-reset/email-verification returns `devToken` in dev/test, `503 provider_not_configured` in prod (honest). With SMTP: `SMTP_HOST/USER/PASSWORD` required, `SMTP_FROM` optional.

- **Payment**: Stripe/Razorpay optional. Without, custom credit purchase returns `provider_not_configured` + required var name; manual admin settlement remains. Webhook: `BILLING_WEBHOOK_SECRET` required for `/api/billing/webhook` to accept payloads.

- **Storage**: Local filesystem `data/uploads` default (persistent volume mount in Docker). No S3 required. Object storage is a catalog tool `object_storage` — requires provider account + scoped token before use, default-deny.

- **Database**: SQLite file `file:./data/akbaral.db` default — zero config, auto-creates. Postgres `postgres://` optional for prod (Neon). Migration via `npm run db:migrate`. ZA141251SA mission has SEPARATE private DB (`ZA141251SA_DATABASE_URL` file:/data/za141251sa.db or postgres), never referenced by public UI.

- **Mission wallets**: 4,001 agent wallets + 1 treasury, all zero balance initially. Owner funding real, idempotent, never counted as revenue. Payout slots exactly 4, configurable without handing over credentials, verification required.

---

## 6) Free / no-card options

**Forever-free, no account, no card (11 per OmniRoute wiki / reviews)**:
- Pollinations (image + text), Cloudflare AI (limited), some HuggingFace Inference free, etc. — rate-limited 1-10 RPM, best-effort.

**Free tiers requiring account but no card (90+ per OmniRoute catalog)**:
- **Google AI (Gemini)**: free tier, no card, generous (recommended for AKBARAL! MASTER path) — `GOOGLE_API_KEY`
- Groq (Llama, Mixtral): free tier, no card, fast
- Cerebras: free tier, no card
- Qwen (Alibaba): free tier via DashScope
- Together, Fireworks, DeepSeek, OpenRouter free models, etc.
- **Rate limits**: 1-60 RPM, 10K-1M tokens/day depending on provider.
- **Honest note**: Free tier availability not guaranteed, ToS may prohibit proxy/gateway, OmniRoute theoretical 1.62B tokens/mo is aggregate, not per-user guarantee.

**AKBARAL! zero-cost launch path**:
- DB: SQLite file default (0$)
- LLM: Google AI free (0$, no card)
- Search: DuckDuckGo keyless default (0$)
- Page fetch: direct public (0$)
- Storage: local filesystem (0$)
- Hosting: Render free 512MB 750h ephemeral FS, or self-host Docker, etc. (see `docs/ZERO_COST_LAUNCH.md`)
- Total: **$0 upfront personal investment**, free tiers where possible, per user constraint.

---

## 7) Capabilities OmniRoute REPLACES vs does NOT replace

**REPLACES (when enabled, private sidecar)**:
- Manual provider switching — auto picks cheapest viable (`auto` model) across 359 providers
- Fallback chain logic — automatic fallback on failure, circuit breakers
- Quota tracking — per-agent daily token budget, RPM, monthly cost cents (in-memory buckets + telemetry)
- Cost estimation — token compression RTK+Caveman 15-95% saving (claimed), cost per model
- Dashboard telemetry — `http://127.0.0.1:20128/dashboard` (private only), usage, latency, success rate
- Routing strategies — 19 strategies (latency-aware, cost-aware, etc.)
- Model compression — prompt compression, context pruning (OmniRoute feature)
- Embedding gateway — OpenAI-compatible embedding via gateway

**Does NOT replace (must remain)**:
- **Provider account creation** — operator must create legitimate accounts (Google AI, etc.) with real ToS acceptance; OmniRoute does NOT create accounts or bypass KYC
- **ToS compliance** — operator must ensure upstream ToS allows proxy/gateway usage; some providers prohibit it; AKBARAL! notes this honestly
- **Mission wallet economy** — `canAgentSpend`, daily spend, treasury ledger, 4 payout slots verification — authoritative, not gateway
- **Revenue verification** — `mission_revenue` status='received' + verifier + provider/webhook reference only; never fabricated, never simulated, never unverified
- **Payout** — 4 slots, verification expires, owner approval required before money leaves
- **Billing / refund idempotency** — existing logic preserved, not changed
- **RBAC / owner isolation** — `ZA141251SA` mission separate private DB/auth/treasury, never referenced by public UI; production behavior preserved
- **Safety gate / earning pipeline** — disabled scheduler by default, real earnings only
- **$1B/day per agent objective** — preserved: daily_target_cents 100B default, verified revenue today only, remaining gap, progress%, resets UTC, dashboard shows per-agent cards, no guarantee/fabrication (from e13c7f5)
- **Direct provider integrations** — OpenAI, Anthropic, Google remain as fallback, never removed

---

## 8) Exact number credentials / accounts needed

**Minimum for production (honest, no fake)**:

- **1 database**: file `data/akbaral.db` auto-creates (0 accounts) OR 1 Postgres (Neon) account optional
- **1 LLM account**: 1 Google AI account (free, no card) for Gemini — `GOOGLE_API_KEY` — OR 1 OpenAI account OR 1 Anthropic account
- **Total minimal**: **1-2 credentials**: `DATABASE_URL` default + `GOOGLE_API_KEY` (free) + `SESSION_SECRET` (prod). External accounts: **1 (Google AI)**.

**With OmniRoute sidecar (optional but recommended for cost controls)**:

- **1 OmniRoute gateway account**: self-hosted locally, key generated locally (no external account, just `OMNIROUTE_API_KEY` random string stored encrypted in vault)
- **1-3 upstream provider accounts**: Google free recommended + optional Groq free + optional OpenAI paid fallback
- **Total with OmniRoute**: **1-3 external accounts** (Google free + optional 1-2) + **1 local gateway key**. Env vars: `OMNIROUTE_API_KEY` (required when enabled) + `GOOGLE_API_KEY` (recommended) + optional tuning.

**Full resilient fallback (production recommended)**:

- 1 Google AI (free, no card) — primary
- 1 Groq (free, no card) — fast fallback via OmniRoute
- 1 OpenAI (paid) — quality fallback direct
- 1 OmniRoute gateway local key — cost controls
- Total: **3-4 accounts**, 3-5 API keys, all stored encrypted in mission vault, never asked in chat.

**Never in chat**: Do not ask for secrets in chat. All keys via deployment secret store / env / mission vault encrypted, masked hint only, never returned.

**Security**: OmniRoute binds 127.0.0.1:20128 only, never public. `AKBARAL_ALLOW_PRIVATE_PROVIDER=1` required for non-loopback. API key in vault encrypted, never returned. Private bind check in `env.ts` + `omniroute.ts`. Quota buckets per-agent in-memory, daily token budget 100K default, RPM 10, monthly $5 default, check before call, fallback to direct providers. Telemetry via `recordModelRun` with omniroute flag. Cost controls via `checkOmnirouteQuota` + mission wallet `canAgentSpend` authoritative.

---

## Verification

- `npm run typecheck` PASS
- `npm run build` PASS (Next.js static + dynamic routes)
- Mission tests: treasury 12 PASS, core 15 PASS, reinvestment 9 PASS, server 23 PASS, billing 19 PASS, database/health/role 24 PASS
- OmniRoute integration: `src/models/omniroute.ts` private gateway provider, `src/models/catalog.ts` omniroute spec + 5 models (auto default cheapest viable), `src/models/client.ts` createProvider omniroute case, `src/models/router.ts` prefers OmniRoute when enabled+configured, quota check, fallback chain omniroute auto → Google free → OpenAI → Anthropic, telemetry, cost controls, mission wallet authoritative
- `src/config/env.ts` omniroute env vars + private bind validation, `src/config/credentials.ts` omniroute integration privateOnly, `src/mission/self-management.ts` omniroute_gateway tool
- `.env.example` OmniRoute section documented private 127.0.0.1:20128 never public, required vs optional
- Preserved $1B/day per agent: daily_target_cents 100B default, verified today only status=received+verifier, remaining gap, progress%, resets UTC
- Brand: AKBARAL! never AKBARAL AI, tagline One Intelligence. Every Solution., universal platform MASTER + 4001 agents, ZA141251SA isolation preserved

