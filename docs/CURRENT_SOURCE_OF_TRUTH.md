# AKBARAL! current source of truth

> Implementation continued after the reconstruction checkpoint. See [implementation progress](IMPLEMENTATION_PROGRESS.md) for subsequent fixes, measured tests, and remaining work; the dated evidence below is retained, not silently rewritten.

**As of 2026-09-19 (UTC).** This document supersedes older reports **for current status**, without deleting their historical evidence. It distinguishes code, historical claims, current tests and production proof. Supporting appendices: [complete recovered commit chronology](PROJECT_HISTORY.md), [source inventory](SOURCE_INVENTORY.md).

## Interruption-safe continuation

Use [the resumable implementation procedure](RESUMABLE_IMPLEMENTATION.md) and `npm run test:status` before starting another full suite. The later integrated checkpoint at `43145c0` passed 845 tests and is recorded in the implementation progress document; the reconstruction-era counts below remain historical.

## 1. Recovery boundary and exact continuation point

- Session branch: `arena/01a0ba0a-akbaral`. Initial HEAD: `a924e4a98cf16af439149bf0e29ca15fb6298fda` (PR #7 merge). Initial working tree: clean; no uncommitted changes to preserve.
- Clone initially shallow; `git fetch --unshallow origin` and a fetch of all advertised branches/tags recovered 197 reachable commits and 13 remote branches, back to root `6c3a544` on September 7. No tags/releases, unreachable objects, issues or GitHub deployment records were returned at the initial inventory. The separately advertised synthetic PR #8 merge `d0b1856` was also fetched and inspected (same tree as `dbd712e`); this is an additional merge object, not new implementation. The earlier SHA `ecca9be` mentioned in PR #3 remains unavailable (fresh GitHub lookup: 422). Local reflogs start with this checkout, not Day 1.
- **Latest recoverable prior Arena stopping point: `2df861730f686ccfad6327525e90ef5ec8ca1b24`, September 19 12:44:30 UTC, remote `arena/01a0b74e-akbaral`.** Its final work was exclusive 1:1 agent/platform/account assignments, dispatch binding, and a 194-row evidence catalog. Commit notes claim earning 12/12, primary 9/9, 83-file suite, typecheck and secret scan passed. Docker publication run [35443728314](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35443728314) succeeded; it is not a production deployment check.
- This session fast-forwarded **its existing branch** to that descendant commit. Eight recovered commits and all their source/tests/migrations are preserved. No reset, checkout to another branch, rebase, discard, force push or production database mutation was performed.
- Sibling `arena/01a0b101-akbaral` holds earlier Webpack work and temporary Gemini CI history (PR #8 open); `arena/01a0b101-akbaral-remote` holds installation diagnostics. Their history was inspected. The later `505026b` supersedes the build implementation; temporary workflows were intentionally not restored.
- Original private prompts/Arena transcripts and unpushed prior files are not exposed by this repository/API. An exact conversational stopping point or undisclosed next catalog-batch request **cannot be recovered**. The continuation target supported by source is preserving the full workforce and closing demonstrated production gaps, not inventing thousands of earning accounts.

## 2. Day 1 → today: phase reconstruction

Intent below is inferred only from commit messages, source and reports. Per-commit paths, migrations, test changes and available CI results are in the chronology. Historical numbers are not this session's results.

| Day / UTC date | Recorded intent and implementation | Tests / failures / fixes in available evidence | Remaining / production status |
|---|---|---|---|
| 1 / Sep 7 | `2b3bc75` database foundation; `caffd9b` auth/research/credits/realtime; `ee36707` registry/orchestrator/tools/Factory/marketplace/CRM/mobile; configuration/security hardening. SQLite 0001–0004. | Realtime/SSE, FTS, SSRF, tenant checks, production secrets and seed fixes recorded through `0824fee`; reports retain local checks. | Earliest root is Sep 7; pre-root work unknown. No current host proof. |
| 2 / Sep 8 | Premium web/mobile redesign, trust/feedback (0005), Next App Router conversion, native JSX. | Fixes include preview storage/no-JS rendering, stale assets, missing stylesheet and Turbopack module format (`b53794d`). | No independent retained CI run for this day; visual reports are historical. |
| 3 / Sep 9 | Restored earlier tree, MASTER milestones M1–M11: real analysis/verification/synthesis, tools, durable queue, workspace scope, Factory benchmarks, reviews, billing, security, backup/metrics. 0006–0008. | Commit claims progress through 178/178 billing, 192/192 security, 200/200 deployment/QA; seed and UI/API contract fixes recorded. | A report's GO verdict is not live hosting/payment proof. |
| 4 / Sep 10 | Web/mobile task center and push (0009), durable automation (0010), OAuth/account linking (0011), USD/six-tier pricing (0012–0013), design system. | Hydration/script DOM mutation, legal modal, overflow and cross-tab refresh bugs fixed. | Mobile source/exports are not store release/signing proof. |
| 5 / Sep 11 | Responsive design, zero-cost hosting exploration, GHCR publishing, dual SQLite/PostgreSQL database (`b7debed`), Neon/Modal wrapper. PG 0001–0013. | Reports/commits claim SQLite 254/254, PG 15/15, viewport matrix; fix PG JSON-key quoting (`04e37a2`), stale image cache/digest annotations and shell backup arithmetic. | Oracle/ClawCloud paths encountered historical availability/signup blockers; provider marketing assumptions in old docs are not current guarantees. |
| 6 / Sep 12 | Public route/catalog/contact/feedback completion, owner economy (`60a9a9c`, 0014 both dialects), provider hardening, real output states, preview supervisor. | Claims 260/260 then 265/265; missing-provider errors made explicit; retired Gemini model and supervisor issues fixed. | Economy separate from user billing, but real earnings/providers not proved by source. |
| 7 / Sep 13 | External verification CI, hosting pivots Modal→Render→Zeabur→SnapDeploy; owner identity/chat/windows/hierarchy (`4a13b0`, 0015). | Disabled Modal workspace, card gates, env scanner behavior and preview failures documented; user-journey/search fixes (`637f66`). | Permanent host and external integrations remained blockers at those snapshots. |
| 8 / Sep 14 | MASTER Builds 3–5: versioned website artifacts/attachments, owner unlimited entitlement, transfers, workspace redesign, SSE-only option. 0016 both dialects. | Build #4 report claims 443 tests / PG 22; source records SSE/auth URL/header fixes and secret scan race fix. | Fixture-delivered websites are not proof of current real provider execution. |
| 9 / Sep 15 | Owner analytics; **standalone mission** app/DB/auth/treasury/dashboard (`6a0960`), payout verification/social OAuth/mission PG (`c6267d4`), compact emerald application shell and auth/responsive UX. Mission 0001–0005. | Task 2/3/4 reports retain smoke evidence, mission PG 10/10, artifact 27/27 and shell checks. Publishing credentials/payout destination still owner-gated. | Standalone mission is not the in-platform economy. Keep their identities/databases/ledgers isolated. |
| 10 / Sep 16 | Launch audit; hierarchy/budget/freeze gates (platform 0017), paid-plan escalation/webhook settlement fix, deep-link refresh, single mission identity (mission 0006), reinvestment/daily target (mission 0007), fleet/owner/recovery verification. | Old final status claims 703/703; image-build failures were fixed (`48e7d2`); early production-verify runs failed, later image/fixture jobs passed. Recovery unreadable-DB bug fixed. | Sep 16 final report explicitly says no permanent production URL. Image and fixture tests must not be relabeled live production. |
| 11 / Sep 17 | PRs #1–7 land StackHost deployment/startup changes; direct Node start, persisted generated session secret, YAML list, registry startup ordering, plain npm ci. Sibling Webpack and memory diagnostics start. | PRs document silent 2–3 second startup/install failures and local reproductions; PR #8's earlier Webpack memory claim is superseded by later measurements. | Local memory/startup tests do not verify the actual StackHost account/container. |
| 12 / Sep 18 | Temporary real-Gemini CI verification (`62bc032`→`da7bb58`→`dbd712e`). | CI annotation showed wrong-user credit assertion failure despite green job; fixed query rerun shows 2 consumed credits, no refunds, completed MASTER and provider fallback after 503. | Historical credential presence is proved in that runner, not current secret availability. Temporary workflow subsequently removed. |
| 13 / Sep 19 | Memory-capped build `505026b`; workforce `261807c` (0018); staging/alerts/cost/delegation/images `c576bc4` (0019); catalog/payment/reinvestment/handoff `7c8064e` (0020); exclusive primary mappings `2df8617` (0021). | Historical workforce CI reached Google but marked missing-search output verified; cost discrepancy (model 1c/execution 0c) subsequently addressed in `c576bc4`. Final commit reports full SQLite suite green. **All four new migrations missing on PG; webpack script also missing runtime assets**, reproduced this session. | Continue with parity/build regression fixes below. No assertion of real income, all-agent live execution, external account provisioning or production completion. |

## 3. Current system map and preservation contract

| System | Authoritative source | Meaning / boundaries |
|---|---|---|
| Web, routes, design, mobile | `src/app/**`, `public/app.js`, `public/styles.css`, `design-system/**`, `mobile/**` | Next App Router hosts shell + public/auth/owner/admin routes; legacy hash navigation remains. Tests cover deep links, UI contracts, responsive controls and workspace artifacts. See inventory for every route. Mobile signing/release unverified. |
| API and lifecycle | `src/app.ts`, `src/index.ts`, `src/routes/**`, `src/server/**`, `scripts/start-{dev,prod}.mjs` | Express API, background queue/schedulers, separate web/API role/PORT handling. Owner-only workforce/economy routes preserve RBAC. |
| MASTER / tasks / projects | `src/orchestrator/**`, `src/db/{repositories,platform-repositories}.ts`, `src/routes/workspace.ts` | Analyze → plan → specialist/tool execution → verification → synthesis → artifacts; explicit deterministic/LLM modes; scoped membership/files/knowledge, cancellation/retries/refunds. |
| Registry / Factory | `src/agents/{catalog,registry}.ts`, `src/orchestrator/factory*.ts`, `scripts/audit-registry.ts` | 4,001 generated platform definitions (4,000 specializations + flagship), plus possible persisted Factory agents. Definitions, active profiles and live-tested executions are different counts. `registry-audit.json` is a historical snapshot, not present provider readiness. |
| Auth / isolation | `src/auth/**`, `src/security/**`, server middleware and security tests | Session/OAuth, tenant/owner checks, SSRF, secret scanning, owner unlimited entitlement. Workforce service sees only explicitly staged owner items. Never import mission credentials into platform customers. |
| Billing | `src/billing/**`, credit/trust DB repositories, Stripe HTTP tests | Plans/credits/invoices, confirmed provider settlement, refunds/idempotency. User billing does not fund the private economy automatically. |
| In-platform economy | `src/economy/**`, `src/db/economy-repositories.ts`, `/api/economy/*` | Discovery/evaluation/authorization/execution/ledger, hierarchy budgets, kill/freeze controls, approvals, treasury and owner chat. |
| Workforce | `src/workforce/**`, `src/routes/workforce.ts`, platform 0018–0021 | 21 earning categories, capability overlays, consented comms, risk/source/workflow health, owner alerts, staging, image approvals, wallets/costs/delegation. Autonomy is not enabled by these recovery fixes. |
| Earning inventory / assignment | `db/seeds/earning-platforms.json`, `src/workforce/platforms.ts` | 194 recorded rows: 6 verified, 179 candidates, 9 rejected; only 185 are importable. Rejected rows remain as evidence but are excluded from import. “Verified” means recorded payout-terms evidence, NOT current enrollment, approved API access, paying task or income. Candidates need official recheck. Exclusive primary agent/platform/property keys supplement older nonexclusive support hints. |
| Delivery payments / reinvestment | `src/economy/treasury.ts` | Verified delivery + operator evidence records revenue; proposals/approvals allocate realized surplus in the ledger. An internal `executed` allocation is not a bank/payment-provider receipt. Concurrency/failure atomicity remains an audit item. |
| Standalone ZA141251SA | `src/mission/**`, `mission-dashboard/**`, `scripts/mission-*`, `db/migrations-mission/**`, `MISSION_SYSTEM.md` | Separate app/server, DB URL, identity lock, policy, hash-chained audit/ledger, payout attestation/social OAuth. All 7 mission migrations retained unchanged. |
| Models / tools / providers | `src/models/**`, `src/tools/**`, `src/integrations/**`, `src/config/**`, `.env.example`, workforce integrations | Server-side provider/env configuration, explicit not-configured/error paths, provider routing/fallback, usage/cost records. Presence checks are not credential/API verification. Never fabricate missing keys. |
| Persistence / hosting | `src/db/{database,migrate,pg-worker,pg-connection}.*`, `db/migrations*`, Docker/StackHost/Modal/runbooks | SQLite for local tests; PG/Neon via synchronous worker bridge. Deploy artifact must include both `.mjs` worker assets. Runtime DBs and backups are not Git history. |

## 4. Current-session implementation and verification

**Implemented and locally verified.** The completed parity/build work is committed on the session branch; remote CI/deployment results remain separate evidence.

1. Recovered history and integrated prior workforce source without losing original commits.
2. Added failing tests reproducing missing PG twins (0018–0021) and `build:webpack`'s missing worker-copy step: **3 tests failed before fixes**.
3. Added PG twins `0018`–`0021` (21 migrations per platform dialect), restored runtime-worker copying in `build:webpack`, replaced SQLite-only `rowid` ordering in owner alerts/image briefs, added migration/build regression gates and eight engine-neutral workforce behavior/upgrade tests. All existing SQLite/mission/applied PG migrations are unchanged.
4. Added `.github/workflows/verify.yml`: full SQLite suite, types/secret scan, platform/workforce PG, standalone mission PG, Webpack build and compiled-worker check, without production secrets or provider/payment calls.
5. Upgrade tests construct a 0017 database/schema, preserve its historical rows/checksums and nondefault owner policy, apply exactly four new migrations and verify an idempotent rerun. Only default-valued workforce caps change; autonomy/spending freezes remain as configured.
6. Test/runtime data stays in ignored paths. No production migration, provider call with owner secrets, external account creation, payment, payout or autonomy enablement is authorized or claimed by these local tests.

### Measured checks (this session, not old report counts)

| Check | Result |
|---|---|
| `npm ci` on Node 22.22.3 / npm 10.9.8 | Pass; locked dependencies installed |
| Missing migrations/build-copy regression, before fixes | 3/3 failed as expected; PG reproduction failed with `relation economy_platforms does not exist` |
| `npm run typecheck`, `npm run scan:secrets`, `git diff --check` | Pass |
| `npm test` (86 files after additions) | **803 passed, 0 skipped, 0 failed**, 803 tests across 86 files; exit 0. PG-only suites are disabled in this command; their 22 cases run separately below |
| Focused migration/build/workforce tests on SQLite | 11/11 pass |
| `PG_TEST_DATA_DIR=logs/reconstruction/pg-final-clean npm run test:pg` | 22 existing + 8 new = 30/30 pass, no skips |
| PG upgrade/behavior suite on retained 0017 reproduction DB | Pass; additive migration path exercised, plus isolated 0017 upgrade preservation test |
| `npm run mission:pg-check` | 10/10, 7 mission migrations, audit/ledger chain checks; test fixture funds only |
| `npm run build:webpack` and `npm run build` | Both pass; 27 Next routes. Turbopack warns about whole-project tracing in existing `src/app/assets/[file]/route.ts` |
| Compiled PG worker (`node scripts/pg-test-server.mjs --run node dist/src/db/migrate.js --status`, same test DB directory) | Pass; all 21 applied, none pending |
| Fresh local `db:seed` + `audit:registry` | 4,001 distinct contracts and DB slugs; 0 failed contracts, **4,001 NEEDS_CONFIGURATION / 0 ACTIVE** in this environment |
| Local production-mode startup + HTTP smoke | 35/35: 24 page/metadata routes, health/readiness through Next proxy, public 4,001 count, registration/login, anonymous 401 and ordinary-user 403 on owner/economy/workforce. This is HTTP/SSR evidence, not browser/device QA |
| Offline launch check in the shell (not the startup wrapper environment) | Reports 6 configuration blockers, 33.3% required readiness; exits 0 even with blockers. Generated runtime session secret is not exported to this separate command. No claim of readiness from exit status |

### Failures encountered and resolved / bounded

- First suite attempt reached the secret scanner and failed on a bearer-shaped historical example introduced by the generated history appendix. The example was removed; no scanner exemption or weakened rule was added. This attempt is **not** claimed as a clean baseline pass.
- Initial PG runtime checks found missing schema, then the `rowid` lookups. The latter are now portable and directly exercised.
- PGlite socket 0.2.11 mis-synchronizes consecutive **parameterized expected-error** queries. Reproduced independently with plain `pg.Client` (unexpected rowDescription/empty result); deliberately failing raw UNIQUE tests use escaped fixture literals via the simple protocol. Normal repository paths remain parameterized. This harness limitation is not disguised as a Neon failure or skipped uniqueness test.
- New upgrade-test expectations were corrected for new policy columns and SQLite null-prototype rows; assertions still require every old policy value/checksum/history record to survive.
- A repeated PG run initially counted 4,004 agents because an earlier draft test had left three fixture agents. Cleanup now removes only this run's fixtures. A new isolated PG database passed 30/30; the earlier failed DB is retained locally rather than destructive reset.
- Earlier partial full-suite attempts are not added together as a passing run. The final full-suite verdict above comes from one complete final run.

## 5. Production verification: evidence and limits

- **Current production deployment and production DB state: UNVERIFIED.** Current sandbox probes (2026-09-19 14:36 UTC) to all three committed `/api/ready` targets failed TLS with curl exit 35 / HTTP 000. This cannot distinguish sandbox egress restrictions from host failure. No reachable runtime has yet been tied to this session's eventual SHA. The committed target list contains an old ephemeral E2B hostname, DuckDNS and Modal, not proof of a healthy permanent host.
- Historical Gemini runner evidence: [35404459578](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35404459578) shows completed real-model MASTER workflow, 2 credit consumptions, no refunds; it also records transient Google HTTP 503s and fallback. Prior [35404278875](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35404278875) was green despite a credit-verifier FAIL annotation. Job conclusion alone is insufficient.
- Historical workforce evidence: [35418000851](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35418000851) says `PROVIDER=google`, model succeeded and output tokens, but output says search prerequisites missing; `DELIVERY_VERIFIED=yes` is not proof that requested research was delivered. The then-recorded model cost was 1c versus execution cost 0c; later cost fixes exist, not a fresh live re-verification.
- Latest keep-alive [35447924080](https://github.com/Azadar-Templates/AKBARAL-/actions/runs/35447924080) skipped both production ping steps and ran “Not configured yet”; its green conclusion is not a heartbeat.
- Actions log download attempted, blocked with EOF; job/step/check annotations remained accessible. GitHub secret-list request denied (403 integration permission); no secret values were requested or stored. This does **not** establish an empty secret store. Git fetch/push/API access otherwise works.
- Historical tests/smokes, catalog evidence and model access do **not** establish actual revenue, payments, social account permissions, production isolation behavior or 4,001 simultaneously earning workers.

## 6. Explicit next work / unresolved risk

- Review this session branch’s remote verification run and merge/deploy only through the operator’s normal process. Never enable autonomy merely because an image build succeeds.
- Tighten workforce deliverable verification so missing-prerequisite/refusal output cannot masquerade as completed customer work; rerun honest search+model checks only with authorized configuration.
- Audit assignment lifecycle enforcement at dispatch/reassignment/execution: stored paused/revoked/account-pending status must not be confused with publishing permission. Primary uniqueness is not sufficient runtime authorization.
- Audit money operations for transactional rollback and multi-process races; a uniqueness constraint after ledger writes alone is not proof of atomic exactly-once settlement. Do not turn an allocation into a fabricated external payment.
- Catalog growth must cite real sources and retain rejection/candidate status; no target count justifies invented opportunities/accounts. Bind accounts only after owner-created legitimate enrollment/permissions.
- Verify owner-facing reachability for newest catalog/primary/payment/reinvestment functions (backend implementation does not itself prove UI/API coverage).
- Run fresh browser/device and mobile release checks when available; source-contract tests do not replace rendered UX testing.
- Production operator must identify the current host and deployed SHA, review backups/migration status, configure providers/accounts via secret storage, deploy/pin the tested image and verify real runtime/auth/tenant/mission/financial behavior. No deployment claims until evidence exists.

## 7. Continuation update — provider-call controls and private chat

The subsequent implementation now includes owner-only quota-call review/reconciliation, atomic provider financial holds protecting mission cash/spend authority, separate evidence-backed charge accounting, and a durable opt-in Google text-reply worker. The worker uses a fixed provider endpoint and scoped encrypted credential, reserves quota/budget before single dispatch, never executes message commands, and retains uncertain exposure instead of fabricating a reply or replaying a provider operation. Configurations/job history are accessible through the owner dashboard/API; historical messages are never retroactively queued. See `MISSION_CHAT_WORKER.md` and chronological `IMPLEMENTATION_PROGRESS.md` for exact commits and validations.

Current additive mission schema: **15 migrations**. Fresh current-source validation passes **186/186 mission SQLite tests** and **74/74 retained mission PostgreSQL tests** (24 financial, 18 quota/owner, 10 budget, 14 chat, eight period). The compiled production artifact reports all 15 applied, none pending, and intact retained audit/ledger chains; production Webpack/backend build produces **27 routes**. The real Chromium harness passes **17 desktop/mobile-viewport checkpoints** against isolated synthetic HTTP/SQLite fixtures. PostgreSQL parity is not independent-session contention evidence; mobile emulation is not a physical-device, Safari or hosted-deployment claim. See `MISSION_BROWSER_CHECK.md` and `MISSION_RESOURCE_PERIODS.md`. These are mission-focused results, not a new whole-project integrated suite.

Still open: broader unrelated provider-path enforcement and provider-specific external self-funding activation, further verifiable opportunity expansion, deployment/worker liveness and authorized live provider/payment verification. Current pricing/model availability were not live-verified. Internal reservations are not provider-enforced hard billing caps. No new real earnings, purchases, API activation or deployment readiness are claimed. Existing customer/mission separation, 4,001 contracts and historical evidence remain preserved.

## 8. A→Z readiness audit continuation

See [the 2026-09-19 audit](READINESS_AUDIT_2026_09_19.md) for current route/runtime observations and the full 12-area boundary. Actual recovery point was pushed `1c6a2e3`, newer than requested `5a2f6ed`. Fresh registry: 4,001 contracts, 0 active, 4,001 require configuration. Actual runtime environment's offline launch check reports **seven required blockers**, not production readiness. The preview's local HTTP works but its processes predate the newest build; external E2B retrieval is traffic-token gated, and no standalone mission listener is running.

The audit reproduced and fixed a real standalone mission dependency on the eager platform DB singleton. `src/db/driver.ts` now contains the connection-free shared implementation; the platform facade and private connection remain separate. Three new isolation regressions plus existing focused DB/bridge/parity checks pass **22/22**; types/secrets/diff pass. This does not replace the retained 186/74 mission and 17-browser evidence with a new full-suite claim. Next bounded verification is compiled/PostgreSQL driver-split coverage, followed by readiness-worker lifecycle checks.

Driver-split follow-up: backend rebuild/runtime assets and compiled private bootstrap pass with customer storage unavailable. Separate retained PostgreSQL stores pass **46/46** focused tests (24 mission financial + 22 platform integration), both harnesses exit 0. Compiled platform sees 21 migrations; mission sees 15/zero pending with audit and ledger intact. Next is the operational readiness worker-lifecycle regression, not another unchanged full mission suite.

Operational audit fixed three reproduced monitoring issues: stopped execution queue falsely ready, wrong migration directory under PostgreSQL, and admin metrics failing on a SQLite-only size query. **25/25 SQLite health/queue + 7/7 retained PG HTTP monitoring** pass; the PG CI command now includes health tests. No live preview restart occurred. Its healthy old process must not be relabelled latest-source or production-ready. Next: private bootstrap/diagnostic connection-URL redaction, then final compiled/runtime/Git check.

Private bootstrap and DB diagnostics now redact PostgreSQL userinfo, all query options and fragments, including malformed targets; raw credentials are no longer printed before connection. Original connection configuration is not changed. **21/21** cache-disabled focused redaction/isolation/bridge tests plus types/secrets/diff pass. Next is final backend compilation/compiled monitoring and retained mission integrity, then exact remote/runtime reporting.

**Current preview supersedes the earlier stale-runtime warning:** guarded refresh at 19:09:27 UTC onto verified tree `7298227` / code `3ca0c23`, after an integrity-checked online DB backup and session-configuration comparison. Managed process `akbaral-public-platform-36076c94`; web 3000/API 4000. **36/36 local HTTP checks**, readiness now `started=true, activeWorkers=0`; ten financial tables unchanged by row/content hashes. Same users/registry/database/session secret, no reseed/reset. External E2B access remains traffic-token gated, standalone mission is not running, and the actual runtime still has seven required launch blockers. See the audit's current-runtime section and retained manifest. Next: final private-server HTTP regression, exact remote/CI check and bounded readiness report.

Final focused private HTTP check: **33/33** pass after all audit fixes (`logs/readiness-audit/final-mission-server-02.log`). Current tree has 101 test files; no new full integrated-suite/browser run is claimed from the overlapping focused batches. All five demonstrated audit defects are fixed; the current preview preserves financial/session state and runs the verified code. Follow-up commits after deployed tree `7298227` are documentation-only. **Production remains blocked by seven actual runtime configuration checks.** Next exact action is to inspect Verify for the final pushed checkpoint, not repeat completed work; then obtain operator-owned deployment/provider/private-mission configuration and live proofs. Full boundary: `READINESS_AUDIT_2026_09_19.md`.

## Real earning workforce phase 1 (2026-09-20)

See [REAL_EARNING_WORKFORCE.md](REAL_EARNING_WORKFORCE.md) for the pre-coding
194-entry inventory audit, official provider references, credential requirements,
and explicit remaining work. The isolated Awin publisher API client now has
fixture-tested program discovery, fresh relationship checks, tracking-link
creation and attributed transaction lookup. This is not an end-to-end earning
connector: no durable assignment/delivery/settlement integration, no live calls,
no verified income, no cash writes, and no earning adapter registered in the
money worker. Existing spending and withdrawal controls are unchanged.

## Awin durable workflow phase 2 (2026-09-20)

[AWIN_WORKFLOW.md](AWIN_WORKFLOW.md) supersedes the phase 1 internal workflow
limitations above. Migration 0018 adds permanent exclusive account/property/
opportunity bindings, immutable owner-reviewed publication, commission evidence,
ordered lifecycle events, payout/reversal deduplication and durable API limits.
The existing verified-cash engine atomically accepts only independently confirmed
settlement through trusted server adapters. Owner API commands are implemented;
140 SQLite/API/cash/IPC/security tests and 32 native PostgreSQL workflow tests pass.

The owner selected no publishing property and no receiving provider. Neither
concrete adapter is installed: live publication and settlement stay BLOCKED.
Provider-specific adapter implementation, actual credentials/eligibility and
explicit live verification remain required. There is no real earning, cash,
account signup/KYC, paid deployment or unattended workforce activation claim.

## Real-money-only objective and paid-work expansion (2026-09-20)

[REAL_MONEY_OBJECTIVE.md](REAL_MONEY_OBJECTIVE.md) is the standing earnings
policy. `df0d31c` enforces USD-only **new** earning receipts centrally and in
Awin settlement, retaining historical receipt/refund/reversal compatibility.
The prior `dcef7cd` Awin checkpoint passed 1,066 local tests and its GitHub
Verify run 35483943820 subsequently completed successfully.

[FREELANCER_CONNECTOR.md](FREELANCER_CONNECTOR.md) records the new human-assisted
USD fixed-price work pathway: provider discovery, accepted/funded contract
checks, durable exclusive account/work bindings, expiring owner review,
immutable hash-approved text delivery, uncertain-effect protection and read-only
milestone evidence. Owner API only, no autonomous bidding or work generation.
**Partial connector: payout, independent USD settlement and mission cash bridge
remain BLOCKED.** No real accounts/jobs were provisioned, no live delivery/payout
occurred, no worker/deployment was activated and no mission cash was credited.
153 focused fixture tests passed; native PostgreSQL passed 19 Freelancer tests
and 39 shared-money tests (one existing SQLite-only bulk test skipped on PG).

### Final regression follow-up: retry-default defect

The expanded full suite exposed the previously intermittent automation retry
failure again. Isolated failure evidence showed attempt 2 starting only 52 ms
after attempt 1 failed: `resolveIntEnv` parsed an absent/blank value with
`Number('')`, producing zero instead of the intended 2,000 ms backoff. A fresh
process regression first failed, then passed after distinguishing missing values
from explicit zero. All 13 configuration tests and 18 automation tests passed
against an isolated copy of the retained pre-failure test snapshot. No assertion
was removed or timeout enlarged. This fixes runtime defaults, not just timing
in the test. New source fingerprint requires a new final suite.

The earlier run's disk exhaustion was handled by deleting only redundant mutable
`working.db` copies of already-passed fixtures after validating their saved
snapshot hashes. Immutable `passed.db` snapshots, TAP logs, checkpoint metadata,
failed-run evidence and all repository code remain intact. Completed tests were
resumed until the independently reproduced configuration failure above.

Final code checkpoint **`65adbef`**: **1,102/1,102 tests passed**, 110/110 files,
114 suites, zero failures/cancellations/skips/TODOs. Fingerprint
`c0c96627e8500ec2973f17df0a73e2682a66f1b81c87b78017fa1ef96258359d`.
Final suite completed after the actual retry-default fix; old interrupted/failed
runs remain evidence, not successful-suite claims. All final immutable snapshots
and TAP/checkpoint evidence are retained; redundant completed working copies
were removed to leave usable sandbox disk space. No production data/code was
removed. No new paid-work earnings or live settlement occurred.

## Recovery and Freelancer settlement phase 2 (2026-09-20)

Recovery preserved newer `07f59b0`; `9cbbb9d` is intact in its ancestry. Git fsck,
origin matching and current-source checkpoint validation succeeded. The retained
1,102-test regression was already complete; no tests were unnecessarily rerun.
No disk cleanup was needed on recovery (4.6 GiB free). The previous disk-full and
retry-default failures were already handled without resetting source/history.

[FREELANCER_SETTLEMENT.md](FREELANCER_SETTLEMENT.md) describes the new read-only
file-byte verification contract/recovery, authoritative payout itemization,
independent USD receiving proof, atomic net-cash bridge, globally deduplicated
physical movement keys, bounded verified reversals and review/freezes. Runtime
adapters remain absent/blocked; no automatic bidding, acceptance, fee-bearing
actions or withdrawals were added. No real funds/provider calls were involved.
227 focused tests passed; native PostgreSQL completed 155 passes with one
existing SQLite-only bulk fixture skipped. Normal native execution was used after
forced-exit runs proved capable of truncating counts; incomplete runs are not
accepted as verification. Types/backend/secrets passed. Final changed-source
integrated regression follows this implementation checkpoint.
