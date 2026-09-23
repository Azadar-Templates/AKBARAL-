# Fiverr: human-assisted customer-paid USD services

Reviewed 2026-09-20 before coding. Source starts at remote `537716c`; earlier
Awin, Freelancer and Upwork implementations remain unchanged. Not live.

## Inventory and selection

All 194 entries in `db/seeds/earning-platforms.json` were inspected: 128 affiliate,
29 affiliate networks, 12 product marketplaces, six freelance services, eight
unspecified and 11 other creator/storefront/digital mechanisms. Awin, Freelancer
and Upwork are excluded as implemented; catalog statuses are not promoted.

**Fiverr seller, not Fiverr Affiliates, is selected.** The current request permits
human-assisted workflows. Fiverr has explicit official permission for customized
AI-assisted service delivery, advance customer payment, seller payment statements
and a documented USD withdrawal option. The prior Upwork selection did not
establish an approved Fiverr API; this implementation does not reverse that fact.

Remaining service candidates: Contra has genuine services/invoices and a payment
collection role (official April 2026 terms reviewed), but no general seller API
was established; it remains a later human-assisted candidate, not prohibited.
Jobbers' previously documented direct-client-payment mechanism does not establish
the requested platform/provider remittance chain. Toptal requires genuine talent
eligibility; a suitable approved integration remains unestablished. Creator,
affiliate and inventory-selling entries are not substituted for paid services.
This is a focused comparison, not a claim to have legally cleared all 194 entries.

## Official sources and limits

- https://help.fiverr.com/hc/en-us/articles/34998793899665-Using-AI-on-Fiverr-Guidelines-for-freelancers-and-clients
  Fetched current article. AI assistance is permitted, but must support the
  freelancer's own skill and effort. Work must be original, meaningfully refined
  and customized. Honor a buyer's no-AI preference; no impersonation, fraud or
  unauthorized likeness/content. This connector conservatively requires explicit
  client AI/data permission, rights clearance and human quality review.
- https://www.fiverr.com/legal-portal/legal-terms/terms-of-service
  January 2026 terms, sections 3, 6.2 and 8.8–10 reviewed. Authentic identities;
  buyers pay in advance for fixed orders; completed work must actually be sent
  through Deliver Work. No off-platform payment, fake reviews or sham orders.
  Robots, crawlers, scraping, extraction and systematic manual collection are
  restricted. Normal human operation of one's account and explicitly supported
  own-account exports are not permission to scrape or automate the website.
  Buyer confidentiality and work ownership remain binding.
- https://www.fiverr.com/legal-portal/legal-terms/payment-terms-of-service
  September 2026 payment terms, sections 2–3 reviewed. Standard successfully
  completed orders credit seller earnings equal to 80% of purchase price.
  Standard clearance is 14 days; eligible Top Rated sellers have a seven-day
  period. Completion/clearance are not bank receipt. Fiverr acts as limited
  collection agent; payment service providers actually handle funds. Actual fees,
  taxes, withdrawals and reversals must be itemized, not estimated from 80%.
- https://help.fiverr.com/hc/en-us/articles/14257019400465-Setting-up-Payoneer-as-a-payout-method
  Current table documents USD wire: 5–7 business days, $1 fee, $20 minimum;
  local-currency transfer: $3, $20 minimum; Payoneer account: $3, $10 minimum.
  Country/provider eligibility and additional charges require actual verification.
  Own-name receiver, one Payoneer method, no shared withdrawal accounts; 24-hour
  wait after method changes. New Revenue Cards are discontinued. Other general
  payout pages differ on local-transfer fees; no fixed fee or eligibility is
  inferred by code. PKR receipt is not USD receipt; a displayed Payoneer balance
  alone is not independently verified cash.
- https://help.fiverr.com/hc/en-us/articles/9234443621137-Your-earnings-page
  Official activity CSV can be requested by email, and earnings statements
  downloaded. Activity distinguishes earnings, clearing, reversals, compensation,
  expenses, withdrawal, failure and cash advance. These categories must not be
  conflated. No undocumented CSV columns, signed-export format or authenticity
  mechanism is invented. A CSV, PDF, email sender or screenshot alone is not proof.
- https://contra.com/policies/terms
  Official alternative reviewed; no blanket ban on legitimate manual services
  inferred from limits on platform or Indy AI automation.

An initially guessed AI article URL returned a missing page. Only the valid
current AI guidance URL above is relied upon.

## Owner setup and exact live blockers

1. A real eligible adult individual seller account in good standing, personally
   controlled by the mission owner; lawful country/KYC/AML/tax status and an
   approved real service listing. No account-per-agent provisioning.
2. A genuine independent buyer's one-off, prepaid USD software/service order,
   agreed scope, delivery deadline, permissions, IP/confidentiality terms and fees.
3. Actual valuable owner-supplied text/code, professionally reviewed and customized
   for that buyer. No autonomous work generator is installed.
4. Lawfully obtained and independently authenticated, current account/order,
   delivery and itemized remittance records, with lawful minimized audit and work
   retention. No live verifier or purported public seller-order API is installed.
5. An eligible own-name/mission-owned USD receiving institution, canonical account
   identifiers, and independent authoritative credit/reversal verification,
   including actual fees, FX exclusion, bank sufficiency and reversal linkage.
   **The owner has no selected receiving provider; none is assumed here.**

Human actions only: signup/KYC, listing, customer communication, order agreement,
Deliver Work, official record export and withdrawal. No browser cookies, session
extraction, scraping, unsolicited messages, API guessing or automated purchasing.
Official USD payment capability does not establish availability for this owner.

## Implemented evidence chain

DISCOVER (owner-selected order reference) → ELIGIBILITY → AUTHORIZATION →
REAL WORK → DELIVERY → PROVIDER CONFIRMATION → PAYOUT → SETTLEMENT VERIFICATION →
MISSION WALLET.

- Migration 0022 isolates exclusive owner/account/agent/order bindings, versioned
  immutable approved artifacts, payout fingerprints and hashed audit events.
- Trusted normalized contracts are **not** Fiverr wire schemas. Every proof needs
  verified authenticity, freshness and exact identity. Owner HTTP payloads cannot
  supply evidence. No configured adapter exists in the default factory.
- Real work is owner-supplied reviewed content. A single manual-delivery intent
  precedes exact authenticated recipient/content/submission/time readback. Unknown
  delivery is reconciled, never blindly resent. No empty Deliver Work actuation.
- Buyer prepayment, completed order, cleared seller earnings and provider payout
  observation remain noncash. Seller deductions, withdrawal fee and receiving
  fee are separately bound. Cash advances, compensation, tips, refunds, expenses,
  mixed orders, hourly/subscription/milestone work and FX payouts are unsupported.
- Independent genuine net USD receipt is atomically admitted through the existing
  money engine only after exact work/payment/payout binding. Authority, completion,
  clearance and remittance are revalidated after receiving lookup. Whole work-row
  comparisons prevent async races. Global physical-movement dedup and existing
  customer/mission isolation remain unchanged.
- Missing/changed booked evidence freezes treasury/agent funds without inventing
  a debit. Only independently verified bounded actual debit can reverse receipts;
  the existing nonnegative ledger/liability controls remain authoritative.
- Owner-only bearer `/api/fiverr` reference commands expose the workflow. Cookies
  and agent links do not authorize it. Proof imports, botting, outward payments,
  early payout, cash advances and withdrawals have no endpoints. Existing spending
  and owner-withdrawal gates are not replaced or enabled.

All fixture money, accounts, jobs and documents are synthetic; none is income or
live-provider proof. The factory is `new FiverrWorkflow(null)`. Existing providers
are not refactored or reimplemented.

## Implementation checkpoint verification

2026-09-20: **199/199 focused SQLite tests** (119 Fiverr, 39 mission HTTP,
41 money), **119/119 Fiverr tests on fresh native PostgreSQL 18.4**, no skips.
Typecheck, backend compilation, secret scan and whitespace checks pass. Fixtures
cover the complete chain, fees/clearance, authenticity, duplicate/self-purchase
accounts, prohibited income categories, authority/work/payout races, physical
movement dedup, uncertainty and independent reversals. The isolated native server
was shut down cleanly. Full current-source regression follows this checkpoint;
Upwork's earlier 1,280 result is not claimed as Fiverr verification.

## Final verification and preserved evidence

Implementation **96a399f** is committed and pushed on `arena/01a0ba0a-akbaral`,
descending from `537716c`. Awin/Freelancer/Upwork source and migrations are unchanged.
The full new-source normal-exit regression passed **1,400/1,400 tests, 113 files,
114 suites**, with no failures, skips or cancellations. Fingerprint:
`bef678df0e91506f5e9af6d76b0f4e4745a0f0b77dae5a23e3b6f9f50f33496a`.
A subsequent runner invocation validated saved evidence without replaying tests.

GitHub [verify run 35491545336](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35491545336)
succeeded for the exact implementation commit. Existing Docker image publication
also succeeded; that is not a production deployment or live-money verification.
See [per-file provenance](FIVERR_VERIFICATION_2026-09-20.json). Later documentation
changes do not change this application fingerprint.

All new captured RAM fixture evidence is retained in:
`logs/test-checkpoints/bef678df0e91506f5e9af6d76b/fiverr-evidence.tar.xz`
(12,689,704 bytes; SHA-256
`d3f554d11639c248a612af3c61ef9caab60387c634c0b29b773a282bc7f94a7d`).
The exact checkpoint, independent logs, archive manifest and codec are beside it,
following the ignored runtime-log convention rather than committing binaries.
No prior snapshots, failed databases, source or history were deleted or rewritten.

The archive contains **2,069 captured original files**, including all **114**
bootstrap/test snapshots and the cleanly stopped native PostgreSQL fixture.
Snapshots are decoded for compression across images, then restored using the
original Brotli quality-5 encoding. The codec reconstructs one file at a time:
every original file byte hash was checked by reading the finished archive and
reconstructing the original encoding. This is lossless storage, not regenerated
or substituted test evidence. Originals remain available in RAM as well.

Recovery (check the outer archive and codec hashes against the tracked manifest
first; use the recorded Node/Brotli versions and `xz`):

```sh
node logs/test-checkpoints/bef678df0e91506f5e9af6d76b/fiverr-evidence-codec.mjs \
  verify logs/test-checkpoints/bef678df0e91506f5e9af6d76b/fiverr-evidence.tar.xz
node logs/test-checkpoints/bef678df0e91506f5e9af6d76b/fiverr-evidence-codec.mjs \
  restore logs/test-checkpoints/bef678df0e91506f5e9af6d76b/fiverr-evidence.tar.xz /new-empty-output
```

The restore destination must not exist. The codec refuses overwrite and reconstructs
compressed snapshots directly; do not expand every decoded database with plain
`tar` on this storage-constrained machine. Preserve original checkpoint paths:
restore `/dev/shm/fiverr-full-96a399f` only if absent, then use the original source
and configuration to validate/resume:

```sh
TMPDIR=/dev/shm/fiverr-full-temp node scripts/test-resumable.mjs --all \
  --run-dir /dev/shm/fiverr-full-96a399f \
  --prune-working-copies --compress-snapshots
```

A completed checkpoint validates without rerunning completed files. Root disk has
about 20 MiB free after preservation; new tests need storage planning, not deletion
of protected evidence. No live work, provider payment, USD settlement or mission
income was represented by these fixtures. Live blockers above remain unchanged.
