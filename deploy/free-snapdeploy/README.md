# ⚠️ REJECTED 2026-09-22 — SnapDeploy requires $1/card verification (per user live account)

> **2026-09-22 update:** SnapDeploy docs claim "no credit card" but user account hit $1/card verification screen. Violates NO $1 verification + NO card constraints. Rejected per task. Full verification: `docs/FINAL_HOSTING_VERIFICATION_2026-09-22.md`

# AKBARAL! — Free Production on SnapDeploy (Path E) — RETIRED

> **Why this exists (2026-09-13):** every prior free path died — Modal hit
> its $1 cap, Render demands a card at signup, **Zeabur's dashboard now
> offers only "Buy New Server" / "Bind External Server"** (the Free plan no
> longer includes hosted compute). SnapDeploy is the one remaining host
> verified — from its own current docs — to offer a genuine **$0, no-card,
> Docker-native** tier that can run this exact application.

## Verified facts (official docs, 2026-09-13)

| Requirement | SnapDeploy Free | Source |
| --- | --- | --- |
| $0 / no card | ✅ "Deploy free… no credit card required" | snapdeploy.dev/pricing |
| Containers | **2** on Free (pricing FAQ says "up to 4" — assume the lower, 2) | /docs/scaling table |
| RAM per container | **512 MB** (Free/Hobby tier) | /docs/scaling table |
| Docker support | ✅ GitHub repo → **detects and builds YOUR Dockerfile** (ours is at the repo root) | /docker-hosting |
| Env vars & secrets | ✅ per-container environment variables and secrets | /docker-hosting |
| Public URL | ✅ free `*.snapdeploy.app`-style subdomain + automatic SSL | /pricing |
| Persistent Node/Next server | ✅ long-running container (Fargate), **auto-sleep after 15 min idle, auto-wake ~60 s** | /pricing + /docs/scaling |
| Neon PostgreSQL egress | ✅ outbound from the container is unrestricted (same model as our GHCR/Neon stack) | platform architecture |
| WebSockets | ⚠️ **paid (Always-On) feature on Free** — our app already degrades: the realtime execution-log stream has an **SSE fallback over `/api/*`** (plain HTTP), so tasks/logs work without WS | next.config.mjs comment + app client |
| Deploys | 5 per 12 h (10/day), 5-min build timeout (our CI builds the same Dockerfile in ~1–2 min) | /pricing + /docs/scaling |

**Fit:** our production stack (API + Next in one container) measures
~300–450 MB RSS — fits a 512 MB container. If it ever OOMs, the Free plan
allows a **second** container: split with `AKBARAL_ROLES` (below).

## Honest limitations

- **Auto-sleep after 15 min idle** (wake ~60 s, first request waits).
  Mitigated by `.github/workflows/keep-alive.yml` (13-min pings).
- **No WebSockets on Free** — realtime logs fall back to SSE automatically.
  No functionality is lost; the transport differs (documented in-app).
- **5-min build timeout** — our Dockerfile builds in ~1–2 min on CI-class
  hardware; if their builder is slower and times out, retry once or split
  the build (worst case: Hobby's 10-min timeout is paid — not required).
- **Young platform** (startup; NVIDIA Inception / AWS Startups member).
  The mitigations are structural: the repo builds a plain Docker image and
  the database is plain Neon — the kit re-runs on any Docker host in
  minutes (this is the 4th host swap; each took one config file + env
  paste, zero code changes).
- Custom domains are paid — production serves on the free subdomain.
- Subdomain only; no SLA on Free.

## One-time setup (~5 minutes, $0, no card)

> **Note on the "Environment Variables Detected" screen:** SnapDeploy's
> scanner treats every UNCOMMENTED `VAR=` entry in `.env.example` as a
> required input — which is why it originally demanded SMTP/social/search
> credentials. Fixed at `d674217`+: optional integrations are commented
> out in `.env.example` (the app always treated them as optional and fails
> honestly per-capability; locked by `src/config/env.test.ts`). Re-scan
> after this commit and only the core set below is requested. If a stale
> scan still shows optional fields, entering them EMPTY is safe — the code
> treats empty strings as not-configured.

1. **snapdeploy.dev/register** (email or GitHub; no payment method).
2. **Connect the GitHub repo** `Azadar-Templates/AKBARAL-` (install their
   GitHub app when prompted) and create a container:
   - Branch: `arena/01a085d2-akbaral` (or `main` once merged)
   - Dockerfile: repo root (auto-detected)
   - Port: **3000** (the image `EXPOSE`s 3000+4000; only :3000 is public —
     Next rewrites `/api`, `/uploads`, `/ws` to the in-container API)
   - Size: Small (512 MB)
3. **Environment variables** (paste values — never into chat/PRs) — the
   MINIMAL core-production set, classified against the code
   (`src/config/env.ts`):
   - `DATABASE_URL` — **REQUIRED**. The Neon pooled PostgreSQL string
     (`postgres://…?sslmode=require`) — the same value the Modal secret
     used. The detected example value (`file:./data/akbaral.db`) is the
     SQLite dev default and must be replaced.
   - `SESSION_SECRET` — **REQUIRED + GENERATE SECURELY** (the app refuses
     to start in production without ≥32 random chars; placeholder values
     are blacklisted). Generate once: `openssl rand -base64 48`. Reusing
     the old Modal value keeps existing sessions valid.
   - `GOOGLE_API_KEY` — **REQUIRED** for the core MASTER→Gemini path
     (copy from the Modal secret). Without it the Google provider reports
     not-configured honestly and MASTER cannot run a model.
   - `TRUST_PROXY=1` — **recommended**: SnapDeploy fronts the container
     with one TLS proxy; this makes rate limiting and security logs use
     real client IPs.
   - `DISABLE_BACKUP_CRON=1` — **required on ephemeral disks** (backups
     stay with the Neon runbook).
   - `SEED_DATABASE=true` — **only if the Neon database is empty** (fresh
     project); remove after the first successful boot.
   - `AKBARAL_PUBLIC_WEB_URL=https://<container-url>` — optional polish;
     only used in email links (which are SMTP-gated anyway).
   Everything else SnapDeploy detected from `.env.example` is OPTIONAL
   (integrations report not-configured honestly) or has a safe in-code
   default — leave it unset. **Do NOT set** `GOOGLE_BASE_URL`,
   `OPENAI/ANTHROPIC_BASE_URL`, or `AKBARAL_ALLOW_PRIVATE_PROVIDER` —
   those are preview/fixture switches (diverting Gemini away from Google
   or relaxing SSRF validation); production must keep them unset/0.
4. Deploy. The entrypoint runs migrations against Neon, then starts
   API `:4000` + web `:3000` (`AKBARAL_ROLES=both`, the default).
5. **Keep-alive** (strongly recommended): add the repo secret
   `PRODUCTION_PING_URL = https://<your-container-url>` (and, if you use
   the split layout below, `PRODUCTION_API_PING_URL` for the API
   container) — `.github/workflows/keep-alive.yml` pings every 13 min.
6. **Verify**: tell the agent the URL — the existing
   `scripts/verify-production-e2e.mjs` / `production-verify.yml` runs the
   full REAL chain (health → registration → GOOGLE_API_KEY availability →
   MASTER goal → selected Gemini model → verification → finalResult →
   Task Center → exact credit math → key-leak scans).

## Fallback: split layout (only if the 512 MB container OOMs)

Free allows 2 containers; the same repo/Dockerfile runs one tier each
(env vars only — no code/image divergence):

- Container `akbaral-api`: env as above + **`AKBARAL_ROLES=api`**
  (migrations + API `:4000`); gets its own public subdomain
- Container `akbaral-web`: env + **`AKBARAL_ROLES=web`** +
  **`NEXT_BACKEND_URL=https://<akbaral-api-subdomain>`** (routes the
  rewrites to the API container); port 3000, the public entry point

Keep BOTH awake with the keep-alive secrets above.

## Portability / rollback

Plain Docker image + plain Neon Postgres — nothing is SnapDeploy-specific
except the dashboard paste. Retired kits stay in-tree as records:
`deploy/free-render/` (card-gated), `deploy/free-zeabur/` (no free
compute), `deploy/free-clawcloud/` (shut down), `deploy/modal/` (revives
if its workspace is ever re-enabled).
