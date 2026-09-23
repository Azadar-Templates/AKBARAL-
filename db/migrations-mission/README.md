# ZA141251SA private mission migrations

These files are applied by `applyMissionMigrations()` in `src/mission/database.ts`
against the **private mission database** (`ZA141251SA_DATABASE_URL`) — a separate
database from the public platform (`DATABASE_URL`, `db/migrations/` +
`db/migrations-pg/`). Nothing in this directory touches the public schema.

## How identity works — read this before renaming anything

```
src/mission/database.ts:207-209   readdirSync(dir) … .sort()      → applied in filename order
src/mission/database.ts:218       SELECT name FROM mission_migrations WHERE name = ?
src/mission/database.ts:223       INSERT INTO mission_migrations (name) VALUES (?)
```

A migration's identity is its **filename**, not its numeric prefix. The prefix only
controls ordering. That is what makes the duplicate ordinals below safe.

## Known duplicate ordinals (intentional, do not "fix")

The 2026-09-23 consolidation merged two independently-numbered migration lines
(the ZA141251SA workflow line and the `main` opportunity-catalog / billionaire-daily
line). Both started at `0008`, so three ordinals are shared:

| Ordinal | File A (catalog / billionaire line) | File B (workflow line) |
|---|---|---|
| 0008 | `0008_billionaire_daily_per_agent.sql` | `0008_payout_binding.sql` |
| 0009 | `0009_opportunity_catalog.sql` | `0009_resource_provisioning.sql` |
| 0010 | `0010_opportunity_catalog_postgres_scale.sql` | `0010_agent_messages.sql` |

All three pairs apply cleanly together and the set is idempotent (verified 2026-09-23:
35 files → 35 rows in `mission_migrations`, second run applies 0).

### Why renumbering is UNSAFE

Both catalog files contain **unguarded** `ALTER TABLE … ADD COLUMN` statements:

- `0008_billionaire_daily_per_agent.sql:21-23` — `mission_agents` × 3 columns
- `0010_opportunity_catalog_postgres_scale.sql:16-18` — `mission_opportunities` × 3 columns

SQLite/PostgreSQL have no `ADD COLUMN IF NOT EXISTS`. Renaming a file changes its
recorded `name`, so `applyMissionMigrations` would treat it as **never applied** and
re-execute it, failing with `duplicate column name`. Any database that has already run
these files — including any live production mission database — would break on the next
boot.

**Rule: append new migrations with the next unused ordinal (currently `0033`). Never
rename an existing file, never resequence, never renumber to close the gaps above.**

## Adding a migration

1. Use the next unused ordinal prefix and a descriptive snake_case name.
2. Keep the DDL portable where practical — this directory is SQLite and PostgreSQL
   alike; there is no per-dialect twin here (unlike `db/migrations-pg/`, which
   `src/db/migration-parity.test.ts` enforces for the *public* platform only).
3. Do not rely on `IF NOT EXISTS` for columns — it is not supported. Use a fresh
   `CREATE TABLE IF NOT EXISTS`, or guard the column add in application code.
4. Verify locally on a throwaway database, then re-run to confirm the second run
   applies 0.
