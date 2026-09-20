# Freelancer phase 2 — verified receiving controls, not live activation

2026-09-20. Supersedes the phase-1 statements that payout/readback controls and
cash-bridge commands are unimplemented. **Concrete file-readback, remittance and
receiving-provider adapters remain absent. Runtime factories install none.**
This is a fixture-tested trust boundary and lifecycle implementation, not proof
of provider API access, KYC, a real client contract, delivery, income or production
readiness. All fixtures run in explicitly isolated test databases.

## Recovery and preserved history

The requested `9cbbb9d` is an intact ancestor, not the newest checkpoint. Recovery
found clean, pushed `07f59b0`, including the later retry-default fix `65adbef`.
`git fsck --full --strict` passed and origin matched HEAD. The previously retained
full suite was **already complete: 1,102 tests / 110 files**, fingerprint
`c0c96627e8500ec2973f17df0a73e2682a66f1b81c87b78017fa1ef96258359d`.
Invoking the resumable runner validated its saved snapshot/log hashes and returned
complete **without rerunning any test file**. There was no unfinished file to
resume and no justification to reset to the older checkpoint.

No current sandbox failure was reproduced: disk had 4.6 GiB free (78% used),
inodes 1% used. The earlier retained logs demonstrate disk exhaustion caused by
redundant test working copies. The subsequent regression failure was the missing
retry delay being parsed as zero; that was already fixed and tested. These are
verified execution failures, not a claim to know Arena's internal UI error cause.
No recovery cleanup was needed; source, commits, logs, verification snapshots,
failed-run databases, migrations and production artifacts were left intact.

## Implemented controls

### Existing authorized work

Phase-1 self-account checks, manual KYC/eligibility attestation, accepted award,
funded USD milestone, exclusive identity/project bindings, expiring grant checks,
immutable owner hash approval, final send guard and upload evidence remain.
Bidding, acceptance and fee-bearing actions remain manual; no new spending,
withdrawal, account-creation or auto-bidding methods were added.

New assignments create an owner-reviewed money-opportunity **only after** genuine
provider contract verification. This is provenance, not a balance or worker
activation. Phase-1 rows remain unchanged unless the owner explicitly authorizes
their historical provenance after confirmed delivery/milestone clearing.

### Read-only uncertain-delivery recovery

`FreelancerFileReader` must authenticate the stored file's project, sender,
recipient and actual downloaded bytes. Metadata/file name alone is insufficient.
The workflow verifies file ID, byte length, SHA-256, owner-approved content,
account/project identity, fresh verification and original dispatch window.
Null, missing, stale, mismatched and unauthorized results remain blocked. Recovery
never re-POSTs, resets a dispatch claim or permits a new upload. Readback can record
an already-completed effect after grants are revoked, but grants no new authority.

For a crash without an end event, matching file creation is conservatively bounded
to 90 seconds after the stored dispatch claim (+1 second timestamp tolerance).
No live file reader is installed. An authenticated, host-allowlisted content
readback adapter must still be implemented/validated against the real account's
supported file retrieval contract. No invented retrieval endpoint is claimed.

### Provider payout evidence

`FreelancerRemittanceReader` is a trusted **server-only** read contract, not an
invented Freelancer endpoint or caller-provided financial schema. It must verify
an authoritative, complete provider payout/remittance with account/payout identity
and genuine project/bid/milestone line itemization. Supported scope is 1–10 lines,
USD only, exact minor units, gross minus verified provider deductions equals net.
Duplicates, omitted/unattributed work, partial batches, FX and guessed allocations
fail closed. Pending/paid source observations are durable evidence but never cash.

### Independent USD receiving verification and mission wallet

A separate `FreelancerUsdReceiver` must independently verify the actual
mission-owned receiving-account credit, source-provider account and payout
matching, settled/available USD, gross/receiving fees/net and receiving balance.
Bank memos, manually uploaded statements, owner attestations, platform balances,
milestone release or signed caller JSON alone cannot implement that verification.

Before credit, every remittance item is rechecked against a delivered, owner-
approved contract and a fresh, undisputed provider-cleared USD milestone. The
recorded work/version/hash cannot change during receiving verification. Every
work item binds to one payout; provider payout and physical receiving-movement
identities are permanent. Financial fingerprints exclude mutable observation
metadata but include exact amounts/fees/identities. Repeated and concurrent reads
cannot create duplicate cash. Complete two-contract payout fixtures are covered.

Only the shared money engine writes cash. Proof admission, payout/work bindings,
earning-job provenance and net cash entry commit atomically under its existing
financial lock. Failure rolls back cash/jobs/bindings together. The treasury
receives net USD, not the agent sub-wallet. Agent allocations, operating expenses
and owner-approved withdrawals remain separate existing controlled operations.
Already-earned settlement can be received after grant revocation/kill switch;
this never restores spending or delivery authority.

Physical `incoming:<sha256>` and `reversal:<sha256>` receipt keys are now globally
deduplicated across receiving connectors, not merely within each provider ID.
Ordinary provider-local receipt IDs retain their existing namespace behavior.
A receiving balance below pooled recorded USD causes conservative review; mixed-
rail pooling can therefore block a legitimate credit rather than invent solvency.

### Uncertainty and reversals

External verification is bounded, abortable and snapshotted inside a sanitized
error boundary. Financial evidence must be fresh at admission. Late callbacks,
raw provider error bodies and exception-throwing proof getters cannot book funds
or leak credentials. Reconciliation sends no external financial mutation.

Changed or unavailable evidence after booking freezes treasury/agent access for
review; it does not invent a chargeback. Confirmed reversals require independent
receiving debit proof bound to the original transfer and a distinct movement ID.
Reversals are idempotent and cumulatively capped at the original net settlement.
Reserved funds are preserved; any uncollectible amount becomes the existing
nonnegative liability and engages existing freeze/kill protections. Reconciliation
does not automatically clear a review freeze or unblock spending.

## Owner-only API additions

All commands inherit private owner authentication and mutation CSRF controls.
They accept identifiers, **never evidence objects, settled flags or amounts**.

- `POST /api/freelancer/reconcile-delivery`: `workId`, `fileId`.
- `POST /api/freelancer/observe-payout`: `payoutId`.
- `POST /api/freelancer/authorize-historical-settlement`: `workId`.
- `POST /api/freelancer/reconcile-payout`: `payoutId`, `externalId`.
- `POST /api/freelancer/reconcile-reversal`: `payoutId`, `reversalExternalId`.
- `GET /api/freelancer`: nine-stage implementation status plus explicit settlement
  configuration blockers and observed payouts.

The runtime factory has **no installed remittance/receiving/file-readback
adapters**, regardless of whether the existing Freelancer credential names are
set. No fake `MoneyProvider` or earning adapter was registered in the background
worker. Credentials alone do not activate cash admission.

## Verification and remaining boundaries

- **227 focused tests passed**, including 53 settlement, 30 work/readback,
  13 Freelancer client, 41 cash, 32 Awin workflow, 37 owner API, 13 configuration,
  and 8 resumable-runner tests.
- Native PostgreSQL: **53 settlement + 30 work/readback + 40 cash + 32 Awin = 155
  passed**. One pre-existing SQLite-only 4,001-ledger bulk test is skipped on PG;
  it passed in the focused SQLite cash suite.
- Native `--test-force-exit` attempts produced truncated test counts and were
  **not accepted as full verification**. Fresh disposable databases and normal
  Node test execution completed every test. Verification databases/logs retained.
- Typecheck, backend compilation, secret scan and diff checks passed.
- No real provider traffic, work, payout, settlement, cash entry, deployment or
  worker activation occurred. Test settlement amounts are synthetic only.

Exact live blockers: genuine provider account/token with eligibility/KYC/tax and
platform/client permissions; an actual accepted USD contract/funded milestone;
real approved deliverable; supported authenticated file-content reader for
uncertain-upload recovery; authoritative itemized payout/remittance reader; a
selected mission-owned USD receiving rail/account and independent credit/reversal
adapter; provider-specific live acceptance. The latter integrations require more
than credentials. No country-specific USD withdrawal approval or fee quote has
been verified. No account/agent-count inflation or income guarantee is implied.

## Disk-safe future regression runs

`npm test -- --prune-working-copies` opts into deleting only a **completed test
subprocess's redundant mutable `working.db`**, after its `passed.db` snapshot and
TAP log hashes are verified and its checkpoint is saved. Snapshots, logs, metadata,
failed/interrupted databases, source, commits and production artifacts are never
removed. The runner still validates all retained evidence on resume. This avoids
recreating the original disk-exhaustion failure without erasing verification.

### Integrated-run reporting defect caught before acceptance

The first changed-source integrated run reported 111 files but only 1,147 tests:
its forced process exit omitted 17 settlement and 5 cash test results. This is
**not accepted as a complete regression**, despite the zero process exit code.
Its logs/snapshots remain untouched. The test runner now awaits normal completion;
12 runner tests cover retention, resume, lossless compression, corruption and the
prohibition on forced exit. A new final source fingerprint is required.

To retain every prior verification database/snapshot while performing that new
run, only the disposable npm download cache from completed installs was removed
(about 250 MiB; installed dependencies, lockfiles, npm logs/configuration and
production artifacts untouched). New test snapshots can be stored losslessly in
Brotli form instead of consuming another four GiB; no existing snapshot is
rewritten or deleted. The plain SQLite image hash is verified before temporary
capture cleanup and again on restore. This follows the user's preservation rule
rather than deleting old verification evidence to make room.
