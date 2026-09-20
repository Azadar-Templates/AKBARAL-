# Contra: direct human-assisted USD service projects

Review date: 2026-09-20. Starting remote/local commit: `99ec471`.
Awin, Freelancer, Upwork and Fiverr are excluded; their implementations are unchanged.
This is a gated local workflow, not live-provider access or an earnings claim.

## Inventory and pre-coding selection

All 194 entries in `db/seeds/earning-platforms.json` were inspected. They include
128 affiliate, 29 affiliate-network, 12 product-marketplace, six freelance-service,
eight unspecified and 11 other creator/digital/storefront entries. Historical
catalog labels (6 verified, 179 candidate, 9 rejected) are not account or current
permission verification; no catalog entry is promoted by this work.

**Contra Independent service projects are selected.** Compared with the remaining
service candidates, Contra has stronger official documentation of signed direct
client agreements, fixed USD payment, approval/release, and payout rails. Jobbers'
previously documented direct-client payment model does not establish the requested
platform-remittance chain. Toptal's screening and suitable approved integration
remain unestablished. Affiliate, creator and product-selling entries are not
substituted for genuine paid client work. This does not claim all remaining
entries are illegal or individually cleared for automation.

## Official evidence reviewed before implementation

- https://contra.com/policies/terms — April 9, 2026 terms, sections 2, 7–14,
  16–19, 21–22. Business-use eligibility, accurate identity/beneficial ownership,
  genuine direct engagement and lawful contractor classification are required.
  Unauthorized automated access, non-public access, scraping, spam, mass recruiting,
  staffing without consent, undisclosed intermediaries and rate-limit evasion are
  prohibited. Indy AI's availability is not permission for bots/scripts. User
  content and AI output require rights, legal compliance and appropriate human
  review. Client consent to assistance/data use is an additional connector gate.
- https://help.contra.com/en/articles/9322763-paid-projects — May 12, 2026.
  One-Time Fixed (Escrow): total project fee funded upfront; optional advance is
  released immediately; remainder released after approved deliverables. Contract
  templates/custom PDF agreements carry terms and e-signatures. The selected lane
  excludes advance releases, hourly/milestone/recurring arrangements and additional
  invoices. One genuine fixed project and one fully attributed payout only.
- Terms section 22: one-time fixed contract amount is **US dollars**; Contra is
  the Independent's limited collection agent. Optional upfront amounts and wallet
  release are not independent bank receipt. Terms also describe automatic release
  after 120 hours without acceptance/revisions. This narrower implementation
  requires **explicit client acceptance of the exact delivered bytes**, rather
  than inferring approval from elapsed time. Automatic release is not alleged to
  be prohibited by Contra; it is outside this initial supported lane.
- https://help.contra.com/en/articles/9322934-fees-overview — August 6, 2026.
  Funds paid in USD; non-USD receivers cause conversion. Bank/SWIFT, Payoneer and
  other processor fees vary. SWIFT is listed at $15–25+; Pakistan local payout is
  PKR, not USD. Account/country/beneficiary eligibility must be independently
  checked; no foreign address or receiving account is assumed. USDC is not USD.
  IMPORTANT: this newer fees page lists $15/$29 Free-plan platform fees and $0 Pro
  fees; the May project article lists different $2/$5/$10/$29 tiers. Do not assume
  a universal zero fee or hard-code either schedule. Actual accepted fee terms,
  transaction deductions, payout fees and bank net receipt must reconcile.
- https://help.contra.com/en/articles/10008642-payouts — March 13, 2026; current
  target of the old payout-timeline URL. Standard payouts have a four-day safety
  clearance plus rail transit; client ACH/SEPA settlement and fraud-review holds
  can delay availability. Timelines, wallet balances and 'paid' labels alone are
  not received mission cash. Faster-payout initiation is not implemented.
- https://help.contra.com/en/articles/13755128-transaction-log-statuses — official
  indexed transaction-dashboard guidance. No signed-export schema, API endpoint,
  webhook verification format or automatic evidence extraction is established.

No generic project/payment API permission was established. Account creation,
contracts, communication, signing, submission, client approval and withdrawal
remain human-operated. Legitimate assistive work happens under the signed client
agreement and verified IP/confidentiality permissions, not through platform bots.
No paid subscriptions, project fees, resources or live platform actions were bought.

## Owner setup and exact live blockers

1. Authentic eligible adult Independent account, personally controlled by the
   mission owner, in good standing; business/tax/KYC/AML/country requirements.
   Agent definitions are not new human identities or platform accounts.
2. A real independent direct client and countersigned one-time fixed software
   project: exact scope, lawful classification, agreed fee allocation, fully funded
   USD escrow, no upfront release, AI/data permission and rights clearance.
3. Actual useful owner-supplied text/code, professionally reviewed for this client;
   manual submission and authenticated readback, followed by explicit acceptance.
4. Trusted current account/agreement/funding/delivery/acceptance/payment/remittance
   verification with lawful minimal record retention. A screenshot, CSV, PDF,
   email sender, hash or owner checkbox alone does not authenticate these facts.
   Normalized interfaces are not alleged official wire formats or working adapters.
5. A real mission-owned eligible USD receiving institution and independent credit/
   reversal verification with canonical institution/account/movement identities,
   exact actual deductions and available funds. **The owner still has no selected
   receiving provider; none is assumed or configured.**

These remain live blockers. Missing access is not bypassed through scraping,
credential sharing, fake accounts, caller-supplied proofs or invented endpoints.

## Implemented chain and controls

DISCOVER (owner-selected project reference) → ELIGIBILITY → AUTHORIZATION →
REAL WORK → DELIVERY → PROVIDER CONFIRMATION → PAYOUT → SETTLEMENT VERIFICATION →
MISSION WALLET.

Migration 0023 adds isolated exclusive account/owner/agent and project/agreement
bindings, immutable approved work, unique release IDs, attributed payouts and
hashed audit events. One personal Independent account is not multiplied across
4,001+ agent definitions. No autonomous generator or platform-action engine is
installed; actual reviewed deliverables are supplied by the owner.

Agreement identity and hash, direct client, scope, gross amount and delivery bytes
remain bound throughout. Funding and release are distinct. Explicit acceptance,
full released gross, actual Independent net and release transaction ID must match
the remittance line. Project deductions, payout charges and receiving fees are
separately reconciled. Neither 'commission free' nor a percentage estimate creates
money. Loans, tips, compensation, digital-product revenue, deposits and mixed
payouts are outside this service-project lane.

Only authenticated independently received net USD can enter the existing atomic
money engine. Final project/acceptance/payment/payout/authority checks follow the
receiver await; whole work-row comparisons reject concurrent changes. Canonical
physical movement dedup spans connectors. Booked uncertainty freezes funds without
inventing debits. Bounded authenticated independent reversals preserve the existing
nonnegative ledger, liability, grant, freeze and customer/mission isolation rules.

Private owner bearer `/api/contra` commands accept references and real artifacts,
not proof imports. Cookies alone and agent links cannot authorize them. Unsupported
create-account/project, scrape, message, deliver, pay, faster-payout and withdrawal
commands have no endpoints. No money provider is registered for spending.

The runtime factory is deliberately `new ContraWorkflow(null)`; there is no live
verification/receiving adapter or environment switch that silently activates one.
All test accounts, projects, payments, artifacts and balances are synthetic local
fixtures, never real earnings or Contra sandbox accounts.

## Implementation checkpoint checks

2026-09-20: **231/231 focused SQLite tests** (150 Contra, 40 mission HTTP,
41 money) and **150/150 Contra tests on fresh native PostgreSQL 18.4**, no skips.
Types, backend TypeScript compilation, secret scanning and whitespace checks pass.
Tests cover authority/authenticity, direct engagement, classification/signatures,
escrow/advance exclusion, immutable agreement/work/delivery, explicit acceptance,
release/payout provenance, actual fee/net arithmetic, FX/USDC rejection, async
races, physical movement dedup, booked uncertainty and independent reversals.
The native fixture server was stopped cleanly. Full current-source regression
follows this implementation checkpoint; previous providers' counts are not
substituted for Contra verification.

Storage planning removed only three redundant temporary compression outputs after
checking the canonical Upwork archive SHA-256. No original database, snapshot,
log, source, commit or canonical evidence archive was removed. Cleanup details are
retained in `/tmp/contra-storage-cleanup.json` for the final evidence manifest.

## Final current-source verification and preservation

Implementation **ed591ea** is committed and pushed on `arena/01a0ba0a-akbaral`,
descending from `99ec471`. The four earlier provider implementations and their
migrations remain unchanged. The complete new-source normal-exit regression passed
**1,551/1,551 tests across 114 files / 114 suites**, without failures, skips or
cancellations. Fingerprint:
`3c39254a7aaa9e1d7d08cae36d0312abb8483a6a5b6c88ce1d509ce5d45026cd`.
A subsequent runner invocation validated all saved evidence without replay.

GitHub [verify run 35493215624](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35493215624)
succeeded for this implementation commit, including full SQLite, native PostgreSQL,
browser/mobile-viewport, production build and compiled PG-worker checks. Existing
Docker image publication succeeded too; neither is deployment or live-money proof.
See [per-file provenance](CONTRA_VERIFICATION_2026-09-20.json). Documentation-only
updates after the implementation do not change the tested application fingerprint.

Compact canonical evidence:
`logs/test-checkpoints/3c39254a7aaa9e1d7d08cae36/contra-evidence.tar.xz`
(12,417,688 bytes; SHA-256
`0df4a1547f9bfe7e73542d4f2b864e2084137755f07ddddd812de5bf2cb0b157`).
The exact checkpoint, independent logs, archive manifest, cleanup audit and codec
are beside it. Runtime evidence follows the ignored-log convention, not Git binary
commits. All original captured DBs, snapshots and logs remain; no previous source,
commit or canonical evidence archive was removed or rewritten.

The archive preserves **2,096 captured original files**, including **115** bootstrap/
test snapshots and the stopped native PG cluster. SQLite snapshots are decoded for
compression across images, then restored with the original Brotli quality-5
encoding. Reading the finished archive and reconstructing each original verified
**every original file byte hash**. This is lossless storage, not regenerated tests.

Recovery: verify the outer archive and codec hashes against the tracked manifest;
use the recorded Node/Brotli versions and `xz`:

```sh
node logs/test-checkpoints/3c39254a7aaa9e1d7d08cae36/contra-evidence-codec.mjs \
  verify logs/test-checkpoints/3c39254a7aaa9e1d7d08cae36/contra-evidence.tar.xz
node logs/test-checkpoints/3c39254a7aaa9e1d7d08cae36/contra-evidence-codec.mjs \
  restore logs/test-checkpoints/3c39254a7aaa9e1d7d08cae36/contra-evidence.tar.xz /new-output-directory
```

The destination must not exist. Restoration reconstructs one original compressed
snapshot at a time; plain tar extraction of all decoded snapshots needs much more
storage. Do not overwrite existing evidence. Restore the checkpoint directory to
its original `/dev/shm/contra-full-ed591ea` location only if absent, and validate or
resume with the original application/configuration:

```sh
TMPDIR=/dev/shm/contra-full-temp node scripts/test-resumable.mjs --all \
  --run-dir /dev/shm/contra-full-ed591ea \
  --prune-working-copies --compress-snapshots
```

A completed checkpoint validates without replaying tests. Storage is critically
limited (about 5 MiB on root and 81 MiB in RAM-backed temp after preservation).
Further full regressions require storage planning, not removal of protected data.
All live blockers above remain. No actual client work, payment, USD receipt or
mission income is claimed by these synthetic verification results.
