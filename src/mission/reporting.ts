import { missionDb, missionId, nowIso, sha256, appendMissionAudit, verifyMissionAudit, type Row } from './database';
import { currentPolicy, PROHIBITION_STATEMENTS, ALLOWED_ACTIVITY_KEYS } from './policy';
import { treasurySummary, verifyLedger, listPayoutSlots, listPayouts, listApprovals, listRevenue, listExpenses } from './treasury';
import { expiringCredentials, listTools, listServices, selfManagementSnapshot, listUpgrades } from './self-management';
import { identityLockStatus } from './identity-lock';

/**
 * MISSION REPORTING — every agent can account for its own operation, and the
 * dashboard can account for the whole mission.
 *
 * The single honesty rule this module enforces: REALIZED REVENUE IS MONEY THAT
 * ARRIVED AND WAS VERIFIED. Contracted and expected amounts are reported
 * separately, always labelled, and never added into realized totals. Targets
 * (including aggressive millions-per-day KPIs) are reported as TARGETS with a
 * progress figure — never as achievements.
 */

export interface AgentReport {
  agent: {
    id: string;
    slug: string;
    name: string;
    category: string | null;
    role: string;
    status: string;
    depth: number;
    parentSlug: string | null;
    childCount: number;
    children: Array<{ id: string; slug: string; name: string; role: string; status: string; depth: number }>;
  };
  wallet: {
    id: string;
    balanceCents: number;
    budgetCents: number;
    spentCents: number;
    currency: string;
    status: string;
  } | null;
  revenue: {
    realizedCents: number;
    contractedCents: number;
    expectedCents: number;
    bySource: Array<{ source: string; cents: number; count: number }>;
    entries: Array<Record<string, unknown>>;
  };
  work: Array<{
    id: string; title: string; category: string; status: string;
    revenueCents: number; costCents: number; clientRef: string | null; createdAt: string;
  }>;
  expenses: {
    paidCents: number;
    pendingCents: number;
    byCategory: Array<{ category: string; cents: number; count: number }>;
    entries: Array<Record<string, unknown>>;
  };
  upgrades: Array<{ id: string; capability: string; status: string; costCents: number; createdAt: string }>;
  resources: Array<{ id: string; kind: string; provider: string; status: string; monthlyCostCents: number; expiresAt: string | null }>;
  credentials: Array<{ id: string; provider: string; label: string; status: string; expiresAt: string | null; urgency: string }>;
  services: Array<{ id: string; name: string; kind: string; status: string; healthSource: string | null; lastCheckedAt: string | null }>;
  audit: { entries: number; lastAction: string | null; chainOk: boolean };
  selfManagement: ReturnType<typeof selfManagementSnapshot>;
  generatedAt: string;
  honesty: { note: string; realizedOnly: boolean };
}

export interface AgentRow extends Row {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  role_key: string | null;
  mission_role: string;
  status: string;
  depth: number;
  parent_id: string | null;
}

export function findAgentBySlug(slug: string): AgentRow | undefined {
  return missionDb.get<AgentRow>('SELECT * FROM mission_agents WHERE slug = ?', [slug]);
}

export function findAgentById(id: string): AgentRow | undefined {
  return missionDb.get<AgentRow>('SELECT * FROM mission_agents WHERE id = ?', [id]);
}

export function parentSlug(parentId: string | null): string | null {
  if (!parentId) return null;
  const row = missionDb.get<Row>('SELECT slug FROM mission_agents WHERE id = ?', [parentId]);
  return row ? String(row.slug) : null;
}

export function buildAgentReport(agent: AgentRow): AgentReport {
  const walletRow = missionDb.get<Row>(
    `SELECT * FROM mission_wallets WHERE agent_id = ? AND status != 'closed' ORDER BY created_at LIMIT 1`,
    [agent.id],
  );
  const revenueRows = missionDb.all<Row>('SELECT * FROM mission_revenue WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100', [agent.id]);
  const realized = revenueRows.filter((row) => String(row.status) === 'received').reduce((total, row) => total + Number(row.amount_cents), 0);
  const contracted = revenueRows.filter((row) => String(row.status) === 'contracted').reduce((total, row) => total + Number(row.amount_cents), 0);
  const expected = revenueRows.filter((row) => String(row.status) === 'expected').reduce((total, row) => total + Number(row.amount_cents), 0);
  const bySourceMap = new Map<string, { cents: number; count: number }>();
  for (const row of revenueRows) {
    if (String(row.status) !== 'received') continue;
    const key = String(row.source);
    const current = bySourceMap.get(key) ?? { cents: 0, count: 0 };
    bySourceMap.set(key, { cents: current.cents + Number(row.amount_cents), count: current.count + 1 });
  }
  const expenses = missionDb.all<Row>('SELECT * FROM mission_expenses WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100', [agent.id]);
  const paid = expenses.filter((row) => String(row.status) === 'paid').reduce((total, row) => total + Number(row.amount_cents), 0);
  const pending = expenses.filter((row) => ['requested', 'approved'].includes(String(row.status))).reduce((total, row) => total + Number(row.amount_cents), 0);
  const byCategoryMap = new Map<string, { cents: number; count: number }>();
  for (const row of expenses) {
    if (String(row.status) !== 'paid') continue;
    const key = String(row.category);
    const current = byCategoryMap.get(key) ?? { cents: 0, count: 0 };
    byCategoryMap.set(key, { cents: current.cents + Number(row.amount_cents), count: current.count + 1 });
  }
  const children = missionDb.get<Row>('SELECT COUNT(*) AS count FROM mission_agents WHERE parent_id = ?', [agent.id]);
  const childCount = Number(children?.count ?? 0);
  const childAgents = missionDb.all<Row>(
    'SELECT id, slug, name, role_key, status, depth FROM mission_agents WHERE parent_id = ? ORDER BY slug LIMIT 100',
    [agent.id],
  );
  const auditRow = missionDb.get<Row>('SELECT COUNT(*) AS count FROM mission_audit WHERE actor_id = ?', [agent.id]);
  const lastAudit = missionDb.get<Row>('SELECT action FROM mission_audit WHERE actor_id = ? ORDER BY seq DESC LIMIT 1', [agent.id]);

  return {
    agent: {
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      category: agent.category,
      role: agent.mission_role,
      status: agent.status,
      depth: Number(agent.depth),
      parentSlug: parentSlug(agent.parent_id),
      childCount,
      // The delegation chain is inspectable: an owner can see exactly which
      // agents a parent created, and in what state they are.
      children: childAgents.map((child) => ({
        id: String(child.id),
        slug: String(child.slug),
        name: String(child.name),
        role: String(child.role_key ?? 'sub-agent'),
        status: String(child.status),
        depth: Number(child.depth),
      })),
    },
    wallet: walletRow
      ? {
          id: String(walletRow.id),
          balanceCents: Number(walletRow.balance_cents),
          budgetCents: Number(walletRow.budget_cents),
          spentCents: Number(walletRow.spent_cents),
          currency: String(walletRow.currency),
          status: String(walletRow.status),
        }
      : null,
    revenue: {
      realizedCents: realized,
      contractedCents: contracted,
      expectedCents: expected,
      bySource: [...bySourceMap.entries()].map(([source, value]) => ({ source, cents: value.cents, count: value.count })),
      entries: revenueRows.map((row) => ({
        id: row.id,
        amountCents: Number(row.amount_cents),
        status: row.status,
        source: row.source,
        workId: row.work_id,
        verifier: row.verifier,
        receivedAt: row.received_at,
        externalRef: row.external_ref,
      })),
    },
    work: missionDb
      .all<Row>('SELECT * FROM mission_work WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100', [agent.id])
      .map((row) => ({
        id: String(row.id),
        title: String(row.title),
        category: String(row.category),
        status: String(row.status),
        revenueCents: Number(row.revenue_cents),
        costCents: Number(row.cost_cents),
        clientRef: row.client_ref ? String(row.client_ref) : null,
        createdAt: String(row.created_at),
      })),
    expenses: {
      paidCents: paid,
      pendingCents: pending,
      byCategory: [...byCategoryMap.entries()].map(([category, value]) => ({ category, cents: value.cents, count: value.count })),
      entries: expenses.map((row) => ({
        id: row.id,
        amountCents: Number(row.amount_cents),
        status: row.status,
        category: row.category,
        provider: row.provider,
        createdAt: row.created_at,
      })),
    },
    upgrades: listUpgrades(agent.id).map((row) => ({
      id: String(row.id),
      capability: String(row.capability),
      status: String(row.status),
      costCents: Number(row.requested_cost_cents),
      createdAt: String(row.created_at),
    })),
    resources: missionDb
      .all<Row>('SELECT * FROM mission_resources WHERE agent_id = ? ORDER BY created_at DESC', [agent.id])
      .map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        provider: String(row.provider),
        status: String(row.status),
        monthlyCostCents: Number(row.monthly_cost_cents),
        expiresAt: row.expires_at ? String(row.expires_at) : null,
      })),
    credentials: expiringCredentials(90)
      .filter((credential) => credential.status !== 'revoked')
      .map((credential) => ({
        id: credential.id,
        provider: credential.provider,
        label: credential.label,
        status: credential.status,
        expiresAt: credential.expiresAt,
        urgency: credential.urgency,
      })),
    services: listServices(agent.id).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      kind: String(row.kind),
      status: String(row.status),
      healthSource: row.health_source ? String(row.health_source) : null,
      lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
    })),
    audit: {
      entries: Number(auditRow?.count ?? 0),
      lastAction: lastAudit ? String(lastAudit.action) : null,
      chainOk: verifyMissionAudit().ok,
    },
    selfManagement: selfManagementSnapshot(agent.id),
    generatedAt: nowIso(),
    honesty: {
      note: 'Realized revenue is money RECEIVED and verified against a documentary reference. Contracted and expected amounts are labelled separately and are never counted as earned.',
      realizedOnly: true,
    },
  };
}

/** Persist a report snapshot (append-only, checksummed). */
export function snapshotAgentReport(slug: string, periodStart: string, periodEnd: string): { id: string; report: AgentReport } {
  const agent = findAgentBySlug(slug);
  if (!agent) throw new Error(`agent ${slug} not found`);
  const report = buildAgentReport(agent);
  const id = missionId('rpt');
  const payload = JSON.stringify(report);
  missionDb.run(
    `INSERT INTO mission_reports (id, agent_id, scope, period_start, period_end, payload, checksum) VALUES (?, ?, 'agent', ?, ?, ?, ?)`,
    [id, agent.id, periodStart, periodEnd, payload, sha256(payload)],
  );
  appendMissionAudit({ actorType: 'agent', actorId: agent.id, action: 'report.snapshot', subjectType: 'report', subjectId: id });
  return { id, report };
}

export function listReports(agentId?: string, limit = 50): Row[] {
  return agentId
    ? missionDb.all<Row>('SELECT id, agent_id, scope, period_start, period_end, checksum, created_at FROM mission_reports WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?', [agentId, limit])
    : missionDb.all<Row>('SELECT id, agent_id, scope, period_start, period_end, checksum, created_at FROM mission_reports ORDER BY created_at DESC LIMIT ?', [limit]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Targets (aggressive KPIs — labelled as TARGETS, never as results)
// ─────────────────────────────────────────────────────────────────────────────

export interface TargetView {
  id: string;
  label: string;
  period: string;
  metric: string;
  amountCents: number;
  currency: string;
  status: string;
  actualCents: number;
  progressPct: number;
  windowStart: string;
  windowEnd: string;
  label_kind: 'target';
  note: string;
}

function periodWindow(period: string): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  if (period === 'day') {
    start.setUTCHours(0, 0, 0, 0);
  } else if (period === 'week') {
    const day = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - day);
    start.setUTCHours(0, 0, 0, 0);
  } else if (period === 'month') {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
  } else {
    const quarterMonth = Math.floor(start.getUTCMonth() / 3) * 3;
    start.setUTCMonth(quarterMonth, 1);
    start.setUTCHours(0, 0, 0, 0);
  }
  return { start: start.toISOString(), end: now.toISOString() };
}

export function listTargets(): TargetView[] {
  const rows = missionDb.all<Row>('SELECT * FROM mission_targets ORDER BY period, amount_cents DESC');
  return rows.map((row) => {
    const period = String(row.period);
    const { start, end } = periodWindow(period);
    const actual = missionDb.get<Row>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM mission_revenue
       WHERE status = 'received' AND received_at >= ? AND received_at <= ?`,
      [start, end],
    );
    const actualCents = Number(actual?.cents ?? 0);
    const amountCents = Number(row.amount_cents);
    return {
      id: String(row.id),
      label: String(row.label),
      period,
      metric: String(row.metric),
      amountCents,
      currency: String(row.currency),
      status: String(row.status),
      actualCents,
      progressPct: amountCents > 0 ? Math.round((actualCents / amountCents) * 10000) / 100 : 0,
      windowStart: start,
      windowEnd: end,
      label_kind: 'target',
      note: 'A configured KPI target. Progress counts ONLY verified realized revenue — a target is never presented as an achieved result.',
    };
  });
}

export function createTarget(input: {
  label: string;
  period?: 'day' | 'week' | 'month' | 'quarter';
  amountCents: number;
  metric?: string;
  currency?: string;
  actorId: string;
}): TargetView {
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('target amount must be positive');
  const id = missionId('tgt');
  missionDb.run(
    `INSERT INTO mission_targets (id, label, period, amount_cents, currency, metric, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.label.slice(0, 160), input.period ?? 'day', amount, input.currency ?? currentPolicy().currency, input.metric ?? 'realized_revenue', input.actorId],
  );
  appendMissionAudit({
    actorType: 'owner', actorId: input.actorId, action: 'target.created', subjectType: 'target', subjectId: id,
    detail: { label: input.label, period: input.period ?? 'day', amountCents: amount, metric: input.metric ?? 'realized_revenue' },
  });
  return listTargets().find((target) => target.id === id)!;
}

export function updateTarget(input: { id: string; status?: 'active' | 'paused' | 'archived'; amountCents?: number; actorId: string }): TargetView {
  const row = missionDb.get<Row>('SELECT * FROM mission_targets WHERE id = ?', [input.id]);
  if (!row) throw new Error('target not found');
  const fields: string[] = [];
  const values: Array<string | number> = [];
  if (input.status) {
    fields.push('status = ?');
    values.push(input.status);
  }
  if (input.amountCents !== undefined) {
    fields.push('amount_cents = ?');
    values.push(Math.max(1, Math.round(input.amountCents)));
  }
  if (fields.length === 0) return listTargets().find((target) => target.id === input.id)!;
  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  values.push(input.id);
  missionDb.run(`UPDATE mission_targets SET ${fields.join(', ')} WHERE id = ?`, values);
  appendMissionAudit({ actorType: 'owner', actorId: input.actorId, action: 'target.updated', subjectType: 'target', subjectId: input.id, detail: { status: input.status ?? null, amountCents: input.amountCents ?? null } });
  return listTargets().find((target) => target.id === input.id)!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission-wide overview (the dashboard payload)
// ─────────────────────────────────────────────────────────────────────────────

export interface MissionOverview {
  generatedAt: string;
  isolation: {
    database: string;
    platformLedger: 'not read, not written — AKBARAL! customer revenue is a different database and treasury';
    ownerAuth: 'mission-local sessions only';
  };
  /** Single-identity lockdown state (observability; enforcement lives in auth). */
  identityLock: ReturnType<typeof identityLockStatus>;
  policy: ReturnType<typeof currentPolicy> & { prohibitions: Array<{ key: string; statement: string }> };
  agents: {
    total: number;
    registry: number;
    custom: number;
    active: number;
    paused: number;
    maxDepth: number;
    largestHierarchy: number;
    byCategory: Array<{ category: string; count: number }>;
    byDepth: Array<{ depth: number; count: number }>;
  };
  treasury: ReturnType<typeof treasurySummary>;
  revenue: {
    realizedCents: number;
    contractedCents: number;
    expectedCents: number;
    bySource: Array<{ source: string; cents: number; count: number }>;
    windows: { todayCents: number; last7DaysCents: number; last30DaysCents: number; lifetimeCents: number };
    recent: Array<Record<string, unknown>>;
  };
  expenses: {
    paidCents: number;
    pendingCents: number;
    byCategory: Array<{ category: string; cents: number; count: number }>;
    recent: Array<Record<string, unknown>>;
  };
  upgrades: { requested: number; approved: number; applied: number; rejected: number };
  payouts: {
    slots: Array<Record<string, unknown>>;
    pendingCents: number;
    settledCents: number;
    recent: Array<Record<string, unknown>>;
  };
  approvals: { pending: number; recent: Array<Record<string, unknown>> };
  costs: {
    monthlyCommittedCents: number;
    spendTodayCents: number;
    dailyCapCents: number;
    byCategory: Array<{ category: string; cents: number; count: number }>;
  };
  targets: TargetView[];
  selfManagement: ReturnType<typeof selfManagementSnapshot>;
  audit: ReturnType<typeof verifyMissionAudit>;
  integrity: { ledger: ReturnType<typeof verifyLedger> };
  honesty: {
    realizedRevenueOnly: true;
    noFabrication: string;
    externalActivationPending: Array<{ provider: string; action: string; why: string }>;
  };
}

export function buildMissionOverview(): MissionOverview {
  const policy = currentPolicy();
  const treasury = treasurySummary();

  const agentStats = missionDb.get<Row>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN generation = 'registry' THEN 1 ELSE 0 END) AS registry,
            SUM(CASE WHEN generation != 'registry' THEN 1 ELSE 0 END) AS custom,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused,
            MAX(depth) AS max_depth
     FROM mission_agents`,
  );
  const byCategory = missionDb
    .all<Row>(`SELECT COALESCE(category, 'uncategorised') AS category, COUNT(*) AS count FROM mission_agents GROUP BY category ORDER BY count DESC LIMIT 20`)
    .map((row) => ({ category: String(row.category), count: Number(row.count) }));
  const byDepth = missionDb
    .all<Row>('SELECT depth, COUNT(*) AS count FROM mission_agents GROUP BY depth ORDER BY depth')
    .map((row) => ({ depth: Number(row.depth), count: Number(row.count) }));
  const largest = missionDb.get<Row>(
    'SELECT COUNT(*) AS count FROM mission_agents WHERE parent_id = (SELECT parent_id FROM mission_agents WHERE parent_id IS NOT NULL GROUP BY parent_id ORDER BY COUNT(*) DESC LIMIT 1)',
  );

  const revenueTotalsRow = missionDb.get<Row>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'received' THEN amount_cents ELSE 0 END), 0) AS realized,
       COALESCE(SUM(CASE WHEN status = 'contracted' THEN amount_cents ELSE 0 END), 0) AS contracted,
       COALESCE(SUM(CASE WHEN status = 'expected' THEN amount_cents ELSE 0 END), 0) AS expected
     FROM mission_revenue`,
  );
  const bySource = missionDb
    .all<Row>(`SELECT source, COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS count FROM mission_revenue WHERE status = 'received' GROUP BY source ORDER BY cents DESC`)
    .map((row) => ({ source: String(row.source), cents: Number(row.cents), count: Number(row.count) }));
  const windowCents = (sinceIso: string | null) => {
    const row = sinceIso
      ? missionDb.get<Row>(`SELECT COALESCE(SUM(amount_cents),0) AS cents FROM mission_revenue WHERE status = 'received' AND received_at >= ?`, [sinceIso])
      : missionDb.get<Row>(`SELECT COALESCE(SUM(amount_cents),0) AS cents FROM mission_revenue WHERE status = 'received'`);
    return Number(row?.cents ?? 0);
  };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const expenseTotals = missionDb.get<Row>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END), 0) AS paid,
       COALESCE(SUM(CASE WHEN status IN ('requested','approved') THEN amount_cents ELSE 0 END), 0) AS pending
     FROM mission_expenses`,
  );
  const expensesByCategory = missionDb
    .all<Row>(`SELECT category, COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS count FROM mission_expenses WHERE status = 'paid' GROUP BY category ORDER BY cents DESC`)
    .map((row) => ({ category: String(row.category), cents: Number(row.cents), count: Number(row.count) }));
  const ledgerByCategory = missionDb
    .all<Row>(
      `SELECT category, COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS count
       FROM mission_ledger WHERE direction = 'debit' AND substr(created_at,1,10) >= ?
       GROUP BY category ORDER BY cents DESC`,
      [new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)],
    )
    .map((row) => ({ category: String(row.category), cents: Number(row.cents), count: Number(row.count) }));

  const upgradeCounts = missionDb.all<Row>('SELECT status, COUNT(*) AS count FROM mission_upgrades GROUP BY status');
  const upgradeCount = (status: string) => Number(upgradeCounts.find((row) => String(row.status) === status)?.count ?? 0);

  const payouts = listPayouts(20);
  const pendingApprovals = missionDb.get<Row>(`SELECT COUNT(*) AS count FROM mission_approvals WHERE status = 'pending'`);

  const monthlyCommitted = missionDb.get<Row>(
    `SELECT COALESCE(SUM(monthly_cost_cents), 0) AS cents FROM mission_resources WHERE status IN ('active','approved')`,
  );

  const snapshot = selfManagementSnapshot();

  return {
    generatedAt: nowIso(),
    isolation: {
      database: process.env.ZA141251SA_DATABASE_URL ?? 'file:./mission.db',
      platformLedger: 'not read, not written — AKBARAL! customer revenue is a different database and treasury',
      ownerAuth: 'mission-local sessions only',
    },
    identityLock: identityLockStatus(),
    policy: {
      ...policy,
      prohibitions: policy.prohibitedActivities.map((key) => ({ key, statement: PROHIBITION_STATEMENTS[key] ?? key })),
    },
    agents: {
      total: Number(agentStats?.total ?? 0),
      registry: Number(agentStats?.registry ?? 0),
      custom: Number(agentStats?.custom ?? 0),
      active: Number(agentStats?.active ?? 0),
      paused: Number(agentStats?.paused ?? 0),
      maxDepth: Number(agentStats?.max_depth ?? 0),
      largestHierarchy: Number(largest?.count ?? 0),
      byCategory,
      byDepth,
    },
    treasury,
    revenue: {
      realizedCents: Number(revenueTotalsRow?.realized ?? 0),
      contractedCents: Number(revenueTotalsRow?.contracted ?? 0),
      expectedCents: Number(revenueTotalsRow?.expected ?? 0),
      bySource,
      windows: {
        todayCents: windowCents(today.toISOString()),
        last7DaysCents: windowCents(new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
        last30DaysCents: windowCents(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()),
        lifetimeCents: windowCents(null),
      },
      recent: listRevenue(10),
    },
    expenses: {
      paidCents: Number(expenseTotals?.paid ?? 0),
      pendingCents: Number(expenseTotals?.pending ?? 0),
      byCategory: expensesByCategory,
      recent: listExpenses(10),
    },
    upgrades: {
      requested: upgradeCount('requested'),
      approved: upgradeCount('approved'),
      applied: upgradeCount('applied'),
      rejected: upgradeCount('rejected'),
    },
    payouts: {
      slots: listPayoutSlots(),
      pendingCents: payouts.filter((row) => String(row.status) === 'pending_approval').reduce((total, row) => total + Number(row.amount_cents), 0),
      settledCents: payouts.filter((row) => String(row.status) === 'settled').reduce((total, row) => total + Number(row.amount_cents), 0),
      recent: payouts,
    },
    approvals: { pending: Number(pendingApprovals?.count ?? 0), recent: listApprovals().slice(0, 20) },
    costs: {
      monthlyCommittedCents: Number(monthlyCommitted?.cents ?? 0),
      spendTodayCents: treasury.daily.spentTodayCents,
      dailyCapCents: policy.maxDailySpendCents,
      byCategory: ledgerByCategory,
    },
    targets: listTargets(),
    selfManagement: snapshot,
    audit: verifyMissionAudit(),
    integrity: { ledger: verifyLedger() },
    honesty: {
      realizedRevenueOnly: true,
      noFabrication:
        'Every figure comes from this mission database. Revenue is counted only when it was received and verified; targets are labelled as targets; engagement or revenue that has not happened is never displayed as if it had.',
      externalActivationPending: snapshot.requiresExternalActivation,
    },
  };
}

/** The full catalog of approved activity categories (for UI + policy edits). */
export function activityCatalog(): string[] {
  return [...ALLOWED_ACTIVITY_KEYS];
}

/** Read-only helper used by the dashboard's tools panel. */
export function missionTools(): Row[] {
  return listTools();
}
