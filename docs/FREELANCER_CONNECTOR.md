# Freelancer: human-assisted USD work connector — phase 1

2026-09-20. **Implemented and fixture-tested through bounded file delivery and
milestone observation. NOT an end-to-end paid-work or live-money deployment.**
No real account, contract, work delivery, payout or settlement was exercised.
See [the standing real-money objective](REAL_MONEY_OBJECTIVE.md).

## Required connector report

| Requirement | Exact status |
|---|---|
| Actual earning mechanism | A legitimate client awards and the account holder manually accepts a fixed-price software contract; the client funds a milestone; useful authorized work is delivered and the client releases payment. Listings and bid budgets are not earnings. |
| USD payment mechanism | Only USD-denominated fixed-price projects with provider-observed accepted awards and funded USD milestones can enter this workflow. Freelancer milestone clearing is platform evidence, **not a received USD payout**. No withdrawal/remittance or receiving-bank integration is installed. Actual account/country-specific USD withdrawal availability, fees and settlement must still be established. |
| Owner setup | Genuine eligible human-controlled Freelancer account, required KYC/tax/country/skills/fee compliance, permitted API integration, production own-account PAT and exact user ID; fresh mission agent grant; explicit expiring owner review; per-project scope/client AI-use/confidentiality permission; real accepted contract and funded milestone; reviewed deliverable. Independently verifiable USD receiving rail/account remains unselected. |
| Automation limits | No account creation, KYC automation, bids, award acceptance, paid promotions, reviews, milestone release, withdrawals or paid resource calls. Owner API only; no dedicated dashboard panel or autonomous work-generation engine. Content comes from actual work performed elsewhere and reviewed by the owner, not fabricated by this connector. |
| Exact live blockers | No configured/authorized provider account, actual approved client contract or funded milestone; no reviewed work artifact; no payout/remittance adapter; no independently verified USD settlement adapter. All money stages remain BLOCKED, even if credentials are supplied. |
| Tests | 153 focused fixture tests across Freelancer client/workflow, owner HTTP API, optional env handling, shared cash and Awin workflow. Native PostgreSQL: 19 Freelancer workflow tests passed; shared money 39 passed with the existing 4,001-ledger bulk fixture skipped on PostgreSQL (it passed on SQLite). Types/backend compilation/secret scan passed. No live tests or real income. |

Freelancer cannot be promised as zero-upfront: its account/bidding/acceptance/fee
conditions require human review. This implementation does not authorize spending
to obtain work. One provider account is not multiplied into 4,001 accounts.

## Lifecycle and implemented boundaries

1. **DISCOVER** — authenticated `self` identity plus active-project API search;
   bounded pages of 50, retaining only USD fixed-price active projects. Full-page
   pagination advances by raw rows, not filtered rows. Project observations are
   stored separately from executable assignments and cash opportunities.
2. **ELIGIBILITY** — owner verifies requirements not established by an API user ID:
   KYC/account control, geographic/tax rules, platform/API automation permission,
   client confidentiality/AI permission, rights/quality, fees/no new spending.
   The stored review is explicitly an **owner attestation, not provider KYC proof**.
   Accepted bid identity/status/time, project owner/type/currency, funded milestone
   identity/currency/amount and absence of a dispute are read from the provider.
   Unknown schemas, missing evidence and unsupported states fail closed.
3. **AUTHORIZATION** — permanent exclusive user↔agent binding (revocation retains
   the tombstone); bounded owner review expires within 24 hours and can only be
   renewed for the same non-revoked identity. Agent/ancestor grants and contracts
   must remain active. Each project/bid/milestone has one durable work claim, with
   an explicit project-specific scope/permission reference. No mass assignments.
4. **REAL WORK** — an owner supplies the actual completed text artifact, such as a
   software patch or test report. This connector does not execute arbitrary jobs
   or attest that generated text satisfies a client contract. Owner review is
   responsible for genuine quality, rights, confidentiality and permitted scope.
5. **DELIVERY** — UTF-8 plain text only, ≤256 KiB. Draft edits invalidate approval;
   approved artifacts are immutable. Owner approves the exact SHA-256. Provider
   identity, award, funding and scope hash are fetched again. A durable single-use
   claim and final serialized authority/freeze/kill check precede multipart
   `filedata` upload. File name includes the content hash. The response must match
   project, sender, recipient, name and byte size. It is an upload acknowledgement,
   not file-content readback, client acceptance or income.
6. **PROVIDER CONFIRMATION** — read-only milestone polling after confirmed upload;
   `cleared` remains non-cash evidence. Changed amounts/currency, disputes or
   adverse states require review. Evidence snapshots are appended and hashed.
   A stale concurrent observation cannot overwrite a newer dispute. Observation
   remains possible after revocation, but cannot authorize another external write.
7. **PAYOUT** — BLOCKED. No API withdrawal/remittance adapter, owner payout request
   or verified payout identity is installed. The owner cannot POST an invented
   amount or `settled` flag to advance this stage.
8. **SETTLEMENT VERIFICATION** — BLOCKED. A real receiving-provider adapter must
   independently establish the mission-owned account, received/available USD,
   provider remittance identity, attributable contract/milestone lines, fees,
   partials/FX/reversals and duplicate protections. No generic Stripe substitution.
9. **MISSION WALLET** — BLOCKED. This connector deliberately implements no
   `MoneyProvider`, earning-worker registration or cash-credit endpoint. Future
   verified settlement must enter the shared cash engine; allocation, expenses
   and withdrawals still require its existing owner/RBAC/budget/hold controls.

### Conservative scope limits

One work item per project/bid/milestone; one dedicated agent per provider account.
Multiple milestones/revisions, binary delivery, automatic work execution and
provider-specific settlement are not implemented. Additional agents can become
executable only when legitimate accounts, permissions and available contracts
actually exist—not by cloning account IDs or generating opportunities.

`dispatching` after a crash and `delivery_review_required` after uncertainty are
**not retryable**. Recreating the client/server, approving again or changing a
caller key cannot resend them. Pre-send failures also stay review-only rather
than risk resetting an ambiguous effect. The official project API documents a
`file_details` projection, but file-content readback and reliable uncertain-upload
matching are not validated here; there is intentionally no guessed reconciliation
endpoint and no owner JSON override. A future read-only verifier is needed for
safe recovery, not a blind POST retry.

## Configuration and owner API

Names only; place real values in the private mission's secret configuration,
never in chat, repository content or request bodies:

- `ZA141251SA_FREELANCER_ENABLED` — explicit opt-in; defaults disabled.
- `ZA141251SA_FREELANCER_USER_ID` — expected genuine provider user ID.
- `ZA141251SA_FREELANCER_ACCESS_TOKEN` — own-account **production** PAT.

The provider documents PAT expiry at 30 days and one active token per environment.
Sandbox tokens are environment-locked; the client uses only the production host,
never a caller-supplied base URL. Multi-user OAuth requires a separately approved
integration; this own-account client does not grant that permission.

Documented scopes: `basic`; `fln:user_information` for self;
`fln:project_manage` for bids/milestones; `fln:project_create` for project file
upload according to the Files documentation. No project creation method is
implemented. A token alone does not establish integration/automation eligibility.

All routes require the existing private mission owner session; mutations inherit
its CSRF checks. Scoped agent links cannot use these commands.

| Method/path under `/api/freelancer` | Input / purpose |
|---|---|
| `GET /` | Nine-stage status, explicit blockers, observed projects, account/work records. |
| `POST /discover` | `query`, optional `offset`; returns bounded provider-derived USD leads. |
| `POST /authorize-account` | `agentId`, `reference`, `expiresAt`, exact `checks` list from overview. Owner compliance attestation, not automatic KYC. |
| `POST /revoke-account` | Revokes configured account without deleting its historical binding. |
| `POST /assign` | `projectId`, `bidId`, `milestoneId`, `scopeReference`. Owner confirms that this exact project's activity is permitted software work and its client/AI/confidentiality/rights/fee requirements have been reviewed. |
| `POST /draft` | `workId`, actual `content`; never a budget/earning assertion. |
| `POST /approve-delivery` | `workId`, exact `contentHash`. |
| `POST /deliver` | `workId`; single-use authorized upload. |
| `POST /sync-milestone` | `workId`; provider evidence only. |

No bid/accept/withdraw/settlement/cash-credit commands exist. The separate mission
money worker's empty earning-adapter registry is unchanged and was not started.
A conservative local **20 requests/minute** cap is shared durably across mission
workers, with provider 429 cooldowns. This is a local safety cap, not a claim that
Freelancer grants every endpoint that quota. Requests have fixed host, no redirect
following, 15-second transport deadline and 2 MiB response limit. Provider error
bodies/credentials never enter normalized evidence or API errors.

## Source and test evidence

Official documentation reviewed 2026-09-20; no authenticated live provider calls:

- [Integration types and automatic-bidding restrictions](https://developers.freelancer.com/docs/api-overview/types-of-integrations)
- [Own-account personal access tokens](https://developers.freelancer.com/docs/authentication/personal-access-tokens)
- [Authenticated self](https://developers.freelancer.com/docs/users/authenticated-users)
- [Project search/detail and file_details](https://developers.freelancer.com/docs/projects/projects)
- [Bids and documented award-status filters](https://developers.freelancer.com/docs/projects/bids)
- [Milestones and documented status filters](https://developers.freelancer.com/docs/projects/milestones)
- [Working on a project, including multipart file delivery](https://developers.freelancer.com/docs/use-cases/working-on-a-project)
- [Managing a project and funded/released milestone examples](https://developers.freelancer.com/docs/use-cases/managing-a-project)
- [File-upload endpoint and scopes](https://developers.freelancer.com/docs/projects/files)
- [Endpoint-specific rate limits](https://developers.freelancer.com/docs/api-overview/rate-limiting)
- [Official SDK response fixtures](https://github.com/freelancer/freelancer-sdk-python/blob/master/tests/test_projects.py) establish list envelopes, including the milestone map. These and documentation are schema references, **not live contract verification**; a schema mismatch remains blocked.
- [Terms](https://www.freelancer.com/about/terms) and [fees](https://www.freelancer.com/feesandcharges) require account-specific review before work. No Pakistan-specific USD withdrawal approval or fee quote has been verified.

A stale-observation regression was first reproduced failing, then fixed and passed
on SQLite and native PostgreSQL. Tests cover disabled config, identities,
accepted/funded/foreign/disputed contract gates, exclusivity, expiry/revocation,
artifact hashes/limits, concurrent claims, crash/lost-response handling, final
kill/freeze checks, secret redaction, provider clearing≠cash, and owner-only API.
All fixture data is explicitly synthetic and isolated from production balances.
