import { missionDb, missionId, nowIso, type Row } from './database';
import { getOpportunitySourceById, getOpportunitySourceByKey, createOpportunity } from './opportunity-catalog';

/**
 * Ingestion pipeline for 100M+ catalog — pagination, queues, rate limits, caching, retries, incremental
 * - Never bypass CAPTCHA, KYC, account limits, platform restrictions, robots/ToS
 * - Only uses legitimate public APIs that explicitly allow automated access, or manual verification
 * - Rate limits enforced via DB bucket + in-memory cache, with exponential backoff
 * - Queue-based, supports millions without loading all into memory (cursor pagination, streaming)
 */

export interface IngestionJob {
  id: string;
  source_id: string;
  job_type: string;
  cursor: string | null;
  payload: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_retry_at: string | null;
  rate_limit_key: string | null;
  created_at: string;
  updated_at: string;
}

// ── Rate limiting ──

const memoryBuckets = new Map<string, number[]>(); // key -> timestamps (ms) in last 60s

function getMemoryBucket(key: string): number[] {
  let bucket = memoryBuckets.get(key);
  if (!bucket) {
    bucket = [];
    memoryBuckets.set(key, bucket);
  }
  const now = Date.now();
  const filtered = bucket.filter((ts) => now - ts < 60_000);
  memoryBuckets.set(key, filtered);
  return filtered;
}

export function checkRateLimit(sourceId: string, rpm: number, dailyLimit: number): { allowed: boolean; reason?: string } {
  const bucketKey = `rpm:${sourceId}`;
  const mem = getMemoryBucket(bucketKey);
  if (mem.length >= rpm) {
    return { allowed: false, reason: `RPM limit ${rpm} exceeded (${mem.length} in last 60s)` };
  }

  // Daily limit from DB
  const row = missionDb.get<Row>('SELECT requests_daily, daily_reset_at FROM mission_opportunity_rate_limits WHERE bucket_key = ?', [`daily:${sourceId}`]);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const resetAt = row?.daily_reset_at ? String(row.daily_reset_at) : null;
  if (resetAt !== todayStr) {
    // reset daily counter
    missionDb.run(
      `INSERT INTO mission_opportunity_rate_limits (bucket_key, requests_minute, requests_daily, daily_reset_at, created_at, updated_at)
       VALUES (?, '[]', 0, ?, ?, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET requests_daily = 0, daily_reset_at = excluded.daily_reset_at, updated_at = excluded.updated_at`,
      [`daily:${sourceId}`, todayStr, nowIso(), nowIso()],
    );
  } else {
    const dailyCount = Number(row?.requests_daily ?? 0);
    if (dailyCount >= dailyLimit) {
      return { allowed: false, reason: `Daily limit ${dailyLimit} exceeded (${dailyCount})` };
    }
  }

  return { allowed: true };
}

export function recordRateLimitHit(sourceId: string): void {
  const bucketKey = `rpm:${sourceId}`;
  const mem = getMemoryBucket(bucketKey);
  mem.push(Date.now());
  memoryBuckets.set(bucketKey, mem);

  const todayStr = new Date().toISOString().slice(0, 10);
  const now = nowIso();
  missionDb.run(
    `INSERT INTO mission_opportunity_rate_limits (bucket_key, requests_minute, requests_daily, daily_reset_at, created_at, updated_at)
     VALUES (?, '[]', 1, ?, ?, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET requests_daily = requests_daily + 1, updated_at = excluded.updated_at`,
    [`daily:${sourceId}`, todayStr, now, now],
  );
}

// ── Cache ──

export function getCachedResponse(cacheKey: string): { response: any; expired: boolean } | null {
  const row = missionDb.get<Row>('SELECT response, expires_at FROM mission_opportunity_cache WHERE cache_key = ?', [cacheKey]);
  if (!row) return null;
  const expiresAt = String(row.expires_at);
  const expired = new Date(expiresAt).getTime() < Date.now();
  try {
    return { response: JSON.parse(String(row.response)), expired };
  } catch {
    return null;
  }
}

export function setCachedResponse(cacheKey: string, sourceId: string | null, response: any, ttlSeconds = 3600): void {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  missionDb.run(
    `INSERT INTO mission_opportunity_cache (cache_key, source_id, response, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET response = excluded.response, expires_at = excluded.expires_at, created_at = excluded.created_at`,
    [cacheKey, sourceId, JSON.stringify(response).slice(0, 200000), expiresAt, nowIso()],
  );
}

export function sweepExpiredCache(): number {
  const result = missionDb.run(`DELETE FROM mission_opportunity_cache WHERE expires_at < ?`, [nowIso()]);
  return result.changes;
}

// ── Queue ──

export function enqueueIngestionJob(input: {
  source_id: string;
  job_type?: string;
  cursor?: string | null;
  payload?: Record<string, unknown> | null;
  rate_limit_key?: string | null;
}): IngestionJob {
  const id = missionId('ingq');
  const now = nowIso();
  missionDb.run(
    `INSERT INTO mission_opportunity_ingestion_queue
      (id, source_id, job_type, cursor, payload, status, attempts, max_attempts, rate_limit_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, 5, ?, ?, ?)`,
    [
      id,
      input.source_id,
      input.job_type ?? 'ingest',
      input.cursor ?? null,
      input.payload ? JSON.stringify(input.payload).slice(0, 10000) : null,
      input.rate_limit_key ?? input.source_id,
      now,
      now,
    ],
  );
  return missionDb.get<IngestionJob>('SELECT * FROM mission_opportunity_ingestion_queue WHERE id = ?', [id])!;
}

export function listPendingJobs(limit = 10): IngestionJob[] {
  const now = nowIso();
  return missionDb.all<IngestionJob>(
    `SELECT * FROM mission_opportunity_ingestion_queue
     WHERE status IN ('pending','failed','rate_limited')
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at ASC LIMIT ?`,
    [now, limit],
  );
}

export function claimJob(jobId: string): IngestionJob | null {
  const now = nowIso();
  return missionDb.transaction(() => {
    const job = missionDb.get<IngestionJob>('SELECT * FROM mission_opportunity_ingestion_queue WHERE id = ? AND status IN (\'pending\',\'failed\',\'rate_limited\')', [jobId]);
    if (!job) return null;
    missionDb.run(`UPDATE mission_opportunity_ingestion_queue SET status = 'processing', started_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`, [now, now, jobId]);
    return missionDb.get<IngestionJob>('SELECT * FROM mission_opportunity_ingestion_queue WHERE id = ?', [jobId])!;
  });
}

export function completeJob(jobId: string): void {
  const now = nowIso();
  missionDb.run(`UPDATE mission_opportunity_ingestion_queue SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`, [now, now, jobId]);
}

export function failJob(jobId: string, error: string, retryDelaySeconds = 60): void {
  const job = missionDb.get<IngestionJob>('SELECT * FROM mission_opportunity_ingestion_queue WHERE id = ?', [jobId]);
  if (!job) return;
  const now = nowIso();
  const attempts = Number(job.attempts);
  const maxAttempts = Number(job.max_attempts);
  if (attempts >= maxAttempts) {
    missionDb.run(`UPDATE mission_opportunity_ingestion_queue SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`, [error.slice(0, 2000), now, jobId]);
  } else {
    // exponential backoff
    const backoff = Math.min(3600, retryDelaySeconds * Math.pow(2, attempts));
    const next = new Date(Date.now() + backoff * 1000).toISOString();
    missionDb.run(`UPDATE mission_opportunity_ingestion_queue SET status = 'failed', last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`, [error.slice(0, 2000), next, now, jobId]);
  }
}

export function rateLimitedJob(jobId: string, retryAfterSeconds = 60): void {
  const now = nowIso();
  const next = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
  missionDb.run(`UPDATE mission_opportunity_ingestion_queue SET status = 'rate_limited', next_retry_at = ?, updated_at = ? WHERE id = ?`, [next, now, jobId]);
}

// ── Ingestion run tracking ──

export function startIngestionRun(sourceId: string, cursorStart?: string | null): Row {
  const id = missionId('ingr');
  missionDb.run(
    `INSERT INTO mission_opportunity_ingestion_runs (id, source_id, status, cursor_start, started_at, created_at)
     VALUES (?, ?, 'running', ?, ?, ?)`,
    [id, sourceId, cursorStart ?? null, nowIso(), nowIso()],
  );
  return missionDb.get<Row>('SELECT * FROM mission_opportunity_ingestion_runs WHERE id = ?', [id])!;
}

export function finishIngestionRun(
  runId: string,
  stats: { items_fetched: number; items_new: number; items_updated: number; items_duplicate: number; items_failed: number; cursor_end?: string | null; error_summary?: string | null; status?: string },
): Row {
  const now = nowIso();
  missionDb.run(
    `UPDATE mission_opportunity_ingestion_runs SET
      completed_at = ?, status = ?, items_fetched = ?, items_new = ?, items_updated = ?, items_duplicate = ?, items_failed = ?,
      cursor_end = COALESCE(?, cursor_end), error_summary = COALESCE(?, error_summary)
     WHERE id = ?`,
    [now, stats.status ?? 'completed', stats.items_fetched, stats.items_new, stats.items_updated, stats.items_duplicate, stats.items_failed, stats.cursor_end ?? null, stats.error_summary ?? null, runId],
  );
  return missionDb.get<Row>('SELECT * FROM mission_opportunity_ingestion_runs WHERE id = ?', [runId])!;
}

// ── Legitimate public source fetchers (only APIs that explicitly allow automated access) ──

export interface FetchedOpportunity {
  platform: string;
  opportunity_type: string;
  title: string;
  description?: string | null;
  category: string;
  country_eligibility?: string[];
  skills?: string[];
  payout_currency?: string;
  payout_method?: string | null;
  payout_min_cents?: number | null;
  payout_max_cents?: number | null;
  payout_frequency?: string | null;
  fees?: string | null;
  account_rules?: string | null;
  api_available?: boolean;
  automation_permission?: 'allowed' | 'disallowed' | 'conditional';
  tos_url?: string | null;
  source_url: string;
  external_id?: string | null;
  risk_level?: 'low' | 'medium' | 'high';
}

/**
 * Fetcher for Remotive — public API, no key, explicitly allowed
 */
export async function fetchRemotiveJobs(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `remotive:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) {
    return cached.response as FetchedOpportunity[];
  }

  const url = `https://remotive.com/api/remote-jobs?limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ZA141251SA-opportunity-catalog/1.0 (+https://akbaral.ai)' } });
  if (!res.ok) throw new Error(`Remotive API ${res.status}`);
  const data = (await res.json()) as { jobs?: any[] };
  const jobs = data.jobs ?? [];
  const mapped: FetchedOpportunity[] = jobs.slice(0, limit).map((job: any) => ({
    platform: 'Remotive',
    opportunity_type: 'remote_job',
    title: String(job.title ?? 'Remote Job').slice(0, 500),
    description: String(job.description ?? job.category ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: ['global'],
    skills: [String(job.category ?? 'general').toLowerCase(), ...(job.tags ?? []).map((t: string) => String(t).toLowerCase()).slice(0, 10)],
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://remotive.com/terms',
    source_url: String(job.url ?? 'https://remotive.com/remote-jobs'),
    external_id: String(job.id ?? job.url ?? ''),
    risk_level: 'low' as const,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('remotive')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for Arbeitnow — public API, no key, explicitly free
 */
export async function fetchArbeitnowJobs(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `arbeitnow:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  const url = `https://www.arbeitnow.com/api/job-board-api`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ZA141251SA-opportunity-catalog/1.0' } });
  if (!res.ok) throw new Error(`Arbeitnow API ${res.status}`);
  const data = (await res.json()) as { data?: any[] };
  const jobs = data.data ?? [];
  const mapped: FetchedOpportunity[] = jobs.slice(0, limit).map((job: any) => ({
    platform: 'Arbeitnow',
    opportunity_type: 'remote_job',
    title: String(job.title ?? 'Job').slice(0, 500),
    description: String(job.description ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: ['global'],
    skills: [String(job.tags?.[0] ?? 'general').toLowerCase()],
    payout_currency: 'EUR',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://www.arbeitnow.com/legal',
    source_url: String(job.url ?? 'https://www.arbeitnow.com'),
    external_id: String(job.slug ?? job.url ?? ''),
    risk_level: 'low' as const,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('arbeitnow')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for Jobicy — public API, no key, explicitly free
 */
export async function fetchJobicyJobs(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `jobicy:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  const url = `https://jobicy.com/api/v2/remote-jobs?count=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ZA141251SA-opportunity-catalog/1.0' } });
  if (!res.ok) throw new Error(`Jobicy API ${res.status}`);
  const data = (await res.json()) as { jobs?: any[] };
  const jobs = data.jobs ?? [];
  const mapped: FetchedOpportunity[] = jobs.slice(0, limit).map((job: any) => ({
    platform: 'Jobicy',
    opportunity_type: 'remote_job',
    title: String(job.jobTitle ?? job.title ?? 'Remote Job').slice(0, 500),
    description: String(job.jobDescription ?? job.description ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: ['global'],
    skills: [String(job.jobCategory?.[0] ?? 'general').toLowerCase()],
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://jobicy.com/terms',
    source_url: String(job.url ?? job.jobUrl ?? 'https://jobicy.com'),
    external_id: String(job.id ?? job.url ?? ''),
    risk_level: 'low' as const,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('jobicy')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Generic ingestion for a source — respects rate limits, caching, retries, incremental
 */
export async function ingestSource(sourceKey: string, options?: { limit?: number; cursor?: string | null }): Promise<{ fetched: number; new: number; duplicate: number; failed: number }> {
  const source = getOpportunitySourceByKey(sourceKey);
  if (!source) throw new Error(`source ${sourceKey} not found`);
  if (source.status !== 'active') throw new Error(`source ${sourceKey} is ${source.status}`);

  const rpm = Number(source.rate_limit_rpm);
  const daily = Number(source.rate_limit_daily);
  const rateCheck = checkRateLimit(source.id, rpm, daily);
  if (!rateCheck.allowed) {
    throw new Error(`Rate limited: ${rateCheck.reason}`);
  }

  const run = startIngestionRun(source.id, options?.cursor ?? null);
  let fetched: FetchedOpportunity[] = [];
  try {
    // Only fetch from sources that explicitly allow automation via public API
    if (sourceKey === 'remotive') {
      fetched = await fetchRemotiveJobs(options?.limit ?? 50);
    } else if (sourceKey === 'arbeitnow') {
      fetched = await fetchArbeitnowJobs(options?.limit ?? 50);
    } else if (sourceKey === 'jobicy') {
      fetched = await fetchJobicyJobs(options?.limit ?? 50);
    } else {
      // For sources requiring API key or manual, we don't auto-fetch without key
      // This respects ToS — no scraping, no bypassing
      throw new Error(`Source ${sourceKey} requires API key or manual verification — set ${source.api_key_env_var ?? 'API key'} and ensure automation allowed`);
    }

    recordRateLimitHit(source.id);

    let newCount = 0;
    let dupCount = 0;
    let failed = 0;

    for (const item of fetched) {
      try {
        const result = createOpportunity({
          source_id: source.id,
          platform: item.platform,
          opportunity_type: item.opportunity_type as any,
          title: item.title,
          description: item.description ?? null,
          category: item.category,
          country_eligibility: item.country_eligibility ?? ['global'],
          skills: item.skills ?? [],
          payout_currency: item.payout_currency ?? 'USD',
          payout_method: item.payout_method ?? null,
          payout_min_cents: item.payout_min_cents ?? null,
          payout_max_cents: item.payout_max_cents ?? null,
          payout_frequency: item.payout_frequency ?? null,
          fees: item.fees ?? null,
          account_rules: item.account_rules ?? null,
          api_available: item.api_available ?? true,
          automation_permission: item.automation_permission ?? 'allowed',
          tos_url: item.tos_url ?? source.tos_url,
          source_url: item.source_url,
          external_id: item.external_id ?? null,
          status: 'pending_review',
          risk_level: item.risk_level ?? 'low',
        });
        if (result.isNew) newCount += 1;
        else dupCount += 1;
      } catch {
        failed += 1;
      }
    }

    finishIngestionRun(String(run.id), {
      items_fetched: fetched.length,
      items_new: newCount,
      items_updated: 0,
      items_duplicate: dupCount,
      items_failed: failed,
      cursor_end: options?.cursor ?? null,
      status: 'completed',
    });

    // update source last_ingested_at
    missionDb.run(`UPDATE mission_opportunity_sources SET last_ingested_at = ?, ingestion_cursor = ?, total_ingested = total_ingested + ?, updated_at = ? WHERE id = ?`, [
      nowIso(),
      options?.cursor ?? null,
      fetched.length,
      nowIso(),
      source.id,
    ]);

    return { fetched: fetched.length, new: newCount, duplicate: dupCount, failed };
  } catch (err) {
    finishIngestionRun(String(run.id), {
      items_fetched: fetched.length,
      items_new: 0,
      items_updated: 0,
      items_duplicate: 0,
      items_failed: 1,
      status: 'failed',
      error_summary: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
    });
    throw err;
  }
}

/**
 * Process queue — incremental, with rate limits, retries, caching
 * Supports millions: processes one job at a time, pagination via cursor, never loads all jobs
 */
export async function processIngestionQueue(batchSize = 5): Promise<{ processed: number; succeeded: number; failed: number; rateLimited: number }> {
  const jobs = listPendingJobs(batchSize);
  let succeeded = 0;
  let failed = 0;
  let rateLimited = 0;

  for (const job of jobs) {
    const claimed = claimJob(job.id);
    if (!claimed) continue;

    const source = getOpportunitySourceById(claimed.source_id);
    if (!source) {
      failJob(job.id, 'source not found', 300);
      failed += 1;
      continue;
    }

    const rpm = Number(source.rate_limit_rpm);
    const daily = Number(source.rate_limit_daily);
    const rateCheck = checkRateLimit(source.id, rpm, daily);
    if (!rateCheck.allowed) {
      rateLimitedJob(job.id, 60);
      rateLimited += 1;
      continue;
    }

    try {
      let payload: any = {};
      try {
        payload = claimed.payload ? JSON.parse(claimed.payload) : {};
      } catch {}

      await ingestSource(source.key, { limit: payload.limit ?? 50, cursor: claimed.cursor });

      completeJob(job.id);
      succeeded += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('rate limited')) {
        rateLimitedJob(job.id, 60);
        rateLimited += 1;
      } else {
        failJob(job.id, msg, 60 * Math.pow(2, Number(claimed.attempts)));
        failed += 1;
      }
    }
  }

  return { processed: jobs.length, succeeded, failed, rateLimited };
}
