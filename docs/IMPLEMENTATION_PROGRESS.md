# Implementation after the reconstruction checkpoint

Continuation starts at `dff2553` on `arena/01a0ba0a-akbaral`. Historical evidence remains in [CURRENT_SOURCE_OF_TRUTH.md](CURRENT_SOURCE_OF_TRUTH.md). This is an implementation record, **not a production-completion claim**. No provider credentials, real payments, fabricated opportunities, or autonomous production activation are introduced.

## Phase 1 — platform economy financial atomicity (2026-09-19)

Implemented:
- Shared synchronous financial transaction boundary: SQLite writer serialization and PostgreSQL transaction-scoped advisory locks, with separate platform-economy / standalone-mission namespaces. Network operations must remain outside transactions.
- Atomic platform revenue + ledger + audit writes; delivery receipt claims and credits commit together. Duplicate external receipt references cannot fund two deliveries through these entry points.
- Serialized transfer/reinvestment proposal and approval decisions, including final rejection when the balance has been depleted. Withdrawal freeze is rechecked at approval.
- Atomic settlement/resource mutation entry points; resource provisioning rechecks remaining realized funds and refuses a price above the approved quote. Provisioning evidence is retained in the event details.
- Positive safe-integer revenue/transfer/reinvestment amounts and nonnegative safe-integer ledger/resource costs.
- Regression coverage for injected failures after ledger, receipt, and audit writes; replay; competing allocations; late withdrawal freeze; duplicate receipts; invalid amounts and increased resource prices.
- Separate-process SQLite races: only one receipt claimant succeeds; competing allocations cannot overdraw the same surplus. These are genuine separate local processes, not sequential calls labelled concurrency.
- Financial engine-neutral tests added to the PostgreSQL CI command.

Measured validation:
- Existing full SQLite suite plus initial new regressions: **810/810, 114 suites, 87 files, no failures or skips**. The two process-race tests were added after that run's file list was captured.
- Final focused SQLite run: **9/9**, including both process-race tests and the corrected isolated-fixture bootstrap.
- PostgreSQL financial regression run: **7/7**, no skips (PGlite wire-protocol harness). This checks the PostgreSQL transaction/lock code path; it is **not a multi-backend production PostgreSQL load test**.
- Typecheck and secret scan pass. Reconstruction checkpoint remote verification and Docker runs both completed successfully.

Testing notes: initial direct economy-suite attempts lacked its seeded-registry precondition; those failed runs are not reported as successes. The complete repository test command subsequently passed. The new process-race test exposed a late environment-bootstrap mistake in its fixture setup; explicit delayed module loading fixes it and both races pass. Tests use synthetic funds only.

## Continuing work (not completed by Phase 1)

1. Standalone mission wallet/revenue/expense/payout atomicity and hash-chain serialization; payout evidence, source-wallet and currency invariants.
2. Assignment and permission enforcement through discovery, authorization, dispatch, reassignment, execution and delivery; fail-closed deliverable checks and exact cost attribution.
3. Real-evidence opportunity ingestion and bounded expansion toward the target, without turning catalog candidates into verified earning work.
4. Owner command/chat/work/wallet/withdrawal views and explicit evidence/status distinctions.
5. Provider credential/quota/expiry/resource lifecycle and funding integration.
6. Final PostgreSQL, build, browser/mobile and end-to-end checks for subsequent phases.
7. External account enrollment, provider credentials, domain/deployment configuration and actual payment-provider actions remain operator-dependent. Local tests cannot prove those actions occurred.

**Fund separation is unchanged:** no customer wallet/credit balance is used to fund private economy or standalone mission work. There is no claim of 4,001 live workers, one million verified opportunities, actual income, or completed withdrawals.

## Phase 2 — standalone mission finance and payout evidence (2026-09-19)

Implemented and locally tested:
- Mission transactions take the mission-only PostgreSQL advisory lock at their outer boundary; wallet/ledger/audit, revenue sweeps, reserve allocations, expenses, payout reservations/refunds and destination verification changes are atomic. Nested operations retain savepoint behavior.
- Safe-integer minor units, overflow checks, replay-payload validation, typed ledger replay results, duplicate source receipt rejection and explicit currency matching. Internal reinvestment transfers no longer inflate operating-spend counters; allocation requires its original received-revenue record.
- Agent expense requests cannot select the treasury/reserve or another agent's wallet. Approval rechecks current spend policy; wallet freezes also block direct debits.
- Append-only migration `0008_payout_binding.sql` binds payouts to their source wallet, destination fingerprint and masked/provider-reference snapshot. Failed reservations refund their actual ledger source, exactly once, rather than whichever treasury sorts first.
- Payout approval checks current kill switch/caps, source currency, unchanged destination and nonexpired documentary verification. Runtime gates no longer rely on the verification sweeper or dashboard status. Empty HTTP verification is refused; existing valid-flow tests now submit explicit synthetic control-check attestations instead of the insecure status-only shortcut.
- Settlement records require nonblank provider references; sent references cannot change and cannot be reused for another payout. Failure/refund requires failure evidence. These remain owner-recorded evidence, **not an implemented bank/payment-provider execution adapter**.
- Approval-queue expense and payout decisions now execute their associated financial operation in the same transaction. Failed payment approval leaves the queue pending; rejected expenses synchronize both records without spending.

Validation: **99/99 mission SQLite tests**, including **13 new financial regressions** and **2 additional HTTP queue regressions**; **13/13 financial PostgreSQL regressions**; existing mission PostgreSQL check **10/10** with **8 migrations**. Typecheck, backend compilation/runtime-asset copy and secret scan pass. All funds, destinations and receipts in these checks are labelled synthetic fixtures.

Upgrade safety: old migrations are untouched. Legacy pending payouts without destination bindings must be rejected and re-requested; legacy reservations are refundable only when an unambiguous matching ledger debit exists. Destination fingerprints now include currency, so historical attestations may require owner re-verification. No verification or missing payment evidence is manufactured during migration.

Remaining work above is not globally complete: assignment/runtime enforcement, delivery verification, resource lifecycle/UI coverage and final integrated checks continue after this phase. External production activation remains unproven.
