# AKBARAL! / MASTER AI

Master AI operating platform:

`User Goal -> AI Core/Orchestrator -> Plan -> Specialist Agents -> Tools/APIs -> Execution -> Verification -> Final Result`

Long-term target: 3,000+ specialist agents organized into ~30 major categories.

---

## Current phase: Database Foundation (Phase 1)

The project currently ships the database foundation used by all later phases
(Authentication, Agent #001 Web Research, Free-task credits, WebSocket logs).

### Stack

- Node.js 22+ (uses the built-in `node:sqlite` module)
- TypeScript
- SQLite file database (migration-based schema)
- `dotenv` for environment loading
- `tsx` for TypeScript execution / testing

The built-in SQLite driver was chosen because it runs with zero external
services on any machine, while the repository layer (`src/db/repositories.ts`)
keeps queries isolated so a future PostgreSQL migration is contained to the
data tier.

### Install

```bash
npm install
```

### Database commands

```bash
npm run db:migrate      # apply all pending migrations
npm run db:status       # show applied / pending migrations
npm run db:seed         # idempotent development seed (service user + Web Research agent)
npm run db:reset        # delete local dev database and reapply migrations
npm run db:migrate:dev  # alias for local migration
npm run db:push         # alias for local migration
npm run verify:db       # migrate + verify all core tables are reachable
```

### Development / verification

```bash
npm run typecheck       # strict TypeScript type check
npm run build           # compile TypeScript to dist/
npm test                # schema + repository integration tests (uses test.db)
npm run dev             # bootstrap (currently initializes and prints database counts)
```

### Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Important:

- `DATABASE_URL` uses file-relative paths, e.g. `file:./data/akbaral.db`.
- Local runtime data is written under `data/` and is git-ignored.
- Never commit real API keys, session secrets, or credentials.

### Schema overview

Tables created by the initial migration:

| Domain | Tables |
| --- | --- |
| Identity/auth | `users`, `sessions`, `api_keys` |
| Credits | `credit_accounts`, `credit_transactions` |
| Workspaces | `projects` |
| Agents | `agent_categories`, `agents` |
| Tasks | `tasks`, `task_events` |
| Execution | `agent_executions`, `agent_execution_logs` |
| Tools | `tool_integrations`, `agent_integrations` |
| Observability | `usage_records`, `audit_logs`, `security_logs` |

Security: credentials and integration secrets are never stored in plaintext.
Sessions/API keys store hashes; tool integration configurations store encrypted
payloads plus a key reference for decryption at runtime.

### Next phases (not started yet)

1. Authentication
2. Agent #001 — Web Research Agent
3. Free-task credit system with automatic refund on failure / Pro requirement
4. WebSocket real-time execution logs
