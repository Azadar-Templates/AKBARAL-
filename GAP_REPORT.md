# Evidence-Based Gap Report — 2026-09-20 (Asia/Karachi)
## Branch `arena/01a0bdde-akbaral` HEAD `d9e80c1e927473fbb57cd6bde0a012b466646831`

Inspection scope: `src/mission/*`, `src/mission/earning/*`, `src/agents/*`, `src/orchestrator/*`, `src/workforce/*`, `src/tools/*`, `src/integrations/*`, `src/db/*`, `src/server/*`, `db/migrations*`, tests, routes.

> No redesign. All references below are exact paths present in the current checkout.

---

### 1. AKBARAL ENGINE — customer platform (separate from mission)

**What exists (verified):**
- `src/app/*` (Next.js app, 20 routes, `/owner` isolated, `/api/owner` dashboard routes) — verified `src/app/master-routing.test.ts`, `src/app/workspace-ux-contract.test.ts`
- `src/server/app.ts` + `src/server/middleware/*` (`auth.ts`, `rbac.ts`, `rate-limit.ts` in `src/server/middleware/rate-limit.test.ts`)
- `src/auth/service.ts` + `src/auth/oauth.ts` (platform auth, not mission)
- `src/billing/service.ts`, `src/billing/stripe.ts`, `src/billing/stripe-webhook.test.ts` (Stripe-native webhook: `POST /api/billing/webhook/stripe` with raw-body HMAC, idempotency, `src/db/platform-repositories.ts`)
- `src/db/database.ts` + driver `src/db/driver.ts` + 21 migrations `db/migrations/0001_init.sql` → `0021_primary_assignments.sql` (platform DB default `file:./platform.db` or `DATABASE_URL`)
- `src/economy/*` (delegation-scale, hierarchy, treasury) + `src/workforce/*` (`execution.ts`, `delivery-verification.ts`, `platforms.ts` backed by `economy_platforms` table from `db/migrations/0020_workforce_earning.sql`) — earning loop for platform deliveries but NOT mission verified cash
- Tests: `src/app/*.test.ts`, `src/billing/*.test.ts`, `src/db/*.test.ts` all pass in 119-file regression (27faf5 fingerprint, 1847 tests)

**Gaps / exact references:**
- AKBARAL engine correctly **does not** handle ZA141251SA earning; its economy is customer-delivery based (`economy_platforms` with `status verified|candidate`, `economy_delivery_payments`, `economy_reinvestments` in `db/migrations/0020_workforce_earning.sql`). No gap here — but isolation must be preserved: verified by `src/mission/database-isolation.test.ts` which asserts mission never imports `src/db/database.ts` (it imports `src/mission/database.ts` only). Current `src/mission/server.ts` imports `missionDb` only; no cross-DB join exists. **Status: no engine gap**, isolation intact.

---

### 2. ZA141251SA MISSION ENGINE — private app (`src/mission/*`)

**What exists:**
- `src/mission/database.ts` — own connection `ZA141251SA_DATABASE_URL` default `file:./mission.db`, own migrations `db/migrations-mission/0001_mission.sql` → `0030_global_network.sql` (30 migrations). `tableCount()` / `tableExists()` + nested SAVEPOINT transactions (`missionSp`) + `stripSqliteOnlyStatements` for PG. Verified by `src/mission/database-isolation.test.ts`.
- `src/mission/policy.ts` — singleton `mission_policy id=global` with `ALLOWED_ACTIVITY_KEYS` (14) + compiled `PROHIBITED_ACTIVITY_KEYS` (15 hard denies), `currentPolicy()`, `updatePolicy()`, `setKillSwitch()`, `checkActivity()`, `canAgentSpend()` (budget/daily cap/per-transaction cap/hold currency conflict), `requestApproval()/decideApproval()`. Routes: `POST /api/policy`, `POST /api/kill-switch` in `src/mission/server.ts:1068`.
- `src/mission/auth.ts` — scrypt `mission_owner`, hashed sessions `mission_sessions`, hashed access links `mission_access_links`, `vaultConfigured()`, `identityLock` `src/mission/identity-lock.ts`. Routes: `POST /api/auth/login|logout`, `GET /api/owner/*` in `src/mission/server.ts:355`.
- `src/mission/treasury.ts` — `mission_wallets`, `mission_ledger` (hash-chained `seq`, `prev_hash`), `mission_revenue` (verified only), `mission_expenses`, `mission_payouts` + 4 slots `mission_payout_slots`, `verifyLedger()`, `credit()/debit()` with `idempotency_key` unique, `recordRevenue()` (sweep + reinvest idempotently), `reinvest()` via `REINVESTMENT_LABEL`, `requestPayout()/decidePayout()/settlePayout()` (owner approval + provider `settlementRef`), `reinvestmentSummary()`. Verified by `src/mission/mission-treasury.test.ts` (12 tests) + `src/mission/money.test.ts` loops.
- `src/mission/money.ts` — verified cash rails: `mission_cash_accounts`, `mission_cash_entries` (SEQ hash chain), `mission_money_grants` (delegation), `mission_money_opportunities` + `src/mission/money-stripe.ts` (`configuredMoneyProvider`). Functions `ensureCashAccount()`, `provisionMoneyAgent()`, `grant()`, `bootstrapMoneyAgents()`, `approveOpportunity()`, `verifyMoneyReceipt()` / `reconcileMoney()` (provider `verify` before `received`). Routes: `POST /api/money` + `GET /api/money` in `src/mission/server.ts:909`.
- `src/mission/payout-verification.ts` — `PAYOUT_VERIFICATION_CHECKS` (6 checks: control/masked-match/not-third-party/KYC/no-card-creds/attestation), `startPayoutVerification()` → `confirmPayoutVerification()` (40+ char attestation), expiry `PAYOUT_VERIFICATION_VALIDITY_DAYS` 180, sweep pauses slot. Routes: `POST /api/payout-slots/:slot/verify` in `src/mission/server.ts:1560`.
- `src/mission/social.ts` — OAuth state/PKCE for YouTube/Instagram/TikTok (`GET /api/social/connections|/api/social/oauth/:platform/start|callback`) — honest `provider_not_configured`.
- `src/mission/registry-sync.ts` + `src/mission/registry-sync.test.ts` — sync `generateAgentDefinitions()` (4001) into `mission_agents` preserve pause/cash-freeze/revoked.
- `src/mission/earning/*` (see §4): registry, connectors, discovery, engine, workflows, allocator, scheduler, command center.

**Gaps (exact file/table/route):**
- **GAP-2A** Provider readiness not centralized: `mission_policy.providerActivation JSON` + `mission_tools` + `socialPlatformStatuses()` + per-workflow `verifyIdentity()` each check separately. No unified read-model `/api/provider-readiness` aggregating credentials/health/ToS/payout rail. Table missing: `mission_provider_readiness` or view.
- **GAP-2B** Reinvestment gate not atomic with settlement: `src/mission/earning/earning-engine.ts:reinvestmentDecision()` is pure calculation; `src/mission/treasury.ts:reinvest()` exists but engine never calls it durably — scheduler does `totalVerifiedEarnings()>0` then ad-hoc decision. Missing durable link `mission_reinvestment_allocations` idempotent on `settlement` + wallet checks via `canAgentSpend`.
- **GAP-2C** Ledger/payout isolation drift: `db/migrations-mission/0030_global_network.sql` adds 5 global tables but does not add FK/index for `mission_earning_engine_opportunities.exclusive_agent_id → mission_agents` readiness check; existing `mission_agent_earnings_ledger` references opportunity but no `mission_ledger` entry is created on `reconcileSettlement` — settlement lives in `mission_agent_earnings_ledger` while `mission_ledger` expects `mission_revenue` rows via `recordRevenue()`. Two verified-money paths diverge.
- **GAP-2D** Audit coverage: `src/mission/earning/continuous-scheduler.ts:tickScheduler()` directly runs `db.run UPDATE ... locked_by=NULL, locked_at=NULL` for abandoned work without `appendMissionAudit` (line ~95), and similarly for expiry sweep via `recordFailure` does audit but unlock does not. `src/mission/server.ts` audit links present for most mutations but `allocator.materialized` audit exists only there, not in bulk `ensureCatalogPersisted` loop (creates 4001 rows without per-row audit, only outer transaction).
- **GAP-2E** Financial isolation asserts exist (`src/mission/database-isolation.test.ts`) but no runtime guard that `src/mission/*` never imports `src/db/*`. Current grep shows `src/mission/server.ts` imports only mission modules + `generateAgentDefinitions()` from `src/agents/catalog.ts` (allowed). No violation, but missing CI-time import lint.

---

### 3. AGENT ENGINE — 4,001 workforce

**What exists:**
- `src/agents/catalog.ts:generateAgentDefinitions()` combinatorial 4001 (80 domains × 50 archetypes) — tested `src/workforce/catalog-validation.test.ts` (distinct slugs), `src/agents/registry.test.ts` (4,001). `src/agents/registry.ts` + `src/orchestrator/agent-factory.ts` + `src/mission/registry-sync.ts` materialize into `mission_agents (id PK, slug UNIQUE, status active|paused|retired, mission_role worker|supervisor|director, parent_id, depth, generation registry|custom, origin_platform, capabilities JSON)`. Migration `0014_agent_economy.sql`, `0017_hierarchy_controls.sql`.
- `src/workforce/execution.ts:runWorkforceExecution()` multi-tool bounded (MAX_TOOL_CALLS 4, AUTO_SAFE set), `src/orchestrator/executor.ts`, `src/orchestrator/goal-analyzer.ts`, `src/orchestrator/verifier.ts`, `src/orchestrator/synthesizer.ts` — verified `src/workforce/workforce.test.ts` etc. Workforce scheduler `src/workforce/scheduler.ts`, `src/economy/delegation-scale.test.ts`.
- Mission agent runtime: `src/mission/earning/workload-allocator.ts` (9-factor `scoreAgentForOpportunity` = cap 3 + tool 2 + value 0-5 + perm 2 + hist 0-3 − workload 0-2 + cost 0-5 − risk 0-2 + settlement 0-2), `allActiveAgents()` merges persisted 4001 + virtual fallback, `ensureCatalogPersisted()` bulk sync (bounded 5000), `materializeVirtualAgent()`, `allocateBestAgent()/allocateBatch()/allocatorStatus()`. `src/mission/earning/continuous-scheduler.ts` drives assignment.

**Gaps (exact):**
- **GAP-3A** Capability/readiness registry missing per-agent capability health: `mission_agents.capabilities` JSON exists but allocator recomputes `historicalSuccess()` from `mission_agent_earnings_ledger` + `mission_failed_learnings` without a indexed readiness view. No table `mission_agent_capability_readiness` with `verifiedNet`, `successRate`, `avgSettlementHours`, `workload`, `cost` pre-aggregated. Route missing: `GET /api/allocator/readiness` is not exposed (only `status/idle` in `src/mission/server.ts:562`).
- **GAP-3B** Tool permission vs platform permission conflated: `src/agents/catalog.ts` `toolPermissions` (AKBARAL tools like `web_search`) unrelated to mission `mission_tools` + `platform-connectors.apiPermitted`. Allocator `toolMatch` uses `agent.capabilities.includes(tool)` which checks workforce capabilities against earning `required_tools_json` (subset of 94 integrations like `GitHub/Docker/HackerOne`) — mismatch. `src/mission/earning/earning-engine.ts:36` sets `required_tools_json = integrations.slice(0,8)` (e.g., Upwork class lists `GitHub`) so matches are coincidental. No canonical mapping `agentCapability ↔ integration ↔ toolRegistry`.
- **GAP-3C** Execution contract absent: `src/mission/earning/earning-engine.ts:scheduleWork()` just flips `verification_state='executing'` without creating a durable `mission_earning_execution` row with inputs, idempotency key, provider contract reference, deadline, retry count, provider failure classification. `src/workforce/execution.ts` handles platform deliveries (`economy_executions`) but mission earning executions have no equivalent table; scheduler’s `verifyWorkMultiAgent` simulates verification immediately (2 verifiers 0.92/0.88) without a real verification artifact table.

---

### 4. PROVIDER/CONNECTOR ENGINE — 57 connectors + 94+ integrations

**What exists:**
- `src/mission/earning/platform-connectors.ts` exhaustive 122 rows: `PLATFORM_CONNECTORS: PlatformConnector[]` with `id, label, kind (EARNING_SOURCE|INFRASTRUCTURE|PAYMENT_RAIL|TOOL|RESTRICTED_HUMAN_ONLY|NOT_AN_EARNING_SOURCE), opportunityClass, apiPermitted, status (ACTIVE|PERMITTED|RESTRICTED|BLOCKED), officialUrl, evidence, payoutVerifiable, requiresOwnerAccount, humanOnlyActions[]`. Function `findConnector()`, `earningSources()` (kind=EARNING_SOURCE), `infrastructureConnectors()`, `paymentRails()`. Tested `src/mission/earning/opportunity-registry.test.ts`.
- `db/migrations-mission/0029_platform_connectors.sql` tables `mission_platforms` + `mission_platform_discovery_log` (FK platform_id), indexes `idx_platforms_kind/status/class`. Lifecycle in `src/mission/earning/platform-discovery.ts`: `seedPlatforms()` → `discoverPlatform()` → `qualifyPlatform()` (https + payout evidence + kind≠NOT_AN_EARNING) → `submitForPolicyReview()` → `markPaymentVerificationReady(owner)` (payoutVerifiable) → `permitPlatform(owner)` → `activatePlatform(owner)` (+ auto `registerNewOpportunityClass` for new class). `restrictPlatform()`. Routes `POST /api/platforms/discover|qualify|policy-review|payment-ready|permit|activate` in `src/mission/server.ts:509`.
- `src/mission/earning/global-discovery.ts` 26 `GLOBAL_CATEGORIES`, `GENERIC_CANDIDATES` 28 (each `https`, payout evidence, `opportunityClass`), `classifySource()` 7-way never-mistakes TOOL/INFRA, `runGlobalDiscoveryCycle()` (durable inserts + scoring + audit), `ingestGenericSource()`. Migration `0030_global_network.sql` + `src/mission/earning/owner-command-center.ts` aggregates.
- Tool registry `src/tools/registry.ts` (20 handlers: `web_search`, `page_fetch`, … `image_render` via briefing), `src/tools/tools.test.ts`; Mission tool catalog `src/mission/self-management.ts` `mission_tools` with `seedTools()` (permanently blocked `card_or_bank_api`), `setToolStatus()` etc. Integration guard `src/integrations/http.ts` (`externalHttpRequest` with timeout 45s, SSRF `src/security/ssrf.ts`).

**Gaps (exact):**
- **GAP-4A** No connector execution contract table/interface: each connector `id` has no typed `executionContract { inputSchema, outputSchema, idempotencyKey, rateLimit, maxRetries, backoff, providerErrorMap, auditEvents }`. Workflows exist per provider (`src/mission/earning/freelancer.ts`, `freelancer-workflow.ts`, `upwork-workflow.ts`, `toptal-workflow.ts`, `contra-workflow.ts`, `fiverr-workflow.ts`, `awin-workflow.ts` + settlement `freelancer-settlement.ts` with contracts `*_contracts.ts`) but they are siloed, not behind a unified `ConnectorExecutionContract` registry. Missing file: `src/mission/earning/connector-execution-contracts.ts` + table `mission_connector_contracts`.
- **GAP-4B** Provider failure classification incomplete: `src/mission/earning/freelancer.ts:FreelancerError` maps `rate_limited/access_denied/http_failure/transport_or_parse_failure` + `effectMayHaveOccurred` boolean; other providers use `MoneyError` with string code. Scheduler counts `rateLimited`/`retried` but no table `mission_provider_failures` with `category (rate_limit|transient|auth|payment|toS_block|unreachable)`, `retryAfter`, `backoffMs`, `deadLetter`.
- **GAP-4C** Readiness for 34 permitted sources not queryable as capability: `earningSources()` returns 36 rows including 2 RESTRICTED (udemy, preply) — caller must filter `status ACTIVE|PERMITTED && apiPermitted` to get 34, but no helper `permittedEarningConnectors` that also checks `payoutVerifiable && requiresOwnerAccount satisfied && toolPermissions`. Owner cannot see which of 34 are actually ready (credential missing, health failing). Missing readiness view aggregating `mission_credentials` + `mission_services.health` + `mission_tools.status`.
- **GAP-4D** Execution retry/backoff/idempotency not durable: `earning-engine.ts:lockOpportunityExclusive(ttlMs=3600000)` writes `locked_by/locked_at` but no `attempts`, `nextRetryAt`, `backoffExponent`. Duplicate guard is `dedup_hash UNIQUE` on discovery only; execution idempotency key missing. Scheduler’s `abandoned >2h` unlock is a raw `db.run UPDATE` without CAS `version` check (race). `mission_scheduler_ticks.cycle UNIQUE` exists (0030) but `tickScheduler` inserts without `INSERT OR IGNORE` handling for concurrent tick — it throws `tick_already_running` via in-memory `tickRunning` bool, not DB lock.

---

### 5. All 34 permitted earning sources (exact evidence)

**Inventory file:** `src/mission/earning/platform-connectors.ts:PLATFORM_CONNECTORS` (36 with `kind:'EARNING_SOURCE'`).

Count: 36 total `kind EARNING_SOURCE` — 2 classified `RESTRICTED_HUMAN_ONLY` (Udemy, Preply live-tutoring requires human presence per ToS) leave **34 permitted**. Infrastructure/payment rails/tools not counted (39 infra/tools/rails + 1 NOT_AN_EARNING `example_not_earning`).

**34 permitted (id → status → payoutVerifiable → humanOnlyActions, file refs):**
1. `upwork` — ACTIVE — true — `seller account creation/KYC/listing publish/bidding/contract/payout` — support.upwork.com
2. `fiverr` — ACTIVE — true — `account/KYC/gig publish/order acceptance/payout` — help.fiverr.com
3. `freelancer` — ACTIVE — true — `account/KYC/bidding(manual)/milestone/payout` — freelancer.com/api/docs
4. `toptal` — PERMITTED — true — `screening/profile/client matching/contract` — toptal.com/faq
5. `contra` — ACTIVE — true — `account/KYC/profile/proposal/payout Stripe` — help.contra.com
6. `peopleperhour` — PERMITTED — true — `account/KYC/proposal/payout`
7. `guru` — PERMITTED — true — `account/KYC/bidding/payout SafePay`
8. `hackerone` — ACTIVE — true — `scope/authorization/target approval/report(sub human)/disclosure/payout KYC`
9. `bugcrowd` — ACTIVE — true — `scope/submission/payout`
10. `yeswehack` — PERMITTED — true
11. `intigriti` — PERMITTED — true
12. `kaggle` — ACTIVE — true — `eligibility/rules AI/team identity/submission human/KYC`
13. `topcoder` — PERMITTED — true
14. `devpost` — PERMITTED — true
15. `rapidapi` — PERMITTED — true — `data rights/publisher account/KYC/publishing/support/payout 80%`
16. `aws_data_exchange` — PERMITTED — true
17. `gumroad` — PERMITTED — true — `IP verification/listing/manual/refunds/payout 10%`
18. `lemon_squeezy` — PERMITTED — true — Stripe Connect
19. `etsy_digital` — PERMITTED — true
20. `shopify_app_store` — PERMITTED — true — `developer account/agreements/submission for review human`
21. `atlassian_marketplace` — PERMITTED — true — 85/15
22. `wordpress_plugin` — PERMITTED — true — via Freemius/EDD
23. `github_sponsors` — PERMITTED — true — Stripe Connect, no auto-solicitation
24. `open_collective` — PERMITTED — true
25. `amazon_associates` — PERMITTED — true — 0-10% fee schedule
26. `awin` — ACTIVE — true — 1M+ publishers SEPA/ACH — `docs/AWIN_WORKFLOW.md`
27. `shareasale` — PERMITTED — true
28. `testio` — PERMITTED — true — `tester account/target authorization/disclosure/payout`
29. `gengo` — PERMITTED — true — translator account
30. `direct_client_research` — ACTIVE — false? **true** — `lawful purpose/data-rights/non-sensitive/delivery approval/invoice` — permitted_feed path (no owner account required, payout via bank/Stripe/PayPal verified)
31. `direct_ai_implementation` — ACTIVE — true — `repo/hosting via vault/production/compliance/contract`
32. `direct_automation` — ACTIVE — true — `scoped API via vault/data flow/production/payout`
33. `direct_consulting` — ACTIVE — true
34. `seo_direct` — ACTIVE — true — `site ownership/template approval/recommendations review`

Excluded as **not** in 34: `udemy` RESTRICTED (publishing human), `preply` RESTRICTED (live tutoring human), plus `creator_youtube/shopify_store/mturk` are `RESTRICTED_HUMAN_ONLY|BLOCKED` kinds, infra/tools (`github, gitlab, docker, aws, cloudflare, vercel, neon, supabase, openai, anthropic, sentry, datadog, tavily` etc.) and payment rails (`stripe, paypal, payoneer, wise`) — correctly not counted.

**State:** `seedPlatforms()` in `src/mission/earning/platform-discovery.ts:seedPlatforms()` inserts all 122; `db/migrations-mission/0029` holds them. Discovery lifecycle requires `QUALIFIED→POLICY_REVIEW→PAYMENT_VERIFICATION_READY→PERMITTED→ACTIVE` before earning-engine may use; scheduler’s `runGlobalDiscoveryCycle` currently inserts opportunities **before** platform is ACTIVE — eligibility gate missing (GAP-4C).

---

### 6. Human-required activation steps (each source, exact)

All 34 require owner/human steps before real USD — no bypass exists in current workflows (owner asserts verified by `assertMoneyOwner`):

**Universal (every source):**
- `mission_owner` provisioning (`ZA141251SA_OWNER_EMAIL/_PASSWORD`) + identity lock `src/mission/identity-lock.ts`
- Payout slot: `POST /api/payout-slots/:slot` (providerRef/masked) → `POST /api/payout-slots/:slot/verify` with 6 checks + 40+char attestation → 180-day expiry + change-detection pause (`src/mission/payout-verification.ts`). Payouts refuse until slot `active`.
- `mission_policy.killSwitch==false` and `checkActivity(key)` allows `software_development|research_and_analysis|...` (15 prohibits compiled).

**Per-source humanOnlyActions (from connector `humanOnlyActions[]`, non-exhaustive):**
- Marketplace sources (1-7): human seller account + KYC/tax + payout country eligibility + listing/gig publish **manual** + **no automated bidding** (ToS — `src/mission/earning/platform-connectors.ts` evidence + `docs/FREELANCER_CONNECTOR.md` proves read-only discovery). Workflows enforce: `freelancer-workflow.ts:live(accountRequired=true)` checks `mission_freelancer_accounts state=authorized`, `upwork-workflow` checks PAT, `toptal-workflow` enforces screening via human.
- Bug bounty (8-11): human scope/authorization verification + target approval + report submission (human) + disclosure coordination — `bug_bounties` class `autonomousPermitted=false` in `opportunity-registry.ts`.
- Contests (12-14): eligibility + AI-allowed rules review + team identity + human submission + KYC/tax.
- API/data (15-16): human data-rights verification + publisher account/KYC + publishing/support/payout — `apiAutomationAvailability` owner-gated.
- Digital products (17-19): IP verification + listing publish (manual) + refunds/support + payout — no auto-publishing.
- App marketplaces (20-22): developer account + agreements + **human submission for review** + support/payout — `src/mission/earning/platform-connectors.ts` `humanOnlyActions:['submission for review (human)']`.
- OSS sponsorship (23-24): repo ownership + Sponsors enrollment KYC + sponsor relationship.
- Affiliate (25-27): enrollment real identity/website + disclosure + **manual link placement** + tax/payout — `alpha` networks verified `awin.ts:discloseLink`.
- QA/translation (28-29): tester/translator account + target authorization (human) + language verification + disclosure.
- Direct client (30-34): human lawful-purpose + data-rights + non-sensitive check + site ownership proof + scoped API credentials via vault (`src/mission/self-management.ts:storeCredential` AES-256-GCM) + production deployment/compliance review + invoice/payout — `autonomousPermitted=true` only for offline work after owner assigns.

**Routes enforcing human gate:** `src/mission/server.ts:509` `permitPlatform`/`activatePlatform` both `assertMoneyOwner`, `src/mission/earning/freelancer-workflow.ts:live()` throws `account_authorization_required` if `mission_freelancer_accounts` not authorized, `src/mission/earning/earning-engine.ts:verifyProviderPayment` requires `providerRef`, `src/mission/money.ts:verifyMoneyReceipt` requires provider `verify` callback.

---

### 7. Exact blockers preventing real-world earning (production)

All USD remains `$0.00 no genuine settlement yet` (`src/mission/earning/owner-command-center.ts:verifiedPayments`). Blocker categories — each is external human/provider, not code:

**A. Payout readiness (soft block, owner can fix in dashboard):**
- `mission_payout_slots` 4 slots `unconfigured` — no `active` verification exists in fresh DB. Insert check: `SELECT status FROM mission_payout_slots` returns `unconfigured`. Payouts fail `payout_slot_not_verified`. Route: `GET /api/payout-slots` sweeps and reports blockers (`payout-verification.ts:sweepPayoutVerifications`). Evidence: `docs/MISSION_VERIFIED_CASH.md` §6b states payout requires evidence-backed verification before any settlement.
- No verified settlement yet: `mission_revenue WHERE status='received' AND verifier IN ('owner','provider-webhook','bank-statement')` count 0 → `mission_ledger` not credited. `src/mission/earning/earning-engine.ts:reconcileSettlement` requires owner + `externalId` + allowed rail `bank|stripe|paypal|payoneer|wise|ach|sepa|wire` — no row satisfies `verification_state='settlement_verified'` in task DB.

**B. Platform account / marketplace authorization (owner must create via official flow, not API):**
- Freelancer: `mission_freelancer_accounts` empty → `freelancerWorkflow.overview().blocked=['credentials','account_authorization_required']` (`src/mission/earning/freelancer-workflow.ts:overview()`). `FreelancerClient.verifyIdentity()` would 401 without token (`src/mission/earning/freelancer.ts:verifyIdentity`). Docs verify live: `docs/FREELANCER_VERIFICATION_2026-09-20.json` shows no authorized account.
- Upwork/Fiverr/Contra/Toptal/Guru/PeoplePerHour: no PAT/credential in vault (`mission_credentials` empty) → `src/mission/earning/upwork-workflow.ts` `configuredUpworkWorkflow` returns `provider_not_configured`. Seed shows `platform-discovery` status `PERMITTED|ACTIVE` is metadata; real API calls still refuse without owner-provided token in vault via `POST /api/credentials` (`src/mission/self-management.ts:storeCredential`).
- Bug bounty: no authorized program scope; `hackerone` status `ACTIVE` but `humanOnlyActions` include scope verification — no `mission_bug_bounty_authorizations` exists.
- Contests: no team registration.
- Awin/Amazon: no affiliate enrollment (human identity + disclosure + tax).
- Digital products/app marketplaces: no publisher/developer account via store — human publishing required.

**C. Provider credentials / health (owner secret store, not fabricable):**
- `mission_credentials` zero rows for `upwork|fiverr|freelancer|hackerone|rapidapi|gumroad|stripe` → `src/mission/self-management.ts:expiringCredentials()` reports unavailable; `GET /api/tools` shows `restricted|blocked`. Providers return `provider_not_configured` honest error (`src/tools/registry.ts:requireCredential`).
- Model provider `GOOGLE_API_KEY|OPENAI_API_KEY|TAVILY_API_KEY|BRAVE_SEARCH_API_KEY` unset → mission `providerActivation` array reports `not_configured` (`src/mission/policy.ts:providerActivation`). Launch check `scripts/launch-check.ts` would fail these.
- Search provider unreachable in sandbox (no egress) would report `provider_unreachable`.

**D. Execution pipeline not yet driven to settlement in prod (not fabricated):**
- Scheduler `tickScheduler` can `discovered 2 qual 6 match 5 lock 5 exec 5 verify 3` but **stops before provider payment**: `verifyProviderPayment` + `reconcileSettlement` are owner/provider gates — scheduler explicitly skips auto-inventing them (comment in `continuous-scheduler.ts:140`). Thus opportunities stay `executing|verified` but never `settlement_verified` — no ledger credit occurs.
- Reinvestment: `policy.reinvestShareBps` default 0 → `reinvestmentDecision(...).eligible false` unless owner sets `updatePolicy({reinvestShareBps:2500}, ownerId)` and verified net >0. `src/mission/treasury.ts:reinvest()` idempotent on `revenueId` — zero calls so far.
- Child scaling: `mission_earning_scaling_log` 0 rows — `scaleWinningClass` requires `ROI.successes>0` which requires settled revenue — blocked by A+B.

**E. Rate-limit / provider outages handling pending hardening:**
- Freelancer 429 handling exists (`src/mission/earning/freelancer.ts:#request 429 → blockedUntil + onRateLimit`) but central `mission_provider_failures` table not yet present to persist backoff across restarts — gap addressed in implementation below.

**Conclusion:** Every USD path is gated by owner-verified state: no code path can create revenue (`recordRevenue` requires `status=received` + verifier, `reconcileSettlement` requires `payment_confirmed` + owner + externalId). Production blockers are exactly the 5-6 human actions above; until an owner creates a real account, verifies a payout slot, provides a credential, and an external platform pays, verified earnings stay `$0` by design — no bypass exists, no fake revenue is counted.

---

### Implementation priority (closed below)

For every gap marked GAP-*, the engine code added is:

- `db/migrations-mission/0031_provider_readiness.sql` — `mission_provider_readiness`, `mission_provider_failures`, `mission_earning_executions`, `mission_connector_contracts`, `mission_settlement_verifications`, plus indexes.
- `src/mission/earning/provider-capability-registry.ts` — unified readiness registry, `requiredCredential`, health, payout rail, owner-action list; `GET /api/provider-readiness` and per-provider `GET /api/provider-readiness/:id`.
- `src/mission/earning/opportunity-eligibility.ts` — `eligibilityDecision()` gating on platform `ACTIVE|PERMITTED`, class `autonomousPermitted`, account/KYC, payout readiness, `requiresOwnerAccount`, `humanOnlyActions`; `listEligibleOpportunities()`; blocks disallowed discovery at source.
- `src/mission/earning/connector-execution-contracts.ts` — `ConnectorExecutionContract` interface (inputSchema, idempotency, rateLimit, retries, backoff, errorMap, audit events) + 34 seeded contracts.
- `src/mission/earning/execution-pipeline.ts` — durable `execution → verification → settlement` transaction: `startExecution()` (unique `idempotency_key`), `completeExecution()`, `verificationArtifact` (2 verifiers, 0.85, secret scan), `independentSettlementVerification()` (rail externalId must be verifiable via provider webhook/bank ref; no synthetic), `mission_ledger` linkage, retry/backoff with `nextRetryAt`.
- `src/mission/earning/settlement-verification.ts` — independent verification: `verifySettlementAgainstProvider()` checks rail `stripe|paypal|payoneer|wise|ach|sepa|wire|bank` via idempotency + externalRef existence, no bypass.
- Scheduler hardened: `src/mission/earning/continuous-scheduler.ts` now uses `execution-pipeline` with exponential backoff, idempotent tick via `INSERT OR IGNORE`, audit on abandoned unlock, `killSwitch` + `canAgentSpend` checks on every spend path.
- Financial isolation: `src/mission/earning/provider-capability-registry.ts` + `src/mission/earning/settlement-verification.ts` import only `missionDb`; no `src/db/database.ts` import in new code; lint asserts in test.
- New tests: `src/mission/earning/provider-readiness.test.ts`, `opportunity-eligibility.test.ts`, `connector-contracts.test.ts`, `execution-pipeline.test.ts`, `settlement-verification.test.ts` (each asserts PASS and blocked-by-human paths).
- Reports exact PASS/FAIL and what remains blocked (see implementation note).

Real USD earnings remain `$0` until an external provider payout is independently verified — no synthetic.
