# Mission database migrations run at boot — the 45/49 freeze and its fix

Date: 2026-10-12. Scope: the ZA141251SA mission database, the production boot sequence, and the
`mission:*` commands inside the runtime image. Nothing in this file was changed in production: no
row, no setting, no deploy. The production numbers below are the owner's read-only measurement
(`railway ssh`, image `5d9596388439f818f4ef30946187639dd1ec9256`), and every one of them was then
reproduced locally against a production-shaped PostgreSQL copy before any code was written.

## 1. What was wrong, in one paragraph

The mission schema is applied by exactly one function, `applyMissionMigrations()`
(`src/mission/database.ts:210`), and at the time of the measurement that function was reachable at
boot from only one place: `startMissionServer()` (`src/mission/server.ts:3323`), which the
production wrapper launches **only** when `ZA141251SA_MISSION_SERVER_ENABLED === 'true'`
(`scripts/start-prod.mjs:94`) — and when it does launch it, the wrapper **replaced** the operator's
mission database URL with a hardcoded `file:/data/mission.db` (`scripts/start-prod.mjs:98`, injected
at `:406`; the same default is baked into the image at `Dockerfile:32`). So on a deployment whose
mission database is the PostgreSQL one named by `ZA141251SA_DATABASE_URL`, no boot path could ever
reach it: the platform tier migrated its own SQLite file (`[db:migrate] database is up to date
(/data/akbaral.db)` — the only migration line in the deploy log), and the mission database was left
wherever the last manual run of a mission command had abandoned it. Abandoned at 0042, that is: 45
ledger rows of 49 migrations, and 0043 has been failing on that database ever since for a second,
independent reason.

## 2. The second cause: one table name, two owners

`db/migrations-mission/` contains 52 `.sql` files (the 49 numbered migrations plus three dialect
twins sharing the numbers 0008, 0009, 0010). `model_providers` was created by the platform
(`db/migrations/0002_platform.sql:255`, `db/migrations-pg/0002_platform.sql:267`) **and** by the
mission's `0043_model_platform_discipline.sql:5`. A census of every `CREATE TABLE` in the three
sets — 174 mission tables against 104 platform tables — found **exactly one** name in common, and
zero collisions among indexes, functions, triggers and views.

`0043` used `CREATE TABLE IF NOT EXISTS`, so in a database that already had the platform's table it
silently kept the platform's shape — `id,key,name,type,base_url,docs_url,api_version,auth_type,
env_key,status,capabilities,created_at,updated_at`, which is precisely the live shape the owner
measured — and then its own capability seed `INSERT INTO model_providers (id,provider_key,…)`
(`:165`) died on the first column that the platform table does not have. Because the runner is
transactional per file, `0043` was never recorded; because the runner aborts on a throw, `0044`
through `0049` never ran. That is the whole of the 45/49 state.

`provider_key` is read and written by the mission model layer —
`src/mission/earning/model-layer.ts:89,91,114,120,129,134-137,191,202,227,231,258,267` and
`src/mission/earning/execution-backends.ts:151` — and by nothing else in the mission.
`src/business/owner-analytics.ts:348` also names `provider_key`, but on the platform's `model_runs`
table, which is unrelated and unchanged.

## 3. Reproduced, with the failures verbatim

Against a PostgreSQL copy assembled to look like production (the platform's 24 `db/migrations-pg`
files applied into the same database, then the mission set, driven through the shipped
`applyMissionMigrations()`):

```text
[platform] 24 platform migrations applied into the same database; live model_providers =
  id,key,name,type,base_url,docs_url,api_version,auth_type,env_key,status,capabilities,created_at,updated_at
{ "ledgerBefore": 0, "ledgerAfter": 45, "outcome": "BOOT-ABORTING THROW",
  "error": "column \"provider_key\" of relation \"model_providers\" does not exist", "fk": "pg clean" }
```

`ledgerAfter: 45` is the number measured in production, reached here from an empty database by the
production code path alone. Applying the files one at a time (so later files get a verdict too) gave
two failures before the fix — the second one collateral, not independent:

| file | before the fix | after the fix |
| --- | --- | --- |
| `0043_model_platform_discipline.sql` | FAILED — `column "provider_key" of relation "model_providers" does not exist` | applied |
| `0044_vulnerability_knowledge_playbooks.sql` | FAILED — `relation "platform_adapters" does not exist` (0043 creates that table; it had never committed) | applied |
| `0045_result_verification.sql` | never reached in a boot (the run aborted at 0043); applied when driven per file | applied |
| `0046_bounty_claim_eligibility.sql` | applied per file | applied |
| `0047_agent_class_contract_proposals.sql` | applied per file | applied |
| `0048_specialist_platform_fleet.sql` | applied per file | applied |
| `0049_strip_dead_mission.sql` | applied per file | applied |
| whole set, production-shaped database | 45 of 52 recorded, run aborted | **52 of 52 recorded, `fk: pg clean`** |

Every one of those verdicts was produced on PostgreSQL (a real Postgres engine behind
`scripts/pg-test-server.mjs`) and repeated on SQLite as a control. On a mission database the platform
had never touched, the pre-fix set already applied 52/52 — which is why this bug was invisible to
every local test and only bit a deployment that shared one schema.

## 4. The fix

1. **Boot applies the mission migrations.** `scripts/start-prod.mjs` now runs a blocking
   `runStep('applying mission database migrations', …)` on every start, after the platform step and
   before the mission child and either public tier, through the new compiled entry
   `scripts/mission-migrate.ts`. It carries the same `ROLES !== 'web'` gate as the platform step, so
   in the small-host split-role deployment the write-owning tier migrates and the web tier does not
   race it for the same schema. `runStep` exits the container on a non-zero child
   (`scripts/start-prod.mjs:47-59`), so a mission database that could not be migrated cannot produce
   a boot that looks clean. The only skip is a deployment with no mission database at all, and that
   skip is printed with the target it looked for.
2. **The wrapper and the child agree on the database.** `MISSION_DATABASE_URL` is resolved by
   `missionDatabaseUrl()` (`scripts/mission-db-target.mjs`, which mirrors `missionEnv()` in
   `src/mission/database.ts:42-52`) instead of being replaced with a hardcoded path; the migrate step
   and the child receive the same value, and the readiness check now compares the health payload's
   `database` against that resolved target (`missionHealthDatabaseExpectation`) rather than against
   the SQLite path — which is why a PostgreSQL mission tier could never satisfy readiness before. The
   fail-closed properties are untouched: one loopback bind, one port, the refusal to create or select
   an alternate database, and the requirement that the compiled entry exists.
3. **`0043` no longer steals a platform table name.** The mission's provider table is
   `mission_model_providers`. Measured on a mission-only SQLite database the set creates 173
   tables, 145 of them already `mission_`-prefixed, and `model_providers` was the single name it
   shared with the platform; the seed, the two foreign keys and
   the mission code (`model-layer.ts`, `execution-backends.ts`) follow. A database that already
   applied the old `0043` is renamed by `isolateMissionModelProviderTable()`
   (`src/mission/database.ts:243`), which moves only a table that has the mission's `provider_key`
   column and leaves a platform-shaped one strictly alone. No data was hand-edited anywhere: the
   rename is one guarded `ALTER TABLE … RENAME TO`, and the set stays one-transaction-per-file so a
   failing file is the only thing that rolls back.
4. **A shared schema is announced, not absorbed.** The first migration run of a process warns on
   stderr when the mission database also carries the platform ledger (`_migrations`), naming the
   isolation rule it violates. It does not refuse, because refusing would take down the console of
   the deployment that is already in that state — the operator's choice to separate them is recorded
   in `docs/OWNER_BOUNTY_PROGRAM_SETUP.md`, not enforced by a crash loop.
5. **Nothing that runs at boot is silent any more.** The seven `try{…}catch{}` seed calls at the top
   of `startMissionServer()` are now `seedAtBoot(label, fn)`, which keeps them non-fatal and prints
   the label and the reason; the migration itself is wrapped only to add a fatal, explicit
   `[mission] FATAL: mission database migrations failed …` line before rethrowing. A successful run
   prints `[mission] migrations: N applied, M files, engine …, target …`.
6. **`npm run mission:*` works in the runtime image.** Every mission command that had been
   `tsx scripts/<name>.ts` now runs `node scripts/mission-run.mjs <name>`, which prefers
   `dist/scripts/<name>.js` when the tree has no `src/` (the image) and uses `tsx` on the TypeScript
   source when it does (a checkout, so an edit is never shadowed by a stale build), and prints which
   of the two it executed. That preference order is not new to this repo: `scripts/owner-bootstrap.mjs`
   has run `owner-init.ts` the same way (compiled `dist/scripts/owner-init.js` first, `tsx` on source
   second) for exactly the same production-packaging reason, and the mission commands now follow it.
   `fleet:readiness` and `board:frantic` are mission tools behind mission
   evidence strings, so they went through the same resolver. **No TypeScript source was copied into
   the image:** the change is 12,342 bytes across three small `.mjs`/`.ts` files in `scripts/`, against the
   8.0 MB `src/` tree a source copy would have cost. Image size is otherwise unchanged because
   `dist/`, `scripts/`, `db/` and `mission-dashboard/` were already shipped (`Dockerfile:41-56`).

Not changed, on purpose: `assertInScope` and every approval gate, the owner-only checks,
`ZA141251SA_BIND_HOST`, the payout and settlement rails, the identity lockdown, the kill switch, the
5-slot payout constraint, and every id, class, `data-*` attribute and storage key. The migration set
grew by no files; `db/migrations-mission/` still holds the same 52 with `0043` corrected. No
production database, wallet or ledger was opened by this work — the "production-shaped copy" is a
local PostgreSQL instance built from the same migration files.

## 5. Tests

New `src/mission/mission-migrations-at-boot.test.ts` — 10 cases, run on SQLite and, under
`npm run mission:pg-check`, on PostgreSQL (the file is now part of that chain):

1. the whole shipped set is recorded on the engine under test (52 files);
2. a database frozen at 0042 (45 ledger rows), driven through the real boot entry, ends with
   `ledger after: 52/52` and `foreign keys after: clean`, and a third start reports `up to date`;
3. a planted migration that throws aborts the run, its file is not recorded, and the engine's own
   message survives;
4. a failing mission migration aborts the **container boot** — a temp tree in the runtime shape, a
   fake `dist/scripts/mission-migrate.js` exiting 1, and assertions that the boot log names the
   step, carries the child's error verbatim, exits non-zero, and never reaches the tier banner;
5. every `mission:*` script resolves its entry in a `dist/`-only tree with no `src/` (each entry is
   planted in a temp root, run, and required to print its marker plus the file it chose), and no
   mission command may use bare `tsx scripts/` any more;
6. `mission_model_providers` ends with exactly the columns the mission code writes (both its INSERT
   list and its UPDATE list are parsed out of `model-layer.ts` and checked against the migrated
   schema) and none of the platform-only columns;
7. on a **fresh database whose schema the platform already owns** — the platform-shaped
   `model_providers` created first, then the whole mission set applied by the real boot entry — the
   run exits 0 with `52/52` and clean foreign keys, the platform table keeps its columns and its row
   and never gains `provider_key` or `display_name`, and the mission table holds its eight capability
   rows;
8. no shipped mission migration may name `model_providers` at all (comments and string literals
   stripped, so this is a hair trigger on the executable text; the mission set speaks only of
   `mission_model_providers`);
9. `startMissionServer()` applies its own migrations before `server.listen()`, reports a failure as
   `FATAL`, rethrows it, and has no `catch` that can continue past a migration error — the second
   boot path cannot repeat this bug;
10. the legacy rename runs once, keeps its rows, carries the child table's foreign key with it
    (verified by reading the constraint back, not by provoking an error), reports `already exists` on
    the second call, and reports `left untouched` for a platform-shaped table.

Cases 2 and 7 need a database the case creates and reopens, so they are skipped under
`npm run mission:pg-check` with that reason on the skip line (8 pass, 2 skipped on PostgreSQL;
10 pass on SQLite). Both are load-bearing: reverting `db/migrations-mission/0043_model_platform_discipline.sql`
alone fails exactly those two cases, in any run order.

`src/app/stackhost-deploy.test.ts` gained a process-boundary order log (`spawn` and `spawnSync` are
both recorded, with the environment each blocking step received) and two new cases — the migration
step's position in the boot and the fact that it migrates the same target the child opens; and the
no-database skip being announced, plus a web-only-tier case that asserts the mission migration step
does not run there. Its six existing mission-startup assertions were re-pointed at the
new contract (the configured URL is honoured rather than replaced) without dropping any of the pins:
loopback, port 4200, the empty spawn list on refusal, the readiness timeout killing the child, the
unexpected-exit and signal-exit paths, and the compiled-entry requirement.
`src/mission/earning/fleet-readiness-activation.test.ts` had two `package.json` pins re-pointed to
the resolver form; the `file:line` citations those entries carry (`package.json:82/83`,
`src/mission/database.ts:364`, `scripts/start-prod.mjs:94`) were re-derived, and the citation-shape
test that checks every cited line still passes.

### Sensitivity: what each edited file is actually worth

Each changed file was reverted on its own (the new files moved out of the tree), the targeted subset
re-run, and the file restored. Baseline with nothing reverted: **44 tests, 44 pass, 0 fail**
(`mission-migrations-at-boot` 10, `stackhost-deploy` 25, `prod-roles` 6, `database-isolation` 3).

| reverted file | tests | pass | fail |
| --- | --- | --- | --- |
| `scripts/mission-db-target.mjs` | 44 | 24 | **20** |
| `scripts/start-prod.mjs` | 44 | 34 | **10** |
| `src/app/stackhost-deploy.test.ts` (its own new cases) | 40 | 34 | **6** |
| `src/mission/database.ts` | 44 | 42 | **2** |
| `db/migrations-mission/0043_model_platform_discipline.sql` | 44 | 42 | **2** |
| `scripts/mission-run.mjs` | 44 | 42 | **2** |
| `scripts/mission-migrate.ts` | 44 | 43 | **1** |
| `src/mission/server.ts` | 44 | 43 | **1** |
| `src/mission/earning/model-layer.ts` | 44 | 43 | **1** |
| `package.json` | 44 | 43 | **1** |
| `src/mission/earning/execution-backends.ts` | 44 | 44 | 0 |
| `src/mission/earning/fleet-readiness.ts`, `fleet-readiness-activation.test.ts` | 44 | 44 | 0 |
| `MISSION_SYSTEM.md`, the three `docs/` files | 44 | 44 | 0 |

What the zeroes mean, stated rather than glossed: `execution-backends.ts` renames the table its
readiness diagnostic reads (`src/mission/earning/execution-backends.ts:151`) and **no test in the repo
exercises that function**, so nothing fails when it is reverted — the rename is proven by the schema the
migrations create (cases 6 and 8) and by the typecheck. `fleet-readiness.ts` and its activation test
carry only re-derived `file:line` citations (the pair passes 20/20 with either version); the docs are
prose, which no test reads. Removing the new test file leaves 34 tests passing — that file is the new
coverage, not something the rest of the suite depends on.

### Gates run, with totals

| gate | result |
| --- | --- |
| targeted subset (4 files above) | 44 tests, 44 pass, 0 fail |
| `npx tsx --test src/mission/mission-migrations-at-boot.test.ts` on SQLite | 10 tests, 10 pass, 0 fail |
| `npm run mission:pg-check` (7 files, real PostgreSQL) | 97 tests, 95 pass, **0 fail**, 2 skipped (both skips are the two file-database cases above) |
| full suite `node scripts/test-resumable.mjs --all --prune-working-copies --compress-snapshots` | **212/212 files, 2,797 tests, 2,792 pass, 0 fail, 5 skipped** |
| `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) | 0 errors |
| `npm run build` | exit 0; `dist/scripts/mission-migrate.js` emitted (5,261 bytes) |
| `npm run mission:copy:check` | in step, 705 pairs |
| `npm run scan:secrets` | PASS, 22 allow-listed synthetic placeholders, no real marker |
| `git diff --check` | clean |
| runtime-image-shaped rehearsal (`dist/` + `db/` + `scripts/`, no `src/`) | fresh SQLite: 52/52, exit 0. Production-shaped stuck PostgreSQL: `ledger before: 45` → `applied 7 of 52` → `ledger after: 52/52; foreign keys after: clean`. Second run: `up to date — all 52 migration files are applied`. `mission-sync-registry --skip-platform`, the command that failed in production: exit 0. Dead database: `FAILED … the ledger could not be read at all`, exit 1 |
| `node scripts/verify-mission-dashboard.mjs` | **62/62 PASS**. It needs a live mission server and owner credentials, so it was run against a throwaway local database (`file:/tmp/…/mission.db`, migrated by `npm run mission:init` through the resolver) with a `node dist/scripts/mission-serve.js` server on `127.0.0.1:4200` and synthetic `local-verify-*` credentials — the sign-in, every section render, the reload and the sign-out all pass on the isolated schema, and nothing was pressed or written. The repository's own mission database, wallet and ledger were not opened by it |

## 6. What the owner has to do

Nothing by hand, and nothing should be done by hand to the data. On the next deploy of an image
containing this change, the boot itself applies `0043`–`0049` to whatever
`ZA141251SA_DATABASE_URL` names, and the container log will contain the
`[akbaral] applying mission database migrations…` step followed by the `[mission-migrate] applied …`
lines; if any file fails, the container exits non-zero and says which. To verify without waiting for
a deploy, from the runtime image: `npm run mission:migrate` (or `node
dist/scripts/mission-migrate.js`), then `SELECT COUNT(*) FROM mission_migrations` — 52 is the whole
set.

One recommendation that is not a code change and needs the owner's decision: give the mission its own
database. `ZA141251SA_DATABASE_URL` currently points at a database that also holds the platform's
schema, which is what made this migration fail at all and which the boot now warns about on every
start. Separating them is an environment change on the owner's side; this change makes the shared
shape survivable, not correct.
