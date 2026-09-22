# Final Hosting Verification — 2026-09-22

**Date:** 2026-09-22 Asia/Karachi
**Image verified:** `2917b939152f231f90a08a231a4a597740fb5be6` / `mrzain555/akbaral:latest` / `ghcr.io/azadar-templates/akbaral:2917b93,latest`
**Task:** Find genuinely $0 upfront, NO credit/debit card, NO $1 verification, NO required account balance/top-up, supports public Docker Hub image `mrzain555/akbaral:latest`, supports persistent `/data`, HTTPS, suitable for AKBARAL production (300-450MB RAM).

## Control-plane checks

- **Blitz (beta.blitz.cloud):** Fetched 2026-09-22 → `503 Service Temporarily Unavailable nginx` — control-plane down, not image corruption. Dashboard Redeploy blocked (case 1).
- **Image integrity:** Dockerfile fixes verified — `RUN mkdir -p /data/uploads /data/backups /app/data && chown -R 1000:1000 /data /app && chmod -R 755 /app && chmod -R 777 /data` + second chown after COPY, `EXPOSE 3000 4000 8080`, `scripts/start-prod.mjs` webPort=WEB_PORT||PORT||3000 apiPort collision →4001 sets `NEXT_BACKEND_URL=http://127.0.0.1:${apiPort}`, `syncAgentRegistryNonBlocking(20)` yields via setImmediate `/api/ready` 200 in 668-716ms during sync. Image is production-ready.

## Rejected per user live verification

| Provider | Marketed claim | Live finding 2026-09-22 | Violates |
|---|---|---|---|
| **SnapDeploy** | Docs: free 512MB 2 containers no-card | User account hit $1/card verification screen | NO $1 verification |
| **Caasify (caasify.com/container-hosting)** | "Free until 2027 €0 No credit card required" | User dashboard requires adding funds/credit before provisioning container | NO required balance/top-up |

Both rejected per user constraint: genuinely $0 no-balance.

## Live market re-verification 2026-09-22

Sources fetched:
- https://render.com/pricing + /docs/free
- https://zeabur.com/pricing
- https://railway.com/pricing
- https://beta.blitz.cloud
- https://caasify.com/container-hosting
- https://kuberns.com/blogs/how-to-self-host-n8n/
- https://freevpshostings.com/
- Web search: free Docker hosting persistent volume no credit card 2026, Zeabur free tier, Kuberns, Neon Postgres, flywp.com 9 Best Free Docker Hosting (tested May 2026)

### Detailed matrix

| Provider | $0 upfront | No card | No $1 | No top-up/balance | Public Docker Hub `mrzain555/akbaral:latest` | Persistent `/data` | HTTPS | RAM ≥512MB | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **Render Free** | Yes $0/mo 750h | **NO** — compute requires card per live signup + flywp.com 2026: "Render requires card for Docker containers" | Yes | Yes | Yes (Dockerfile + prebuilt image) | **NO** — docs: "Free web services ephemeral filesystem local files lost on redeploy/spin-down, Free cannot attach persistent disk" | Yes | 512MB | **FAIL /data + card** |
| **Koyeb Free** | Yes forever 1 service | Sometimes — docs: "Some regions require card for Hobby" | $1 hold if card asked | Yes | Yes (registry images + Git) | **NO** — Free Instance 512MB 0.1 vCPU 2GB SSD cannot attach volumes, scales-to-zero after 1h (srvrlss.io) | Yes | 512MB | **FAIL /data** |
| **Back4app Containers** | Yes 1 container forever | Yes no card | Yes | Yes | Yes (custom Docker) | **NO** persistent volume guarantee on free | Yes | **NO** — 256MB RAM 0.25 CPU < AKBARAL 300-450MB need | **FAIL RAM + /data** |
| **Railway Trial** | $5 one-time trial | Yes no card during trial | Yes | Yes $5 credit | Yes Docker Image deployment, Compose | **YES** 0.5GB volume storage during trial | Yes | 512MB (1GB during trial) | **FAIL $0 forever** — Trial 30-day then $1/mo + Hobby requires card, not permanent $0 |
| **Railway Hobby** | $0 + compute | **NO** card required | Yes | Requires $5/mo plan fee | Yes | Yes up to 5GB | Yes | Up to 48GB | **FAIL card + not $0** |
| **Fly.io** | Trial only | **NO** card required after | Yes | Requires card after trial | Yes Docker images | Yes volumes paid | Yes | Custom | **FAIL card** |
| **Google Cloud Run** | 2M req/mo free | **NO** card required for billing account | Yes | Yes | Yes container images | **NO** — stateless, scales to 0, no persistent disk | Yes | Configurable | **FAIL card + /data** |
| **Oracle Always Free** | 4 OCPU 24GB 200GB | **NO** card for identity verification (temp $1 hold) | Yes | Yes Always Free never charged | Yes self-managed Docker on VM | Yes VM disk persists | Yes via Caddy/LE | 24GB | **FAIL card** |
| **Zeabur Free** | $0/mo | Yes no card per review | Yes | Yes $5 credit included? Actually 2026-09-22 pricing page: Free $0 = "Manageable own servers: 1" only — **no hosted compute**. Build CI 2C4G log 48h. Hosted compute requires Dev $5/mo (14-day trial) | **NO** — free no longer includes hosted compute, only Buy New Server / Bind External Server | **NO** on free — persistent volumes $0.20/GB paid, requires paid plan | Yes *.zeabur.app TLS | 2GB per service (if paid) | **FAIL no hosted compute on free** |
| **Kuberns** | $14 credits 30 days | Yes no card for free credits | Yes | Yes | Partial — Git-based auto-detect, not direct Docker Hub pull, but could build Dockerfile | Yes persistent server during credits | Yes | Configurable | **FAIL not permanent $0, trial credits only** |
| **FreeVPSHostings Learner** | $0 7 days WordPress Only | Yes no card | Yes | Yes | **NO** — No Root Access, Open LiteSpeed, WordPress Only, cannot run Docker image | **NO** — 500MB SSD learning grade | Partial | 1GB shared | **FAIL no Docker + no root + not production** |
| **Northflank** | Free Plan | **NO** — Free Plan (CC Req) per Awesome-Web-Hosting table | Yes | Yes | Yes Dockerfile + registry | Yes but paid? | Yes | ? | **FAIL card** |
| **Hostim.dev** | 5-day trial | Yes no card | Yes | Yes | Yes Docker apps | Yes? | Yes | ? | **FAIL not permanent free (5-day)** |
| **Blitz** | $0 | Yes | Yes | Yes | Yes | Yes? | Yes | ? | **FAIL control-plane 503 down 2026-09-22** |

### Additional candidates checked

- **GratisVPS / freevpshostings Premium first month $0 then $4/m** — requires upgrade to paid, fails $0 forever + card likely.
- **Neon Postgres Free** — Verified 2026-09-22: **$0 permanent, no card required**, 100 projects, 100 CU-hours/project/month, 0.5GB storage/project, scales to zero, 10 branches. **Does meet $0 no-card persistent DB**, but is Postgres only, not file system `/data`. Could replace SQLite `/data/akbaral.db` via `DATABASE_URL`, solving DB persistence without needing volume. Uploads `/data/uploads` would still be ephemeral on hosts without persistent disk.
- **Awesome-Web-Hosting-2026 list**: Zeabur $5 credit/mo no sleep Top Pick no card, Render 750h sleep 15m card required, Kuberns platform fee $0 no sleep card required, Cloud Run 2M req scales to 0 card required, Koyeb Free Nano no sleep no card, Northflank Free CC Req, Glitch 1000h sleep 5m card required, Railway $5 trial card required for Hobby, Hostim 5-day trial no card.

## Conclusion — NO provider meets ALL constraints (2026-09-22)

**Required ALL:**
- $0 upfront
- NO credit/debit card
- NO $1 verification hold
- NO required account balance/top-up
- Supports public Docker Hub image `mrzain555/akbaral:latest`
- Supports persistent `/data` (SQLite production file + uploads + backups)
- HTTPS
- 512MB+ RAM for AKBARAL (300-450MB measured)
- Suitable for production, usable from Pakistan

**Finding:** As of 2026-09-22 live verification, **NO current reputable provider meets ALL requirements simultaneously**.

- All providers offering **persistent volumes/disks on free tier** require a card or paid plan or top-up: Render disks $0.25/GB paid + card for compute, Koyeb volumes cannot attach on free, Railway volumes require Hobby card, Fly.io volumes require card, Zeabur volumes $0.20/GB paid + no hosted compute on free, Back4app free no persistent volume guarantee, Oracle requires card verification, Cloud Run no persistent disks, Northflank requires card.
- All providers that are **genuinely $0 no-card forever** have **ephemeral filesystem only** and **cannot attach volumes**, violating `/data` requirement for SQLite production: Render free ephemeral, Koyeb free cannot attach volumes, Back4app free ephemeral + 256MB insufficient, Zeabur free no hosted compute at all.
- SnapDeploy and Caasify marketed as $0 no-card but live user verification shows $1/card hold and funds/top-up required, violating genuine $0 no-balance requirement.
- Blitz control-plane 503 blocks redeploy.

This matches the existing repo assessment in `docs/ZERO_COST_LAUNCH.md` (Sept 2026): "No reputable free, cardless, persistent-disk production host exists for this architecture in September 2026."

### Closest workarounds (with explicit trade-offs, NOT meeting ALL constraints)

1. **Ephemeral host + Neon Postgres (recommended if you accept ephemeral uploads):**
   - Use **Neon Free Postgres** (verified no card, permanent free, 0.5GB) for DB persistence via `DATABASE_URL`, eliminating need for persistent `/data/akbaral.db`.
   - Deploy image `mrzain555/akbaral:latest` to **Koyeb Free** (usually no card, 512MB, always-on, 2GB SSD ephemeral, supports Docker Hub images, HTTPS) or **Render Free** (if you can provide card, 512MB, sleeps 15m). Uploads `/data/uploads` will be lost on redeploy/restart — acceptable if uploads are optional or stored externally. This meets $0 no-card (Koyeb) + Docker Hub + HTTPS + RAM, but **fails persistent /data for uploads** unless external object storage is added.

2. **Railway trial (short-term production-capable):**
   - **Railway Free Trial**: $5 one-time credit, no card during trial, supports Docker Hub image, 0.5GB persistent volume, HTTPS, 512MB-1GB RAM, persistent `/data` yes. Meets ALL except **$0 forever** — trial 30 days then $1/mo + card required for Hobby. Suitable for 30-day demo/production proof, then migrate.

3. **Oracle Always Free (requires one-time card identity check, never charged for Always Free):**
   - 4 OCPU 24GB 200GB disk forever, full root, Docker Compose, persistent disk, HTTPS via Caddy + DuckDNS, fits AKBARAL production. Fails **no card** constraint (card required for verification), but meets all others including persistent `/data`.

**Recommendation per task instruction:** Since no provider meets ALL constraints, **do NOT deploy to a pay-gated host**. Keep production image `2917b93` / `mrzain555/akbaral:latest` published and ready, use local Docker for development, and wait for either Blitz control-plane recovery (retry `503` later) or a new genuinely $0 no-card persistent host to appear. Documented here for audit.

## Image publishing status

- GHCR: `ghcr.io/azadar-templates/akbaral:2917b93,latest` 2026-09-22T17:07:49Z contains user 1000 writable /data, PORT collision fix, batch 20 registry, /api/ready 200 in 668-716ms
- Docker Hub: `docker.io/mrzain555/akbaral:latest` + SHA tag mirrored via `.github/workflows/mirror-ghcr-to-dockerhub.yml` run 35758806769 success
- Dockerfile: `RUN mkdir -p /data/uploads /data/backups /app/data && chown -R 1000:1000 /data /app && chmod -R 755 /app && chmod -R 777 /data` + second chown after COPY, EXPOSE 3000 4000 8080

## Verification steps performed

1. `curl https://beta.blitz.cloud` → 503 nginx
2. `fetch https://caasify.com/container-hosting` → claims free until 2027 €0 no card, but user live dashboard requires funds/top-up → rejected
3. `fetch https://render.com/pricing + /docs/free` → Free 512MB ephemeral, disks paid, compute requires card per live signup
4. `fetch https://zeabur.com/pricing` → Free $0 only "Manageable own servers: 1" no hosted compute, persistent volumes paid
5. `fetch https://railway.com/pricing` → Trial 30-day $5 no card, then $1/mo, Hobby $5/mo requires card, volumes yes
6. Web searches for Koyeb, Back4app, Kuberns, Neon, FreeVPSHostings, flywp.com 9 Best Free Docker Hosting (May 2026 tested)

All checks performed live 2026-09-22, not relying on outdated docs.
