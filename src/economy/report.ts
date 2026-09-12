import { db } from '../db';
import {
  listAgentProfiles,
  listEconomyEvents,
  listImprovements,
  listLedger,
  listOpportunities,
  listResources,
  listSettlements,
  listUpgrades,
  revenueTotals,
  ledgerExpenseTotals,
  ledgerAgentBreakdown,
} from '../db/economy-repositories';
import { currentPolicy } from './policy';
import { treasurySummary } from './treasury';

/**
 * Owner dashboard (L) + the daily factual report. Everything is computed
 * from persisted state — nothing here can invent activity or revenue.
 */

export interface EconomyDashboard {
  treasury: ReturnType<typeof treasurySummary>;
  revenueStates: { realizedCents: number; pendingCents: number; expectedCents: number };
  agents: {
    economyAgentCount: number;
    activeAgents: number;
    newAgentsLast7Days: number;
    agentBreakdown: Array<{ agentSlug: string | null; revenueCents: number; costCents: number; roi: number | null }>;
  };
  opportunities: {
    current: number;
    completed: number;
    failed: number;
    blocked: number;
    recent: Array<{ id: string; title: string; category: string; status: string; expectedNetCents: number; roi: number | null }>;
  };
  improvements: number;
  upgrades: number;
  resources: number;
  settlements: ReturnType<typeof listSettlements>;
  securityEvents: Array<{ ts: string; summary: string }>;
  blockedOpportunities: Array<{ id: string; title: string; reason: string }>;
  policy: ReturnType<typeof currentPolicy>;
  honesty: {
    realizedRevenueOnly: true;
    estimatesLabelled: true;
    note: 'Only RECEIVED revenue counts. Expected values are labelled estimates. No revenue or activity is fabricated.';
  };
}

export function buildDashboard(): EconomyDashboard {
  const policy = currentPolicy();
  const summary = treasurySummary();
  const revenue = revenueTotals();
  const profiles = listAgentProfiles();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const breakdown = ledgerAgentBreakdown().map((row) => ({
    agentSlug: row.agent_slug,
    revenueCents: Number(row.revenue_cents),
    costCents: Number(row.cost_cents),
    roi: Number(row.cost_cents) > 0 ? (Number(row.revenue_cents) - Number(row.cost_cents)) / Number(row.cost_cents) : null,
  }));
  const opportunities = listOpportunities(undefined, 500);
  const statusCount = (status: string) => opportunities.filter((o) => o.status === status).length;
  const securityEvents = listEconomyEvents(500)
    .filter((event) => event.kind === 'security')
    .slice(0, 20)
    .map((event) => ({ ts: event.ts, summary: event.summary }));

  const blocked = db.all<{ id: string; title: string; policy_decision_json: string | null }>(
    "SELECT id, title, policy_decision_json FROM economy_opportunities WHERE status = 'blocked' ORDER BY updated_at DESC LIMIT 20",
  ).map((row) => {
    let reason = 'policy';
    try {
      const decision = row.policy_decision_json ? (JSON.parse(row.policy_decision_json) as { reasons?: string[] }) : null;
      if (decision?.reasons?.length) reason = decision.reasons.join('; ');
    } catch { reason = 'policy'; }
    return { id: row.id, title: row.title, reason };
  });

  return {
    treasury: summary,
    revenueStates: { realizedCents: revenue.realizedCents, pendingCents: revenue.pendingCents, expectedCents: revenue.expectedCents },
    agents: {
      economyAgentCount: profiles.length,
      activeAgents: profiles.filter((profile) => profile.status === 'active').length,
      newAgentsLast7Days: profiles.filter((profile) => profile.enabled_at >= sevenDaysAgo).length,
      agentBreakdown: breakdown,
    },
    opportunities: {
      current: statusCount('discovered') + statusCount('evaluated') + statusCount('authorized') + statusCount('executing'),
      completed: statusCount('completed'),
      failed: statusCount('failed'),
      blocked: statusCount('blocked'),
      recent: opportunities.slice(0, 15).map((o) => ({
        id: o.id, title: o.title, category: o.category, status: o.status,
        expectedNetCents: o.expected_net_cents, roi: o.roi,
      })),
    },
    improvements: listImprovements().length,
    upgrades: listUpgrades().length,
    resources: listResources().length,
    settlements: listSettlements().slice(0, 10),
    securityEvents,
    blockedOpportunities: blocked,
    policy,
    honesty: {
      realizedRevenueOnly: true,
      estimatesLabelled: true,
      note: 'Only RECEIVED revenue counts. Expected values are labelled estimates. No revenue or activity is fabricated.',
    },
  };
}

export interface DailyReport {
  title: 'WHAT DID ZA141251SA DO TODAY?';
  dateUtc: string;
  chronology: Array<{ ts: string; kind: string; actor: string; summary: string }>;
  totals: {
    revenueReceivedCents: number;
    expensesCents: number;
    opportunitiesDiscovered: number;
    opportunitiesCompleted: number;
    opportunitiesFailed: number;
    executionsRun: number;
    securityEvents: number;
  };
  generatedAt: string;
}

export function buildDailyReport(): DailyReport {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const events = listEconomyEvents(1000, since);
  const countKind = (kind: string) => events.filter((event) => event.kind === kind).length;

  const revenueToday = db.get<{ total: number }>(
    "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM economy_ledger WHERE direction = 'credit' AND ts >= ?",
    [since],
  );
  const expensesToday = db.get<{ total: number }>(
    "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM economy_ledger WHERE direction = 'debit' AND ts >= ?",
    [since],
  );

  return {
    title: 'WHAT DID ZA141251SA DO TODAY?',
    dateUtc: since.slice(0, 10),
    chronology: events
      .slice()
      .reverse() // chronological order
      .map((event) => ({ ts: event.ts, kind: event.kind, actor: event.actor, summary: event.summary })),
    totals: {
      revenueReceivedCents: revenueToday ? Number(revenueToday.total) : 0,
      expensesCents: expensesToday ? Number(expensesToday.total) : 0,
      opportunitiesDiscovered: countKind('discovery'),
      opportunitiesCompleted: events.filter((e) => e.kind === 'execution' && e.summary.includes('COMPLETED')).length,
      opportunitiesFailed: events.filter((e) => e.kind === 'execution' && e.summary.includes('FAILED')).length,
      executionsRun: countKind('execution'),
      securityEvents: countKind('security'),
    },
    generatedAt: new Date().toISOString(),
  };
}

export { listLedger, ledgerExpenseTotals };
