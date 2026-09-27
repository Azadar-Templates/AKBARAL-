# AKBARAL! — free production on Koyeb Hobby + Neon Postgres

**Status 2026-09-27: this is the recommended production path.** Every other kit
in `deploy/` is rejected or retired (SnapDeploy `$1` card hold, Caasify balance
top-up, ClawCloud shut down, Render card at signup, Zeabur no free compute,
Oracle card identity check, Modal `$1` cap). This kit replaces the assumption in
`docs/FINAL_HOSTING_VERIFICATION_2026-09-22.md` that "no host works": the
blocker in that document was **persistent `/data` for SQLite**, and moving both
databases to Neon removes it.

## The architecture (why this one)

| Concern | Choice | Cost | Card |
|---|---|---|---|
| Container runtime | **Koyeb Hobby** — 1 web service, 512 MB RAM, 0.1 vCPU, always-on, free HTTPS subdomain, builds our repo `Dockerfile` or pulls the published image | $0 forever | usually none; a card is requested only if their automated human-check fails (see caveat) |
| AKBARAL! database | **Neon** free Postgres project → `DATABASE_URL` | $0 forever | none |
| ZA141251SA database | **Separate Neon project** (never the same database) → `ZA141251SA_DATABASE_URL` | $0 forever | none |
| Uploads / backups | container filesystem, **ephemeral** | $0 | — |
| TLS + DNS | Koyeb-managed `*.koyeb.app` certificate | $0 | — |

Measured footprint of this image: 300–450 MB RSS — inside the 512 MB instance.

**Honest caveats (read before choosing):**

- Koyeb's own docs say *"some regions require a credit card for the Hobby
  plan"*. If the signup asks for a card **stop** — that violates the project's
  no-card rule; nothing here is worth a card.
- The free plan is **one** web service. The private ZA141251SA tier therefore
  does **not** get a second public service on the free plan. Run it as a second
  Koyeb service only if you ever upgrade; until then run the mission tier
  locally (`npm run mission:serve`) against the same Neon mission database — it
  is private by design and does not need to be on the public internet.
- Uploads are lost on redeploy. Everything that must survive (users, agents,
  tasks, ledger, audit chain) lives in Neon.
- `SESSION_SECRET` must be set explicitly (no persistent disk to store a
  generated one). `scripts/lib/session-secret.mjs` will otherwise generate a
  fresh one per boot and log that sessions will not survive a restart.

## One-time setup

1. **Neon (twice).** neon.tech → sign up (no card) → create project `akbaral`
   → copy the pooled connection string. Create a **second** project
   `za141251sa` → copy its connection string. Two projects, not two tables in
   one: the mission plane must never share a database with customer data.
2. **Koyeb.** koyeb.com → sign up → *Create Web Service* → *GitHub* →
   `Azadar-Templates/AKBARAL-` → branch `main` → builder **Dockerfile** →
   instance **Free** → port **3000** (HTTP) → health check path `/api/ready`.
3. **Environment variables** (Koyeb → Service → Environment, mark each as a
   *secret* where noted). Copy from the table below.
4. Deploy. First boot runs `scripts/start-prod.mjs`: migrations → artifact
   preflight → backup scheduler → web tier on `PORT` + API on its internal port.
5. Seed the registry **once**: redeploy with `SEED_DATABASE=true`, wait for
   `[akbaral] users=… agents=4001`, then set it back to `false`.
6. Verify from your own machine (not from the container):
   `curl -fsS https://<app>.koyeb.app/api/ready` → `{"status":"ready",…}`.
7. Run the launch gate against the real host:
   `AKBARAL_SITE_URL=https://<app>.koyeb.app npm run launch:check -- --deep`
   with the production env loaded. `runtime.egress` must be **ready** there —
   that is the check that proves the host has outbound internet.

## Environment variables

| Variable | Value | Secret | Why |
|---|---|---|---|
| `NODE_ENV` | `production` | no | hardening (mandatory session secret, cookie flags) |
| `PORT` | `3000` | no | Koyeb routes to it; the web tier follows `PORT` |
| `HOST` | `0.0.0.0` | no | bind all interfaces so the platform proxy reaches it |
| `DATABASE_URL` | Neon `akbaral` pooled URL, `?sslmode=require` | **yes** | application database |
| `SESSION_SECRET` | 32+ random chars (`openssl rand -base64 48`) | **yes** | no persistent disk to store a generated one |
| `AKBARAL_SITE_URL` | `https://<app>.koyeb.app` | no | robots/sitemap + payment return URLs |
| `AKBARAL_PUBLIC_WEB_URL` | same | no | links in verification / reset email |
| `DATA_DIR` | `/data` | no | uploads + backups (ephemeral here) |
| `TRUST_PROXY` | `1` | no | exactly one TLS proxy in front |
| `SEED_DATABASE` | `false` (once `true`) | no | first-boot registry seed |
| `GOOGLE_API_KEY` | free Google AI Studio key | **yes** | the brain for 3801 of 4001 agents |
| `TAVILY_API_KEY` | free Tavily key | **yes** | web research (1251 agents use `web_search`) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | free Gmail app password works | **yes** | verification + password reset |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe dashboard | **yes** | customer payments; webhook → `https://<app>.koyeb.app/api/billing/webhook/stripe` |

Mission tier (only on the service that runs `AKBARAL_ROLES=mission`, or on your
own machine — never on the public service):

| Variable | Value | Secret |
|---|---|---|
| `AKBARAL_ROLES` | `mission` | no |
| `ZA141251SA_DATABASE_URL` | Neon `za141251sa` URL | **yes** |
| `ZA141251SA_SESSION_SECRET` | 32+ random chars | **yes** |
| `ZA141251SA_CREDENTIAL_KEY` | 32+ random chars (vault encryption key) | **yes** |
| `ZA141251SA_OWNER_EMAIL` | the single authorised owner identity | no |
| `ZA141251SA_PORT` / `ZA141251SA_BIND_HOST` | `4200` / `0.0.0.0` | no |
| `ZA141251SA_SITE_URL` | the private URL used to build OAuth redirects | no |

The owner password is never an environment variable: run
`npm run mission:owner-setup-link` and type it into the browser once.

## What this kit does NOT claim

- It is not deployed yet. Creating the accounts requires a human; nothing in
  this repository can sign up for you.
- No provider call has succeeded from any host yet. The first real proof is
  `npm run launch:check -- --deep` **on Koyeb**, not in a sandbox.
- If Koyeb asks you for a card, this path is rejected like the others — say so
  and stop.
