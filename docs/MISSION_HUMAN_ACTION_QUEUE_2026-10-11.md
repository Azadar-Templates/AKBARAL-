# Clearing the human-action queue from the owner console — ZA141251SA, 2026-10-11

The fleet reported exactly one outstanding owner action:

> `owner_action_pending` — "clear the 2 open task(s) in the Approvals queue".

That sentence described a control that did not exist. `mission_human_action_tasks` had two writers and no
owner-side reader: no route in the mission server read the table, and `resolveHumanActionTask` — the only
function in the tree that changes a task's status — was called by a test and nothing else. The Approvals
panel's own heading says `Head agent cannot approve`, and the head-agent feed repeats it
(`src/mission/head-agent.ts:175`, `:271`, `:525`), but those lines are about `mission_approvals`, a
different queue: nothing at all was rendered from the queue this blocker counts. The circle was real and
it was not narrow: the owner was told to decide an entry they could neither see nor decide, while the
scheduler skipped the agent that filed it.

This document records the audit that ran **before** any edit, what was built, the measured proof, and
what is still blocked.

> **Production vs local, stated once.** Every number below is from this workspace's disposable database
> (`/tmp/haq/mission.db`, 4,041 agents after `mission:init` plus 40 registered by hand), driven through the
> real routes and the real report path. Production was not written to and cannot be measured from here.
> Production payout slot 1 **is** verified (owner-confirmed); `0 of 5` is a local-fixture fact only.

---

## 1. Audit, with `file:line`, before editing

### 1.1 The full schema of `mission_human_action_tasks`

`db/migrations-mission/0033_human_action_tasks.sql` is the only migration that touches it — no later
`ALTER`, so these eleven columns are the whole table:

| column | type / default | notes |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | `missionId('hat')` in `src/mission/human-action-gate.ts:60` |
| `agent_id` | `TEXT NOT NULL REFERENCES mission_agents(id) ON DELETE CASCADE` | the agent waiting; **cascade delete is a real hazard, see §1.6** |
| `opportunity_id` | `TEXT` | nullable, and `NULL` for every contract-batch entry — the subject is *not* linked by id |
| `action_type` | `TEXT NOT NULL` | free text in practice; the vocabulary is `HUMAN_ACTION_TYPES` (`human-action-gate.ts:30-45`, 14 kinds) |
| `reason` | `TEXT NOT NULL` | truncated to 2000 chars on write (`:66`) |
| `platform_url` | `TEXT` | |
| `status` | `TEXT NOT NULL DEFAULT 'pending'` | comment says `pending\|completed\|expired\|cancelled`; **no CHECK constraint** |
| `notes` | `TEXT` | free text; fleet-readiness overloads it as a signature (`fleet-readiness:%`) |
| `created_at` | `TEXT NOT NULL` | |
| `completed_at` | `TEXT` | |
| `completed_by` | `TEXT` | |
| `updated_at` | `TEXT NOT NULL DEFAULT (strftime(...))` | |

Plus three indexes: `agent_id`, `status`, and a partial index on `(agent_id, status) WHERE status='pending'`.

### 1.2 Every writer

Two, both through `createHumanActionTask` (`src/mission/human-action-gate.ts:53`):

1. `src/mission/earning/agent-class-contracts.ts:296` — one `manual_approval` entry **per prepared batch**,
   `agent_id` = the first agent in the batch, `opportunity_id` NULL, `notes` NULL, and the class recoverable
   only from the reason text: `N scoped contract proposal(s) prepared for class '<class>' and await owner
   approval…` (`:300`).
2. `src/mission/earning/fleet-readiness.ts:589` (`reconcileOwnerActions`) — one entry **per open blocker
   code**, `notes` set to `fleet-readiness:<code>` (`:580`) and reason `[<code>] <label>. Affects N
   agent(s). Free path: …`. These are roll-ups that describe a global gate.

`resolveHumanActionTask` (`human-action-gate.ts:98`) is the only status writer: owner-kind check at `:104`,
`task not found` at `:107`, `task already resolved` at `:108`, then one `UPDATE` (`:114`) to
`completed`/`cancelled` with `completed_at`/`completed_by`/`notes`, and one audit row
`human_action.resolved` (`:118`). Nothing anywhere writes `expired`, and nothing deletes a row.

### 1.3 Every reader

| reader | line | what it does with the rows |
| --- | --- | --- |
| `listPendingHumanActions` / `listAllHumanActions` / `agentHasPendingHumanAction` | `human-action-gate.ts:147`, `:155`, `:163` | the module's own reads — **called by no production code**, only `production-provisioning.test.ts:174` |
| per-agent blocker set | `earning/fleet-readiness.ts:179` | `status='pending' AND (notes IS NULL OR notes NOT LIKE 'fleet-readiness:%')`, `LIMIT 5000` — real per-agent tasks block that agent; roll-ups are excluded so the queue cannot feed itself |
| global activation gate | `earning/fleet-readiness.ts:248`, `:333`-`:345` | `cleared: pendingActions === 0` for `owner_action_pending` |
| per-agent roll-up | `earning/fleet-readiness.ts:447`, `readinessFor` `:386` | pushes `owner_action_pending` on the agent's own blocker list |
| reconciler's own dedupe | `earning/fleet-readiness.ts:581` | reads `notes` of open rows to avoid filing a second roll-up for the same code |
| public app (not the mission console) | `src/routes/boss-dashboard.ts:88`, `:194`, `:301`, `:336`-`:351` | counts, per-agent list, group-by-action counts, and `GET /api/boss/blocked` — **read-only**: there is no POST that decides an entry, and this file is public-app surface, so it was left untouched |

Nothing in `src/mission/server.ts` read the table before this change (`grep` for the table name there: no
match), which is the whole reason the blocker was a dead end.

### 1.4 What each open kind is waiting for, and whether an owner can satisfy it alone

| kind | filed by | waiting for | owner alone? |
| --- | --- | --- | --- |
| `manual_approval` (contract batch) | `agent-class-contracts.ts:296` | the owner to decide the batch of scoped-contract proposals for one class — a grant decision | **Yes.** It is decided by the console's Scoped agent contracts block (`#contracts-block`) or by this queue's Approve, both of which go through `approveAllClassContractProposals`. No agent is needed, and none may decide it |
| `manual_approval`/`account_creation`/`payment_setup`/`tos_acceptance` … (roll-ups) | `fleet-readiness.ts:589` | the *gate* the entry describes: a credential in the vault, a verified payout slot, the autonomy switch, a ready connector | Yes for the ones with a console control (`#slot-form`, `#policy-autonomous`, the vault form); the credential one needs the owner's own secret in the host, so it stays an owner action. Closing the entry never satisfies the gate — the entry is a description, not the thing |
| any other kind | nobody in product code | the 14 kinds in `HUMAN_ACTION_TYPES` are declared, but only `manual_approval` and the roll-up types are ever written; `kyc_verification`, `captcha`, `platform_interview` etc. have no writer | An owner cannot satisfy a `captcha` or `kyc_verification` entry from inside this product at all — no route pretends otherwise. If such an entry existed, this panel would show its reason verbatim, mark the subject unlinked, and record any decision as an **attestation** by the owner who clicked, never as evidence |

### 1.5 Can a task expire, and what happens to the fleet if it does

No. `'expired'` exists only as a comment in the migration (`0033:14`) and as a union member
(`human-action-gate.ts:23`); there is no writer, no sweeper and no timer anywhere for it (`grep` for an
`expired` update on this table: none). Consequences, both directions:

* an entry that is never decided blocks the scheduler for that agent forever
  (`agentHasPendingHumanAction`, `human-action-gate.ts:163`) and keeps `owner_action_pending` open
  indefinitely — which is exactly how production got stuck;
* if someone *did* flip a row to `expired`, `fleet-readiness.ts:179`/`:248` count only `status='pending'`,
  so the blocker would clear **silently**, with no owner decision and no audit row. That is why this slice
  added no expiry and no auto-close: the honest state of an undecided entry is *open*, and the state of a
  decided one is a row whose `completed_by` names the owner. The scoped-contract proposals *do* expire
  (`PROPOSAL_TTL_DAYS`, `agent-class-contracts.ts:402`); when they do, the entry that pointed at them
  becomes `stale` and stays open until a human closes it.

### 1.6 Report-only findings (not changed here)

* `agent_id … ON DELETE CASCADE`: deleting an agent silently drops its queue history. Nothing in the
  mission app deletes agents, so it is latent; it belongs with the agent lifecycle, not with this queue.
* The batch entry has no machine-readable subject (`opportunity_id` NULL, `notes` NULL), so the class is
  read back out of the reason text. The view parses it strictly and falls back to `unlinked` rather than
  guessing; a follow-up should store the class in `notes` at creation.
* There is still **no CLI** for this queue (`grep` of `scripts/` for the table: nothing), and no
  `fleet:readiness` flag resolves an entry. So there is no pre-existing CLI behaviour to reuse or to
  duplicate — the console is now the only door, which is the point.

---

## 2. Built: owner-only resolution, under Approvals

**`GET /api/human-actions`** (`src/mission/server.ts:1715`, behind `requireRead` at `:443`) returns every open entry —
`kind`, `actionLabel`, the `agentId` and any `opportunityId`, the verbatim `reason`, `raisedAt`, and a
resolved `subject`:

* `contract-batch` → the class, how many proposals are **still pending** for it, their ids, and the exact
  `surface` (permissions, contracts, total budget, digest) an approval would create;
* `fleet-gate` → the gate code from `notes`/`reason`, plus its **live** `cleared` state taken from
  `ownerActivationPath()` — never recomputed here;
* `unlinked` → nothing machine-readable exists, so the panel says so instead of inventing a subject.

Each item carries `approveEffect` / `rejectEffect` sentences written before the click, plus `actionable` and
`stale`. `counts` and `blocker.openOwnerTasks` use the readiness rule itself (open, non-roll-up), so the
number on screen and the number in the blocker cannot drift.

**Two owner-only decisions**, both in `src/mission/human-action-queue.ts` and both delegated to the existing
module:

* `POST /api/human-actions/:taskId/approve` (`:319`) — if the entry points at a batch that is genuinely
  pending, the grant goes through `approveAllClassContractProposals`, so the surface digest must be repeated
  back and an empty or over-broad proposal is still refused; then, and only then, the entry is resolved
  through `resolveHumanActionTask`. If nothing is pending, the entry is closed as **stale** and no contract
  row is written. Anything else is closed as an explicit **attestation**, labelled as one.
* `POST /api/human-actions/:taskId/reject` (`:421`) — requires a 4–500 character reason; resolves through
  the same gate function with `resolvedSuccessfully: false`; touches no proposal, no contract, no grant, no
  earning, and records the class's pending count before and after inside the audit detail as proof.

**The console** gained `details.control-block#human-actions-block` (`mission-dashboard/index.html:227`)
inside Approvals, below the contracts block: `#human-actions-note` (the count the blocker quotes),
`#human-actions-list` (one row per entry, with `Approve and grant the batch` / `Close as reviewed` /
`Reject with a reason`), and a hidden `#human-actions-confirm` panel that shows the permission surface in
plain language before a decision is recorded. `app.js` loads it from the Approvals arm of `loadTab`
(`await loadHumanActions()`), and renders `MISSING` with the reason when the read fails — an empty queue and
an unreadable queue are different claims, and only one of them is allowed to look calm.

### What is refused, and how the two identities are told apart

* anonymous → `401` on read and on both writes; a `dashboard:read` **access link** → `200` on read (presented
  through `x-mission-link`, `server.ts:369`), refused on both writes; a mission account whose `role` is not
  `owner` → refused at the owner gate (`assertCanMutate`, `src/mission/auth.ts:206`, or `requireOwner`
  `server.ts:374` when the session no longer resolves). In every refusal above, zero task rows moved.
* **An agent identity never reaches those gates, because it is refused earlier and inside the module.** The
  distinction is the actor's `kind`, not the surface it came through: the route builds
  `{ kind: 'owner', id: session.owner.id }` *only* from a resolved owner session, and
  `requireOwnerActor` (`human-action-queue.ts:252`) throws `owner_required` for anything whose `kind` is not
  `'owner'` — before the task is read, before anything is written — then `assertMoneyOwner`
  (`src/mission/money.ts:24`) re-checks that the row behind that id is an active `role='owner'` account on
  the permitted identity. So the head-agent surface counts as owner **only** when a human owner session is
  what resolved it; a head-agent view of the same queue is the read-only `#head-approvals` panel over
  `mission_approvals`, which cannot and does not decide a task. Anything ambiguous — an `agent:self` link, a
  link with no bound session, a session whose role is not owner, a scheduler or worker actor — is refused,
  and the refusal is itself audited (`human_action.decision_refused`) rather than swallowed.
* There is **no bulk route**: `/api/human-actions/bulk-resolve` and `/approve-all` answer `404`, and the
  client renders no such control. `DELETE` appears nowhere in the module: a decided entry is closed, never
  removed, and its audit rows are appended beside the original filing.
* The grant and the close are deliberately **two** commits, not one transaction: the contract module owns
  the granting unit and its own refusal audit, and folding it into an outer transaction would roll a
  *refusal* away and leave an entry claiming nothing happened. If the close ever failed, the grants would
  stand and the entry would stay open for the owner to close — the reverse (un-granting real permissions
  because a marker could not be ticked) would be the lie. `Reject` is all-or-nothing inside one transaction,
  because nothing else may move with it.

Nothing was fabricated: no task, approval, rejection, earning or completion is written by a timer or a
default. Every row in §3 exists because an owner session asked for it. No dependency was added, no
credential is printed or returned by any of these routes, and no file outside `src/mission/**`,
`mission-dashboard/**`, `scripts/verify-mission-dashboard.mjs` and `docs/` was touched —
`assertInScope`, both approval gates, the owner-only checks and `ZA141251SA_BIND_HOST` handling are
untouched. Measured shape of the diff: seven tracked files, 347 insertions and **6 deletions**, of which
`src/mission/server.ts` is two hunks only (one `import` line, then 43 added lines for the new case) — no
existing line removed anywhere in it. Those six deletions in the whole change are the old
`owner_action_pending` prose in `src/mission/earning/fleet-readiness.ts`, which is what this slice replaces.

---

## 3. Measured, on the local fixture (4,041 agents, real routes)

| step | result |
| --- | --- |
| two batches prepared through the **pre-existing CLI** (`npm run fleet:readiness -- --contracts=bounty_research --limit=3`, then `--contracts=evidence_verification --limit=2`) | 3 + 2 proposals, **2 open `manual_approval` entries** filed, `blockerTasks: 2` |
| `GET /api/human-actions` | `open 2, actionable 2, stale 0, unreadable 0`; each row names its class and its pending count; **3 ms–10 ms** |
| `POST …/approve` with an invented digest | `409 confirmation_surface_mismatch`, nothing granted, entry untouched |
| `POST …/reject` with an empty reason | `409 reason_required`, entry untouched |
| `POST …/approve` with the digest the panel showed | `200 granted_and_closed` — **3 contracts active for 3 distinct agents**, entry `completed`, `completed_by` = owner, note carries the surface digest — **10 ms** |
| `POST …/reject` with a reason | `200 rejected`, the other batch's **2 proposals still pending, untouched** — **4 ms** |
| `GET /api/human-actions` after | `open 0, actionable 0, stale 0`, `openOwnerTasks 0` |
| the real report (`npx tsx scripts/mission-fleet-readiness.ts --json`) before | `remaining: no_platform_credential no_payout_slot_verified autonomy_disabled no_scoped_contract no_active_money_grant owner_action_pending` |
| the same report after | `remaining: no_platform_credential no_payout_slot_verified autonomy_disabled no_active_money_grant` — **`owner_action_pending` and `no_scoped_contract` are gone**, and the entry now reads `already satisfied: no agent-specific owner task is open` |
| durability of the queue rows | tasks: 1 `completed`, 1 `cancelled`, **0 deleted**; audit: 2 `human_action.created`, 2 `human_action.resolved`, 1 `task_rejected`, 1 `task_resolved_with_grants`; `mission_audit` 61 rows, `MAX(seq)=61` — no gap, chain verified at boot (`audit chain verified (51)` → 61) |
| live console harness | **62/62** twice — once with an empty queue, once with 1 open entry rendered as 1 row with 1 decision control offered and 0 pressed, and a refetch proving the render wrote nothing |
| live login harness | **12/12** |

**The blockers that remain after this change are honest, not broken by oversight**:
`no_platform_credential` (the owner's secret lives in the host), `no_payout_slot_verified` (in this fixture;
production slot 1 is verified), `autonomy_disabled` (a switch the owner must flip, default off), and
`no_active_money_grant` (per-agent, granted by registry sync at zero spend). **None of them requires an
agent that requires the fleet**, so the circle the queue formed is broken. The remaining `no_execution_backend`
gate for `bounty_execution` is not in that list only because no agent in this fixture holds that class; it
still needs a pinned OCI image, which is an owner/infra decision, not a queue decision.

---

## 4. Validation

| gate | result |
| --- | --- |
| `src/mission/mission-human-action-queue.test.ts` (new) | **15 / 15** |
| the 11 suites that pin this surface (queue, contracts console, class contracts, fleet readiness ×2, specialist fleet, server, owner overview, bare, nav, overview read path) | **161 / 161**, 0 failed — re-measured after the citation edits below |
| the same set plus `src/app/mission-gateway/proxy.test.ts` (the gateway's deep-equal `src|href` pin) | **179 / 179**, 0 failed |
| whole mission + gateway sweep (`find src/mission src/app/mission-gateway -name '*.test.ts'`, 25 suites) | **1643 / 1643**, 0 failed, 0 cancelled, 0 skipped, 0 todo, 178 s |
| live console harness `scripts/verify-mission-dashboard.mjs` | **62 / 62** (8 new read-only records for the queue) |
| live login harness | **12 / 12** |
| `npm run typecheck` | rc 0 |
| `npm run build` | rc 0 (Next.js prerender completed) |
| `npm run scan:secrets` | **PASS** — "no real secret markers found in the working tree (22 allow-listed synthetic placeholders)" |
| `git diff --check` | rc 0, no whitespace errors |

### 4.1 Sensitivity — one file reverted at a time

`/tmp/sensitivity6.py`: for each file in the change, back it up, revert it (tracked files to `c926fd9`;
the two new files moved out of the tree), run the 11 pinning suites, count failures, restore, and compare
sha256. Baseline with everything in place: **161 tests, 0 failing**. Each row is one revert, alone.

| file reverted, alone | failures collected | what it proves |
| --- | --- | --- |
| `src/mission/human-action-queue.ts` (moved out) | **4 failing, of only 83 tests collected** | the module is what the server imports, so its absence stops two suites from loading at all — the queue suite cannot start and `mission-server.test.ts` dies on the dangling import; of what still ran, the activation citation test fails on the `#human-actions-block` line it cites |
| `src/mission/server.ts` (route removed) | **13 failing of 161** | every route-level claim depends on the new case: the queue's 401/403/link/200 tests, the read/write split, `DASHBOARD_ROUTES`, `OWNER_ONLY_MUTATIONS`, the activation test's "a real route stands behind it" |
| `src/mission/earning/fleet-readiness.ts` (old blocker prose) | **1 failing of 161** | the blocker's own text is pinned: `how: 'dashboard control'`, the `#human-actions-block` target and the evidence line |
| `mission-dashboard/app.js` (no panel code) | **5 failing of 161** | the loader arm, both verbs' fetch, the confirm panel and its wiring are each asserted |
| `mission-dashboard/index.html` (no markup) | **5 failing of 161** | `#human-actions-block` / `-list` / `-note` / `-confirm` anchors and the "closed, not a nav entry" rule |
| `scripts/verify-mission-dashboard.mjs` | 0 failing of 161 | honest: no unit suite runs the live harness. It is covered by **62/62** measured against a running server (§3) |
| `src/mission/mission-server.test.ts` | 0 failing of 161 | a test-only revert: the code still behaves, the *pins* for the new route are lost — that is what the pin file is for |
| `src/mission/earning/fleet-readiness-activation.test.ts` | 0 failing of 161 | same |
| `src/mission/mission-human-action-queue.test.ts` (moved out) | 0 failing of 146 | exactly 15 tests disappear (161 → 146) and nothing else notices — the rest of the mission is not coupled to this suite's internals |

`ALL RESTORED` — every one of the nine files byte-identical (sha256) to its pre-revert state — and the
re-stated tree measured again afterwards: **161 tests, 0 failing**.

---

## 5. The owner's exact steps, in the console

1. **Approvals** tab → expand **Human-action queue — what the fleet is waiting on (owner only)**
   (`#human-actions-block`). The first line states `N owner task(s) open` — the same number
   `owner_action_pending` quotes, so the panel and the blocker can be compared before acting.
2. Read a row: **Kind**, the **agent** it was filed for, **Subject** (`scoped contracts · <class>` with its
   pending count and proposal ids, or `fleet gate · <code>` with the gate's live state), **What it is waiting
   for**, and when it was raised (`raisedAt`).
3. For a row that says `Approve and grant the batch`, press it. A panel appears with the permission surface
   — contracts count, permissions in sentences, total budget, the `never granted` line, and the digest.
   Press **Confirm and record the decision**. That is the grant: 3 contracts became active in the measured
   run. A stale digest answers `409 confirmation_surface_mismatch` and grants nothing.
4. For a row labelled `stale — closable by the owner, never auto-closed`, press **Close as reviewed**. No
   contract row is written; the entry closes with `closed as stale …` recorded against it.
5. To defer, press **Reject with a reason**, type 4–500 characters, and submit. The entry is cancelled with
   the reason stored on the row and in one audit entry; every proposal it pointed at stays pending, and the
   class stays mid-review, so the fleet remains blocked on the requirement rather than on the marker.
6. Re-read: the note falls to `no owner task is open — the fleet is not waiting on this queue`, and
   `npm run fleet:readiness` (or the Overview's activation list) no longer lists `owner_action_pending`.
   Reconcile runs (`--reconcile`) will not re-file a roll-up for a code whose gate is cleared, and the
   roll-up entries it does file are excluded from this count by design, so the queue cannot manufacture its
   own blocker.
7. Still owner-only, still outside this queue: the credential in the host secret manager, the payout slot
   verification (`#slot-form` + `#slot-verification`), the autonomy switch (`#policy-autonomous`, default
   off), and — for `bounty_execution` — a pinned execution backend. Each keeps its own line in the
   activation list with a control or a variable name, and none of them can be ticked from the queue panel.

## 6. Deliberately not done

* No expiry, no sweeper, no auto-close, no bulk resolve, no scheduled reconciliation of decisions.
* No `DELETE`: the row survives its own resolution, and `agent_id … ON DELETE CASCADE` is left as it was
  found (a latent hazard in the agent lifecycle, not in this queue).
* `src/routes/boss-dashboard.ts` (public app) is untouched — including its read-only `GET /api/boss/blocked`.
* The subject of a batch entry is still parsed from the reason text, because that is all the pre-existing
  writer stored; the follow-up is to write `notes` at creation and read the id back, not to keep parsing.
