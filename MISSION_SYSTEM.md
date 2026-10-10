# Private Mission System — deployment and operations

This document covers the **private mission application** that ships alongside the
platform in this repository. It is an operator document: the mission system is
deliberately invisible to platform users, to the public API and to public pages,
and nothing in this document is exposed through them.

> Scope note: the mission system and the platform (customer) business are two
> separate systems that share nothing at runtime — not a database, not a ledger,
> not a session, not a secret. Customer revenue is recorded only in the platform
> database; mission revenue is recorded only in the mission database. No ledger
> merges the two, and there is no cross-database join anywhere in this codebase.

## 1. What ships here

| Piece | Path | Purpose |
| --- | --- | --- |
| Mission schema | `db/migrations-mission/0001_mission.sql` | Dedicated database (agents, contracts, wallets, ledger, revenue, expenses, credentials, resources, upgrades, services, tools, targets, payout slots/payouts, approvals, audit, reports, policy) |
| Mission runtime | `src/mission/database.ts`, `policy.ts`, `auth.ts`, `treasury.ts`, `self-management.ts`, `reporting.ts` | Storage, policy gate, owner auth, treasury, agent self-management, reporting |
| Private HTTP app | `src/mission/server.ts` | Mission API + private dashboard assets on its own port |
| Private dashboard | `mission-dashboard/` | Owner console (vanilla HTML/CSS/JS, no external assets) |
| CLI | `scripts/mission-init.ts`, `scripts/mission-sync-registry.ts`, `scripts/mission-serve.ts` | Bootstrap, registry export, run server |
| Tests | `src/mission/*.test.ts` | 39 tests: isolation, policy, auth, audit/ledger integrity, treasury, payouts, self-management, HTTP surface, reporting honesty |

## 2. Isolation guarantees

* **Separate process and port.** `npm run mission:serve` runs its own HTTP server
  (`ZA141251SA_PORT`, default `4200`). The platform app never mounts mission
  routes and never serves mission assets: no shared router, no rewrite, no
  static path.
* **Separate database.** The mission runtime opens only
  `ZA141251SA_DATABASE_URL` (default `file:./mission.db`). It imports nothing
  from the platform database layer.
* **Separate authentication.** Mission owner accounts live in `mission_owner`
  with scrypt-hashed passwords; sessions are mission-local (hashed tokens,
  CSRF token, 12-hour expiry, rotation on every login). No platform session,
  JWT, cookie or API key is accepted. Platform `owner`/`super_admin` roles mean
  nothing here, and mission sessions mean nothing to the platform.
* **Separate secrets.** `ZA141251SA_SESSION_SECRET` and
  `ZA141251SA_CREDENTIAL_KEY` are mission-only. No platform secret is read.
* **Private by default.** The server binds `127.0.0.1`. A wider bind is an
  explicit operator action (`ZA141251SA_BIND_HOST=0.0.0.0` behind a private
  network or authenticated tunnel) and is refused unless a mission owner
  account exists.
* **No discovery.** No public page, sitemap, navigation entry, API response or
  document of the platform links to, or names the location of, the mission app.

## 3. Bootstrap

```bash
# 1. Mission secrets + owner account (values stay in the deployment secret store)
export ZA141251SA_DATABASE_URL="file:./mission.db"
export ZA141251SA_SESSION_SECRET="<32+ random chars>"
export ZA141251SA_CREDENTIAL_KEY="<32+ random chars>"   # enables the encrypted credential vault
export ZA141251SA_OWNER_EMAIL="owner@your-domain"
export ZA141251SA_OWNER_PASSWORD="<12+ chars>"

# 2. Create/upgrade the schema, policy singleton, tool catalog and payout slots
npm run mission:init

# 3. Optional: export the platform's specialist roster into the mission database
#    (reads the platform registry read-only, never writes to the platform, never
#     joins platform customer data at runtime)
DATABASE_URL="file:./<platform>.db" npm run mission:sync-registry

# 4. Run the private app
npm run mission:serve
```

`mission:init` prints exactly what is missing rather than inventing it: with no
owner variables it still migrates and reports `not provisioned — missing …`, and
if the vault key is absent it reports `credential storage disabled`.

## 4. Agent self-management

Agents may, within their contract and wallet budget:

1. **Discover** approved tools (`GET /api/tools`) — the catalog is default-deny.
2. **Request** a tool, resource, upgrade or expense (`POST /api/tools/request`,
   `/api/resources`, `/api/upgrades`, `/api/expenses`).
3. **Track expiry** — `GET /api/credentials/expiring`, `GET /api/resources`
   (`renews_at`, `expires_at`); the sweep reclassifies credentials.
4. **Rotate/replace credentials** — `POST /api/credentials/:id/rotate` (owner
   action; `verified` may only be set after a real provider call succeeded).
5. **Monitor usage/cost** — `POST /api/resources/:id/usage` records
   provider-reported counters; spend is capped by the wallet budget, the
   per-transaction ceiling and the daily ceiling.
6. **Maintain services** — `POST /api/services/:id/health` records health *with
   its source* (`provider-api`, `owner-check` or `agent-report`).
7. **Report** — every action above writes an immutable, hash-chained audit row,
   and `GET /api/agents/:slug/report` returns the full accounting picture.

Hard limits enforced in code, not by convention:

* spend above `require_approval_above_cents` is **queued**, never paid;
* the `card_or_bank_api` tool is **permanently blocked** — an owner action cannot
  enable it and re-seeding restores the block;
* an agent actor is refused at the library level for expense/resource/upgrade/
  payout/credential decisions (`403 forbidden`), independently of route auth;
* the kill switch suspends **all** activity, including otherwise-approved work.

## 5. Money

```
agent work → verified receipt → agent wallet → mission treasury
                                                    │
                       owner approval + verified destination slot
                                                    ▼
                                        payout (provider settlement ref)
```

* `mission_ledger` is append-only and hash-chained; a rewritten row breaks
  `verifyLedger()`.
* Revenue counts as **realized** only with `status = 'received'` **and** a
  verifier (`owner`, `provider-webhook`, `bank-statement`). Contracted and
  expected amounts are reported separately and never added to realized totals.
* Every revenue write requires an idempotency key; a replayed provider webhook is
  detected and reported as a duplicate instead of double-counting.
* `spent_cents` tracks operating expenditure only — internal transfers and owner
  payouts are movements, not spend, so budgets stay meaningful.
* Payouts require: an **active verified** destination slot, treasury funds, an
  owner decision, and a provider settlement reference. A failed payout returns
  the reserved funds to the treasury.
* **Four payout destination slots** exist (`1..4`). They can be labelled and
  left unconfigured indefinitely; storage keeps a masked hint and a provider
  reference, never a full account number.

## 6. Revenue KPIs

Targets are stored in `mission_targets` and displayed as **targets** with real
progress computed from verified receipts only. Aggressive figures (including
millions per day) are supported as *targets*. No code path can present a target
as an achievement, and no code path can create revenue: revenue rows are only
written from an owner action or a verified provider record.

## 6b. Payout destination verification (added 2026-09-15)

A slot is **not** payable just because it was configured. `POST /api/payout-slots/:slot/verify`
must be backed by evidence, and the flow enforces that in the library, not only in the route:

1. **Configure** the destination (`POST /api/payout-slots/:slot`) — a *provider reference*
   (`acct_…`) or a **masked** description (`****4821`). Full card numbers, IBANs (checksum-validated),
   long digit runs and credential material are **refused** at write time
   (`src/mission/destination-safety.ts`): the mission never holds instrument credentials and never
   asks for them. Four slots, exactly as before.
2. **Start** a verification (`…/verification/start`, or the same route with `startOnly=true`).
   The response lists the control checks that must be confirmed, including
   *“I control this destination”*, *“the masked details match my records”*, *“this is not a third
   party’s account”*, *“the provider completed its identity (KYC) verification”* and
   *“I have not entered full card/bank credentials”*.
3. **Confirm** (`…/verification/confirm`) with `checks: {…}` and an `attestation` of 40+ characters
   (stored verbatim). A partial submission is refused with `verification_incomplete` naming the
   missing checks; only then does the treasury flip the slot to `active` (one activation primitive).
4. **Expiry and change detection.** A verification is valid for `ZA141251SA_PAYOUT_VERIFICATION_DAYS`
   (default 180). Expired verifications — and verifications whose destination was repointed
   afterwards — are swept to `expired` and the slot is **paused**, so payouts stop instead of running
   on a stale assumption. `GET /api/payout-slots` sweeps on read and returns, per slot, the checks,
   expiry, staleness and the exact blockers.
5. **Revoke** (`…/verification/revoke`, reason required) pauses the slot immediately.

Agents can never perform any of these steps (owner-only, enforced in the library: `actorType: 'agent'`
is refused). Every step is audited (`payout_slot.verification_started|confirmed|revoked|expired|invalidated`).
Payouts still additionally require an owner approval and a provider `settlementRef` before money is
recorded as settled.

## 6c. Publishing connections — OAuth, prepared not faked (added 2026-09-15)

`GET /api/social/connections` reports, per platform (YouTube, Instagram, TikTok): whether an OAuth app
is registered (variable names only), the **exact redirect URI** to register, the minimum scopes, whether
a **real** connection exists, the granted scopes, and the token expiry. `POST /api/social/oauth/:platform/start`
returns the provider authorization URL (single-use, 10-minute, owner-bound, PKCE where the platform
supports it); `GET /api/social/oauth/:platform/callback` verifies the state, exchanges the code and stores
the tokens **encrypted** in the vault. Tokens are never returned by any read surface — only a masked hint
and the expiry are. An unregistered app answers `provider_not_configured` with the variables to set; a
provider rejection answers 502 with the provider's error code; a network failure answers `provider_unreachable`.
Nothing is ever marked connected without a real token, and no engagement figure is synthesized anywhere.

## 6d. PostgreSQL as the mission backend (added 2026-09-15)

`ZA141251SA_DATABASE_URL` selects the engine exactly like the platform does:

* `file:./mission.db` (default) → SQLite via `node:sqlite`;
* `postgres://…` → PostgreSQL through the same synchronous bridge the platform uses.

Isolation is unchanged (separate database, migrations, owner auth, treasury) — only the driver is shared.
Two engine details are handled explicitly: `rowid` does not exist in PostgreSQL, so the ledger orders
itself by an explicit `seq` column (migration 0004, backfilled for existing ledgers), and PRAGMA
statements are filtered out for PostgreSQL. Verify with:

```bash
npm run mission:pg-check     # real PostgreSQL (pglite wire protocol) end-to-end: 10 checks, 0 failures
```

## 6e. Fleet readiness, admission and evidence-gated verification (added 2026-10-09)

Registering 4,001 specialists is not the same as being able to earn with them, so the
mission now reports the difference from live rows instead of inferring it:

```bash
npm run fleet:readiness              # the eight counts, per-blocker blast radius, gates
npm run fleet:readiness -- --json    # same facts, machine-readable
npm run fleet:readiness -- --reconcile   # file one owner action per open blocker (idempotent)
npm run fleet:readiness -- --discover   # real read-only GitHub bounty discovery pass
```

`src/mission/earning/fleet-readiness.ts` answers, in order: agents registered · tools
valid and executable · execution-ready agents · agents with verified platform access ·
eligible tasks assignable · tasks assigned/in flight · tasks completed **with
evidence** · verified revenue in cents · settled payout cents. Each agent that cannot
start gets the blocker code that stopped it (`autonomy_disabled`,
`no_payout_slot_verified`, `no_platform_credential`, `no_provider_ready`,
`no_active_money_grant`, `no_scoped_contract`, `owner_action_pending`,
`kill_switch_engaged`) and a free or owner-side path through it. Fixture-origin
agents (`origin_platform='fixture'`) are counted separately and never satisfy a
production claim. Both work paths are counted — the engine's opportunity queue and the
GitHub-issue-bounty workflow (`bountyLeadsAccepted`, `bountyAssignments`) — so a
policy-checked bounty assignment is never reported as "no eligible tasks".

Two things changed in the execution loop itself:

* **Admission is no longer capped at an arbitrary number.** The allocator used to clamp
  every batch to `Math.min(50, limit)` and the scheduler asked for 5 per tick; nothing
  about safety depended on those numbers, they only throttled throughput. A cycle now
  admits every eligible work item up to `MAX_ITEMS_PER_CYCLE = 1000` (an anti-runaway
  bound), optionally narrowed by `ZA141251SA_MAX_AGENTS_PER_CYCLE`. Real concurrency is
  still bounded by what actually gates it: one exclusive agent per opportunity,
  `ZA141251SA_MAX_WORK_PER_AGENT` (default 3) simultaneous items per agent, the provider
  cooldown/rate tables, the policy spend caps and the owner safety gate. Candidate
  selection was moved into SQL (`candidateAgentsFor`), so a pass over a 4,001-agent
  registry is linear in *matching* agents rather than 4,001 × opportunities.
* **Result verification can no longer be self-attested.** The scheduler used to flip
  work to `verified` with hard-coded `passed: true` confidences — one of them from the
  agent that did the work. `src/mission/earning/result-verification.ts` derives the
  verdict instead: evidence must be content-addressed (sha256 of what was produced,
  recorded by the assigned producer only), a verifier may not approve its own output or
  the producer's submission, evidence that predates the assignment is refused, and an
  opportunity advances only when **two distinct independent verifiers** passed the exact
  same bytes. A verdict taken by fixture agents is stored as `mode='test_fixture'` and is
  not committable. `ZA141251SA_BOUNTY_SCOPE_REPOS` (default 10, ceiling 50) only widens
  how many already-allowlisted repositories one discovery pass searches.

## 6f. Execution prerequisites: four gates, then a pilot (added 2026-10-10)

Registering work is easy; running it honestly is not. Before an agent can execute an
earning task, four backends have to be genuinely present, and each one is *reported from
a live probe*, never from a config file wish. `src/mission/earning/execution-backends.ts`
aggregates them and derives `blocked[]`, so the readiness view says which gate is missing
instead of assuming the next one works:

```bash
npm run fleet:readiness -- --backends          # sandbox · model · GitHub · payout, probed now
npm run fleet:readiness -- --contracts         # per agent-class readiness + pending proposals
npm run fleet:readiness -- --contracts=bounty_execution
npm run fleet:readiness -- --contracts-approve=<proposalId>
npm run fleet:readiness -- --pilot=<opportunityId>   # durable chain for one real execution
npm run fleet:readiness -- --discover           # search + a live claim recheck per accepted lead
```

**Gate 1 — sandbox.** Two backends sit behind one `BountySandboxRunner`. The digest-pinned
OCI image (`.github/workflows/bounty-sandbox-publish.yml`) is preferred whenever a pinned
image is configured; where no container runtime exists, the fallback is a
user-namespace jail (`namespace-bounty-sandbox.ts`) that is only selected after
`probeNamespaceSandbox()` actually passes (util-linux ≥ 2.36, `max_user_namespaces` > 0,
a real namespace smoke test). It stages its own rootfs by ELF soname, denies `/etc`,
gets its own PID namespace and no network egress, records a per-run rootfs digest, and
refuses an unpinned rootfs when `requirePinnedRootfs` is set. Neither backend ever
accepts an image, path or archive chosen by repository content or model output, and
secrets are never placed in a child environment. `--backends` reports the OCI runner as
unavailable in an environment with no runtime rather than claiming a sandbox it cannot run.

**Gate 2 — model.** `chatDispatchReadiness()` (in `src/mission/chat-provider.ts`) reports
mode, model, dispatchability and blockers. A zero-cost deployment is enforced, not
encouraged: `assertVerifiedChatBillingConfigured` requires the free-tier flag, a model in
`FREE_TIER_MODELS` and a `free[- ]tier` cost basis, and refuses with
`verified_vendor_billing_not_configured` otherwise. Fallback selection already exists
(`priority` dispatch plus a `fallback` call status), so this gate reports eligibility
rather than inventing providers or credentials.

**Gate 3 — GitHub.** `githubBackendReport` checks credential *presence* only (the token is
never read back or logged) and attaches `GITHUB_SUBMISSION_REQUIREMENTS`: a fix is worth
nothing until something can be forked, committed and opened as a pull request. A token
that can only read third-party repositories therefore leaves submission as an owner
action, which is exactly what the readiness output says. Discovery-side, the archive
download now follows GitHub's `302` hop to `codeload` by hand (`ARCHIVE_REDIRECT_HOSTS`,
`ARCHIVE_MAX_HOPS`), because `redirect:'error'` made every archive fetch fail for every
repository and `redirect:'follow'` would forward the `Authorization` header to a CDN.
Each hop is validated against the allowlist and sent without credentials.

**Gate 4 — payout.** `payoutBackendReport` states the supported rails
(`bank · wallet · payment_provider · other`), the two accepted verification methods
(`owner_attestation`, `provider_reference`), the evidence each check must satisfy
(`destination_controlled`, `details_match`, `not_third_party`,
`provider_identity_verified`, `no_instrument_credentials_stored`), and the expiry sweep
(`ZA141251SA_PAYOUT_VERIFICATION_DAYS`, default 180). Only a provider reference and a
masked account are stored. No code path moves money or marks a payout settled.

**Least-privilege contracts are prepared, never granted en masse.**
`src/mission/earning/agent-class-contracts.ts` defines five classes —
`bounty_research`, `bounty_execution` (which additionally requires a configured sandbox),
`evidence_verification`, `owner_submission` and `payout_release`; the last two are
owner-only and cannot be auto-granted. Preparation writes a proposal to
`mission_agent_contract_proposals` (migration 0047) with the class's exact permission
allowlist, spend ceiling and resource limits; the owner's `--contracts-approve` turns it
into the live row in `mission_agent_contracts` after re-checking the proposal against the
current class definition, so a widened permission is rejected (`proposal_permissions_widened`).
`mission_agent_contracts` stays the only money-grant authority, proposals expire after 14
days, one `manual_approval` task is filed per batch, and the fleet's `scopedContract`
count deliberately stays 0 while a proposal is pending — readiness reflects what is true,
not what has been requested. Eligibility of the four non-owner classes is checked per
agent (sandbox, model dispatch, credential, contract status), so an agent that lacks a
prerequisite is reported as blocked rather than launched.

**Execution is refused without a fresh, payable claim.** `github-bounty-eligibility.ts`
resolves every lead to `payable`, `not_payable` or `unverifiable` — fail-closed — and
`assign`, `queueExecution`, `executeJob` and `submit` each call `requirePayableClaim()`,
which denies a stale verdict. Being *accepted by discovery* is not the same as being
payable: the claim recheck re-reads the issue's live state, its assignees and the
comments that carry the maintainer's hand-out, because a bounty already promised to
someone else is not ours to work. `no:assignee` in a search query is only an efficiency
pre-filter; it never substitutes for that recheck.

What this has actually been demonstrated on: the jail was probed and run here (node
executes inside it, host `/etc/passwd` is denied, egress is blocked, a deliberately wrong
fix fails verification and the correct fix passes); the fleet report ran against a live
copy of the mission database; and an operator-authored repository check was executed
against the real published archive of this repository through the jail, end to end —
download, bounded body read, inspection, staged patch, in-jail test run — with the
archive sha256, inspection digest and verification digest recorded. That harness *refused*
a first version of the check whose assertion failed, which is the behaviour a verification
gate has to have. It is an operator-authored check, not model-generated work, and the
repository's own test suite cannot run inside the dependency-free jail; both are stated
rather than hidden. No submission was made, because no legitimate unclaimed payable
GitHub bounty existed in the pool at the time of writing — the pipeline's correct output
for that pool is a refusal.

## 7. What still needs an external action

Nothing in this system fabricates accounts, credentials, payments or results.
The mission dashboard lists the outstanding activations (`requiresExternalActivation`):

| Provider | External action | Why it is required |
| --- | --- | --- |
| Model provider | Set `GOOGLE_API_KEY` (or the platform's configured provider key) in the deployment secret store | Real inference is refused with an honest `provider_not_configured` error until a key exists |
| Search provider | Set `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY`, or `AKBARAL_SEARCH_ENDPOINT` | Without a key the keyless fallback may be unavailable |
| Payments | Connect the payment provider and set its webhook secret | Revenue may only be recorded as received against a verified provider/webhook reference |
| Payouts | Configure **and verify** at least one of the four slots (dashboard → Treasury & payouts → *Verify / re-verify*: confirm every control check and sign the attestation) | Payouts are refused until an evidence-backed, unexpired verification exists; agents cannot perform this step |
| GitHub submission | A token that can fork, write contents and open pull requests: either flip **Administration → Forks → Allow fork privileges** on the target repository and grant `Contents: read/write` + `Pull requests: read/write` on the fork, or issue a classic token with `public_repo` | Reading issues, policies and archives works today; submitting a fix is refused without it, and the system will not submit under the owner's read-only credential |
| Bounty sandbox image | Publish (or point `ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST` at) the digest-pinned image from `.github/workflows/bounty-sandbox-publish.yml` | Without a container runtime or a pinned image the jail fallback is used; an unpinned image is refused rather than trusted |
| Social platforms | Register one OAuth app per platform (dashboard → Publishing shows the exact redirect URI `https://<domain>/api/social/oauth/<platform>/callback` and the variables), then *Connect* | Publishing returns `provider_not_configured` until then; a connection is reported only after a real token exchange, and engagement metrics are only ever read from the platform API |

## 8. Operations

* **Rotate a credential:** dashboard → Tools & credentials → *Rotate*, or
  `POST /api/credentials/:id/rotate`. The new value is encrypted immediately; the
  rotation row records the reason and whether a provider call verified it.
* **Sweep expiry:** `POST /api/credentials/sweep` reclassifies
  `active → expiring → expired`.
* **Pause everything:** dashboard → Policy → *Engage kill switch*, or
  `POST /api/kill-switch`. Every activity check then fails closed.
* **Read-only access for an authorised agent:** dashboard → issue an access
  link (`POST /api/access-links`) with scope `dashboard:read` (or `agent:self`
  bound to one agent). Links can carry an expiry and a use budget, and can be
  revoked at any time; the token is shown once and stored only as a hash.
* **Verify integrity:** `GET /api/audit/verify` (audit chain) and
  `GET /api/treasury` (ledger chain) return the verification result; the
  dashboard shows both on the Overview tab.
* **Ask what the fleet can actually do:** `npm run fleet:readiness`. Read-only; it
  never starts work, spends money or writes a completion record. Add `--reconcile` to
  file the open blockers into the owner's human-action queue (one task per blocker,
  re-running creates nothing new while the same blocker stays open).
* **Read one execution's chain:** `npm run fleet:readiness -- --pilot=<opportunityId>`
  prints the durable record for a bounty execution — archive digest, inspection report,
  proposal and verification digests from `mission_bounty_execution_jobs` plus every
  `mission_bounty_events` row — so a claim about a run can be checked against the bytes
  that were produced, not against a status column.
* **Check a paid claim against its proof:** `mission_execution_evidence` holds the
  content-addressed output per assignment and `mission_result_verifications` holds who
  reviewed which bytes; an opportunity with no evidence row stays `executing`.

## 9. Honesty rules encoded in the product

* No fabricated engagement, users, revenue or results anywhere; empty states say
  "no data yet".
* Targets are labelled as targets; unrealized amounts are labelled as not earned.
* A settlement, a rotation verification or a health claim is only recorded with
  the provider reference or the source that produced it.
* Failures never report success: a rejected policy check, a refused payout or a
  failed provider call surfaces as an error with the reason, and money is
  returned to the treasury.
