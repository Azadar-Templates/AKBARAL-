# A→Z readiness audit — 2026-09-19 UTC

## Recovery boundary

Audit resumed from actual local/remote `1c6a2e355a609bfce64161eb62a7fb29766c28f4`, not the older requested `5a2f6ed` (verified ancestor). The initially pending documentation checkpoint was pushed after GitHub reconnection. Branch remains `arena/01a0ba0a-akbaral`; history is not shallow. `669dc60` and `2466a9d` are preserved. No reset, clean, revert, branch switch or forced push.

This audit supplements, rather than overwrites, `CURRENT_SOURCE_OF_TRUTH.md`, `PROJECT_HISTORY.md`, historical inventory, test manifests and failed-run evidence. It does not reconstruct unavailable private conversations. **A healthy HTTP process is not a production-ready business or proof of provider access.**

## Recovered scope (all 12 requested areas)

| Area | Source of truth / established state | Boundary / remaining proof |
|---|---|---|
| 1. Standalone ZA141251SA | `src/mission`, `scripts/mission-{init,serve}.ts`; independent auth, migrations, connection and treasury | Audit reproduced an eager customer-DB import dependency; fixed below. No persistent mission listener found in the sandbox. |
| 2. Private dashboard and APIs | `mission-dashboard/{index.html,app.js,styles.css}`, `src/mission/server.ts`; 27 top-level API scopes inventoried below; existing owner/read-only/agent authorization | Retained 33 server tests, 12 executed-dashboard tests, 17 native Chromium checkpoints; these are fixture evidence, not every deployed mutation. |
| 3. Public platform / user / admin / owner | `src/app`, `public/app.js`, `src/app.ts`, `src/routes`; 22 page components, two explicit Next route handlers; production build previously generated 27 routes | Current local GET probes: 22 pages + robots/sitemap return 200. Protected API mounts reject anonymous callers. SSR shell 200 does not establish authenticated dashboard operation. |
| 4. Registry / Factory / runtime | `src/agents`, `src/orchestrator`, `src/routes/factory.ts`; fresh read-only registry audit against preview DB | **4,001 definitions/rows/versions/full contracts; zero FAILED; zero ACTIVE; 4,001 NEEDS_CONFIGURATION.** Factory is implemented, not proof of 4,001 live workers. |
| 5. Economy / workforce / opportunities | `src/economy`, `src/workforce`, `src/routes/{economy,workforce}.ts`, migrations 0018–0021 | Catalog contains 194 entries: six recorded verified, 179 candidates, nine rejected. Status counts are not new URL/payout verification. No million-opportunity claim. |
| 6. Financial infrastructure | `src/billing`, `src/economy`, `src/mission/{treasury,reinvestment,resource-budgets,resource-periods,resource-receipts}.ts`; serialization, idempotency and audit chains retained | Customer and mission ledgers remain distinct. Internal deposits, receipts, holds and renewal accounting are not external earnings, purchases or paid invoices. |
| 7. Mission security | `auth.ts`, `identity-lock.ts`, `policy.ts`, server authorization; vault, hashed sessions, CSRF, scoped links, kill switch | Standalone import isolation tested below. Operator identity/secrets, deployed private ingress and external account permissions remain deployment responsibilities. |
| 8. Providers / resources / quota / budgets / chat | Resource-call reservations, limits, reconciliation, holds, explicit billing periods; opt-in durable text worker and default-off credential permission | Enforcement covers governed paths, not every unrelated legacy adapter. Internal caps are not provider billing guarantees; no new live provider call or autonomous purchase. |
| 9. Migrations | **21 platform SQLite, 21 platform PostgreSQL, 15 mission** SQL migrations | Retained mission PG artifact verified 15 applied / zero pending / audit and ledger intact. No hosted production DB inspection. |
| 10. UI / API / build / tests | Fresh inventory: 99 pre-audit test files; 251 literal registrations in platform router files, plus app-level mounts/health endpoints; retained backend/Webpack 27-route build | Static registration inventory is not exhaustive HTTP execution. New cross-cutting fixes receive focused regressions; prior full-project pass is historical, not automatically a latest-source pass. |
| 11. Actual previews | Existing production-mode Next on 3000 and compiled API on 4000, using `data/reconstruction-verify.db`; started 14:43 UTC | Processes predate 18:41–18:42 compiled artifacts. Current disk build does not prove running revision. External proxy demands an Arena traffic token. No mission process on 4200. |
| 12. Git / hosted checks | Exact remote `1c6a2e3` verified at audit start; later audit checkpoints remain on the same branch | Verify run 35462333805 was in progress when inspected; preceding run was cancelled. No latest hosted CI success claimed. |

## Real configuration readiness

Ran the compiled launch checker **offline**, with the actual API process environment passed in memory, not printed or persisted. Used `--fail-on-blockers`: exit **1**, 13 checks, three ready, three optional, **seven required blockers**:

1. `domain.public_url`: no `AKBARAL_SITE_URL`.
2. `database.connection`: production process uses relative/ephemeral SQLite storage.
3. `provider.gemini`: no Google/Gemini credential.
4. `provider.search`: no configured search credential.
5. `provider.payments`: no configured payment-provider credential.
6. `provider.payments.return_urls`: public return URL missing.
7. `storage.uploads`: writable but relative/ephemeral upload directory.

This is configuration evidence, **not** network validation or production certification. Credentials were not requested, created, activated or logged. Local `/api/ready` 200 is a narrower operational probe and does not override these launch blockers.

## Genuine finding 1 — standalone mission opened the platform connection

**Reproduced:** all three new isolation tests failed on the prior code. Importing `Database` from the platform singleton module eagerly instantiated `db`, creating an unused customer SQLite file or starting its PostgreSQL worker. An unavailable customer DB prevented the supposedly standalone mission bootstrap.

**Fixed:** extracted the unchanged connection class/dialect/worker bridge into connection-free `src/db/driver.ts`. The platform facade `src/db/database.ts` retains its default singleton and all existing exports. Mission imports only the driver. Runtime worker assets stay adjacent to compiled driver code. Operators still must configure distinct database targets; a shared driver cannot protect against intentionally pointing both applications at the same database.

**Focused validation:** **22/22** isolation, platform foundation, PG bridge wakeup, PG connection-policy and migration-parity tests; typecheck, secret scan and whitespace check pass. The three isolation cases cover unavailable customer filesystem, no customer directory/file creation, and no customer PostgreSQL worker. CLI bootstrap verifies the real private migrations/audit/ledger. The first post-fix run caught a whitespace-only assertion mistake, corrected before the clean rerun. Failed logs remain preserved.

Next bounded checks: compiled/PostgreSQL regression after the module split, then reproduce and repair stopped-worker readiness reporting. Neither requires resetting data or rerunning unchanged complete suites.

## Exact preview locations and observed routes

Base: **https://3000-ivddaqjbjqgs5golvqtj9.e2b.app**

External retrieval of `/api/ready` reached the E2B proxy, which returned **“Missing Traffic Access Token”**, not the application JSON. Use Arena's authenticated preview access; anonymous/public reachability is **not verified**. No access token is included in this report.

Local HTTP through the existing Next proxy verified 200 for:

- `/`, `/signin`, `/signup`, `/workspace`, `/master`, `/projects`, `/billing`, `/admin`, `/owner`
- `/about`, `/agent-factory`, `/agents`, `/contact`, `/documentation`, `/faq`, `/features`, `/feedback`, `/help`, `/pricing`, `/privacy`, `/security`, `/terms`
- `/robots.txt`, `/sitemap.xml`, `/api/health`, `/api/ready`

Local anonymous `/api/me`, `/api/admin`, `/api/owner`, `/api/factory`, `/api/economy`, `/api/workforce`: **401**, as required. `/ads.txt`: **404 by design** without a configured genuine publisher ID. `/login`, `/register`, `/dashboard/*` are not this application's page paths. `/mission` and `/api/treasury` are not exposed on the public platform (404).

Mission default address is **http://127.0.0.1:4200/** only after explicitly starting it with the operator's private configuration. **It is not running; there is no verified live private mission preview URL.** Do not present `https://4200-ivddaqjbjqgs5golvqtj9.e2b.app` as active. The committed production-targets file lists an older sandbox, DuckDNS and Modal candidates; none establishes a current permanent deployment.

### Private API source inventory

`src/mission/server.ts` dispatches `/api/` scopes: `session`, `overview`, `treasury`, `ledger`, `audit`, `approvals`, `policy`, `kill-switch`, `agents`, `tools`, `credentials`, `resources`, `services`, `upgrades`, `work`, `revenue`, `expenses`, `wallets`, `payout-slots`, `payouts`, `reinvestment`, `targets`, `access-links`, `social`, `self-management`, `reports`, `health`. Session/auth methods and nested agent/resource/social subroutes are implemented inside these cases, not separate Next routes. The count is **27 scopes**; this inventory does not claim every method/body/auth combination has been freshly exercised. See server tests and the generated local route inventory for detailed evidence.

## Evidence retained locally (ignored runtime artifacts)

- `logs/readiness-audit/source-inventory.json`: pages, all extracted literal router registrations, mission scopes, migration filenames.
- `registry.json`, `registry.log`: fresh registry audit; historical root `registry-audit.json` remains unchanged.
- `runtime-launch.json`: sanitized configuration check using actual API environment.
- `http-local.json`, `http-pages.json`: status/method-path observations; invalid guessed paths preserved, not hidden.
- `isolation-before.log`: three expected failing reproductions.
- `isolation-after.log`: first post-fix run, including assertion-format failure.
- `isolation-after-02.log`, `isolation-{migrations,types,secrets}.log`: passing focused checkpoint.
- Prior `logs/continuation/period-final-*`: 186 mission SQLite, 74 mission PG, compiled 15-migration integrity, 27-route build; `period-browser-02` retains 17 browser checkpoints.

## Remaining / not verified

Permanent domain/ingress and persistent database/uploads; operator-owned mission startup and private access; full latest-source hosted CI outcome; live configured provider/search/payment proofs; payment webhooks/returns and payouts; live chat-worker/provider execution; broader adapter enforcement and authorized provisioning; fresh external opportunity verification; physical iOS/Android/Safari and signed mobile builds. Repository/fixture success is not evidence of real revenue or launch completion.

## Follow-up checkpoint — compiled and retained PostgreSQL isolation

After `3d03aab`, backend TypeScript compilation and runtime-asset copy passed. Compiled private bootstrap succeeded with an unusable customer DB path. Separate retained PG stores passed **24 mission financial + 22 platform integration = 46/46** tests, zero skips/failures; both harnesses exit 0. Compiled platform facade reports 21 migrations; compiled mission driver reports PostgreSQL / 15 migrations / zero newly applied / audit true / ledger true even with customer storage unavailable. The already-successful unchanged Next build was not repeated. Logs: `compiled-isolation.log`, `isolation-pg-{mission,platform}.log`, `backend-assets.log` under the audit evidence directory. This closes the module-split compiled/PG check, not external PostgreSQL concurrency or deployment verification.

## Genuine findings 2–4 — operational readiness and PostgreSQL monitoring

New lifecycle regression reproduced `/api/ready` returning **200 after `executionQueue.stop()`**, on both SQLite and PostgreSQL. A numeric busy-job count was being treated as worker liveness. Readiness now requires `executionQueue.isStarted` plus a valid nonnegative worker count; a healthy idle poller remains ready, a stopped poller returns 503, and database/HTTP liveness remains separate. This checks the poller lifecycle, not external provider success or an event-loop heartbeat.

The PostgreSQL run exposed two additional real issues in the same monitoring surface: the migration probe inspected the SQLite directory, and authenticated `/api/metrics` returned **500** because it queried SQLite-only `pragma_page_count()`. The probe now selects the active engine's directory; the size gauge uses `pg_database_size(current_database())` for PostgreSQL and real SQLite page measurements otherwise.

**Validation:** 25/25 SQLite health + queue tests, 7/7 retained PostgreSQL HTTP health/readiness/metrics tests; no skips/failures. The PG suite reproductions failed three cases before the fix. Tests include anonymous 401, ordinary-user 403 and authorized-admin metrics, stopped/restarted idle queues, queue-stat failure, migration selection/pending files, and positive measured DB size. Typecheck, secret scan and diff check pass after correcting an explicit test-mock parameter type. `npm run test:pg` (also used by Verify CI) now includes the health suite serially, so these paths remain covered rather than one-off probes.

Logs: `health-before-{sqlite,pg}.log`, `health-after-{sqlite,pg}.log`, `health-types-02.log`, `health-secrets.log`. Existing preview processes were deliberately **not** restarted; they do not yet contain this monitoring fix. The next audit task is connection-URL redaction in private bootstrap/diagnostics, followed by a final compiled and Git/runtime check.

## Genuine finding 5 — connection credentials in mission diagnostics

Three isolated reproductions failed before the fix: private `mission:init` printed its raw PostgreSQL URL before attempting connection; mission `path()` and the shared driver's `filePath` masked userinfo but left password/token query parameters and fragments visible. Reproduction used synthetic credentials and an unreachable loopback endpoint, not operator credentials.

Added connection-free `displayDatabaseTarget`: PostgreSQL display retains scheme/host/port/database path only, removes all userinfo/query/fragment data, and fails closed on malformed URLs. Bootstrap and both diagnostic surfaces use it. The actual worker still receives the original connection string, unchanged. SQLite diagnostic paths remain unchanged.

**Validation:** **21/21** redaction/isolation/PG bridge/connection-policy tests with the tsx cache disabled; types/secrets/diff pass. Six redaction tests cover CLI failure output, mission diagnostics, driver diagnostics plus unchanged connection target, SQLite compatibility, encoded credentials/IPv6 and malformed input. A first follow-up run exposed an overbroad test Worker stub interfering with cold TypeScript transformation; restricted both stubs to `pg-worker.mjs` and verified with caching disabled. That timeout and all earlier failures remain in `redaction-{before,after}.log`; passing evidence is `redaction-after-02.log`.

No real secret exposure was asserted, no credential was rotated or logged, and no database/provider activation occurred. Next: compile the final backend, verify compiled monitoring/private integrity on retained stores, refresh Git/runtime observations, and report the remaining deployment boundary without restarting the preserved preview.
