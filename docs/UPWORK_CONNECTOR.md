# Upwork: approved, human-assisted USD paid work

Review: 2026-09-20. Not live. No earnings or ready-to-use account claimed.
Newer work through a5b5bb0 is preserved; 07f59b0 remains an ancestor.

## Pre-coding inventory/selection

The actual `db/seeds/earning-platforms.json` has 194 unique entries: 6 historical
verified, 179 candidate, 9 rejected. Mechanisms: 128 affiliate, 29 affiliate
network, 12 marketplace selling, 6 freelance services, 8 unspecified, 11 other
creator/storefront/digital mechanisms. These are catalog entries, not accounts,
jobs or current automation permissions. No inventory status is promoted.
Awin and Freelancer are already implemented and excluded. Affiliate/creator
payouts are not substituted for paid contracts. Existing rejected entries stay
rejected. The remaining freelance candidates were considered as follows:

- **Upwork: selected conditionally.** Official approved API route for managing
  contracts, genuine paid services and a documented USD withdrawal path.
- **Fiverr seller:** lawful customized AI-assisted work exists, but a documented
  approved seller-order integration was not established. Excluded from this
  automated connector selection, not declared unlawful for manual work.
- **Contra:** official terms document USD service payments and restrict bots/
  scripts in Indy AI. A general approved contract API was not established;
  separate AI-product checkout claims are not evidence for this workflow.
- **Jobbers:** its own comparison describes direct client payments, not a
  platform-intermediated provider-payment chain; unsuitable for this connector.
- **Toptal:** human talent screening and a service marketplace do not establish
  permission to automate its platform or a suitable official contract API.

Unapproved platform automation is excluded. This does NOT claim that all
remaining 192 entries were individually cleared or are prohibited.

## Official evidence (read before implementation)

- https://support.upwork.com/hc/en-us/articles/43342677368467-Use-bots-and-other-automation-properly
  Approved API use case required. No scraping, browser/session-token reuse,
  credential sharing, proposal spam or requests outside approved scopes.
- https://support.upwork.com/hc/en-us/articles/115015857647-How-to-request-an-API-key-from-Upwork
  Authentic profile, verified payment method and identity, good standing,
  **$25,000 lifetime earnings/spend**, **90% JSS** for freelancers/agencies;
  personal/internal use only, not commercial integrations. Application review
  and 40,000/day request commitment. No developer sandbox/test accounts.
  No suggestion to spend money to become eligible.
- https://www.upwork.com/developer/documentation/graphql/api/docs/index.html
  OAuth2; `https://api.upwork.com/graphql`; explicit
  `X-Upwork-API-TenantId`; Common Entities read permission plus operation scopes.
  300 requests/minute/IP; cache limit **24 hours**. Access token documented as
  24h, refresh token two weeks since last use. Application-scope changes
  invalidate existing tokens. No shared identities; agency != individual.
- https://www.upwork.com/legal#api and https://origin.upwork.com/legal
  Approved contract-management uses; limited intermediate copies; 24h cached
  content limit; deletion obligations. Durable records are NOT automatically
  exempt: this connector additionally blocks persistent provider-derived
  evidence absent explicit verified written retention permission covering it.
- https://support.upwork.com/hc/en-us/articles/211060918-How-to-get-paid-on-Upwork
  Fixed-price availability follows client approval plus standard five-day hold.
  Availability is NOT bank settlement. USD wire: $50 provider fee; ACH for
  international tax addresses: $2.99 effective 2026-09-01; downstream fees may
  apply. Rail availability/account eligibility must be checked, not inferred
  from location. Local-bank PKR conversion is NOT USD settlement.
- https://help.fiverr.com/hc/en-us/articles/32242973123985-Our-Community-Standards
- https://contra.com/policies/terms
- https://www.jobbers.io/jobbers-io-vs-upwork-complete-2026-comparison/

The indexed Upwork “AI at work” article returned a moved/not-found page on direct
fetch. We do NOT treat the search excerpt as a current blanket contractual rule.
Explicit client permission for AI assistance, data use, rights and human quality
review are mandatory **connector safety requirements** regardless.

## Scope and live blockers

Real software work on an already manually accepted USD fixed-price contract;
one funded milestone per dedicated contract and one completely itemized payout
for that work. No hourly time claims, agency impersonation, partial/mixed/FX
batches, proposal sending, Connects buying, acceptance, milestone release,
withdrawal or outward payment automation. The owner supplies and reviews a real
text artifact (code/report); no autonomous work-engine or fake work is installed.
Delivery/submission remains manual; authentic readback must match the actual
approved bytes. Unknown delivery is read-only reconciliation, not a resend.

Owner setup: actual eligible individual account and tenant, approved internal
application/scopes, legitimate OAuth client ID/secret/access/refresh credentials
and callback, actual accepted funded contract and client permissions, tax/KYC/
AML/country eligibility, verified retention permission, and a mission-owned USD
receiving rail with matching beneficiary. Credentials alone activate nothing.
Do not enter credentials into chat. No selected receiving provider is assumed.

Only independently settled **receiving net USD** can enter mission cash, after
binding approved real work, fresh provider payment/remittance and independent
receiving movement. Platform balances, budgets, escrow, released milestones,
pending transfers and every fixture are not mission income. Existing allocations,
operating-cost limits and owner withdrawal controls remain downstream unchanged.

Trusted provider/receiving adapters require provider-specific production
validation. Normalized contracts in code are NOT alleged Upwork API schemas.
The runtime factory installs none. The limited documented read-only API probe
is not an identity/KYC/payment verifier or a way to bypass API approval.

## Implemented controls and boundary

- Migration 0021: exclusive owner/account/agent binding (one personal account per
  mission owner, not one account per generated agent), immutable versioned work,
  globally unique attributed payouts and physical settlement/reversal references.
- DISCOVER is a reference inspection, not an invented opportunity. ELIGIBILITY
  and AUTHORIZATION require trusted owner-control, identity, permissions, client
  consent and current bounded mission grants. Individual agency contracts fail.
- REAL WORK is actual owner-supplied text; DELIVERY requires exact reviewed bytes,
  a single manual handoff and authoritative readback. PROVIDER CONFIRMATION and
  PAYOUT remain noncash. SETTLEMENT VERIFICATION independently proves actual net
  USD into the mission-owned receiver before atomic MISSION WALLET admission.
- Existing ledger/global dedup, nonnegative accounts, uncertainty freezes and
  bounded independently verified reversals remain authoritative. Complete work
  rows and fresh authority are rechecked after asynchronous receiving lookups.
- Private owner bearer-authenticated `/api/upwork` commands accept references,
  never proof imports. Cookies alone cannot authorize them. No proposal, payment,
  acceptance, release, withdrawal or spend endpoints are added.
- The limited read probe uses fixed official GraphQL origin, explicit tenant,
  `companySelector` and modern `contractByTerm { id kind status }`. Official docs
  sections 10–13 were additionally checked during implementation: legacy
  `contract` is deprecated; term IDs and rollup contract IDs are distinct. The
  probe retains that distinction and requires the approved Offer read scope.
  Neither header nor membership is ownership, funded-work or payment proof.
  Async permission is checked before/after requests, payloads are bounded,
  redirects/errors sanitized, no raw response is cached, and shared local
  60/minute + 1,000/day caps are enforced. Shared-IP aggregate coordination still
  belongs to the eventual deployment; there is no background polling.
- The factory remains `new UpworkWorkflow(null)`. No live proof/receiving adapter,
  automatic credential activation, provider spend registration or live money test
  is installed. All verification fixtures are local synthetic data, not Upwork
  sandbox accounts or earnings.

### Implementation checkpoint verification (2026-09-20)

Normal-exit SQLite focused regression: **269/269** (105 Upwork, 38 mission HTTP,
53 Freelancer settlement, 32 Awin, 41 money). Fresh native PostgreSQL 18.4:
**105/105 Upwork**; no skips. Typecheck, backend TypeScript compilation,
secret scan and whitespace checks pass. Native migrations ran on a new database,
not the previous populated fixture database. These are synthetic tests, not
provider or banking validation. Full current-source regression follows this
implementation checkpoint; the earlier 1,174 result is previous-source evidence.
