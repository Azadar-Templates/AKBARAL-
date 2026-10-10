# Scoped contracts, self-serve from the owner console — ZA141251SA, 2026-10-10

Two outstanding owner actions were keeping the fleet from starting, and production reads said both
were unreachable without a shell:

- `no_payout_slot_verified` — has console controls (`#slot-form`, `#slot-verification`).
- `no_scoped_contract` — had **no** console control. It could only be cleared by an operator with a
  shell running `npm run fleet:readiness -- --contracts <class>` and then
  `--contracts-approve=<proposalId>`. The owner has no Railway shell, so in practice that blocker
  could never clear and the fleet could never start.

This document records (1) the audit that ran **before** any edit, (2) what was built, (3) the
payout-slot durability report, (4) what was measured and where, and (5) what was deliberately not
changed.

> **Production vs local, stated once and enforced throughout.** Every number below marked *local*
> comes from the throwaway fixture database in this workspace (`/tmp/repro/mission.db`, and the
> disposable copy `/tmp/contracts-live/mission.db` used for the write demo). Production was **not**
> written to and **cannot** be measured from this environment; the only production facts quoted here
> are the ones the owner confirmed (production payout slot 1 **is verified**; production reports
> 4,001 registered agents, 0 execution-ready). `0 of 5 slots verified` is a **local-fixture** fact
> and must never be read as production state.

---

## 1. Audit, with `file:line`, before editing

### 1.1 The two fields `no_scoped_contract` is decided on

`src/mission/earning/fleet-readiness.ts` — one table, one predicate, nothing else.

| line | code | exact predicate |
| --- | --- | --- |
| `:38` | `no_scoped_contract` in the `BlockerCode` union | the code exists as a name |
| `:247` | `contracts = count(...)` | `SELECT COUNT(*) AS c FROM mission_agent_contracts WHERE status='active' AND (expires_at IS NULL OR expires_at>?)` bound to `nowIso()` |
| `:307`–`:308` | the owner-activation entry | `cleared: contracts > 0` |
| `:314` | its `action` text when cleared | `already satisfied: N active scoped contract(s)` |
| `:171`–`:172` | per-agent set | `SELECT agent_id FROM mission_agent_contracts WHERE status='active' AND (expires_at IS NULL OR expires_at>?)` |
| `:374` | single-agent verdict | `if (!hasScopedContract) blockers.push('no_scoped_contract')` |
| `:441` | fleet roll-up | `if (!sets.contracts.has(id)) agentBlockers.push('no_scoped_contract')` |
| `:478`, `:483` | free-path copy for the blocker | label + `freePath` (the text that used to point only at the CLI) |

So the gate is literally "≥ 1 row in `mission_agent_contracts` with `status='active'` and unexpired",
and per agent "this agent holds such a row". Nothing about it needs a shell — only a row does.

### 1.2 The two fields `no_payout_slot_verified` is decided on

Same module, `:147`–`:149` (`verifiedSlots` → the global blocker spec), `:242`
(`slotsVerified`), `:265`–`:270` (the activation entry, `cleared: slotsVerified > 0`), `:380`
(`if (!payoutReady) blockers.push('no_payout_slot_verified')`), and the boot/health roll-up at
`:560` (`gates.payoutSlots = { total, verified }`, `verified` using the same two columns).

The predicate is `status='active' AND verified_at IS NOT NULL` on `mission_payout_slots` — two
columns, both written by the existing verification flow (see §3).

### 1.3 The CLI path that was the only route, step by step, with the rows it writes

`scripts/mission-fleet-readiness.ts` (`:230`–`:270` in the version audited):

1. parse `--contracts <class>` → `contractsClass`;
2. if `--contracts-approve=<id>` is absent, call
   `AgentClassContracts.prepareClassContractsForClass(ownerActor, { agentClass })`;
   - one `INSERT` into `mission_agent_contract_proposals` per eligible agent
     (`status='pending'`, `permissions_json`/`resource_limits_json`/`budget_cents` frozen from the
     class definition, `expires_at` = now + 14 days);
   - one `INSERT` into `mission_human_action_tasks`
     (`action_type='manual_approval'`, "N scoped contract proposal(s) prepared for class …")
     — **one per batch, not one per agent** (`agent-class-contracts.ts:286`–`:296`);
3. with `--contracts-approve=<id>`, call `approveClassContractProposal(actor, id)` per id;
   - `UPDATE mission_agent_contract_proposals SET status='approved'`;
   - `INSERT INTO mission_agent_contracts (…) VALUES (… status='active', approved_by, approved_at,
     expires_at, permissions, resource_limits, budget_cents)`;
   - `INSERT` audit rows `agent_contract.prepared` / `agent_contract.activated` through
     `appendMissionAudit` (`src/mission/database.ts:364`, hash-chained, redacted).

Every one of those writes is a plain SQL write the mission server already owns. The CLI added no
capability — only a keyboard.

### 1.4 Was contract approval owner-only before this change? Yes — and there was no route at all

- `src/mission/earning/agent-class-contracts.ts` calls `assertMoneyOwner(actor)` at `:221`, `:255`,
  `:331`, `:379` (prepare one, prepare batch, approve, reject) — a non-owner actor throws regardless
  of transport.
- There was **no HTTP route** for contracts: `git show HEAD:src/mission/server.ts | grep -c
  agent-contracts` → **0** in the commit this change sits on top of, and the owner gate
  `requireOwner(ctx, mutation)` lives at `src/mission/server.ts:372`, `requireRead(ctx)` at `:441`.
- Approval therefore had exactly one door: a shell, plus the module's own owner assertion.

### 1.5 The minimum set of scoped contracts the 4,001 agents actually need

Derived from the registry, not from opinion: 16,004 agents locally / 4,001 in production, and the
22 verified venues in `src/mission/earning/platform-catalog.ts`. Mapping each venue to the class its
work requires (a throwaway script, deleted after the census — nothing was written):

The registry defines five classes (`agent-class-contracts.ts:60`–`:126`); three may be granted to an
agent, two may not:

| class | venues that need it | frozen permission set (line) | spend | extra gates (line) |
| --- | --- | --- | --- | --- |
| `bounty_research` `:62` | **17 of 22** | `report.submit` (`:64`) | `maxSpendCents: 0` | none |
| `bounty_execution` `:76` | **5 of 22** | `tool.request`, `report.submit` (`:78`) | ≤ 5,000¢ | `requiresSandbox: true` (`:81`) → `no_execution_backend` `:182`; `requiresMoneyGrant: true` (`:82`) → an active grant at or above the class floor |
| `evidence_verification` `:88` | **0 today** | `report.submit` (`:90`) | `maxSpendCents: 0` | none |
| `owner_submission` `:100` | — | `[]` (`:102`) | 0 | `ownerOnly: true` (`:107`) — never an agent grant |
| `payout_release` `:112` | — | `[]` (`:114`) | 0 | `ownerOnly: true` (`:119`) — never an agent grant |

**One class does not cover the fleet.** `bounty_research` covers 17 of 22 venues with the smallest
possible permission set (`report.submit` alone, zero budget); `bounty_execution` is required for the
remaining 5 and is *additionally* gated by `no_execution_backend` (no pinned OCI image is
configured), so preparing and approving its contracts is necessary but not sufficient.
`owner_submission` and `payout_release` are `ownerOnly: true` with an empty permission set — they are
**not** agent classes and must never be granted; the console refuses them by name
(`class_owner_only`) rather than replying "prepared 0".

---

## 2. What was built (mission files only; nothing in the public AKBARAL app)

### 2.1 Route — `src/mission/server.ts:1676` `case 'agent-contracts'`

- `GET /api/agent-contracts` → `requireRead`, returns `classContractConsoleView()`
  (`agent-class-contracts.ts:575`): `registry` counts, the live `blocker` object, `limits`, and one row
  per class with `needsIt`, `withActiveMoneyGrant`, `canPrepareNow`, `blockers`, `pending[]`
  (each with its own `scopeFault`), and `surface` (`permissions`, `contracts`,
  `totalBudgetCents`, `surfaceDigest`).
- `POST …/prepare`, `POST …/approve`, `POST …/approve-all` →
  `const session = requireOwner(context, true)` (`server.ts:1681`) **and** `assertMoneyOwner` inside
  the module. An anonymous caller gets 401, a link-only session gets 401 (no session to check), a
  non-owner role session gets 403, and every refusal is audited
  (`agent_contract.approval_refused`, `agent_contract.bulk_approval_refused`).

### 2.2 The block — Approvals → `mission-dashboard/index.html:198` `details.control-block#contracts-block`

Summary `Scoped agent contracts — prepare, then approve (owner only)`; `#contracts-blocker` carries
the live blocker line and the registry counts; `#contracts-classes` renders one row per distinct class
with its agent count and the exact permission list in **plain language**
(`PERMISSION_PLAIN_LANGUAGE` / `permissionSurfaceText`, `agent-class-contracts.ts:451`–`:478`), plus
a "never granted" line; `#contracts-prepare-form` (`:211`) has `select#contracts-prepare-class`
(`:213`) and `input[name=limit]` `min=1 max=200 value=25` (`:214`) and `#contracts-prepare-submit`
(`:215`); `#contracts-confirm` (`:225`) is the hidden confirmation panel. It is a `details`
element on purpose — collapsed by default, and not a `details.sub[data-view]`, so it cannot become a
nav view (pinned by `mission-dashboard-nav.test.ts`).

### 2.3 Idempotence, at fleet scale

`prepareClassContractsForClass` (`agent-class-contracts.ts:254`) now refuses
`proposals_already_pending_for_class` when the class already has an unreviewed batch. That guard is
the difference between "per-agent duplicate check" and "the button is safe to press twice": the
eligibility query already skips agents that hold a proposal, so a bounded second click would quietly
walk on to the *next* 25 agents and grow a queue nobody has read — measured live, before the guard, a
second prepare on the 16,004-agent copy moved pending 25 → 50. Approving, rejecting or letting the
batch expire unlocks the next batch; nothing here caps how many agents may ever hold a contract, and
the copy in `index.html:216` says so.

Measured after the guard: `prepare` → 200 (69 ms for 25 rows), second `prepare` → **409 in 4 ms**,
`mission_agent_contract_proposals` row count and the per-`(agent, class)` set **identical**, zero
duplicates.

### 2.4 Approval, and what it refuses

`approve-all` requires the exact `confirmSurface` digest the console displayed
(`agent-class-contracts.ts:654`); a stale or wrong digest is `409
confirmation_surface_mismatch` and grants nothing. Per contract and in bulk, approval refuses a
proposal whose permission set is **empty** (`emptyGrantFault`, `:483`) or **over-broad relative to its
class** (`approvalScopeFault`, `:496` — permission outside the class set, budget above the class
ceiling, limits above the class limits, or payload that no longer parses). Both faults are surfaced
*before* the owner clicks (the class row carries `scopeFault`) and again as the refusal reason, which
is written to the audit trail with the proposal left `pending`. The gate order is deliberately
`emptyGrantFault` → `matchAgainstDefinition` (tamper check) → `approvalScopeFault`.

### 2.5 No auto-approval, and no CLI required

Nothing in the module, the route or the client calls `approveClassContractProposal` without an
`actor` that came from a live owner session; `prepareClassContract*` never touches
`mission_agent_contracts`. The only way `no_scoped_contract` clears is an owner POST that lands at
`server.ts:1681`'s `requireOwner(context, true)`. `npm run fleet:readiness -- --contracts …` still
works and is still documented in the blocker's `freePath`, but it is now the second sentence, not the
first.

### 2.6 What was not weakened

`assertInScope` (`src/mission/bug-bounty-system.ts:120` and its 7 call sites), both approval gates
(`:580`, `:602` + `github-bounty-workflow.ts:530`), the owner-only checks (`requireOwner`,
`assertMoneyOwner`, `requireRead`), and `ZA141251SA_BIND_HOST` handling are untouched: `git diff -U0
src/mission/server.ts | grep -ciE "bind_host|assertInScope"` → **0**, and the three files that read
`ZA141251SA_BIND_HOST` (`src/mission/database.ts`, `scripts/mission-serve.ts`,
`scripts/start-prod.mjs`) are not in this diff at all. Confirmed also by (`mission-server.test.ts`,
`fleet-readiness-activation.test.ts`, `proxy.test.ts`) staying green. No contract, grant, approval,
task or earning was fabricated: every row in the demo exists because an owner session asked for it.
No new dependency, no credential printed (the console view contains no secret field at all).

---

## 3. Payout-slot verification durability (reported, not changed)

**Verdict: durable and restart-safe, with two honest limits.**

- **Tables written.** `confirmPayoutVerification` (`src/mission/payout-verification.ts:283`–`:372`)
  writes inside one `missionDb.transaction`:
  1. `mission_payout_slot_verifications` — the verification record (`:325`–`:353`; table created in
     `db/migrations-mission/0003_….sql:16`);
  2. `mission_payout_slots` via `verifyPayoutSlot` (`src/mission/treasury.ts:919`–`:922`) —
     `status='active'`, `verified_at`, `verified_by`, `updated_at` (the two columns the blocker reads,
     table + `verified_at`/`verified_by` from `0001_….sql:114`/`:127`);
  3. `mission_audit` rows `payout_slot.verification_confirmed` and `payout_slot.verified`, through
     `appendMissionAudit` (`src/mission/database.ts:364`) — hash-chained, `redactForAudit`, and
     deliberately **never** storing attestation text.
  Any throw rolls all three back; there is no partial "verified but unaudited" state.
- **Commit.** `missionDb.transaction` is the same single-writer transaction the money paths use
  (`src/mission/database.ts`, `financialTransaction`), and on PostgreSQL every statement is
  serialised through the driver (`src/db/driver.ts:288`–`:402`). `ensurePayoutSlots()`
  (`treasury.ts:750`–`:763`) only inserts rows 1..5 when absent — it never resets them.
- **Restart loss.** None from the application: `migration 0039_five_payout_slots.sql` is a
  copy-forward rebuild that carries `status`, `verified_at`, `verified_by` across, and no code path
  deletes or blanks them outside `setPayoutSlotStatus`/explicit owner action. Loss is therefore
  purely a **volume** question — the state lives exactly as long as `/data/mission.db` does. On
  Railway that is the owner's check, not this repo's claim: if `/data` is not a persistent volume, a
  re-deploy can take the verification with it. The console names its own database path in the boot
  banner and in `GET /api/health`, which is how to confirm what a given service is reading.
- **Post-restart proof.** `payoutSlotVerificationStatus` (`payout-verification.ts:431`) recomputes
  `payable` from stored columns on every read — expiry (`PAYOUT_VERIFICATION_VALIDITY_DAYS`,
  default 180 days, enforced by `sweepPayoutVerifications()` `:475`) and destination drift
  (`destinationFingerprint` `:150`) both make a stored verification stop counting, and `GET
  /api/payout-slots` re-runs `ensurePayoutSlots` + the status queries each request. There is no
  in-memory cache holding the claim, so a restarted process reports the durable truth. Boot also
  re-verifies the audit chain and prints `audit chain verified (N)` — the proof row is checkable
  after a restart.
- **One sharp edge, reported and not touched:** `verifyPayoutSlot` requires `slot.provider_ref`; a
  slot holding only a masked description answers `409 conflict` and cannot clear the blocker. That is
  the gate working, not a bug to route around — it needs the owner's provider reference, so it stays an
  owner action.

---

## 4. Measured

**Local, at 16,004 agents, on a disposable copy of the fixture DB (`/tmp/contracts-live/mission.db`,
port 4322) — not production, and not the fixture itself:**

| step | result |
| --- | --- |
| `GET /api/agent-contracts` | 7–29 ms unit-scale; 525–627 ms through the live console against 16,004 agents (gateway budget 15,000 ms) |
| `POST …/prepare` (25 agents, `bounty_research`) | 200, 25 proposals in 69 ms |
| second `POST …/prepare` | 409 `proposals_already_pending_for_class` in 4 ms — row count unchanged, zero duplicate `(agent, class)` pairs |
| `POST …/approve-all` with the wrong digest | 409 `confirmation_surface_mismatch`, nothing granted |
| `POST …/approve-all` with the displayed digest | 200, `granted: 25`, `refusedCount: 0`, 50 ms |
| replay of the same digest | 409 `nothing_pending` |
| `GET /api/overview` | 345 ms, `no_scoped_contract` **absent** from `fleet.activation.remaining`, `no_payout_slot_verified` still present |
| class with an empty queue | still prepared 10 → no fleet-size cap on the path |
| fresh-process read of the same file | 25 active contracts across 25 distinct agents, `purpose=class:bounty_research:5c4587d5`, `permissions=["report.submit"]`, `budget_cents=0`, one distinct `approved_by`; audit 35 `agent_contract.prepared`, 25 `agent_contract.activated`, 1 `agent_contract.bulk_approved` |
| real `fleet:readiness` CLI on that copy | registered 16004 / executionReady 0 / blocked 16004, `agentsWithScopedContract` 25, `no_scoped_contract.agentsAffected` 15979 (= 16004 − 25), activation entry `cleared=True`, `how='dashboard control'`, `target='#contracts-block'`, action `already satisfied: 25 active scoped contract(s)` |

**Known pre-existing wart, reported not fixed:** the per-batch `manual_approval` task
(`agent-class-contracts.ts:286`–`:296`) is created by `prepareClassContractsForClass` and never
resolved by approval — the module has no `resolveHumanActionTask` call. It behaved identically for
the CLI before this change. Effect: the batch's first agent keeps showing `owner_action_pending`
(fleet-readiness reads open tasks at `:177`–`:181`, `:248`) until the task is closed. It is
conservative (an extra blocker, never a false green), so it was left alone rather than widening this
slice's blast radius. Fix belongs in the module, where the CLI and the console share it.

---

## 5. Validation totals

| gate | result |
| --- | --- |
| `src/mission/mission-agent-contracts-console.test.ts` | **19 / 19** |
| `src/mission/earning/agent-class-contracts.test.ts` | **6 / 6** |
| `mission-server.test.ts` + `fleet-readiness-activation.test.ts` | **58 / 58** |
| whole mission + gateway sweep (`src/mission/**`, `src/app/mission-gateway/**`) | **1,628 / 1,628 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo, 25 suites** (`npx tsx --test --test-reporter=tap` over every `*.test.ts` under those two trees) |
| live console harness `scripts/verify-mission-dashboard.mjs` | **54 / 54** against the pristine fixture **and** 54/54 against the copy that already held 25 approved contracts + 10 pending (exercises the bulk-button and gate-cleared branches); both re-run against this final tree |
| live login harness `scripts/verify-mission-login.mjs` | **12 / 12**, same final tree |
| typecheck | `npm run typecheck` rc 0 |
| `node --check mission-dashboard/app.js` | clean |
| build | `npm run build` rc 0 (`tsc -p tsconfig.backend.json` + asset copy + `next build`; `/mission` static and `/mission-gateway/[[...path]]` dynamic both present) |
| `npm run scan:secrets` | **PASS** — "no real secret markers found in the working tree (22 allow-listed synthetic placeholders)" |
| `git diff --check` | rc 0, no whitespace errors |

### 5.1 Sensitivity — revert each edited file, count failures, restore

Pinned set: `mission-agent-contracts-console`, `earning/agent-class-contracts`,
`fleet-readiness-activation`, `fleet-readiness`, `earning/specialist-fleet`, `mission-server`,
`mission-dashboard-owner-overview`, `mission-dashboard-bare`, `mission-dashboard-nav`.
**Baseline with the work in place: 141 tests, 0 failing.** One file reverted at a time:

| reverted file | failing tests |
| --- | --- |
| `src/mission/earning/agent-class-contracts.ts` | 8 / 141 |
| `src/mission/server.ts` | 12 / 141 |
| `src/mission/earning/fleet-readiness.ts` | 2 / 141 |
| `mission-dashboard/app.js` | 4 / 141 |
| `mission-dashboard/index.html` | 28 / 141 |
| `scripts/verify-mission-dashboard.mjs` | 0 / 141 — live-only: same server, same tree, HEAD harness **46/46** vs current **54/54** |
| `src/mission/mission-server.test.ts` | 0 / 141 (reverting a pin removes assertions; the suite total drops, it cannot add a failure) |
| `src/mission/earning/fleet-readiness-activation.test.ts` | 0 / 141 (same reason) |
| `src/mission/mission-agent-contracts-console.test.ts` | 0 / 122 — deleting the suite removes 19 tests from the run |

All nine files restored (`ALL RESTORED`, sha256-verified per file), re-stated tree **141 tests, 0
failing**.

---

## 6. What the owner clicks (production, in order)

1. Mission console → **Approvals** → expand **Scoped agent contracts — prepare, then approve (owner
   only)**. The header line states the live blocker and the registry counts, so it is checkable before
   touching anything.
2. Class: `bounty_research`. Up to: `200` (the field's maximum; `25` is the default). Press **Prepare
   contracts**. Expect one batch of pending proposals, each showing exactly `report.submit` and a zero
   budget — the smallest surface in the registry, and the one that covers 17 of the 22 verified venues.
3. Read the class row, then press **Approve all** and confirm the surface digest the panel displays.
   This is the only step that writes `mission_agent_contracts` rows, and it cannot run without the
   digest that was just shown on screen.
4. `no_scoped_contract` is now cleared globally (the readiness gate is "≥ 1 active unexpired
   contract"); the per-agent list shrinks by exactly the number of agents approved. Covering the whole
   fleet is click-bound, not capped: the batch ceiling is 200 and cycles = ceil(eligible ÷ 200), where
   *eligible* is the registry minus fixture-origin and non-active agents and, for classes with spend,
   minus agents without an active money grant at or above the class floor
   (`eligibleAgentsForClass`, `agent-class-contracts.ts:205`). Each call scans at most 4× the requested
   limit, so on a registry where many agents are ineligible a batch can come back smaller than asked
   and take more cycles. Reference points: 4,001 agents registered in production ⇒ at most 21 cycles;
   16,004 locally ⇒ at most 81. Nothing here caps how many agents may eventually hold a contract — the
   queue guard only says one unreviewed batch per class at a time.
5. For `bounty_execution` (the other 5 venues) the same two clicks are necessary but **not
   sufficient**: that class is also gated by `no_execution_backend`, because no pinned OCI image is
   configured. The block says so in the class row's blockers rather than letting the owner prepare 200
   contracts that could never execute.
6. Payout slot: production slot 1 is already verified (owner-confirmed), so nothing is needed there.
   Locally — and in this fixture — `0 of 5` slots are verified, and that number must not be read as
   production state. `verifyPayoutSlot` needs `slot.provider_ref` from the provider; that stays an
   owner action.

## 7. Deliberately not done

- **No auto-approval anywhere**, and no background job that prepares or approves on a timer. Granting
  stays a human act by design.
- **The stale batch task** (§4) is not patched here: it predates this change and belongs in
  `agent-class-contracts.ts` where both the CLI and the console share the fix. Related gap worth
  noting: there is no HTTP route for `mission_human_action_tasks` at all, so the owner cannot close a
  review task from the console — a separate slice, not a contract concern.
- **No public-app surface** was touched. Every changed path is mission-only:
  `src/mission/**`, `mission-dashboard/**`, `scripts/verify-mission-dashboard.mjs`, `docs/`. The
  pinned assertions that the unauthenticated dashboard shell and static assets never contain the
  private mission identifier stay green (`mission-server.test.ts:479`, `:481`).
- **No dependency, no paid service, no production write.** Production was never contacted by any of
  the measuring above; the write demo ran against a copy in `/tmp` and was destroyed with it.
