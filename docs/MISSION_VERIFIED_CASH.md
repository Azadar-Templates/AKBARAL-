# ZA141251SA verified cash and governed workforce

## Status and scope

Implemented architecture, not an activated wallet or an earnings claim. A ledger is
not a bank account. The private mission database owns all new tables; no customer
billing tables or public payment keys are imported.

The `mission_cash_*` ledger is the sole source for the new real-money payment
engine. It starts at zero. Migration 0016 preserves legacy accounting but freezes
previously funded legacy wallets. It does **not** copy owner-entered deposits,
legacy revenue, targets, registry counts or simulated test funds into verified cash.
The old funding, received-revenue, expense-payment and payout-settlement HTTP paths
are refused, including the legacy financial approval alias. Legacy reports remain
historical, owner-reported accounting, not verified bank cash.

## Invariants

- Integers in minor currency units; no implicit currency conversion.
- Available and held balances are separate and nonnegative. Allocation conserves
  cash; budgets, permissions, targets and opportunities never create money.
- All ledger transitions, their hash-chain entries, operation state and audit
  records commit together. Cached balances are reconciled against the ledger.
- SQLite write transactions and mission-scoped PostgreSQL advisory transaction
  locks serialize competing reservations, receipt credits and allocations.
- Only a trusted server-side payment adapter can return normalized financial
  evidence. JSON from a browser cannot specify a trusted provider or completion.
- Receipt IDs are unique per provider. Payment idempotency keys bind request
  contents. Outgoing operations have stable provider idempotency keys.
- Local reservation/settlement is exactly-once. Distributed network execution is
  **not** represented as an unconditional exactly-once guarantee: after an
  uncertain send or crash, funds stay held and the operation is reconciled with
  read-only provider lookup. There is no automatic second payment POST.
- `pending`/`in_transit` are not completed. Failure releases funds only after the
  adapter proves failure/return. A timeout, missing search result or parse error
  never refunds a hold. A reservation can be owner-cancelled only before dispatch.
- Refunds reference completed operations, cannot exceed their recorded debit, and
  are idempotent. Reversals of received earnings freeze execution, debit available
  cash and retain any uncovered amount as a separate nonnegative liability.
  Later receipts service liabilities before funds become available. Never erase
  a liability by resetting an account or inventing an opening balance.
- Freeze cannot undo an external request already accepted by a provider.
  Reconciliation remains allowed while frozen; new sends are blocked, including
  a final authorization recheck immediately before Stripe submission.

## Workforce/RBAC

`mission:sync-registry` provisions each imported agent's unique verified-cash
sub-ledger and finite, expiring money grant. Owner `POST /api/money/bootstrap`
backfills existing mission agents. These permissions allow governed earning and
expense requests, **not** owner decisions or arbitrary bank access.

Every agent begins with zero cash and zero spend authority. Unassigned agents are
explicitly blocked. An owner must approve a real opportunity with an evidence URL,
lawful activity and supported provider, then assign it via a grant. Owner review
of a listing is not provider proof of earnings or permission to violate its ToS.
There is no invented list of 4,001 jobs. Multiple agents may participate only where
real opportunities and provider permissions allow it.

Agent-created children require the parent's explicit creation permission,
available delegation budget, enabled mission policy, depth/child/total limits,
and active ancestry. Delegation consumes the parent's finite delegation pool.
Children inherit at most the delegated spend ceiling and parent expiry, start
unfunded, and do not inherit creation authority. Parent revocation disables
inherited authority. Explicit owner-created grants remain owner-controlled.

Owner standing `autoAllocateCents` is opt-in (default zero), bounded by the grant.
The scheduler replenishes the agent only from available verified treasury cash and
within remaining lifetime authority. Funding is not spending. Every spend also
checks current global daily and transaction limits, wallet freeze and approval.
Property, account creation and upgrades always need explicit owner approval;
withdrawals always need approval and a verified configured payout destination.

## APIs (private mission only)

GET `/api/money` — owner cash accounts, pending/completed operations, grants,
opportunities, liabilities, freeze and integrity. GET `/api/money/ledger` accepts
`after` sequence and `limit` (1–1000), for complete ledger pagination. GET `/api/money/operations` pages by opaque operation ID
(`after`, `limit`). An authenticated `agent:self` link can read only its own cash
account, grant, jobs, operations and ledger entries; it cannot read fleet state.

POST `/api/money/{action}`:

| Action | Body fields | Authority |
| --- | --- | --- |
| bootstrap | none | Owner |
| opportunities | title, evidenceUrl, activity, provider | Owner review |
| revoke-opportunity | id | Owner; new execution stops, settlement remains reconcilable |
| grants | agentId, spendLimitCents, delegationCents, canCreate, expiresAt, status, opportunityId, autoAllocateCents | Owner |
| allocate | agentId, amountCents, idempotencyKey | Owner |
| freeze | accountId, frozen | Owner |
| request | kind, agentId (expense), provider, destination, category, amountCents, maxCostCents, idempotencyKey | Bound agent or owner; withdrawal owner only |
| decide | id, approve | Owner |
| cancel | id | Owner, unsent only |
| receipt | externalId | Owner; fixed adapter re-fetches provider evidence |
| dispatch | id | Bound agent or owner; all policy rechecked |
| reconcile | id | Owner; read-only provider lookup |
| earn | agentId, idempotencyKey, costOperationId (optional) | Bound agent or owner |

Expense categories: api, tool, hosting, storage, account, property, upgrade.
Categories are accounting/authorization types, **not claims of vendor API support**.
A spending request to an unsupported provider is not dispatched. Bounded scheduler
pages rotate blocked/uncertain records so one unsupported provider does not
permanently prevent other eligible agents from being serviced.

The Verified cash dashboard provides balances, holds, operation states, owner
commands and full state inspection. Existing kill-switch controls remain effective.

## Providers and automatic execution

`MoneyProvider` and `EarningProvider` are trusted code interfaces, not user-supplied
URLs or runtime plugins. `runEarning` claims a durable job once, records delivery,
waits for provider-verified available funds, then credits the treasury. The worker
reconciles delivered/unknown earnings through read-only lookup, including while
frozen or after opportunity revocation; it never repeats delivery. Payment
references bind durably to one earning job. Existing credited income can complete
that job without a second credit. Adapters receive a final authorization callback
and AbortSignal; they must check the callback immediately before external
mutation and respect cancellation. The worker bounds its wait even if an adapter
ignores cancellation, but cannot undo a provider side effect. Uncertain
work is never replayed automatically. Confirmed cost operations can authorize the
next earning job. `moneyWorkerTick` reconciles uncertain payments, applies standing
allocations and executes eligible queued work/payment operations.

The opt-in `mission:money-worker` registers **only** the included mission Stripe
adapter. No real marketplace delivery connector is registered. No agent can claim
that unimplemented earning work ran. Install/connect a legitimate earning adapter
before enabling those jobs; merely adding an opportunity URL is insufficient.

### Implemented Stripe adapter

Uses only fixed `https://api.stripe.com/v1/` endpoints, authenticated server-side
GETs/POSTs, bounded responses, timeouts, no redirects, no SDK payload logging.
Requires a dedicated live mission account, submitted details, charges/payouts
capabilities and manual payout scheduling. Incoming charge metadata must identify
ZA141251SA and its real mission agent. It accepts **available net funds**, rejects
pending/test/nonmission/refunded/disputed charges, and checks account balance
coverage. Receipt verification must be reconciled before accepting income when
outstanding operations or out-of-band movements make balance coverage uncertain.

Supports mission-owned bank withdrawals, with verified configured destination,
provider-side external-bank verification and payout/transaction binding.
It does **not** use Stripe Connect transfers as a way to pay arbitrary vendors,
buy property, or sidestep financial restrictions.

Mission-only environment names:
- ZA141251SA_STRIPE_SECRET_KEY
- ZA141251SA_STRIPE_ACCOUNT_ID
- ZA141251SA_MONEY_WORKER_ENABLED

Never reuse AKBARAL's Stripe account/key. Keep keys in the private deployment's
secret store. Do not put them in requests, Git, audit notes or dashboard JSON.
The production adapter refuses Stripe test keys; deterministic tests inject a
fixture transport and do not connect to Stripe.

## Real-money activation blockers

1. Dedicated, eligible mission legal/business payment account; actual KYC/AML,
   sanctions/ToS/tax review, owner identity and payout destination verification.
2. Live credential and account binding, required endpoint permissions, manually
   scheduled payouts, then a deliberately approved low-value live receipt,
   payout, failure and refund/reconciliation test. API fixtures are not live proof.
3. Real opportunity inventory and owner assignments for the fleet. Current source
   does not establish 4,001 actual earning contracts.
4. Concrete ToS-compliant earning/delivery connectors for chosen marketplaces or
   clients. None is fabricated or silently substituted by this release.
5. Vendor-specific payment/billing adapters for APIs/tools/hosting/storage/accounts/
   property/upgrades. Their contracts and state machine are implemented, but
   **Stripe withdrawals are the only included outgoing live payment adapter**.
   Each vendor needs real authorizations, bounded pricing and verifiable financial
   settlement. Existing resource-usage receipts are not automatically financial
   receipts and are not used to manufacture verified cash.
6. Out-of-band transfers, disputes and fees require reconciliation. Unsupported
   provider event types remain blocked/manual-review; do not enable broad
   autonomous financial activity until the provider's complete event lifecycle is
   covered and tested. Legacy resource-budget accounting is not automatically
   migrated into this cash system.
7. Persistent private hosting, backups, restore drill, monitoring of held/unknown
   states, secret rotation and real PostgreSQL deployment/load verification.

No account creation, provider calls, payment, withdrawal, hosting purchase or
provider activation is performed by migration, tests or this documentation.
`verify:mission-money` is now a read-only accounting inspection after login; it
never manufactures a deposit or mutates the money policy to make a probe pass.

## Verification

- `npx tsx --test src/mission/money*.test.ts`
- `npx tsx --test --test-concurrency=1 src/mission/*.test.ts`
- `PG_TEST_DATABASE_URL=<isolated database> npx tsx --test src/mission/money.test.ts`
- `MONEY_CONCURRENCY_DATABASE_URL=<separate isolated database> npx tsx --test src/mission/money-concurrency.test.ts`

Use empty disposable databases. Fixtures are explicitly synthetic and never loaded
into a production ledger. Tests cover actual multi-process SQLite/PostgreSQL
contention; these are not provider settlement tests or internet hosting proof.

### Local verification checkpoint (2026-09-20)

229 mission tests passed on SQLite; 25 cash-core tests passed on native PostgreSQL
18.4 (the explicitly synthetic 4,001-agent fixture is SQLite-only). Four actual
cross-process cash races passed on each database engine. Eleven Stripe transport
fixture tests passed, including late payout returns; no real provider was called.
Typecheck, secret scan and production webpack build passed. Chromium desktop and
mobile-viewport checks passed, including zero-funded Verified cash UI and owner
controls, with no external requests. A late failed-payout return is accepted only
for its bound, previously completed operation and verified return transaction;
this does not constitute general dispute/fee reconciliation coverage.

### Legacy runtime spending boundary

The legacy ledger/resource modules remain historical accounting and quota
bookkeeping; their owner-reported costs are never imported into verified cash.
Auditing runtime provider call sites found that the old Google chat worker could
use those legacy budgets. Its production entry point and default dispatcher now
**refuse live execution before reserving quota or contacting Google**, with
`verified_vendor_billing_not_configured`. Enabling the chat-worker environment flag
alone cannot bypass this. The Google response parser and explicit fixture adapters
remain regression-tested; they are not evidence that paid Google billing works.
A genuine vendor billing/prepaid-credit adapter must be implemented and connected
before restoring live chat execution. Social OAuth exchanges handle authentication,
not payments. Stripe is the only runtime financial adapter currently registered.

The owner cash view explicitly reports NOT LIVE-VERIFIED and the missing earning
and vendor billing connectors. These are release-level blockers, not credential
presence checks masquerading as live-provider tests.

### Follow-up verification checkpoint (2026-09-20)

After scoped cash reads, earning reconciliation, opportunity revocation, scheduler
fairness and the legacy chat billing guard: 236 mission tests passed on SQLite;
30 cash-core tests passed on native PostgreSQL (one synthetic fleet test skipped).
The four SQLite race tests were rechecked in the focused 35-test run. The last
native PostgreSQL four-race run passed at the preceding checkpoint. Typecheck,
secret scan, production webpack build, and Chromium desktop/mobile checks passed;
subsequent scheduler-only edits were rechecked by typecheck and core tests on both
engines. The enabled chat-worker entry point was also exercised and refused
startup without contacting a provider. No deployment or real-money test occurred.

### Demonstrated CI regression corrected

Docker publish run 35470502749 built and published its image and verified its
commit stamp, then failed the PostgreSQL JSON translation check. That check was
still grepping the old `database.js` facade after translation moved to `driver.js`.
It now executes assertions against the compiled driver's actual SQL translation;
the same probe runs in Verify. The probe passed locally without opening a database.
Container execution remains CI evidence, not a claim of a running deployment.

## Follow-up hardening after 4d6d7fe

- Registry synchronization now uses one transactional metadata-only importer. It
  enforces the owner agent ceiling before inserting anything, rejects collisions
  with independently created mission identities, hashes the full slug, preserves
  pause/revocation/freeze state, and commits its audit with the import. The test
  imports all 4,001 definitions from the existing catalog into a disposable
  database; these are accounting identities, not invented bank wallets or jobs.
- Agent-scoped Factory child creation is now actually reachable through the
  authenticated parent endpoint. Explicit `canCreate`, finite delegation, active
  ancestry, expiry, child/depth/fleet limits and policy are required. Failed
  creation rolls back identity, contract, legacy wallet and verified subledger
  together. Owner-created agents still start with zero cash and spend authority.
- Paused agents can read their own money data while all mutations stay blocked.
  `/api/money/jobs?after=<id>&limit=<1..1000>` provides scoped job pagination.
- Delivered jobs with a stored payment reference can be reconciled without the
  delivery connector. Owner `POST /api/money/reconcile-earning {id}` fetches only
  the recorded provider reference. No body amount, note or status can supply
  payment evidence. Unknown jobs without a reference still require the original
  delivery connector's read-only lookup. Queued jobs cannot be reconciled into
  fictitious delivery. Reassignment blocks old queued execution but cannot erase
  already delivered earnings; receipt settlement uses the durable job assignment.
- Withdrawals enforce destination minimum/maximum bounds in addition to global
  policy. Only the owner may request or manually dispatch them; agent attribution
  is rejected. Approved worker dispatch remains owner-authorized, with a final
  pre-send identity/policy/destination recheck. Approval does not confirm payment.
- Paid legacy upgrades cannot be approved or applied through either old HTTP
  alias. Resource provisioning/cost/renewal notes remain explicitly owner-reported
  historical accounting (`providerVerified: false`, no external payment); they
  cannot credit verified cash. The historical treasury, resource and reporting
  modules have no access to the verified receipt/settlement engine. Runtime and
  source-boundary regressions protect that separation. Historical accounting is
  not represented as an active payment adapter.

No live keys, opportunities, confirmations or financial balances were inserted by
these changes. Production registry import/bootstrap and real-provider activation
remain owner operations against real configured services, not test side effects.

### Deficit race closure

An additional fault-injection regression demonstrated a check-before-lock race in
unfreezing: a concurrently committed reversal could arrive after the old liability
check. The solvency check now runs inside the same financial transaction as the
unfreeze. Allocation and payment capacity also independently reject every
unresolved provider deficit, so stale freeze/kill-switch flags cannot authorize
spending. Both negative cases failed before the fix and pass with it; no live
provider or customer data is involved.
