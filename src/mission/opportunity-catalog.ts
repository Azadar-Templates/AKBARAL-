import { missionDb, missionId, nowIso, sha256, type Row } from './database';

/**
 * 100M+ Earning-Opportunity Discovery Catalog — ZA141251SA private mission
 *
 * - No fabricated platforms/jobs/earnings — all sources must be legitimate public with real URLs
 * - Scalable: pagination (cursor), deduplication (dedup_hash unique), indexes, never loads all into memory
 * - Source tracking, verification lifecycle, risk levels, status
 * - Stores: platform, opportunity_type, country eligibility, skills, payout currency/method, fees,
 *   account rules, API availability, automation permission, ToS URL, source URL, last verified, risk, status
 * - Preserves $1B/day per-agent objective, treasury, wallet controls, ZA isolation — no revenue counted unless verified
 */

export type OpportunityStatus = 'pending_review' | 'verified' | 'rejected' | 'expired' | 'archived';
export type RiskLevel = 'low' | 'medium' | 'high';
export type AutomationPermission = 'allowed' | 'disallowed' | 'conditional';
export type OpportunityType =
  | 'job'
  | 'gig'
  | 'affiliate_offer'
  | 'product_listing'
  | 'monetization_program'
  | 'remote_job'
  | 'survey'
  | 'microtask'
  | 'research'
  | 'digital_product'
  | 'platform_membership'
  | 'other';

export type SourceCategory =
  | 'freelance_marketplace'
  | 'affiliate_network'
  | 'remote_job_board'
  | 'creator_monetization'
  | 'e_commerce'
  | 'digital_product'
  | 'research'
  | 'survey'
  | 'microtask'
  | 'other';

export interface OpportunitySourceRow {
  id: string;
  key: string;
  name: string;
  category: SourceCategory;
  description: string | null;
  base_url: string;
  api_endpoint: string | null;
  docs_url: string | null;
  tos_url: string | null;
  privacy_url: string | null;
  requires_api_key: number;
  api_key_env_var: string | null;
  rate_limit_rpm: number;
  rate_limit_daily: number;
  automation_allowed: number;
  automation_notes: string | null;
  country_eligibility: string;
  payout_currencies: string;
  payout_methods: string;
  fees_description: string | null;
  account_rules: string | null;
  api_available: number;
  status: string;
  last_ingested_at: string | null;
  last_verified_at: string | null;
  ingestion_cursor: string | null;
  total_ingested: number;
  total_verified: number;
  created_at: string;
  updated_at: string;
}

export interface OpportunityRow {
  id: string;
  source_id: string | null;
  platform: string;
  opportunity_type: OpportunityType;
  title: string;
  description: string | null;
  category: string;
  country_eligibility: string;
  skills: string;
  payout_currency: string;
  payout_method: string | null;
  payout_min_cents: number | null;
  payout_max_cents: number | null;
  payout_frequency: string | null;
  fees: string | null;
  account_rules: string | null;
  api_available: number;
  automation_permission: AutomationPermission;
  tos_url: string | null;
  source_url: string;
  external_id: string | null;
  dedup_hash: string;
  status: OpportunityStatus;
  risk_level: RiskLevel;
  verification_notes: string | null;
  last_verified_at: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export function computeDedupHash(input: { platform: string; source_url: string; external_id?: string | null; opportunity_type: string }): string {
  const normalizedUrl = input.source_url.trim().toLowerCase();
  const platform = input.platform.trim().toLowerCase();
  const external = (input.external_id ?? '').trim().toLowerCase();
  const type = input.opportunity_type.trim().toLowerCase();
  return sha256(`${platform}|${normalizedUrl}|${external}|${type}`);
}

export function createOpportunitySource(input: {
  key: string;
  name: string;
  category: SourceCategory;
  description?: string | null;
  base_url: string;
  api_endpoint?: string | null;
  docs_url?: string | null;
  tos_url?: string | null;
  privacy_url?: string | null;
  requires_api_key?: boolean;
  api_key_env_var?: string | null;
  rate_limit_rpm?: number;
  rate_limit_daily?: number;
  automation_allowed?: number;
  automation_notes?: string | null;
  country_eligibility?: string[];
  payout_currencies?: string[];
  payout_methods?: string[];
  fees_description?: string | null;
  account_rules?: string | null;
  api_available?: boolean;
  status?: string;
}): OpportunitySourceRow {
  const id = missionId('opsrc');
  const now = nowIso();
  const key = input.key.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 80);
  missionDb.run(
    `INSERT INTO mission_opportunity_sources
      (id, key, name, category, description, base_url, api_endpoint, docs_url, tos_url, privacy_url,
       requires_api_key, api_key_env_var, rate_limit_rpm, rate_limit_daily, automation_allowed, automation_notes,
       country_eligibility, payout_currencies, payout_methods, fees_description, account_rules, api_available, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      key,
      input.name.slice(0, 200),
      input.category,
      input.description?.slice(0, 1000) ?? null,
      input.base_url,
      input.api_endpoint ?? null,
      input.docs_url ?? null,
      input.tos_url ?? null,
      input.privacy_url ?? null,
      input.requires_api_key ? 1 : 0,
      input.api_key_env_var ?? null,
      Math.max(1, Math.min(1000, input.rate_limit_rpm ?? 10)),
      Math.max(1, Math.min(100000, input.rate_limit_daily ?? 1000)),
      input.automation_allowed ?? 0,
      input.automation_notes?.slice(0, 1000) ?? null,
      JSON.stringify(input.country_eligibility ?? ['global']),
      JSON.stringify(input.payout_currencies ?? ['USD']),
      JSON.stringify(input.payout_methods ?? []),
      input.fees_description?.slice(0, 1000) ?? null,
      input.account_rules?.slice(0, 2000) ?? null,
      input.api_available ? 1 : 0,
      input.status ?? 'active',
      now,
      now,
    ],
  );
  // init stats row
  missionDb.run(`INSERT OR IGNORE INTO mission_opportunity_source_stats (source_id, total, verified, pending_review, rejected, expired, last_updated) VALUES (?, 0,0,0,0,0, ?)`, [id, now]);
  return missionDb.get<OpportunitySourceRow>('SELECT * FROM mission_opportunity_sources WHERE id = ?', [id])!;
}

export function getOpportunitySourceByKey(key: string): OpportunitySourceRow | undefined {
  return missionDb.get<OpportunitySourceRow>('SELECT * FROM mission_opportunity_sources WHERE key = ?', [key.toLowerCase()]);
}

export function getOpportunitySourceById(id: string): OpportunitySourceRow | undefined {
  return missionDb.get<OpportunitySourceRow>('SELECT * FROM mission_opportunity_sources WHERE id = ?', [id]);
}

export function listOpportunitySources(filters?: { category?: string; status?: string; limit?: number; offset?: number }): { total: number; sources: OpportunitySourceRow[] } {
  const limit = Math.min(500, Math.max(1, filters?.limit ?? 100));
  const offset = Math.max(0, filters?.offset ?? 0);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters?.category) {
    where.push('category = ?');
    params.push(filters.category);
  }
  if (filters?.status) {
    where.push('status = ?');
    params.push(filters.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = missionDb.get<{ count: number }>(`SELECT COUNT(*) as count FROM mission_opportunity_sources ${whereSql}`, params as any);
  const rows = missionDb.all<OpportunitySourceRow>(`SELECT * FROM mission_opportunity_sources ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset] as any);
  return { total: Number(totalRow?.count ?? 0), sources: rows };
}

export function upsertOpportunitySource(input: {
  key: string;
  name: string;
  category: SourceCategory;
  description?: string | null;
  base_url: string;
  api_endpoint?: string | null;
  docs_url?: string | null;
  tos_url?: string | null;
  privacy_url?: string | null;
  requires_api_key?: boolean;
  api_key_env_var?: string | null;
  rate_limit_rpm?: number;
  rate_limit_daily?: number;
  automation_allowed?: number;
  automation_notes?: string | null;
  country_eligibility?: string[];
  payout_currencies?: string[];
  payout_methods?: string[];
  fees_description?: string | null;
  account_rules?: string | null;
  api_available?: boolean;
  status?: string;
}): OpportunitySourceRow {
  const existing = getOpportunitySourceByKey(input.key);
  if (existing) {
    const now = nowIso();
    missionDb.run(
      `UPDATE mission_opportunity_sources SET
        name = ?, category = ?, description = COALESCE(?, description), base_url = ?, api_endpoint = COALESCE(?, api_endpoint),
        docs_url = COALESCE(?, docs_url), tos_url = COALESCE(?, tos_url), privacy_url = COALESCE(?, privacy_url),
        requires_api_key = ?, api_key_env_var = COALESCE(?, api_key_env_var), rate_limit_rpm = ?, rate_limit_daily = ?,
        automation_allowed = ?, automation_notes = COALESCE(?, automation_notes),
        country_eligibility = ?, payout_currencies = ?, payout_methods = ?, fees_description = COALESCE(?, fees_description),
        account_rules = COALESCE(?, account_rules), api_available = ?, status = COALESCE(?, status), updated_at = ?
       WHERE id = ?`,
      [
        input.name.slice(0, 200),
        input.category,
        input.description?.slice(0, 1000) ?? null,
        input.base_url,
        input.api_endpoint ?? null,
        input.docs_url ?? null,
        input.tos_url ?? null,
        input.privacy_url ?? null,
        input.requires_api_key ? 1 : 0,
        input.api_key_env_var ?? null,
        Math.max(1, Math.min(1000, input.rate_limit_rpm ?? existing.rate_limit_rpm)),
        Math.max(1, Math.min(100000, input.rate_limit_daily ?? existing.rate_limit_daily)),
        input.automation_allowed ?? existing.automation_allowed,
        input.automation_notes?.slice(0, 1000) ?? null,
        JSON.stringify(input.country_eligibility ?? JSON.parse(existing.country_eligibility)),
        JSON.stringify(input.payout_currencies ?? JSON.parse(existing.payout_currencies)),
        JSON.stringify(input.payout_methods ?? JSON.parse(existing.payout_methods)),
        input.fees_description?.slice(0, 1000) ?? null,
        input.account_rules?.slice(0, 2000) ?? null,
        input.api_available ? 1 : existing.api_available,
        input.status ?? existing.status,
        now,
        existing.id,
      ],
    );
    return getOpportunitySourceById(existing.id)!;
  }
  return createOpportunitySource(input);
}

// ── Opportunities CRUD with deduplication ──

export function createOpportunity(input: {
  source_id?: string | null;
  platform: string;
  opportunity_type: OpportunityType;
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
  automation_permission?: AutomationPermission;
  tos_url?: string | null;
  source_url: string;
  external_id?: string | null;
  status?: OpportunityStatus;
  risk_level?: RiskLevel;
  verification_notes?: string | null;
}): { opportunity: OpportunityRow; isNew: boolean } {
  if (!input.platform.trim()) throw new Error('platform is required');
  if (!input.title.trim()) throw new Error('title is required');
  if (!input.source_url.trim()) throw new Error('source_url is required');
  try {
    new URL(input.source_url);
  } catch {
    throw new Error('source_url must be a valid URL');
  }

  const dedup_hash = computeDedupHash({
    platform: input.platform,
    source_url: input.source_url,
    external_id: input.external_id ?? null,
    opportunity_type: input.opportunity_type,
  });

  const existing = missionDb.get<OpportunityRow>('SELECT * FROM mission_opportunities WHERE dedup_hash = ?', [dedup_hash]);
  if (existing) {
    // update last_seen_at, optionally update fields if newer
    const now = nowIso();
    missionDb.run(`UPDATE mission_opportunities SET last_seen_at = ?, updated_at = ? WHERE id = ?`, [now, now, existing.id]);
    return { opportunity: missionDb.get<OpportunityRow>('SELECT * FROM mission_opportunities WHERE id = ?', [existing.id])!, isNew: false };
  }

  const id = missionId('opp');
  const now = nowIso();
  const countries = input.country_eligibility ?? ['global'];
  const skills = input.skills ?? [];

  missionDb.transaction(() => {
    missionDb.run(
      `INSERT INTO mission_opportunities
        (id, source_id, platform, opportunity_type, title, description, category, country_eligibility, skills,
         payout_currency, payout_method, payout_min_cents, payout_max_cents, payout_frequency, fees, account_rules,
         api_available, automation_permission, tos_url, source_url, external_id, dedup_hash, status, risk_level,
         verification_notes, last_verified_at, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.source_id ?? null,
        input.platform.slice(0, 200),
        input.opportunity_type,
        input.title.slice(0, 500),
        input.description?.slice(0, 5000) ?? null,
        input.category.slice(0, 100),
        JSON.stringify(countries),
        JSON.stringify(skills),
        (input.payout_currency ?? 'USD').slice(0, 10),
        input.payout_method?.slice(0, 50) ?? null,
        input.payout_min_cents ?? null,
        input.payout_max_cents ?? null,
        input.payout_frequency?.slice(0, 50) ?? null,
        input.fees?.slice(0, 1000) ?? null,
        input.account_rules?.slice(0, 2000) ?? null,
        input.api_available ? 1 : 0,
        input.automation_permission ?? 'conditional',
        input.tos_url ?? null,
        input.source_url,
        input.external_id?.slice(0, 300) ?? null,
        dedup_hash,
        input.status ?? 'pending_review',
        input.risk_level ?? 'medium',
        input.verification_notes?.slice(0, 2000) ?? null,
        null,
        now,
        now,
        now,
      ],
    );

    // insert country mappings
    for (const code of countries.slice(0, 20)) {
      const normalized = code.trim().toUpperCase().slice(0, 10);
      if (!normalized) continue;
      missionDb.run(`INSERT OR IGNORE INTO mission_opportunity_countries (opportunity_id, country_code) VALUES (?, ?)`, [id, normalized]);
    }
    // insert skills mappings
    for (const s of skills.slice(0, 30)) {
      const normalized = s.trim().toLowerCase().slice(0, 100);
      if (!normalized) continue;
      missionDb.run(`INSERT OR IGNORE INTO mission_opportunity_skills (opportunity_id, skill) VALUES (?, ?)`, [id, normalized]);
    }

    // update source stats
    if (input.source_id) {
      missionDb.run(`UPDATE mission_opportunity_sources SET total_ingested = total_ingested + 1, updated_at = ? WHERE id = ?`, [now, input.source_id]);
      missionDb.run(
        `INSERT INTO mission_opportunity_source_stats (source_id, total, verified, pending_review, rejected, expired, last_updated)
         VALUES (?, 1, 0, 1, 0, 0, ?)
         ON CONFLICT(source_id) DO UPDATE SET total = total + 1, pending_review = pending_review + 1, last_updated = excluded.last_updated`,
        [input.source_id, now],
      );
    }
  });

  return { opportunity: missionDb.get<OpportunityRow>('SELECT * FROM mission_opportunities WHERE id = ?', [id])!, isNew: true };
}

export interface OpportunityListFilters {
  source_id?: string;
  platform?: string;
  opportunity_type?: string;
  category?: string;
  status?: OpportunityStatus;
  risk_level?: RiskLevel;
  country?: string; // ISO code
  skill?: string;
  search?: string; // title/description like
  limit?: number;
  offset?: number;
  cursor?: string; // id for cursor pagination
  orderBy?: 'created_at' | 'last_verified_at' | 'last_seen_at';
  orderDir?: 'ASC' | 'DESC';
}

export function listOpportunities(filters: OpportunityListFilters = {}): { total: number; opportunities: OpportunityRow[]; nextCursor: string | null } {
  const limit = Math.min(500, Math.max(1, filters.limit ?? 50));
  const offset = Math.max(0, filters.offset ?? 0);
  const orderBy = ['created_at', 'last_verified_at', 'last_seen_at'].includes(filters.orderBy ?? '') ? filters.orderBy! : 'created_at';
  const orderDir = filters.orderDir === 'ASC' ? 'ASC' : 'DESC';

  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.source_id) {
    where.push('o.source_id = ?');
    params.push(filters.source_id);
  }
  if (filters.platform) {
    where.push('o.platform = ?');
    params.push(filters.platform);
  }
  if (filters.opportunity_type) {
    where.push('o.opportunity_type = ?');
    params.push(filters.opportunity_type);
  }
  if (filters.category) {
    where.push('o.category = ?');
    params.push(filters.category);
  }
  if (filters.status) {
    where.push('o.status = ?');
    params.push(filters.status);
  }
  if (filters.risk_level) {
    where.push('o.risk_level = ?');
    params.push(filters.risk_level);
  }
  if (filters.search) {
    where.push('(o.title LIKE ? OR o.description LIKE ?)');
    const like = `%${filters.search.slice(0, 100)}%`;
    params.push(like, like);
  }

  // For country and skill filters, we need joins but keep pagination efficient
  let joinSql = '';
  if (filters.country) {
    joinSql += ' JOIN mission_opportunity_countries oc ON oc.opportunity_id = o.id';
    where.push('oc.country_code = ?');
    params.push(filters.country.toUpperCase());
  }
  if (filters.skill) {
    joinSql += ' JOIN mission_opportunity_skills os ON os.opportunity_id = o.id';
    where.push('os.skill = ?');
    params.push(filters.skill.toLowerCase());
  }

  // Cursor pagination: if cursor provided, filter by created_at < cursor's created_at
  if (filters.cursor) {
    const cursorRow = missionDb.get<Row>('SELECT created_at, id FROM mission_opportunities WHERE id = ?', [filters.cursor]);
    if (cursorRow) {
      if (orderDir === 'DESC') {
        where.push('(o.created_at < ? OR (o.created_at = ? AND o.id < ?))');
        params.push(cursorRow.created_at, cursorRow.created_at, filters.cursor);
      } else {
        where.push('(o.created_at > ? OR (o.created_at = ? AND o.id > ?))');
        params.push(cursorRow.created_at, cursorRow.created_at, filters.cursor);
      }
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Total count — for large tables this can be expensive, so we use approximate if offset large? For now exact count with limit.
  // For 100M+ we should avoid COUNT(*) on filtered without index, but indexes cover most filters.
  const totalRow = missionDb.get<{ count: number }>(
    `SELECT COUNT(DISTINCT o.id) as count FROM mission_opportunities o ${joinSql} ${whereSql}`,
    params as any,
  );
  const total = Number(totalRow?.count ?? 0);

  // Fetch page — never load all into memory
  const rows = missionDb.all<OpportunityRow>(
    `SELECT o.* FROM mission_opportunities o ${joinSql} ${whereSql} ORDER BY o.${orderBy} ${orderDir}, o.id ${orderDir} LIMIT ? OFFSET ?`,
    [...params, limit, offset] as any,
  );

  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

  return { total, opportunities: rows, nextCursor };
}

export function getOpportunityById(id: string): OpportunityRow | undefined {
  return missionDb.get<OpportunityRow>('SELECT * FROM mission_opportunities WHERE id = ?', [id]);
}

export function updateOpportunityStatus(input: {
  id: string;
  status: OpportunityStatus;
  risk_level?: RiskLevel;
  verification_notes?: string | null;
  verifier_type: string;
  verifier_id?: string | null;
}): OpportunityRow {
  const existing = getOpportunityById(input.id);
  if (!existing) throw new Error('opportunity not found');
  const now = nowIso();
  const previous = existing.status;

  missionDb.transaction(() => {
    missionDb.run(
      `UPDATE mission_opportunities SET status = ?, risk_level = COALESCE(?, risk_level), verification_notes = COALESCE(?, verification_notes),
        last_verified_at = ?, updated_at = ? WHERE id = ?`,
      [input.status, input.risk_level ?? null, input.verification_notes?.slice(0, 2000) ?? null, now, now, input.id],
    );

    missionDb.run(
      `INSERT INTO mission_opportunity_verifications
        (id, opportunity_id, verifier_type, verifier_id, previous_status, new_status, risk_level, notes, source_url_checked, tos_checked, verified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        missionId('ver'),
        input.id,
        input.verifier_type,
        input.verifier_id ?? null,
        previous,
        input.status,
        input.risk_level ?? existing.risk_level,
        input.verification_notes?.slice(0, 2000) ?? null,
        existing.source_url,
        existing.tos_url ? 1 : 0,
        now,
        now,
      ],
    );

    // update source stats
    if (existing.source_id) {
      const stats = missionDb.get<Row>('SELECT * FROM mission_opportunity_source_stats WHERE source_id = ?', [existing.source_id]);
      if (stats) {
        // decrement old status, increment new
        const colMap: Record<string, string> = {
          pending_review: 'pending_review',
          verified: 'verified',
          rejected: 'rejected',
          expired: 'expired',
        };
        const oldCol = colMap[previous];
        const newCol = colMap[input.status];
        if (oldCol && newCol && oldCol !== newCol) {
          missionDb.run(
            `UPDATE mission_opportunity_source_stats SET ${oldCol} = MAX(0, ${oldCol} - 1), ${newCol} = ${newCol} + 1, last_updated = ? WHERE source_id = ?`,
            [now, existing.source_id],
          );
        } else if (newCol && !oldCol) {
          missionDb.run(`UPDATE mission_opportunity_source_stats SET ${newCol} = ${newCol} + 1, last_updated = ? WHERE source_id = ?`, [now, existing.source_id]);
        }
      }
      if (input.status === 'verified') {
        missionDb.run(`UPDATE mission_opportunity_sources SET total_verified = total_verified + 1, last_verified_at = ?, updated_at = ? WHERE id = ?`, [now, now, existing.source_id]);
      }
    }
  });

  return getOpportunityById(input.id)!;
}

export interface CatalogStats {
  total: number;
  verified: number;
  pending_review: number;
  rejected: number;
  expired: number;
  archived: number;
  byCategory: Array<{ category: string; count: number }>;
  byPlatform: Array<{ platform: string; count: number }>;
  byType: Array<{ opportunity_type: string; count: number }>;
  byRisk: Array<{ risk_level: string; count: number }>;
  bySource: Array<{ source_id: string; source_key: string; source_name: string; total: number; verified: number }>;
  sourcesTotal: number;
  sourcesActive: number;
  ingestionQueue: { pending: number; processing: number; failed: number; completed: number };
}

export function getCatalogStats(): CatalogStats {
  const totalRow = missionDb.get<{ count: number }>('SELECT COUNT(*) as count FROM mission_opportunities');
  const verifiedRow = missionDb.get<{ count: number }>("SELECT COUNT(*) as count FROM mission_opportunities WHERE status = 'verified'");
  const pendingRow = missionDb.get<{ count: number }>("SELECT COUNT(*) as count FROM mission_opportunities WHERE status = 'pending_review'");
  const rejectedRow = missionDb.get<{ count: number }>("SELECT COUNT(*) as count FROM mission_opportunities WHERE status = 'rejected'");
  const expiredRow = missionDb.get<{ count: number }>("SELECT COUNT(*) as count FROM mission_opportunities WHERE status = 'expired'");
  const archivedRow = missionDb.get<{ count: number }>("SELECT COUNT(*) as count FROM mission_opportunities WHERE status = 'archived'");

  const byCategory = missionDb.all<{ category: string; count: number }>('SELECT category, COUNT(*) as count FROM mission_opportunities GROUP BY category ORDER BY count DESC LIMIT 50');
  const byPlatform = missionDb.all<{ platform: string; count: number }>('SELECT platform, COUNT(*) as count FROM mission_opportunities GROUP BY platform ORDER BY count DESC LIMIT 50');
  const byType = missionDb.all<{ opportunity_type: string; count: number }>('SELECT opportunity_type, COUNT(*) as count FROM mission_opportunities GROUP BY opportunity_type ORDER BY count DESC LIMIT 50');
  const byRisk = missionDb.all<{ risk_level: string; count: number }>('SELECT risk_level, COUNT(*) as count FROM mission_opportunities GROUP BY risk_level');

  const bySource = missionDb.all<{ source_id: string; source_key: string; source_name: string; total: number; verified: number }>(
    `SELECT s.id as source_id, s.key as source_key, s.name as source_name,
            COALESCE(st.total,0) as total, COALESCE(st.verified,0) as verified
     FROM mission_opportunity_sources s
     LEFT JOIN mission_opportunity_source_stats st ON st.source_id = s.id
     ORDER BY total DESC LIMIT 100`,
  );

  const sourcesTotal = missionDb.get<{ count: number }>('SELECT COUNT(*) as count FROM mission_opportunity_sources')?.count ?? 0;
  const sourcesActive = missionDb.get<{ count: number }>("SELECT COUNT(*) as count FROM mission_opportunity_sources WHERE status = 'active'")?.count ?? 0;

  const queuePending = missionDb.get<{ count: number }>("SELECT COUNT(*) as count FROM mission_opportunity_ingestion_queue WHERE status = 'pending'")?.count ?? 0;
  const queueProcessing = missionDb.get<{ count: number }>("SELECT COUNT(*) as count FROM mission_opportunity_ingestion_queue WHERE status = 'processing'")?.count ?? 0;
  const queueFailed = missionDb.get<{ count: number }>("SELECT COUNT(*) as count FROM mission_opportunity_ingestion_queue WHERE status = 'failed'")?.count ?? 0;
  const queueCompleted = missionDb.get<{ count: number }>("SELECT COUNT(*) as count FROM mission_opportunity_ingestion_queue WHERE status = 'completed'")?.count ?? 0;

  return {
    total: Number(totalRow?.count ?? 0),
    verified: Number(verifiedRow?.count ?? 0),
    pending_review: Number(pendingRow?.count ?? 0),
    rejected: Number(rejectedRow?.count ?? 0),
    expired: Number(expiredRow?.count ?? 0),
    archived: Number(archivedRow?.count ?? 0),
    byCategory: byCategory.map((r) => ({ category: r.category, count: Number(r.count) })),
    byPlatform: byPlatform.map((r) => ({ platform: r.platform, count: Number(r.count) })),
    byType: byType.map((r) => ({ opportunity_type: r.opportunity_type, count: Number(r.count) })),
    byRisk: byRisk.map((r) => ({ risk_level: r.risk_level, count: Number(r.count) })),
    bySource,
    sourcesTotal: Number(sourcesTotal),
    sourcesActive: Number(sourcesActive),
    ingestionQueue: {
      pending: Number(queuePending),
      processing: Number(queueProcessing),
      failed: Number(queueFailed),
      completed: Number(queueCompleted),
    },
  };
}

// For dashboard country filters
export function listDistinctCountries(limit = 200): Array<{ country_code: string; count: number }> {
  return missionDb.all<{ country_code: string; count: number }>(
    `SELECT country_code, COUNT(*) as count FROM mission_opportunity_countries GROUP BY country_code ORDER BY count DESC LIMIT ?`,
    [limit],
  ).map((r) => ({ country_code: r.country_code, count: Number(r.count) }));
}

export function listDistinctSkills(limit = 200): Array<{ skill: string; count: number }> {
  return missionDb.all<{ skill: string; count: number }>(
    `SELECT skill, COUNT(*) as count FROM mission_opportunity_skills GROUP BY skill ORDER BY count DESC LIMIT ?`,
    [limit],
  ).map((r) => ({ skill: r.skill, count: Number(r.count) }));
}
