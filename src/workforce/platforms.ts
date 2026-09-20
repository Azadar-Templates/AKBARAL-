import { financialTransaction } from '../db/financial-transaction';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { db } from '../db/database';
import { createId } from '../db/id';
import { generateAgentDefinitions } from '../agents/catalog';
import { getAgentBySlug } from '../agents/registry';
import { insertOpportunity, recordEconomyEvent } from '../db/economy-repositories';
import { findWorkforceCategory } from './categories';
import { deriveEligibility } from './wallets';
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
  if (!Array.isArray(rows)) throw new Error('platform catalog must be an array of reviewed rows');
  let seeded = 0;
  let skippedRejected = 0;
  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    if (!name || !['verified', 'candidate'].includes(row.status ?? '')) {
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
      platformKey: platform.platform_key,
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

// ── Exclusive 1:1 primary assignments ──────────────────────────────────────
// Rule: one primary agent per opportunity, one primary opportunity per agent,
// one external account/property per assignment. The database enforces all
// three with UNIQUE constraints; the functions below validate first so every
// refusal states exactly which side is already taken.

export interface PrimaryAssignmentRow {
  id: string;
  agent_slug: string;
  platform_key: string;
  dedicated_account_property_id: string | null;
  status: string;
  required_credentials_json: string;
  earning_workflow_key: string;
  assigned_by: string;
  assigned_at: string;
}

/**
 * Executable workflow descriptor for a platform: a stable workflow key for
 * the platform's mechanism + category, and the credential/account scopes the
 * work requires (names only — never secret values).
 */
export function earningWorkflowFor(platform: PlatformRow): { workflowKey: string; credentials: string[] } {
  let category = 'research';
  try {
    const cats = JSON.parse(platform.workforce_categories_json) as string[];
    if (cats[0]) category = cats[0];
  } catch { /* research fallback */ }
  const spec = findWorkforceCategory(category);
  return {
    workflowKey: `${platform.mechanism || 'program'}:${category}:v1`,
    credentials: [
      ...(platform.account_kyc ? [`platform_account: ${platform.account_kyc.slice(0, 200)}`] : ['platform_account: see platform terms']),
      ...(spec ? [`category_gate: ${spec.requiresProvider.slice(0, 200)}`] : []),
    ],
  };
}

export function primaryAssignmentForAgent(agentSlug: string): PrimaryAssignmentRow | undefined {
  return db.get<PrimaryAssignmentRow>('SELECT * FROM economy_opportunity_assignments WHERE agent_slug = ?', [agentSlug]);
}

export function primaryAssignmentForPlatform(platformKey: string): PrimaryAssignmentRow | undefined {
  return db.get<PrimaryAssignmentRow>('SELECT * FROM economy_opportunity_assignments WHERE platform_key = ?', [platformKey]);
}

export function primaryAgentForPlatform(platformKey: string): string | undefined {
  return primaryAssignmentForPlatform(platformKey)?.agent_slug;
}

export function countPrimaryAssignments(): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_opportunity_assignments')?.n ?? 0;
}

export function assignPrimaryOpportunity(input: {
  agentSlug: string; platformKey: string; assignedBy: string; dedicatedAccountPropertyId?: string | null;
}): PrimaryAssignmentRow {
  return financialTransaction(db, 'economy', () => {
  const agent = getAgentBySlug(input.agentSlug);
  if (!agent) throw new PlatformError(404, 'agent_not_found', `agent "${input.agentSlug}" does not exist in the registry`);
  const platform = getPlatform(input.platformKey);
  if (!platform) throw new PlatformError(404, 'platform_not_found', `platform "${input.platformKey}" is not in the catalog`);
  if (platform.status !== 'verified' && platform.status !== 'candidate') {
    throw new PlatformError(400, 'platform_not_assignable', `platform "${input.platformKey}" has status '${platform.status}' — only verified/candidate rows take a primary`);
  }
  const agentTaken = primaryAssignmentForAgent(input.agentSlug);
  if (agentTaken) {
    throw new PlatformError(409, 'agent_already_assigned', `agent "${input.agentSlug}" already holds primary "${agentTaken.platform_key}" — release it before assigning another`);
  }
  const platformTaken = primaryAssignmentForPlatform(input.platformKey);
  if (platformTaken) {
    throw new PlatformError(409, 'platform_already_assigned', `platform "${input.platformKey}" already answers to primary "${platformTaken.agent_slug}" — primaries are never shared`);
  }
  const propertyId = (input.dedicatedAccountPropertyId ?? '').trim() || null;
  if (propertyId) {
    const bound = db.get<PrimaryAssignmentRow>('SELECT * FROM economy_opportunity_assignments WHERE dedicated_account_property_id = ?', [propertyId]);
    if (bound) {
      throw new PlatformError(409, 'property_already_bound', `account/property "${propertyId}" is already bound to ${bound.agent_slug}/${bound.platform_key} — one property per assignment`);
    }
  }
  const workflow = earningWorkflowFor(platform);
  const id = createId('eco_pas');
  try {
    db.run(
      `INSERT INTO economy_opportunity_assignments
        (id, agent_slug, platform_key, dedicated_account_property_id, status, required_credentials_json, earning_workflow_key, assigned_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.agentSlug, input.platformKey, propertyId, propertyId ? 'active' : 'pending_account',
        JSON.stringify(workflow.credentials), workflow.workflowKey, input.assignedBy],
    );
  } catch (error) {
    // Defense in depth: the UNIQUE constraints refuse races the pre-checks
    // could not see. Map to the same explicit refusal shape.
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed: economy_opportunity_assignments\.agent_slug/.test(message)) {
      throw new PlatformError(409, 'agent_already_assigned', `agent "${input.agentSlug}" already holds a primary (raced)`);
    }
    if (/UNIQUE constraint failed: economy_opportunity_assignments\.platform_key/.test(message)) {
      throw new PlatformError(409, 'platform_already_assigned', `platform "${input.platformKey}" already has a primary (raced)`);
    }
    if (/UNIQUE constraint failed: economy_opportunity_assignments\.dedicated_account_property_id/.test(message)) {
      throw new PlatformError(409, 'property_already_bound', `account/property "${propertyId}" is already bound (raced)`);
    }
    throw error;
  }
  recordEconomyEvent({
    kind: 'platform', actor: input.assignedBy,
    summary: `PRIMARY assigned: ${input.agentSlug} ↔ ${platform.name} [${platform.status}] via ${workflow.workflowKey}${propertyId ? ` (property ${propertyId})` : ' (account pending — owner must create it)'}`,
    details: { assignmentId: id, platformKey: input.platformKey },
  });
  return db.get<PrimaryAssignmentRow>('SELECT * FROM economy_opportunity_assignments WHERE id = ?', [id])!;

  });
}

/**
 * Bind the owner-created external account/property to an assignment. Binding
 * moves pending_account → active (the account exists now; work still flows
 * through the normal authorization gates). The property id must be globally
 * unique — one property, one assignment.
 */
export function setAssignmentAccount(input: { agentSlug: string; dedicatedAccountPropertyId: string; actor: string }): PrimaryAssignmentRow {
  return financialTransaction(db, 'economy', () => {
  const row = primaryAssignmentForAgent(input.agentSlug);
  if (!row) throw new PlatformError(404, 'assignment_not_found', `agent "${input.agentSlug}" holds no primary assignment`);
  const propertyId = input.dedicatedAccountPropertyId.trim();
  if (!propertyId) throw new PlatformError(400, 'invalid_request', 'dedicated account/property id is required');
  const bound = db.get<PrimaryAssignmentRow>('SELECT * FROM economy_opportunity_assignments WHERE dedicated_account_property_id = ?', [propertyId]);
  if (bound && bound.id !== row.id) {
    throw new PlatformError(409, 'property_already_bound', `account/property "${propertyId}" is already bound to ${bound.agent_slug}/${bound.platform_key}`);
  }
  const nextStatus = row.status === 'pending_account' ? 'active' : row.status;
  db.run('UPDATE economy_opportunity_assignments SET dedicated_account_property_id = ?, status = ? WHERE id = ?', [propertyId, nextStatus, row.id]);
  recordEconomyEvent({
    kind: 'platform', actor: input.actor,
    summary: `assignment account bound: ${input.agentSlug}/${row.platform_key} → property ${propertyId} (status ${nextStatus})`,
    details: { assignmentId: row.id },
  });
  return db.get<PrimaryAssignmentRow>('SELECT * FROM economy_opportunity_assignments WHERE id = ?', [row.id])!;

  });
}

const ASSIGNMENT_STATUSES = new Set(['pending_account', 'active', 'paused', 'revoked']);

export function setAssignmentStatus(agentSlug: string, status: string, actor: string): PrimaryAssignmentRow {
  return financialTransaction(db, 'economy', () => {
  const row = primaryAssignmentForAgent(agentSlug);
  if (!row) throw new PlatformError(404, 'assignment_not_found', `agent "${agentSlug}" holds no primary assignment`);
  if (!ASSIGNMENT_STATUSES.has(status)) {
    throw new PlatformError(400, 'invalid_request', `status must be one of ${[...ASSIGNMENT_STATUSES].join(', ')}`);
  }
  db.run('UPDATE economy_opportunity_assignments SET status = ? WHERE id = ?', [status, row.id]);
  recordEconomyEvent({
    kind: 'platform', actor,
    summary: `assignment status: ${row.agent_slug}/${row.platform_key} → ${status}`,
    details: { assignmentId: row.id },
  });
  return db.get<PrimaryAssignmentRow>('SELECT * FROM economy_opportunity_assignments WHERE id = ?', [row.id])!;

  });
}

/**
 * Release a primary assignment (owner action with a reason). Both sides are
 * freed for reassignment; the audit event preserves the full history.
 */
export function releasePrimaryAssignment(agentSlug: string, reason: string, actor: string): { released: boolean } {
  return financialTransaction(db, 'economy', () => {
  const row = primaryAssignmentForAgent(agentSlug);
  if (!row) throw new PlatformError(404, 'assignment_not_found', `agent "${agentSlug}" holds no primary assignment`);
  if (!reason || reason.trim().length < 4) throw new PlatformError(400, 'invalid_request', 'a release reason is required');
  db.run('DELETE FROM economy_opportunity_assignments WHERE id = ?', [row.id]);
  recordEconomyEvent({
    kind: 'platform', actor,
    summary: `PRIMARY released: ${agentSlug} ↔ ${row.platform_key} — ${reason.trim().slice(0, 200)}`,
    details: { assignmentId: row.id },
  });
  return { released: true };

  });
}

/**
 * Deterministic auto-match: every unassigned catalog platform (verified
 * first, then alphabetical) receives the first still-unassigned registry
 * agent whose derived eligibility covers one of the platform's categories.
 * Idempotent — a second run assigns nothing new. Agents and platforms that
 * cannot be matched are REPORTED, never force-fit.
 */
export function autoAssignPrimaries(limit = 5000): { assigned: number; skippedIneligible: number; platformsTotal: number; assignmentsTotal: number } {
  const platforms = db.all<PlatformRow>("SELECT * FROM economy_platforms WHERE status IN ('verified','candidate') ORDER BY name ASC LIMIT 10000");
  platforms.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'verified' ? -1 : 1));
  const takenAgents = new Set(
    db.all<{ agent_slug: string }>('SELECT agent_slug FROM economy_opportunity_assignments').map((r) => r.agent_slug),
  );
  const takenPlatforms = new Set(
    db.all<{ platform_key: string }>('SELECT platform_key FROM economy_opportunity_assignments').map((r) => r.platform_key),
  );
  const definitions = generateAgentDefinitions();
  const eligibility = new Map<string, string[]>();
  for (const def of definitions) {
    eligibility.set(def.slug, deriveEligibility({ slug: def.slug, capabilities: def.capabilities, toolPermissions: def.toolPermissions, categorySlug: def.categorySlug }));
  }
  let assigned = 0;
  let skippedIneligible = 0;
  for (const platform of platforms.slice(0, limit)) {
    if (takenPlatforms.has(platform.platform_key)) continue;
    let cats: string[] = [];
    try { cats = JSON.parse(platform.workforce_categories_json) as string[]; } catch { cats = []; }
    const wanted = new Set(cats);
    const match = definitions.find((def) => !takenAgents.has(def.slug) && (eligibility.get(def.slug) ?? []).some((c) => wanted.has(c)));
    if (!match) {
      skippedIneligible += 1;
      continue;
    }
    try {
      assignPrimaryOpportunity({ agentSlug: match.slug, platformKey: platform.platform_key, assignedBy: 'auto-match' });
      takenAgents.add(match.slug);
      takenPlatforms.add(platform.platform_key);
      assigned += 1;
    } catch {
      skippedIneligible += 1;
    }
  }
  return { assigned, skippedIneligible, platformsTotal: platforms.length, assignmentsTotal: countPrimaryAssignments() };
}
