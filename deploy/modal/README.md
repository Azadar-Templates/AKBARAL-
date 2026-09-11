# AKBARAL! on Modal + Neon (Path B — zero-card production)

Deploys the public GHCR image (`ghcr.io/azadar-templates/akbaral:latest`,
auto-built by CI on every push) to Modal as an **always-on** web service,
backed by a **Neon PostgreSQL** database. All Modal APIs in
`akbaral_app.py` were verified against **Modal Python SDK 1.5.5** and the
live 2026-09 docs; the file passes full local definition validation.

**Nothing in this repository contains credentials.** The single secret
lives in your Modal account.

## What the wrapper deploys

| Function | What it does |
|---|---|
| `web` | Always-on service (`min_containers=1`), 0.25 vCPU / 1 GiB, public HTTPS URL, health-probed on port 3000 (startup window 300 s). Runs the image entrypoint: migrations → API :4000 + web :3000 (Next.js rewrites `/api`, `/uploads`, `/ws` to the API, so one public port serves everything). A supervisor loop restarts the stack if it ever exits; SIGTERM → graceful shutdown (verified in `start-prod.mjs`). |
| `seed_database` | One-shot: migrate + seed plans, the 4,001-agent registry, service accounts. Idempotent. |
| `backup_database` | Nightly 01:17 UTC cron: verified `pg_dump` onto the `akbaral-backups` Modal volume (30-snapshot retention, COPY-data verification, credentials via child env only). Also runnable on demand. |
| `restore_database` | Restores a dump from the volume; takes an automatic pre-restore safety snapshot first. |

Cost (Starter plan, $0 + $30/mo credits, no card): always-on 0.25 vCPU +
1 GiB ≈ **$14.3/month** at Modal's published rates ($0.0000131/core·s,
$0.00000222/GiB·s — re-check on modal.com/pricing), comfortably inside the
free credits.

## Runbook (exact steps)

### 1. Accounts (user-bound, cardless, ~10 min)

1. **Neon** — sign up at neon.tech (GitHub login) → create a project →
   copy the **pooled** connection string (`postgres://…?sslmode=require`,
   the `-pooler` host). Free plan: 0.5 GB storage (app uses ~36 MB),
   scale-to-zero after 5 min idle with ~500 ms wake.
2. **Modal** — sign up at modal.com (GitHub login). Starter: $30/mo free
   credits, 3 cron slots used by none/this (1 cron used here).

### 2. Local tooling (your machine)

```bash
pip install modal
python -m modal setup        # opens browser to authenticate (creates token)
```

### 3. Create the Modal secret (the ONLY place credentials live)

```bash
# generate a strong session secret:
openssl rand -hex 32

modal secret create akbaral-production \
  DATABASE_URL="postgres://USER:PASSWORD@HOST-pooler.NEON.DB/neondb?sslmode=require" \
  SESSION_SECRET="<the openssl output>" \
  GOOGLE_API_KEY="<gemini key — optional, omit until you have one>"
```

(Or create it in the dashboard at https://modal.com/secrets — choose
"Custom", name it exactly `akbaral-production`.)

### 4. Deploy

```bash
cd /path/to/AKBARAL-
modal deploy deploy/modal/akbaral_app.py
```

Output ends with the public HTTPS URL:
`https://<workspace>--akbaral-app-akbaral.modal.run` (label `akbaral`).

### 5. First-boot on a fresh Neon database

The web container runs migrations automatically at startup, then:

```bash
modal run deploy/modal/akbaral_app.py::seed_database
```

Verify: open the URL → homepage renders; `GET <url>/api/health` →
`{"status":"ok"}` (checks database); log in with the QA account.

### 6. Operations

```bash
modal app logs akbaral-app                      # live logs (free tier keeps 1 day)
modal run deploy/modal/akbaral_app.py::backup_database     # on-demand backup
modal app list                                  # status
modal app stop akbaral-app                      # stop before a restore
modal run deploy/modal/akbaral_app.py::restore_database --dump-file akbaral-pg-<timestamp>.sql
modal deploy deploy/modal/akbaral_app.py        # redeploy (picks up new :latest image)
```

Backups land on the `akbaral-backups` volume (`modal volume list`).

## Honest limitations (launch-blocking: none; know these)

- **Uploads are ephemeral**: files land on the container filesystem and
  are lost on redeploy (SQLite-era volume is gone on Modal). Do not rely
  on upload persistence until object storage is added (P1).
- **Single container by design** (`max_containers=1`): the in-process
  automation scheduler/queue must not double-run. Vertical scaling only
  until those move to the database layer (P1/P2).
- **Log retention 1 day** on the free tier — copy anything important out.
- **Neon scale-to-zero**: first query after 5 idle minutes pays ~0.5 s
  wake. Acceptable for launch traffic.
- **Gemini provider**: without `GOOGLE_API_KEY` the platform runs in
  honest contract mode (`/api/models` all unavailable) — same as today.

## DuckDNS (unchanged for now)

`akbaral.duckdns.org` still points at the placeholder IP. After the
Modal deployment is verified end-to-end, the switch is:
`web_server(..., custom_domains=["akbaral.duckdns.org"])` + a DuckDNS
CNAME to the Modal endpoint (Modal's custom-domain docs cover the exact
records). Do this only when you decide to cut over.

## What Arena can automate vs. what only you can do

| Arena (agent) | You (identity-bound) |
|---|---|
| Prepare/validate wrapper + docs (done) | Create Neon + Modal accounts |
| Verify the deployment once you share the public URL | `modal setup` (browser auth) |
| Fix any deploy-time issues, add monitoring checks | `modal secret create …` |
| Run the production smoke suite against the URL | `modal deploy …` + `modal run …::seed_database` |
| Cut over DuckDNS when you say so | Paste/keep the Gemini key in the secret |
