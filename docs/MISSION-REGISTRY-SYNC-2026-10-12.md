# `mission:sync-registry` synced zero agents — the silent no-op and its fix

Date: 2026-10-12. Scope: the mission registry bridge (`scripts/mission-sync-registry.ts`,
`src/mission/registry-sync.ts`, `src/agents/registry.ts`, one new mission migration), the CI
chain that has to prove it, and nothing else.

What this file is **not**: proof that production was changed. Nothing was run against the
production databases from this session — not the sync, not a repair, not a write. The
production numbers below are the owner's own read-only measurement, quoted as given. The
command that the fleet needs is an **owner action** after this ships (§8).

---

## 1. The symptom, as measured

The owner's production read (deployment `f0961dbb`, image `c4f400399…`, `/data` 353 MB):

| observation | value |
|---|---|
| mission engine | PostgreSQL, via the sealed `ZA141251SA_DATABASE_URL` |
| platform database | SQLite, `/data/akbaral.db` |
| `agents` in the platform database | 4,001 |
| `agent_tools` in the platform database | 7,203 |
| `mission_agents` | **0** |
| `mission_money_grants` | **0** |
| `npm run mission:sync-registry` | ran, printed nothing useful, synced zero agents |

Reproduced locally against a production-shaped stack (real migrations, real registry seeder, a
real PostgreSQL mission target through `scripts/pg-test-server.mjs`) — the *pre-fix* code, at
`c4f4003`:

```
RC 0 · 122 bytes on stdout · nothing on stderr · ~65 s
mission:sync-registry — 4001 created, 0 updated, 4001 mission identities; zero opening cash, no invented opportunities.
```

and, on a migrated-but-unseeded platform database:

```
RC 0 · one line
mission:sync-registry — the platform registry returned no agents. No registry identities were imported.
```

Those two runs are 4,001 agents apart and are **indistinguishable in kind**: same exit code, one
line each, no target named, no counts, no reason. That is the bug's shape.

## 2. Root causes, with the file:line that carries each one

The audit was done against the committed tree before editing. Line numbers are `git show
HEAD:<path>` at `c4f4003` (the pre-fix file is 77 lines long, so they are short).

1. **The command had no output contract.** `scripts/mission-sync-registry.ts:69` wrote the one
   success line quoted above; nothing printed the engine, the resolved mission target, the
   resolved platform target, source counts, rows written, or rows skipped. So "no output" was
   the normal case, and an operator could not tell which database had been read.
2. **Zero rows was a success path.** `scripts/mission-sync-registry.ts:58-65`: if the collected
   list was empty — including the `--skip-platform` case at `:55-56`, which reuses the same
   branch — the script printed a sentence and `return`ed, exiting **0**, without saying which
   target it had looked at or how many rows that target holds. "The import found nothing" and
   "the import was never asked to look" produced the same exit code and the same one line.
3. **The filter that produced the zero was invisible.** `src/agents/registry.ts:233-234` (as
   called from `scripts/mission-sync-registry.ts:35`, `platformOnly: true`) restricts the export
   to `a.owner_id IS NULL`. A platform database where every agent has an owner — which is what
   an assigned fleet becomes — therefore exports **0 agents and 0 grants while holding 4,001 of
   each**. No count was printed, so the filter and the data were indistinguishable. The
   pre-fix tree has no `catch` that hides an error (`:74-76` prints and exits 1): the failure was
   never an exception, it was a *successful* zero.
4. **Tool grants were not in the contract at all.** Pre-fix `src/mission/registry-sync.ts:8` is
   `syncMissionRegistry(agents: RegistryAgentMetadata[])` — agents only. `grep -rn
   "agent_tools\|tools" db/migrations-mission/` at `c4f4003` returned no agent↔tool table: there
   was nowhere to put a grant, so an agent could cross the bridge and lose every capability it
   has. `src/db/platform-repositories.ts:1337` `listAgentTools(agentId)` was the only export of
   grants in the codebase — one query per agent, unusable for a 7,203-row fleet export.
5. **Reporting could be lost, and a missing platform file could be created instead of reported.**
   Two mechanical defects around the same silence: `process.stdout.write` is buffered, so
   `main().catch` writing its message and calling `process.exit(1)` can drop bytes when stdout is
   a pipe (measured: a 200,000-byte write followed by `process.exit` survives as 65,536 bytes;
   with a drain callback, all 200,000); and the platform side was opened with no existence check,
   so a missing `akbaral.db` would be **created empty** by SQLite rather than reported — in the
   container that means a write to `/data` and a zero-row "sync".

One thing that was **not** a root cause, checked and cleared: path resolution. `Dockerfile:28-32`
bakes `/data`, `resolveDataDir()` and `resolveDatabasePath()` land on `/data/akbaral.db`, and
`scripts/mission-run.mjs` hands the script the env it needs (`ZA141251SA_DATABASE_URL` for the
mission side, `DATABASE_URL` for the platform side). The compiled entry
`dist/scripts/mission-sync-registry.js` exists in the image and is what `npm run
mission:sync-registry` executes.

## 3. The contract, as it now stands

`scripts/mission-sync-registry.ts` reports in this order, through `fs.writeSync` on the raw
descriptors (with a fallback to stderr if the reader has hung up), and every branch ends in a
numbered statement rather than a sentence:

```
mission:sync-registry — mission postgres postgres://host/db; ledger 53 migrations; batch 500 agents per transaction
mission:sync-registry — compiled entry dist/scripts/mission-sync-registry.js (no src/ in this tree — runtime-image shape)   [image-shaped runs only]
mission:sync-registry — platform sqlite /data/akbaral.db
mission:sync-registry — platform counts: agents 4001, platform-owned 4001, agent_tools 7203, attached to platform-owned agents 7203
mission:sync-registry — collected 4001 identities and 7203 tool grants (0 of them carry a platform config payload, not copied by design)
mission:sync-registry — batch 1/9: 500 created, 0 updated, 0 already matching, 850 grant rows written
… 9 batch lines …
mission:sync-registry — engine postgres, target postgres://host/db, source 4001 identities / 7203 grants, written 11204 (agents 4001 created, 0 updated, 0 unchanged; grants 7203 created, 0 updated, 0 unchanged), mission identities now 4001, in 27.1s
mission:sync-registry — wrote nothing to the platform database; no ledger entry, no balance, no payout slot, no approval and no tool approval was created or changed (mission_tools rows untouched, mission ledger rows unchanged).
```

Rules that the output enforces, and that `src/mission/registry-sync-production-shape.test.ts`
holds it to:

* both engines and both targets are named **before** any write;
* collection is paged (200) and checked for completeness on **both** halves: if the agents
  collected do not equal `platform-owned`, or the grants collected do not equal the grants attached
  to them, the run fails naming both numbers — a truncated export cannot pass as a small fleet;
* a platform database that is not there is a **fatal pre-flight**: it exits 1, names the resolved
  path, and says that the command never creates or selects an alternate platform database. It
  does not open, and therefore does not create, the file;
* a platform database whose table is populated but whose `owner_id IS NULL` filter matches nothing
  exits **1**, after printing both counts, with "This is the filter, not the data";
* an empty platform database is genuinely a no-op and says so: "nothing to sync … holds 0 agents.
  No mission row was written or removed." — still with the target and the counts on the record;
* every write happens in a batch of 500 inside one transaction, and a failed batch is reported as
  `batch N of M … failed and was rolled back whole: <cause>. K row(s) written by the earlier
  batch(es); nothing from the failing batch is in the database. Re-run the same command to resume
  — it is idempotent.`;
* a re-run that has nothing to write prints `ALREADY IN SYNC` and `written 0`, and every skip is
  itemised with its reason, verbatim from `src/mission/registry-sync.ts:104-106`:
  `skipped 5: mission row already carries exactly the exported values`,
  `skipped 1: agent_tools.config payload not copied: the bridge is metadata-only and that column
  can carry endpoints or credential references`, and for a grant whose agent was not imported,
  `skipped N: grant names an agent this run did not import, so there is no mission row to attach
  it to`;
* `--skip-platform` is loud and honest — `platform read SKIPPED on purpose … This is not a sync
  and is not reported as one` — and is never allowed to print a row count;
* any thrown error prints `mission:sync-registry FAILED — <message>` on stderr and exits 1. There
  is no `catch {}` and no `exit(0)` on a failure path.

## 4. Grants, and the payload that is deliberately not copied

New mission migration `db/migrations-mission/0050_registry_tool_grants.sql` adds
`mission_agent_tools(agent_id → mission_agents ON DELETE CASCADE, tool_key, tool_name, kind,
permission, source, exported_at, PRIMARY KEY (agent_id, tool_key))` with two indexes. It carries
the *shape* of a grant and none of its power: `src/agents/registry.ts` gains
`registryInventory()` (the four counts, on one connection) and
`discoverAgentToolGrants({limit, offset})` (paged, `owner_id IS NULL`, read-only).

`agent_tools.config` is **not** copied, and the count of rows that carry one is reported. The
column is a free-text JSON payload that in this fleet can hold endpoints and credentials; a
metadata bridge must not become a credential smuggler. It is also not a grant of permission:
`src/mission/self-management.ts:85-131` owns `mission_tools`, which stays deny-by-default, and
nothing in the sync writes to it. Both facts are printed by the run.

Compare-before-write is applied to both tables, so an unchanged row is not touched: `updated`
counts only rows whose exported values actually differ, and `unchanged` counts the rest. On a
fleet already in sync the second run reports `written 0 (agents 0 created, 0 updated, 4001
unchanged; grants 0 created, 0 updated, 7203 unchanged)`.

`provisionMoneyAgent` and `appendMissionAudit` remain inside the same transaction as before —
`src/mission/registry-sync.test.ts` pins zero opening balances and an audit row that rolls back
with the batch, and that behaviour is unchanged by this fix.

## 5. How to run it

```bash
npm run mission:sync-registry                      # both databases from the environment, as the container has them
npm run mission:sync-registry:readout              # read-only: what the mission side actually holds, as JSON
npm run mission:sync-registry:readout -- --platform /data/akbaral.db --per-agent
                                                   # per-agent grant-set comparison across both engines
```

No Railway shell, no operator-remembered flag, no source tree: the entry is the compiled
`dist/scripts/mission-sync-registry.js`, and `src/mission/registry-sync-production-shape.test.ts`
plus `scripts/mission-registry-sync-e2e.mjs` both fail if a run needs anything else (the test
asserts in a tree whose `src/` is deliberately absent).

## 6. Proof

`src/mission/registry-sync-production-shape.test.ts` — 10 cases, run against the real entry as a
child process, with a fixture small enough to check by hand (5 platform-owned agents carrying
3/2/1/1/0 grants, one user-owned agent carrying 1, one `config` payload) **and** re-run against
PostgreSQL by `npm run mission:pg-check`:

```
ok 1 - syncs every platform-owned agent and tool grant into an empty mission database, and says so exactly
ok 2 - is idempotent: a second run writes nothing and reports already in sync
ok 3 - a platform database that cannot be opened exits non-zero with the reason — never silent
ok 4 - a mission database that cannot be reached exits non-zero with the reason — never silent
ok 5 - a partial failure mid-copy rolls the batch back whole and exits non-zero
ok 6 - the compiled dist/ entry alone is sufficient: no src/ in the tree
ok 7 - leaves the platform database byte-identical
ok 8 - creates no money, no ledger entry, no payout change and no tool approval
ok 9 - --skip-platform says it skipped and is never mistaken for a sync
ok 10 - refuses to report success when the platform filter excludes every agent
# tests 10 · pass 10 · fail 0
```

Case 5 forces a mid-copy failure with the *existing* `registry_agent_ceiling` gate (ceiling 2,
fixture 5 agents) and asserts that nothing survives it; case 7 hashes the platform file before and
after; case 8 snapshots eight rail counts before the run and compares afterwards, so "it did not
touch them" is a measurement.

CI: `.github/workflows/verify.yml` gained a step after "Standalone mission PostgreSQL parity":

```
- name: Registry sync end to end (seeded SQLite platform into PostgreSQL mission)
  run: |
    npm run build:backend
    npm run mission:registry-sync:e2e:pg
```

The build comes first on purpose: in a checkout `scripts/mission-run.mjs` resolves to the
TypeScript source through `tsx`, and only the image-shaped tree has `dist/` alone — building
means the step also executes `node dist/scripts/mission-sync-registry.js` directly and requires it
to run and report `ALREADY IN SYNC`. `npm run mission:pg-check` also gained
`registry-sync-production-shape.test.ts`, so the same ten cases run against PostgreSQL.

The script seeds the platform registry through the real `db:seed` path and asserts 18 things; the
measured run against a fresh PostgreSQL cluster with the build present:

```
PASS  the seeded platform registry is production-shaped — agents 4001, platform-owned 4001, grants on them 7203
PASS  the sync exits 0 — status 0
PASS  its summary reports the counts the platform actually holds — … written 11204 (agents 4001 created, 0 updated, 0 unchanged; grants 7203 created, 0 updated, 0 unchanged) …
PASS  every platform-owned agent is in the mission database — mission 4001 vs platform-owned 4001
PASS  every tool grant is in the mission database — mission 7203 vs platform 7203
PASS  every imported agent carries exactly the grant set the platform attaches to it — 4001 compared, 0 disagreeing
PASS  the rails are the same set as before the run
PASS  the second run says already in sync and writes nothing
PASS  the compiled dist/ entry runs on its own and reports already in sync
PASS  the platform database is byte-identical
PASS  and gained no journal or stray file — akbaral.db
PASS  registry sync end to end: 18/18 assertions
REGISTRY SYNC END TO END VERIFIED — 4001 identities and 7203 grants, idempotent, platform untouched.
```

The same script was run against a file-based mission database (18/18) and against PostgreSQL
through `pg-test-server.mjs` (18/18) — both engines are exercised, not one and a mock.

### Sensitivity

Each change was reverted on its own and the ten cases re-run (numbers measured in a copy of the
tree so that the repository checkout stayed untouched while the full suite was running). A fix
nothing depends on would show `fail 0` here; none of them do.

| reverted | tests | pass | fail | what the failures say |
|---|---|---|---|---|
| nothing (baseline) | 10 | 10 | 0 | — |
| `src/mission/registry-sync.ts` | 10 | 5 | 5 | no grant parameter: the counts and the grant rows disappear |
| `src/agents/registry.ts` | 10 | 2 | 8 | no `registryInventory`/`discoverAgentToolGrants`: the script cannot even report |
| `scripts/mission-sync-registry.ts` | 10 | 2 | 8 | back to the silent one-liner: every report assertion fails, and the fatal pre-flights are gone |
| `db/migrations-mission/0050_registry_tool_grants.sql` | 10 | 0 | 10 | no `mission_agent_tools` table; the file's own pre-flight names it first ("the grants table has to ship as a migration, not as a runtime CREATE") |
| `src/mission/registry-sync-production-shape.test.ts` deleted | 0 | — | — | the runner exits non-zero on a missing file; with it gone nothing in `npm test` covers the bridge, and only the CI step stands between a regression and a release |
| `package.json` | — | — | — | `npm run mission:registry-sync:e2e:pg` → `Missing script` (exit 1), `mission:pg-check` contains 0 references to the new test file, `build:backend` undefined |
| `.github/workflows/verify.yml` | — | — | — | 0 registry-sync steps in the workflow: the proof is simply absent, which is how the last release shipped a no-op |
| `.gitignore` | — | — | — | 0 entries for the e2e cluster directory, so a local run leaves `.pglite-registry-sync-e2e/` as untracked noise |

Case 6 (`dist/` sufficiency) reports `# SKIP no dist/scripts/mission-sync-registry.js in this tree —
run npm run build:backend` rather than a verdict in a tree with no build: verified in an unbuilt
copy, where the other nine cases still pass 9/0 and none of them quietly inherits a pass from a
stale build.

Guards verified by hand against `dist/`, before the automated versions existed, all reproduced in
the tests above: dead mission PostgreSQL → RC 1 with the connection error; missing platform file →
RC 1 naming the path and reporting whether `DATABASE_URL`/`DATA_DIR` are set; migrated-but-empty
platform → RC 0 with "nothing to sync"; every agent user-owned → RC 1 naming the filter; ceiling
breach mid-import → RC 1, 1,000 agents and 1,900 grants from the committed batches, 0 orphans, 0
ledger rows, 0 cents, and a resume that completes the rest.

## 6b. The one pre-existing test that had to change

`src/mission/mission-migrations-at-boot.test.ts` rebuilds production's stuck state to prove a boot
finishes it, and it selected that state with `files.filter((f) => !/^004[3-9]/.test(f))` — a
pattern written when 0049 was the newest file. Adding `0050_registry_tool_grants.sql` made the
"already applied" fixture include the new migration, so the fixture claimed production had applied
a file it had never seen and the case failed 46 ≠ 45. The filter now compares the number
(`Number(f.slice(0, 4)) <= 42`) and the assertion prints which files the frozen set ends with. The
pinned count stays 45, the pinned behaviour stays "boot applies the rest and exits 0", and the
case is 10/10 again on SQLite and 10/10 with the PostgreSQL skip in `mission:pg-check`.

That is a brittle-by-construction fixture made robust, not an expectation relaxed to fit new code:
with the old pattern, *any* migration numbered 0050 or higher would have been silently treated as
already applied by the test that exists to catch exactly that class of mistake.

## 7. What this fix does not touch

`assertInScope`, both approval gates, the owner-only checks, `ZA141251SA_BIND_HOST`, and every
payout and settlement gate are unchanged — this task adds no bypass and removes no gate; the
ceiling and the owner filter are still enforced and are now *reported*. The sync writes
`mission_agents`, `mission_agent_tools`, their zero-cash subledgers (unchanged behaviour) and one
audit row. It does not write the platform database, `mission_ledger`, `mission_cash_accounts`
balances, `mission_payout_slots`, `mission_approvals`, `mission_tools`, `mission_tool_requests`
or any prior-audit chain.

## 8. The owner action that remains

After this ships, the production run is:

```bash
railway run npm run mission:sync-registry     # or the same command in the container shell
```

It is safe to run twice; the second run says `ALREADY IN SYNC`. Until it has been run against
production, the production mission database still holds 0 imported identities and 0 grants — and
this file does not claim otherwise. The counts it prints (`platform-owned 4001` or fewer,
`grants 7203`) are the number to compare against the owner's measurement above; if production's
fleet has been assigned to users, the run will now exit 1 and say so, which is the correct answer
rather than a silent zero.

## 9. Second entry, same day: the sync that was being killed by a crash loop

The command in §1–§8 was correct and still lost. Its first full production run was started inside a
container whose mission tier could not become ready within the wrapper's 30 s window, so the container
was SIGTERM'd mid-run; batches are transactional, which means the kill rolled the current batch back
whole and left **zero rows and no exit code anyone could see**. The full diagnosis, the measurements
and the wrapper's new contract are in
[MISSION-BOOT-ON-POSTGRESQL-2026-10-12.md](MISSION-BOOT-ON-POSTGRESQL-2026-10-12.md). What changed
here:

* **Money provisioning is bulk now, per batch.** `syncMissionRegistry` used to call
  `provisionMoneyAgent()` once per imported identity — ~44,000 statements for 4,001 agents inside one
  transaction. It calls `provisionMoneyAgents()` (`src/mission/money.ts:121`) once per batch, which
  reads the existing rows in `IN (…)` chunks, inserts cash accounts and grants in chunks of 200, and
  appends the audit rows through `appendMissionAuditBatch`. Only the flat, unparented grant is
  available in bulk on purpose: delegation reads a parent's authority and moves cents, and no set
  operation may decide that. Measured full import: **66,800 ms → 21,700 ms**, still
  11,204 rows, still exactly 4,001 identities and 7,203 grants.
* **Every batch says what it did and how long it took**:
  `batch 3/9 in 2264 ms: 500 created, 0 updated, 0 already matching, 800 grant rows written, 500
  fleet rails provisioned (0 already present)`. Per-batch milliseconds are what separates "the
  database is slow" from "the command is hung", which was unanswerable before.
* **The target and the probe come first.** Before any write the command prints the resolved mission
  target and runs a `SELECT 1` pre-flight; a database that does not answer is reported with a
  classification (refused / reset / out of time / answered-but-not-Postgres) and a note that nothing
  was written and no batch was started.
* **`ZA141251SA_SYNC_BATCH`** (default 500, 1–1000) sizes a batch. It exists for a managed database
  that needs smaller transactions; `0` and `5000` are refusals that quote the value back, not clamps,
  because clamping would let an operator read the log of a run they did not configure.
  `--print-registry-sync-bounds` prints the choice and the target without touching a database.
* **The report now includes the fleet rails** (`fleet rails 5 provisioned/0 already present` in the
  summary, per batch as well), so a run that imported identities but provisioned no money-control
  rows cannot be read as a complete import. A second run reports `ALREADY IN SYNC` and
  `fleet rails 0 provisioned/0 already present`: the same zeros, with the reason attached.

Pinned by `src/mission/registry-sync-production-shape.test.ts` (both engines: SQLite standalone,
PostgreSQL under `npm run mission:pg-check`) and `src/mission/registry-sync-config.test.ts`.

Production remains as the owner measured it until the command is run there — from a shell that is not
inside a restarting container. The killed run wrote nothing, so re-running it is still the whole
action.
