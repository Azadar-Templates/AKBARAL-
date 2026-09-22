# ZA141251SA 100M+ Earning-Opportunity Discovery Catalog — Report 2026-09-23

Brand: AKBARAL! — One Intelligence. Every Solution.
Mission: ZA141251SA private, isolated, $1B/day per-agent objective preserved, treasury/wallet controls unchanged.

## Objective
Build a scalable **100,000,000+ earning-opportunity discovery catalog** that does NOT fabricate platforms, jobs, clients, earnings, or payout proof. Support millions of unique records without loading everything into memory, with pagination, queues, rate limits, caching, retries, incremental ingestion, source tracking, verification lifecycle, and agent matching for 4,001+ agents.

---

## What Was Built

### 1) Database Schema (migration 0008_opportunity_catalog.sql) — Scalable for 100M+
- **mission_opportunity_sources**: key, name, category, base_url, api_endpoint, docs_url, tos_url, privacy_url, requires_api_key, api_key_env_var, rate_limit_rpm/daily, automation_allowed (0 disallowed, 1 allowed, 2 conditional), country_eligibility JSON, payout_currencies JSON, payout_methods JSON, fees, account_rules, api_available, status, last_ingested_at, ingestion_cursor, totals.
- **mission_opportunities**: id, source_id FK, platform, opportunity_type (job|gig|affiliate_offer|product_listing|monetization_program|remote_job|survey|microtask|research|digital_product|platform_membership|other), title, description, category, country_eligibility JSON, skills JSON, payout_currency/method/min/max/frequency, fees, account_rules, api_available, automation_permission (allowed|disallowed|conditional), tos_url, source_url (canonical), external_id, dedup_hash UNIQUE (SHA256 platform|source_url|external_id|type), status (pending_review|verified|rejected|expired|archived), risk_level (low|medium|high), verification_notes, last_verified_at, last_seen_at, created_at, updated_at.
  - **Indexes for 100M+**: dedup_hash UNIQUE, source_id, platform, category, type, status, risk, created_at DESC, verified_at DESC, external_id. Country and skill mappings normalized in separate tables for efficient filtering.
- **mission_opportunity_countries**: opportunity_id, country_code PK, index on country_code — enables country filter without JSON scan at scale.
- **mission_opportunity_skills**: opportunity_id, skill PK, index on skill — enables agent skill matching at scale.
- **mission_opportunity_ingestion_queue**: id, source_id, job_type (ingest|verify|reindex), cursor (pagination), payload JSON, status (pending|processing|completed|failed|rate_limited), attempts, max_attempts, last_error, next_retry_at (exponential backoff), rate_limit_key, timestamps — queue-based, never loads all jobs.
- **mission_opportunity_ingestion_runs**: id, source_id, started/completed, status, items_fetched/new/updated/duplicate/failed, cursor_start/end, error_summary — audit trail of ingestion batches.
- **mission_opportunity_verifications**: id, opportunity_id, verifier_type (owner|system|api|manual), previous/new status, risk, notes, source_url_checked, tos_checked, verified_at — verification lifecycle, no fabricated earnings.
- **mission_opportunity_matches**: id, opportunity_id, agent_id, score 0-100, matched_on JSON reasons, status (suggested|assigned|rejected|completed), UNIQUE(opportunity_id, agent_id), indexes on agent_id score DESC, opportunity_id, status — matches 4001+ agents.
- **mission_opportunity_source_stats**: source_id PK, total, verified, pending, rejected, expired, last_updated — materialized for dashboard, updated incrementally.
- **mission_opportunity_rate_limits**: bucket_key PK, requests_minute JSON, requests_daily, daily_reset_at — persistence across restarts + in-memory cache.
- **mission_opportunity_cache**: cache_key PK, source_id, response JSON, etag, expires_at, index on expires_at — avoids re-fetching, respects rate limits.

**Scalability design:**
- Cursor pagination: `created_at + id` cursor, not OFFSET for large tables (OFFSET still supported for admin UI but cursor preferred for 100M+).
- Deduplication: `dedup_hash` UNIQUE prevents duplicate records at DB level, computed as SHA256(lower(platform)|lower(source_url)|lower(external_id)|lower(type)).
- Never loads all into memory: all list functions use LIMIT, indexed WHERE, joins on normalized tables.
- WAL mode + busy_timeout for SQLite, compatible with PostgreSQL (Neon) — same schema, filtered PRAGMA.

### 2) Ingestion Pipeline (src/mission/opportunity-ingestion.ts)
- **Rate limits**: in-memory buckets (RPM sliding window 60s) + DB daily counter, per source. `checkRateLimit` before fetch, `recordRateLimitHit` after.
- **Caching**: `mission_opportunity_cache` with TTL, `getCachedResponse`/`setCachedResponse`, `sweepExpiredCache`.
- **Queue**: `enqueueIngestionJob`, `listPendingJobs` (only pending + retry_at <= now), `claimJob` transactional, `completeJob`, `failJob` with exponential backoff (60 * 2^attempts, max 3600s), `rateLimitedJob` with retry_after.
- **Retries**: max_attempts 5, last_error stored, next_retry_at.
- **Incremental**: `ingestion_cursor` per source, `last_ingested_at`, `last_seen_at` per opportunity.
- **Legitimate public source fetchers — only APIs that explicitly allow automation:**
  - `fetchRemotiveJobs` — https://remotive.com/api/remote-jobs — public API, no key, explicitly allowed, 30 RPM, 5000/day, User-Agent ZA141251SA-opportunity-catalog/1.0.
  - `fetchArbeitnowJobs` — https://www.arbeitnow.com/api/job-board-api — public API, no key, explicitly free, 30 RPM, 10000/day.
  - `fetchJobicyJobs` — https://jobicy.com/api/v2/remote-jobs — public API, no key, explicitly free, 30 RPM, 10000/day.
  - All other sources (Upwork, Fiverr, Etsy, Amazon Associates, etc.) require API key and approval — ingestion refuses without key and with honest error, never scraping, never bypassing ToS, CAPTCHA, KYC, account limits, robots.
- **Generic `ingestSource`**: checks rate limit, starts run, fetches via allowed fetcher, creates opportunities with deduplication, updates source stats, finishes run.
- **Queue processor `processIngestionQueue`**: batchSize 5, claims jobs one by one, respects rate limits, parses payload, calls ingestSource, completes or fails with backoff.

### 3) Source Tracking — 36 Legitimate Public Sources Seeded (no fabrication)
**Categories:**
- Freelance marketplaces (5): Upwork, Fiverr, Freelancer.com, Toptal, Guru.com
- Remote job boards (5): Remotive (public API allowed), Remote OK (public API allowed), Arbeitnow (public API free), Himalayas, Jobicy (public API free)
- Affiliate networks (8): Amazon Associates, ShareASale, ClickBank, Impact.com, CJ Affiliate, PartnerStack, Rakuten Advertising, AWIN
- Creator monetization (6): YouTube Partner Program, Patreon, Substack, Medium Partner Program, TikTok Creativity Program, Reddit Contributor Program
- E-commerce (2): Etsy, Shopify
- Digital products (7): Gumroad, Teachable, Udemy, Shutterstock Contributor, Adobe Stock Contributor, Google Play Console, Apple App Store Connect
- Research (1): Prolific
- Microtask (2): Amazon Mechanical Turk, Clickworker

All have real base_url (https), real tos_url, docs_url where available, honest automation_allowed:
- 1 = allowed via public API (Remotive, Arbeitnow, Jobicy, RemoteOK, etc.)
- 2 = conditional — API allowed, scraping disallowed (Upwork, Fiverr, Amazon Associates, etc.)
- 0 = manual only (Toptal, Himalayas, etc.)

Seed functions: `seedLegitimateSources()` upserts 36 sources, `seedPlatformOpportunities()` creates 36 verified low-risk platform_membership opportunities describing the platforms themselves as lawful earning opportunities (not fabricated jobs).

### 4) Verification Lifecycle
- Status: pending_review -> verified|rejected|expired|archived
- Risk: low|medium|high — platform membership = low, remote jobs from public APIs = low, affiliate = low-medium, manual = medium until verified
- `updateOpportunityStatus` writes verification row, updates source stats, sets last_verified_at
- Only status=received + verifier counts as realized revenue in mission accounting — catalog status does NOT affect treasury (preserved)
- No fabricated earnings, payout proof, clients — only real platform URLs, ToS URLs

### 5) Agent Matching — 4,001+ Agents
- `listAgentsForMatching` paginated (limit/offset), parses capabilities JSON from mission_agents
- `computeMatchScore` 0-100:
  - Skills matching up to 50 points (15 per matching skill, general fallback 10)
  - Category matching up to 20 points
  - Automation permission up to 15 (allowed 15, conditional 8, disallowed 2)
  - Risk up to 10 (low 10, medium 5)
  - Verified bonus 5
  - Country global 5
- `matchOpportunitiesToAgent` — fetches pool of 1000 opportunities (not 100M), scores, sorts, returns top N
- `matchAgentsToOpportunity` — paginates agents in batches of 500, scores, stops after 1000 agents for sync version — background job would do full 4001+ in batches
- `batchMatchOpportunities` — processes opportunities in batches (100), creates matches for top 10 per opportunity with score >=40
- Preserves $1B/day per-agent objective — matching is suggestive, revenue only counted when verified received

### 6) Admin Dashboard APIs (src/mission/server.ts)
- **GET /api/opportunities** — list with filters: source_id, platform, opportunity_type, category, status, risk_level, country, skill, search/q, limit (max 500), offset, cursor, orderBy (created_at|last_verified_at|last_seen_at), orderDir. Returns total, opportunities, nextCursor. Never loads all.
- **GET /api/opportunities/stats** — catalog count, verified, pending, rejected, expired, archived, byCategory, byPlatform, byType, byRisk, bySource, sourcesTotal/active, ingestionQueue pending/processing/failed/completed, countries, skills.
- **GET /api/opportunities/countries** — distinct countries with counts, limit.
- **GET /api/opportunities/skills** — distinct skills with counts, limit.
- **GET /api/opportunities/:id** — single opportunity + matches.
- **POST /api/opportunities** — create with deduplication, audited (owner only).
- **POST /api/opportunities/:id/verify** — update status/risk/notes, writes verification row, audited.
- **GET /api/opportunity-sources** — list with category/status filters, limit/offset.
- **GET /api/opportunity-sources/:id** — source + stats + recent runs.
- **POST /api/opportunity-sources** — upsert source (owner only).
- **POST /api/opportunity-sources/seed** — seed legitimate sources + platform opportunities, audited, returns stats.
- **GET /api/opportunity-ingestion/queue** — pending jobs + stats.
- **GET /api/opportunity-ingestion/runs** — runs with optional source_id filter.
- **POST /api/opportunity-ingestion/enqueue** — enqueue job (owner only).
- **POST /api/opportunity-ingestion/process** — process queue batch (owner only), respects rate limits.
- **POST /api/opportunity-ingestion/ingest** — ingest source by key (owner only), honest rate limit errors.
- **POST /api/opportunity-ingestion/sweep-cache** — sweep expired cache.
- **GET /api/opportunity-matches/agent/:agentId** — matches for agent, computes on fly if none.
- **GET /api/opportunity-matches/opportunity/:opportunityId** — agents matching opportunity.
- **POST /api/opportunity-matches/batch** — batch matching job.
- **GET /api/opportunity-catalog** — full dashboard payload: stats, countries, skills, scaling design, required external APIs, disclaimer.

**Mission overview extended** in reporting.ts to include opportunityCatalog stats if table exists.

---

## Actual Discovered Count (Honest, Not Fabricated)

**Current as of 2026-09-23 after seeding legitimate public sources:**

- **Total opportunity records**: 36
- **Verified**: 36 (platform_membership type — platforms themselves as lawful opportunities)
- **Pending review**: 0 (will grow as ingestion fetches remote jobs from public APIs)
- **Rejected**: 0
- **Expired**: 0
- **Archived**: 0
- **Sources total**: 36
- **Sources active**: 36
- **By category**: affiliate_network 8, digital_product 7, creator_monetization 6, freelance_marketplace 5, remote_job_board 5, e_commerce 2, microtask 2, research 1
- **By platform**: 36 distinct (Upwork, Fiverr, Freelancer, Toptal, Guru, Remotive, RemoteOK, Arbeitnow, Himalayas, Amazon Associates, ShareASale, ClickBank, Impact, CJ Affiliate, PartnerStack, YouTube Partner, Patreon, Substack, Medium Partner, TikTok Creativity, Etsy, Shopify, Gumroad, Teachable, Udemy, Prolific, MTurk, Clickworker, Rakuten, AWIN, Reddit Contributor, Shutterstock Contributor, Adobe Stock Contributor, Google Play Console, Apple App Store, Jobicy)
- **By type**: platform_membership 36
- **By risk**: low 36
- **Ingestion queue**: pending 0, processing 0, failed 0, completed 0 (will grow when owner enqueues jobs)

**Do NOT claim 100M exist** — current count is actual discovered count only (36). Designed for 100M+ but honest about current.

**Source coverage:**
- 3 public APIs that explicitly allow automation without key: Remotive, Arbeitnow, Jobicy — these can be ingested immediately with rate limits 30 RPM, 5000-10000/day, no API key needed, caching 1h TTL.
- 33 sources require API key or manual verification — ingestion refuses without key, respects ToS, never scraping.

**Remaining scaling limits:**
- **SQLite file**: practical limit ~100M rows with proper indexes, but performance degrades after ~10M without partitioning. WAL + busy_timeout helps, but for true 100M+ production should use PostgreSQL (Neon) — same schema works on both engines (migration tested).
- **Current indexes**: cover filtering by platform, category, type, status, risk, country, skill, created_at, dedup_hash. For 100M+, need additional composite indexes (e.g., status+category+created_at) and possibly partitioning by category or source_id.
- **Pagination**: cursor-based avoids OFFSET performance cliff, but OFFSET still supported for admin UI — for 100M+, OFFSET > 100k will be slow, cursor must be used.
- **Deduplication**: dedup_hash UNIQUE constraint is efficient for up to 100M with index, but hash computation must be done before insert — done.
- **Queue**: ingestion queue processes 5 jobs at a time, each job fetches 50 items — to reach 100M would need 2M jobs, which is feasible with batching but would take time and respect rate limits. For 100M, need to increase batchSize and run as background scheduler (currently disabled per policy — owner must enable autonomous).
- **Matching**: batchMatch processes 100 opportunities at a time, each scoring 1000 agents max for sync version — to match 100M opportunities to 4001 agents would need background job with pagination, not synchronous.
- **Memory**: no function loads all rows — all use LIMIT, cursor, batching. For 100M, need to ensure Node heap not exceeded — current design does that.
- **Rate limits**: public APIs free tiers allow ~5k-10k/day each — to ingest 100M remote jobs would need many sources and long time, respecting ToS. Realistic 100M would come from aggregating many affiliate programs, e-commerce listings, digital products, etc., not just 3 job boards.
- **Storage**: SQLite file for 100M rows estimated 20-50GB — exceeds typical ephemeral FS. Need PostgreSQL with managed storage.

**What is needed to genuinely reach 100M unique records:**
- Configure API keys for sources that require them (Upwork, Fiverr, Etsy, Gumroad, Amazon Associates, ShareASale, ClickBank, etc.) — owner must create legitimate accounts, accept ToS, obtain keys, store in vault encrypted.
- Enable autonomous ingestion scheduler (currently disabled per policy — owner must set autonomousEnabled).
- Run incremental ingestion jobs with pagination cursors for each source, respecting rate limits, caching, retries.
- Verify each opportunity manually or via API checks, update status to verified, set last_verified_at.
- Deduplication will keep unique count honest — 100M claimed only after genuinely sourced and deduplicated.

---

## Required External APIs

**No API required for minimal catalog (36 platforms seeded):**
- Database: SQLite file default (0$), or PostgreSQL Neon optional
- No LLM key needed for catalog itself

**For ingestion from public APIs (explicitly allowed, no key, free):**
- Remotive: https://remotive.com/api/remote-jobs — no key, 30 RPM, 5000/day — active, allowed
- Arbeitnow: https://www.arbeitnow.com/api/job-board-api — no key, 30 RPM, 10000/day — active, allowed
- Jobicy: https://jobicy.com/api/v2/remote-jobs — no key, 30 RPM, 10000/day — active, allowed
- RemoteOK: https://remoteok.com/api — no key, 20 RPM, 2000/day — active, allowed (fetcher not yet implemented, but source seeded)

**Optional, requires API key and legitimate account (owner must create account, accept ToS):**
- Upwork API — requires approval, UPWORK_API_KEY — 10 RPM, 1000/day — optional
- Fiverr API — limited to approved partners, FIVERR_API_KEY — 10 RPM, 500/day — optional
- Freelancer.com API — FREELANCER_API_KEY — 10 RPM, 500/day — optional
- Etsy API v3 — OAuth, ETSY_API_KEY — 10 RPM, 10000/day — optional
- Shopify API — SHOPIFY_API_KEY — 20 RPM, 10000/day — optional, explicitly allowed for store management
- Gumroad API — GUMROAD_API_KEY — 20 RPM, 5000/day — optional, public API allowed
- Teachable API — TEACHABLE_API_KEY — 10 RPM, 1000/day — optional
- Udemy API — UDEMY_API_KEY — 10 RPM, 1000/day — optional
- Amazon Associates PA-API — AMAZON_ASSOCIATES_API_KEY — requires approval, 10 RPM, 1000/day — optional
- ShareASale API — SHAREASALE_API_KEY — 10 RPM, 1000/day — optional
- ClickBank API — CLICKBANK_API_KEY — 10 RPM, 1000/day — optional
- Impact.com API — IMPACT_API_KEY — 10 RPM, 1000/day — optional
- CJ Affiliate API — CJ_API_KEY — 10 RPM, 1000/day — optional
- Rakuten Advertising API — RAKUTEN_API_KEY — 10 RPM, 1000/day — optional
- AWIN API — AWIN_API_KEY — 10 RPM, 1000/day — optional
- Prolific API — PROLIFIC_API_KEY — 10 RPM, 1000/day — optional, for researchers
- MTurk API — MTURK_API_KEY (AWS) — 10 RPM, 1000/day — optional
- Shutterstock API — SHUTTERSTOCK_API_KEY — 10 RPM, 1000/day — optional
- Google Play Publisher API — GOOGLE_PLAY_API_KEY — 20 RPM, 10000/day — optional
- Apple App Store Connect API — APPLE_APPSTORE_API_KEY — 20 RPM, 10000/day — optional
- YouTube Data API — GOOGLE_API_KEY — 10 RPM, 1000/day — optional, must comply with YouTube API Services ToS
- Patreon API — PATREON_API_KEY — 10 RPM, 1000/day — optional

**All keys stored encrypted in mission vault, never returned, masked hint only. Do not ask for secrets in chat. Platform enforces honest provider_not_configured error until key exists.**

---

## Verification

- Migrations: 0008_opportunity_catalog.sql applied, 42 tables total in mission DB (was 33)
- Seed: 36 legitimate sources, 36 platform opportunities verified low-risk
- Typecheck: PASS
- Build: PASS (Next.js static + dynamic)
- Tests: mission-core 15, treasury 12, reinvestment 9, server 23, opportunity-catalog 9 — total 68 PASS, 0 FAIL
- Treasury/wallet controls unchanged: $1B/day per-agent objective preserved (daily_target_cents 100B default, verified revenue today only status=received+verifier, remaining gap, progress%, UTC reset)
- ZA141251SA isolation preserved: separate DB file (mission.db default or ZA141251SA_DATABASE_URL), separate auth, loopback bind, zero imports from AKBARAL! app
- Revenue rule preserved: Only actual received and independently verified revenue counts — catalog does NOT invent earnings, payout proof, clients, jobs
- Compliance: Never bypass CAPTCHA/KYC/account limits/platform restrictions/robots/ToS — only public APIs that explicitly allow automation, or manual verification

---

## Admin Dashboard

Access via mission server (private, loopback default, port 4200):
- GET /api/opportunity-catalog — full dashboard: stats, countries, skills, scaling design, required APIs, disclaimer
- GET /api/opportunities/stats — counts: total, verified, pending, rejected, expired, archived, byCategory, byPlatform, byType, byRisk, bySource, sourcesTotal/active, ingestionQueue
- GET /api/opportunities?category=affiliate_network&status=verified&country=US&skill=writing&limit=50&cursor=xxx — paginated, indexed filtering
- GET /api/opportunity-sources — sources with category/status filters
- POST /api/opportunity-sources/seed — seed legitimate sources + platforms (owner only)
- POST /api/opportunity-ingestion/ingest — ingest source by key with rate limits (owner only)
- GET /api/opportunity-matches/agent/:agentId — matches for agent
- Mission overview (GET /api/overview) now includes opportunityCatalog stats if table exists

---

## Remaining Work to Reach 100M Genuinely

1. Owner creates legitimate accounts for sources requiring API keys (Upwork, Fiverr, Etsy, etc.) — KYC, tax, approval where needed
2. Store API keys in vault encrypted via POST /api/credentials (owner only) — env var mapping documented
3. Enable autonomous scheduler (policy autonomousEnabled) if desired for continuous ingestion — currently disabled per policy
4. Enqueue ingestion jobs for each source with pagination cursors: POST /api/opportunity-ingestion/enqueue
5. Process queue: POST /api/opportunity-ingestion/process with batchSize, respecting rate limits, caching, retries, incremental
6. Verify opportunities: POST /api/opportunities/:id/verify with status verified, risk low, notes
7. Match to agents: POST /api/opportunity-matches/batch
8. Monitor via GET /api/opportunity-catalog and GET /api/opportunities/stats — actual count is honest, never claim 100M until genuinely sourced and deduplicated
9. For true 100M+ production, migrate mission DB to PostgreSQL (Neon) for storage and performance — schema compatible

---

## Compliance Notes

- No fabricated platforms — all 36 sources are real, publicly known, with real base_url and ToS URLs
- No fabricated jobs/clients/earnings/payout proof — platform opportunities describe platforms themselves as lawful earning opportunities; individual jobs only ingested from public APIs that explicitly allow automation, with source_url preserved
- No bypassing CAPTCHA/KYC/account limits/ToS/robots — ingestion refuses without API key for sources that require it, respects rate limits, uses caching, exponential backoff, User-Agent identifying ZA141251SA
- Only verified revenue counts in mission accounting — treasury.ts recordRevenue requires verifier for status=received, catalog does NOT affect revenue
- $1B/day per-agent objective preserved — daily_target_cents 100B default, verified revenue today only, remaining gap, progress%
- ZA141251SA isolation preserved — separate DB, auth, secrets, loopback bind

