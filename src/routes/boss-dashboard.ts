/**
 * ZA141251SA BOSS DASHBOARD API
 *
 * Shows all 4,001 agents with $1B daily target each, verified revenue
 * (from real ledger only), wallet balances, execution status, human action
 * tasks, scheduler health, and treasury.
 *
 * This is the PRIVATE mission dashboard — completely separate from AKBARAL!
 */

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { missionDb as db } from '../mission/database';
import type { Row } from '../mission/database';

export const bossDashboardRouter = Router();

/**
 * Bearer auth for the mission bridge — FAILS CLOSED.
 *
 * SECURITY FIX 2026-09-26: this guard used to call `next()` when no token was
 * configured, on the assumption that the process binds to 127.0.0.1. The
 * AKBARAL! API tier does NOT bind to loopback (HOST defaults to 0.0.0.0 and the
 * public Next tier proxies /api/* straight through), so the effect was an
 * anonymous, internet-reachable read of the private ZA141251SA fleet, treasury,
 * opportunity and audit data. Verified live before the fix:
 *   curl http://<public-host>/api/boss/overview   ->   200 with the full fleet.
 *
 * No token configured now means no access, and src/app.ts additionally refuses
 * to mount this router at all unless the operator explicitly opts in.
 */
function requireMissionAuth(req: any, res: any, next: any) {
  const header = String(req.headers.authorization ?? '');
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  const missionToken = String(
    process.env.ZA141251SA_DASHBOARD_TOKEN ?? process.env.MISSION_DASHBOARD_TOKEN ?? '',
  ).trim();
  if (missionToken.length < 32) {
    return res.status(404).json({
      error: {
        code: 'not_found',
        message: 'not found',
      },
    });
  }
  // Constant-time compare so the token cannot be discovered byte by byte.
  const provided = Buffer.from(token);
  const expected = Buffer.from(missionToken);
  const ok = provided.length === expected.length && timingSafeEqual(provided, expected);
  if (!ok) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'unauthorized' } });
  }
  next();
}

/** GET /api/boss/overview — Fleet summary */
bossDashboardRouter.get('/overview', requireMissionAuth, (_req, res) => {
  const agents = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents')?.c ?? 0);
  const activeAgents = Number(db.get<Row>("SELECT COUNT(*) as c FROM mission_agents WHERE status='active'")?.c ?? 0);
  const wallets = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_wallets')?.c ?? 0);
  const cashAccounts = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_cash_accounts')?.c ?? 0);
  const moneyGrants = Number(db.get<Row>("SELECT COUNT(*) as c FROM mission_money_grants WHERE status='active'")?.c ?? 0);
  const dailyTargets = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agent_daily_targets')?.c ?? 0);
  const treasuryBalance = Number(db.get<Row>("SELECT COALESCE(available_cents,0) as c FROM mission_cash_accounts WHERE id='treasury'")?.c ?? 0);
  const totalWalletBalance = Number(db.get<Row>('SELECT COALESCE(SUM(balance_cents),0) as c FROM mission_wallets')?.c ?? 0);
  const verifiedRevenue = Number(db.get<Row>("SELECT COALESCE(SUM(amount_cents),0) as c FROM mission_revenue WHERE status='received' AND verifier IS NOT NULL")?.c ?? 0);
  const opportunities = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities')?.c ?? 0);
  const executingOpps = Number(db.get<Row>("SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state='executing'")?.c ?? 0);
  const assignedOpps = Number(db.get<Row>("SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state='assigned'")?.c ?? 0);
  const verifiedOpps = Number(db.get<Row>("SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state IN ('verified','delivered','payment_confirmed','settlement_verified')")?.c ?? 0);
  const schedulerRow = db.get<Row>("SELECT * FROM mission_scheduler_state WHERE id='global'");
  const humanActionsPending = Number(db.get<Row>("SELECT COUNT(*) as c FROM mission_human_action_tasks WHERE status='pending'")?.c ?? 0);
  const auditRows = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_audit')?.c ?? 0);

  res.json({
    fleet: {
      totalAgents: agents,
      activeAgents,
      wallets,
      cashAccounts,
      moneyGrants,
      dailyTargetRecords: dailyTargets,
      perAgentDailyTargetCents: 100_000_000_000,
      perAgentDailyTargetUSD: 1_000_000_000,
      fleetDailyTargetCents: agents * 100_000_000_000,
      fleetDailyTargetUSD: agents * 1_000_000_000,
    },
    treasury: {
      balanceCents: treasuryBalance,
      balanceUSD: treasuryBalance / 100,
      totalWalletBalanceCents: totalWalletBalance,
      verifiedRevenueCents: verifiedRevenue,
      verifiedRevenueUSD: verifiedRevenue / 100,
    },
    opportunities: {
      total: opportunities,
      executing: executingOpps,
      assigned: assignedOpps,
      verified: verifiedOpps,
    },
    scheduler: schedulerRow ? {
      enabled: Number(schedulerRow.enabled) === 1,
      lastTickAt: schedulerRow.last_tick_at ? String(schedulerRow.last_tick_at) : null,
      lastCycle: Number(schedulerRow.last_cycle ?? 0),
      consecutiveFailures: Number(schedulerRow.consecutive_failures ?? 0),
      lastError: schedulerRow.last_error ? String(schedulerRow.last_error) : null,
    } : null,
    blocked: {
      humanActionsPending,
    },
    audit: {
      totalEntries: auditRows,
    },
  });
});

/** GET /api/boss/agents — All agents with targets */
bossDashboardRouter.get('/agents', requireMissionAuth, (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? '100'), 10) || 100));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);

  const agents = db.all<Row>(
    `SELECT a.id, a.slug, a.name, a.category, a.role_key, a.status, a.mission_role,
            a.daily_target_cents, a.daily_target_currency,
            w.balance_cents as wallet_balance, w.id as wallet_id,
            ca.available_cents as cash_available, ca.held_cents as cash_held,
            COALESCE(dt.realized_cents, 0) as realized_cents,
            COALESCE(dt.progress_pct, 0) as progress_pct,
            COALESCE(dt.met, 0) as target_met
     FROM mission_agents a
     LEFT JOIN mission_wallets w ON w.agent_id = a.id AND w.kind IN ('agent','worker')
     LEFT JOIN mission_cash_accounts ca ON ca.agent_id = a.id
     LEFT JOIN mission_agent_daily_targets dt ON dt.agent_id = a.id AND dt.day = date('now')
     ORDER BY a.created_at ASC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );

  const total = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents')?.c ?? 0);

  res.json({
    total,
    offset,
    limit,
    agents: agents.map(a => ({
      id: String(a.id),
      slug: String(a.slug),
      name: String(a.name),
      category: a.category ? String(a.category) : null,
      roleKey: a.role_key ? String(a.role_key) : null,
      status: String(a.status),
      missionRole: String(a.mission_role),
      dailyTargetCents: Number(a.daily_target_cents ?? 100_000_000_000),
      dailyTargetUSD: Number(a.daily_target_cents ?? 100_000_000_000) / 100,
      dailyTargetCurrency: String(a.daily_target_currency ?? 'USD'),
      walletBalanceCents: Number(a.wallet_balance ?? 0),
      walletId: a.wallet_id ? String(a.wallet_id) : null,
      cashAvailableCents: Number(a.cash_available ?? 0),
      cashHeldCents: Number(a.cash_held ?? 0),
      realizedTodayCents: Number(a.realized_cents ?? 0),
      realizedTodayUSD: Number(a.realized_cents ?? 0) / 100,
      progressPct: Number(a.progress_pct ?? 0),
      targetMet: Number(a.target_met ?? 0) === 1,
    })),
  });
});

/** GET /api/boss/agents/:id — Single agent detail */
bossDashboardRouter.get('/agents/:id', requireMissionAuth, (req, res) => {
  const agentId = req.params.id;
  const agent = db.get<Row>('SELECT * FROM mission_agents WHERE id = ?', [agentId]);
  if (!agent) { res.status(404).json({ error: 'agent not found' }); return; }

  const wallet = db.get<Row>('SELECT * FROM mission_wallets WHERE agent_id = ? LIMIT 1', [agentId]);
  const cashAccount = db.get<Row>('SELECT * FROM mission_cash_accounts WHERE agent_id = ?', [agentId]);
  const grant = db.get<Row>('SELECT * FROM mission_money_grants WHERE agent_id = ?', [agentId]);
  const dailyTarget = db.get<Row>("SELECT * FROM mission_agent_daily_targets WHERE agent_id = ? AND day = date('now')", [agentId]);
  const humanActions = db.all<Row>('SELECT * FROM mission_human_action_tasks WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10', [agentId]);
  const earningJobs = db.all<Row>('SELECT * FROM mission_earning_jobs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20', [agentId]);
  const ledgerEntries = db.all<Row>('SELECT * FROM mission_agent_earnings_ledger WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20', [agentId]);

  res.json({
    agent: {
      id: String(agent.id),
      slug: String(agent.slug),
      name: String(agent.name),
      category: agent.category ? String(agent.category) : null,
      roleKey: agent.role_key ? String(agent.role_key) : null,
      status: String(agent.status),
      missionRole: String(agent.mission_role),
      dailyTargetCents: Number(agent.daily_target_cents ?? 100_000_000_000),
      dailyTargetUSD: Number(agent.daily_target_cents ?? 100_000_000_000) / 100,
    },
    wallet: wallet ? {
      id: String(wallet.id),
      balanceCents: Number(wallet.balance_cents ?? 0),
      budgetCents: Number(wallet.budget_cents ?? 0),
      spentCents: Number(wallet.spent_cents ?? 0),
      status: String(wallet.status),
    } : null,
    cashAccount: cashAccount ? {
      availableCents: Number(cashAccount.available_cents ?? 0),
      heldCents: Number(cashAccount.held_cents ?? 0),
      frozen: Number(cashAccount.frozen ?? 0) === 1,
    } : null,
    grant: grant ? {
      spendLimitCents: Number(grant.spend_limit_cents ?? 0),
      delegationCents: Number(grant.delegation_cents ?? 0),
      status: String(grant.status),
      expiresAt: String(grant.expires_at),
    } : null,
    dailyTarget: dailyTarget ? {
      day: String(dailyTarget.day),
      targetCents: Number(dailyTarget.target_cents),
      realizedCents: Number(dailyTarget.realized_cents),
      remainingCents: Number(dailyTarget.remaining_cents),
      progressPct: Number(dailyTarget.progress_pct),
      met: Number(dailyTarget.met) === 1,
      metAt: dailyTarget.met_at ? String(dailyTarget.met_at) : null,
    } : null,
    humanActions: humanActions.map(h => ({
      id: String(h.id),
      actionType: String(h.action_type),
      reason: String(h.reason),
      status: String(h.status),
      createdAt: String(h.created_at),
    })),
    earningJobs: earningJobs.map(j => ({
      id: String(j.id),
      opportunityId: String(j.opportunity_id),
      state: String(j.state),
      createdAt: String(j.created_at),
    })),
    ledger: ledgerEntries.map(l => ({
      id: String(l.id),
      grossCents: Number(l.gross_cents),
      netCents: Number(l.net_cents),
      verified: Number(l.verified) === 1,
      createdAt: String(l.created_at),
    })),
  });
});

/** GET /api/boss/treasury — Treasury detail */
bossDashboardRouter.get('/treasury', requireMissionAuth, (_req, res) => {
  const treasury = db.get<Row>("SELECT * FROM mission_cash_accounts WHERE id = 'treasury'");
  const totalWalletBalance = Number(db.get<Row>('SELECT COALESCE(SUM(balance_cents),0) as c FROM mission_wallets')?.c ?? 0);
  const totalCashAvailable = Number(db.get<Row>('SELECT COALESCE(SUM(available_cents),0) as c FROM mission_cash_accounts')?.c ?? 0);
  const totalCashHeld = Number(db.get<Row>('SELECT COALESCE(SUM(held_cents),0) as c FROM mission_cash_accounts')?.c ?? 0);
  const verifiedRevenue = Number(db.get<Row>("SELECT COALESCE(SUM(amount_cents),0) as c FROM mission_revenue WHERE status='received' AND verifier IS NOT NULL")?.c ?? 0);
  const ledgerRows = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_cash_entries')?.c ?? 0);
  const recentEntries = db.all<Row>('SELECT * FROM mission_cash_entries ORDER BY seq DESC LIMIT 20');

  res.json({
    treasury: treasury ? {
      availableCents: Number(treasury.available_cents ?? 0),
      heldCents: Number(treasury.held_cents ?? 0),
      frozen: Number(treasury.frozen ?? 0) === 1,
    } : null,
    totals: {
      walletBalanceCents: totalWalletBalance,
      cashAvailableCents: totalCashAvailable,
      cashHeldCents: totalCashHeld,
      verifiedRevenueCents: verifiedRevenue,
      verifiedRevenueUSD: verifiedRevenue / 100,
      ledgerEntries: ledgerRows,
    },
    recentEntries: recentEntries.map(e => ({
      seq: Number(e.seq),
      accountId: String(e.account_id),
      bucket: String(e.bucket),
      deltaCents: Number(e.delta_cents),
      balanceAfter: Number(e.balance_after),
      reference: String(e.reference),
      createdAt: String(e.created_at),
    })),
  });
});

/** GET /api/boss/scheduler — Scheduler health */
bossDashboardRouter.get('/scheduler', requireMissionAuth, (_req, res) => {
  const state = db.get<Row>("SELECT * FROM mission_scheduler_state WHERE id='global'");
  const recentTicks = db.all<Row>('SELECT * FROM mission_scheduler_ticks ORDER BY cycle DESC LIMIT 20');
  const executions = db.all<Row>("SELECT state, COUNT(*) as c FROM mission_earning_executions GROUP BY state");
  const humanActions = db.all<Row>("SELECT action_type, COUNT(*) as c FROM mission_human_action_tasks WHERE status='pending' GROUP BY action_type");

  res.json({
    state: state ? {
      enabled: Number(state.enabled) === 1,
      lastTickAt: state.last_tick_at ? String(state.last_tick_at) : null,
      lastCycle: Number(state.last_cycle ?? 0),
      consecutiveFailures: Number(state.consecutive_failures ?? 0),
      lastError: state.last_error ? String(state.last_error) : null,
    } : null,
    recentTicks: recentTicks.map(t => ({
      cycle: Number(t.cycle),
      status: String(t.status),
      discovered: Number(t.discovered ?? 0),
      qualified: Number(t.qualified ?? 0),
      matched: Number(t.matched ?? 0),
      locked: Number(t.locked ?? 0),
      executing: Number(t.executing ?? 0),
      verified: Number(t.verified ?? 0),
      settled: Number(t.settled ?? 0),
      failed: Number(t.failed ?? 0),
      retried: Number(t.retried ?? 0),
      expired: Number(t.expired ?? 0),
      detail: t.detail ? String(t.detail) : null,
      completedAt: t.completed_at ? String(t.completed_at) : null,
    })),
    executionsByState: Object.fromEntries(executions.map(e => [String(e.state), Number(e.c)])),
    humanActionsByType: Object.fromEntries(humanActions.map(h => [String(h.action_type), Number(h.c)])),
  });
});

/** GET /api/boss/blocked — Human action tasks requiring owner */
bossDashboardRouter.get('/blocked', requireMissionAuth, (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  const tasks = db.all<Row>(
    "SELECT * FROM mission_human_action_tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?",
    [limit],
  );

  res.json({
    pending: tasks.map(t => ({
      id: String(t.id),
      agentId: String(t.agent_id),
      agentName: (() => { try { return String(db.get<Row>('SELECT name FROM mission_agents WHERE id = ?', [String(t.agent_id)])?.name ?? ''); } catch { return ''; } })(),
      opportunityId: t.opportunity_id ? String(t.opportunity_id) : null,
      actionType: String(t.action_type),
      reason: String(t.reason),
      platformUrl: t.platform_url ? String(t.platform_url) : null,
      createdAt: String(t.created_at),
    })),
    total: Number(db.get<Row>("SELECT COUNT(*) as c FROM mission_human_action_tasks WHERE status = 'pending'")?.c ?? 0),
  });
});

/** GET /api/boss/opportunities — Verified opportunities */
bossDashboardRouter.get('/opportunities', requireMissionAuth, (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;

  let query = 'SELECT * FROM mission_earning_engine_opportunities';
  const params: any[] = [];
  if (state) { query += ' WHERE verification_state = ?'; params.push(state); }
  query += ' ORDER BY score DESC LIMIT ?';
  params.push(limit);

  const opps = db.all<Row>(query, params);
  const counts = db.all<Row>('SELECT verification_state, COUNT(*) as c FROM mission_earning_engine_opportunities GROUP BY verification_state');

  res.json({
    opportunities: opps.map(o => ({
      id: String(o.id),
      registryKey: String(o.registry_key),
      provider: String(o.provider),
      platform: String(o.platform),
      grossCents: Number(o.gross_cents),
      netCents: Number(o.net_cents),
      automationPermitted: Number(o.automation_permitted) === 1,
      state: String(o.verification_state),
      score: Number(o.score),
      exclusiveAgentId: o.exclusive_agent_id ? String(o.exclusive_agent_id) : null,
      riskLevel: String(o.risk_level),
      createdAt: String(o.created_at),
    })),
    countsByState: Object.fromEntries(counts.map(c => [String(c.verification_state), Number(c.c)])),
  });
});
