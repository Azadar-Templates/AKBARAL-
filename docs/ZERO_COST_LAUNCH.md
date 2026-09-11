# AKBARAL! — Zero-Cost Launch Runbook (September 18 target)

> **Path status (2026-09-11):** Oracle Cloud signup was blocked in
> practice (card + identity verification + request-limit errors), so the
> **primary path is now ClawCloud Run** (`deploy/free-clawcloud/`) —
> genuinely free $5/month via GitHub OAuth (account ≥180 days), **no
> credit card**, persistent volume, automatic HTTPS, and the production
> image is prebuilt for you at `ghcr.io/azadar-templates/akbaral:latest`.
> The Oracle path below remains valid for whenever a card becomes
> acceptable; the app and image are identical for both.

**Goal:** publicly accessible AKBARAL! with HTTPS, persistent database,
backups and a real AI provider — at **$0 upfront**, using only reputable
providers' genuine free tiers. Upgrades happen from revenue, later.

What is honest and true about this plan:

- The application, Docker image, migrations, seed, verified-backup system
  and health checks are already built and tested (P0 #1–#3).
- Nothing here uses fake infrastructure, trial-only services that convert
  to paid, or demo/mock providers.
- Every free tier below is an official **Always Free** / permanent tier of
  a reputable provider — not a expiring trial credit.
- The two things that genuinely CANNOT be free anywhere: a custom domain
  name (any real domain costs money) and OpenAI's API (no free tier —
  which is why this runbook uses **Google Gemini's free tier**, which the
  app supports natively via its existing Google provider adapter).

## The stack (all free)

| Need | Free solution | Limits (honest) |
| --- | --- | --- |
| Host VM | **Oracle Cloud Always Free** — Ampere A1 (ARM), Ubuntu 24.04 | 4 OCPU + 24 GB RAM + 200 GB disk + 10 TB egress/mo, forever. Card needed at signup for identity verification only (never charged for Always Free; prepaid/virtual cards not accepted). Some regions report "out of capacity" — pick a region with A1 stock. Idle instances may be reclaimed by Oracle; keep real traffic flowing. |
| HTTPS/TLS | **Caddy** (already configured in `deploy/free-oracle/`) | Automatic Let's Encrypt certificates + renewal. Unlimited, free. |
| Domain | **DuckDNS** free subdomain `yourname.duckdns.org` | Free forever, community-run. No sub-subdomains. A real custom domain can replace it later (DNS-only change). |
| Database | SQLite on the VM boot volume (the app's designed architecture) | Persists across restarts/redeploys. 200 GB free disk is ample. |
| AI provider | **Google AI Studio (Gemini API) free tier** → `GOOGLE_API_KEY` | No card required. Flash models only (the catalog's `gemini-2.0-flash` qualifies). ~15 requests/min, hundreds/day (varies by model) — enough for launch-phase traffic. **Free-tier data may be used by Google to improve products** — upgrade to paid key before handling sensitive customer data. |
| Backups | Nightly verified `VACUUM INTO` snapshots on the VM volume (built-in, 30 kept) + optional free off-site copy (below) | On-machine only until the optional off-site step is done. |
| Secrets | `.env` on the VM (git-ignored, `chmod 600`) | Never committed; you edit it on the server. |
| Source/CI | GitHub (already hosting the repo, public) | Unlimited free Actions on public repos if CI is wanted later. |

## What YOU must click/create (the only manual steps)

### 1. Oracle Cloud account + free VM  (~15 min)
1. Go to **https://signup.cloud.oracle.com/** → "Start for free".
2. Create the account: name, email, address, phone. You will be asked for
   a **credit or debit card** — it is an identity check with a temporary
   ~$1 hold; **Always Free resources are never charged.** Virtual,
   prepaid and PIN-debit cards are rejected.
3. Choose a **home region with Ampere A1 capacity** (try Frankfurt,
   Singapore, or a less-popular region if US shows "out of capacity").
   The home region cannot be changed later.
4. In the Console: **Compute → Instances → Create instance**:
   - Name: `akbaral`
   - Image: **Canonical Ubuntu 24.04** → click "Edit" → change shape to
     **Ampere** (VM.Standard.A1.Flex) → set **2 OCPUs / 12 GB RAM**
     (leave headroom under your 4/24 allowance; you can resize later)
   - Boot volume: leave defaults (within the 200 GB free total)
   - SSH key: **"Generate key pair"** → download BOTH files, keep them safe
   - Create. Note the **Public IP**.
5. **Networking → Security List for the instance's VCN → Add Ingress
   Rules**: allow source `0.0.0.0/0`, TCP **80** and **443** (22/SSH is
   already there).

### 2. DuckDNS subdomain  (~2 min)
1. Go to **https://www.duckdns.org** → sign in with any of the listed
   providers (GitHub works).
2. Create a subdomain, e.g. `akbaral` → **`akbaral.duckdns.org`**.
3. Point it at the VM's public IP from step 1.
4. (Optional resilience) DuckDNS updates the IP via a URL token — the VM
   can keep it current with a cron `curl` if the IP ever changes
   (Oracle free IPs are reserved while the instance exists).

### 3. Google AI Studio key — the FREE real AI provider  (~3 min)
1. Go to **https://aistudio.google.com/apikey** → sign in with any Google
   account → **"Create API key"**. No card. No trial. Genuinely free tier.
2. Copy the key (`AIza…`). You will paste it into the server's `.env` in
   step 4 — never into chat, never into Git.
3. This activates the app's existing Gemini adapter and `gemini-2.0-flash`
   model (free-tier eligible Flash model). The model router picks it up
   automatically; `/api/models` will show it as available.

### 4. Deploy on the VM  (~10 min + first build time)
SSH into the VM (`ssh -i <your-key> ubuntu@<public-ip>`) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Azadar-Templates/AKBARAL-/main/deploy/free-oracle/setup-vm.sh \
  | bash -s -- --repo https://github.com/Azadar-Templates/AKBARAL-.git --domain akbaral.duckdns.org
```

The script: installs Docker, opens the firewall, clones the repo, creates
`.env` (generates a strong `SESSION_SECRET` itself, sets
`AKBARAL_PUBLIC_WEB_URL`, `TRUST_PROXY=1`, CORS) — then stops and tells
you to add your key. Do exactly that:

```bash
cd ~/AKBARAL- && nano .env        # add: GOOGLE_API_KEY="AIza…"  (and nothing else needs changing)
```

Then first boot with seeding, and verify:

```bash
cd ~/AKBARAL-
SEED_DATABASE=true docker compose -f deploy/free-oracle/docker-compose.free.yml --env-file .env up -d --build
# after "healthy":
sed -i 's/^SEED_DATABASE=.*/SEED_DATABASE=false/' .env   # never re-seed a live DB
docker compose -f deploy/free-oracle/docker-compose.free.yml --env-file .env up -d

curl -f https://akbaral.duckdns.org/api/health   # {"status":"ok"...}
curl -f https://akbaral.duckdns.org/api/ready    # DB+migrations+queue OK
docker exec -it $(docker ps -qf name=akbaral) node dist/src/scripts/audit-registry.js   # PASS, 4001
```

### 5. (Strongly recommended, still free) Off-site backups
On-volume nightly backups already run inside the container. For off-site:

- **Option A — Oracle Object Storage (Always Free, same account):**
  Console → Storage → Buckets → Create (Standard, your compartment).
  Create an S3-compatible Customer Secret Key (Identity → Customer Secret
  Keys). On the VM: `sudo apt-get install -y rclone`, configure with the
  S3 endpoint for your region, then add a cron:
  `rclone sync /var/lib/docker/volumes/.../backups remote:akbaral-backups`
  (free allowance covers many years of 36 MB nightly snapshots).
- **Option B — GitHub private repo (free):** nightly encrypted
  (`age`) push of the latest snapshot to a private repo.

## Verification checklist after deploy (P0 smoke)

```
HTTPS            curl -I https://akbaral.duckdns.org            → 200, valid LE cert
Homepage         open in browser                                  → landing renders
API health       curl -f .../api/health                          → ok
Register/Login   via the UI on the real domain
Models           GET /api/models (auth)                          → gemini-2.0-flash available:true
MASTER E2E       run one real goal (P0 #4)                       → COMPLETED, 1 credit, verification shown
Registry         audit-registry.js                                → PASS 4001
Restart/recovery docker compose restart                          → data persists
Backups          ls volume backups + restore drill per docs/DEPLOYMENT.md
Logs             docker compose logs                             → clean
```

## Honest limits of the free launch (say them out loud)

1. **Gemini free tier** rate limits (≈15 RPM) cap concurrent MASTER runs
   to a handful; queuing beyond that fails honestly with refunds intact.
   Fine for launch traffic; upgrade the key to paid when revenue starts.
2. **Google's free tier may process data to improve products** — put this
   in the privacy policy until you switch to a paid key.
3. **Single node, ARM VM** — vertical scale only, exactly as the paid
   runbook documents; PostgreSQL/Redis remains the post-revenue path.
4. **DuckDNS subdomain**, not a custom domain — replaceable later by a
   DNS change + one env var, no rebuild.
5. **Oracle idle-reclaim policy** — Always Free instances that sit idle
   for long stretches can be stopped by Oracle; real usage keeps it safe.
   Backups + the restore drill make any worst case recoverable.

## Upgrade path (only after revenue)

| When | Upgrade |
| --- | --- |
| First paying users | Paid Gemini key (per-use, cents) — same env var |
| Traffic beyond one node | PostgreSQL + Redis (documented POST-LAUNCH path in docs/DEPLOYMENT.md) |
| Brand requirement | Custom domain (~$10/yr) — DNS swap + `AKBARAL_DOMAIN` |
| 4,001 agents × real usage | Resize A1 to full 4 OCPU/24 GB (still free) → then paid compute |
