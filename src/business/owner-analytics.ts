import { db } from '../db';
import { readinessPayload } from '../server/health';
import { billingService } from '../billing/service';

/**
 * AKBARAL! owner business analytics — the data behind the Owner Dashboard.
 *
 * Every value is computed from persisted platform state (users, subscriptions,
 * invoices, payments, credit_transactions, tasks, model_runs, files,
 * agent_executions, agents, execution_jobs). Nothing is estimated, sampled or
 * fabricated; where a number genuinely cannot be known from our own database
 * (e.g. a provider's monthly invoice total), the field reports
 * `requiresProviderBillingApi: true` instead of inventing a figure.
 *
 * SCOPE / LEDGER SEPARATION (hard requirement):
 *   This module reads ONLY AKBARAL! customer tables. The private ZA141251SA
 *   mission system keeps its own database, its own revenue ledger and its own
 *   payout destinations; mission revenue is deliberately absent here and the
 *   dashboard states that separation explicitly instead of merging totals.
 */

export interface OwnerDashboard {
  generatedAt: string;
  source: 'platform-database';
  ledgerSeparation: {
    platformRevenue: 'akbaral-customer-revenue';
    missionRevenue: 'excluded — separate private mission ledger and treasury';
  };
  users: {
    total: number;
    active: number;
    suspended: number;
    pending: number;
    verified: number;
    byRole: Array<{ role: string; count: number }>;
    signups: { today: number; last7Days: number; last30Days: number; byDay: Array<{ day: string; count: number }> };
    retention: { activeLast7Days: number; activeLast30Days: number; neverLoggedIn: number };
  };
  plans: {
    catalog: Array<{ key: string; name: string; priceCents: number; currency: string; interval: string; monthlyCredits: number }>;
    subscriptions: Array<{ planKey: string; planName: string; status: string; count: number; priceCents: number }>;
    activeSubscriptions: number;
    trialingSubscriptions: number;
    pastDueSubscriptions: number;
    paidSubscriptions: number;
    planMix: Array<{ planKey: string; planName: string; count: number; sharePct: number }>;
  };
  revenue: {
    paidCents: number;
    refundedCents: number;
    outstandingCents: number;
    currency: string;
    payingCustomers: number;
    arpuCents: number | null;
    mrrCents: number;
    mrrNote: string;
    byDay: Array<{ day: string; cents: number; count: number }>;
    byProvider: Array<{ provider: string; cents: number; count: number }>;
    recentInvoices: Array<{ id: string; number: string; status: string; totalCents: number; currency: string; provider: string; createdAt: string; paidAt: string | null }>;
    payments: { succeeded: number; failed: number; pending: number; refunded: number };
    billingOverview: Record<string, unknown>;
  };
  credits: {
    granted: number;
    consumed: number;
    refunded: number;
    outstanding: number;
    accounts: { total: number; exhausted: number; active: number };
    pools: { freeCredits: number; paidCredits: number; bonusCredits: number };
    byDay: Array<{ day: string; granted: number; consumed: number; refunded: number }>;
    refundPolicy: { refundedTransactions: number; refundedCredits: number; note: string };
  };
  tasks: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    byType: Array<{ type: string; count: number }>;
    completionRatePct: number | null;
    failureRatePct: number | null;
    avgDurationSeconds: number | null;
    last7Days: number;
    executions: number;
    verificationFailures: number;
  };
  agents: {
    registryTotal: number;
    registryActive: number;
    registryDisabled: number;
    customAgents: number;
    categories: number;
    factoryVersions: number;
    topDispatched: Array<{ agentSlug: string | null; executions: number }>;
  };
  costs: {
    api: { modelCostCents: number; runs: number; succeeded: number; failed: number; byModel: Array<{ modelKey: string; costCents: number; runs: number }>; byProvider: Array<{ provider: string; costCents: number; runs: number }> };
    storage: { files: number; bytes: number; mb: number; artifacts: number; uploadsDir: string };
    compute: { workflowJobs: number; agentJobs: number; queueByStatus: Array<{ status: string; count: number }>; completedJobs: number; failedJobs: number };
    tokens: { inputTokens: number; outputTokens: number; avgLatencyMs: number | null };
    externalProviderCosts: { known: false; requiresProviderBillingApi: true; note: string };
    grossMargin: { revenueCents: number; knownCostCents: number; grossMarginCents: number; grossMarginPct: number | null; note: string };
  };
  systemHealth: {
    status: string;
    uptimeSeconds: number;
    checks: Array<{ name: string; ok: boolean }>;
    registryIntegrity: { ok: boolean; detail: string } | null;
    nodeVersion: string;
    memoryMb: number;
    database: { engine: string; fileSizeBytes: number | null };
  };
  promotion: {
    contentAccounts: number;
    contentItems: number;
    publishJobs: number;
    publishedItems: number;
    engagementSnapshots: number;
    honesty: string;
  };
  owner: {
    unlimitedExecution: boolean;
    note: string;
  };
  honesty: {
    realDataOnly: true;
    noFabrication: string;
    excludedFromTotals: string[];
  };
}

const NOW = () => new Date().toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

function count(sql: string, params: unknown[] = []): number {
  return Number(db.get<{ value: number }>(sql, params as never[])?.value ?? 0);
}

function safeTable(name: string): boolean {
  try {
    return db.tableExists(name);
  } catch {
    return false;
  }
}

function grossMarginPct(margin: number, revenue: number): number | null {
  if (revenue <= 0) return null;
  return Math.round((margin / revenue) * 10000) / 100;
}

export function buildOwnerDashboard(): OwnerDashboard {
  // ── Users & growth ────────────────────────────────────────────────────────
  const userTotals = db.get<{ total: number; active: number; suspended: number; pending: number; verified: number; never_logged_in: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN email_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN last_login_at IS NULL THEN 1 ELSE 0 END) AS never_logged_in
     FROM users`,
  );
  const byRole = db.all<{ role: string; count: number }>(
    'SELECT role, COUNT(*) AS count FROM users GROUP BY role ORDER BY count DESC',
  );
  const signupsToday = count(`SELECT COUNT(*) AS value FROM users WHERE created_at >= ?`, [NOW().slice(0, 10)]);
  const signups7 = count(`SELECT COUNT(*) AS value FROM users WHERE created_at >= ?`, [daysAgo(7)]);
  const signups30 = count(`SELECT COUNT(*) AS value FROM users WHERE created_at >= ?`, [daysAgo(30)]);
  const signupsByDay = db.all<{ day: string; count: number }>(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
     FROM users WHERE created_at >= ? GROUP BY day ORDER BY day`,
    [daysAgo(30)],
  );
  const active7 = count(`SELECT COUNT(*) AS value FROM users WHERE last_login_at >= ?`, [daysAgo(7)]);
  const active30 = count(`SELECT COUNT(*) AS value FROM users WHERE last_login_at >= ?`, [daysAgo(30)]);

  // ── Plans & subscriptions ─────────────────────────────────────────────────
  const catalog = safeTable('plans')
    ? db.all<{ key: string; name: string; price_cents: number; currency: string; billing_interval: string; monthly_credits: number }>(
        `SELECT key, name, price_cents, currency, billing_interval, monthly_credits
         FROM plans WHERE status = 'active' ORDER BY sort_order, price_cents`,
      ).map((row) => ({
        key: row.key,
        name: row.name,
        priceCents: Number(row.price_cents),
        currency: row.currency,
        interval: row.billing_interval,
        monthlyCredits: Number(row.monthly_credits),
      }))
    : [];
  const subscriptionRows = safeTable('subscriptions')
    ? db.all<{ plan_key: string; plan_name: string; status: string; count: number; price_cents: number }>(
        `SELECT p.key AS plan_key, p.name AS plan_name, s.status, COUNT(*) AS count, p.price_cents AS price_cents
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
         WHERE s.status IN ('trialing', 'active', 'past_due')
         GROUP BY p.key, p.name, s.status, p.price_cents ORDER BY count DESC`,
      )
    : [];
  const subscriptions = subscriptionRows.map((row) => ({
    planKey: row.plan_key,
    planName: row.plan_name,
    status: row.status,
    count: Number(row.count),
    priceCents: Number(row.price_cents),
  }));
  const activeSubs = subscriptions.filter((row) => row.status === 'active');
  const payingCustomers = db.get<{ count: number }>(
    `SELECT COUNT(DISTINCT user_id) AS count FROM subscriptions WHERE status = 'active' AND plan_id IN (SELECT id FROM plans WHERE price_cents > 0)`,
  );
  const planMixTotal = subscriptions.reduce((sum, row) => sum + row.count, 0);
  const planMix = subscriptions.map((row) => ({
    planKey: row.planKey,
    planName: row.planName,
    count: row.count,
    sharePct: planMixTotal > 0 ? Math.round((row.count / planMixTotal) * 10000) / 100 : 0,
  }));
  // MRR = sum of REAL monthly prices of active subscriptions. Annual plans are
  // normalised to their monthly equivalent; nothing here is projected.
  const mrrCents = safeTable('subscriptions')
    ? Number(
        db.get<{ cents: number }>(
          `SELECT COALESCE(SUM(CASE WHEN p.billing_interval = 'year' THEN p.price_cents / 12 ELSE p.price_cents END), 0) AS cents
           FROM subscriptions s JOIN plans p ON p.id = s.plan_id
           WHERE s.status = 'active' AND p.price_cents > 0`,
        )?.cents ?? 0,
      )
    : 0;

  // ── Revenue (invoices + payments) ─────────────────────────────────────────
  const invoiceTotals = db.get<{ paid: number; refunded: number; outstanding: number; currency: string | null }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents ELSE 0 END), 0) AS paid,
       COALESCE(SUM(CASE WHEN status = 'refunded' THEN total_cents ELSE 0 END), 0) AS refunded,
       COALESCE(SUM(CASE WHEN status IN ('due', 'pending') THEN total_cents ELSE 0 END), 0) AS outstanding,
       MAX(currency) AS currency
     FROM invoices`,
  );
  const byDay = db.all<{ day: string; cents: number; count: number }>(
    `SELECT substr(COALESCE(paid_at, created_at), 1, 10) AS day, COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS count
     FROM invoices WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= ?
     GROUP BY day ORDER BY day`,
    [daysAgo(30)],
  );
  const byProvider = db.all<{ provider: string; cents: number; count: number }>(
    `SELECT provider, COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS count
     FROM invoices WHERE status = 'paid' GROUP BY provider ORDER BY cents DESC`,
  );
  const recentInvoices = db.all<{ id: string; number: string; status: string; total_cents: number; currency: string; provider: string; created_at: string; paid_at: string | null }>(
    `SELECT id, number, status, total_cents, currency, provider, created_at, paid_at
     FROM invoices ORDER BY created_at DESC LIMIT 10`,
  ).map((row) => ({
    id: row.id,
    number: row.number,
    status: row.status,
    totalCents: Number(row.total_cents),
    currency: row.currency,
    provider: row.provider,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  }));
  const paymentStatuses = db.all<{ status: string; count: number }>(
    'SELECT status, COUNT(*) AS count FROM payments GROUP BY status',
  );
  const paymentCount = (status: string) => Number(paymentStatuses.find((row) => row.status === status)?.count ?? 0);
  const paidCents = Number(invoiceTotals?.paid ?? 0);
  const arpuCents = (payingCustomers?.count ?? 0) > 0 ? Math.round(paidCents / Number(payingCustomers?.count)) : null;

  // ── Credits ───────────────────────────────────────────────────────────────
  const creditTotals = db.get<{ granted: number; consumed: number; refunded: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS granted,
       COALESCE(SUM(CASE WHEN amount < 0 AND type != 'reversal' THEN -amount ELSE 0 END), 0) AS consumed,
       COALESCE(SUM(CASE WHEN amount < 0 AND type = 'reversal' THEN -amount ELSE 0 END), 0) AS refunded
     FROM credit_transactions`,
  );
  const creditAccounts = db.get<{ total: number; exhausted: number; active: number; free: number; paid: number; bonus: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN (free_credits + paid_credits + bonus_credits) <= 0 THEN 1 ELSE 0 END) AS exhausted,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
            COALESCE(SUM(free_credits), 0) AS free,
            COALESCE(SUM(paid_credits), 0) AS paid,
            COALESCE(SUM(bonus_credits), 0) AS bonus
     FROM credit_accounts`,
  );
  const creditsByDay = db.all<{ day: string; granted: number; consumed: number; refunded: number }>(
    `SELECT substr(created_at, 1, 10) AS day,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS granted,
            COALESCE(SUM(CASE WHEN amount < 0 AND type != 'reversal' THEN -amount ELSE 0 END), 0) AS consumed,
            COALESCE(SUM(CASE WHEN amount < 0 AND type = 'reversal' THEN -amount ELSE 0 END), 0) AS refunded
     FROM credit_transactions WHERE created_at >= ? GROUP BY day ORDER BY day`,
    [daysAgo(30)],
  );
  const refundRows = db.get<{ transactions: number; credits: number }>(
    `SELECT COUNT(*) AS transactions, COALESCE(SUM(-amount), 0) AS credits
     FROM credit_transactions WHERE amount < 0 AND type = 'reversal'`,
  );

  // ── Tasks & executions ────────────────────────────────────────────────────
  const taskStatuses = db.all<{ status: string; count: number }>(
    'SELECT status, COUNT(*) AS count FROM tasks GROUP BY status ORDER BY count DESC',
  );
  const taskTypes = db.all<{ type: string; count: number }>(
    'SELECT type, COUNT(*) AS count FROM tasks GROUP BY type ORDER BY count DESC',
  );
  const taskCount = (status: string) => Number(taskStatuses.find((row) => row.status === status)?.count ?? 0);
  const taskTotal = taskStatuses.reduce((sum, row) => sum + Number(row.count), 0);
  const completed = taskCount('completed');
  const failed = taskCount('failed');
  const completionRatePct = taskTotal > 0 ? Math.round((completed / taskTotal) * 10000) / 100 : null;
  const failureRatePct = taskTotal > 0 ? Math.round((failed / taskTotal) * 10000) / 100 : null;
  const avgDuration = db.get<{ seconds: number | null }>(
    `SELECT AVG((julianday(completed_at) - julianday(started_at)) * 86400) AS seconds
     FROM tasks WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL`,
  );
  const executions = count('SELECT COUNT(*) AS value FROM agent_executions');
  const verificationFailures = safeTable('verification_results')
    ? count(`SELECT COUNT(*) AS value FROM verification_results WHERE passed = 0`)
    : count(`SELECT COUNT(*) AS value FROM agent_executions WHERE status = 'failed'`);

  // ── Agents ────────────────────────────────────────────────────────────────
  const registry = db.get<{ total: number; active: number; disabled: number; custom: number; categories: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled,
            SUM(CASE WHEN owner_id IS NOT NULL THEN 1 ELSE 0 END) AS custom,
            COUNT(DISTINCT category_id) AS categories
     FROM agents`,
  );
  const factoryVersions = safeTable('agent_versions') ? count('SELECT COUNT(*) AS value FROM agent_versions') : 0;
  const topDispatched = db.all<{ agent_slug: string | null; executions: number }>(
    `SELECT a.slug AS agent_slug, COUNT(*) AS executions
     FROM agent_executions e JOIN agents a ON a.id = e.agent_id
     GROUP BY a.slug ORDER BY executions DESC LIMIT 10`,
  ).map((row) => ({ agentSlug: row.agent_slug, executions: Number(row.executions) }));

  // ── Costs: API (model runs), storage (files), compute (queue jobs) ────────
  const modelTotals = db.get<{ cost: number; runs: number; succeeded: number; failed: number; input: number; output: number; latency: number | null }>(
    `SELECT COALESCE(SUM(cost_cents), 0) AS cost, COUNT(*) AS runs,
            SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            COALESCE(SUM(input_tokens), 0) AS input,
            COALESCE(SUM(output_tokens), 0) AS output,
            AVG(latency_ms) AS latency
     FROM model_runs`,
  );
  const costByModel = db.all<{ model_key: string; cost_cents: number; runs: number }>(
    `SELECT model_key, COALESCE(SUM(cost_cents), 0) AS cost_cents, COUNT(*) AS runs
     FROM model_runs GROUP BY model_key ORDER BY cost_cents DESC LIMIT 12`,
  ).map((row) => ({ modelKey: row.model_key, costCents: Number(row.cost_cents), runs: Number(row.runs) }));
  const costByProvider = db.all<{ provider: string; cost_cents: number; runs: number }>(
    `SELECT COALESCE(provider_key, 'unknown') AS provider, COALESCE(SUM(cost_cents), 0) AS cost_cents, COUNT(*) AS runs
     FROM model_runs GROUP BY provider ORDER BY cost_cents DESC`,
  ).map((row) => ({ provider: row.provider, costCents: Number(row.cost_cents), runs: Number(row.runs) }));
  const storage = db.get<{ files: number; bytes: number }>(
    'SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM files',
  );
  const artifacts = safeTable('project_artifacts') ? count('SELECT COUNT(*) AS value FROM project_artifacts') : 0;
  const queueByStatus = safeTable('execution_jobs')
    ? db.all<{ status: string; count: number }>('SELECT status, COUNT(*) AS count FROM execution_jobs GROUP BY status')
    : [];
  const jobsByType = safeTable('execution_jobs')
    ? db.all<{ job_type: string; count: number }>('SELECT job_type, COUNT(*) AS count FROM execution_jobs GROUP BY job_type')
    : [];

  const knownCostCents = Number(modelTotals?.cost ?? 0);
  const grossMarginCents = paidCents - knownCostCents;

  // ── System health ─────────────────────────────────────────────────────────
  const readiness = readinessPayload();
  let registryIntegrity: { ok: boolean; detail: string } | null = null;
  try {
    const row = db.get<{ contracts: number; slugs: number }>(
      `SELECT COUNT(*) AS contracts, COUNT(DISTINCT slug) AS slugs FROM agents`,
    );
    if (row) {
      registryIntegrity = {
        ok: Number(row.contracts) === Number(row.slugs),
        detail: `${row.contracts} contracts / ${row.slugs} distinct slugs`,
      };
    }
  } catch {
    registryIntegrity = null;
  }
  const memory = process.memoryUsage();
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const databaseEngine = databaseUrl.startsWith('postgres') ? 'postgres' : 'sqlite';
  let dbFileSize: number | null = null;
  if (databaseEngine === 'sqlite') {
    try {
      const path = databaseUrl.replace(/^file:/, '');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      dbFileSize = require('node:fs').statSync(path).size;
    } catch {
      dbFileSize = null;
    }
  }

  // ── Promotion / content ops (real rows only; absent tables report zero) ───
  const promotion = {
    contentAccounts: safeTable('promotion_accounts') ? count('SELECT COUNT(*) AS value FROM promotion_accounts') : 0,
    contentItems: safeTable('promotion_content') ? count('SELECT COUNT(*) AS value FROM promotion_content') : 0,
    publishJobs: safeTable('promotion_publish_jobs') ? count('SELECT COUNT(*) AS value FROM promotion_publish_jobs') : 0,
    publishedItems: safeTable('promotion_content')
      ? count(`SELECT COUNT(*) AS value FROM promotion_content WHERE status = 'published'`)
      : 0,
    engagementSnapshots: safeTable('promotion_engagement')
      ? count('SELECT COUNT(*) AS value FROM promotion_engagement')
      : 0,
    honesty:
      'Engagement (views/likes/followers) is only ever recorded from provider API responses. An absent provider connection reports zero snapshots — never a placeholder number.',
  };

  const ownerRow = db.get<{ role: string }>(`SELECT role FROM users WHERE role IN ('owner','super_admin') ORDER BY role LIMIT 1`);

  return {
    generatedAt: NOW(),
    source: 'platform-database',
    ledgerSeparation: {
      platformRevenue: 'akbaral-customer-revenue',
      missionRevenue: 'excluded — separate private mission ledger and treasury',
    },
    users: {
      total: Number(userTotals?.total ?? 0),
      active: Number(userTotals?.active ?? 0),
      suspended: Number(userTotals?.suspended ?? 0),
      pending: Number(userTotals?.pending ?? 0),
      verified: Number(userTotals?.verified ?? 0),
      byRole: byRole.map((row) => ({ role: row.role, count: Number(row.count) })),
      signups: { today: signupsToday, last7Days: signups7, last30Days: signups30, byDay: signupsByDay },
      retention: { activeLast7Days: active7, activeLast30Days: active30, neverLoggedIn: Number(userTotals?.never_logged_in ?? 0) },
    },
    plans: {
      catalog,
      subscriptions,
      activeSubscriptions: activeSubs.reduce((sum, row) => sum + row.count, 0),
      trialingSubscriptions: subscriptions.filter((row) => row.status === 'trialing').reduce((sum, row) => sum + row.count, 0),
      pastDueSubscriptions: subscriptions.filter((row) => row.status === 'past_due').reduce((sum, row) => sum + row.count, 0),
      paidSubscriptions: activeSubs.filter((row) => row.priceCents > 0).reduce((sum, row) => sum + row.count, 0),
      planMix,
    },
    revenue: {
      paidCents,
      refundedCents: Number(invoiceTotals?.refunded ?? 0),
      outstandingCents: Number(invoiceTotals?.outstanding ?? 0),
      currency: invoiceTotals?.currency ?? 'USD',
      payingCustomers: Number(payingCustomers?.count ?? 0),
      arpuCents,
      mrrCents,
      mrrNote: 'Sum of real monthly prices of ACTIVE paid subscriptions (annual normalised to /12). Not a projection.',
      byDay,
      byProvider: byProvider.map((row) => ({ provider: row.provider, cents: Number(row.cents), count: Number(row.count) })),
      recentInvoices,
      payments: {
        succeeded: paymentCount('succeeded'),
        failed: paymentCount('failed'),
        pending: paymentCount('pending'),
        refunded: paymentCount('refunded'),
      },
      billingOverview: billingService.adminBillingOverview(),
    },
    credits: {
      granted: Number(creditTotals?.granted ?? 0),
      consumed: Number(creditTotals?.consumed ?? 0),
      refunded: Number(creditTotals?.refunded ?? 0),
      outstanding: Number(creditAccounts?.free ?? 0) + Number(creditAccounts?.paid ?? 0) + Number(creditAccounts?.bonus ?? 0),
      accounts: {
        total: Number(creditAccounts?.total ?? 0),
        exhausted: Number(creditAccounts?.exhausted ?? 0),
        active: Number(creditAccounts?.active ?? 0),
      },
      pools: {
        freeCredits: Number(creditAccounts?.free ?? 0),
        paidCredits: Number(creditAccounts?.paid ?? 0),
        bonusCredits: Number(creditAccounts?.bonus ?? 0),
      },
      byDay: creditsByDay,
      refundPolicy: {
        refundedTransactions: Number(refundRows?.transactions ?? 0),
        refundedCredits: Number(refundRows?.credits ?? 0),
        note: 'Exactly one credit is consumed per successful task; failed, timed-out, cancelled or verification-failed tasks are refunded through a reversal transaction. Owner/super_admin executions consume nothing.',
      },
    },
    tasks: {
      total: taskTotal,
      byStatus: taskStatuses.map((row) => ({ status: row.status, count: Number(row.count) })),
      byType: taskTypes.map((row) => ({ type: row.type, count: Number(row.count) })),
      completionRatePct,
      failureRatePct,
      avgDurationSeconds: avgDuration?.seconds != null ? Math.round(Number(avgDuration.seconds) * 10) / 10 : null,
      last7Days: count('SELECT COUNT(*) AS value FROM tasks WHERE created_at >= ?', [daysAgo(7)]),
      executions,
      verificationFailures,
    },
    agents: {
      registryTotal: Number(registry?.total ?? 0),
      registryActive: Number(registry?.active ?? 0),
      registryDisabled: Number(registry?.disabled ?? 0),
      customAgents: Number(registry?.custom ?? 0),
      categories: Number(registry?.categories ?? 0),
      factoryVersions,
      topDispatched,
    },
    costs: {
      api: {
        modelCostCents: knownCostCents,
        runs: Number(modelTotals?.runs ?? 0),
        succeeded: Number(modelTotals?.succeeded ?? 0),
        failed: Number(modelTotals?.failed ?? 0),
        byModel: costByModel,
        byProvider: costByProvider,
      },
      storage: {
        files: Number(storage?.files ?? 0),
        bytes: Number(storage?.bytes ?? 0),
        mb: Math.round((Number(storage?.bytes ?? 0) / (1024 * 1024)) * 100) / 100,
        artifacts,
        uploadsDir: process.env.AKBARAL_UPLOAD_DIR ?? './uploads',
      },
      compute: {
        workflowJobs: Number(jobsByType.find((row) => row.job_type === 'workflow')?.count ?? 0),
        agentJobs: Number(jobsByType.find((row) => row.job_type === 'agent')?.count ?? 0),
        queueByStatus: queueByStatus.map((row) => ({ status: row.status, count: Number(row.count) })),
        completedJobs: Number(queueByStatus.find((row) => row.status === 'completed')?.count ?? 0),
        failedJobs: Number(queueByStatus.find((row) => row.status === 'failed')?.count ?? 0),
      },
      tokens: {
        inputTokens: Number(modelTotals?.input ?? 0),
        outputTokens: Number(modelTotals?.output ?? 0),
        avgLatencyMs: modelTotals?.latency != null ? Math.round(Number(modelTotals.latency)) : null,
      },
      externalProviderCosts: {
        known: false,
        requiresProviderBillingApi: true,
        note: 'Hosting, database, provider subscriptions and CDN invoices live with the providers. AKBARAL! never guesses them: connect each provider billing API (or enter the invoice amount) before these appear in totals.',
      },
      grossMargin: {
        revenueCents: paidCents,
        knownCostCents,
        grossMarginCents,
        grossMarginPct: grossMarginPct(grossMarginCents, paidCents),
        note: 'Gross margin uses RECORDED model/API cost only; external provider invoices are excluded until connected (see externalProviderCosts).',
      },
    },
    systemHealth: {
      status: readiness.status,
      uptimeSeconds: readiness.uptimeSeconds,
      checks: readiness.checks.map((check) => ({ name: check.name, ok: check.ok })),
      registryIntegrity,
      nodeVersion: process.version,
      memoryMb: Math.round((memory.rss / (1024 * 1024)) * 10) / 10,
      database: { engine: databaseEngine, fileSizeBytes: dbFileSize },
    },
    promotion,
    owner: {
      unlimitedExecution: Boolean(ownerRow),
      note: 'The configured owner identity (AKBARAL_OWNER_EMAIL) is promoted to role owner at boot and on every login, and then executes without consuming task credits.',
    },
    honesty: {
      realDataOnly: true,
      noFabrication:
        'Every figure on this dashboard is a live query against platform tables. Values that cannot be known without a provider API are reported as unavailable instead of estimated.',
      excludedFromTotals: [
        'private mission-system revenue and expenses (separate database, treasury and payout system)',
        'external hosting/provider invoices until their billing API is connected',
        'projected or forecast revenue',
      ],
    },
  };
}
