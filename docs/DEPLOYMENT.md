# AKBARAL! / MASTER AI — Production Deployment Runbook (Milestone 10)

This is the honest operational guide for the 18 September 2026 launch. What
is described here is implemented and tested; anything not implemented is
explicitly marked POST-LAUNCH.

## Architecture (single node — by design, not by omission)

```
            ┌────────────────────────── one container ─────────────────────────┐
 internet → │  Next.js :3000  (homepage + SPA; /api/* and /uploads/* proxied)  │
            │  Express API :4000  (auth, agents, tasks, billing, admin, ws)    │
            │  SQLite  /data/akbaral.db   uploads /data/uploads                │
            │  backups /data/backups  (verified snapshots, nightly)            │
            └─────────────────────────────── volume: akbaral_data ─────────────┘
```

- The database is SQLite (file on a Docker volume). It has a single writer.
- The execution queue is in-process. One container = one worker pool.
- **This deployment does NOT scale horizontally, and it does not pretend
  to.** Vertical scaling (more RAM/CPU/faster disk) is the launch posture.
  A single modern node comfortably serves the launch traffic envelope;
  PostgreSQL + Redis-backed queue is the documented POST-LAUNCH path (see
  “Scaling honestly” below). The repository layer is deliberately thin and
  typed so that migration is a backend project, not a rewrite.

## First deployment

```bash
cp .env.example .env.production        # then fill in real values (below)
docker compose -f docker-compose.production.yml --env-file .env.production up -d --build
docker compose -f docker-compose.production.yml exec akbaral \
  sh -c 'SEED_DATABASE=true node dist/src/db/seed.js'   # first boot only
curl -f http://localhost:3000/api/ready                 # must return 200 "ready"
```

Migrations apply automatically at container start (before the server binds),
and crash recovery requeues interrupted executions on boot. A deploy
therefully takes a brief restart window — on a single node this is the safe,
honest trade-off; zero-downtime deploys are POST-LAUNCH.

## Required environment (.env.production)

| Variable | Notes |
| --- | --- |
| `SESSION_SECRET` | REQUIRED in production; random ≥32 chars (`openssl rand -base64 48`). The server refuses to start without it. |
| `SESSION_SECRET_PREVIOUS` | Optional rotation grace — set the OLD secret after rotating so live access tokens survive their remaining ≤1h lifetime. Remove afterwards. |
| `BILLING_WEBHOOK_SECRET` | Required for `/api/billing/webhook` to accept anything. |
| `AKBARAL_PUBLIC_WEB_URL` | Public URL used in email links. |
| `TRUST_PROXY` | `1` only behind exactly one trusted TLS proxy. |
| `CORS_ORIGINS` | Comma-separated browser origins if the API is called cross-origin. |
| `STRIPE_SECRET_KEY` / `RAZORPAY_KEY_ID`+`RAZORPAY_KEY_SECRET` | Optional; unset providers return honest 402 `provider_not_configured`. |
| `SMTP_*` | Optional; password reset/verification falls back to dev tokens when unset. |

All other settings (queue concurrency, commission bps, timeouts) are
documented inline in `.env.example`.

## Probes and monitoring

- `GET /api/health` — liveness. Real database round trip; 503 `degraded` if
  the DB is unreachable. (The pre-M10 payload reported `database:'ok'`
  unconditionally; that fake is gone.)
- `GET /api/ready` — readiness. Verifies database, all migrations applied,
  upload directory writable, execution-queue worker alive. Gate load
  balancers and container orchestration on this.
- `GET /api/metrics` — Prometheus text format, **admin token required**.
  Real measurements only: process uptime/RSS/heap, HTTP request rate and
  average duration (5-minute window from `system_metrics`), queue jobs by
  status, active workers, database size, users/agents/tasks counters.
  Scrape example:

  ```
  - job_name: akbaral
    bearer_token: <admin access token>   # or an auth proxy that injects it
    static_configs: [{ targets: ['akbaral:4000'] }]
  ```

  (A dedicated read-only metrics token is POST-LAUNCH; today the endpoint is
  admin-authenticated, which is honest and safe.)
- Structured JSON request logs go to stdout (never containing tokens or
  authorization headers) — `docker logs` / any log shipper picks them up.
- The Docker image healthcheck polls `/api/ready` every 30s and restarts an
  unhealthy container.

## Backups — verified, not assumed

The old `scripts/backup.sh` did a bare `cp` of a live database (a snapshot
that can be silently corrupt). It is replaced by `src/scripts/backup-db.ts`:

1. `VACUUM INTO` — SQLite's own online backup: transactionally consistent
   even while the server is writing.
2. **Verification before success is reported**: the snapshot is opened
   independently, `PRAGMA integrity_check` must pass, and row counts for
   `users, tasks, agents, invoices, credit_transactions, projects` must
   equal the live database. A backup that fails verification is deleted and
   the command exits non-zero.
3. sha256 + size recorded in the CLI output for audit logs.
4. Retention: only the newest N snapshots are kept (default 30).

Operations:

- Nightly automatic: the container runs a verified backup at 01:17 UTC into
  `/data/backups` (disable with `DISABLE_BACKUP_CRON=1`, tune with
  `BACKUP_KEEP`).
- Manual: `docker compose -f docker-compose.production.yml exec akbaral \
  node dist/src/scripts/backup-db.js /data/backups 30`
- Verify any snapshot any time:
  `docker compose ... exec akbaral node -e "…"` or locally
  `DATABASE_URL=file:./data/akbaral.db npm run db:backup`.
- **Restore** (`src/scripts/restore-db.ts`): verifies the backup's
  integrity first (refuses corrupt files), takes a safety snapshot of the
  current database, then atomically replaces the live file and clears stale
  WAL sidecars. Restart the server immediately afterwards:

  ```bash
  docker compose -f docker-compose.production.yml stop akbaral
  docker compose -f docker-compose.production.yml run --rm akbaral \
    node dist/src/scripts/restore-db.js /data/backups/akbaral-<stamp>.db
  docker compose -f docker-compose.production.yml start akbaral
  curl -f http://localhost:3000/api/ready
  ```

- **Run a restore drill before launch** (on a staging copy): the restore
  path is covered by automated tests (`src/scripts/backup.test.ts`:
  snapshot verification, corrupt-file rejection, drift detection, retention,
  full round-trip restore), but operators should walk the manual steps once.

Backups live on the same volume as the database — they protect against
corruption and operator error, not against volume/host loss. **Copy backups
off-host daily** (cron + `docker cp`/rsync of `/data/backups`); off-site
backup automation is POST-LAUNCH.

## Scaling honestly

| Concern | Launch posture | POST-LAUNCH |
| --- | --- | --- |
| Web/API throughput | One node; Next rewrites + one API process; vertical scaling | Multiple web/API replicas behind LB once the DB moves off-node |
| Database | SQLite file, single writer, `busy_timeout=5000` | PostgreSQL migration via the thin `Database`/repository layer |
| Execution queue | In-process worker pool (concurrency 1–8 via `AKBARAL_QUEUE_CONCURRENCY`) | Redis/Postgres-backed queue + separate workers |
| Rate limiting | In-memory per-IP buckets (per process) | Shared store |
| Sessions/tokens | Stateless JWTs + server-side session table — already LB-ready | — |
| File storage | Local volume `/data/uploads` | S3-compatible object storage |

## Security operations (from Milestone 9)

- Per-account login lockout: 10 failures/15 min → 429 (durable, auditable in
  `security_logs`).
- Admin audit trail: `GET /api/admin/audit?actor&action&from&to` — feature
  flags, model/agent status changes, payment settlements, queue actions.
- Secret rotation: change `SESSION_SECRET`, set the old value as
  `SESSION_SECRET_PREVIOUS` for ≤1 hour, then remove it.
- `scripts/scan-secrets.ts` and `scripts/audit-registry.ts` exist for
  pre-deploy checks; run them in CI.

## Launch checklist

1. `.env.production` secrets set (SESSION_SECRET, BILLING_WEBHOOK_SECRET).
2. `docker compose ... up -d --build` + `SEED_DATABASE=true` on first boot.
3. `curl -f /api/ready` → 200; `curl /api/health` → `status: ok`.
4. Register a test account; verify trial grant (5 credits / 30 days).
5. Trigger one backup manually; confirm non-zero exit on tampering is
   understood; schedule off-host copy.
6. Point monitoring at `/api/metrics` (admin token) and `/api/ready`.
7. TLS termination in front of :3000 (Caddy/nginx/AWS ALB), `TRUST_PROXY=1`.
8. Walk the restore drill on staging once.


## PostgreSQL production engine (Neon) — added 2026-09-11

The stack now runs on either engine, selected purely by `DATABASE_URL`:

- `file:./data/akbaral.db` / `:memory:` → SQLite (local dev, tests)
- `postgres://…` / `postgresql://…`   → PostgreSQL (Neon production)

No application code changes between engines: the repository layer's
synchronous API is preserved on PostgreSQL through a worker-thread
SharedArrayBuffer bridge (one-query-at-a-time, same transaction
atomicity), with a dialect translator covering the six SQLite-isms the
repositories use (placeholders, strftime defaults, json_extract, INSERT
OR IGNORE, scalar MAX/MIN, FTS5 MATCH → tsvector websearch).

- Migrations: `db/migrations/` (SQLite) and `db/migrations-pg/`
  (PostgreSQL) are applied automatically by the same entrypoint; the
  `_migrations` ledger tracks each engine separately.
- Seed + audit: identical commands (`db:seed`, `audit:registry`) —
  verified on PostgreSQL: 4,001 agents seeded, audit PASS.
- Tests: `npm test` (SQLite, 254) and `npm run test:pg` (PostgreSQL
  integration via an in-process PGlite wire-protocol server, 15 —
  covers the credit consume/refund idempotency, triggers, transactions,
  FTS search, and the dialect translator).
- Backups: the nightly cron and both CLIs are engine-aware. PostgreSQL
  uses `pg_dump` (plain SQL, verified COPY data for core tables, same
  30-snapshot retention) and `psql` restore with an automatic
  pre-restore safety snapshot. Credentials travel via child env vars
  only — never argv, never logs. The runtime image installs
  postgresql-client for this.
- Connection security: TLS required (`sslmode=require`), credentials
  only ever in DATABASE_URL (env / secrets manager), masked in all logs.
