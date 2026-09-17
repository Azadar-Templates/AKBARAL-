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

## 7. What still needs an external action

Nothing in this system fabricates accounts, credentials, payments or results.
The mission dashboard lists the outstanding activations (`requiresExternalActivation`):

| Provider | External action | Why it is required |
| --- | --- | --- |
| Model provider | Set `GOOGLE_API_KEY` (or the platform's configured provider key) in the deployment secret store | Real inference is refused with an honest `provider_not_configured` error until a key exists |
| Search provider | Set `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY`, or `AKBARAL_SEARCH_ENDPOINT` | Without a key the keyless fallback may be unavailable |
| Payments | Connect the payment provider and set its webhook secret | Revenue may only be recorded as received against a verified provider/webhook reference |
| Payouts | Configure **and verify** at least one of the four slots (dashboard → Treasury & payouts → *Verify / re-verify*: confirm every control check and sign the attestation) | Payouts are refused until an evidence-backed, unexpired verification exists; agents cannot perform this step |
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

## 9. Honesty rules encoded in the product

* No fabricated engagement, users, revenue or results anywhere; empty states say
  "no data yet".
* Targets are labelled as targets; unrealized amounts are labelled as not earned.
* A settlement, a rotation verification or a health claim is only recorded with
  the provider reference or the source that produced it.
* Failures never report success: a rejected policy check, a refused payout or a
  failed provider call surfaces as an error with the reason, and money is
  returned to the treasury.
