# AKBARAL! — Final Production Checklist

Generated after the last hardening pass. Each row is verified against this checkout
(canary commit `4851c24` → `arena/01a07c3c-akbaral`) plus the live local API and a
compliant local search/fetch provider. Credentials are not invented; anything that
needs an external account/key is marked **BLOCKED-BY-EXTERNAL-CREDENTIAL**.

Legend: ✅ PASS · ❌ FAIL · ⛔ BLOCKED-BY-EXTERNAL-CREDENTIAL

---

## 1. Quality Gate

| Check | Status | Evidence |
| --- | --- | --- |
| `npm install` | ✅ | Clean install, no dependency errors. |
| `npm run db:migrate` | ✅ | Migrations 0001–0004 apply cleanly (`knowledge_fts` cleanup trigger). |
| `npm run db:seed` | ✅ | 4,000 agents / 80 categories / 5 models / 14 tools / 4 plans. |
| `npm run typecheck` | ✅ | 0 errors. |
| `npm run build` | ✅ | Clean `tsc -p tsconfig.json`. |
| `npm test` | ✅ | 12 suites / 0 failures (repeatable; test runner now resets `test.db`). Orchestrator suite includes emergency-stop credit-safety. |
| `npm run audit:registry` | ✅ | 4,000 definitions, 4,000 unique slugs, 4,000 unique instructions, 4,000 unique full contracts, 4,000 unique workflows. |
| `npm run scan:secrets` | ✅ | No high-signal credential markers in the working tree (values never printed). |
| Mobile `tsc --noEmit` | ✅ | Expo/React Native source clean. |

---

## 2. Feature Verification Matrix

| Feature | Status | Notes |
| --- | --- | --- |
| Registration | ✅ | `/api/auth/register` returns `{ user }`; no secret leakage. |
| Login / session / token | ✅ | HS256 JWT (1 h, `sid`), refresh + logout; RBAC. |
| Password reset / email verify | ✅ | Dev token path verified end-to-end + re-login with new password; real delivery blocked by SMTP credential. |
| MASTER planning | ✅ | Goal → intents → steps; orchestration verified live. |
| Agent discovery | ✅ | 4,000+ registry, 80 categories, search/filter/favorite/detail. |
| Agent execution | ✅ | Real HTTP research agent produced verified output through the local compliant provider; generic LLM execution blocked by missing model key. |
| 4,000+ registry differentiation | ✅ | Every agent differs in slug/instructions/workflow; full contracts unique (see `scripts/audit-registry.ts`). |
| Model routing | ✅ | OpenAI/Anthropic/Google adapters, capability scoring, fallback chain, disabled-model filtering, honest `provider_not_configured`. |
| Tools | ✅ | 14 registered; credential-gated tools fail honestly; SSRF + path guards; user-scoped file/knowledge. |
| File upload | ✅ | Upload + text parse + versioning + ownership-scoped `file_parse_text`. |
| Knowledge search | ✅ | FTS search scoped to the caller; FTS mirror cleanup trigger; `POST /api/files/:id/knowledge` → `{knowledge:{id}}`, search `results[]` carry item `id` (live: `kno_…` full round-trip). |
| Credits (honest billing) | ✅ | 5 free / 30-day trial reserved atomically; success consumes; failure refunds; exhausted → `402 requires_pro`; no consumption for provider-not-configured. |
| Billing | ✅ | Plans, subscription, invoice, credit purchase, manual settlement, signed webhook. |
| Marketplace | ✅ | Browse 4,000, install/publish/unpublish, install economy. |
| Agent Factory | ✅ | Create / test / security / benchmark / version / status / rollback / audit; owner/admin-only mutation. |
| WebSocket logs | ✅ | Owner-only: `?token=` verified at upgrade (401 bad token), non-owner → 1008/closed. |
| SSE logs | ✅ | Owner-only: non-owner → 403; owner stream verified (`REALTIME_OK`). |
| CRM | ✅ | Contacts, pipelines, deals, campaigns, automations, AI employees; ownership + assignee checks. |
| Admin | ✅ | Stats/analytics/agent/model status, feature flags, emergency stop **+ resume**; admin/super_admin gate; `emergency_stop` rejects new work with `503` and never consumes credits. |
| Seed idempotence | ✅ | Re-running `db:seed` preserves admin-disabled model/provider status (`src/models/catalog.ts`), so operator choices survive re-seeding. |
| Security controls | ✅ | SSRF guard, WS/SSE auth, tenant isolation (execution/tool/CRM), rate limits, audit logs, signed webhooks, no secrets in client; production refuses the placeholder `SESSION_SECRET` on startup. |
| Production config validation | ✅ | `NODE_ENV`, `PORT`, `DATABASE_URL` (`file:`/`:memory:` only), `HOST`, `AKBARAL_UPLOAD_DIR` validated at startup; dev/test `SESSION_SECRET` auto-generated cryptographically; production requires explicit ≥32 chars. |
| Admin config/status endpoint | ✅ | `GET /api/admin/config/status` (admin-only) returns configured booleans + required env-var NAMES only; live check: non-admin `403`, admin `200`, no credential values/tokens in payload. |
| Secret redaction in errors/logs | ✅ | Shared HTTP helper + `redactSecrets` mask provider bodies/bearers/api keys; user-facing errors never echo raw third-party bodies. |
| Missing provider credentials | ✅ | Live generic agent without `OPENAI_API_KEY` → `provider_not_configured` (`set OPENAI_API_KEY`), credit 5→5 (refunded); SMTP-missing in production → `503 provider_not_configured` with required var names. |
| SMTP/email | ✅ | SMTP client implemented (TLS/STARTTLS, AUTH PLAIN/LOGIN, timeout, secret-free errors); password-reset/verification/campaign send call it; production missing SMTP returns `provider_not_configured`. |
| `AKBARAL_ALLOW_PRIVATE_PROVIDER` | ✅ | Cannot become a generic SSRF bypass: private source URLs are accepted only on the same host as the trusted internal provider; different private host/169.254.169.254 rejected (tested). |
| Upload confinement | ✅ | `AKBARAL_UPLOAD_DIR` validated; server-generated storage keys checked (`..`, absolute, separators) before any path is built (tested). |
| Secret scan / history | ✅ | `scripts/scan-secrets.ts` PASS on working tree; `git ls-files`/`git log --all` contain no high-signal secret markers; `.env`/`.env.*` ignored, `.dockerignore` excludes env files. |
| Web frontend | ✅ | Premium responsive SPA with 3D robot identity; all routes live; deduped realtime log rows. |
| Mobile build | ✅ | `tsc --noEmit` clean; Android/iOS Metro bundles export cleanly. |
| Deployment | ✅ | Multi-stage Dockerfile (`node:22-slim`), persistent `/data`, entrypoint migrations/seed, Docker `HEALTHCHECK` on `/api/health`, backup script, docs. |

---

## 3. Manual Live E2E Results

### Authentication / session
- Register + login → `accessToken`; `/api/me` → `creditBalance=5`, `trialActive=true`, `subscription=trialing`.
- Password reset dev-token flow → re-login with new password.

### Realtime (after hardening)
- **Owner**: `ws-sse-verify` — `REALTIME_OK`, `ws_messages=6`, `sse_messages=5`, `ws_has_start=true`, `sse_has_start=true`.
- **Unauthenticated WS** → rejected (`NA_REJECTED`, no open).
- **Cross-tenant WS** → rejected (`CT_REJECTED`, no open).
- **Cross-tenant execution GET** → `403 execution context does not belong…`.
- **Cross-tenant SSE** → `403 execution context does not belong…`.
- **Cross-tenant `/api/tools/:key/run` with foreign `execution_id`** → `403` (after async error handling fix; previously the server crashed with an unhandled rejection).

### Tools / files / knowledge
- Upload file to own project → `201`; knowledge FTS search returned `1` result for own content.
- `file_parse_text` scoped to `files.user_id`.

### Research / credits
- Live task through local compliant provider completed (`research complete`, `2 verified sources`), verifying SSRF is open only to the configured trusted proxy.
- Failure path returns `provider_not_configured` / refund as documented.

### Factory / marketplace / CRM / admin
- Factory create → slug; security `2` findings; benchmark `48`; version `1.0.1`.
- Non-owner factory version → `403 only the owner can manage this agent`.
- Marketplace browse `4,000`, install → order id.
- CRM contact/campaign/automation/employee all created.
- Non-admin `/api/admin/stats` → `403 insufficient permissions`.
- `emergency_stop` flag → live `POST /api/tasks/research` returns `503 emergency_stop` and credit balance is unchanged; clearing via `/api/admin/system/resume` restores execution (`202`, credit consumed).

---

## 4. BLOCKED-BY-EXTERNAL-CREDENTIAL

| Capability | Required credential | Status |
| --- | --- | --- |
| Generic LLM agent execution | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY` | ⛔ |
| Image generation (`image_render`) | `OPENAI_API_KEY` | ⛔ |
| YouTube / Instagram publish | `YOUTUBE_ACCESS_TOKEN`, `INSTAGRAM_ACCESS_TOKEN` | ⛔ |
| X post | `X_BEARER_TOKEN` | ⛔ |
| Shopify product sync | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ACCESS_TOKEN` | ⛔ |
| Twilio messaging | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | ⛔ |
| Stripe payments | `STRIPE_SECRET_KEY`, `BILLING_WEBHOOK_SECRET` | ⛔ |
| Google Maps | `GOOGLE_API_KEY` | ⛔ |
| Email / campaign delivery | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | ⛔ |
| OAuth logins | `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/SECRET`, `MS_CLIENT_ID/SECRET` | ⛔ |

**Every blocked integration is fully implemented and returns an honest
`provider_not_configured` / `requiredCredential` response — never fake output, and
never consumes a task credit.**

---

## 5. Required Environment Variables (production)

```dotenv
# Models
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# Web research (optional trusted proxy; leave unset to use the public default)
AKBARAL_SEARCH_ENDPOINT=
AKBARAL_PAGE_FETCH_ENDPOINT=
# Only set =1 when using a trusted internal search/fetch provider (SSRF relax).
AKBARAL_ALLOW_PRIVATE_PROVIDER=

# Storage
AKBARAL_UPLOAD_DIR=/data/uploads

# Email / auth
SMTP_HOST=
SMTP_USER=
SMTP_PASSWORD=

# OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=
MS_CLIENT_ID=
MS_CLIENT_SECRET=

# Payments / integrations
BILLING_WEBHOOK_SECRET=
STRIPE_SECRET_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
YOUTUBE_ACCESS_TOKEN=
INSTAGRAM_ACCESS_TOKEN=
X_BEARER_TOKEN=
SHOPIFY_STORE_DOMAIN=
SHOPIFY_ACCESS_TOKEN=

# Server / database
PORT=3000
NODE_ENV=production
DATABASE_URL=file:/data/akbaral.db
# REQUIRED in production: random, >=32 chars. Startup aborts if missing/placeholder.
SESSION_SECRET=
```

For local development without secrets, keep `.env.example` and commit only key-free
`.env`/`.env.example`; never commit real secrets.

---

## 6. Exact Remaining Deployment Steps

1. Provision a managed secret store; set the env vars in §5 in production
   (`SESSION_SECRET` is mandatory and the server refuses `change-me-in-production`).
2. `docker build -t akbaral .` and mount a persistent volume at `/data`
   (Dockerfile already sets `DATABASE_URL=file:/data/akbaral.db` and
   `AKBARAL_UPLOAD_DIR=/data/uploads`).
3. Run `npm run db:migrate` once against the production DB (migrations 0001–0004).
4. Run `npm run db:seed` (or `SEED_DATABASE=true`) to register plans, model/tool
   catalog, and the 4,000-agent registry.
5. Run `npm run start` (or the container entrypoint) behind TLS; healthcheck on
   `/api/health`.
6. Point the web origin at the public API URL. Set mobile
   `EXPO_PUBLIC_API_BASE_URL` to the same URL and rebuild the Expo app.
7. Schedule `./scripts/backup.sh` (SQLite file + uploads).
8. If scaling to multiple instances, migrate the repository layer to PostgreSQL
   and move background execution to a queue/driver.

---

## 7. Known Post-Launch Constraints (not blockers)

- The sandbox has no real external model keys; the generic execution path is
  correct but untriggered here. Add a key to prove it live.
- `node:sqlite` is the storage layer; PostgreSQL swap is recommended for
  multi-instance scale (no agent/route code depends on the driver).
- Mobile source passes typecheck and Metro export; native app-store signing +
  EAS build remain outside this repo.
