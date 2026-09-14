# AKBARAL! — SnapDeploy Deployment Configuration (exact inputs)

> Everything below is pre-verified agent-side (re-verified 2026-09-14 at
> commits `a3c88d4`/`08e6dd6`, QA 443/443 + PG 22/22):
> the CI image builds green (docker-publish run 34825404831 on `a3c88d4`),
> and the exact container boot path was re-run in FULL production mode from
> the built `dist` artifacts: `node dist/src/db/migrate.js` → **16
> migrations** → `dist/src/db/seed.js` (4,001-agent registry) →
> `scripts/start-prod.mjs` with `NODE_ENV=production AKBARAL_ROLES=both`
> (mandatory SESSION_SECRET guard active, throwaway local secret) → API
> :4000 + web :3000 → `/api/health` ok, `/api/ready` ready, robots/sitemap
> 200, public surfaces codename-free, and the complete E2E (registration →
> MASTER → verification → finalResult → Task Center → exact credit math 5→4
> → zero key leakage) PASSED through the production Next.js server. The
> failure→refund path was proven earlier with real DB transactions (consume
> −1 → automatic refund +1 on `provider_not_configured`). The only thing
> that cannot be done from the Arena sandbox is the SnapDeploy account
> itself (their dashboard is unreachable from the sandbox network, and
> account creation + secret pasting is inherently the owner's action).

## Container form — exact values

| Field | Value |
| --- | --- |
| Source | GitHub repo `Azadar-Templates/AKBARAL-`, branch `arena/01a085d2-akbaral` (or `main` after merge) |
| Build | Dockerfile at repo root (auto-detected; ~1–2 min build) |
| Port | **3000** (HTTP). The image also listens on 4000 internally — only 3000 is public; Next rewrites `/api`, `/uploads`, `/ws` to the in-container API |
| Size | Small (512 MB — Free tier) |
| Health check path (if asked) | `/api/health` (returns 200 only when the database round-trips) |

## Environment variables — the complete list

Enter exactly these five (the first three are secrets — paste from your
records; never into chat):

```
DATABASE_URL=<your Neon pooled PostgreSQL URL — postgres://…?sslmode=require>
SESSION_SECRET=<one-time: openssl rand -base64 48 — or reuse the old Modal value>
GOOGLE_API_KEY=<your real Gemini key — same value the Modal secret used>
TRUST_PROXY=1
DISABLE_BACKUP_CRON=1
```

Add this ONE more **only if** the Neon database is still empty (fresh
project) — and remove it after the first successful boot:

```
SEED_DATABASE=true
```

Everything else SnapDeploy may list: leave **empty/unset**. Optional
integrations (SMTP, social tokens, payments, search endpoints) stay
disabled and fail honestly per-capability. Do NOT set `GOOGLE_BASE_URL`,
`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, or `AKBARAL_ALLOW_PRIVATE_PROVIDER`
— production must talk to real Google with full SSRF protection.

## What the container does on boot (no action needed)

1. `scripts/entrypoint.sh` → `node dist/src/db/migrate.js` (16 migrations,
   idempotent — safe on every restart against Neon)
2. `SEED_DATABASE=true` only → seeds the 4,001-agent registry, plans,
   model catalog, feature flags (skip on the existing production DB)
3. `scripts/start-prod.mjs` (`AKBARAL_ROLES=both` default) → API `:4000`
   (`NODE_ENV=production`, mandatory SESSION_SECRET guard) + Next `:3000`
4. Readiness: `/api/ready` reports database + migrations + uploads +
   execution-queue status

## After the container is live

Send the agent the container URL. The existing production E2E
(`scripts/verify-production-e2e.mjs`, via `production-verify.yml` or a
GitHub runner) then proves the real chain end-to-end against real Google —
including the exact selected model from execution logs, verification
result, Task Center entry, exact credit consumption, and that no key
material ever appears on any response surface.

Optionally add repo secrets `PRODUCTION_BASE_URL` + `PRODUCTION_PING_URL`
(the 13-minute keep-alive prevents free-tier auto-sleep from stalling the
execution queue).
