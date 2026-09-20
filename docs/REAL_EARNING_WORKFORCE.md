# Real earning workforce: evidence-first implementation

Review date: 2026-09-20. **Not live, not profitable, not an end-to-end earning deployment.**

## Repository and pre-coding inventory audit

The pre-coding report was delivered in the session before implementation.
`db/seeds/earning-platforms.json` contains 194 rows and 194 case-normalized unique
names: **6 verified, 179 candidate, 9 rejected, 185 importable**. Verified means
historical payout-terms evidence only, not enrolled accounts, API approval,
assignments, available money, or current profitability.

Verified names: Amazon Associates; YouTube Partner Program; Awin (incl.
ShareASale); Fiverr Affiliates; eBay Partner Network; ClickBank.
Six rejected entries concern gambling and three lack a documented earning
mechanism. Rejections remain excluded. No catalog statuses were promoted by this
implementation. Catalog rows mix networks, their merchant programs, and seller
channels: 194 rows do not imply 194 independent APIs or accounts.

The restored workspace initially had HEAD a924e4a and later source files as
working-tree changes. A safe fetch recovered checkpoint
003809b3c595369a4e05838e5fbd8067a6a1bde3. Every one of its 515 files matched the
working copy's Git blob hash. Only branch/index metadata was advanced to that
existing checkpoint; working files were not reset, cleaned, checked out over,
or discarded. The resulting checkpoint worktree was clean before new code.

## Recommended first three, not automatic clearance

| Provider | Lawful documented pathway | Credentials and additional gates |
| --- | --- | --- |
| Awin | Publisher program/relationship discovery, link generation, transaction evidence. Marketing leads, **not guaranteed paid jobs**. | Publisher ID + user-scoped OAuth2 access token. Real enrolled publisher and approved advertiser relationship; authorized publishing property and its separate delivery credentials; applicable terms/KYC/tax/payment eligibility. |
| impact.com | Partner REST API and official partner MCP product discovery, tracking links, financial reporting. | Partner Account SID + Auth Token, narrowly scoped permissions. Approved programs and property. Partner APIs are not advertiser/brand APIs. Invoices/locked commissions/payout eligibility are not received treasury funds. |
| Freelancer.com (human-assisted) | Genuine project sourcing and authorized awarded-project collaboration/files/milestones. | Own-account production PAT + expected user ID. PAT expires in 30 days, one active per environment. Approved multi-user OAuth is a different integration. `fln:user_information`, `fln:project_manage`, and, only if used, `fln:messaging` are documented scopes. Eligibility, identity, skills, account balance, fees and client terms remain gates. |

Freelancer generally prohibits automatic bidders. Initial sourcing leaves bids
on the provider's human-operated UI; exceptions need provider approval. No
unattended bidding, fake accounts, login sharing or bypass of KYC. Minimum-balance
and project-fee conditions mean this cannot be promised as a zero-upfront path.

Other documented paths worth later investigation: eBay Browse/EPN discovery
(production approval required); YouTube upload/analytics (API publishing is not
YPP approval, estimated analytics revenue is not cash); Upwork (approved API
use case, not unrestricted automation). Remaining catalog candidates are not
cleared by importing them.

### Official references checked

- [Awin authentication](https://help.awin.com/apidocs/api-authentication)
- [Awin API base/rate limits](https://help.awin.com/apidocs/introduction-1)
- [Awin API capabilities](https://success.awin.com/articles/en_US/Knowledge/what-types-of-api-calls-does-awin-offer)
- [Awin program list](https://help.awin.com/apidocs/get-program-information)
- [Awin program details](https://help.awin.com/apidocs/get-program-information-details-for-publisher)
- [Awin link generation](https://help.awin.com/apidocs/generatelink)
- [Awin transaction lookup](https://help.awin.com/apidocs/returns-a-list-of-transactions-for-a-given-publisher-by-ids)
- [Awin transaction field definitions](https://success.awin.com/articles/en_US/Knowledge/Publisher-API-GET-transactions-byID)
- [impact authentication](https://integrations.impact.com/rest-apis/api-quick-start/create-an-api-key)
- [impact partner MCP](https://integrations.impact.com/ai-solutions/mcp-tools/partner-mcp-tools)
- [impact payment lifecycle](https://help.impact.com/partner/what-would-you-like-to-learn-about/platform-features/finance/payments-withdrawals-and-balance/partner-payments-explained-from-action-to-payout)
- [Freelancer integration restrictions](https://developers.freelancer.com/docs/api-overview/types-of-integrations)
- [Freelancer personal tokens](https://developers.freelancer.com/docs/authentication/personal-access-tokens)
- [Freelancer scope definitions](https://developers.freelancer.com/docs/authentication/advanced-scopes)
- [Freelancer awarded-project workflow](https://developers.freelancer.com/docs/use-cases/working-on-a-project)
- [Freelancer terms](https://www.freelancer.com/about/terms)
- [eBay production gates](https://developer.ebay.com/api-docs/buy/static/buy-requirements.html)
- [YouTube publishing](https://developers.google.com/youtube/v3/docs/videos/insert)
- [YouTube estimated revenue metrics](https://developers.google.com/youtube/analytics/metrics)
- [Upwork automation policy](https://support.upwork.com/hc/en-us/articles/43342677368467-Use-bots-and-other-automation-properly)

## Phase 1 implemented: isolated Awin API client

`src/mission/earning/awin.ts` implements these documented endpoints only:

| Method | Path | Result meaning |
| --- | --- | --- |
| GET | `/publishers/{publisherId}/programmes?relationship=joined` | Authenticated provider program leads, explicitly `executable: false`; no default revenue/probability. |
| GET | `/publishers/{publisherId}/programmedetails?advertiserId=...&relationship=joined` | Fresh membership/deeplink/domain checks before link generation. Not complete legal/account eligibility. |
| POST | `/publishers/{publisherId}/linkbuilder/generate` | An unshortened tracking link, **not content publication or paid delivery**. Requires a caller-supplied final authorization check. |
| GET | `/publishers/{publisherId}/transactions?ids=...&timezone=UTC` | Strict publisher/advertiser/click-reference/transaction-ID-bound evidence. Missing requested IDs remain unresolved. |

Client configuration names (server-side only):

- `ZA141251SA_AWIN_ENABLED` — explicit client opt-in; default false.
- `ZA141251SA_AWIN_PUBLISHER_ID` — expected real publisher identity.
- `ZA141251SA_AWIN_ACCESS_TOKEN` — user token, never copied to URLs or logs.

Setting these does **not** activate a worker. There is no account signup, property
creation, conversion submission, payout submission, account sharing, automatic
catalog import, job assignment, or cash write in this module.

Safety: fixed HTTPS API origin, no redirect following, bearer header, bounded
response size/timeout, strict identifiers and response fields, no raw provider
error/token disclosure, no automatic retries. A conservative single-process
rolling limit is shared by clients using the same token; HTTP 429 sets a shared
cooldown. Final authorization/cancellation checks run immediately before POST.
Transport/invalid-response uncertainty after POST is reported, never retried.

The link parser deliberately accepts only unshortened Awin links with unique,
matching publisher/advertiser/click-reference parameters. Other legitimate link
formats may be blocked until individually documented and fixture-tested; there
is no permissive fallback.

Commission amounts remain decimal evidence, not rounded ledger cents. Even
`paidToPublisher=true` plus a `paymentId` yields `cashCreditEligible=false` and
`treasurySettlement=unverified`. Approved/paid commission is not independently
verified net money in a mission-controlled receiving account.

## Explicitly unfinished — do not describe this as the complete connector

1. Durable mission-only account identity and exclusive primary binding, provider
   opportunity claims, evidence provenance/expiry, owner review and scope checks.
   Aliases/programs must not allow reuse of the same dedicated provider account
   across primaries. Internal support agents are not invented provider accounts.
2. Persistent work dispatch/unknown-outcome reconciliation and per-user rate
   coordination across workers/processes. Wire final authorization to real
   mission ownership, assignment, freeze, budget and approval checks. The low-level
   API client's callback alone is not an integrated authorization service.
3. Authorized property delivery adapter and publication proof; owner-reviewed
   content, disclosures, licenses and advertiser-specific terms. A generated link
   must never be relabeled delivered work.
4. Asynchronous conversion discovery (date windows/cursors), attribution to
   genuine published work, later payout reconciliation, fees, reversals and
   batched/partial payout allocation. Current evidence lookup is by known IDs only.
5. A receiving-bank/payment-provider evidence adapter selected for the actual
   account. No such account or credential type has been established. Existing
   mission Stripe receipt verification cannot validate unrelated affiliate bank
   payouts. Do not use a synthetic reference or owner's assertion as a receipt.
6. End-to-end earning worker integration. `scripts/mission-money-worker.ts` still
   has an empty earning adapter list. The current `EarningProvider` interface
   requires a payment reference at delivery; affiliate publication often has no
   conversion/payment yet. Add explicit non-cash waiting states rather than fake
   payment references or casting this client into `EarningProvider`.
7. impact.com and human-assisted Freelancer implementations and their contract
   fixtures. Exact receiving-account/payment API requirements remain unresolved.

The legacy platform catalog sweep and default estimates are unchanged by phase
1. They are **not** a mission earning source. Their quarantine/labeling and
owner-verified account assignments remain required before workforce activation.
Existing spending/withdrawal controls and customer/mission money separation are
unchanged. No live API calls, paid deployment, account enrollment, earnings,
publishing, money movement, or agent/account activation were performed.

## Verification (fixtures only)

`src/mission/earning/awin.test.ts` contains hand-authored provider-shape responses,
fictional IDs and `.example` properties. Every request uses an injected fixture
transport. These tests neither contact Awin nor exercise live money.

Phase 1 validation:

- 24 Awin fixture tests.
- 38 existing mission money tests and 3 cash-boundary guards.
- TypeScript typecheck.

Run the focused tests with:

```sh
node --import tsx --test src/mission/earning/awin.test.ts src/mission/money.test.ts src/security/mission-cash-boundary.test.ts
npm run typecheck
```

The cash test file creates its own isolated database by default. Do not supply
production database URLs or credentials to test commands. Passing fixtures
proves local contract/control behavior only, not provider compatibility against
an authenticated account, production readiness, or profitability.
