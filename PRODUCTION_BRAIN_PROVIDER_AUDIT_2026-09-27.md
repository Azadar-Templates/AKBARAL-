# AKBARAL! + ZA141251SA — production brain / provider / API audit
**Date:** 2026-09-27 · **Commit:** `4e2d7b6` (branch `arena/01a0dd85-akbaral`)

Every line below is derived from the repository, the live databases or the running
processes. Nothing is estimated and nothing is copied from an earlier report.

## 0. How this was produced (re-runnable)

| Evidence | Command | Result today |
|---|---|---|
| Brain / provider map (A, B, C, M) | `npm run brains` (`src/config/brain-map.ts`, 77 rows) | 77 capabilities, locked by `src/config/brain-map.test.ts` (12 tests) |
| Env / credential matrix (F) | `npm run matrix -- --json` (`src/config/dependency-matrix.ts`) | 126 rows, 0 undocumented, 0 stale, 9 tests |
| Launch readiness | `npm run launch:check` | **30 % — 4/14 required checks ready, 7 blockers** |
| Fleet counts (D, G) | live `data/akbaral.db` + `data/mission.db` | 4001 agents in both catalogs, 0 mission owners, verified revenue $0.00 |
| Whole test suite | `npm test` | **148 files · 2100 tests · 0 fail** |
| Secret gate | `npx tsx scripts/scan-secrets.ts` | PASS (22 allow-listed synthetic placeholders) |
| Live runtime | `curl` on the three processes | web `:3000` 200, API `:4000/api/health` 200, mission `:4200` 200 |

Status vocabulary (unchanged): **WORKING** (real execution verified) · **CODE READY** ·
**CREDENTIAL REQUIRED** · **RUNTIME BLOCKED** · **NOT IMPLEMENTED**.

---

## A + B + C + M. Master table — every capability, its brain and its provider

One row per real production path in AKBARAL!, MASTER, the agent fleet and the
ZA141251SA mission. Generated from `src/config/brain-map.ts`; `ACTION` is the exact
owner step, not advice.

| SYSTEM | FUNCTION | BRAIN | PROVIDER | API | TOOL | CREDENTIAL | FREE/PAID | STATUS | BLOCKER | ACTION |
|---|---|---|---|---|---|---|---|---|---|---|
| AKBARAL! | Goal understanding | LLM (AKBARAL model router) | Google / OpenAI / Anthropic / OmniRoute (whichever is confi… | POST {provider}/…:generateContent / /v1/chat/completions / … | — | GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OMNIROUTE_API_K… | FREE TIER | CREDENTIAL REQUIRED | not configured: GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OMNIROUTE… | Create one free Google AI Studio key and store it as GOOGLE_API_KEY. |
| AKBARAL! | Intent classification | LLM (AKBARAL model router) | routed LLM | provider chat endpoint | — | GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OMNIROUTE_API_K… | FREE TIER | CREDENTIAL REQUIRED | not configured: GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OMNIROUTE… | — |
| AKBARAL! | Planner | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | MASTER orchestrator | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Agent router / agent selection | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Model/provider routing | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Specialist agent reasoning | LLM (AKBARAL model router) | routed LLM | provider chat endpoint | — | GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OMNIROUTE_API_K… | FREE TIER | CREDENTIAL REQUIRED | not configured: GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OMNIROUTE… | Provide one LLM key. |
| AKBARAL! | Multi-agent orchestration | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Tool selection | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Tool execution | deterministic engine | none (own code) + per-tool vendors | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Web search | external API | Tavily / Brave / Serper / Google CSE, else keyless DuckDuck… | https://api.tavily.com / https://api.search.brave.com / htt… | web_search | TAVILY_API_KEY / BRAVE_SEARCH_API_KEY / SERPER_API_KEY / GOOGLE_CSE_A… | FREE TIER | CREDENTIAL REQUIRED | not configured: TAVILY_API_KEY / BRAVE_SEARCH_API_KEY / SERPER_API_KEY / GOOGLE… | Optional: a free Tavily/Brave key raises reliability. |
| AKBARAL! | Page fetching | external API | the page host itself | GET {public URL} (SSRF-guarded) | page_fetch | none | FREE | RUNTIME BLOCKED | this runtime cannot open outbound HTTPS to the provider | — |
| AKBARAL! | Web research report | deterministic engine | search provider + page hosts | search + fetch | web_search | none | FREE | RUNTIME BLOCKED | this runtime cannot open outbound HTTPS to the provider | — |
| AKBARAL! | Knowledge search | deterministic engine | none (own code) | — | knowledge_search | none | FREE | WORKING | — | — |
| AKBARAL! | Code repository analysis | deterministic engine | none (own code) | — | code_repository_read | none | FREE | WORKING | — | — |
| AKBARAL! | Documents / file parsing | deterministic engine | none (own code) | — | file_parse_text | none | FREE | WORKING | — | — |
| AKBARAL! | Data analysis | deterministic engine | none (own code) | — | text_analyze | none | FREE | WORKING | — | — |
| AKBARAL! | Excel / spreadsheet output | deterministic engine | none (own code) | — | excel_build | none | FREE | WORKING | — | — |
| AKBARAL! | Image generation | external API | OpenAI (DALL·E 3) | POST https://api.openai.com/v1/images/generations | image_render | OPENAI_API_KEY | PAID | CREDENTIAL REQUIRED | not configured: OPENAI_API_KEY | Add a paid OpenAI key if image generation is wanted (no free tier exists for DALL·E 3). |
| AKBARAL! | Image request approval workflow | deterministic engine | OpenAI (on fulfilment) | images/generations | image_render | OPENAI_API_KEY | PAID | CREDENTIAL REQUIRED | not configured: OPENAI_API_KEY | — |
| AKBARAL! | Video generation | external API | none implemented | — | — | none | OPTIONAL | NOT IMPLEMENTED | no adapter exists in the codebase | — |
| AKBARAL! | Video publishing | external API | YouTube Data API v3 | POST https://www.googleapis.com/upload/youtube/v3/videos | youtube_publish | YOUTUBE_ACCESS_TOKEN | FREE TIER | CREDENTIAL REQUIRED | not configured: YOUTUBE_ACCESS_TOKEN | Complete Google OAuth consent for the YouTube account. |
| AKBARAL! | Audio / speech / OCR | external API | none implemented | — | — | none | OPTIONAL | NOT IMPLEMENTED | no adapter exists in the codebase | — |
| AKBARAL! | Translation | LLM (AKBARAL model router) | routed LLM | provider chat endpoint | — | GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OMNIROUTE_API_K… | FREE TIER | CREDENTIAL REQUIRED | not configured: GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OMNIROUTE… | — |
| AKBARAL! | Business / Marketing / SEO / Social / Ecommerce / Finance-info / Legal-info / Health-info / Travel / Jobs / Support domains | LLM (AKBARAL model router) | routed LLM | provider chat endpoint | — | GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OMNIROUTE_API_K… | FREE TIER | CREDENTIAL REQUIRED | not configured: GOOGLE_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OMNIROUTE… | — |
| AKBARAL! | Maps / places | external API | Google Maps Places | GET https://maps.googleapis.com/maps/api/place/textsearch/j… | maps_place | GOOGLE_API_KEY | PAID | CREDENTIAL REQUIRED | not configured: GOOGLE_API_KEY | Enable the Places API on a billed Google Cloud project if maps are wanted. |
| AKBARAL! | Ecommerce operations | external API | Shopify Admin API | POST https://{shop}/admin/api/2024-01/products.json | shopify_product | SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN | OWNER PAYMENT REQUIRED | CREDENTIAL REQUIRED | not configured: SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN | Own or connect a Shopify store (paid plan). |
| AKBARAL! | Social posting | external API | X API v2 / Instagram Graph | POST https://api.x.com/2/tweets · POST https://graph.facebo… | x_post | X_BEARER_TOKEN / INSTAGRAM_ACCESS_TOKEN | OWNER PAYMENT REQUIRED | CREDENTIAL REQUIRED | not configured: X_BEARER_TOKEN / INSTAGRAM_ACCESS_TOKEN | Create the developer app and complete OAuth. |
| AKBARAL! | Messaging / SMS | external API | Twilio | POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messa… | twilio_message | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN | OWNER PAYMENT REQUIRED | CREDENTIAL REQUIRED | not configured: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN | Fund a Twilio account if SMS is wanted. |
| AKBARAL! | Generic HTTP integration | external API | any public endpoint | GET/POST {public URL} (SSRF-guarded) | http_request | none | FREE | RUNTIME BLOCKED | this runtime cannot open outbound HTTPS to the provider | — |
| AKBARAL! | Output verification | deterministic engine | optional routed LLM for the rubric pass | provider chat endpoint | — | none | FREE | WORKING | — | — |
| AKBARAL! | Task outcome generation | deterministic engine | optional routed LLM | provider chat endpoint | — | none | FREE | WORKING | — | — |
| AKBARAL! | Error recovery | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Provider fallback | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Task lifecycle / queue | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Custom agent builder (Agent Factory) | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Automations / scheduling | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Realtime execution stream | infrastructure | none (own code) | WebSocket /ws or SSE fallback | — | none | FREE | WORKING | — | — |
| AKBARAL! | Email (verification, password reset, notifications) | external API | any SMTP host (Gmail app password, Brevo, Resend SMTP…) | SMTP over TLS/STARTTLS | — | SMTP_HOST, SMTP_USER, SMTP_PASSWORD | FREE TIER | CREDENTIAL REQUIRED | not configured: SMTP_HOST, SMTP_USER, SMTP_PASSWORD | Create a free SMTP sender and set the three variables, then send one real test email. |
| AKBARAL! | OAuth sign-in buttons | external API | Google, GitHub, Microsoft, Facebook, Apple | authorize + token + userinfo endpoints per provider | — | GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID / MS_CLIENT_ID / FACEBOOK_CLIENT_… | FREE | CREDENTIAL REQUIRED | not configured: GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID / MS_CLIENT_ID / FACEBOOK_C… | Register an OAuth client per provider and set the client id/secret pair. |
| AKBARAL! | Customer payments / subscriptions | external API | Stripe (Razorpay adapter also implemented) | POST https://api.stripe.com/v1/checkout/sessions | stripe_payment | STRIPE_SECRET_KEY | OWNER PAYMENT REQUIRED | CREDENTIAL REQUIRED | not configured: STRIPE_SECRET_KEY | Stripe does not onboard Pakistan-resident businesses: this needs an eligible entity or an… |
| AKBARAL! | Payment webhooks | deterministic engine | Stripe | POST /api/billing/webhook (signature verified) | — | STRIPE_WEBHOOK_SECRET | FREE | CREDENTIAL REQUIRED | not configured: STRIPE_WEBHOOK_SECRET | Copy the webhook signing secret from the Stripe dashboard. |
| AKBARAL! | Mobile push notifications | external API | Expo push service | POST https://exp.host/--/api/v2/push/send | — | none | FREE | RUNTIME BLOCKED | this runtime cannot open outbound HTTPS to the provider | Build and install the Expo app to obtain tokens. |
| AKBARAL! | CRM | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| AKBARAL! | Storage / uploads | infrastructure | local filesystem under DATA_DIR | — | — | none | FREE | WORKING | — | Mount a persistent volume at DATA_DIR on the production host. |
| AKBARAL! | Database | infrastructure | SQLite (node:sqlite) or PostgreSQL/Neon | file: or postgres:// URL | — | DATABASE_URL | FREE TIER | WORKING | — | Choose a host with a persistent disk, or create a free Neon project and set DATABASE_URL. |
| ZA141251SA | Mission agent chat | LLM (direct provider call) | Google Gemini (free tier only) | POST https://generativelanguage.googleapis.com/v1beta/model… | gemini_api (mission tool registry) | none | FREE TIER | RUNTIME BLOCKED | this runtime cannot open outbound HTTPS to the provider | Paste a free Google AI Studio key into the mission dashboard (never into chat). |
| ZA141251SA | Chat dispatch worker | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Provider reachability preflight | deterministic engine | Google (unauthenticated probe) | GET https://generativelanguage.googleapis.com/v1beta/models | — | none | FREE | RUNTIME BLOCKED | this runtime cannot open outbound HTTPS to the provider | — |
| ZA141251SA | Agent task understanding / briefing | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Agent memory / context | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Agent identity | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Agent fleet management | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Opportunity discovery / ingestion | external API | 107 registered public platforms (35 keyless, 44 keyed) | per-source public JSON/RSS endpoints (rate-limited, cached) | — | none | FREE | RUNTIME BLOCKED | this runtime cannot open outbound HTTPS to the provider | — |
| ZA141251SA | Opportunity scoring | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Opportunity eligibility (country/KYC/ToS) | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Agent work execution | deterministic engine | platform connectors | per-platform official APIs | — | none | FREE | RUNTIME BLOCKED | this runtime cannot open outbound HTTPS to the provider | Create and verify the platform account; agents may never create accounts. |
| ZA141251SA | Work submission | deterministic engine | Upwork / Freelancer / Contra / Toptal / Fiverr / Awin conne… | official platform APIs only | — | ZA141251SA_FREELANCER_ACCESS_TOKEN / ZA141251SA_AWIN_ACCESS_TOKEN | FREE | CREDENTIAL REQUIRED | not configured: ZA141251SA_FREELANCER_ACCESS_TOKEN / ZA141251SA_AWIN_ACCESS_TOK… | Apply for the platform API programme in the owner’s own name. |
| ZA141251SA | Result verification | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Payment detection | external API | Stripe (mission-owned account, separate from AKBARAL!) | https://api.stripe.com/v1/… | — | ZA141251SA_STRIPE_SECRET_KEY, ZA141251SA_STRIPE_ACCOUNT_ID | OWNER PAYMENT REQUIRED | CREDENTIAL REQUIRED | not configured: ZA141251SA_STRIPE_SECRET_KEY, ZA141251SA_STRIPE_ACCOUNT_ID | Stripe is unavailable to Pakistan-resident accounts; use Payoneer/Wise/bank rails and rec… |
| ZA141251SA | Revenue verification | deterministic engine | payment provider record | provider transaction lookup | — | none | FREE | RUNTIME BLOCKED | this runtime cannot open outbound HTTPS to the provider | — |
| ZA141251SA | Ledger + treasury | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Ledger verification | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Withdrawal methods / cards | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Payout verification | owner action | bank / Payoneer / Wise | out-of-band micro-deposit or statement check | — | none | FREE | WORKING | — | Verify at least one payout slot from the mission dashboard. |
| ZA141251SA | Owner approvals / safety authorization | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Human action gate (KYC, OTP, CAPTCHA) | owner action | the platform demanding it | — | — | none | FREE | WORKING | — | Complete the queued human actions. |
| ZA141251SA | Agent tool selection / authorization | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Credential vault | infrastructure | none (own code) | — | — | ZA141251SA_CREDENTIAL_KEY | FREE | WORKING | — | — |
| ZA141251SA | Resource budgets / call metering | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Agent scheduling | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Agent communication (email/social on behalf) | external API | YouTube / Instagram / TikTok OAuth | platform OAuth authorize + token endpoints | — | TIKTOK_CLIENT_KEY / YOUTUBE_CLIENT_ID / INSTAGRAM_CLIENT_ID | FREE | CREDENTIAL REQUIRED | not configured: TIKTOK_CLIENT_KEY / YOUTUBE_CLIENT_ID / INSTAGRAM_CLIENT_ID | Complete OAuth consent for each platform account. |
| ZA141251SA | Owner authentication | deterministic engine | none (own code) | — | — | ZA141251SA_SESSION_SECRET, ZA141251SA_OWNER_EMAIL | FREE | WORKING | — | Set the owner password through the setup link — never in chat, never in a file. |
| ZA141251SA | Identity lock | deterministic engine | none (own code) | — | — | ZA141251SA_OWNER_EMAIL | FREE | WORKING | — | — |
| ZA141251SA | Audit trail | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Recovery | deterministic engine | none (own code) | — | — | none | FREE | WORKING | — | — |
| ZA141251SA | Mission database | infrastructure | SQLite or PostgreSQL, separate instance from AKBARAL! | file: or postgres:// URL | — | ZA141251SA_DATABASE_URL | FREE TIER | WORKING | — | — |

**Gemini is not the only brain.** 46 of 77 capabilities have *no* model in the path at
all — the planner, MASTER orchestrator, agent router, tool selection, verification,
recovery, ledger, treasury, audit, identity lock and the whole mission money pipeline
are deterministic code with unit tests. Models appear in exactly two shapes:
AKBARAL!'s router (`src/models/*`, 4 providers) and the mission's single direct
Gemini client (`src/mission/chat-provider.ts`). Mission never imports `src/models/*`.

---

## D. The 4,001 agents — what they actually need

Derived from the live catalog (`agent_categories` × `agents`, 1 MASTER + 80 × 50):

| Question | Exact answer |
|---|---|
| Agent identities | **4001** (1 MASTER + 80 categories × 50 specialists); same 4001 in the mission catalog |
| Distinct brain/model configurations | **3** — `reasoning` 3790 agents · `writing` 210 · `long_context+research` 1 |
| Distinct tool profiles | **14** (see below) |
| AI providers needed to cover all 4001 | **1** (any one of Google / OpenAI / Anthropic / OmniRoute). A single free Google AI Studio key serves all 4001 |
| Agents that need a *special* model | **0** — no agent pins a provider-specific model; the router picks per capability profile |
| Agents that need a *special* tool credential | **200** need `image_render` (OpenAI, paid) · **1251** use `web_search` (free search key) · **251** use `page_fetch` (no key, egress only) |
| Executable end-to-end **in this sandbox** | **0** — no LLM credential and no outbound HTTPS |
| Executable on a networked host with one free Google key | **3801** (all but the 200 image agents), of which 1201 additionally want a free search key for full tool coverage |
| Blocked, and why | **200** — `image_render` requires a paid `OPENAI_API_KEY` (no free image provider is implemented) |

Tool profiles (agents per profile, sums to 4001):

| Tool profile | Agents |
|---|---|
| knowledge_search | 1350 |
| excel_build, knowledge_search | 650 |
| knowledge_search, web_search | 650 |
| excel_build, knowledge_search, web_search | 250 |
| code_repository_read, knowledge_search | 200 |
| knowledge_search, page_fetch, web_search | 151 |
| excel_build, file_parse_text, knowledge_search | 150 |
| file_parse_text, knowledge_search | 150 |
| image_render | 150 |
| page_fetch, web_search | 100 |
| code_repository_read, knowledge_search, web_search | 50 |
| code_repository_read, file_parse_text, knowledge_search | 50 |
| excel_build, file_parse_text | 50 |
| image_render, knowledge_search, web_search | 50 |

No per-agent keys exist or are needed: credentials are per *provider*, and the fleet
shares them.

---

## E. Provider inventory — only what is implemented in code

| Category | Implemented in this repository | Not implemented (do not plan around it) |
|---|---|---|
| AI models | Google AI Studio (Gemini), OpenAI, Anthropic, OmniRoute self-hosted gateway (`src/models/`), plus the mission's own direct Gemini client (`src/mission/chat-provider.ts`) | no Mistral/Cohere/Groq/Bedrock/Vertex adapter |
| Search & web | Tavily, Brave Search, Serper.dev, Google Programmable Search, a custom `AKBARAL_SEARCH_ENDPOINT`, a keyless fallback, and `page_fetch` against the page host (`src/agents/search-providers.ts`, `web-research.ts`) | — |
| Media | OpenAI images (DALL·E 3) via `image_render`; YouTube Data API v3 publishing; translation through the routed LLM | **video generation: NOT IMPLEMENTED** · **audio / speech / OCR: NOT IMPLEMENTED** (no adapter exists) |
| Developer | GitHub REST (`GH_TOKEN`/`GITHUB_TOKEN`), local repository analysis, deterministic file/Excel/text tooling | no hosted code-execution sandbox |
| AKBARAL! payments | Stripe (checkout, subscriptions, credits, webhook signature verification, refunds) and a Razorpay adapter (`src/billing/providers.ts`); revenue lands in the AKBARAL! platform account only | no PayPal/Paddle/LemonSqueezy adapter |
| Email | SMTP only (`src/integrations/smtp.ts`) — verification, password reset, owner alerts | no SendGrid/Mailgun/Postmark/Resend API integration |
| Infrastructure | SQLite (`node:sqlite`) and PostgreSQL/Neon behind one driver; local filesystem for uploads and backups; `scripts/start-prod.mjs` supervisor (migrations, artifact check, session-secret persistence, nightly backups); Dockerfile; free-host kits in `deploy/` (snapdeploy, caasify, clawcloud, oracle, render, zeabur) and `deploy/modal`; `stackhost.yaml` | no S3/object store, no CDN adapter, no DNS/TLS automation (host-provided) |
| Mission money | Stripe on a *separate mission account* for payment detection; platform connectors for Upwork, Freelancer, Contra, Fiverr, Toptal, Awin; deterministic settlement verification, ledger, treasury, withdrawal methods and cards | Payoneer / Wise / PayPal / bank+SWIFT/IBAN exist only as **owner-verified payout destination types** (`src/mission/destination-safety.ts`, `earning/country-eligibility.ts`) — there is no banking API and none is required |
| OAuth | Google, GitHub, Microsoft, Apple, Facebook sign-in; YouTube, Instagram/Meta, TikTok publishing OAuth | — |

Undocumented discoveries: **none**. `npm run matrix` reports `undocumented: []` and
`stale: []`, i.e. every environment variable read anywhere in the source is in the
matrix, and every matrix row is still read by the source.

---

## F. Exact API / key matrix (all 126 environment rows)

`CONFIGURED HERE` is this sandbox's `.env`; `REACHABLE HERE` is this sandbox's network
(no egress — see section K). Endpoints per capability are in the master table above.

| SYSTEM | ENV / SECRET NAME | PROVIDER | FUNCTION | USED BY | FREE OPTION | PAYMENT REQUIRED | CONFIGURED HERE | REACHABLE HERE | PRODUCTION REQUIRED | BREAKS WITHOUT / BLOCKER |
|---|---|---|---|---|---|---|---|---|---|---|
| shared | `NODE_ENV` | Node.js runtime | Selects production hardening (secret length checks, cookie flags, error detail). | 9 file(s): session-secret.mjs, search-providers.ts, web-research.ts… | built in | no | no | n/a (local) | OPTIONAL | Runs in development mode: relaxed secret rules and verbose errors. |
| AKBARAL! | `HOST` | Node.js runtime | Bind address of the public server. | 1 file(s): env.ts | built in | no | YES | n/a (local) | OPTIONAL | Binds 0.0.0.0, which is what a container or preview proxy needs. |
| AKBARAL! | `PORT` | Node.js runtime | Public HTTP port (frontend + /api proxy). | 2 file(s): start-prod.mjs, env.ts | built in | no | YES | n/a (local) | OPTIONAL | Defaults to port 3000 for the public server. |
| AKBARAL! | `TRUST_PROXY` | Node.js runtime | Whether X-Forwarded-For may be trusted for client IP and rate limiting. | 1 file(s): env.ts | built in | no | YES | n/a (local) | OPTIONAL | Proxy headers are ignored; rate limits key on the socket address. |
| AKBARAL! | `CORS_ORIGINS` | Node.js runtime | Allow-list of browser origins for the API. | 1 file(s): env.ts | built in | no | no | n/a (local) | OPTIONAL | Same-origin only; cross-origin browser calls are refused. |
| AKBARAL! | `DATABASE_URL` | SQLite / PostgreSQL | Customer-side database connection (file: SQLite or postgres:// DSN). | 6 file(s): owner-analytics.ts, env.ts, checks.ts… | local SQLite file under DATA_DIR — no s… | no | YES | NO — no egress from this sandbox | OPTIONAL | Falls back to the local SQLite file; no data is lost or invented. |
| shared | `DATA_DIR` | filesystem | Root for databases, uploads and backups. | 3 file(s): session-secret.mjs, env.ts, database.ts | built in | no | YES | n/a (local) | OPTIONAL | Uses the ./data folder inside the repository. |
| AKBARAL! | `SESSION_SECRET` | AKBARAL! auth | Signs customer session and refresh tokens. | 5 file(s): session-secret.mjs, start-dev.mjs, start-prod.mjs… | generated locally and persisted (no pro… | no | no | NO — no egress from this sandbox | REQUIRED | Production start is refused; in development a persisted local secret is generated so sessions survive restart… |
| AKBARAL! | `SESSION_SECRET_PREVIOUS` | AKBARAL! auth | Accepts tokens signed by the previous secret during rotation. | 1 file(s): env.ts | generated locally | no | no | n/a (local) | OPTIONAL | A secret rotation logs every session out immediately instead of draining. |
| AKBARAL! | `AKBARAL_SESSION_SECRET_FILE` | AKBARAL! auth | Path of the persisted development session secret. | 1 file(s): session-secret.mjs | built in | no | no | n/a (local) | OPTIONAL | Uses the default path under DATA_DIR. |
| AKBARAL! | `OPENAI_API_KEY` | OpenAI | LLM chat, vision and image generation for customer agents. | 4 file(s): credentials.ts, catalog.ts, registry.ts… | — | yes | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | OpenAI-routed tools return provider_not_configured; nothing is faked and no other provider is silently substi… |
| AKBARAL! | `GOOGLE_API_KEY` | Google AI Studio (Gemini) / Google Places | Gemini model calls and Google Places text search for the tool registry. | 5 file(s): credentials.ts, checks.ts, catalog.ts… | Google AI Studio free tier — no card, p… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | Gemini and Places tools return provider_not_configured. |
| AKBARAL! | `OMNIROUTE_ENABLED` | OmniRoute gateway (self-hosted) | Routes model calls through a private 127.0.0.1 gateway instead of direct providers. | 1 file(s): env.ts | self-hosted, MIT licensed — free to run… | no | no | NO — no egress from this sandbox | OPTIONAL | Model calls go directly to the configured provider. |
| AKBARAL! | `OMNIROUTE_BASE_URL` | OmniRoute gateway (self-hosted) | Gateway endpoint; must stay private (loopback). | 1 file(s): env.ts | self-hosted | no | no | n/a (local) | OPTIONAL | Defaults to the loopback gateway address. |
| AKBARAL! | `OMNIROUTE_API_KEY` | OmniRoute gateway (self-hosted) | Authenticates this app to the local gateway. | 3 file(s): credentials.ts, env.ts, catalog.ts | self-issued by the gateway operator (th… | no | no | NO — no egress from this sandbox | OPTIONAL | The gateway path stays off; direct providers are used. |
| AKBARAL! | `OMNIROUTE_MODEL_AUTO` | OmniRoute gateway (self-hosted) | Model id used for the gateway auto-routing strategy. | 1 file(s): env.ts | self-hosted | no | no | n/a (local) | OPTIONAL | Uses the gateway default model id. |
| AKBARAL! | `AKBARAL_PROVIDER_TIMEOUT_MS` | model client | Hard timeout for a provider HTTP call. | 1 file(s): client.ts | built in | no | no | n/a (local) | OPTIONAL | Uses the built-in timeout. |
| AKBARAL! | `AKBARAL_ALLOW_PRIVATE_PROVIDER` | SSRF guard | Permits provider/search/fetch endpoints on private addresses (local fixtures, local gatew… | 5 file(s): search-providers.ts, web-research.ts, env.ts… | built in | no | no | n/a (local) | OPTIONAL | Private and loopback endpoints are refused by the SSRF guard — the safe default. |
| AKBARAL! | `AKBARAL_SEARCH_PROVIDER` | web search | Explicitly selects the search backend (tavily, brave, serper, google_cse, duckduckgo). | 3 file(s): search-providers.ts, credentials.ts, checks.ts | keyless DuckDuckGo HTML endpoint | no | no | NO — no egress from this sandbox | OPTIONAL | The first provider with credentials is used, else the keyless default. |
| AKBARAL! | `AKBARAL_SEARCH_ENDPOINT` | web search | Custom https:// search proxy endpoint. | 6 file(s): search-providers.ts, web-research.ts, credentials.ts… | keyless DuckDuckGo default | no | no | NO — no egress from this sandbox | OPTIONAL | Uses the selected provider or the keyless default. |
| AKBARAL! | `AKBARAL_SEARCH_RATE_LIMIT` | web search | Per-window cap on agent searches. | 1 file(s): web-research.ts | built in | no | no | n/a (local) | OPTIONAL | Uses the built-in limit. |
| AKBARAL! | `AKBARAL_PAGE_FETCH_ENDPOINT` | page fetch | Optional readability proxy for page extraction. | 2 file(s): web-research.ts, env.ts | direct public fetch with SSRF protection | no | no | n/a (local) | OPTIONAL | Pages are fetched directly from their public URL. |
| AKBARAL! | `GOOGLE_CLIENT_ID` | Google OAuth | Sign in with Google. | 3 file(s): oauth.ts, credentials.ts, platforms.ts | free Google Cloud OAuth client (no char… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Google button renders disabled with the reason shown; email/password sign-in is unaffected. |
| AKBARAL! | `GOOGLE_CLIENT_SECRET` | Google OAuth | Sign in with Google (token exchange). | 3 file(s): oauth.ts, credentials.ts, platforms.ts | free Google Cloud OAuth client | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Google button stays disabled. |
| AKBARAL! | `GITHUB_CLIENT_ID` | GitHub OAuth | Sign in with GitHub. | 2 file(s): oauth.ts, credentials.ts | free GitHub OAuth app | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The GitHub button renders disabled with the reason shown. |
| AKBARAL! | `GITHUB_CLIENT_SECRET` | GitHub OAuth | Sign in with GitHub (token exchange). | 2 file(s): oauth.ts, credentials.ts | free GitHub OAuth app | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The GitHub button stays disabled. |
| AKBARAL! | `MS_CLIENT_ID` | Microsoft OAuth | Sign in with Microsoft. | 2 file(s): oauth.ts, credentials.ts | free Entra ID app registration | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Microsoft button renders disabled with the reason shown. |
| AKBARAL! | `MS_CLIENT_SECRET` | Microsoft OAuth | Sign in with Microsoft (token exchange). | 2 file(s): oauth.ts, credentials.ts | free Entra ID app registration | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Microsoft button stays disabled. |
| AKBARAL! | `APPLE_CLIENT_ID` | Apple OAuth | Sign in with Apple (services id). | 2 file(s): oauth.ts, credentials.ts | — | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Apple button renders disabled with the reason shown. |
| AKBARAL! | `APPLE_CLIENT_SECRET` | Apple OAuth | Pre-generated Apple client assertion, when not derived from the private key. | 1 file(s): oauth.ts | — | no | no | NO — no egress from this sandbox | OPTIONAL | The assertion is derived from APPLE_PRIVATE_KEY instead. |
| AKBARAL! | `APPLE_KEY_ID` | Apple OAuth | Key id of the Apple sign-in key. | 2 file(s): oauth.ts, credentials.ts | — | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Apple button stays disabled. |
| AKBARAL! | `APPLE_TEAM_ID` | Apple OAuth | Apple developer team id. | 2 file(s): oauth.ts, credentials.ts | — | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Apple button stays disabled. |
| AKBARAL! | `APPLE_PRIVATE_KEY` | Apple OAuth | Signs the Apple client assertion. | 2 file(s): oauth.ts, credentials.ts | — | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Apple button stays disabled. |
| AKBARAL! | `OAUTH_GOOGLE_BASE_URL` | Google OAuth | Overrides the Google OAuth host (used by the local test fixture). | 1 file(s): oauth.ts | built in | no | no | n/a (local) | OPTIONAL | Requests go to the real Google OAuth endpoint. |
| AKBARAL! | `OAUTH_GITHUB_BASE_URL` | GitHub OAuth | Overrides the GitHub OAuth host (local fixture). | 1 file(s): oauth.ts | built in | no | no | n/a (local) | OPTIONAL | Requests go to the real GitHub OAuth endpoint. |
| AKBARAL! | `OAUTH_MS_BASE_URL` | Microsoft OAuth | Overrides the Microsoft OAuth host (local fixture). | 1 file(s): oauth.ts | built in | no | no | n/a (local) | OPTIONAL | Requests go to the real Microsoft OAuth endpoint. |
| AKBARAL! | `OAUTH_APPLE_BASE_URL` | Apple OAuth | Overrides the Apple OAuth host (local fixture). | 1 file(s): oauth.ts | built in | no | no | n/a (local) | OPTIONAL | Requests go to the real Apple OAuth endpoint. |
| AKBARAL! | `OAUTH_FACEBOOK_BASE_URL` | Facebook OAuth | Overrides the Facebook OAuth host (local fixture). | 1 file(s): oauth.ts | built in | no | no | n/a (local) | OPTIONAL | Requests go to the real Facebook OAuth endpoint. |
| AKBARAL! | `SMTP_HOST` | SMTP mail server | Delivery host for verification, reset, security and billing email. | 5 file(s): credentials.ts, smtp.ts, checks.ts… | free SMTP tiers exist (e.g. Brevo, Rese… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | Email is NOT delivered. Verification and reset tokens are only recorded in development token mode; no message… |
| AKBARAL! | `SMTP_PORT` | SMTP mail server | TCP port used for SMTP submission. | 3 file(s): smtp.ts, checks.ts, email.ts | — | no | no | n/a (local) | OPTIONAL | Uses the default submission port. |
| AKBARAL! | `SMTP_SECURE` | SMTP mail server | Whether to use implicit TLS on connect instead of STARTTLS. | 1 file(s): smtp.ts | — | no | no | n/a (local) | OPTIONAL | STARTTLS is negotiated instead. |
| AKBARAL! | `SMTP_USER` | SMTP mail server | Login user for the SMTP server. | 5 file(s): credentials.ts, smtp.ts, checks.ts… | free tier account | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | No mail is sent; nothing claims that email works. |
| AKBARAL! | `SMTP_PASSWORD` | SMTP mail server | Password for the SMTP login (primary variable name). | 3 file(s): credentials.ts, smtp.ts, checks.ts | free tier account | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | No mail is sent; nothing claims that email works. |
| AKBARAL! | `SMTP_PASS` | SMTP mail server | Alternate password name accepted by the workforce mailer. | 2 file(s): email.ts, integrations.ts | free tier account | no | no | NO — no egress from this sandbox | OPTIONAL | SMTP_PASSWORD is used. |
| AKBARAL! | `SMTP_FROM` | SMTP mail server | Envelope/from address. | 3 file(s): env.ts, checks.ts, email.ts | — | no | no | NO — no egress from this sandbox | OPTIONAL | Falls back to the configured SMTP user. |
| AKBARAL! | `SMTP_EHLO` | SMTP mail server | EHLO hostname presented to the server. | 1 file(s): smtp.ts | — | no | no | n/a (local) | OPTIONAL | Presents the local hostname in EHLO. |
| AKBARAL! | `SMTP_TIMEOUT_MS` | SMTP mail server | Socket timeout for the SMTP conversation. | 1 file(s): smtp.ts | — | no | no | n/a (local) | OPTIONAL | Uses the built-in timeout. |
| AKBARAL! | `OWNER_ALERT_EMAIL` | SMTP mail server | Destination for workforce/system alerts. | 1 file(s): alerts.ts | — | no | no | n/a (local) | OPTIONAL | Alerts are recorded in the database but not emailed. |
| AKBARAL! | `STRIPE_SECRET_KEY` | Stripe | Customer credit purchases via Payment Intents. | 5 file(s): providers.ts, credentials.ts, checks.ts… | no platform fee to create an account, b… | yes | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | Card checkout is unavailable; credits can only be settled manually by an admin. No fake payment is recorded. |
| AKBARAL! | `STRIPE_WEBHOOK_SECRET` | Stripe | Verifies Stripe webhook signatures. | 3 file(s): checks.ts, billing.ts, integrations.ts | included with a Stripe account | yes | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | Stripe webhooks are rejected as unverified — a payment can never be credited on an unsigned callback. |
| AKBARAL! | `RAZORPAY_KEY_ID` | Razorpay | Alternative card/UPI checkout. | 3 file(s): providers.ts, credentials.ts, checks.ts | account creation is free; Razorpay onbo… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Razorpay path is unavailable; manual settlement only. |
| AKBARAL! | `RAZORPAY_KEY_SECRET` | Razorpay | Signs and verifies Razorpay orders and callbacks. | 4 file(s): providers.ts, credentials.ts, checks.ts… | included with the account | yes | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | Razorpay callbacks cannot be verified and are refused. |
| AKBARAL! | `BILLING_WEBHOOK_SECRET` | billing webhook | HMAC secret for the generic billing webhook. | 4 file(s): credentials.ts, checks.ts, billing.ts… | self-issued local secret | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The endpoint answers webhook_not_configured and credits nothing. |
| AKBARAL! | `AKBARAL_CHECKOUT_SUCCESS_URL` | billing | Return URL after a successful checkout. | 2 file(s): checkout-urls.ts, checks.ts | built in | no | no | n/a (local) | OPTIONAL | Derived from AKBARAL_SITE_URL. |
| AKBARAL! | `AKBARAL_CHECKOUT_CANCEL_URL` | billing | Return URL after a cancelled checkout. | 2 file(s): checkout-urls.ts, checks.ts | built in | no | no | n/a (local) | OPTIONAL | Derived from AKBARAL_SITE_URL. |
| AKBARAL! | `AKBARAL_MARKETPLACE_COMMISSION_BPS` | marketplace | Commission taken on marketplace sales, in basis points. | 1 file(s): env.ts | built in | no | no | n/a (local) | OPTIONAL | Uses the built-in default rate. |
| AKBARAL! | `TWILIO_ACCOUNT_SID` | Twilio | SMS/WhatsApp sending tool. | 4 file(s): credentials.ts, catalog.ts, registry.ts… | trial credit only; production sending i… | yes | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The messaging tool returns provider_not_configured. |
| AKBARAL! | `TWILIO_AUTH_TOKEN` | Twilio | Twilio API authentication. | 4 file(s): credentials.ts, catalog.ts, registry.ts… | trial credit only | yes | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The messaging tool returns provider_not_configured. |
| AKBARAL! | `YOUTUBE_ACCESS_TOKEN` | YouTube Data API v3 | Publishing tool for YouTube. | 3 file(s): credentials.ts, registry.ts, integrations.ts | free API quota, but requires a Google C… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The YouTube tool returns provider_not_configured. |
| AKBARAL! | `INSTAGRAM_ACCESS_TOKEN` | Instagram Graph API | Publishing tool for Instagram. | 3 file(s): credentials.ts, registry.ts, integrations.ts | free API, but requires a Meta app, busi… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Instagram tool returns provider_not_configured. |
| AKBARAL! | `X_BEARER_TOKEN` | X API v2 | Posting tool for X. | 3 file(s): credentials.ts, registry.ts, integrations.ts | the free X tier allows very limited pos… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The X tool returns provider_not_configured. |
| AKBARAL! | `SHOPIFY_STORE_DOMAIN` | Shopify Admin API | Target store for the commerce tool. | 4 file(s): credentials.ts, catalog.ts, registry.ts… | development store is free; a live store… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Shopify tool returns provider_not_configured. |
| AKBARAL! | `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API | Admin API authentication. | 4 file(s): credentials.ts, catalog.ts, registry.ts… | included with a store | yes | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Shopify tool returns provider_not_configured. |
| ZA141251SA | `GITHUB_TOKEN` | GitHub REST API | Raises the GitHub search rate limit while ingesting public paid-issue opportunities. | 1 file(s): opportunity-ingestion.ts | unauthenticated search works at a much … | no | YES | NO — no egress from this sandbox | OPTIONAL | Ingestion still runs unauthenticated and is throttled sooner. |
| ZA141251SA | `GH_TOKEN` | GitHub REST API | Alternate name for the GitHub token. | 1 file(s): opportunity-ingestion.ts | unauthenticated search | no | YES | NO — no egress from this sandbox | OPTIONAL | GITHUB_TOKEN is used, or the unauthenticated rate limit applies. |
| AKBARAL! | `AKBARAL_EXPO_PUSH_URL` | Expo push service | Mobile push delivery endpoint. | 1 file(s): expo-push.ts | Expo push is free for reasonable volumes | no | no | NO — no egress from this sandbox | OPTIONAL | Uses the default Expo endpoint. |
| AKBARAL! | `AKBARAL_ADSENSE_CLIENT` | Google AdSense | Publishes ads.txt for the site. | 1 file(s): route.ts | free AdSense account (approval required) | no | no | NO — no egress from this sandbox | OPTIONAL | ads.txt is served empty; no ad claim is made. |
| AKBARAL! | `AKBARAL_SITE_URL` | AKBARAL! site | Canonical public URL for robots.txt, sitemap and checkout returns. | 5 file(s): robots.ts, sitemap.ts, checkout-urls.ts… | built in | no | no | n/a (local) | OPTIONAL | Uses the local origin; sitemap/robots point at localhost. |
| AKBARAL! | `AKBARAL_PUBLIC_WEB_URL` | AKBARAL! site | Public web origin used when building absolute links. | 1 file(s): env.ts | built in | no | YES | n/a (local) | OPTIONAL | Falls back to AKBARAL_SITE_URL or the request origin. |
| AKBARAL! | `AKBARAL_UPLOAD_DIR` | filesystem | Where customer uploads are written. | 3 file(s): owner-analytics.ts, env.ts, checks.ts | built in | no | YES | n/a (local) | OPTIONAL | Uses the uploads folder under DATA_DIR. |
| AKBARAL! | `AKBARAL_REALTIME_TRANSPORT` | realtime stream | Selects the execution-stream transport (SSE or WebSocket). | 2 file(s): index.ts, execution-stream.ts | built in | no | no | n/a (local) | OPTIONAL | Uses the default transport. |
| shared | `AKBARAL_ENABLE_MISSION_BOSS_BRIDGE` | mission bridge | Opt-in, token-guarded read-only bridge that exposes mission status to the owner console. | 1 file(s): app.ts | built in | no | no | NO — no egress from this sandbox | OPTIONAL | The bridge route is not mounted at all — mission data stays entirely off the public app. This is the safe def… |
| shared | `ZA141251SA_DASHBOARD_TOKEN` | mission bridge | Bearer token the bridge demands before returning any mission status. | 2 file(s): app.ts, boss-dashboard.ts | self-issued local secret | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The bridge refuses every request even when enabled. |
| shared | `MISSION_DASHBOARD_TOKEN` | mission bridge | Legacy name for the bridge token. | 2 file(s): app.ts, boss-dashboard.ts | self-issued local secret | no | no | NO — no egress from this sandbox | OPTIONAL | ZA141251SA_DASHBOARD_TOKEN is used. |
| ZA141251SA | `ZA141251SA_DATABASE_URL` | SQLite / PostgreSQL | Mission database — separate from the customer database by design. | 3 file(s): checks.ts, database.ts, reporting.ts | local SQLite file — no server, no accou… | no | YES | NO — no egress from this sandbox | OPTIONAL | Uses the local mission SQLite file; it never shares the AKBARAL! database. |
| ZA141251SA | `MISSION_DATABASE_URL` | SQLite / PostgreSQL | Alternate name for the mission database URL. | 1 file(s): database.ts | local SQLite file | no | no | n/a (local) | OPTIONAL | ZA141251SA_DATABASE_URL or the default file is used. |
| ZA141251SA | `ZA141251SA_SESSION_SECRET` | mission auth | Signs mission owner sessions — never shared with AKBARAL! sessions. | 3 file(s): mission-init.ts, checks.ts, database.ts | generated locally | no | YES | NO — no egress from this sandbox | REQUIRED | The mission server refuses to start rather than sign sessions with a weak or shared secret. |
| ZA141251SA | `ZA141251SA_CREDENTIAL_KEY` | mission credential vault | Encrypts every provider key stored for an agent (including free-tier chat keys). | 3 file(s): checks.ts, auth.ts, database.ts | generated locally | no | YES | NO — no egress from this sandbox | REQUIRED | Credential storage is refused — no key can be saved, so agent chat cannot be enabled. |
| ZA141251SA | `ZA141251SA_OWNER_EMAIL` | mission auth | The single authorised owner identity; every other account is swept away at start. | 4 file(s): mission-init.ts, mission-serve.ts, checks.ts… | — | no | YES | NO — no egress from this sandbox | REQUIRED | Identity lockdown cannot be enforced and the mission server refuses to run. |
| ZA141251SA | `ZA141251SA_PORT` | mission server | Mission HTTP port (separate process from AKBARAL!). | 1 file(s): database.ts | built in | no | YES | n/a (local) | OPTIONAL | Defaults to port 4200 for the private mission server. |
| ZA141251SA | `ZA141251SA_BIND_HOST` | mission server | Network interface the private mission server binds to. | 1 file(s): database.ts | built in | no | YES | n/a (local) | OPTIONAL | Uses the default bind host. |
| ZA141251SA | `ZA141251SA_SITE_URL` | mission server | Canonical mission URL used in owner access links. | 1 file(s): server.ts | built in | no | YES | n/a (local) | OPTIONAL | Links are built from the request origin. |
| ZA141251SA | `ZA141251SA_SESSION_TTL_HOURS` | mission auth | Owner session lifetime. | 1 file(s): auth.ts | built in | no | no | n/a (local) | OPTIONAL | Uses the built-in session lifetime. |
| ZA141251SA | `ZA141251SA_ACCESS_LINK_HOURS` | mission auth | Lifetime of a one-time owner access link. | 1 file(s): auth.ts | built in | no | no | n/a (local) | OPTIONAL | Uses the built-in link lifetime. |
| ZA141251SA | `ZA141251SA_CURRENCY` | mission treasury | Ledger currency for wallets, receipts and payouts. | 1 file(s): database.ts | built in | no | no | n/a (local) | OPTIONAL | The mission ledger currency defaults to USD. |
| ZA141251SA | `ZA141251SA_PAYOUT_VERIFICATION_DAYS` | mission treasury | How long a receipt must age before its money counts as verified. | 1 file(s): payout-verification.ts | built in | no | no | n/a (local) | OPTIONAL | Uses the built-in verification window. |
| ZA141251SA | `ZA141251SA_STRIPE_SECRET_KEY` | Stripe (mission-only account) | Mission money provider — deliberately never falls back to the AKBARAL! Stripe key. | 2 file(s): money-stripe.ts, withdrawal-methods.ts | no free option; Stripe is not available… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | No external money can be received or verified through Stripe. Verified revenue stays $0.00 and payouts stay u… |
| ZA141251SA | `ZA141251SA_STRIPE_ACCOUNT_ID` | Stripe (mission-only account) | Identifies the mission Stripe account for receipts and withdrawal methods. | 2 file(s): money-stripe.ts, withdrawal-methods.ts | no free option | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Stripe withdrawal method cannot be configured. |
| ZA141251SA | `ZA141251SA_CHAT_WORKER_ENABLED` | mission chat worker | Runs the queued agent-chat worker loop. | 1 file(s): mission-chat-worker.ts | built in | no | no | NO — no egress from this sandbox | OPTIONAL | Chat messages are recorded and queued but no reply is generated. |
| ZA141251SA | `ZA141251SA_MONEY_WORKER_ENABLED` | mission money worker | Runs receipt verification and payout progression. | 1 file(s): mission-money-worker.ts | built in | no | no | n/a (local) | OPTIONAL | Receipts stay pending until the worker is run manually. |
| AKBARAL! | `FACEBOOK_CLIENT_ID` | Facebook OAuth | Sign in with Facebook. | 1 file(s): oauth.ts | free Meta app | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Facebook button renders disabled with the reason shown. |
| AKBARAL! | `FACEBOOK_CLIENT_SECRET` | Facebook OAuth | Sign in with Facebook (token exchange). | 1 file(s): oauth.ts | free Meta app | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Facebook button stays disabled. |
| AKBARAL! | `TAVILY_API_KEY` | Tavily search | Search backend for the agent web_search tool. | 4 file(s): search-providers.ts, credentials.ts, checks.ts… | Tavily has a free monthly credit tier (… | no | no | NO — no egress from this sandbox | OPTIONAL | Search falls through to the next configured provider, else the keyless DuckDuckGo default. |
| AKBARAL! | `BRAVE_SEARCH_API_KEY` | Brave Search API | Search backend for the agent web_search tool. | 4 file(s): search-providers.ts, credentials.ts, checks.ts… | Brave offers a free query tier (card re… | no | no | NO — no egress from this sandbox | OPTIONAL | Search falls through to the next provider or the keyless default. |
| AKBARAL! | `SERPER_API_KEY` | Serper.dev | Search backend for the agent web_search tool. | 4 file(s): search-providers.ts, credentials.ts, checks.ts… | Serper grants free starter credits (acc… | no | no | NO — no egress from this sandbox | OPTIONAL | Search falls through to the next provider or the keyless default. |
| AKBARAL! | `GOOGLE_CSE_API_KEY` | Google Programmable Search | Search backend for the agent web_search tool. | 3 file(s): search-providers.ts, credentials.ts, checks.ts | 100 free queries/day, then paid | no | no | NO — no egress from this sandbox | OPTIONAL | Search falls through to the next provider or the keyless default. |
| AKBARAL! | `GOOGLE_CSE_ID` | Google Programmable Search | Search engine id paired with the CSE key. | 3 file(s): search-providers.ts, credentials.ts, checks.ts | free to create | no | no | NO — no egress from this sandbox | OPTIONAL | The Google CSE backend stays unavailable even if the key is set. |
| AKBARAL! | `ANTHROPIC_API_KEY` | Anthropic | Claude model calls from the customer model catalog. | 2 file(s): credentials.ts, catalog.ts | — | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | Anthropic models are listed as unavailable and calls return provider_not_configured. |
| AKBARAL! | `GEMINI_API_KEY` | Google AI Studio (Gemini) | Accepted alias for GOOGLE_API_KEY in the launch checks. | 1 file(s): checks.ts | Google AI Studio free tier | no | no | NO — no egress from this sandbox | OPTIONAL | GOOGLE_API_KEY is used; if neither is set, MASTER AI and every model-backed agent return provider_not_configu… |
| AKBARAL! | `AKBARAL_BACKUP_DIR` | filesystem | Backup directory checked by the launch readiness checks. | 1 file(s): checks.ts | built in | no | no | n/a (local) | OPTIONAL | The check inspects data/backups. |
| AKBARAL! | `AKBARAL_ROLES` | process supervisor | Which tiers this container runs: both, web or api. | 1 file(s): start-prod.mjs | built in | no | no | n/a (local) | OPTIONAL | Runs both tiers in one container. |
| AKBARAL! | `AKBARAL_WEB_PORT` | process supervisor | Public web port when it must differ from PORT. | 1 file(s): start-prod.mjs | built in | no | no | n/a (local) | OPTIONAL | Uses PORT, else 3000. |
| AKBARAL! | `AKBARAL_API_PORT` | process supervisor | Internal API port the public tier proxies to. | 1 file(s): start-prod.mjs | built in | no | no | n/a (local) | OPTIONAL | Uses 4000, moving itself if that collides with the public port. |
| AKBARAL! | `AKBARAL_AUTO_BUILD` | process supervisor | Rebuilds the bundle at container start when the build output is missing. | 1 file(s): start-prod.mjs | built in | no | no | n/a (local) | OPTIONAL | A missing build output is reported and the process exits instead of self-healing. |
| AKBARAL! | `SEED_DATABASE` | process supervisor | Seeds the agent registry and plans on first start. | 1 file(s): start-prod.mjs | built in | no | no | n/a (local) | OPTIONAL | No seeding step runs; existing data is left untouched. |
| AKBARAL! | `BACKUP_DIR` | filesystem | Destination of the scheduled database backup. | 1 file(s): start-prod.mjs | built in | no | no | n/a (local) | OPTIONAL | Backups are written to /data/backups. |
| AKBARAL! | `BACKUP_KEEP` | filesystem | How many backup files to retain. | 1 file(s): start-prod.mjs | built in | no | no | n/a (local) | OPTIONAL | Keeps the last 30 backup files by default. |
| AKBARAL! | `DISABLE_BACKUP_CRON` | filesystem | Turns the in-container backup schedule off. | 2 file(s): start-prod.mjs, checks.ts | built in | no | no | n/a (local) | OPTIONAL | Backups run on their schedule (the safe default). |
| ZA141251SA | `ZA141251SA_OWNER_PASSWORD` | mission auth (setup only) | One-shot input to the owner password setup script; stored only as a hash and never read a… | 3 file(s): mission-init.ts, mission-serve.ts, checks.ts | — | no | no | NO — no egress from this sandbox | OPTIONAL | The setup script asks for the password instead; the running server never reads this variable. |
| shared | `YOUTUBE_CLIENT_ID` | Google (YouTube Data API v3) | OAuth client id used to obtain a YouTube publishing token. | 2 file(s): checks.ts, platforms.ts | free Google Cloud project; YouTube Data… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The YouTube connect button reports the platform as unavailable; nothing can be published. |
| shared | `YOUTUBE_CLIENT_SECRET` | Google (YouTube Data API v3) | OAuth client secret paired with YOUTUBE_CLIENT_ID. | 2 file(s): checks.ts, platforms.ts | free | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The authorization code cannot be exchanged, so no YouTube connection is ever created. |
| shared | `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth | Alternative name accepted for the Google/YouTube OAuth client id. | 2 file(s): checks.ts, platforms.ts | free | no | no | NO — no egress from this sandbox | OPTIONAL | Only matters when YOUTUBE_CLIENT_ID is not set; the platform stays unavailable. |
| shared | `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth | Alternative name accepted for the Google/YouTube OAuth client secret. | 2 file(s): checks.ts, platforms.ts | free | no | no | NO — no egress from this sandbox | OPTIONAL | Only matters when YOUTUBE_CLIENT_SECRET is not set. |
| shared | `INSTAGRAM_CLIENT_ID` | Meta (Instagram Graph API) | OAuth client id for Instagram publishing. | 2 file(s): checks.ts, platforms.ts | free developer app; Graph API calls are… | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | Instagram is reported unavailable; the connect button is disabled rather than dead. |
| shared | `INSTAGRAM_CLIENT_SECRET` | Meta (Instagram Graph API) | OAuth client secret for Instagram publishing. | 2 file(s): checks.ts, platforms.ts | free | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | No Instagram token can be exchanged or refreshed. |
| shared | `META_APP_ID` | Meta (Instagram Graph API) | Alternative name accepted for the Instagram/Meta app id. | 2 file(s): checks.ts, platforms.ts | free | no | no | NO — no egress from this sandbox | OPTIONAL | Only matters when INSTAGRAM_CLIENT_ID is not set. |
| shared | `META_APP_SECRET` | Meta (Instagram Graph API) | Alternative name accepted for the Instagram/Meta app secret. | 2 file(s): checks.ts, platforms.ts | free | no | no | NO — no egress from this sandbox | OPTIONAL | Only matters when INSTAGRAM_CLIENT_SECRET is not set. |
| shared | `TIKTOK_CLIENT_KEY` | TikTok for Developers | Client key for the TikTok content posting OAuth flow. | 2 file(s): checks.ts, platforms.ts | free developer account | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | TikTok is reported unavailable and no authorization URL is produced. |
| shared | `TIKTOK_CLIENT_SECRET` | TikTok for Developers | Client secret paired with TIKTOK_CLIENT_KEY. | 2 file(s): checks.ts, platforms.ts | free | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The TikTok token exchange and refresh both refuse to run. |
| ZA141251SA | `ZA141251SA_AWIN_ENABLED` | Awin affiliate network | Feature switch for the Awin earning connector. | 1 file(s): awin.ts | free publisher account (subject to appr… | no | no | NO — no egress from this sandbox | OPTIONAL | The Awin connector stays off, which is the default. |
| ZA141251SA | `ZA141251SA_AWIN_PUBLISHER_ID` | Awin affiliate network | Publisher id used on every Awin API call. | 1 file(s): awin.ts | free publisher account after approval | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | Awin calls fail closed with awin_credentials_required; no commission can be read or recorded. |
| ZA141251SA | `ZA141251SA_AWIN_ACCESS_TOKEN` | Awin affiliate network | OAuth2 token for the Awin publisher API. | 1 file(s): awin.ts | free with an approved account | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Awin connector refuses to run rather than estimating commission; no earning is recorded. |
| ZA141251SA | `ZA141251SA_FREELANCER_ENABLED` | Freelancer.com API | Feature switch for the Freelancer earning connector. | 1 file(s): freelancer.ts | free account | no | no | NO — no egress from this sandbox | OPTIONAL | The Freelancer connector stays off, which is the default. |
| ZA141251SA | `ZA141251SA_FREELANCER_USER_ID` | Freelancer.com API | Numeric user id whose bids and milestones are read. | 1 file(s): freelancer.ts | free account | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The connector denies with credentials_required; no bid or settlement is ever submitted. |
| ZA141251SA | `ZA141251SA_FREELANCER_ACCESS_TOKEN` | Freelancer.com API | OAuth token for the Freelancer API. | 1 file(s): freelancer.ts | free with an account | no | no | NO — no egress from this sandbox | CREDENTIAL REQUIRED | The Freelancer connector denies with credentials_required: no bid, milestone read or settlement is attempted. |
| shared | `PGSSLMODE` | PostgreSQL / Neon | TLS mode passed to the Postgres bridge (for example require). | 1 file(s): backup-pg.ts | built in | no | no | n/a (local) | OPTIONAL | The driver uses the mode encoded in the connection URL; managed providers normally require sslmode=require in… |

---

## G. Exact totals

| Total | Value |
|---|---|
| Agent identities | 4001 |
| Agent categories | 80 |
| Distinct reasoning/model configurations | 3 |
| Distinct tool profiles | 14 |
| AI providers implemented | 4 |
| Tool integrations registered | 18 |
| Capabilities mapped | 77 |
| Distinct external endpoints | 29 |
| Credential names required | 38 |
| Credential names configured in this runtime | 5 |
| Providers reachable from this runtime | **0** |
| Capabilities WORKING | 46 |
| Capabilities CODE READY | 0 |
| Capabilities CREDENTIAL REQUIRED | 20 |
| Capabilities RUNTIME BLOCKED | 9 |
| Capabilities NOT IMPLEMENTED | 2 (video generation; audio/speech/OCR) |
| Environment variables documented | 126 (43 credential-bearing, 4 hard-required, 79 optional) |
| Executable agents here / on a networked host with one free key | 0 / 3801 |
| Blocked agents and reason | 200 — paid OpenAI image credential |
| Mission owners | 0 (one single-use setup link pending) |
| Mission verified revenue | **$0.00** — no external money has been received or verified |

Blocking classes, exactly three:
1. **RUNTIME BLOCKED (9 capabilities, all agents)** — this host has no outbound HTTPS.
2. **CREDENTIAL REQUIRED (20 capabilities)** — the named key is not set anywhere.
3. **NOT IMPLEMENTED (2 capabilities)** — no adapter exists in the codebase.

---

## H. Zero-upfront classification

| Class | Providers |
|---|---|
| **FREE** (no account, no money) | own deterministic engines (46 capabilities), SQLite, local storage/backups, page fetch, Expo push, keyless search fallback, GitHub REST (unauthenticated limits) |
| **FREE TIER** (account, no card) | Google AI Studio / Gemini — permanent free tier, rate-limited; Tavily / Brave / Serper / Google CSE; Gmail SMTP app password; Neon Postgres; YouTube, Instagram/Meta, TikTok, Google/GitHub/Microsoft/Facebook OAuth; the free hosts in `deploy/` |
| **PAID** | OpenAI (images, `image_render`), Google Maps Places, Anthropic |
| **OWNER PAYMENT REQUIRED** (business account, not a purchase) | Stripe (AKBARAL! customer payments), Stripe mission account (payment detection), Shopify, X API, Twilio |
| **OPTIONAL** | OmniRoute gateway, Razorpay, AdSense, video/audio adapters (not implemented) |

**Recommended purchases: none.** Public launch needs only free-tier accounts plus a
free host. Stripe costs nothing to open and only takes a percentage of real revenue.
The only genuinely paid item is image generation (200 agents), which can stay disabled
— those agents are correctly reported as CREDENTIAL REQUIRED, never as working.

---

## I. Split of results

**MUST WORK FOR AKBARAL! PUBLIC LAUNCH** (33 capabilities, 23 already working):
outbound egress · `SESSION_SECRET` · `AKBARAL_SITE_URL` + TLS domain · database ·
seeded registry · one LLM key · one search key · SMTP · Stripe + webhook secret +
return URLs. Everything else in the group (planner, MASTER, routing, tools,
knowledge, documents, Excel, CRM, realtime, storage, verification, recovery) is
already WORKING.

**MUST WORK FOR MISSION** (30 capabilities, 23 already working): egress · mission DB ·
`ZA141251SA_SESSION_SECRET` · `ZA141251SA_CREDENTIAL_KEY` · `ZA141251SA_OWNER_EMAIL`
(all four configured) · the owner's own password via the pending setup link · one
Gemini key in the vault for agent chat · platform tokens only when the owner chooses
a platform. Ledger, treasury, audit chain, identity lock, approvals, withdrawal
methods, payout verification are WORKING.

**CAN BE ENABLED LATER** (14 capabilities, 0 working): images, video publishing,
translation via LLM, maps, ecommerce, social posting, SMS, customer payments beyond
launch, push, agent social/email communication. None blocks launch.

**HUMAN ACTION REQUIRED**: the ordered list at the end of this document.

**ARENA CAN FIX NOW**: done in section J — nothing safe remains unimplemented.

---

## J. Implemented in this pass (code, not recommendations)

1. **`src/config/brain-map.ts` + `scripts/brain-map.ts` (`npm run brains`)** — the
   source-of-truth brain/provider/tool/credential map for all 77 capabilities, with
   `--json|--blockers|--owner|--offline`, live credential + reachability resolution,
   and 12 tests. Sections A, B, C, D, G, I are generated from it.
2. **`src/config/dependency-matrix.ts`** — completed to **126 rows** (17 variables that
   were read by code but undocumented: YouTube/Google-OAuth/Instagram/Meta/TikTok
   ids+secrets, Awin ×3, Freelancer ×3, `PGSSLMODE`), placeholder "same as above"
   breakage text replaced with the real consequence, 0 undocumented / 0 stale enforced
   by test.
3. **`src/launch/checks.ts` — new required `runtime.egress` check.** An unauthenticated
   outbound HTTPS probe runs *first*; when the host has no internet the whole report is
   blocked with `unreachable — no outbound HTTPS from this host`. Readiness can no
   longer be declared from a sandbox.
4. **`src/config/google-model-lifecycle.ts`** — retirement/free-tier table for the
   Gemini model IDs (incl. the 2026-10-20 retirements). `chat-state.ts`,
   `chat-provider.ts`, mission `server.ts`, `mission-dashboard/app.js` and the launch
   check now resolve the model from it instead of hardcoding one, warn 90 days before
   retirement, and send the correct thinking parameter shape per model generation
   (`thinkingLevel` on Gemini 3.x, `thinking_budget` on 2.5). Effective default today:
   `gemini-3.5-flash-lite`.
5. **`scripts/launch-check.ts`** — loads `.env` the way the application does, so the
   local check reports the same configuration the server would see.
6. **`scripts/mission-serve.ts`** — may bind a public host when a pending one-time
   owner-setup link exists; still refuses when there is neither an owner nor a pending
   setup, so the private dashboard is never exposed ownerless.
7. **`scripts/scan-secrets.ts`** — the launch gate now skips files that are *untracked
   and git-ignored* (a developer's local `.env` cannot reach a commit), always scans
   everything git could commit, falls back to scanning everything outside a git work
   tree, and exposes `--all`. Two new tests lock both directions.
8. **Test fixtures made hermetic against the production identity lock** — 20 mission
   test files now bind the single-identity lockdown to their own throwaway owner
   (`src/mission/testing/locked-owner.ts`) instead of silently depending on the lock
   being off. The production lock is untouched and stays ENFORCED; the suite no longer
   breaks when a real deployment `.env` is present. Full suite: **2100 pass / 0 fail**.
9. **OAuth honesty verified, not changed** — `public/app.js` already renders
   unconfigured providers as `disabled aria-disabled="true"` with a "Not configured"
   row. No fake clickable buttons exist.

---

## K. Runtime network — the production answer

This sandbox has **no outbound HTTPS**: Gemini, OpenAI, Anthropic and Stripe reset the
connection, `api.github.com` fails TLS verification, only the npm registry answers.
That is a property of *this* sandbox, not of the architecture, and the code now states
it: `runtime.egress` is a required launch check and every affected capability reports
RUNTIME BLOCKED rather than "ready".

Production host decision (**re-verified 2026-09-27 evening, $0/no-card rule**):
`docs/FINAL_HOSTING_VERIFICATION_2026-09-22.md` rejected every kit in `deploy/`
(SnapDeploy $1 card hold, Caasify balance top-up, ClawCloud shut down, Render
card at signup, Zeabur no free compute, Oracle card identity check, Modal $1
cap). **Koyeb — recommended earlier today — was withdrawn the same day: it has
required a card ($29 hold) since February 2026.** The full comparison now lives
in `deploy/FREE_HOSTING_MATRIX.md`.

Chosen free path: **`deploy/free-hf-spaces`** — Hugging Face Spaces (Docker SDK,
CPU Basic): no card, 2 vCPU / 16 GB RAM, unmetered CPU, free `*.hf.space` HTTPS
hostname, per-Space secrets, outbound internet, and it only sleeps after 48 h
idle. Durable state goes to **two separate free Neon Postgres projects** (no
card, permanent, commercial use allowed) — one for AKBARAL!, one for
ZA141251SA, which also keeps the two planes in physically separate databases.
Uploads stay ephemeral; `SESSION_SECRET` is set explicitly. **No domain is
required**: `src/config/platform-url.ts` detects the host's own free hostname
and the launch gate accepts it.

`stackhost.yaml` still documents the generic path, and the private tier has its
own production entry point: `AKBARAL_ROLES=mission` runs
`dist/src/mission/serve.js` alone with its own port, database, auth and
secrets — never started by the public roles.

**Conclusion:** the architecture is configured for a networked production host. Do not
retry provider endpoints from this sandbox; the first real provider proof must be run
on the deployment host (`npm run launch:check --deep` there).

---

## L. Mission end-state architecture (what the code actually enforces)

| Stage | Component | Status |
|---|---|---|
| Agent identity | `src/mission/agent-identity.ts` — 4001 catalog identities, per-agent briefing | WORKING |
| Real brain | `chat-provider.ts` — direct Gemini, fixed URL, key only in `x-goog-api-key`, per-call vault decryption, reply must have 1 candidate + `finishReason STOP` + text ≤12000 + `responseId` + `usageMetadata` | CREDENTIAL REQUIRED + RUNTIME BLOCKED |
| Real approved tools | `self-management.ts` tool grants + `owner-safety-gate.ts` authorization | WORKING |
| Real task | `earning/earning-engine.ts` jobs bound to a real opportunity | WORKING |
| Real external work | `earning/platform-connectors.ts` (Upwork, Freelancer, Contra, Fiverr, Toptal, Awin) | RUNTIME BLOCKED (egress) + CREDENTIAL REQUIRED per platform |
| Real result | `earning/execution-pipeline.ts` with content hashes and owner approval of the exact hash | WORKING |
| Verification | `verifyAgentOutput` + `earning/settlement-verification.ts` — contract checks, no model in the path | WORKING |
| Real payment if earned | Stripe on the *mission* account, payment detection only | CREDENTIAL REQUIRED |
| Verified settlement | `settlement-verification.ts` — an amount becomes revenue only when the provider record confirms money received | WORKING |
| Mission ledger | `treasury.ts` + audit chain (verified, 12009 entries) | WORKING |

Today: 0 mission owners, 0 ledger entries, **verified revenue $0.00**. No agent is
earning, and nothing in the code can report earnings before a verified external
settlement.

---

## Remaining human actions — exact order

Everything below needs the owner; none of it can be done from here. **Never send a
secret in chat** — every value goes into the host's secret store or the mission vault.

1. **Finish the mission owner setup** (link already issued, single use, expires
   2026-09-27 13:08:15Z): open the setup URL, type your own password. It is never
   printed, stored or transmitted anywhere but the scrypt hash. Re-issue with
   `npx tsx scripts/mission-owner-setup-link.ts --base=<url> --ttl=120`, revoke with
   `--revoke`.
2. **Deploy AKBARAL! to a free host with egress** (`deploy/free-snapdeploy` kit) and
   point your domain at it with TLS.
3. In the host's secret store set, in this order: `SESSION_SECRET` (32+ random chars —
   `scripts/start-prod.mjs` generates and persists one if you skip it),
   `AKBARAL_SITE_URL=https://<domain>`, `DATABASE_URL` (free Neon project or the
   host's persistent disk).
4. Run `npm run db:migrate && npm run db:seed`, then `npm run audit:registry`.
5. Create a **free Google AI Studio key** and set `GOOGLE_API_KEY`. This single key
   unblocks goal understanding, intent classification, specialist reasoning,
   translation and the business/marketing/SEO/social capabilities for all 4001 agents.
6. Create **one free search key** — `TAVILY_API_KEY` recommended — for web research
   (1251 agents use it).
7. Create an **SMTP account** (Gmail app password is free) and set
   `SMTP_HOST/SMTP_USER/SMTP_PASSWORD/SMTP_FROM`. Email must not be called working
   until a real delivery is observed.
8. **Stripe**: create the account, set `STRIPE_SECRET_KEY`, add the webhook endpoint
   `https://<domain>/api/billing/webhook/stripe` for `checkout.session.completed`,
   `payment_intent.succeeded`, `invoice.paid`, `invoice.payment_failed`,
   `charge.refunded`, then set `STRIPE_WEBHOOK_SECRET`.
9. Run `npm run launch:check -- --deep` **on the deployment host** and confirm
   `runtime.egress` and every provider probe is `ready` before announcing launch.
10. **Mission only, after step 1**: store a Gemini key in the mission vault through the
    dashboard (never in chat) to enable agent chat, then verify a payout destination.
    Platform tokens (Upwork/Freelancer/Contra/Fiverr/Toptal/Awin) only when you decide
    to work that platform.
11. Optional, later: OAuth sign-in apps, YouTube/Instagram/TikTok publishing apps,
    Shopify, Twilio, OpenAI (paid, unblocks the 200 image agents).
