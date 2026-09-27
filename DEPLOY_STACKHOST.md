# AKBARAL! — StackHost free-tier deploy runbook

Verified 2026-09-27. Everything here is **$0 and card-free**.

## Why StackHost

It is the target this repository is already configured for (`stackhost.yaml`),
and it is genuinely free with **no credit card**: sign up with GitHub, Google,
Telegram or email.

| Free tier | Value |
|---|---|
| RAM | 512 MB (forever) |
| Apps | 1 |
| Bandwidth | 5 GB/month |
| SSL | Included |
| Domain | `*.stackhost.org` subdomain |
| Idle | Auto-sleep after 30 min |
| Card | **Not required** |

Three constraints shape the config, and all three are already handled:

1. **512 MB** — too small to build from source (~1 GB). `stackhost.yaml` pulls a
   prebuilt immutable digest instead. Do not change this to a source build.
2. **Auto-sleep** — stalls the in-process queue/scheduler.
   `.github/workflows/keep-alive.yml` pings `/api/health` every 13 min.
3. **No persistent volume** — SQLite would be wiped on every rebuild. Use free
   Neon Postgres for durable data.

## Already done in this repo

- `runtime.image` pinned to the digest built from the current verified commit
- Start command, port handling, migrations, SESSION_SECRET self-generation
- keep-alive workflow (dormant until one secret exists)
- `launch:check` reports every remaining gap by name

## Steps

### 1. Make the image public — one click
`github.com/orgs/Azadar-Templates/packages` → **akbaral** → Package settings →
Change visibility → **Public**.

Without this StackHost gets an unauthorized pull. This is the **only** thing
blocking a first deploy.

### 2. Create the app
Sign in at `stackhost.org` with GitHub → New app → deploy from the
**container image** in `stackhost.yaml`. Note the assigned
`https://<name>.stackhost.org` URL.

### 3. Environment variables (StackHost → Settings → Environment Variables)

Minimum for a working public site:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | 32+ random chars — `openssl rand -base64 48` |
| `AKBARAL_SITE_URL` | the `https://<name>.stackhost.org` URL from step 2 |
| `AKBARAL_OWNER_EMAIL` | your owner identity |
| `TRUST_PROXY` | `1` |
| `DISABLE_BACKUP_CRON` | `1` (no persistent volume on free tier) |

For durable data (free Neon at `neon.tech`, no card):

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `SEED_DATABASE` | `true` (first boot only) |

To make the 4,001 agents executable:

| Variable | Value |
|---|---|
| `GOOGLE_API_KEY` | free Google AI Studio key (no card) |

Never put any of these in Git or in chat. Host secret UI only.

### 4. Keep it awake
Repo → Settings → Secrets and variables → Actions → New repository secret:
`PRODUCTION_PING_URL` = your StackHost URL. The workflow activates itself.

### 5. Verify
```
npm run launch:check
```
Run it against production config. It prints each check by name and the exact
remaining owner actions. It never prints secret values.

Then confirm by hand:
- `https://<name>.stackhost.org/api/health` → 200
- sign in, open the dashboard
- run one MASTER task (needs `GOOGLE_API_KEY`)

## Not required for launch

Search (keyless DuckDuckGo fallback works), SMTP, social OAuth, Stripe. Each
stays honestly "not configured" until set — nothing silently fails.
