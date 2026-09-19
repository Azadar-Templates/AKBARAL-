import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db } from '../db/database';
import { getAgentBySlug } from '../agents/registry';
import { insertOpportunity, recordEconomyEvent } from '../db/economy-repositories';
import { findWorkforceCategory } from './categories';
import { getAgentOverlay } from './repositories';

/**
 * WORKFORCE PLATFORMS — the evidence-backed earning inventory, inside the DB.
 *
 * Every row is a REAL platform/program with documented payout evidence, fees,
 * KYC/account requirements, countries, risk, sources and verification date
 * (seeded from db/seeds/earning-platforms.json, itself built from fetched
 * official pages + directories — never invented).
 *
 * Status discipline:
 *   · 'verified'  — payout terms confirmed on the platform's official domain.
 *   · 'candidate' — terms from a reputable directory; needs official re-check.
 *   · 'rejected'  — gambling, scams, defunct, or no documented earning
 *     mechanism. REJECTED ROWS ARE NEVER SEEDED and can never be assigned.
 *
 * Assignment is a routing hint, not permission: publishing, bidding and
 * listing still require the platform account (owner-created, real identity)
 * plus owner approval on each category's requiresProvider path.
 */

export const PLATFORM_SEED_PATH = path.resolve(process.cwd(), 'db', 'seeds', 'earning-platforms.json');

export function platformKeyFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

/** Inventory mechanism → workforce earning categories (routing hints). */
export const MECHANISM_CATEGORY_MAP: Record<string, string[]> = {
  affiliate: ['affiliate'],
  affiliate_network: ['affiliate'],
  creator_ads: ['youtube', 'content_creation'],
  creator_rewards: ['tiktok', 'content_creation'],
  creator_monetization: ['content_creation'],
  creator_revenue_share: ['content_creation'],
  creator_memberships: ['content_creation', 'education'],
  creator_subscriptions: ['content_creation', 'education'],
  creator_tips: ['content_creation'],
  digital_products: ['digital_products', 'marketplaces'],
  marketplace_selling: ['marketplaces', 'ecommerce'],
  ecommerce_storefront: ['ecommerce'],
  freelance_services: ['freelance'],
};

export function categoriesForMechanism(mechanism: string): string[] {
  return MECHANISM_CATEGORY_MAP[mechanism] ?? ['research'];
}

export interface PlatformRow {
  platform_key: string;
  name: string;
  official_url: string;
  mechanism: string;
  workforce_categories_json: string;
  status: string;
  payout_evidence: string;
  fees: string;
  payout_method: string;
  minimum_payout: string;
  account_kyc: string;
  countries: string;
  risk_level: string;
  source_urls_json: string;
  verification_date: string;
  created_at: string;
}

interface SeedRow {
  name?: string;
  official_url?: string;
  url?: string;
  earning_mechanism?: string;
  mechanism?: string;
  status?: string;
  payout_evidence?: string;
  fees?: string;
  payout_method?: string;
  minimum_payout?: string;
  account_kyc?: string;
  countries?: string;
  risk_level?: string;
  risk?: string;
  source_urls?: string[];
  sources?: string[];
  verification_date?: string;
}

/**
 * Idempotent seed from the evidence inventory. Only verified/candidate rows
 * are stored; rejected rows (and rows without a name) are refused + counted.
 */
export function seedPlatforms(seedPath: string = PLATFORM_SEED_PATH): { seeded: number; skipped_rejected: number; total: number } {
  const raw = fs.readFileSync(seedPath, 'utf8');
  const rows = JSON.parse(raw) as SeedRow[];
  let seeded = 0;
  let skippedRejected = 0;
  for (const row of rows) {
    const name = (row.name ?? '').trim();
    if (!name || row.status === 'rejected') {
      skippedRejected += 1;
      continue;
    }
    const status = row.status === 'verified' ? 'verified' : 'candidate';
    const mechanism = (row.earning_mechanism || row.mechanism || '').trim();
    const sources = row.source_urls ?? row.sources ?? [];
    db.run(
      `INSERT OR IGNORE INTO economy_platforms
        (platform_key, name, official_url, mechanism, workforce_categories_json, status, payout_evidence, fees, payout_method, minimum_payout, account_kyc, countries, risk_level, source_urls_json, verification_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        platformKeyFor(name), name, (row.official_url || row.url || '').trim(), mechanism,
        JSON.stringify(categoriesForMechanism(mechanism)), status,
        (row.payout_evidence ?? '').slice(0, 4000), (row.fees ?? '').slice(0, 1000),
        (row.payout_method ?? '').slice(0, 500), (row.minimum_payout ?? '').slice(0, 200),
        (row.account_kyc ?? '').slice(0, 1000), (row.countries ?? '').slice(0, 1000),
        (row.risk_level || row.risk || 'unknown').slice(0, 20),
        JSON.stringify(sources.slice(0, 10)), (row.verification_date ?? '').slice(0, 20),
      ],
    );
    seeded += 1;
  }
  const total = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_platforms')?.n ?? 0;
  recordEconomyEvent({
    kind: 'platform',
    summary: `platform catalog seeded: ${seeded} importable rows, ${skippedRejected} rejected/skipped (catalog total ${total})`,
  });
  return { seeded, skipped_rejected: skippedRejected, total };
}

export function countPlatforms(): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_platforms')?.n ?? 0;
}

export function getPlatform(platformKey: string): PlatformRow | undefined {
  return db.get<PlatformRow>('SELECT * FROM economy_platforms WHERE platform_key = ?', [platformKey]);
}

export function listPlatforms(filter: { status?: 'verified' | 'candidate'; mechanism?: string; category?: string; limit?: number } = {}): PlatformRow[] {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filter.status) { where.push('status = ?'); params.push(filter.status); }
  if (filter.mechanism) { where.push('mechanism = ?'); params.push(filter.mechanism); }
  const rows = db.all<PlatformRow>(
    `SELECT * FROM economy_platforms ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY status ASC, name ASC LIMIT ?`,
    [...params, limit * 3],
  );
  // ORDER BY status ASC puts 'candidate' before 'verified' alphabetically —
  // re-sort so verified rows come first, then apply the category filter.
  rows.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'verified' ? -1 : 1));
  const byCategory = filter.category
    ? rows.filter((r) => {
        try {
          return (JSON.parse(r.workforce_categories_json) as string[]).includes(filter.category!);
        } catch { return false; }
      })
    : rows;
  return byCategory.slice(0, limit);
}

/**
 * Match catalog platforms to an agent's eligible categories (verified first).
 * Returns routing hints — capability + eligibility already enforced by the
 * caller paths (scheduler matching, assignment validation).
 */
export function matchPlatformsForAgent(agentSlug: string, limit = 10): PlatformRow[] {
  const overlay = getAgentOverlay(agentSlug);
  if (overlay.categories.length === 0) return [];
  const wanted = new Set(overlay.categories);
  const rows = db.all<PlatformRow>('SELECT * FROM economy_platforms ORDER BY name ASC LIMIT 1000');
  const matched = rows.filter((r) => {
    try {
      return (JSON.parse(r.workforce_categories_json) as string[]).some((c) => wanted.has(c));
    } catch { return false; }
  });
  matched.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'verified' ? -1 : 1));
  return matched.slice(0, Math.min(Math.max(limit, 1), 100));
}

export class PlatformError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = 'PlatformError';
  }
}

export function assignPlatform(agentSlug: string, platformKey: string, assignedBy: string): { assigned: boolean; duplicate: boolean } {
  const agent = getAgentBySlug(agentSlug);
  if (!agent) throw new PlatformError(404, 'agent_not_found', `agent "${agentSlug}" does not exist in the registry`);
  const platform = getPlatform(platformKey);
  if (!platform) throw new PlatformError(404, 'platform_not_found', `platform "${platformKey}" is not in the catalog`);
  if (platform.status !== 'verified' && platform.status !== 'candidate') {
    throw new PlatformError(400, 'platform_not_assignable', `platform "${platformKey}" has status '${platform.status}' — only verified/candidate rows are assignable`);
  }
  const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_platform_assignments WHERE agent_slug = ? AND platform_key = ?', [agentSlug, platformKey])?.n ?? 0;
  db.run('INSERT OR IGNORE INTO economy_platform_assignments (agent_slug, platform_key, assigned_by) VALUES (?, ?, ?)', [agentSlug, platformKey, assignedBy]);
  const duplicate = before > 0;
  if (!duplicate) {
    recordEconomyEvent({
      kind: 'platform', actor: assignedBy,
      summary: `platform assigned: ${agentSlug} → ${platform.name} [${platform.status}] (routing hint; accounts + approvals still required)`,
      details: { platformKey },
    });
  }
  return { assigned: true, duplicate };
}

export function listAgentPlatforms(agentSlug: string): PlatformRow[] {
  return db.all<PlatformRow>(
    `SELECT p.* FROM economy_platforms p
     JOIN economy_platform_assignments a ON a.platform_key = p.platform_key
     WHERE a.agent_slug = ? ORDER BY p.status ASC, p.name ASC`,
    [agentSlug],
  );
}

/**
 * Create opportunities straight from the catalog (verified first). Source URL
 * is the platform's official URL when captured, else the documenting
 * directory page, else a catalog pseudo-URL. Estimates use the mapped
 * workforce category defaults and are ALWAYS labelled with the catalog
 * status + verification date — never presented as measured revenue.
 */
export function discoverPlatformOpportunities(input: { limit?: number; verifiedOnly?: boolean } = {}): { created: number; duplicates: number; searched: number } {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const where = input.verifiedOnly ? 'WHERE status = ?' : 'WHERE status IN (?, ?)';
  const params = input.verifiedOnly ? ['verified'] : ['verified', 'candidate'];
  const rows = db.all<PlatformRow>(`SELECT * FROM economy_platforms ${where} ORDER BY status ASC, name ASC LIMIT 500`, params);
  rows.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'verified' ? -1 : 1));
  let created = 0;
  let duplicates = 0;
  let searched = 0;
  for (const platform of rows.slice(0, limit)) {
    searched += 1;
    let sourceUrl = platform.official_url;
    if (!sourceUrl) {
      try {
        const sources = JSON.parse(platform.source_urls_json) as string[];
        sourceUrl = sources[0] ?? '';
      } catch { sourceUrl = ''; }
    }
    if (!sourceUrl) sourceUrl = `platform-catalog://${platform.platform_key}`;
    let category = 'research';
    try {
      const cats = JSON.parse(platform.workforce_categories_json) as string[];
      if (cats[0]) category = cats[0];
    } catch { /* keep research fallback */ }
    const spec = findWorkforceCategory(category);
    const inserted = insertOpportunity({
      sourceUrlHash: createHash('sha256').update(`platform:${platform.platform_key}:${category}`).digest('hex'),
      sourceUrl,
      category,
      title: `Earn via ${platform.name} (${platform.mechanism || 'program'})`.slice(0, 300),
      summary: `${platform.payout_evidence} Fees: ${platform.fees || 'see terms'}. Account/KYC: ${platform.account_kyc || 'see terms'}.`.slice(0, 2000),
      expectedRevenueCents: spec?.defaultRevenueCents ?? 10_000,
      expectedCostCents: spec?.defaultCostCents ?? 100,
      timeHours: spec?.defaultTimeHours ?? 5,
      riskLevel: platform.risk_level === 'high' ? 'high' : platform.risk_level === 'low' ? 'low' : 'medium',
      probability: spec?.defaultProbability ?? 0.1,
      estimateBasis: `platform_catalog_${platform.status}_${platform.verification_date || 'undated'}`,
    });
    if (inserted.duplicate) duplicates += 1;
    else {
      created += 1;
      recordEconomyEvent({
        kind: 'discovery',
        summary: `platform opportunity [${category}]: ${platform.name} (${platform.status})`,
        details: { platformKey: platform.platform_key, estimateBasis: `platform_catalog_${platform.status}` },
      });
    }
  }
  return { created, duplicates, searched };
}
