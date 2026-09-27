# AKBARAL! on Hugging Face Spaces (Docker) + Neon — $0, no card

**Chosen free production path, 2026-09-27.** See `deploy/FREE_HOSTING_MATRIX.md`
for why every other kit in `deploy/` was rejected (card, $1 hold, balance
top-up, no free compute, or too little RAM).

| | |
|---|---|
| Cost | **$0**, permanently |
| Credit card | **never asked for** on CPU Basic |
| Compute | 2 vCPU, **16 GB RAM**, unmetered CPU time |
| Disk | ~50 GB **ephemeral** (wiped on rebuild) |
| Sleep | only after **48 hours** with no visitor; wakes in 30–90 s |
| URL + TLS | free `https://<owner>-<space>.hf.space`, certificate managed |
| Secrets | per-Space secrets, injected as environment variables |
| Outbound internet | yes — this is what the sandbox lacks |

## 1. Databases first (free, no card)

1. neon.tech → sign up → project **`akbaral`** → copy the pooled connection
   string → this becomes `DATABASE_URL`.
2. Create a **second** project **`za141251sa`** → its connection string becomes
   `ZA141251SA_DATABASE_URL`. Two separate projects, never one database: the
   mission plane and customer data must not share storage.

## 2. Create the Space

1. huggingface.co/join (free, no card) → **New Space**.
2. Space SDK: **Docker** → blank template. Hardware: **CPU basic — free**.
3. Space visibility: public (private Spaces are a paid feature). The
   application's own authentication still protects every non-public route, and
   the private mission tier is **not** deployed here.

## 3. Push this repository to the Space

The Space is a git repo. From a clone of this repository:

```bash
git remote add space https://huggingface.co/spaces/<your-user>/akbaral
git push space arena/01a0dd85-akbaral:main
```

The Space builds the repository `Dockerfile` as-is. Add the Space front-matter
by committing `README.md` at the Space root with:

```yaml
---
title: AKBARAL!
emoji: 🟢
colorFrom: green
colorTo: gray
sdk: docker
app_port: 3000
pinned: false
---
```

(`app_port: 3000` matches `scripts/start-prod.mjs`, which binds the web tier to
`PORT`/3000 on 0.0.0.0 and keeps the API on an internal port.)

## 4. Space secrets (Settings → Variables and secrets)

Secrets (not variables):

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon `akbaral` pooled URL (`?sslmode=require`) |
| `SESSION_SECRET` | 32+ random chars — `openssl rand -base64 48` |
| `GOOGLE_API_KEY` | free Google AI Studio key (no card) |

Variables:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `AKBARAL_LAUNCH_MODE` | `free` (defers paid billing honestly) |
| `TRUST_PROXY` | `1` |
| `DATA_DIR` | `/data` |
| `SEED_DATABASE` | `true` for the first successful boot, then `false` |

You do **not** need `AKBARAL_SITE_URL`: the app detects `SPACE_HOST` and uses
the free `*.hf.space` hostname as its production URL
(`src/config/platform-url.ts`). Set it only if you ever buy a domain — which
should be paid for out of verified mission revenue, never upfront.

## 5. Verify from your own machine (not from the container)

```bash
curl -fsS https://<owner>-<space>.hf.space/api/ready     # {"status":"ready",...}
curl -fsS https://<owner>-<space>.hf.space/api/health
```

Then run the launch gate with the production environment loaded:

```bash
npm run launch:check -- --deep
```

`runtime.egress` must be **ready** there. That is the first moment a real
provider call can succeed; nothing in the Arena sandbox can prove it.

## 6. The private ZA141251SA tier

Do **not** put it on a free public Space. Options, both $0:

* run it on your own machine: `npm run mission:serve` against the Neon
  `za141251sa` database (the dashboard stays on localhost), or
* run it as a second, private service later, funded by verified revenue:
  `AKBARAL_ROLES=mission` starts only that tier (`dist/src/mission/serve.js`)
  with its own port, database, auth and secrets.

## Honest limitations

* After 48 h with no traffic the Space sleeps; the next visitor waits ~1 minute.
* Uploads are lost on rebuild (everything durable is in Neon).
* Free Spaces are public; the mission tier is deliberately not deployed here.
* Hugging Face is an ML-focused host. AKBARAL! is an AI application, which fits,
  but if the Space is ever flagged as out of scope, the same Docker image runs
  unchanged on any other host in the matrix.
