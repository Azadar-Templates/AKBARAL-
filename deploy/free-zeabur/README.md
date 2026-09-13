# AKBARAL! — Free Production on Zeabur (Path D)

> **Why this exists (2026-09-13):** Modal Starter hit its $1 free cap (edge
> refuses traffic), and **Render's signup demands a payment method** — both
> violate the zero-investment / no-card rule. After re-verifying the market
> from official sources, production moves to **Zeabur's Free Plan**: $0,
> **no card**, running the same CI image on the same Neon database. No
> application changes; one optional deployment-plumbing switch
> (`AKBARAL_ROLES`) was added for memory-constrained hosts.

## Verified market re-check (2026-09-13, official sources)

| Candidate | Verdict | Source |
| --- | --- | --- |
| **Zeabur Free Plan** | ✅ **CHOSEN** — $0/mo, no card, auto-sleep/wake, prebuilt Docker images from any registry (incl. `ghcr.io/owner/image:tag`), HTTP/TCP ports, `*.zeabur.app` TLS domains, per-service env vars, WebSocket-capable platform | zeabur.com/docs/en-US/pricing/free-plan · /deploy/create/create-service · /deploy/methods/custom-docker-image |
| Render free | ❌ **card required at signup** (discovered live 2026-09-13) | user-side signup attempt |
| Koyeb | ❌ new sign-ups paid-only (Mistral AI acquisition, 2026-02) | koyeb.com announcement |
| Hugging Face Spaces | ❌ Docker Spaces paid to create (2026 policy) | HF docs/community |
| Zerops | ❌ $15 **one-time** promo credit only — not permanent free | docs.zerops.io/quickstart |
| Back4App Containers | ❌ free = 256 MB RAM — too small (our prod stack ≈ 300–450 MB; dev measured 815 MB) | back4app.com/pricing/container-as-a-service |
| Fly / Railway / Northflank / GCP / Oracle | ❌ card or trial-only | standing verified table |
| Vercel / Netlify / Cloudflare / Deno | ❌ serverless-only — architecture rewrite | — |

**WebSocket evidence:** Zeabur's own Public API serves container terminals
over `wss://` and streams logs/events via WS subscriptions
(zeabur.com/docs/en-US/developer/public-api), and live WS-messaging apps
serve on `*.zeabur.app` (e.g. oterminal-web.zeabur.app) — the HTTP ingress
passes WS upgrades. Our `/ws` rewrite rides the same path.

## Honest free-plan limitations

- **Auto-sleep when idle** (official): services sleep after inactivity and
  wake on the next request (a few seconds). Mitigated by the keep-alive
  workflow (`.github/workflows/keep-alive.yml` pings `/api/health` every
  13 min once `PRODUCTION_PING_URL` is set).
- **Resource limits**: the free plan caps service resources ("certain
  resource limits" — official FAQ; exact numbers are in their plan chart).
  If the single-container stack ever OOMs, use the split layout below —
  same image, env vars only.
- **No custom domains on Free** — production serves on the generated
  `*.zeabur.app` subdomain with automatic TLS.
- **No SLA, 48h log retention, no Zeabur Email** (we don't use it);
  database backups stay with the Neon runbook (in-container cron disabled).
- 1 project, 2 services per project.

## One-time setup (~5 minutes, $0, no card)

1. **Zeabur account**: <https://zeabur.com> → sign in with GitHub (no card).
2. Create a project (e.g. `akbaral`), then **Create Service → Docker Image**:
   - Image: `ghcr.io/azadar-templates/akbaral:latest` (public — no registry
     credentials; pin to `:<full-commit-sha>` for reproducibility)
   - Port: **3000, type HTTP** → generates `https://<something>.zeabur.app`
     with automatic TLS
3. **Environment variables** for the service (paste values — never into
   chat/PRs):
   - `DATABASE_URL` — the existing Neon pooled connection string (the same
     one the Modal secret `akbaral-production` used)
   - `SESSION_SECRET` — the old Modal value (keeps sessions valid) or any
     ≥32-char random string
   - `GOOGLE_API_KEY` — the real Gemini key (copy from the Modal secret in
     the Modal dashboard)
   - `DISABLE_BACKUP_CRON=1` — backups belong to the Neon runbook
   - `SEED_DATABASE=true` **only if** the Neon database is empty (fresh
     project); remove it after the first successful boot
4. Deploy. The container entrypoint runs migrations against Neon, then
   `AKBARAL_ROLES=both` starts API `:4000` + web `:3000` (identical to the
   Modal layout: only :3000 is public; the API is container-internal).
5. **Keep-alive**: GitHub repo → Settings → Secrets and variables → Actions
   → Repository secrets → `PRODUCTION_PING_URL = https://<your>.zeabur.app`
   → the scheduled workflow keeps it awake.
6. **Verify**: tell the agent the URL — the existing
   `scripts/verify-production-e2e.mjs` / `production-verify.yml` runs the
   full REAL chain (health → registration → GOOGLE_API_KEY availability →
   MASTER goal → selected Gemini model → verification → finalResult →
   Task Center → exact credit math → key-leak scans).

## Fallback: split layout (only if the free tier's memory cap is too tight)

The Free plan allows 2 services per project; the same image can run one
tier per service (env vars only — no code/image divergence):

- Service `akbaral-api`: image + env as above + **`AKBARAL_ROLES=api`**
  (migrations + API `:4000`; port 4000, no public domain needed)
- Service `akbaral-web`: image + **`AKBARAL_ROLES=web`** +
  **`NEXT_BACKEND_URL=http://akbaral-api.zeabur.internal:4000`** (Zeabur
  private networking; `next.config.mjs` already honors this variable) +
  the same secrets; port 3000, type HTTP (public)

Caveat: with auto-sleep, a sleeping API service may not wake on
private-network traffic — if you use the split layout, keep BOTH services
awake (the keep-alive workflow can ping the web tier; verify the API wake
behavior in your project).

## Portability / rollback

Plain Docker image (`ghcr.io/azadar-templates/akbaral:<sha>`) + plain Neon
Postgres — the kit runs on any Docker host. The Modal and Render wrappers
stay in-tree (Render is card-gated, retired; Modal revives if its workspace
is ever re-enabled).
