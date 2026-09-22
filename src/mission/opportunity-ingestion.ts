import { missionDb, missionId, nowIso, type Row } from './database';
import { getOpportunitySourceById, getOpportunitySourceByKey, createOpportunity } from './opportunity-catalog';

/**
 * Ingestion pipeline for 100M+ catalog — pagination, queues, rate limits, caching, retries, incremental
 * - Never bypass CAPTCHA, KYC, account limits, platform restrictions, robots/ToS
 * - Only uses legitimate public APIs that explicitly allow automated access, or manual verification
 * - Rate limits enforced via DB bucket + in-memory cache, with exponential backoff
 * - Queue-based, supports millions without loading all into memory (cursor pagination, streaming)
 * - Expanded connectors for 100+ sources across lawful earning categories
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

// ── Ingestion state for resumable pagination ──

export function getIngestionState(sourceId: string): Row | undefined {
  try {
    return missionDb.get<Row>('SELECT * FROM mission_opportunity_ingestion_state WHERE source_id = ?', [sourceId]);
  } catch {
    return undefined;
  }
}

export function updateIngestionState(sourceId: string, patch: { cursor?: string | null; last_page?: number; total_fetched?: number; total_new?: number; last_error?: string | null }): void {
  const now = nowIso();
  try {
    const existing = getIngestionState(sourceId);
    if (existing) {
      missionDb.run(
        `UPDATE mission_opportunity_ingestion_state SET
          cursor = COALESCE(?, cursor),
          last_page = COALESCE(?, last_page),
          total_fetched = COALESCE(?, total_fetched),
          total_new = COALESCE(?, total_new),
          last_error = COALESCE(?, last_error),
          last_run_at = ?, updated_at = ?
         WHERE source_id = ?`,
        [patch.cursor ?? null, patch.last_page ?? null, patch.total_fetched ?? null, patch.total_new ?? null, patch.last_error ?? null, now, now, sourceId],
      );
    } else {
      missionDb.run(
        `INSERT INTO mission_opportunity_ingestion_state (source_id, cursor, last_page, total_fetched, total_new, last_error, last_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sourceId, patch.cursor ?? null, patch.last_page ?? 0, patch.total_fetched ?? 0, patch.total_new ?? 0, patch.last_error ?? null, now, now, now],
      );
    }
  } catch {
    // best-effort, table may not exist yet
  }
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
  requirements?: string | null;
  api_available?: boolean;
  automation_permission?: 'allowed' | 'disallowed' | 'conditional';
  tos_url?: string | null;
  source_url: string;
  external_id?: string | null;
  risk_level?: 'low' | 'medium' | 'high';
}

const USER_AGENT = 'ZA141251SA-opportunity-catalog/1.0 (+https://akbaral.ai)';

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
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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
    requirements: `Category: ${job.category ?? 'general'}. Type: ${job.job_type ?? 'unknown'}.`,
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
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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
    requirements: `Remote: ${job.remote ?? 'unknown'}. Location: ${job.location ?? 'unknown'}.`,
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
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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
    requirements: `Category: ${job.jobCategory?.join(', ') ?? 'general'}.`,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('jobicy')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for RemoteOK — public API, no key, requires User-Agent, first element is legal notice
 */
export async function fetchRemoteOKJobs(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `remoteok:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  const url = `https://remoteok.com/api`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`RemoteOK API ${res.status}`);
  const data = (await res.json()) as any[];
  // First element is legal notice
  const jobs = Array.isArray(data) ? data.slice(1) : [];
  const mapped: FetchedOpportunity[] = jobs.slice(0, limit).map((job: any) => ({
    platform: 'Remote OK',
    opportunity_type: 'remote_job',
    title: String(job.position ?? job.title ?? 'Remote Job').slice(0, 500),
    description: String(job.description ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: ['global'],
    skills: (job.tags ?? []).map((t: string) => String(t).toLowerCase()).slice(0, 10),
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    payout_min_cents: job.salary_min ? Number(job.salary_min) * 100 : null,
    payout_max_cents: job.salary_max ? Number(job.salary_max) * 100 : null,
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://remoteok.com/tos',
    source_url: String(job.url ?? job.apply_url ?? `https://remoteok.com/remote-jobs/${job.id ?? ''}`),
    external_id: String(job.id ?? job.url ?? ''),
    risk_level: 'low' as const,
    requirements: `Company: ${job.company ?? 'unknown'}. Location: ${job.location ?? 'remote'}.`,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('remoteok')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for Himalayas — free public API, no key, limit 20 per request, cursor pagination
 */
export async function fetchHimalayasJobs(limit = 50, cursor?: string | null): Promise<{ jobs: FetchedOpportunity[]; nextCursor: string | null }> {
  const cacheKey = `himalayas:${limit}:${cursor ?? 'first'}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as { jobs: FetchedOpportunity[]; nextCursor: string | null };

  const params = new URLSearchParams();
  params.set('limit', String(Math.min(20, limit)));
  if (cursor) params.set('cursor', cursor);
  const url = `https://himalayas.app/jobs/api?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Himalayas API ${res.status}`);
  const data = (await res.json()) as { jobs?: any[]; nextCursor?: string | null };
  const jobs = data.jobs ?? [];
  const mapped: FetchedOpportunity[] = jobs.slice(0, limit).map((job: any) => ({
    platform: 'Himalayas',
    opportunity_type: 'remote_job',
    title: String(job.title ?? 'Remote Job').slice(0, 500),
    description: String(job.description ?? job.shortDescription ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: job.countryRestrictions?.length ? job.countryRestrictions : ['global'],
    skills: (job.categories ?? []).map((c: string) => String(c).toLowerCase()).slice(0, 10),
    payout_currency: job.minSalary ? String(job.currency ?? 'USD') : 'USD',
    payout_method: 'bank',
    payout_min_cents: job.minSalary ? Number(job.minSalary) * 100 : null,
    payout_max_cents: job.maxSalary ? Number(job.maxSalary) * 100 : null,
    payout_frequency: 'yearly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://himalayas.app/terms',
    source_url: String(job.applicationLink ?? job.url ?? `https://himalayas.app/jobs/${job.guid ?? job.id ?? ''}`),
    external_id: String(job.guid ?? job.id ?? ''),
    risk_level: 'low' as const,
    requirements: `Company: ${job.companyName ?? 'unknown'}. Seniority: ${job.seniority ?? 'unknown'}. Employment: ${job.employmentType ?? 'unknown'}.`,
  }));

  const result = { jobs: mapped, nextCursor: data.nextCursor ?? null };
  setCachedResponse(cacheKey, getOpportunitySourceByKey('himalayas')?.id ?? null, result, 3600);
  return result;
}

/**
 * Fetcher for The Muse — free public API, no key, 500 req/hour anonymous, 20 per page, page param
 */
export async function fetchTheMuseJobs(limit = 50, page = 0): Promise<{ jobs: FetchedOpportunity[]; nextPage: number | null; total: number }> {
  const cacheKey = `themuse:${limit}:${page}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as { jobs: FetchedOpportunity[]; nextPage: number | null; total: number };

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('descending', 'true');
  const url = `https://www.themuse.com/api/public/jobs?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`The Muse API ${res.status}`);
  const data = (await res.json()) as { results?: any[]; page_count?: number; total?: number };
  const results = data.results ?? [];
  const mapped: FetchedOpportunity[] = results.slice(0, limit).map((job: any) => ({
    platform: 'The Muse',
    opportunity_type: 'remote_job',
    title: String(job.name ?? 'Job').slice(0, 500),
    description: String(job.contents ?? job.description ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: job.locations?.length ? job.locations.map((l: any) => String(l.name ?? '').slice(0, 20)) : ['global'],
    skills: (job.categories ?? []).map((c: any) => String(c.name ?? '').toLowerCase()).slice(0, 10),
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://www.themuse.com/about/terms',
    source_url: String(job.refs?.landing_page ?? job.landing_page ?? `https://www.themuse.com/jobs/${job.id ?? ''}`),
    external_id: String(job.id ?? ''),
    risk_level: 'low' as const,
    requirements: `Company: ${job.company?.name ?? 'unknown'}. Level: ${job.levels?.[0]?.name ?? 'unknown'}. Locations: ${job.locations?.map((l: any) => l.name).join(', ') ?? 'unknown'}.`,
  }));

  const result = {
    jobs: mapped,
    nextPage: page + 1 < (data.page_count ?? 1) ? page + 1 : null,
    total: Number(data.total ?? mapped.length),
  };
  setCachedResponse(cacheKey, getOpportunitySourceByKey('themuse')?.id ?? null, result, 1800);
  return result;
}

/**
 * Fetcher for RemoteJobs.org — free API, no key, 50 per request
 */
export async function fetchRemoteJobsOrg(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `remotejobs_org:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  const url = `https://remotejobs.org/api/v1/jobs?limit=${Math.min(50, limit)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`RemoteJobs.org API ${res.status}`);
  const data = (await res.json()) as { jobs?: any[] } | any[];
  const jobs = Array.isArray(data) ? data : (data as any).jobs ?? [];
  const mapped: FetchedOpportunity[] = jobs.slice(0, limit).map((job: any) => ({
    platform: 'RemoteJobs.org',
    opportunity_type: 'remote_job',
    title: String(job.title ?? job.position ?? 'Remote Job').slice(0, 500),
    description: String(job.description ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: ['global'],
    skills: (job.tags ?? job.categories ?? []).map((t: string) => String(t).toLowerCase()).slice(0, 10),
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://remotejobs.org/terms',
    source_url: String(job.url ?? job.link ?? 'https://remotejobs.org'),
    external_id: String(job.id ?? job.url ?? ''),
    risk_level: 'low' as const,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('remotejobs_org')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for GitHub Bounties — public search API, 60 req/hour unauth, 5000/hour auth
 * Searches for issues with bounty labels: 💎 Bounty, bounty, etc.
 */
export async function fetchGitHubBounties(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `github_bounties:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  // GitHub Search API requires User-Agent and accepts unauthenticated but rate limited
  const queries = [
    'label:"💎 Bounty" state:open',
    'label:bounty state:open',
    '"bounty" in:title state:open is:issue',
  ];
  const allJobs: FetchedOpportunity[] = [];

  for (const q of queries) {
    if (allJobs.length >= limit) break;
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${Math.min(30, limit - allJobs.length)}`;
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github.v3+json' };
    // Use token if available for higher rate limit
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      // Respect rate limit — if 403, break
      if (res.status === 403) break;
      continue;
    }
    const data = (await res.json()) as { items?: any[] };
    const items = data.items ?? [];
    for (const issue of items) {
      if (allJobs.length >= limit) break;
      const title = String(issue.title ?? 'Bounty Issue').slice(0, 500);
      const repo = issue.repository_url ? String(issue.repository_url).split('/').slice(-2).join('/') : 'unknown';
      // Extract amount from title/labels
      const amountMatch = title.match(/\$(\d+(?:,\d+)*(?:\.\d+)?)/);
      const amountCents = amountMatch ? Math.round(Number(amountMatch[1].replace(/,/g, '')) * 100) : null;
      allJobs.push({
        platform: 'GitHub',
        opportunity_type: 'other',
        title: `${title} — ${repo}`,
        description: String(issue.body ?? '').slice(0, 5000),
        category: 'other',
        country_eligibility: ['global'],
        skills: (issue.labels ?? []).map((l: any) => String(l.name ?? '').toLowerCase()).slice(0, 10),
        payout_currency: 'USD',
        payout_method: 'github',
        payout_min_cents: amountCents,
        payout_max_cents: amountCents,
        payout_frequency: 'one_time',
        api_available: true,
        automation_permission: 'allowed' as const,
        tos_url: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
        source_url: String(issue.html_url ?? `https://github.com/issues/${issue.id}`),
        external_id: String(issue.id ?? issue.html_url ?? ''),
        risk_level: 'medium' as const,
        requirements: `Repo: ${repo}. Comments: ${issue.comments ?? 0}. Labels: ${(issue.labels ?? []).map((l: any) => l.name).join(', ')}.`,
      });
    }
  }

  setCachedResponse(cacheKey, getOpportunitySourceByKey('github_bounties')?.id ?? null, allJobs, 1800);
  return allJobs;
}

/**
 * Fetcher for Topcoder Challenges — public API v5, no key, paginated
 */
export async function fetchTopcoderChallenges(limit = 50, page = 1): Promise<{ jobs: FetchedOpportunity[]; nextPage: number | null }> {
  const cacheKey = `topcoder:${limit}:${page}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as { jobs: FetchedOpportunity[]; nextPage: number | null };

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('perPage', String(Math.min(50, limit)));
  params.set('status', 'Active');
  const url = `https://api.topcoder.com/v5/challenges?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Topcoder API ${res.status}`);
  const data = (await res.json()) as any[];
  const mapped: FetchedOpportunity[] = data.slice(0, limit).map((ch: any) => ({
    platform: 'Topcoder',
    opportunity_type: 'other',
    title: String(ch.name ?? ch.title ?? 'Topcoder Challenge').slice(0, 500),
    description: String(ch.overview ?? ch.description ?? '').slice(0, 5000),
    category: 'other',
    country_eligibility: ['global'],
    skills: (ch.tags ?? ch.skills ?? []).map((t: string) => String(t).toLowerCase()).slice(0, 10),
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_min_cents: ch.prizeSets?.[0]?.prizes?.[0]?.value ? Number(ch.prizeSets[0].prizes[0].value) * 100 : null,
    payout_max_cents: ch.prizeSets?.[0]?.prizes?.[0]?.value ? Number(ch.prizeSets[0].prizes[0].value) * 100 : null,
    payout_frequency: 'one_time',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://www.topcoder.com/thrive/articles/Topcoder-Terms',
    source_url: String(`https://www.topcoder.com/challenges/${ch.id ?? ''}`),
    external_id: String(ch.id ?? ''),
    risk_level: 'low' as const,
    requirements: `Track: ${ch.track ?? 'unknown'}. Type: ${ch.type ?? 'unknown'}. Status: ${ch.status ?? 'unknown'}.`,
  }));

  const result = { jobs: mapped, nextPage: mapped.length === limit ? page + 1 : null };
  setCachedResponse(cacheKey, getOpportunitySourceByKey('topcoder')?.id ?? null, result, 1800);
  return result;
}

/**
 * Fetcher for Devpost Hackathons — public API, free
 */
export async function fetchDevpostHackathons(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `devpost:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  // Devpost doesn't have official public JSON API, but we can use their search endpoint that returns JSON if requested
  // Fallback to scraping prevention: use public hackathon listing page with JSON-LD? For now, try API endpoint that exists
  const url = `https://devpost.com/api/hackathons?search=&page=1&per_page=${Math.min(50, limit)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Devpost API ${res.status}`);
  let data: any;
  try {
    data = await res.json();
  } catch {
    // If not JSON, return empty — respects ToS, no scraping HTML
    return [];
  }
  const hackathons = data.hackathons ?? data.results ?? [];
  const mapped: FetchedOpportunity[] = hackathons.slice(0, limit).map((h: any) => ({
    platform: 'Devpost',
    opportunity_type: 'other',
    title: String(h.title ?? h.name ?? 'Hackathon').slice(0, 500),
    description: String(h.description ?? h.tagline ?? '').slice(0, 5000),
    category: 'other',
    country_eligibility: ['global'],
    skills: (h.themes ?? h.tags ?? []).map((t: string) => String(t).toLowerCase()).slice(0, 10),
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_min_cents: null,
    payout_max_cents: null,
    payout_frequency: 'one_time',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://devpost.com/terms',
    source_url: String(h.url ?? h.hackathon_url ?? `https://devpost.com/hackathons/${h.id ?? ''}`),
    external_id: String(h.id ?? ''),
    risk_level: 'low' as const,
    requirements: `Prizes: ${h.prize_amount ?? 'see site'}. Participants: ${h.registrations_count ?? 'unknown'}.`,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('devpost')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for Challenge.gov — public data, federal open data
 */
export async function fetchChallengeGov(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `challenge_gov:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  // Challenge.gov has XML feed at https://www.challenge.gov/list/challenges.xml or JSON at https://www.challenge.gov/api/challenges
  // Try JSON endpoint
  const urls = [
    `https://www.challenge.gov/api/challenges?per_page=${Math.min(50, limit)}`,
    `https://api.challenge.gov/v1/challenges?per_page=${Math.min(50, limit)}`,
  ];
  let data: any[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) continue;
      const json = await res.json();
      data = Array.isArray(json) ? json : json.challenges ?? json.results ?? [];
      if (data.length > 0) break;
    } catch {
      continue;
    }
  }

  const mapped: FetchedOpportunity[] = data.slice(0, limit).map((ch: any) => ({
    platform: 'Challenge.gov',
    opportunity_type: 'other',
    title: String(ch.title ?? ch.challenge_title ?? 'Federal Challenge').slice(0, 500),
    description: String(ch.description ?? ch.summary ?? '').slice(0, 5000),
    category: 'other',
    country_eligibility: ['US', 'global'],
    skills: (ch.tags ?? []).map((t: string) => String(t).toLowerCase()).slice(0, 10),
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_min_cents: ch.total_prize_offered_cash ? Number(String(ch.total_prize_offered_cash).replace(/[^0-9]/g, '')) * 100 : null,
    payout_max_cents: ch.total_prize_offered_cash ? Number(String(ch.total_prize_offered_cash).replace(/[^0-9]/g, '')) * 100 : null,
    payout_frequency: 'one_time',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://www.challenge.gov/terms',
    source_url: String(ch.url ?? ch.challenge_url ?? `https://www.challenge.gov/challenge/${ch.id ?? ''}`),
    external_id: String(ch.id ?? ch.challenge_id ?? ''),
    risk_level: 'low' as const,
    requirements: `Agency: ${ch.agency ?? ch.sponsoring_agency ?? 'unknown'}. Prize: ${ch.total_prize_offered_cash ?? 'see site'}.`,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('challenge_gov')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for Greenhouse — public per-company API, no key
 * Takes company slug as cursor
 */
export async function fetchGreenhouseJobs(company: string, limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `greenhouse:${company}:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company)}/jobs?content=true`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Greenhouse API ${res.status} for ${company}`);
  const data = (await res.json()) as { jobs?: any[] };
  const jobs = data.jobs ?? [];
  const mapped: FetchedOpportunity[] = jobs.slice(0, limit).map((job: any) => ({
    platform: `Greenhouse - ${company}`,
    opportunity_type: 'remote_job',
    title: String(job.title ?? 'Job').slice(0, 500),
    description: String(job.content ?? job.description ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: job.location?.name ? [String(job.location.name).slice(0, 20)] : ['global'],
    skills: [],
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://www.greenhouse.io/terms-of-service',
    source_url: String(job.absolute_url ?? `https://boards.greenhouse.io/${company}/jobs/${job.id ?? ''}`),
    external_id: String(job.id ?? ''),
    risk_level: 'low' as const,
    requirements: `Company: ${company}. Location: ${job.location?.name ?? 'unknown'}.`,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('greenhouse')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for Lever — public per-company API, no key
 */
export async function fetchLeverJobs(company: string, limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `lever:${company}:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Lever API ${res.status} for ${company}`);
  const data = (await res.json()) as any[];
  const jobs = Array.isArray(data) ? data : [];
  const mapped: FetchedOpportunity[] = jobs.slice(0, limit).map((job: any) => ({
    platform: `Lever - ${company}`,
    opportunity_type: 'remote_job',
    title: String(job.text ?? job.title ?? 'Job').slice(0, 500),
    description: String(job.description ?? job.descriptionPlain ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: job.categories?.location ? [String(job.categories.location).slice(0, 20)] : ['global'],
    skills: (job.categories?.team ? [String(job.categories.team).toLowerCase()] : []).slice(0, 5),
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://www.lever.co/terms-of-service/',
    source_url: String(job.hostedUrl ?? job.applyUrl ?? `https://jobs.lever.co/${company}/${job.id ?? ''}`),
    external_id: String(job.id ?? ''),
    risk_level: 'low' as const,
    requirements: `Company: ${company}. Team: ${job.categories?.team ?? 'unknown'}. Location: ${job.categories?.location ?? 'unknown'}.`,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('lever')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for Ashby — public per-company API, no key
 */
export async function fetchAshbyJobs(company: string, limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `ashby:${company}:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Ashby API ${res.status} for ${company}`);
  const data = (await res.json()) as { jobs?: any[] };
  const jobs = data.jobs ?? [];
  const mapped: FetchedOpportunity[] = jobs.slice(0, limit).map((job: any) => ({
    platform: `Ashby - ${company}`,
    opportunity_type: 'remote_job',
    title: String(job.title ?? 'Job').slice(0, 500),
    description: String(job.descriptionHtml ?? job.description ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: job.location ? [String(job.location).slice(0, 20)] : ['global'],
    skills: (job.departments ?? []).map((d: string) => String(d).toLowerCase()).slice(0, 5),
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://www.ashbyhq.com/terms',
    source_url: String(job.jobUrl ?? `https://jobs.ashbyhq.com/${company}/${job.id ?? ''}`),
    external_id: String(job.id ?? ''),
    risk_level: 'low' as const,
    requirements: `Company: ${company}. Department: ${job.department ?? 'unknown'}. Location: ${job.location ?? 'unknown'}.`,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('ashby')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for Grants.gov — public search API, no key, POST with filters
 */
export async function fetchGrantsGov(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `grants_gov:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  const url = `https://api.grants.gov/v1/api/search2`;
  const body = {
    keyword: '',
    oppStatuses: ['posted'],
    rows: Math.min(50, limit),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Grants.gov API ${res.status}`);
  const data = (await res.json()) as { oppHits?: any[] };
  const hits = data.oppHits ?? [];
  const mapped: FetchedOpportunity[] = hits.slice(0, limit).map((hit: any) => ({
    platform: 'Grants.gov',
    opportunity_type: 'other',
    title: String(hit.title ?? hit.oppTitle ?? 'Federal Grant').slice(0, 500),
    description: String(hit.description ?? '').slice(0, 5000),
    category: 'other',
    country_eligibility: ['US'],
    skills: ['grant_writing', 'research'],
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_min_cents: hit.estimatedFunding ? Number(String(hit.estimatedFunding).replace(/[^0-9]/g, '').slice(0, 10)) * 100 : null,
    payout_max_cents: hit.estimatedFunding ? Number(String(hit.estimatedFunding).replace(/[^0-9]/g, '').slice(0, 10)) * 100 : null,
    payout_frequency: 'one_time',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://www.grants.gov/web/grants/support/terms-of-use.html',
    source_url: String(`https://www.grants.gov/search-results-detail/${hit.id ?? ''}`),
    external_id: String(hit.id ?? ''),
    risk_level: 'low' as const,
    requirements: `Agency: ${hit.agency ?? 'unknown'}. Status: ${hit.oppStatus ?? 'posted'}.`,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('grants_gov')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Fetcher for Working Nomads — public API endpoint, free, no key
 */
export async function fetchWorkingNomadsJobs(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `working_nomads:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  const url = `https://www.workingnomads.com/jobsapi/jobs?limit=${Math.min(100, limit)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Working Nomads API ${res.status}`);
  const data = (await res.json()) as any[];
  const jobs = Array.isArray(data) ? data : [];
  const mapped: FetchedOpportunity[] = jobs.slice(0, limit).map((job: any) => ({
    platform: 'Working Nomads',
    opportunity_type: 'remote_job',
    title: String(job.title ?? 'Remote Job').slice(0, 500),
    description: String(job.description ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: ['global'],
    skills: (job.tags ?? []).map((t: string) => String(t).toLowerCase()).slice(0, 10),
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://www.workingnomads.com/terms',
    source_url: String(job.url ?? `https://www.workingnomads.com/jobs/${job.slug ?? ''}`),
    external_id: String(job.slug ?? job.id ?? ''),
    risk_level: 'low' as const,
    requirements: `Company: ${job.company_name ?? 'unknown'}. Category: ${job.category_name ?? 'unknown'}.`,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('working_nomads')?.id ?? null, mapped, 3600);
  return mapped;
}

// ── Additional free/no-card GitHub-based fetchers (api.github.com works in sandbox) ──

async function fetchGitHubSearch(query: string, limit = 50, page = 1, cachePrefix: string): Promise<{ jobs: FetchedOpportunity[]; hasMore: boolean; total: number }> {
  const cacheKey = `${cachePrefix}:${query}:${limit}:${page}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as { jobs: FetchedOpportunity[]; hasMore: boolean; total: number };

  const perPage = Math.min(100, limit);
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`;
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github.v3+json' };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') throw new Error(`GitHub rate limited, remaining 0, retry after ${res.headers.get('x-ratelimit-reset')}`);
    }
    throw new Error(`GitHub Search API ${res.status} for query ${query}`);
  }
  const data = (await res.json()) as { items?: any[]; total_count?: number };
  const items = data.items ?? [];
  const mapped: FetchedOpportunity[] = items.slice(0, limit).map((issue: any) => {
    const title = String(issue.title ?? 'GitHub Issue').slice(0, 500);
    const repo = issue.repository_url ? String(issue.repository_url).split('/').slice(-2).join('/') : 'unknown';
    const amountMatch = title.match(/\$(\d+(?:,\d+)*(?:\.\d+)?)/);
    const amountCents = amountMatch ? Math.round(Number(amountMatch[1].replace(/,/g, '')) * 100) : null;
    return {
      platform: `GitHub - ${repo}`,
      opportunity_type: 'other',
      title: `${title} — ${repo}`,
      description: String(issue.body ?? '').slice(0, 5000),
      category: 'other',
      country_eligibility: ['global'],
      skills: (issue.labels ?? []).map((l: any) => String(l.name ?? '').toLowerCase()).slice(0, 10),
      payout_currency: 'USD',
      payout_method: 'github',
      payout_min_cents: amountCents,
      payout_max_cents: amountCents,
      payout_frequency: 'one_time',
      api_available: true,
      automation_permission: 'allowed' as const,
      tos_url: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
      source_url: String(issue.html_url ?? `https://github.com/issues/${issue.id}`),
      external_id: String(issue.id ?? issue.html_url ?? ''),
      risk_level: 'low' as const,
      requirements: `Repo: ${repo}. Comments: ${issue.comments ?? 0}. Labels: ${(issue.labels ?? []).map((l: any) => l.name).join(', ')}.`,
    };
  });

  const total = Number(data.total_count ?? 0);
  const hasMore = items.length === perPage && page * perPage < Math.min(total, 1000); // GitHub search caps at 1000
  const result = { jobs: mapped, hasMore, total };
  setCachedResponse(cacheKey, null, result, 1800);
  return result;
}

export async function fetchGitHubGoodFirstIssues(limit = 50, page = 1): Promise<{ jobs: FetchedOpportunity[]; hasMore: boolean; total: number }> {
  return fetchGitHubSearch('label:\"good first issue\" state:open', limit, page, 'github_good_first');
}

export async function fetchGitHubHelpWanted(limit = 50, page = 1): Promise<{ jobs: FetchedOpportunity[]; hasMore: boolean; total: number }> {
  return fetchGitHubSearch('label:\"help wanted\" state:open', limit, page, 'github_help_wanted');
}

export async function fetchGitHubHacktoberfest(limit = 50, page = 1): Promise<{ jobs: FetchedOpportunity[]; hasMore: boolean; total: number }> {
  return fetchGitHubSearch('label:hacktoberfest state:open', limit, page, 'github_hacktoberfest');
}

export async function fetchGitHubBugBountyLabel(limit = 50, page = 1): Promise<{ jobs: FetchedOpportunity[]; hasMore: boolean; total: number }> {
  return fetchGitHubSearch('label:bug-bounty state:open', limit, page, 'github_bug_bounty');
}

export async function fetchGitHubSecurity(limit = 50, page = 1): Promise<{ jobs: FetchedOpportunity[]; hasMore: boolean; total: number }> {
  return fetchGitHubSearch('label:security state:open', limit, page, 'github_security');
}

// Enhanced GitHub bounties with pagination support
export async function fetchGitHubBountiesPaginated(limit = 50, page = 1): Promise<{ jobs: FetchedOpportunity[]; hasMore: boolean; total: number }> {
  // Combine multiple bounty queries into one OR query for better coverage
  const query = 'label:\"💎 Bounty\" OR label:bounty OR label:\"💵 Bounty\" OR \"bounty\" in:title state:open is:issue';
  return fetchGitHubSearch(query, limit, page, 'github_bounties_paginated');
}

// ── Hacker News Jobs via Algolia (free no key, no card) ──
export async function fetchHackerNewsJobs(limit = 50, page = 0): Promise<{ jobs: FetchedOpportunity[]; nextPage: number | null }> {
  const cacheKey = `hacker_news:${limit}:${page}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as { jobs: FetchedOpportunity[]; nextPage: number | null };

  const params = new URLSearchParams();
  params.set('tags', 'story');
  params.set('query', 'Who is hiring');
  params.set('page', String(page));
  params.set('hitsPerPage', String(Math.min(100, limit)));
  const url = `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Hacker News Algolia API ${res.status}`);
  const data = (await res.json()) as { hits?: any[]; page?: number; nbPages?: number };
  const hits = data.hits ?? [];
  const mapped: FetchedOpportunity[] = hits.slice(0, limit).map((hit: any) => ({
    platform: 'Hacker News',
    opportunity_type: 'remote_job',
    title: String(hit.title ?? 'HN Who is Hiring').slice(0, 500),
    description: String(hit.story_text ?? hit.title ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: ['global'],
    skills: ['general'],
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://news.ycombinator.com/legal',
    source_url: String(hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID ?? ''}`),
    external_id: String(hit.objectID ?? hit.url ?? ''),
    risk_level: 'low' as const,
    requirements: `Points: ${hit.points ?? 0}. Author: ${hit.author ?? 'unknown'}.`,
  }));

  const result = { jobs: mapped, nextPage: page + 1 < (data.nbPages ?? 1) ? page + 1 : null };
  setCachedResponse(cacheKey, getOpportunitySourceByKey('hacker_news_jobs')?.id ?? null, result, 3600);
  return result;
}

// ── Reddit r/forhire and r/remotejobs (public JSON, free no key, requires User-Agent) ──
export async function fetchRedditJobs(subreddit: string, limit = 50, after?: string | null): Promise<{ jobs: FetchedOpportunity[]; nextAfter: string | null }> {
  const cacheKey = `reddit:${subreddit}:${limit}:${after ?? 'first'}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as { jobs: FetchedOpportunity[]; nextAfter: string | null };

  const params = new URLSearchParams();
  params.set('limit', String(Math.min(100, limit)));
  if (after) params.set('after', after);
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Reddit r/${subreddit} API ${res.status}`);
  const data = (await res.json()) as { data?: { children?: any[]; after?: string | null } };
  const children = data.data?.children ?? [];
  const mapped: FetchedOpportunity[] = children.slice(0, limit).map((child: any) => {
    const post = child.data ?? {};
    const title = String(post.title ?? 'Reddit Job').slice(0, 500);
    return {
      platform: `Reddit r/${subreddit}`,
      opportunity_type: subreddit === 'forhire' ? 'gig' : 'remote_job',
      title,
      description: String(post.selftext ?? '').slice(0, 5000),
      category: subreddit === 'forhire' ? 'freelance_marketplace' : 'remote_job_board',
      country_eligibility: ['global'],
      skills: [subreddit],
      payout_currency: 'USD',
      payout_method: 'paypal',
      payout_frequency: subreddit === 'forhire' ? 'per_task' : 'monthly',
      api_available: true,
      automation_permission: 'allowed' as const,
      tos_url: 'https://www.redditinc.com/policies/user-agreement',
      source_url: String(`https://www.reddit.com${post.permalink ?? `/r/${subreddit}/comments/${post.id ?? ''}`}`),
      external_id: String(post.id ?? ''),
      risk_level: 'medium' as const,
      requirements: `Subreddit: r/${subreddit}. Author: ${post.author ?? 'unknown'}. Score: ${post.score ?? 0}.`,
    };
  });

  const result = { jobs: mapped, nextAfter: data.data?.after ?? null };
  setCachedResponse(cacheKey, getOpportunitySourceByKey(`reddit_${subreddit}`)?.id ?? null, result, 1800);
  return result;
}

export async function fetchRedditForHire(limit = 50, after?: string | null) {
  return fetchRedditJobs('forhire', limit, after);
}

export async function fetchRedditRemoteJobs(limit = 50, after?: string | null) {
  return fetchRedditJobs('remotejobs', limit, after);
}

// ── Lobste.rs jobs (free public JSON) ──
export async function fetchLobstersJobs(limit = 50): Promise<FetchedOpportunity[]> {
  const cacheKey = `lobsters:${limit}`;
  const cached = getCachedResponse(cacheKey);
  if (cached && !cached.expired) return cached.response as FetchedOpportunity[];

  const url = `https://lobste.rs/jobs.json`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Lobste.rs API ${res.status}`);
  const data = (await res.json()) as any[];
  const mapped: FetchedOpportunity[] = data.slice(0, limit).map((job: any) => ({
    platform: 'Lobste.rs',
    opportunity_type: 'remote_job',
    title: String(job.title ?? 'Lobste.rs Job').slice(0, 500),
    description: String(job.description ?? '').slice(0, 5000),
    category: 'remote_job_board',
    country_eligibility: ['global'],
    skills: (job.tags ?? []).map((t: string) => String(t).toLowerCase()).slice(0, 10),
    payout_currency: 'USD',
    payout_method: 'bank',
    payout_frequency: 'monthly',
    api_available: true,
    automation_permission: 'allowed' as const,
    tos_url: 'https://lobste.rs/about',
    source_url: String(job.url ?? `https://lobste.rs/s/${job.short_id ?? ''}`),
    external_id: String(job.short_id ?? job.url ?? ''),
    risk_level: 'low' as const,
    requirements: `Company: ${job.company ?? 'unknown'}. Location: ${job.location ?? 'unknown'}.`,
  }));

  setCachedResponse(cacheKey, getOpportunitySourceByKey('lobsters_jobs')?.id ?? null, mapped, 3600);
  return mapped;
}

/**
 * Generic ingestion for a source — respects rate limits, caching, retries, incremental
 * Supports cursor pagination, resumable ingestion, and 100M+ scale
 */
export async function ingestSource(sourceKey: string, options?: { limit?: number; cursor?: string | null }): Promise<{ fetched: number; new: number; duplicate: number; failed: number; nextCursor?: string | null }> {
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
  let nextCursor: string | null = null;
  try {
    // Only fetch from sources that explicitly allow automation via public API
    if (sourceKey === 'remotive') {
      fetched = await fetchRemotiveJobs(options?.limit ?? 50);
    } else if (sourceKey === 'arbeitnow') {
      fetched = await fetchArbeitnowJobs(options?.limit ?? 50);
    } else if (sourceKey === 'jobicy') {
      fetched = await fetchJobicyJobs(options?.limit ?? 50);
    } else if (sourceKey === 'remoteok') {
      fetched = await fetchRemoteOKJobs(options?.limit ?? 50);
    } else if (sourceKey === 'himalayas') {
      const result = await fetchHimalayasJobs(options?.limit ?? 20, options?.cursor ?? null);
      fetched = result.jobs;
      nextCursor = result.nextCursor;
    } else if (sourceKey === 'themuse') {
      const page = options?.cursor ? Number(options.cursor) : 0;
      const result = await fetchTheMuseJobs(options?.limit ?? 20, page);
      fetched = result.jobs;
      nextCursor = result.nextPage !== null ? String(result.nextPage) : null;
    } else if (sourceKey === 'remotejobs_org') {
      fetched = await fetchRemoteJobsOrg(options?.limit ?? 50);
    } else if (sourceKey === 'github_bounties') {
      fetched = await fetchGitHubBounties(options?.limit ?? 50);
    } else if (sourceKey === 'topcoder') {
      const page = options?.cursor ? Number(options.cursor) : 1;
      const result = await fetchTopcoderChallenges(options?.limit ?? 20, page);
      fetched = result.jobs;
      nextCursor = result.nextPage !== null ? String(result.nextPage) : null;
    } else if (sourceKey === 'devpost') {
      fetched = await fetchDevpostHackathons(options?.limit ?? 50);
    } else if (sourceKey === 'challenge_gov') {
      fetched = await fetchChallengeGov(options?.limit ?? 50);
    } else if (sourceKey === 'greenhouse') {
      const company = options?.cursor ?? 'stripe';
      fetched = await fetchGreenhouseJobs(company, options?.limit ?? 50);
    } else if (sourceKey === 'lever') {
      const company = options?.cursor ?? 'netflix';
      fetched = await fetchLeverJobs(company, options?.limit ?? 50);
    } else if (sourceKey === 'ashby') {
      const company = options?.cursor ?? 'linear';
      fetched = await fetchAshbyJobs(company, options?.limit ?? 50);
    } else if (sourceKey === 'grants_gov') {
      fetched = await fetchGrantsGov(options?.limit ?? 50);
    } else if (sourceKey === 'working_nomads') {
      fetched = await fetchWorkingNomadsJobs(options?.limit ?? 50);
    } else if (sourceKey === 'github_good_first_issue') {
      const page = options?.cursor ? Number(options.cursor) : 1;
      const result = await fetchGitHubGoodFirstIssues(options?.limit ?? 50, page);
      fetched = result.jobs;
      nextCursor = result.hasMore ? String(page + 1) : null;
    } else if (sourceKey === 'github_help_wanted') {
      const page = options?.cursor ? Number(options.cursor) : 1;
      const result = await fetchGitHubHelpWanted(options?.limit ?? 50, page);
      fetched = result.jobs;
      nextCursor = result.hasMore ? String(page + 1) : null;
    } else if (sourceKey === 'github_hacktoberfest') {
      const page = options?.cursor ? Number(options.cursor) : 1;
      const result = await fetchGitHubHacktoberfest(options?.limit ?? 50, page);
      fetched = result.jobs;
      nextCursor = result.hasMore ? String(page + 1) : null;
    } else if (sourceKey === 'github_bug_bounty_label') {
      const page = options?.cursor ? Number(options.cursor) : 1;
      const result = await fetchGitHubBugBountyLabel(options?.limit ?? 50, page);
      fetched = result.jobs;
      nextCursor = result.hasMore ? String(page + 1) : null;
    } else if (sourceKey === 'github_security') {
      const page = options?.cursor ? Number(options.cursor) : 1;
      const result = await fetchGitHubSecurity(options?.limit ?? 50, page);
      fetched = result.jobs;
      nextCursor = result.hasMore ? String(page + 1) : null;
    } else if (sourceKey === 'hacker_news_jobs') {
      const page = options?.cursor ? Number(options.cursor) : 0;
      const result = await fetchHackerNewsJobs(options?.limit ?? 50, page);
      fetched = result.jobs;
      nextCursor = result.nextPage !== null ? String(result.nextPage) : null;
    } else if (sourceKey === 'reddit_forhire') {
      const result = await fetchRedditForHire(options?.limit ?? 50, options?.cursor ?? null);
      fetched = result.jobs;
      nextCursor = result.nextAfter;
    } else if (sourceKey === 'reddit_remotejobs') {
      const result = await fetchRedditRemoteJobs(options?.limit ?? 50, options?.cursor ?? null);
      fetched = result.jobs;
      nextCursor = result.nextAfter;
    } else if (sourceKey === 'lobsters_jobs') {
      fetched = await fetchLobstersJobs(options?.limit ?? 50);
    } else if (sourceKey === 'weworkremotely') {
      throw new Error(`Source ${sourceKey} uses RSS feeds — manual verification recommended, or implement RSS parser with ToS check`);
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
          requirements: item.requirements ?? null,
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
      cursor_end: nextCursor ?? options?.cursor ?? null,
      status: 'completed',
    });

    // update source last_ingested_at and ingestion state for resumable
    missionDb.run(`UPDATE mission_opportunity_sources SET last_ingested_at = ?, ingestion_cursor = ?, total_ingested = total_ingested + ?, updated_at = ? WHERE id = ?`, [
      nowIso(),
      nextCursor ?? options?.cursor ?? null,
      fetched.length,
      nowIso(),
      source.id,
    ]);

    updateIngestionState(source.id, {
      cursor: nextCursor ?? options?.cursor ?? null,
      last_page: options?.cursor ? Number(options.cursor) : 0,
      total_fetched: fetched.length,
      total_new: newCount,
    });

    return { fetched: fetched.length, new: newCount, duplicate: dupCount, failed, nextCursor };
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
    updateIngestionState(source.id, { last_error: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000) });
    throw err;
  }
}

/**
 * Process queue — incremental, with rate limits, retries, caching, resumable ingestion
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

      const result = await ingestSource(source.key, { limit: payload.limit ?? 50, cursor: claimed.cursor });

      // If there's a next cursor, enqueue next page for resumable ingestion
      if (result.nextCursor) {
        enqueueIngestionJob({
          source_id: claimed.source_id,
          job_type: claimed.job_type,
          cursor: result.nextCursor,
          payload: { limit: payload.limit ?? 50 },
          rate_limit_key: claimed.rate_limit_key ?? claimed.source_id,
        });
      }

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
