# AKBARAL! / MASTER AI

Master AI operating platform:

`User Goal -> AI Core/Orchestrator -> Plan -> Specialist Agents -> Tools/APIs -> Execution -> Verification -> Final Result`

Long-term target: 3,000+ specialist agents organized into ~30 major categories.

---

## Implemented phases

### Phase 1 — Database Foundation
- Node 22+ built-in `node:sqlite` database layer with real SQL migrations.
- 17 core tables: users, sessions, api_keys, credit accounts/transactions, projects,
  agent categories/agents, tasks, task events, agent executions/logs, tool
  integrations, agent integrations, usage records, audit logs, security logs.
- Typed repository layer (`src/db/repositories.ts`) and migration runner.
- Migration command: `npm run db:migrate`.

### Phase 2 — Authentication
- Register / login / refresh / logout / current-user endpoints.
- Passwords hashed with salted `scrypt` (never plaintext, no bcrypt native dep).
- Sessions stored as SHA-256 hashes of opaque refresh tokens.
- Short-lived signed JWT access tokens (HS256, self-contained).
- Security audit logs for failed/successful logins.

### Phase 3 — Agent #001 (Web Research Agent)
- Real HTTP-based search + page fetch + HTML-to-text extraction.
- Default provider: DuckDuckGo HTML search and direct source fetch; overridable
  via `AKBARAL_SEARCH_ENDPOINT` / `AKBARAL_PAGE_FETCH_ENDPOINT` for proxies or
  private search APIs.
- Produces a structured `ResearchReport` with sources, facts, verified-source
  count, timing and provider metadata. No fake/mock results.

### Phase 4 — Free-task credit system
- New users get 3 free credits (`credit_account`).
- A research task reserves one free credit atomically.
- Success leaves the credit consumed.
- Failure automatically refunds the credit and records a `refund_task` transaction.
- Zero credits → HTTP `402 requires_pro`; no task/credit side effects.

### Phase 5 — WebSocket real-time execution logs
- `/ws/executions/:executionId` streams persisted execution logs live.
- Logs are also stored in `agent_execution_logs` so clients can reconnect and
  replay with `?after=<ISO timestamp>`.
- Task/agent workflow: create → queued → running → completed/failed, with
  status + log events broadcast over the socket.

---

## Stack

- Node.js 22+ (built-in `node:sqlite` module)
- TypeScript
- SQLite file database (migration-based schema)
- Express 4 HTTP API
- `ws` WebSocket transport
- `dotenv`, `tsx`

The built-in SQLite driver runs with zero external services on any machine.
The repository layer isolates queries so a future PostgreSQL migration is
contained to the data tier.

---

## Install

```bash
cp .env.example .env
npm install
```

## Commands

```bash
npm run db:migrate      # apply all migrations
npm run db:status       # show applied/pending migrations
npm run db:seed         # idempotent dev seed (service user + Web Research Agent #001)
npm run db:reset        # delete local dev DB and reapply migrations
npm run verify:db       # migrate + verify all tables

npm run typecheck       # strict TypeScript type-check
npm run build           # compile TypeScript to dist/
npm test                # full test suite (uses test.db)
npm run start           # build + run compiled server (node dist/src/index.js)
npm run dev             # run API server with tsx watch
npm run serve           # run API server with tsx
```

## API overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/` | none | Health/status |
| POST | `/api/auth/register` | none | Create account |
| POST | `/api/auth/login` | none | Login, returns access + refresh tokens |
| GET | `/api/auth/me` | refresh token | Current user (refresh-token auth) |
| POST | `/api/auth/refresh` | refresh token | Rotate refresh session |
| POST | `/api/auth/logout` | refresh token | Revoke session |
| GET | `/api/me` | bearer access token | Current user + free credits |
| GET | `/api/agents` | bearer access token | List registered agents |
| GET | `/api/agents/:slug` | bearer access token | Agent detail |
| POST | `/api/tasks/research` | bearer access token | Create research task (202) |
| GET | `/api/tasks` | bearer access token | List user tasks |
| GET | `/api/tasks/:id` | bearer access token | Task detail + events + logs |
| WS | `/ws/executions/:executionId` | none* | Live execution logs (with optional `?after=<ISO>`) |

> *WebSocket stream is keyed by opaque execution id. When production hardening
> is enabled, add auth to this socket too.

## Database secrets policy
- Passwords: salted scrypt.
- Sessions/API keys: SHA-256 hashes of raw tokens + visible prefixes.
- Tool integrations: encrypted config blob + key reference (never plaintext).

## Next phases (not started)
- 3,000+ agent registry expansion (categories/agents/tools/verification).
- Production PostgreSQL/Prisma adapter migration.
- Pro/paid credit plans.
- Orchestrator planning/verification layer beyond Agent #001.
