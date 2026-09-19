import { db } from '../db/database';
import { countAgentProfiles, getEconomyPolicy, listAgentProfiles } from '../db/economy-repositories';
import { treasurySummary } from '../economy/treasury';
import { agentDefinitionCount } from '../agents/catalog';
import { WORKFORCE_CATEGORIES } from './categories';
import { listSourceHealth, listWorkflows } from './repositories';
import { workforceReadiness } from './integrations';

/**
 * WORKFORCE REPORT — owner-only, evidence-backed summary. Every number comes
 * from the database or the live environment; estimates are labelled as such
 * and realized revenue counts evidence-backed rows only.
 */
export interface WorkforceReport {
  generatedAt: string;
  registry: { definitions: number; profiles: number; active: number; paused: number };
  categories: Array<{ key: string; label: string; opportunities: number; executions: number; requiresProvider: string }>;
  treasury: ReturnType<typeof treasurySummary>;
  revenue: { realizedCents: number; note: string };
  sources: { total: number; blocked: number; blockedKeys: string[] };
  workflows: { total: number; failed: number; failedKeys: string[] };
  readiness: ReturnType<typeof workforceReadiness>;
  policy: { autonomousEnabled: boolean; killSwitch: boolean; discoveryEnabled: boolean };
  requiresOwnerAction: string[];
}

export function buildWorkforceReport(): WorkforceReport {
  const profiles = listAgentProfiles();
  const treasury = treasurySummary();
  const readiness = workforceReadiness();
  const policyRow = getEconomyPolicy();
  const categories = WORKFORCE_CATEGORIES.map((category) => {
    const opp = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_opportunities WHERE category = ?', [category.key]);
    const exe = db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM economy_executions e JOIN economy_opportunities o ON o.id = e.opportunity_id WHERE o.category = ?`,
      [category.key],
    );
    return {
      key: category.key,
      label: category.label,
      opportunities: Number(opp?.n ?? 0),
      executions: Number(exe?.n ?? 0),
      requiresProvider: category.requiresProvider,
    };
  });
  const sources = listSourceHealth(undefined, 1000);
  const blockedSources = sources.filter((s) => s.status !== 'active');
  const workflows = listWorkflows(undefined, 1000);
  const failedWorkflows = workflows.filter((w) => w.status === 'failed');
  const requiresOwnerAction: string[] = [];
  if (!readiness.model) requiresOwnerAction.push('Set GOOGLE_API_KEY — execution waits for the model.');
  if (!readiness.search) requiresOwnerAction.push('Set a search key (TAVILY/BRAVE/SERPER) or AKBARAL_SEARCH_ENDPOINT — discovery waits for search.');
  if (!readiness.payments) requiresOwnerAction.push('Connect Stripe (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET) — verified revenue ingestion is unavailable until then.');
  for (const item of readiness.needsAction) {
    if (['gemini', 'search_tavily', 'search_brave', 'search_serper', 'search_endpoint', 'stripe'].includes(item.key)) continue;
    requiresOwnerAction.push(`${item.label}: ${item.ownerAction}`);
  }
  if (blockedSources.length > 0) requiresOwnerAction.push(`${blockedSources.length} source(s) auto-blocked (risk protection) — review /workforce/sources and clear only after verifying the source.`);
  if (failedWorkflows.length > 0) requiresOwnerAction.push(`${failedWorkflows.length} workflow(s) marked failed — review /workforce/workflows and replace/retire them.`);
  return {
    generatedAt: new Date().toISOString(),
    registry: {
      definitions: agentDefinitionCount(),
      profiles: countAgentProfiles(),
      active: profiles.filter((p) => p.status === 'active').length,
      paused: profiles.filter((p) => p.status === 'paused').length,
    },
    categories,
    treasury,
    revenue: { realizedCents: treasury.realizedRevenueCents, note: 'Realized = evidence-backed RECEIVED/SETTLED rows only. Expected/pending are estimates, never income.' },
    sources: { total: sources.length, blocked: blockedSources.length, blockedKeys: blockedSources.map((s) => s.source_key).slice(0, 50) },
    workflows: { total: workflows.length, failed: failedWorkflows.length, failedKeys: failedWorkflows.map((w) => `${w.agent_slug}/${w.category}/${w.workflow_key}`).slice(0, 50) },
    readiness,
    policy: {
      autonomousEnabled: policyRow.autonomous_enabled === 1,
      killSwitch: policyRow.kill_switch === 1,
      discoveryEnabled: policyRow.discovery_enabled === 1,
    },
    requiresOwnerAction,
  };
}
