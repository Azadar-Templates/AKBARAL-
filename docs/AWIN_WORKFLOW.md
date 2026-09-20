# Awin workflow — phase 2

2026-09-20, based on checkpoint `2654a18`. **No live earnings, publication, bank
connection, or cash activation has occurred.** The owner selected **no publishing
property** and **no receiving provider**. Consequently the production factory
installs neither adapter. Supplying Awin credentials alone cannot publish or
credit cash. This is an implemented, tested control/workflow layer, **not a
production-ready end-to-end earning deployment**.

This supersedes the internal workflow gaps listed under phase 1 in
[REAL_EARNING_WORKFORCE.md](REAL_EARNING_WORKFORCE.md); its inventory counts,
provider restrictions and official Awin endpoint references still apply.

## Implemented

- Mission migration `0018_awin_workflow.sql`, compatible with SQLite and native
  PostgreSQL. No seed opportunities, opening balances, secrets or external accounts.
- Provider-authenticated program discovery. Catalog estimates never enter this
  workflow. Only a real joined/active program ID can become a discovered lead.
- Durable database-unique bindings for agent, Awin publisher account, canonical
  property origin, and opportunity. Revoked bindings remain reserved tombstones:
  revocation does not transfer another agent's account, work or earnings. One
  Awin account cannot be divided into pretend dedicated accounts using clickrefs.
- Assignment requires an active finite mission money grant (including ancestor
  and agent-contract checks), current joined advertiser relationship, accepted
  destination domain, and verified property control **and Awin permission**.
  Property evidence expires within 24 hours; renewal rechecks both providers.
- Owner-only commands, immutable/idempotent content drafts, escaped plain-text
  content, affiliate disclosure, and approval of the exact title/HTML hash.
  Content is not generated with an unbudgeted paid model. Only preapproved
  existing publishing capacity with zero incremental charge is supported;
  paid or unknown capacity is blocked, not implicitly funded.
- Fresh permission checks before publication, final serialized owner/grant/
  freeze/liability checks immediately before dispatch, and single-use mutation
  authorization. Crash/timeout/ambiguous publication requires authenticated
  read-only lookup by persistent key. No blind POST retry or inference from absence.
- Bounded conversion discovery by transaction-date windows (maximum 31 days),
  and known-ID status reconciliation. Window omission is not a reversal. No
  cursor silently skips a failed window. Awin responses must match the exact
  publisher, advertiser, transaction and publication click-reference.
- Versioned normalized commission evidence and ordered, hash-audited lifecycle
  events. Raw provider responses/credentials/customer PII are not retained.
- Complete-batch net settlement reconciliation through a trusted receiving-
  provider contract. Publisher, payout, bank movement, receiving account, exact
  line items, fees, currency, balance and totals are checked. Bank memos, caller
  JSON and Awin's `paidToPublisher` flag alone cannot establish settlement.
- Global bank-movement uniqueness and immutable payout binding. Provider-
  confirmed credit and lifecycle changes commit atomically through the existing
  verified-cash engine; no other module writes cash tables. Receipt replay is
  idempotent. Insufficient verified available balance rolls back all cash-eligible
  transitions. Historical earned funds can be reconciled after revocation/freeze,
  without allowing new publication or spending.
- Full/partial confirmed reversals, unique reversal receipts and cumulative caps.
  Existing held-fund/liability protections are preserved. Changed post-credit
  commission evidence freezes all mission cash for review; it does not invent a
  reversal. Only independently confirmed reversals debit the ledger.
- Shared durable 20-request/minute rolling budget and persistent 429 cooldown
  across production clients/workers. The global budget is intentionally stricter
  than Awin's per-user limit. Workers do not share credential values in the DB.

## Lifecycle and blocked states

Business history:

`discovered → eligible → published → conversion → approved → paid → provider_confirmed → mission_cash_eligible`

Publication has its own non-cash sub-states: `eligible`, `link_creating`,
`awaiting_owner`, `publishing`, `published`, `blocked`, `unknown_link`, and
`unknown_publish`. Link creation is not publication. Content approval is not
commission approval. Owner approval cannot verify bank settlement.

Commission statuses include `conversion`, `approved`, `paid`, `rejected`,
`mission_cash_eligible`, `settlement_review`, and `reversed`. `provider_confirmed`
and `mission_cash_eligible` are recorded as separate ordered events in the same
cash transaction: there is no half-committed cash eligibility on ledger failure.
A provider may first report an already-paid conversion; its observed approved
and paid stages are recorded without inventing historical timestamps.

Payouts may remain `pending`/`unknown` indefinitely. Unmatched, partial incoming,
FX-converted, unattributed, unsupported-precision or incomplete batches do not
receive automatic credit. The supported settlement currencies are USD, EUR,
GBP, CAD and AUD with at most two fractional digits, additionally restricted to
mission currency. No exchange-rate guesses or rounding into cash.

The first release supports a maximum of 100 commissions per complete payout;
larger batches require a reviewed pagination/allocation extension. Owner review
cannot override missing provider proof. A stale/missing transaction is not a
confirmed reversal. Manual review remains required for changed booked evidence;
no automatic unfreeze is performed.

## Owner API (private mission server only)

- `GET /api/awin`: configuration/blockers and persisted opportunities,
  assignments, publications, commissions and payouts (bounded views).
- `POST /api/awin/discover`
- `POST /api/awin/assign`: `agentId`, `opportunityId`, `destinationUrl`.
- `POST /api/awin/refresh-assignment` / `revoke`: `assignmentId`.
- `POST /api/awin/draft`: `assignmentId`, `idempotencyKey`, `title`, `body`.
- `POST /api/awin/prepare`: `publicationId`.
- `POST /api/awin/approve-publication`: `publicationId`, `contentHash`.
- `POST /api/awin/publish` / `reconcile-publication`: `publicationId`.
- `POST /api/awin/sync`: `publicationId`, `ids` (transaction IDs, not receipts).
- `POST /api/awin/scan`: `publicationId`, UTC `startDate`, UTC `endDate`.
- `POST /api/awin/reconcile-payout`: `paymentId`, `externalId` (receiving movement).
- `POST /api/awin/reconcile-reversal`: `paymentId`, `reversalExternalId`.

All require a current mission owner session. Agent links cannot read this fleet
view, authorize publication, or submit settlement evidence. Routes never accept
property-verification JSON, bank proof, configurable verifier URLs or arbitrary
adapter installations. Adapters are trusted server code, not owner-provided
callbacks over HTTP. This is intentionally owner-operated, not an unattended
publishing fleet. The generic money worker's earning adapter list remains empty;
affiliate jobs do not pretend to receive payment at publication time.

## What is still required before production activation

1. An actual human-owned, eligible Awin publisher account, approved advertiser
   relationships, permitted country/business model, required KYC/tax/payment
   details, and approved publishing property. No signup, KYC or enrollment is
   automated by this code.
2. Select an existing publishing provider and property. Implement and review its
   concrete `AwinPublishingProvider` adapter: verify canonical property control,
   Awin permission, preapproved capacity/cost, authenticated publish and exact-key
   read-only recovery with actual content hashing. CMS write access alone is not
   proof of Awin approval. Canonical identity must not let URL aliases duplicate
   one property. **This concrete adapter is not implemented/configured**, because
   no property/provider was selected.
3. Select the actual mission-owned receiving bank/payment provider. Implement and
   review its concrete `AwinSettlementProvider` adapter against its documented API
   and Awin remittance data. It must independently prove available net money,
   complete line attribution, reversals and account identity. **This concrete
   adapter is not implemented/configured**, because no receiving provider was
   selected. Stripe charge receipts cannot stand in for affiliate bank payouts.
4. Install adapters only in trusted server configuration after fixture/contract
   validation, then explicitly authorize read-only live identity/property/
   settlement checks. Production fixture adapters must never be installed.
5. Review disclosures/content rights/advertiser rules and receiving-account
   reconciliation/fees/refunds operationally. Finish provider-specific live
   acceptance and deployment authorization. No paid deployment was requested.

### Exact currently defined credential/configuration names

- `ZA141251SA_AWIN_ENABLED=true` to enable the Awin client (not publishing/cash).
- `ZA141251SA_AWIN_PUBLISHER_ID`: real expected publisher account ID.
- `ZA141251SA_AWIN_ACCESS_TOKEN`: owner/user-scoped OAuth2 bearer API token.
- Existing private mission owner authentication and mission database/session
  configuration; do not substitute public AKBARAL/customer credentials.

Publishing and receiving-provider credential names/types **cannot be specified
honestly until those providers are selected**. Their interfaces require real
property/account identity plus appropriately scoped API authorization; this is
not a request for passwords or secret values in chat. The code has no guessed
bank endpoint, generic "verified=true" bypass, or invented credential defaults.

## Verification

All new provider responses, accounts, sites, projects, commissions and money
in tests are explicitly fictional fixtures in disposable databases. No live
provider/API/money test was run.

- 31 new workflow tests: every lifecycle stage, ownership, expiry, publication
  approval, concurrency, missing/mismatched evidence, pending/uncertain cash,
  idempotency, net fees, cumulative reversals, held-cash liability and rate limits.
- Existing 24 Awin client tests retained.
- 139 combined SQLite/API/cash/IPC/security tests passed.
- 31 workflow tests passed on **native PostgreSQL 18.4**, using a local Unix
  socket and disposable database. Native PostgreSQL coverage is added to CI.
- Typecheck, backend compilation, secret scan and diff checks passed.

The PGlite socket harness failed after an intentional unique-constraint error,
then returned inconsistent later results. This is **not** counted as a PG pass;
the same tests, including the constraint violation, passed on native PostgreSQL.
Native PG is the required financial-workflow regression environment. No existing
constraint or financial guard was weakened to make the harness pass.
