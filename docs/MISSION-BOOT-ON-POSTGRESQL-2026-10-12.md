# The mission server would not boot on PostgreSQL — the 38 s boot, the 30 s gate, and the killed sync

Date: 2026-10-12. Scope: the ZA141251SA mission server's startup path, the production startup
wrapper, the mission registry sync's batching, and the PostgreSQL bridge's timeouts.

Nothing in this file was changed in production. No deploy, no setting, no row. Every number below is
either a measurement taken locally against a production-shaped PostgreSQL mission database (the
same 4,001-agent fleet, the same 7,203 tool grants, no network latency) or a `file:line` fact in
this repository. Where a number is the owner's production observation rather than a local
measurement, it says so.

---

## 1. The symptom, and why it was not what it looked like

The container was crash-looping with the mission tier "unready", and a long-running
`npm run mission:sync-registry` had been killed mid-flight: no output, no error, no rows, exit code
not observable.

It looked like a service that failed to start. It was a service that was **working** and was killed
for taking too long:

```
t=8137 ms   http=000refused
t=18208 ms  http=000refused
t=28275 ms  http=000refused
READY after 38362 ms          ← 8 seconds after the wrapper had already decided
```

`scripts/start-prod.mjs` allowed the private mission child 30,000 ms to answer `/api/health`, with a
1,000 ms timeout per probe, and it `await`ed that window *before* launching the public web and API
tiers. The mission child needed 38,362 ms to reach its own `listen()`. So every boot:

1. spent the readiness window while the child was still doing real, useful database work,
2. declared the private tier dead,
3. exited non-zero, and — because the public tiers had not been launched yet — **took the public
   product down with it**, on every restart, forever.

The killed sync is the same event seen from the other side: the operator's
`ZA141251SA_MISSION_SERVER_ENABLED=true` container was restarting, and a `mission:sync-registry`
running inside it was SIGTERM'd with it. Batches are transactional, so a killed batch leaves **zero
rows**, and the command's per-batch reporting was not fine-grained enough to show how far it had got.

## 2. The measurement, before and after

Local fixture: PostgreSQL (the repo's own PGlite wire server, `scripts/pg-test-server.mjs`) holding
the imported fleet — `mission_agents` 4,001, `mission_agent_tools` 7,203, `mission_wallets` emptied
so the provisioning path was actually exercised. Against Neon the same round trips are 3–10× more
expensive, which is why this never showed up on a laptop with a SQLite file.

| step before `listen()` | before | after |
| --- | --- | --- |
| `ensureAgentWallets()` — first run, 4,001 agents | **30,120 ms** | **558 ms** (54×) |
| `ensureAgentWallets()` — no-op path (every later boot) | 2,895 ms | **16 ms** (181×) |
| `applyMissionMigrations` (0 applied, 53 files) | 3,430 ms | 3,537 ms (not touched) |
| `verifyMissionAudit` over 16,017 rows | 296 ms → `ok: true` | `ok: true` (chain intact) |
| **process start → first HTTP 200** | **38,362 ms vs a 30,000 ms budget → guaranteed crash loop** | **6,063 ms** |
| `npm run mission:sync-registry`, full import | 66,800 ms (11,204 rows) | **21,700 ms** (11,204 rows) |
| the same sync, already in sync | (no per-batch cost visible) | 17,600 ms, `ALREADY IN SYNC`, 0 written |
| CI/test-measured boot on PostgreSQL | — | **ready in 4,537 ms** (4,001 agents / 4,002 wallets / 53 migrations / 16,018 audit rows) |

The last row is `src/mission/mission-boot-readiness-on-postgres.test.ts`, which boots the real
compiled `dist/scripts/mission-serve.js` and waits with the same module the wrapper uses.

## 3. Root causes, each one with its address

1. **Per-agent SQL inside one pre-`listen()` transaction.** `ensureAgentWallets()`
   (`src/mission/treasury.ts:794`) read every active agent, called `walletForAgent()` per agent, then
   inserted one wallet and appended one audit row per agent — 7 to 11 round trips × 4,001 agents,
   serialized by the synchronous bridge. `mission:sync-registry` had the same shape through
   `provisionMoneyAgent()` (`src/mission/money.ts:85`), ~44,000 statements for the fleet.
   The fix is set-based provisioning: one `COUNT(*)`, one `WHERE … AND NOT EXISTS (…)`, chunked
   multi-row inserts, and a batched audit append (`appendMissionAuditBatch`,
   `src/mission/database.ts:498`). The bulk paths are *proven* equivalent to the loop they replaced —
   wallet row, grant row, cash-account row and both audit rows, compared agent by agent — in
   `src/mission/production-provisioning.test.ts` ("bulk fleet provisioning writes the same rows as
   the per-agent loop it replaced"). That test exists because "faster and slightly different" would
   have been worse than slow: these are money-control rows.
2. **A readiness window shorter than the work, with the public tiers behind it.** The 30 s budget and
   the 1 s per-request timeout are gone; the budget is 180 s by default, configurable, and — the part
   that matters for availability — the public tiers are launched **before** readiness is awaited
   (`scripts/start-prod.mjs:574` spawns the child; supervision happens after the public tiers, at
   `:491`). A private tier can now be slow, sick, misconfigured or entirely absent without costing the
   public product.
3. **`fetch failed` was ambiguous, and the ambiguity was load-bearing.** A 1,000 ms per-request
   timeout produces `fetch failed` against a server that is healthy but whose event loop is inside a
   30 s database call, exactly as it does against a dead one. `waitForMissionReadiness()`
   (`scripts/mission-readiness.mjs`) now states which of the two it saw, names the URL and the
   per-request budget, quotes the rejected payload back (`ownerAccounts=0`, `audit=false`, …), and
   prints a progress line every 10 s while it waits — so a slow boot is visible as a slow boot.
4. **The wrapper and the probe agreed only by accident.** Both used to be literals
   (`127.0.0.1`, `4200`) that the wrapper also *forced* onto the child. There is now one resolver —
   `missionBindTarget()` (`scripts/mission-db-target.mjs:74`) — and the child's bind env and the
   probe URL come from the same call. The security pin is deliberately **kept**: the private listener
   stays loopback, an inherited `ZA141251SA_BIND_HOST=0.0.0.0` cannot expose the owner dashboard, and
   a platform-injected `PORT` cannot move it (that would collide with the public tier). A deployment
   that genuinely needs another port says so explicitly with `ZA141251SA_MISSION_PORT`, and the probe
   follows automatically. `src/app/stackhost-deploy.test.ts` pins both halves of that.
5. **The PostgreSQL bridge had no connect timeout of its own and no retry.**
   `src/db/pg-worker.mjs` created a bare `new Client({connectionString})`: a black-holed connect
   hangs on the kernel's schedule, a suspended serverless database fails the whole boot on one
   attempt, and nothing set `statement_timeout`, `lock_timeout`,
   `idle_in_transaction_session_timeout`, `keepAlive` or `application_name`. See §5.
6. **The sync was opaque at the only granularity that mattered.** It printed a summary at the end and
   nothing per batch beyond counts. It now prints `batch n/total in <ms> ms`, the batch size it used,
   the resolved target before the first write, a bounded pre-flight probe, and the fleet rails it
   provisioned (cash accounts + zero-value grants) per batch and in total — so `written 0` can never be
   confused with "the run did nothing": the idempotent case says `ALREADY IN SYNC` and
   `fleet rails 0 provisioned/5 already present`.

## 3b. The bug the new boot test caught: a swallowed error, a poisoned session, a hang

The PostgreSQL boot test was written before the code it now protects, and on the first CI-shaped run
(a mission database warmed by `mission:pg-check`, not a fresh one) it did not pass: the child printed
its migrations line and then **nothing for 90 seconds**. What that turned out to be is worth recording
because it is the general trap of this stack:

`ensureCatalogPersisted()` (`src/mission/earning/workload-allocator.ts`) seeded its money grants with

```js
try { db.run('INSERT OR IGNORE INTO mission_money_grants (id, agent_id, …) VALUES (…)', […]); } catch {}
```

Three defects in one statement: `INSERT OR IGNORE` is SQLite syntax that PostgreSQL does not have;
`mission_money_grants` has no `id` column (its primary key is `agent_id`); and `created_at` does not
exist there either. So the statement failed **on both engines** and the `catch {}` swallowed it on
both. On SQLite a swallowed statement is a no-op and the boot continues. Inside an open PostgreSQL
transaction it aborts that transaction, and then every following statement in it — including the
`SELECT COUNT(*)` the same loop used to do per agent — fails with `current transaction is aborted,
commands ignored until end of transaction block`. The boot never reported that: the seed that tripped
over the poisoned session printed one `boot seed skipped (…)` line, and everything after it was
waiting on a serialized bridge whose transaction would not end. A hang with no error is exactly the
shape of the incident in §1, arriving from a different direction.

Three changes, all covered above or by tests:

* the dead statement is gone (grants are provisioned by `provisionMoneyAgents()` in the registry sync,
  where the columns and the audit trail are right), and the loop's per-agent `COUNT(*)` became one
  read plus chunked inserts — the same fix §3.1 describes, in the file that had it too;
* **every boot seed now owns its own transaction boundary** (`seedAtBoot` in `src/mission/server.ts`),
  so a swallowed failure inside one seed cannot be inherited by the next, and a partially applied seed
  is discarded instead of half-committed. "Skipped" now means skipped;
* if a seed does surface an aborted-session error, the boot **fails loudly instead of continuing**
  (`ABORTED_SESSION_HINT` in `src/mission/boot-session-state.ts`). A mission server that cannot listen
  must say so; that is the difference between a container that restarts with a reason and one that
  sits in its readiness window until it is killed.

Measured after the fix, same warmed database that hung: **ready in 9,229 ms**, with 4,083 agents funded
by one wallet pass. The fresh production-shaped fixture stays at 5,337 ms.

Remaining, and honestly stated: the synchronous bridge bounds a stuck statement by
`AKBARAL_PG_QUERY_TIMEOUT_MS` (120 s), so a poisoned session *anywhere else* still costs up to that
before it errors. Auditing the codebase for other `try { statement } catch {}` blocks inside
`db.transaction(...)` is the follow-up this finding implies; the boot seeds are the ones that were
blocking a container, so they are the ones that are fixed here.

## 4. The wrapper's contract, as it now stands

```
ZA141251SA_MISSION_SERVER_ENABLED=true    opt in (exact 'true'; unchanged)
ZA141251SA_MISSION_READINESS_TIMEOUT_MS   total budget per attempt        default 180000
ZA141251SA_MISSION_HEALTH_TIMEOUT_MS      per health request              default 5000
ZA141251SA_MISSION_START_ATTEMPTS         launches before giving up       default 5
ZA141251SA_MISSION_RESTART_DELAY_MS       between launches                default 15000
ZA141251SA_MISSION_PORT                   the private listener's port     default 4200
ZA141251SA_MISSION_REQUIRED=true          opt in to "no public tiers without a ready private tier"
ZA141251SA_SYNC_BATCH                     agents per sync transaction     default 500, 1–1000
AKBARAL_PG_CONNECT_TIMEOUT_MS             pg connect budget               default 30000
AKBARAL_PG_CONNECT_ATTEMPTS               pg connect tries                default 3
AKBARAL_PG_QUERY_TIMEOUT_MS               client-side per-query budget     default 120000
AKBARAL_PG_STATEMENT_TIMEOUT_MS           server-side statement_timeout    default 300000
AKBARAL_PG_LOCK_TIMEOUT_MS                server-side lock_timeout         default 60000
AKBARAL_PG_IDLE_IN_TRANSACTION_TIMEOUT_MS server-side idle-in-transaction   default 120000
```

Behavior, precisely:

* The mission child is spawned **first** (so its database work overlaps the public tiers' startup)
  and its migrations still run **before** it, as a blocking boot step. That ordering is unchanged and
  still pinned by tests: platform migrations → mission migrations → mission child → public tiers.
* Readiness is verified **after** the public tiers have been launched. When it succeeds: one log line
  naming the URL. When it fails: the child is stopped (never left running unreached), the failure is
  printed with its reason, and the child is relaunched within the budget.
* Giving up prints a banner that names the reason, what was probed, the attempt/budget arithmetic,
  the database the child was given, and the variables that change the decision. Then:
  * default — the container keeps serving the public tiers; the mission dashboard stays unavailable;
  * `ZA141251SA_MISSION_REQUIRED=true` — `shutdown()` and exit 1, with the banner saying the owner
    asked for that. Fail-closed did not disappear; it stopped being the accident.
* The public tiers' own health gate is unaffected in both directions: `/api/ready`
  (`readinessPayload()` in `src/server/health.ts:198`) checks the platform database, migrations,
  uploads and the execution queue — it has never included a mission check. So a dead private tier does
  not make the public readiness payload lie, and a healthy one does not make it true.
* A child that dies **after** having been ready is reported (`MISSION TIER RESTART …`) and
  relaunched. It no longer kills the web and API tiers — that sibling kill is the mechanism that made
  this a public outage, and `an unexpected mission exit is retried without stopping the public tiers`
  asserts it is gone.
* A mission database that is configured but absent is still refused **by name**, and nothing creates
  or selects an alternate database. The refusal no longer ends the container unless `REQUIRED=true`.

## 5. The pooler report (Neon), and what was deliberately *not* done

Read from `src/db/driver.ts` and `src/db/pg-connection.mjs`; measured with `scripts/pg-test-server.mjs`
as a stand-in for the wire protocol. No credential, URL or token is logged anywhere on these paths.

* **One `pg.Client`, not a `Pool`.** The whole application's database access is serialized through a
  worker thread over a `SharedArrayBuffer` + `Atomics.wait` handshake. That is why a slow query is a
  slow *boot* and not just a slow request: there is no concurrency to hide behind.
* **The main thread's wait is bounded** (per query, `PG_QUERY_TIMEOUT_MS`; per connect,
  `PG_CONNECT_TIMEOUT_MS`), and both are now environment-overridable
  (`src/db/driver.ts:35`). The worker's own wait was not — it is now, because the client got
  `connectionTimeoutMillis` and a bounded retry (`src/db/pg-worker.mjs:85`).
* **`keepAlive: true`** was added, because a pooler reaper dropping an idle connection is what makes a
  mission boot fail with "connection terminated unexpectedly" at 04:00 and succeed at 04:05.
  **`application_name`** (`AKBARAL_PG_APPLICATION_NAME`, default `akbaral`) was added so that a
  session is identifiable in `pg_stat_activity` on a shared account.
* **Server-side timeouts are best effort, on purpose.** `SET statement_timeout` / `lock_timeout` /
  `idle_in_transaction_session_timeout` are applied after connect and each failure is swallowed.
  Under a *transaction-mode* pooler these settings are not pinned to a session, so they cannot be the
  primary bound — and a proxy that rejects a `SET` must not turn into a failed boot. The bound that
  cannot be bypassed stays client-side, in `pgBridge`.
* **TLS was already correct and was left alone**: remote `sslmode=require` is upgraded to an explicit
  `verify-full`, `disable` and `no-verify` are refused for remote hosts (`normalizeSslMode`).
* **Not done, and why**: no `Pool`, no per-request concurrency, no async rewrite of the repository
  layer. Those are the right long-term shape for a fleet this size, and they are a much larger change
  than a boot that must stop being a crash loop. The bulk provisioning in §3.1 is what made the
  serialized bridge affordable; the pool is what would make it unnecessary.

## 6. Tests added or changed, and the negative controls

New:

* `src/mission/mission-boot-readiness-on-postgres.test.ts` — the readiness contract rejects
  `service:'akbaral-api'`, `ownerAccounts:0`, `ownerAccounts:'1'`, `audit:false`, `ledger:false`,
  `vaultConfigured:false`, a payload naming a different database, `status:'degraded'` and a missing
  body; and accepts a genuine one. Then the real boot on PostgreSQL, waited for by the production
  module, asserting exact counts and a 90 s ceiling. **Negative control**: the waiter is pointed at a
  port that was bound and closed, and must time out with a message naming the URL and the per-request
  budget — so "ready" cannot be satisfied by a stub.
* `src/mission/registry-sync-config.test.ts` — `ZA141251SA_SYNC_BATCH` defaults, accepts, and refuses
  (`0`, `-5`, `1001`, `50000`, `5.5`, `0x10`, `abc`): a typo is a refusal that quotes the value, never
  a clamp. Plus the probe classifier: refused / reset / slow / not-postgres / unclassified, including
  the trap where the word `TIMEOUT` appears in the printed budget names.
* `src/mission/production-provisioning.test.ts` — the bulk-vs-loop equivalence described in §3.1,
  ending in `verifyMissionAudit().ok === true`.
* `src/app/stackhost-deploy.test.ts` — bind/probe parity (an explicit `ZA141251SA_MISSION_PORT` moves
  the child **and** the probe together, in the recorded spawn env and the recorded fetch URL);
  hostile inherited values cannot move the listener; the budget floors (≥ 120 s, ≥ 2 s, ≥ 2 attempts,
  `required` defaulting to false).

Changed, because they pinned the old doctrine — each kept its subject and gained the new guarantee:

* `private readiness failure times out non-zero before public tiers start` →
  `a mission tier that never becomes ready is retried loudly and never costs the public tiers`.
* `an unexpected required mission exit terminates non-zero and stops public siblings` →
  `an unexpected mission exit is retried without stopping the public tiers` (asserts `kills === []`
  for a child that exited by itself, and no `web`/`api` kill at all).
* `signal termination of the required mission child is also a non-zero failure` →
  `signal termination of the mission child is reported and retried, not swallowed`.
* the two "refuses a missing database" cases keep the refusal-by-name assertions and the
  never-create-a-database guarantee, and no longer expect the public tiers to be sacrificed;
  `ZA141251SA_MISSION_REQUIRED=true restores the fail-closed container for a refused private tier`
  is the new companion that keeps the old exit-1 behavior under an explicit opt-in.
* `src/mission/registry-sync-production-shape.test.ts` — two cases added: per-batch timing and fleet
  rails in the report, and `ZA141251SA_SYNC_BATCH=2` really producing `batch 3/3 in <n> ms: 1 created`
  with the second pass reporting `ALREADY IN SYNC` and `fleet rails 0 provisioned/0 already present`.

`npm run mission:pg-check` now also runs the boot test, so CI (`verify.yml:56`) exercises the
PostgreSQL boot path on every push, not only the migration path.

## 7. How to reproduce the numbers

```sh
# production-shaped fixture: PGlite wire server + the imported fleet
npm run build:backend
node scripts/pg-test-server.mjs --run sh -c \
  'ZA141251SA_DATABASE_URL=$PG_TEST_DATABASE_URL npx tsx --test --test-force-exit \
     src/mission/mission-boot-readiness-on-postgres.test.ts'

# the sync, with per-batch timings and the bounds it will use
ZA141251SA_SYNC_BATCH=100 npm run mission:sync-registry
npm run mission:sync-registry -- --print-registry-sync-bounds

# the wrapper's own startup decisions, no children spawned
node scripts/start-prod.mjs --print-ports
```

## 8. What production should do next

1. Run `npm run mission:sync-registry` against the production mission database from a shell that will
   not be SIGTERM'd with a restarting container (a Railway one-off job, or `railway ssh`), and read
   the per-batch milliseconds: a healthy run on that fleet is ~2.2 s per 500-agent batch locally, so a
   batch taking tens of seconds is a database or pooler problem, not a code problem.
2. If the Neon endpoint scales to zero, either keep it warm or raise `AKBARAL_PG_CONNECT_ATTEMPTS`
   (default 3 × 30 s) — the boot now says explicitly whether the connect was refused or timed out.
3. Only set `ZA141251SA_MISSION_REQUIRED=true` on a deployment whose *entire* purpose is the private
   tier. On the shared production container it restores the behavior this document is about.
4. `ZA141251SA_MISSION_READINESS_TIMEOUT_MS` should not be lowered below ~60 s for a database of this
   size unless the fleet shrinks: 38 s was measured with the wallet pass already bulked, on a local
   server, with no network.

## 9. Deliberately unchanged

Loopback-only private listener; one mission database, never created or substituted; the exact
`'true'` opt-in for mission startup; no workers, routes, rewrites or proxies wired by the wrapper;
the sync stays one-way and metadata-only (`agent_tools.config` is counted and skipped, never copied);
no ledger entry, balance, payout slot or approval is created by a sync; the audit chain's payload and
sequence semantics are byte-for-byte the same as the loop's, including `createWallet`'s asymmetry of
storing a sliced label while auditing the unsliced one.

Related: `docs/MISSION-REGISTRY-SYNC-2026-10-12.md` (the command the crash loop was killing),
`docs/MISSION-MIGRATIONS-AT-BOOT-2026-10-12.md` (how the mission schema reaches a PostgreSQL
database at boot), `MISSION_SYSTEM.md` §6d and §8.
