# AKBARAL! — Zero-Cost Deployment on ClawCloud Run (no credit card)

**The production image is already built and published for you:**

```
ghcr.io/azadar-templates/akbaral-:latest
```

(automatically rebuilt by GitHub Actions on every push — free, no setup
was required. Rollback tag: `ghcr.io/azadar-templates/akbaral-:<commit-sha>`)

ClawCloud Run gives a **genuine free $5/month credit** to GitHub
accounts **older than 180 days** — no credit card, no trial expiry.
The app below costs ≈ **$4.3/month of that credit** (always-on).

You do NOT need Docker, a server, a domain, or a build step. Just the
steps below.

---

## Step 1 — Account (2 min, unavoidable: it must be YOUR GitHub identity)

1. Go to **https://console.run.claw.cloud**
2. Click **Sign in with GitHub** (OAuth consent — this cannot be done by
   anyone else; your GitHub account must be ≥180 days old for the
   recurring monthly $5 credit).
3. Choose a region close to your users — **Singapore** is good for
   Pakistan (ap-southeast).
4. Create/accept the default workspace.

## Step 2 — Free Gemini key (3 min, unavoidable: YOUR Google identity)

1. Open **https://aistudio.google.com/apikey** → sign in with any Google
   account → **Create API key** → copy it (`AIza…`).
2. No card is required; this is the permanent free tier (Flash models,
   ~15 requests/min — enough for launch traffic).
3. Keep it in your clipboard/paste buffer for Step 3. Never paste it in
   chat, documents, or Git.

## Step 3 — Deploy (5 min, all copy-paste)

In the ClawCloud console open **App Launchpad → Create App**:

| Field | Value |
| --- | --- |
| Name | `akbaral` |
| Image | `ghcr.io/azadar-templates/akbaral-:latest` (public — no credentials needed) |
| CPU | `0.5` |
| Memory | `1024` MiB |
| Deployment mode | **Replicas: 1** (the app is single-node by design — do not scale to 2) |

**Environment variables** (add each exactly; in App Launchpad →
"Environment Variables"):

```
SEED_DATABASE=true
SESSION_SECRET=<PASTE_A_LONG_RANDOM_STRING_40+_CHARS>
GOOGLE_API_KEY=<PASTE_YOUR_AI_STUDIO_KEY>
TRUST_PROXY=1
```

> `SESSION_SECRET`: any long random string, e.g. 50+ mixed characters
> from a password manager or https://www.random.org/strings/.
> Once set, never change it (it signs sessions).

**Container port** (Networking section): `3000` (the image listens
there and internally proxies `/api/*` to the backend).

**Storage** (persistent volume — THIS is the database):
- Add storage → mount path: **`/data`** → size: **2 Gi**
- (SQLite, uploads and nightly backups all live in `/data`; the 4,001
  agent registry is seeded into it on first boot and persists across
  restarts and redeploys.)

**Enable public access** (Networking): toggle on for port 3000 →
ClawCloud assigns **`https://<something>.run.claw.cloud`** with automatic
HTTPS (Let's Encrypt managed by the platform). Optionally add a custom
domain later in the same panel.

Click **Deploy**. First boot: the entrypoint runs all 13 migrations and
seeds the registry + plans (~1–2 minutes).

## Step 4 — One-time switch off seeding (important)

After the app is **Running** and healthy:

1. Edit the app → change `SEED_DATABASE` → `false`
2. Redeploy (env change triggers it)

(Never re-seed a live database; migrations keep running automatically
on every boot and are idempotent.)

## Step 5 — Verify (copy-paste into the app's Terminal button)

App Launchpad → your app → **Terminal**:

```bash
node dist/src/scripts/audit-registry.js        # expect: PASS, 4001 agents
node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>r.text()).then(console.log)"   # expect: {"status":"ready"...}
```

Then in any browser:

```
https://<your-app>.run.claw.cloud            → AKBARAL! landing page (HTTPS padlock)
…/api/health                                → {"status":"ok"}
Sign up → MASTER → submit a goal            → real Gemini run, COMPLETED,
                                              1 free credit consumed, verification shown
```

## Backups & recovery

- Nightly **verified** SQLite snapshots land in `/data/backups`
  (30 kept) — fully automatic, inside the persistent volume.
- Restore procedure: `docs/DEPLOYMENT.md` (restore drill already
  rehearsed: P0 #3).
- **Honest risk note:** ClawCloud is a young provider — the free credit
  is real and current, but a young company can change terms. The nightly
  backups + the GHCR image mean the entire product can be redeployed
  anywhere Docker runs in ~10 minutes. Before any major data milestone,
  also download a backup: app Terminal →
  `node dist/src/scripts/backup-db.js /data/backups` then use the
  console file manager (or ask and we will script an off-site push).

## Cost accounting (why this stays inside the free $5)

| Resource | Setting | ≈ Cost/month |
| --- | --- | --- |
| CPU | 0.5 vCPU always-on | ~$2.00 |
| RAM | 1 GiB | ~$2.00 |
| Volume | 2 Gi | ~$0.30 |
| Network | launch-scale traffic | ~$0.00–0.50 |
| **Total** | | **≈ $4.30 ≤ $5 credit** |

If traffic grows past the credit, the honest options are: their $5 Hobby
plan (first revenue), a paid Gemini key (cents), or the Oracle/Postgres
paths already documented in `docs/ZERO_COST_LAUNCH.md`.

## Why not Render / Koyeb / Fly / Railway free?

Checked and rejected honestly: their free tiers have **no persistent
disk** (SQLite would be wiped on every restart), sleep after idle
(30–60s cold starts on every visit), are one-time trials, or require a
card. ClawCloud Run is the only reputable current option that keeps the
existing single-container architecture genuinely persistent at $0 with
no card.
