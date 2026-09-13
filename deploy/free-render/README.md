# AKBARAL! — Free Production on Render (Path C)

> **Why this exists (2026-09-13):** the Modal Starter workspace hit its $1
> free-usage cap and Modal's edge now refuses all traffic (`modal-http:
> workspace … is disabled`). Modal is no longer the production dependency.
> This path moves production to **Render's free web service** at **$0, no
> card**, reusing the same CI image and the same Neon database. Nothing in
> the application changes.

## What was verified before choosing Render (2026-09-13)

| Candidate | Verdict | Evidence |
| --- | --- | --- |
| **Render free** | **CHOSEN** — 750 instance-hrs/mo, 0.1 CPU/512 MB, cardless, WS supported, prebuilt-image deploys, `render.yaml` IaC | render.com/docs/free, /docs/websocket, /docs/deploying-an-image, /docs/blueprint-spec |
| Koyeb free | ❌ new sign-ups are **paid-only** since the Mistral AI acquisition (2026-02-18) | koyeb.com announcement; TechCrunch/pulse2 coverage |
| Hugging Face Spaces | ❌ Docker/Gradio Spaces now require a **paid plan to create** (2026 policy) | HF docs/community, Sep 2026 |
| Modal Starter | ❌ blocked at the $1 cap (the trigger for this migration) | live edge response |
| Fly.io / Railway / Northflank / GCP / Oracle | ❌ card or trial-only (standing rule: no card) | market table in `deploy/free-clawcloud/README.md` |
| Vercel / Netlify / Cloudflare / Deno | ❌ serverless-only — would require an architecture rewrite (long-running queue + WS) | — |
| ClawCloud Run | ❌ shut down (May 2026) | retired kit next door |

**Why the old "no free host" conclusion (2026-09-11) no longer applies:**
that analysis assumed a *stateful SQLite container*. Production has since
moved to **Neon PostgreSQL** — the container is stateless, so free tiers
without persistent disks are viable.

## Known free-tier limitations (honest)

- **Spins down after 15 min idle** (~1 min cold start, loading page while
  waking). Mitigated by `.github/workflows/keep-alive.yml` (a scheduled
  GitHub Actions ping every 13 min keeps it awake). Even always-awake, one
  service fits: ~720 h/month < 750 free instance-hours.
- **0.1 CPU / 512 MB RAM** — the tightest constraint (Modal ran 1 CPU/1 GiB).
  If OOM-kills appear under load, the escape hatch is Render Starter ($7/mo,
  0.5 CPU/512 MB) once revenue exists — not required now.
- **Ephemeral filesystem** — identical to the Modal production behavior:
  durable state lives in Neon; uploaded files were already ephemeral on
  Modal; nightly backups stay with the Neon runbook (in-container cron
  disabled via `DISABLE_BACKUP_CRON=1`).
- Render's docs say free instances are "not for production applications" —
  they mean no SLA and the sleep/CPU/RAM limits above. This is the honest
  $0 trade-off until revenue funds an upgrade.
- Render may suspend free services with "uncommonly high" *service-initiated*
  egress. Normal Neon + Gemini traffic is the intended pattern here; if a
  suspension ever triggers, upgrade or move — the same image runs anywhere.

## One-time setup (~5 minutes, $0, no card)

1. **Render account**: <https://dashboard.render.com/register> (GitHub login;
   no payment method needed).
2. **New → Blueprint** → connect the `Azadar-Templates/AKBARAL-` GitHub repo.
   Render reads `render.yaml` at the repo root.
3. When prompted, paste (never into chat/PRs):
   - `DATABASE_URL` — the existing Neon pooled connection string (the same
     one the Modal secret `akbaral-production` used).
   - `SESSION_SECRET` — the old Modal value (keeps sessions valid) or let
     Render generate one.
   - `GOOGLE_API_KEY` — the real Gemini key (copy from the Modal secret
     `akbaral-production` in the Modal dashboard).
4. **Create**. Render pulls `ghcr.io/azadar-templates/akbaral:latest`
   (public image, no registry credentials), the entrypoint runs migrations
   against Neon, and the service lands at
   `https://akbaral-xxxx.onrender.com` (see the dashboard for the exact URL).
5. **Seed only if the Neon database is empty** (fresh project): set
   `SEED_DATABASE=true` in the service's Environment settings once and
   redeploy; then remove it. The existing production database needs nothing.
6. **Keep-alive** (recommended): in the GitHub repo → Settings → Secrets and
   variables → Actions → Repository secrets, add
   `PRODUCTION_PING_URL = https://<your-render-url>` so
   `.github/workflows/keep-alive.yml` pings `/api/health` every 13 min.
7. **CI redeploys (optional)**: add `RENDER_DEPLOY_HOOK` (Render dashboard →
   service → Settings → Deploy Hook) and `PRODUCTION_BASE_URL` as repo
   secrets; then `.github/workflows/deploy-render.yml` can redeploy the
   latest image and run the full production E2E on demand.

## Verifying production (agent- or user-runnable)

```bash
AKBARAL_BASE_URL=https://<your-render-url> node scripts/verify-production-e2e.mjs
# or via CI: GitHub → Actions → production-verify → Run workflow with the URL
```

The script proves the real chain end-to-end: health/ready → shell →
registration → google provider availability (the runtime's GOOGLE_API_KEY) →
the exact MASTER goal → **selected Gemini model from execution logs** →
verification → finalResult → Task Center → exact credit math → key-leak
scans. It **rejects the preview fixture's canned answer**, so fixture
success can never pass as production evidence.

## Rollback / portability

The image is plain Docker at `ghcr.io/azadar-templates/akbaral:<sha>`; the
database is plain Neon Postgres. The same kit runs on any Docker host —
Render free is a hosting choice, not a lock-in. The Modal wrapper
(`deploy/modal/`) stays in the tree and works again the moment that
workspace is re-enabled.
