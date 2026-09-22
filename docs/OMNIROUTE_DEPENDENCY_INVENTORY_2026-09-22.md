# ZA141251SA — OmniRoute Dependency Inventory & Integration Plan
**Date:** 2026-09-22
**Status:** INVENTORY ONLY — no production code modified yet
**Objective:** Every mission agent must have persistent objective to maximize legitimate, verified real-world earnings and work toward owner-defined billionaire target as aspirational long-term objective. Agents pursue fastest lawful, sustainable, verifiable opportunities available to capabilities and resources. Billionaire status or any income amount is NOT guaranteed, no fake earnings.

---

## 0. OmniRoute Summary (live verification 2026-09-22)

**Source:** https://github.com/diegosouzapw/OmniRoute — release/v3.8.51, 69.2k stars, 9.8k forks, MIT license

**What it IS:**
- Self-hosted AI gateway/router, Node.js, one endpoint (`http://localhost:20128` dashboard) that aggregates 359 providers (152 marked free in catalog, 150+ free per README), 1312 unique chat model IDs, 19 routing strategies, 4-tier routing: Subscription → API Key → Cheap → Free
- Quota-aware auto-fallback: when primary provider hits rate-limit/quota, falls back in ms to next tier, tracks health real-time
- Token compression: RTK + Caveman stacked 15-95% savings (~89% avg on tool-heavy sessions) — fidelity/latency trade-off
- Protocols: OpenAI-compatible, Anthropic Messages, Gemini, etc. Translates client protocols to provider-specific requests
- Features: Dashboard `/dashboard/free-tiers` live used/remaining, MCP 95 tools 3 transports, A2A, Desktop/PWA, Electron, Docker `diegosouzapw/omniroute`, guardrails: circuit breakers, TLS fingerprint stealth JA3/JA4 via wreq-js, prompt-injection guards, PII guardrails, API-key scoping, usage accounting

**What it is NOT:**
- Does NOT provide free AI models itself. It routes YOUR existing free-tier accounts, subscriptions, OAuth, API keys, or local runtimes (Ollama, LM Studio, vLLM). You still need accounts.
- Free token headline ~1.62B/month steady, up to ~2.22B first month with signup credits, from 35 recurring pool keys covering 489 cataloged entries — theoretical aggregate, NOT guaranteed availability. Each pool counted once, 17 pools with published positive monthly budget + 5 per-model Groq caps. Quotas that require regional identity check (ModelScope) shown apart +~6M, never summed.
- 11 truly forever-free no-auth providers (OpenCode Free, Pollinations, Qoder, Qwen unlimited, etc). 40+ free tiers require account creation + API key + phone verification. 50+ trial tiers require credit card. 136+ paid-only require subscription.
- Rate limits on free tiers aggressive: 1-10 RPM, 100-1000 req/day. Terms often prohibit proxy/relay usage — must check each upstream ToS.
- Single primary maintainer (diegosouzapw) + 600 contributors, fork of 9router, emerging maturity vs LiteLLM/OpenRouter.

**Free providers verified (no card, no auth or keyless):**
- Kiro AI: 50 credits/month, Claude Sonnet 4.5/Haiku 4.5/Opus 4.6, no auth needed (per wiki, but may require account)
- OpenCode Free: Unlimited, GPT-4o/Claude/Gemini, no auth needed
- Pollinations: No key needed, GPT-5/Claude/Gemini/DeepSeek/Llama 4, no token cap but rate-limited
- LongCat: 50M tokens/day free, LongCat-Flash-Lite
- Cloudflare AI: 10K neurons/day, 50+ models
- Qwen: Unlimited, Qwen3-coder-plus/flash/next, no auth
- Qoder: Unlimited, Kimi-K2/DeepSeek-R1/Qwen3-coder
- NVIDIA NIM: ~40 RPM, 129 models, API key needed (free tier)
- Cerebras: 1M tokens/day, Qwen3 235B/GPT-OSS 120B, API key needed
- Felo, OpenCode Free: keyless fallback

**Paid providers (API key required):**
- OpenAI: GPT-5/GPT-4o $2.50-$10/1M tokens, $5 free credits (requires card after)
- Anthropic: Claude Opus 4.6/Sonnet 4.6 $3-$15/1M tokens, $5 free credits
- Google: Gemini 2.5 Pro/Flash $0.075-$1.25/1M tokens, 1500 req/day free (no card per Google AI Studio)
- DeepSeek: V4 $0.14-$0.28/1M, 5M free tokens
- Groq: Llama 4/Mixtral $0.05-$0.27/1M, 30 RPM free
- xAI Grok 3 $0.30-$0.60/1M

---

## 1. Which AI capabilities can be routed through OmniRoute

**Current AKBARAL AI capabilities (from src/models/catalog.ts, client.ts, router.ts):**
- LLM chat: OpenAI-compatible (GPT-4o, GPT-4o-mini, etc), Anthropic Messages (Claude 3.5 Sonnet), Google Gemini (gemini-3.8-flash, 3.5-flash, 3.1-flash-lite, DALL·E 3 for image)
- Streaming: SSE streaming via `streamChat`, fallback to single-shot
- Tool calling: via model router, not native provider tools — tools are separate (web_search, page_fetch, etc)
- Embeddings: capability present but filtered out in router for chat

**Routable through OmniRoute:**
- ✅ All LLM chat completions: OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, Qwen, Kimi-K2, GLM, MiniMax, etc. OmniRoute is OpenAI-compatible endpoint, so `OPENAI_BASE_URL` can point to OmniRoute (`http://omniroute:20128/v1`) and use OmniRoute API key as `OPENAI_API_KEY` to route through its 4-tier fallback.
- ✅ Streaming: OmniRoute supports streaming passthrough
- ✅ Model diversity: 1312 chat model IDs vs current 7 — can expand catalog to include DeepSeek V4, Qwen3, Kimi-K2, Llama 4, Groq fast models for cost/speed tiers
- ✅ Quota-aware fallback: replaces current manual fallback chain in `ModelRouter.complete()` — OmniRoute auto-fallback within ms, with live health
- ✅ Token compression: RTK+Caveman 15-95% savings can be enabled for tool-heavy MASTER sessions (4,001 agents context) to reduce costs
- ✅ Local runtimes: Ollama/LM Studio/vLLM can be connected as providers for offline/air-gapped mission agents

**NOT routable through OmniRoute (stays outside):**
- Image generation: DALL·E 3 via OpenAI images endpoint — OmniRoute may bridge vision modality (v3.8.50 added vision+audio+video bridge) but needs verification; keep direct OpenAI images as fallback
- Embeddings: if used for knowledge FTS, needs separate provider
- Non-LLM: search, page_fetch, payments, email, etc — not LLM, stays outside

**Integration point:**
- Add `OMNIROUTE_BASE_URL` (default `http://127.0.0.1:20128/v1`) and `OMNIROUTE_API_KEY` envs
- When `OMNIROUTE_API_KEY` set, `src/models/client.ts` `resolveBaseUrl` can return OmniRoute URL for openai/anthropic/google providers, or create new `OmniRouteProvider` class that wraps OmniRoute's OpenAI-compatible API and forwards model key
- Keep `GOOGLE_API_KEY` direct path as fallback for Gemini (Google free tier no card) — OmniRoute still needs Google account anyway
- Router: `ModelRouter` can keep scoring but delegate actual call to OmniRoute with `model: "auto"` to let OmniRoute pick cheapest viable provider per request

---

## 2. Which API/provider credentials are still required outside OmniRoute

OmniRoute does NOT replace non-LLM credentials. Even for LLM, you still need upstream accounts.

**LLM — still required outside OmniRoute (even when routing through it):**
- Google: `GOOGLE_API_KEY` / `GEMINI_API_KEY` — for direct Gemini path (MASTER→Gemini required) and for OmniRoute Google provider (needs Google account). Free tier: Google AI Studio 1500 req/day no card — legit free option.
- OpenAI: `OPENAI_API_KEY` — for direct OpenAI or for OmniRoute OpenAI provider. Free: $5 credits trial requires card after, not permanent free.
- Anthropic: `ANTHROPIC_API_KEY` — for Claude. Free: $5 credits trial, requires card after.
- For OmniRoute free providers: Kiro, OpenCode Free, Pollinations, LongCat, Cloudflare AI, Qwen, Qoder — may need account creation + API key even if no card (e.g. Cerebras needs key, NVIDIA NIM needs key). Each needs separate account.

**Non-LLM — always outside OmniRoute:**
- Search: `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID`
- Custom search/fetch proxies: `AKBARAL_SEARCH_ENDPOINT`, `AKBARAL_PAGE_FETCH_ENDPOINT`
- Email: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, etc.
- OAuth: `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET` + `APPLE_KEY_ID/TEAM_ID/PRIVATE_KEY`, `MS_CLIENT_ID/SECRET`
- Payments: `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_ID/SECRET`, plus `BILLING_WEBHOOK_SECRET`, `STRIPE_BASE_URL`, `RAZORPAY_BASE_URL` for fixtures
- Social publishing: `YOUTUBE_ACCESS_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `X_BEARER_TOKEN`, `SHOPIFY_STORE_DOMAIN/ACCESS_TOKEN`, `TWILIO_ACCOUNT_SID/AUTH_TOKEN`, plus OAuth apps `YOUTUBE_CLIENT_ID/SECRET`, `INSTAGRAM_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`
- Mission: `ZA141251SA_DATABASE_URL`, `ZA141251SA_SESSION_SECRET`, `ZA141251SA_CREDENTIAL_KEY`, `ZA141251SA_OWNER_EMAIL/PASSWORD`, `ZA141251SA_SITE_URL`, `ZA141251SA_BIND_HOST/PORT`, `ZA141251SA_PAYOUT_VERIFICATION_DAYS`, `ZA141251SA_CURRENCY`
- Core: `DATABASE_URL`, `SESSION_SECRET`, `AKBARAL_PUBLIC_WEB_URL`, `AKBARAL_UPLOAD_DIR`, `TRUST_PROXY`, `CORS_ORIGINS`

---

## 3. Search / browser / tool APIs required

**Current tools (from src/models/catalog.ts TOOL_SPECS + src/mission/self-management.ts DEFAULT_TOOLS):**

| Tool Key | Category | Provider | Current Implementation | API Required |
|---|---|---|---|---|
| `web_search` | search | tavily|brave|serper|google_cse|endpoint|duckduckgo | `src/agents/search-providers.ts` — tries Tavily (POST /search Bearer), Brave (GET /res/v1/web/search), Serper (POST /search X-API-KEY), Google CSE (custom search), custom endpoint, fallback DuckDuckGo HTML scraping | `TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY` or `SERPER_API_KEY` or `GOOGLE_CSE_API_KEY+ID` or `AKBARAL_SEARCH_ENDPOINT` (custom JSON search proxy) — keyless DuckDuckGo is default but blocked from datacenter IPs |
| `page_fetch` | fetch | direct or endpoint | `src/agents/web-research.ts` — direct public fetch with SSRF guard, or custom `AKBARAL_PAGE_FETCH_ENDPOINT` proxy | `AKBARAL_PAGE_FETCH_ENDPOINT` optional, else direct fetch (no key) but needs outbound internet |
| `code_repository_read` | code | local | Reads workspace repo files | No API, local FS |
| `file_parse_text` | file | local | Parses uploads | No API, local FS |
| `knowledge_search` | knowledge | local | FTS5 search over indexed knowledge | No API, SQLite FTS |
| `excel_build` | data | local | Builds spreadsheet | No API |
| `image_render` | media | openai | DALL·E 3 via OpenAI images | `OPENAI_API_KEY` |
| `youtube_publish` | media | youtube | YouTube Data API v3 | `YOUTUBE_ACCESS_TOKEN` or OAuth `YOUTUBE_CLIENT_ID/SECRET` |
| `instagram_publish` | media | instagram | Instagram Graph API | `INSTAGRAM_ACCESS_TOKEN` or OAuth |
| `x_post` | social | x | X API v2 | `X_BEARER_TOKEN` |
| `shopify_product` | commerce | shopify | Shopify Admin API | `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ACCESS_TOKEN` |
| `twilio_message` | messaging | twilio | Twilio API | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` |
| `stripe_payment` | payment | stripe | Stripe Payment Intents | `STRIPE_SECRET_KEY` |
| `http_request` | api | public | SSRF-guarded GET/POST JSON | No key, but SSRF guard |
| `json_transform`, `text_analyze`, `csv_parse` | data | local | Local transforms | No API |
| `maps_place` | geo | google | Google Places API | `GOOGLE_API_KEY` |
| Mission tools: `gemini_api`, `object_storage`, `compute_runner`, `email_delivery`, `payment_links`, `social_publishing`, `card_or_bank_api` (permanently blocked) | mission | provider-configured | `src/mission/self-management.ts` — default deny, owner approves | Requires provider account + scoped token in encrypted vault `mission_credentials`, plus owner approval |

**Browser/tooling for mission agents:**
- No headless browser currently — `page_fetch` is fetch + readability, not full browser. For mission agents needing JS-heavy sites, need Playwright/Puppeteer or `AKBARAL_PAGE_FETCH_ENDPOINT` that runs browser.
- Compute runner: needs provider (e.g. Modal, Fly, Railway, or local Docker) + token — not yet configured, `requiresExternalActivation` lists it.

---

## 4. Email, payment, storage, database and other non-LLM integrations required

| Integration | Current Code | Required Env | Purpose | Free/no-card option |
|---|---|---|---|---|
| **Database (platform)** | `src/db/database.ts` — SQLite file or PostgreSQL bridge via worker thread SharedArrayBuffer | `DATABASE_URL` file:./data/akbaral.db or postgres:// | Users, tasks, agents, credits, invoices, etc. | SQLite file free, no card. PostgreSQL: Neon Free 0.5GB 100 CU-hours no card (verified 2026-09-22), Supabase Free 500MB pauses after 7d, PGlite local for tests |
| **Database (mission)** | `src/mission/database.ts` — same engine, separate file | `ZA141251SA_DATABASE_URL` file:./mission.db or postgres:// | Mission agents, wallets, ledger, revenue, audit, policy, targets, payout slots | Same as platform: SQLite file free, Neon Free no card |
| **Object storage** | `src/mission/self-management.ts` `object_storage` tool, `AKBARAL_UPLOAD_DIR` | `AKBARAL_UPLOAD_DIR` + provider token in vault (S3, R2, etc.) | Uploads, backups, artifacts — currently local FS at /data/uploads, ephemeral on free hosts | Local FS free, Cloudflare R2 10GB free no card? Requires card? Back4app 1GB free no card, but 256MB RAM insufficient. For mission, local /data + rclone to Oracle Object Storage Always Free (requires card verification) or GitHub private repo encrypted |
| **Compute runner** | `compute_runner` tool, `deploy/` kits | Provider account + token in vault | Long jobs, Docker image `mrzain555/akbaral:latest` | No $0 no-card persistent host exists Sept 2026 per FINAL_HOSTING_VERIFICATION — closest Koyeb Free 512MB ephemeral usually no card, Railway trial $5 no card 30d, Oracle Always Free requires card |
| **Email (platform)** | `src/routes/contact.ts`, auth recovery | `SMTP_HOST/USER/PASSWORD/FROM/PORT/SECURE` | Password reset, email verification, campaign delivery | No free SMTP without card that is reliable — Ethereal test free, Mailtrap free tier no card, but production needs real SMTP. Without SMTP, dev returns devToken, prod returns 503 provider_not_configured (honest) |
| **Email (mission)** | `email_delivery` tool restricted | Provider token in vault + owner-approved template | Transactional email for mission | Same as platform, restricted by policy |
| **Payment (platform)** | `src/billing/service.ts`, `stripe.ts`, `providers.ts` | `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_ID/SECRET`, `BILLING_WEBHOOK_SECRET`, `AKBARAL_MARKETPLACE_COMMISSION_BPS` | Credit purchase, Stripe checkout, Razorpay orders, webhook settlement, refunds with credit reversal, PDF invoices | Stripe requires card + business verification, no free without card. Razorpay requires KYC. Manual admin settlement works with NO payment provider (honest provider_not_configured, manual settlement available) — free/no-card path for internal credits |
| **Payment (mission)** | `payment_links` tool restricted, `mission_ledger` revenue only with verifier | Payment provider account + webhook secret in vault, payout slots verified | Real-world earnings: revenue recorded only with idempotency key + verifier (owner/provider-webhook/bank-statement), ledger hash-chained, reinvestment share | No fake revenue — requires real provider settlement ref. Free option: manual owner recording with verifier `owner` (honest, audited), but for real earnings needs Stripe/PayPal/bank provider |
| **Payouts (mission)** | `src/mission/treasury.ts`, `payout-verification.ts`, `destination-safety.ts` | 4 slots `mission_payout_slots`, verification checks, attestation, `ZA141251SA_PAYOUT_VERIFICATION_DAYS` | Payouts to verified destinations only — active verified slot, treasury funds, owner decision, settlement ref | No card/bank credentials ever stored — masked hint + provider ref only, full PAN/IBAN refused at write. Requires KYC verification by payout provider (Stripe Connect, PayPal, bank) — free to configure, but payout provider requires identity verification |
| **Social publishing** | `src/mission/social.ts`, `src/routes/social.ts` | OAuth apps `YOUTUBE_CLIENT_ID/SECRET`, `INSTAGRAM_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`, `ZA141251SA_SITE_URL` for redirect URI, tokens encrypted in vault | Publishing via YouTube Data API, Instagram Graph, TikTok — engagement metrics only from platform APIs, no fabrication | Free to register OAuth apps (requires Google/Meta/TikTok developer accounts, no card), but API quotas rate-limited |
| **Storage (platform)** | Local FS | `AKBARAL_UPLOAD_DIR` | Uploads, backups | Local FS free |
| **Other** | `src/push/`, `mobile/` Expo push | Expo push token | Mobile notifications | Expo push free no card |

---

## 5. Required vs optional credentials

**From src/config/credentials.ts INTEGRATION_DEFINITIONS + env.test.ts lock:**

**Core required in production (enforced by validateEnvironment):**
- `DATABASE_URL` — REQUIRED — file:./data/akbaral.db or postgres:// — no default in prod, must be set
- `SESSION_SECRET` — REQUIRED — >=32 random chars, blacklisted placeholders — prod refuses to start without it
- `GOOGLE_API_KEY` — REQUIRED for MASTER→Gemini path (src/config/env.test.ts locks it as required for core) — without it MASTER cannot run model, reports provider_not_configured honestly

**Optional when unset (fail honestly with required var name, no fake):**
- Search: `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, `GOOGLE_CSE_API_KEY`+`GOOGLE_CSE_ID`, `AKBARAL_SEARCH_ENDPOINT`, `AKBARAL_PAGE_FETCH_ENDPOINT`, `AKBARAL_SEARCH_PROVIDER`, `AKBARAL_ALLOW_PRIVATE_PROVIDER` — default keyless DuckDuckGo HTML, direct public fetch with SSRF guard
- LLM: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `GOOGLE_BASE_URL` — optional, router reports provider_not_configured, falls back to configured provider
- Email: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, etc. — optional, dev returns devToken, prod 503 provider_not_configured
- OAuth: `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET` + KEY_ID/TEAM_ID/PRIVATE_KEY, `MS_CLIENT_ID/SECRET` — optional, email/password auth remains
- Billing: `BILLING_WEBHOOK_SECRET`, `AKBARAL_MARKETPLACE_COMMISSION_BPS` — optional, manual settlement works
- Payments: `STRIPE_SECRET_KEY`, `RAZORPAY_KEY_ID/SECRET` — optional, manual admin settlement available
- Social/commerce: `YOUTUBE_ACCESS_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `X_BEARER_TOKEN`, `SHOPIFY_STORE_DOMAIN/ACCESS_TOKEN`, `TWILIO_ACCOUNT_SID/AUTH_TOKEN` — optional, tools return provider_not_configured
- Adsense: `AKBARAL_ADSENSE_CLIENT` — optional, no ad script when unset
- Owner: `AKBARAL_OWNER_EMAIL`, `SESSION_SECRET_PREVIOUS`, `CORS_ORIGINS`, queue tuning `AKBARAL_QUEUE_CONCURRENCY` etc. — optional
- Mission: `ZA141251SA_DATABASE_URL`, `ZA141251SA_SESSION_SECRET`, `ZA141251SA_CREDENTIAL_KEY`, `ZA141251SA_OWNER_EMAIL/PASSWORD`, `ZA141251SA_SITE_URL`, `ZA141251SA_BIND_HOST/PORT`, `ZA141251SA_PAYOUT_VERIFICATION_DAYS`, `ZA141251SA_CURRENCY` — required for mission host only, optional for platform host; mission dashboard reports not provisioned when missing, credential vault disabled when key absent

**New for OmniRoute:**
- `OMNIROUTE_BASE_URL` — OPTIONAL — default `http://127.0.0.1:20128/v1` — when unset, direct provider paths used
- `OMNIROUTE_API_KEY` — OPTIONAL — when set, enables routing through OmniRoute gateway; when unset, direct provider keys used
- `OMNIROUTE_ENABLED` — OPTIONAL boolean — feature flag to enable gateway routing
- Per-provider keys for OmniRoute free providers (Kiro, Cerebras, NVIDIA NIM, etc.) — OPTIONAL, each stored in OmniRoute dashboard, not in AKBARAL env directly, but AKBARAL needs to know they exist via `OMNIROUTE_API_KEY`

---

## 6. Free / no-card options where legitimately available

**LLM — legitimate free no-card:**
- Google AI Studio (Gemini): `GOOGLE_API_KEY` free tier 1500 req/day, no card, Flash models only, data may be used by Google to improve products — **RECOMMENDED for launch**
- OmniRoute free providers: OpenCode Free unlimited no auth, Pollinations no key, Qwen unlimited no auth, Qoder unlimited, LongCat 50M tokens/day no auth, Cloudflare AI 10K neurons/day no auth — **usable via OmniRoute with no card, but rate limits 1-10 RPM, check ToS for proxy permission**
- DeepSeek: 5M free tokens no card? Requires account but no card
- Groq: 30 RPM free, requires account no card
- Cerebras: 1M tokens/day free, requires account + API key no card
- NVIDIA NIM: ~40 RPM free, requires account + key no card

**LLM — free trial but requires card after:**
- OpenAI $5 credits, Anthropic $5 credits — trial requires card after, not permanent free

**Search — free no-card:**
- DuckDuckGo HTML scraping: keyless, no card, default — blocked from datacenter IPs, rate-limited
- Brave Search: free tier 2000 req/month no card? Requires account
- Serper: free tier 2500 req? Requires account
- Tavily: free tier 1000 req/month no card? Requires account
- Google CSE: free 100 req/day no card, requires Google account + CSE ID
- Custom endpoint: self-hosted search proxy (e.g. SearxNG) free no card if self-hosted

**Page fetch — free no-card:**
- Direct public fetch: free, no card, SSRF-guarded
- Custom fetch proxy: self-hosted, free

**Database — free no-card:**
- SQLite file: free forever, no card, persistent on VM volume — **current default**
- Neon Postgres Free: 0.5GB storage, 100 CU-hours/month, 10 branches, no card, permanent free, scales to zero — **verified 2026-09-22, recommended for production without persistent /data**
- Supabase Free: 500MB, 2 projects, pauses after 7d idle, no card? Requires account
- PGlite: local in-process Postgres for tests, free no card

**Storage — free no-card:**
- Local FS: free, but ephemeral on free hosts (Render, Koyeb) without persistent disk
- Back4app Containers free 1GB? Actually 256MB RAM, but storage? No persistent volume guarantee
- Cloudflare R2: 10GB free, requires card? Actually R2 free tier no card? Requires Cloudflare account, no card for free tier
- Oracle Object Storage Always Free: 20GB, requires card verification (one-time $1 hold) — fails no-card but never charged

**Email — free no-card:**
- Ethereal (test): free no card, fake SMTP for dev
- Mailtrap free: 1000 emails/month no card? Requires account
- Production SMTP: requires real provider (SendGrid free 100/day requires account, no card for free tier; Mailgun free 1000/month requires card after trial; AWS SES requires card)

**Payments — free no-card path:**
- Manual admin settlement: NO payment provider required — `POST /api/admin/settle-payment` with owner role grants credits, honest provider_not_configured for Stripe/Razorpay — **free/no-card for internal credits**
- Real payments: Stripe/Razorpay require KYC + card + business verification — no free without verification

**Hosting — NO $0 no-card persistent /data exists Sept 2026 per FINAL_HOSTING_VERIFICATION:**
- Koyeb Free: 512MB 0.1 vCPU 2GB SSD ephemeral, usually no card, always-on, supports Docker Hub `mrzain555/akbaral:latest`, HTTPS — **closest $0 no-card, fails persistent /data**
- Render Free: 512MB 750h, ephemeral, requires card for compute per live signup — fails card + /data
- Back4app: 256MB < need, no persistent volume guarantee — fails RAM + /data
- Railway Trial: $5 one-time no card, 0.5GB persistent volume, supports Docker Hub, HTTPS — **meets /data but trial 30d then $1/mo + card**
- Oracle Always Free: 4 OCPU 24GB 200GB disk persistent, requires card verification one-time — fails no-card
- Zeabur Free: $0 only manageable own servers, no hosted compute — fails
- Blitz: 503 control-plane down

**Mission payouts — free to configure, but verification requires:**
- Payout provider (Stripe Connect, PayPal, Wise, bank) requires KYC identity verification — free to create account, but verification requires government ID, not card
- No card/bank credentials ever stored in mission — masked hint + provider ref only

---

## 7. Per-agent cost controls, quotas and fallback strategy

**Current controls (from src/mission/policy.ts, treasury.ts, self-management.ts, src/orchestrator/queue.ts):**

- **Wallet budgets:** Each mission agent has wallet `mission_wallets` with `balance_cents`, `status` active/paused. `canAgentSpend({walletId, amountCents, category, agentId}, policy, dailySpendCents)` checks: wallet exists active, budget not exceeded, daily spend cap `maxDailySpendCents`, per-transaction cap `maxExpenseCents`, and anything >= `requireApprovalAboveCents` queued to owner approval instead of executing.
- **Daily spend cap:** `maxDailySpendCents` global, `dailySpendCents(day)` from `mission_ledger` where category=expense
- **Per-transaction cap:** `maxExpenseCents`, `maxPayoutCents`
- **Approval queue:** `mission_approvals` — spend above threshold queued, owner decides, audited
- **Kill switch:** `kill_switch` boolean — suspends ALL activity including approved work
- **Tool catalog:** `mission_tools` default deny — `approved`/`restricted`/`blocked`, `card_or_bank_api` permanently blocked, owner action cannot enable, re-seeding restores block
- **Credential expiry sweep:** `expiringCredentials(withinDays)` + `sweepCredentialStatus()` active→expiring→expired, audited
- **Resource renewals:** `resourceRenewals(withinDays)` tracks `expires_at`, monthly cost
- **Platform execution queue:** `AKBARAL_QUEUE_CONCURRENCY` 1-8, `AKBARAL_EXECUTION_MAX_ATTEMPTS` 1-5, retry base delay, step timeout, workflow timeout — prevents runaway
- **Rate limits:** `src/server/middleware/rate-limit.ts` — 300 req/min api, 30/min auth, 5/min contact, IP-based with TRUST_PROXY real IP, X-Forwarded-For spoofing protection (keys on real IP)
- **Model router:** `ModelRouter` scores models by capability, cost, latency, reliability, credentials available, prefers configured models, fallback chain, records every run via `recordModelRun` for cost/latency monitoring, honest `provider_not_configured` error with required var name
- **Billing:** Free tasks 5 at registration, 30-day trial, consumed ONLY after successful completion, failure refunds, balances never negative, atomic accounting, webhook idempotency, duplicate protection, forged signature rejection

**Proposed per-agent controls with OmniRoute:**

- **OmniRoute dashboard quotas:** Each provider in OmniRoute has its own quota (e.g. Kiro 50 credits/mo, LongCat 50M tokens/day). OmniRoute tracks live used/remaining per provider at `/dashboard/free-tiers`, quota-aware scheduling (Quota-Share new in v3.8.51). Agents should query OmniRoute usage API before expensive calls.
- **AKBARAL-side quotas:** Keep existing wallet budgets, but add:
  - `OMNIROUTE_DAILY_TOKEN_BUDGET` per agent (e.g. 100K tokens/day for free providers)
  - `OMNIROUTE_MONTHLY_COST_CENTS` per agent (e.g. $5/month max for paid providers via OmniRoute)
  - `OMNIROUTE_RATE_LIMIT_RPM` per agent (e.g. 10 RPM to respect free tier limits)
- **Cost controls:**
  - Token compression: Enable RTK+Caveman for MASTER sessions (4,001 agents) to save 15-95% tokens — reduces cost, but may affect fidelity, needs testing
  - Routing strategy: Use OmniRoute `auto` or `cheap` strategy for mission agents — automatically picks cheapest viable provider
  - Fallback chain: Primary = OmniRoute `auto` (cheap), Secondary = direct `GOOGLE_API_KEY` Gemini free tier (no card), Tertiary = keyless free providers (OpenCode Free, Pollinations) — ensures never stops even if paid quotas exhausted
  - Per-agent wallet check BEFORE LLM call: `canAgentSpend` with estimated cost (input+output tokens * model cost) — if would exceed budget, queue to approval or use free provider
- **Quotas:**
  - Global: `maxDailySpendCents` already exists, applies to all agent spend including LLM
  - Per-agent: `mission_wallets.balance_cents` + `monthlyCostCents` from resources
  - Per-provider: OmniRoute tracks per-provider quotas, agents should respect `Retry-After` headers, 429 handling with exponential backoff
  - Daily revenue target: `dailyRevenueTargetCents` — progress counts VERIFIED revenue only, not expected/contracted, audited achievement once per day
- **Fallback strategy:**
  - LLM: OmniRoute auto-fallback (Subscription → API Key → Cheap → Free) in ms → direct Google Gemini free tier → keyless free (OpenCode Free) → honest failure `provider_not_configured` with required var name
  - Search: Tavily/Brave/Serper/Google CSE → custom endpoint → DuckDuckGo keyless → honest failure
  - Page fetch: custom endpoint → direct public fetch → honest failure
  - Payments: Stripe/Razorpay → manual admin settlement → honest provider_not_configured
  - Storage: S3/R2 → local FS → honest failure
  - If all providers exhausted: return honest error, never fabricate, never spam, never bypass ToS

---

## 8. Security and secret isolation for AKBARAL public users vs ZA141251SA private mission

**Current isolation (from MISSION_SYSTEM.md, role-separation.test.ts, identity-lock.ts, database.ts):**

- **Separate process and port:** Platform `npm run dev` / `start` on :3000/:4000, Mission `npm run mission:serve` on :4200 (default), `ZA141251SA_BIND_HOST` default 127.0.0.1 private by default, wider bind explicit operator action behind private network/tunnel, refused unless mission owner exists
- **Separate database:** Platform `DATABASE_URL` file:./data/akbaral.db or postgres://, Mission `ZA141251SA_DATABASE_URL` file:./mission.db or postgres:// — no shared connection, no cross-database join, mission runtime imports nothing from platform DB layer
- **Separate authentication:** Platform: users table scrypt-hashed passwords, JWT access tokens (1h), session rotation grace, OAuth Google/GitHub/Facebook/Apple/Microsoft, role USER/ADMIN/OWNER/SUPER_ADMIN. Mission: `mission_owner` scrypt-hashed, mission-local sessions hashed tokens + CSRF token 12h expiry rotation on every login, access links `zal_` prefixed non-guessable single-use expiring use-limited, no platform JWT/cookie/API key accepted, platform owner/super_admin means nothing to mission, mission sessions mean nothing to platform
- **Separate secrets:** Platform `SESSION_SECRET`, `GOOGLE_API_KEY`, etc. Mission `ZA141251SA_SESSION_SECRET` 32+ chars, `ZA141251SA_CREDENTIAL_KEY` 32+ chars encrypts vault with AES-256-GCM, `ZA141251SA_OWNER_EMAIL/PASSWORD`, `ZA141251SA_SITE_URL`, etc. — no platform secret read by mission, no mission secret read by platform
- **No discovery:** No public page, sitemap, navigation, API response, or docs links to or names mission app location. Public pages/docs scanned by `role-separation.test.ts` to ensure no `ZA141251SA` string appears
- **Credential vault:** Mission credentials encrypted immediately with AES-256-GCM, never returned — only masked hint + expiry, rotation history, status. Plaintext never in audit trail, redacted via `redactForAudit`, `redactSecrets`. `card_or_bank_api` permanently blocked, owner cannot enable, re-seeding restores block
- **Audit trails:** Platform `audit_logs` hash-chained? Actually `system_metrics` + `security_logs` + `audit`? Mission `mission_audit` hash-chained append-only, `verifyMissionAudit()` detects tampering, `mission_ledger` hash-chained with `seq` ordering for PostgreSQL (no rowid), `verifyLedger()`
- **Payout safety:** `destination-safety.ts` refuses full PAN, IBAN checksum-validated, long digit runs, credential material at write — masked hint + provider ref only, 4 slots, verification checks (I control this destination, masked details match, not third party, provider KYC completed, no full credentials entered), attestation 40+ chars stored verbatim, expiry `ZA141251SA_PAYOUT_VERIFICATION_DAYS` default 180, sweeps to expired/paused, revoke with reason, owner-only library enforcement `actorType: 'agent'` refused
- **Social publishing:** OAuth PKCE single-use 10-min owner-bound, tokens encrypted in vault, never returned, only masked hint + expiry, unregistered app answers `provider_not_configured`, provider rejection 502, network failure `provider_unreachable`, never marked connected without real token, no engagement synthesized
- **Rate limiting & SSRF:** `rate-limit.ts` 300/min api, 30/min auth, 5/min contact, IP-based real client IP via TRUST_PROXY, X-Forwarded-For spoofing protection, `ssrf.ts` rejects loopback, private ranges, link-local metadata 169.254.169.254, non-http schemes, `ALLOW_PRIVATE_PROVIDER` only for trusted internal provider host
- **Secret redaction:** `scan-secrets.ts`, `env.test.ts` ensures no `GOOGLE_API_KEY=` assignments in bundles, no key leaks in logs, request logs never contain authorization header

**Proposed isolation with OmniRoute:**

- **OmniRoute as internal gateway, NOT exposed to public users:** OmniRoute dashboard binds 127.0.0.1:20128 by default, should stay private, never exposed to public internet, never mounted on platform routes, no public API exposes OmniRoute endpoint
- **OmniRoute API key as mission secret:** `OMNIROUTE_API_KEY` stored in mission vault `mission_credentials` encrypted, NOT in platform `.env` accessible to users, only mission owner can configure via `POST /api/credentials` with provider=omniroute, masked hint only in reads
- **Platform users cannot configure OmniRoute:** Public AKBARAL users' `POST /api/config` or billing never accepts `OMNIROUTE_*` keys, integration status reports `omniroute` as not configured for public, only mission dashboard shows it
- **Per-agent OmniRoute usage isolated:** Each mission agent's token usage counted against its wallet via `recordResourceUsage`, not shared with platform users' credit accounts `credit_accounts`
- **Secret isolation:** Platform `OPENAI_API_KEY` etc. remain in platform env, mission `OMNIROUTE_API_KEY` and upstream provider keys (Cerebras, NVIDIA NIM, etc.) stored in mission vault, never in platform DB, never returned by `listCredentials()` public surface, only masked hint
- **Network isolation:** OmniRoute runs as sidecar on mission host, platform app calls it via `http://127.0.0.1:20128/v1` (private), not via public internet, TLS fingerprint stealth JA3/JA4 via wreq-js in OmniRoute helps avoid provider blocking but does not bypass ToS
- **Audit:** Every OmniRoute-routed LLM call recorded in `mission_ledger` with provider, model, tokens, cost, verifier (provider API), hash-chained, never fabricated
- **Prohibited bypass:** OmniRoute must NOT be used to bypass provider ToS, KYC, rate limits, or create fake accounts — each upstream account must be legitimately created by owner, with phone verification where required, and respect provider's terms on proxy usage. If provider prohibits proxy, do NOT route through OmniRoute for that provider.

---

## 9. ZA141251SA Persistent Billionaire Objective Integration

**Objective statement (to be added to mission agent contracts):**

> Every mission agent has a persistent, non-removable objective: maximize legitimate, verified real-world earnings through lawful, sustainable, verifiable opportunities aligned with its capabilities and resources, working toward the owner-defined billionaire target as an aspirational long-term objective. The billionaire target is stored in `mission_targets` as a target, NOT as guaranteed income, and progress counts ONLY verified received revenue (`status='received'` + verifier `owner|provider-webhook|bank-statement`), never expected/contracted. Agents pursue fastest lawful opportunities available, respecting policy allow-list, budget caps, approval thresholds, kill switch, and payout verification.

**Design:**

- **Target storage:** `mission_targets` table already supports aggressive figures (millions per day) as targets, labeled as targets, never presented as achievement. Add `billionaire_target` label, period `lifetime`, amount_cents = owner-defined (e.g. $1B = 100_000_000_000 cents), currency USD, metric `realized_revenue`, created_by owner. No code path presents target as earned.
- **Agent contract:** Each `mission_agents` row gets `objective` field? Actually `mission_agent_contracts` table — add `persistent_objective` column or store in `mission_agents.notes` + `mission_agent_contracts.terms` that agent must maximize legitimate verified earnings toward billionaire target. Contract is default-deny, owner approves.
- **Decision-making:** In `self-management.ts` `requestResource`, `requestUpgrade`, `requestTool`, check if action aligns with earning maximization and billionaire target progress — if not, lower priority. In `treasury.ts` `recordRevenue`, `dailyTargetStatus`, `reinvestmentSummary` already track verified revenue only — use for agent reporting.
- **Honesty rules:** No fabricated revenue, clients, orders, spam, impersonation, ToS/KYC bypass, prohibited activity — already enforced by `ALLOWED_ACTIVITY_KEYS` allow-list and `PROHIBITED_ACTIVITY_KEYS` hard deny-list compiled in. Agents that attempt prohibited activity refused with audited reason. Revenue rows only written from owner action or verified provider record with idempotency key.
- **Fastest lawful opportunities:** Agents discover approved tools (`GET /api/tools`), request resources within budget, monitor expiry, rotate credentials only after real provider verification, record usage/cost, maintain services with health source. Policy `autonomousEnabled` must be deliberately enabled, kill switch suspends all, spend above `requireApprovalAboveCents` queued to owner.

**Implementation plan (after inventory approval):**

1. Add `mission_targets` entry for billionaire target via `createTarget({label: 'Billionaire aspirational', period: 'lifetime', amountCents: 100000000000, currency: 'USD', metric: 'realized_revenue', createdBy: owner})` — owner action only.
2. Extend `mission_agents` or `mission_agent_contracts` to include `persistent_objective` text, seeded as default for all agents, non-removable, audited.
3. Update `self-management.ts` `selfManagementSnapshot()` to include `billionaireTarget` progress from `treasurySummary()` + `dailyTargetStatus()` + `reinvestmentSummary()` — all verified revenue only.
4. Update mission dashboard Overview to show billionaire target as aspirational with real progress from verified receipts only, labeled as target, never as earned.
5. No code creates fake revenue — revenue only via `recordRevenue` with verifier.

---

## 10. Integration Plan — Steps (no code yet)

**Phase 1 — Inventory approval (this doc):**
- Owner reviews this dependency inventory, confirms no fake revenue, no ToS bypass, no prohibited activity.

**Phase 2 — OmniRoute sidecar setup (mission host only):**
- Install OmniRoute via Docker `diegosouzapw/omniroute` or npm `omniroute` on mission host, bind 127.0.0.1:20128, private network only, never public.
- Create owner accounts for free providers (Kiro, Cerebras, NVIDIA NIM, etc.) legitimately, with phone verification where required, respecting ToS.
- Configure providers in OmniRoute dashboard, generate `OMNIROUTE_API_KEY` local API key.
- Store `OMNIROUTE_API_KEY` in mission vault via `storeCredential({provider: 'omniroute', label: 'OmniRoute gateway', secret: key, actorId: owner})` — encrypted, masked hint only.

**Phase 3 — AKBARAL code integration (after approval):**
- Add envs `OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY`, `OMNIROUTE_ENABLED` to `.env.example` commented optional, and to `src/config/env.ts` + `credentials.ts` as optional integration.
- Create `src/models/omniroute.ts` provider class `OmniRouteProvider` that implements `ModelProvider` interface, uses `OMNIROUTE_BASE_URL` + `OMNIROUTE_API_KEY`, forwards chat completions to OmniRoute OpenAI-compatible endpoint, handles streaming, records `recordModelRun` with real cost/tokens.
- Update `src/models/router.ts` to prefer OmniRoute when `OMNIROUTE_ENABLED=1` and `OMNIROUTE_API_KEY` configured — scoring keeps capability/cost/latency but delegates to OmniRoute `auto` model for cheapest viable provider, fallback to direct `GOOGLE_API_KEY` Gemini free tier, then keyless free.
- Update `src/mission/self-management.ts` DEFAULT_TOOLS to include `omniroute_gateway` tool approved, with cost model metered, notes on quota-aware fallback.
- Add per-agent cost controls: `OMNIROUTE_DAILY_TOKEN_BUDGET`, `OMNIROUTE_MONTHLY_COST_CENTS`, `OMNIROUTE_RATE_LIMIT_RPM` envs, checked via `canAgentSpend` before LLM call.
- Ensure secret isolation: `OMNIROUTE_API_KEY` never in platform `.env` accessible to public users, only mission vault, `getConfigStatus()` reports omniroute as mission-only.

**Phase 4 — Billionaire objective:**
- Add billionaire target to `mission_targets`, extend agent contracts with persistent objective, update dashboard Overview to show aspirational progress from verified revenue only.

**Phase 5 — Verification:**
- Run `npm run typecheck`, `npm run build`, `DATABASE_URL=file:./test.db npm run test` for billing, security, mission, database suites — ensure 0 fail, no fake revenue, no ToS bypass, honest provider_not_configured errors.
- Run `npm run mission:pg-check` for PostgreSQL path.
- Audit: ensure no public page/docs mentions ZA141251SA, no secret leaks in bundles, no card_or_bank_api enabled, ledger/audit chains verify.

---

## 11. Risks and Mitigations

- **OmniRoute free tier volatility:** Providers can end free tier without notice, number drops — mitigate by tracking live `/dashboard/free-tiers` used/remaining, fallback to direct Gemini free tier, honest failure when all exhausted.
- **ToS violation:** Some providers prohibit proxy/relay — mitigate by checking each provider's terms, not routing prohibited providers through OmniRoute, owner creates accounts legitimately.
- **Rate limits:** Free tiers 1-10 RPM aggressive — mitigate by per-agent RPM quota, exponential backoff on 429, queue to approval.
- **Security:** OmniRoute self-hosted, single maintainer, emerging maturity — mitigate by binding 127.0.0.1 private, never public, audit logs, secret isolation, circuit breakers.
- **No guaranteed earnings:** Billionaire target aspirational only, progress counts verified revenue only, no fabrication, no spam, no impersonation, no fake clients/orders.

---

**End of inventory — awaiting owner approval before any code modification.**
