# Toptal: approved human talent, actual hourly work, verified USD receipt

Review date: 2026-09-20. Starting clean local/remote HEAD: `4c09b2b`.
Awin, Freelancer, Upwork, Fiverr and Contra are complete and excluded from this
implementation. Their connector source/tests and historical reports are unchanged.
This is a disabled-by-default local workflow, not live integration or earnings.

## Inventory, selection and pre-implementation report

All 194 entries in `db/seeds/earning-platforms.json` were inspected again. No
inventory entry, account, opportunity or agent is promoted to live eligibility.
Toptal is selected for genuine paid software service work, rather than another
publishing/affiliate lane. Its documented human screening is a prerequisite, not
something agent definitions can satisfy. The user-facing mechanism/payment/
automation/setup/blocker report preceded implementation.

Remaining alternatives considered: Ko-fi commissions require a lawful direct
Stripe/PayPal receiver and its payment webhook is not bank settlement; Gumroad
has specific commission-product requirements and excludes several prolonged
software services. Neither is silently substituted for this talent-payment lane.
This selection does not claim every other inventory entry is unsuitable.

## Official public evidence and limits

- https://www.toptal.com/freelance-jobs/faq — authentic screened freelancers,
  talent-set hourly rates, hourly work with manually tracked hours, part-time
  (20 hours/week) and full-time (40 hours/week). Toptal handles client billing
  and invoicing, pays talent **in USD**, and says it does not take a cut from the
  talent's chosen rate. This does not prove zero bank/transfer/FX fees, this
  owner's admission, or this owner's ability to receive USD.
- https://www.toptal.com/tos — public-site terms revised April 23, 2025 prohibit
  unauthorized automated access/acquisition, scraping and impersonation; privacy,
  intellectual-property and confidentiality obligations remain. These public
  terms do not grant API permission or override private talent/client agreements.
- https://payment.toptal.com/hw2web/consumer/page/contact.xhtml — official Toptal
  Pay support links to the talent-specific payment FAQ, says the organization
  creates the payment account, and documents transfers to registered bank
  accounts with currency-conversion disclosure. It gives indicative transfer
  timelines, not finality guarantees. The linked expanded talent payment FAQ is
  account-specific; no authenticated private access is claimed here.

No official general-purpose talent/work/timesheet/remittance API, signed-export
schema, blanket AI permission, Pakistan USD destination eligibility, precise
account-specific fees or payout cadence has been established. Third-party payout
articles and the separately branded HireGlobal portal are not used as authority.
Toptal marketing of AI skills does not authorize external agents or disclosure of
client data. No screening, applications, interviews, time reporting, messaging,
portal access or payment transfers are automated by this connector.

## Exact live blockers and owner setup

1. Authentic individual talent account personally controlled by the mission
   owner; genuinely passed human screening and current admission; lawful
   country, identity, contractor classification, tax/KYC/AML and good standing.
   One human account is not multiplied across 4,001+ agent definitions.
2. Genuine independent client and accepted signed USD hourly engagement,
   authenticated scope/terms, exact hourly rate and authorized period/time cap.
   This initial lane excludes all trial/screening work, free work and disputed
   or cancelled engagements. No unpaid trial hours are inferred payable.
3. Actual permission from both provider and client for the intended assistance,
   data handling, IP use and durable minimal evidence retention. Authentic human
   performance remains required; agent runtime is never billed as human hours.
4. Real useful reviewed work, manual delivery through the engagement-approved
   channel, and authenticated acceptance of those exact bytes. Authenticated
   approved timesheet and actual earned talent-payment records are required.
5. Approved, independently authenticating own-account evidence verifiers. The
   TypeScript contracts are internal normalized requirements, NOT official API
   shapes or proof that such an adapter is authorized/available. An owner-supplied
   CSV, screenshot, email, hash, checkbox or JSON payload alone proves nothing.
6. An activated legitimate Toptal Pay account, eligible actual USD bank route,
   canonical independently verified mission-owned receiver and authenticated
   received USD movement/reversals. **The owner has no receiving provider
   configured; none is assumed.** Local-currency payout or USDC is not this lane.

Live stays disabled until all gates are established, the approved verifiers are
implemented and independently validated, and the owner authorizes actual use.
There is no credential/env-flag bypass, signup automation or account fabrication.
No paid resource, deployment, transfer, withdrawal or live work was initiated.

## Implemented chain

DISCOVER (owner-selected authenticated period reference, never scraped leads) →
ELIGIBILITY → AUTHORIZATION → REAL WORK → DELIVERY → PROVIDER CONFIRMATION →
PAYOUT → SETTLEMENT VERIFICATION → MISSION WALLET.

- `toptal-contracts.ts`: trusted read-only verifier boundaries, including a
  composite period proof authenticated against signed engagement, accepted
  timesheet and actual talent-payment records, plus separate receiving evidence.
- `toptal-workflow.ts`: owner/grant/policy gates, at-most-24-hour account grants
  bounded by provider permission, immutable account identity and artifact review.
  Account/owner/agent bindings are exclusive. The same engagement window cannot
  be assigned twice through reference aliases; future legitimate periods are
  not prohibited merely because they share a signed engagement agreement.
- Migration `0024_toptal_workflow.sql`: isolated account/work/payout/event/time
  tables. No account or money rows are seeded. Initial gross is **zero**, with
  no payable net or timesheet ID. The rate/time cap is authorization, not revenue.
- A closed approved timesheet must contain real authenticated human intervals,
  not timers inferred from agents. Whole-minute intervals must be within the
  authorized window, precede delivery intent, not overlap each other or another
  confirmed engagement for this account, and sum to actual billed minutes.
  The verifier must also establish non-overlap with outside work; the local DB
  cannot independently see other systems' time. The human-time ledger, unique
  timesheet ID and unique talent-payment ID survive restarts and transactions.
- `rate × actual approved minutes / 60` must equal exact earned talent gross in
  integer cents, using integer arithmetic. Fractional-cent rounding, mixed
  currencies, rate amendments, partial/aggregate payouts and unsupported records
  are refused rather than estimated. This initial lane supports one fully
  attributed period/timesheet/talent payment/payout and one bank credit.
- **Seven days per authorized period, at most 1,000 intervals and the local rate
  ceiling are connector safety limits**, not claims about Toptal's billing
  schedule or rates. If authentic records cannot satisfy this narrow lane, it
  stays blocked. No invented split records may force a larger payout through it.
- Actual talent deductions, payout-transfer fees and receiver fees reconcile
  separately. Toptal Pay balance, approved timesheet, earned payable, provider
  'paid' status and pending transfer observations do not credit mission money.
- Paid remittance → independently authenticated settled net USD credit, no FX →
  atomic shared mission receipt/earning-job/treasury admission. Canonical bank
  movement IDs deduplicate across connectors, not just inside Toptal.
- Period/timesheet/payment, remittance, delivery and authority are reread after
  receiver lookup. Freshness, exact unchanged local work and current owner are
  checked again inside the financial transaction; proof timeouts abort and mask
  adapter errors. SQLite write locks/native PostgreSQL mission advisory locks
  serialize time reservations and financial admission.
- Lost or changed booked proof freezes available cash without inventing a debit.
  Only an independently verified received bank debit can reverse the original
  credit. Duplicate and partial reversals, liabilities and nonnegative balances
  use the existing isolated mission money controls. Receiving earned money after
  revocation does not reauthorize outward work, allocation or spending.

## Owner API and operation boundaries

`/api/toptal` is owner-only, with existing bearer/CSRF requirements for mutation.
Commands: `inspect`, `authorize-account`, `revoke-account`, `assign`, `draft`,
`approve-delivery`, `begin-manual-delivery`, `confirm-delivery`, `observe-payment`,
`observe-payout`, `reconcile-payout`, `reconcile-reversal`.

References and reviewed artifact content are accepted, **not provider proofs**.
There are no screening, application, automated time-reporting, scraping, platform
submission, bank-transfer, spending, withdrawal or proof-import endpoints.
`configuredToptalWorkflow()` returns `new ToptalWorkflow(null)` and registers no
live receiving or spending provider. Existing owner allocation/cost/withdrawal
controls remain unchanged; live withdrawals still require separate owner approval
and provider confirmation. Customer money remains separate from mission cash.

## Verification

- Focused SQLite: **262/262** (180 Toptal + 41 owner HTTP + 41 shared money).
- Fresh isolated native PostgreSQL **18.4: 180/180**, Unix socket only, cleanly
  stopped; database and logs retained under ignored `logs/toptal/native/`.
- TypeScript check, backend compilation, secret scan and whitespace checks pass.
- Full source-bound regression: **1,732/1,732**, 115 files, 114 suites, zero
  final failures/cancellations/skips, normal exit. Source implementation: `ec8b11e`.
- GitHub [verify 35495309440](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35495309440)
  passed at that source: full SQLite, native PostgreSQL/cash contention, desktop
  and mobile-viewport browser checks, production build and compiled PG worker.
  Docker publication also passed; neither result is a deployment or live earning.

All test identities, work, timesheets, clients and money are synthetic. The fixture
`20,000 - 0 - 300 - 100 = 19,600 cents` is an arithmetic test, not a fee quote,
real service, contract, bank account, earning or activation claim.

Focused command:

```sh
npx tsx --test src/mission/earning/toptal-workflow.test.ts src/mission/mission-server.test.ts src/mission/money.test.ts
```

CI adds a fresh `mission_toptal` native PostgreSQL database and the same 180 tests,
without replacing any earlier connector or regression lane. Downloaded native
PostgreSQL test binaries are outside the repository at `/home/user/toptal-test-tools`;
this avoids a public binary-library string triggering the source secret scanner.
No secret value was exposed and no scanner policy was weakened.


### Source-bound checkpoint and interruption recovery

Fingerprint: `4c731c86d019491304ae99152b453b0f38615254a2702c50d5ba9b404e375198`.
[Tracked verification provenance](TOPTAL_VERIFICATION_2026-09-20.json) includes
per-file test counts, exact log/compressed snapshot hashes, bootstrap evidence,
native results, source SHA, failed-attempt provenance and CI/artifact identities.
All local logs, snapshots and native test database are retained; generated artifacts
remain ignored, not large Git additions. Runtime files can be absent after a
workspace restoration even when their tracked provenance survives. CI artifacts
are independently source-bound and expire on the date recorded in the provenance;
they are not byte-identical replacements for local snapshots.

The first full attempt stopped **after preserving 100/115 passed files** because
in-repository TMPDIR held tsx-generated copies of existing synthetic DSN fixtures.
Only that disposable compiled cache was relocated outside the repository; all
347 file hashes matched before/after, and original DBs, snapshots and logs were
untouched. No source, allowlist or scanner policy changed. With an external TMPDIR,
the same source-bound run resumed at the unfinished scanner test, then completed
all 115 files. The failed attempt remains in the checkpoint and provenance.
A subsequent completed-run invocation validated evidence without replaying tests;
the checkpoint byte hash remained unchanged.

To inspect or reuse the **same source and dependency configuration**:

```sh
node scripts/test-resumable.mjs --status
TMPDIR=/home/user/toptal-test-tmp node scripts/test-resumable.mjs --all --prune-working-copies --compress-snapshots
```

Changed source/configuration needs a new fingerprint; never reset source or delete
old verification evidence to force checkpoint reuse. Full run logs and cache
relocation audit are under `logs/toptal/`. Final documentation changes do not
alter the verified implementation fingerprint.
