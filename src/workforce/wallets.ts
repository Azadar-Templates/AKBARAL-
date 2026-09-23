import { db } from '../db/database';
import {
  countAgentProfiles, executedTransferTotalForAgent, ledgerAgentBreakdown, listAgentProfiles,
  listTransfers, recordEconomyEvent, upsertAgentProfile,
} from '../db/economy-repositories';
import { listLedger } from '../db/economy-repositories';
import { generateAgentDefinitions } from '../agents/catalog';
import { getAgentOverlay, setAgentOverlay } from './repositories';
import { WORKFORCE_CATEGORIES } from './categories';

/**
 * WORKFORCE WALLETS — every agent's internal ledger, identified by agent slug.
 *
 * Balances are DERIVED from the real economy ledger (credits − debits −
 * executed transfers). Nothing here can create money: the only writers are
 * the verified-revenue path (evidence required) and the idempotent cost
 * posters. This module assures coverage (every registry agent gets a profile
 * overlay + eligibility) and presents the unified per-agent view:
 * earnings / expenses / API costs / reinvestment / balance / transfers / history.
 */

export interface WorkforceAccount {
  agentSlug: string;
  status: string;
  budgetCents: number;
  spendCents: number;
  realizedRevenueCents: number;
  costCents: number;
  costByCategory: Record<string, number>;
  reinvestmentCents: number;
  transferredOutCents: number;
  availableCents: number;
  capabilities: string[];
  categories: string[];
}

function costBreakdown(agentSlug: string): { total: number; byCategory: Record<string, number>; reinvestment: number } {
  const rows = db.all<{ category: string; total: number }>(
    `SELECT category, SUM(amount_cents) AS total FROM economy_ledger
     WHERE agent_slug = ? AND direction = 'debit' GROUP BY category`,
    [agentSlug],
  );
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    byCategory[row.category] = Number(row.total);
    total += Number(row.total);
  }
  return { total, byCategory, reinvestment: byCategory['reinvestment'] ?? 0 };
}

export function workforceAccountFor(agentSlug: string): WorkforceAccount {
  const breakdown = ledgerAgentBreakdown().find((r) => r.agent_slug === agentSlug);
  const revenue = Number(breakdown?.revenue_cents ?? 0);
  const costs = costBreakdown(agentSlug);
  const transferred = executedTransferTotalForAgent(agentSlug);
  const profile = db.get<{ status: string; budget_cents: number; spend_cents: number }>(
    'SELECT status, budget_cents, spend_cents FROM economy_agent_profiles WHERE agent_slug = ?', [agentSlug],
  );
  const overlay = getAgentOverlay(agentSlug);
  return {
    agentSlug,
    status: profile?.status ?? 'unregistered',
    budgetCents: Number(profile?.budget_cents ?? 0),
    spendCents: Number(profile?.spend_cents ?? 0),
    realizedRevenueCents: revenue,
    costCents: costs.total,
    costByCategory: costs.byCategory,
    reinvestmentCents: costs.reinvestment,
    transferredOutCents: transferred,
    availableCents: revenue - costs.total - transferred,
    capabilities: overlay.capabilities,
    categories: overlay.categories,
  };
}

export function listWorkforceAccounts(input: { limit?: number; offset?: number; onlyWithActivity?: boolean } = {}): { accounts: WorkforceAccount[]; total: number } {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const profiles = listAgentProfiles();
  const breakdown = new Map(ledgerAgentBreakdown().map((r) => [r.agent_slug, r]));
  let slugs = profiles.map((p) => p.agent_slug);
  if (input.onlyWithActivity) {
    slugs = slugs.filter((slug) => {
      const row = breakdown.get(slug);
      return (Number(row?.revenue_cents ?? 0) > 0) || (Number(row?.cost_cents ?? 0) > 0) || executedTransferTotalForAgent(slug) > 0;
    });
  }
  const total = slugs.length;
  const page = slugs.slice(offset, offset + limit);
  return { accounts: page.map(workforceAccountFor), total };
}

export function workforceLedgerHistory(agentSlug: string, limit = 100): ReturnType<typeof listLedger> {
  return db.all(
    'SELECT * FROM economy_ledger WHERE agent_slug = ? ORDER BY ts DESC LIMIT ?',
    [agentSlug, Math.min(Math.max(limit, 1), 500)],
  ) as ReturnType<typeof listLedger>;
}

export function workforceTransfersFor(agentSlug: string): ReturnType<typeof listTransfers> {
  return listTransfers(500).filter((t) => t.source_agent_slug === agentSlug);
}

/**
 * Derive multi-category eligibility for a registry agent from its genuine
 * capabilities + tools: every agent whose domains/tools overlap a category
 * becomes eligible for it. The flagship research agent is eligible for all
 * research-shaped categories.
 */
export function deriveEligibility(input: { slug: string; capabilities: string[]; toolPermissions: string[]; categorySlug: string }): string[] {
  const caps = new Set(input.capabilities.map((c) => c.toLowerCase()));
  const tools = new Set(input.toolPermissions.map((t) => t.toLowerCase()));
  const out: string[] = [];
  for (const category of WORKFORCE_CATEGORIES) {
    let score = 0;
    if (category.registryDomains.includes(input.categorySlug)) score += 3;
    for (const tool of category.typicalTools) {
      if (tools.has(tool.toLowerCase())) score += 1;
    }
    // Capability overlap: writing/research/coding/vision map broadly.
    if (caps.has('writing') && ['content_creation', 'freelance', 'education', 'seo', 'b2b_services'].includes(category.key)) score += 1;
    if (caps.has('research') && ['research', 'lead_generation', 'seo', 'b2b_services', 'freelance'].includes(category.key)) score += 1;
    if (caps.has('coding') && ['software_services', 'saas', 'apps', 'automation', 'freelance'].includes(category.key)) score += 1;
    if ((caps.has('vision') || caps.has('image') || caps.has('design')) && ['design', 'licensing', 'ecommerce', 'content_creation'].includes(category.key)) score += 1;
    if (input.slug === 'web-research-001') score += 2;
    if (score >= 2) out.push(category.key);
  }
  // Every agent can always do research-shaped scoping work honestly.
  if (!out.includes('research')) out.push('research');
  return out;
}

/**
 * Assure workforce coverage: every registry agent gets an economy profile
 * overlay (if missing) with derived capabilities + multi-category eligibility.
 * Batched and idempotent — safe to run on every deploy and on demand.
 * Returns the number of profiles assured (total after the run).
 */
export function ensureWorkforceProfiles(batchLimit = 5000): { assured: number; total: number; created: number } {
  const definitions = generateAgentDefinitions();
  let created = 0;
  const before = countAgentProfiles();
  const existing = new Set(listAgentProfiles().map((p) => p.agent_slug));
  let assured = 0;
  for (const def of definitions.slice(0, batchLimit)) {
    if (!existing.has(def.slug)) {
      upsertAgentProfile({ agentSlug: def.slug, parentAgentSlug: null, objectives: `Workforce specialist: ${def.specialization}` });
      existing.add(def.slug);
      created += 1;
    }
    setAgentOverlay(def.slug, {
      capabilities: [...new Set([...def.capabilities, ...def.toolPermissions])],
      categories: deriveEligibility({ slug: def.slug, capabilities: def.capabilities, toolPermissions: def.toolPermissions, categorySlug: def.categorySlug }),
    });
    assured += 1;
  }
  const total = countAgentProfiles();
  if (created > 0) {
    recordEconomyEvent({ kind: 'system', summary: `workforce coverage assured: ${created} new profiles (total ${total} of ${definitions.length} registry agents)` });
  }
  void before;
  return { assured, total, created };
}
