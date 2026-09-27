/**
 * AKBARAL! USER DASHBOARD API
 *
 * Authenticated endpoints for normal customer users. Each user sees ONLY
 * their own data. Cross-user access is impossible — every query is
 * scoped by req.auth.userId.
 *
 * Hierarchy enforced:
 *   - Normal USER: only their own data
 *   - OWNER/ADMIN: separate admin routes
 *   - ZA141251SA: completely separate private mission system
 */

import { Router } from 'express';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { asyncRoute, HttpError } from '../server/http';
import {
  findUserById,
  getCreditAccount,
  getAvailableCredits,
  db,
} from '../db';

export const userDashboardRouter = Router();

/**
 * TASK PROJECTION — derived, never denormalized.
 *
 * `agent_category` and `credits_consumed` are NOT columns on `tasks` (see
 * db/migrations-pg/0001_init.sql). They were previously selected as if they
 * were, which made `GET /api/dashboard` fail with
 * `no such column: agent_category` (HTTP 500) on every engine.
 *
 * Both values are real and already stored — just normalized elsewhere:
 *
 *   · category  — tasks.agent_id → agents.category_id → agent_categories.slug.
 *                 A task with no agent (or an agent with no category) honestly
 *                 reports NULL rather than an invented bucket.
 *
 *   · credits   — the credit ledger is the single source of truth. A task
 *                 consumption writes `consume_task` (amount -1) and a refund
 *                 writes `refund_task` (amount +1), both `status='completed'`
 *                 and both idempotent per task (see consumeTaskCredit /
 *                 refundTaskCredit). Negating the SUM therefore yields exactly
 *                 what the user was really charged: 1 for a task that consumed
 *                 a credit, and 0 for one that was refunded or cancelled.
 *                 This can never drift from the balance the user actually sees,
 *                 because it IS the same ledger.
 *
 * Adding physical columns would have created a second, divergent source of
 * truth for money. Deriving keeps one.
 */
const TASK_CREDITS_CONSUMED_SQL = `-COALESCE((
  SELECT SUM(ct.amount) FROM credit_transactions ct
   WHERE ct.task_id = t.id
     AND ct.status = 'completed'
     AND ct.type IN ('consume_task', 'refund_task')
), 0)`;

const TASK_SELECT_SQL = `SELECT t.id, t.title, t.description, t.status, t.priority, t.type,
       t.input_data, t.output_data, t.error_message, t.started_at, t.completed_at,
       t.user_id, t.project_id, t.agent_id, t.created_at, t.updated_at,
       ac.slug AS agent_category,
       ${TASK_CREDITS_CONSUMED_SQL} AS credits_consumed
  FROM tasks t
  LEFT JOIN agents a ON a.id = t.agent_id
  LEFT JOIN agent_categories ac ON ac.id = a.category_id`;

/** Shape a task row (from TASK_SELECT_SQL) for the dashboard API. */
function presentTask(t: Record<string, unknown>) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    agentCategory: (t.agent_category as string | null) ?? null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    completedAt: t.completed_at,
    creditsConsumed: Number(t.credits_consumed ?? 0),
  };
}

/** GET /api/dashboard — Full user dashboard data */
userDashboardRouter.get(
  '/',
  requireAuth,
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const user = findUserById(userId);
    if (!user) throw new HttpError(404, 'user not found', 'not_found');

    const creditAccount = getCreditAccount(userId);
    const availableCredits = creditAccount ? getAvailableCredits(creditAccount) : 0;

    // Get user's tasks (last 50)
    const tasks = db.all(
      `${TASK_SELECT_SQL} WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT 50`,
      [userId]
    );

    // Task counts by status
    const taskCounts = db.all(
      `SELECT status, COUNT(*) as count FROM tasks WHERE user_id = ? GROUP BY status`,
      [userId]
    );

    // Get user's subscription
    const subscription = db.get(
      `SELECT * FROM subscriptions WHERE user_id = ? AND status IN ('active', 'trialing') ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    // Get user's plan info
    const plan = subscription
      ? db.get(`SELECT * FROM plans WHERE id = ?`, [String((subscription as any).plan_id)])
      : db.get(`SELECT * FROM plans WHERE key = 'free'`);

    // Get recent invoices. The billed figure is `total_cents` (subtotal + tax);
    // there is no `amount_cents` column on invoices — only on payments.
    const invoices = db.all(
      `SELECT id, number, total_cents, currency, status, created_at, paid_at
       FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );

    // Get recent payments
    const payments = db.all(
      `SELECT id, amount_cents, currency, provider, status, created_at
       FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );

    // Active sessions
    const sessions = db.all(
      `SELECT id, created_at, last_seen_at, ip_address, user_agent
       FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 10`,
      [userId]
    );

    // Parse user metadata for country
    let country: string | null = null;
    try {
      if (user.metadata) {
        const meta = JSON.parse(user.metadata);
        if (typeof meta.country === 'string') country = meta.country;
      }
    } catch {}

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        country,
        emailVerifiedAt: user.email_verified_at,
        createdAt: user.created_at,
      },
      credits: {
        available: availableCredits,
        account: creditAccount ? {
          freeCredits: Number(creditAccount.free_credits),
          freeCreditsUsed: Number(creditAccount.free_credits_used ?? 0),
          paidCredits: Number(creditAccount.paid_credits ?? 0),
          bonusCredits: Number(creditAccount.bonus_credits ?? 0),
        } : null,
      },
      plan: plan ? {
        key: String((plan as any).key),
        name: String((plan as any).name),
        priceCents: Number((plan as any).price_cents ?? 0),
        currency: String((plan as any).currency ?? 'USD'),
        billingInterval: String((plan as any).billing_interval ?? 'month'),
      } : null,
      subscription: subscription ? {
        id: String((subscription as any).id),
        status: String((subscription as any).status),
        currentPeriodStart: String((subscription as any).current_period_start ?? ''),
        currentPeriodEnd: String((subscription as any).current_period_end ?? ''),
      } : null,
      tasks: {
        recent: tasks.map((t: any) => presentTask(t)),
        counts: Object.fromEntries(taskCounts.map((t: any) => [t.status, Number(t.count)])),
      },
      billing: {
        invoices: invoices.map((i: any) => ({
          id: i.id,
          number: i.number,
          amountCents: Number(i.total_cents),
          currency: i.currency,
          status: i.status,
          createdAt: i.created_at,
          paidAt: i.paid_at,
        })),
        payments: payments.map((p: any) => ({
          id: p.id,
          amountCents: Number(p.amount_cents),
          currency: p.currency,
          provider: p.provider,
          status: p.status,
          createdAt: p.created_at,
        })),
      },
      sessions: sessions.map((s: any) => ({
        id: s.id,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        ipAddress: s.ip_address,
        userAgent: s.user_agent,
      })),
    });
  }),
);

/** GET /api/dashboard/profile — User profile */
userDashboardRouter.get(
  '/profile',
  requireAuth,
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const user = findUserById(userId);
    if (!user) throw new HttpError(404, 'user not found', 'not_found');

    let country: string | null = null;
    try {
      if (user.metadata) {
        const meta = JSON.parse(user.metadata);
        if (typeof meta.country === 'string') country = meta.country;
      }
    } catch {}

    res.status(200).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      country,
      emailVerifiedAt: user.email_verified_at,
      createdAt: user.created_at,
    });
  }),
);

/** GET /api/dashboard/credits — Credit balance */
userDashboardRouter.get(
  '/credits',
  requireAuth,
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const account = getCreditAccount(userId);
    const available = account ? getAvailableCredits(account) : 0;
    res.status(200).json({
      available,
      account: account ? {
        freeCredits: Number(account.free_credits),
        freeCreditsUsed: Number(account.free_credits_used ?? 0),
        paidCredits: Number(account.paid_credits ?? 0),
        bonusCredits: Number(account.bonus_credits ?? 0),
      } : null,
    });
  }),
);

/** GET /api/dashboard/tasks — User's tasks */
userDashboardRouter.get(
  '/tasks',
  requireAuth,
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));

    let query = `${TASK_SELECT_SQL} WHERE t.user_id = ?`;
    const params: any[] = [userId];

    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }

    query += ' ORDER BY t.created_at DESC LIMIT ?';
    params.push(limit);

    const tasks = db.all(query, params);

    const counts = db.all(
      'SELECT status, COUNT(*) as count FROM tasks WHERE user_id = ? GROUP BY status',
      [userId]
    );

    res.status(200).json({
      tasks: tasks.map((t: any) => presentTask(t)),
      counts: Object.fromEntries(counts.map((t: any) => [t.status, Number(t.count)])),
    });
  }),
);

/** GET /api/dashboard/tasks/:id — Single task detail */
userDashboardRouter.get(
  '/tasks/:id',
  requireAuth,
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const task = db.get(
      `${TASK_SELECT_SQL} WHERE t.id = ? AND t.user_id = ?`,
      [req.params.id, userId]
    );
    if (!task) throw new HttpError(404, 'task not found', 'not_found');

    // Get task events
    const events = db.all(
      'SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );

    // Get execution logs
    const logs = db.all(
      'SELECT id, level, message, created_at FROM agent_execution_logs WHERE execution_id IN (SELECT id FROM agent_executions WHERE task_id = ?) ORDER BY created_at ASC LIMIT 100',
      [req.params.id]
    );

    res.status(200).json({
      task: {
        ...presentTask(task as Record<string, unknown>),
        description: (task as any).description,
      },
      events: events.map((e: any) => ({
        id: e.id,
        // task_events stores `type` + `message` + `data` — there is no
        // `event_type`/`detail` pair on this table.
        eventType: e.type,
        detail: e.message,
        createdAt: e.created_at,
      })),
      logs: logs.map((l: any) => ({
        id: l.id,
        level: l.level,
        message: l.message,
        createdAt: l.created_at,
      })),
    });
  }),
);

/** GET /api/dashboard/billing — Billing summary */
userDashboardRouter.get(
  '/billing',
  requireAuth,
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;

    const subscription = db.get(
      `SELECT s.*, p.key as plan_key, p.name as plan_name, p.price_cents, p.currency
       FROM subscriptions s LEFT JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = ? AND s.status IN ('active', 'trialing')
       ORDER BY s.created_at DESC LIMIT 1`,
      [userId]
    );

    const invoices = db.all(
      'SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId]
    );

    const payments = db.all(
      'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [userId]
    );

    // Credit transactions
    const transactions = db.all(
      'SELECT id, type, amount, reason, created_at FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [userId]
    );

    res.status(200).json({
      subscription: subscription ? {
        id: String((subscription as any).id),
        status: String((subscription as any).status),
        planKey: String((subscription as any).plan_key ?? ''),
        planName: String((subscription as any).plan_name ?? ''),
        priceCents: Number((subscription as any).price_cents ?? 0),
        currency: String((subscription as any).currency ?? 'USD'),
        currentPeriodStart: String((subscription as any).current_period_start ?? ''),
        currentPeriodEnd: String((subscription as any).current_period_end ?? ''),
      } : null,
      invoices: invoices.map((i: any) => ({
        id: i.id,
        number: i.number,
        amountCents: Number(i.total_cents),
        currency: i.currency,
        status: i.status,
        createdAt: i.created_at,
        paidAt: i.paid_at,
      })),
      payments: payments.map((p: any) => ({
        id: p.id,
        amountCents: Number(p.amount_cents),
        currency: p.currency,
        provider: p.provider,
        status: p.status,
        createdAt: p.created_at,
      })),
      creditTransactions: transactions.map((t: any) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        reason: t.reason,
        createdAt: t.created_at,
      })),
    });
  }),
);

/** GET /api/dashboard/security — Security/session info */
userDashboardRouter.get(
  '/security',
  requireAuth,
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;

    const sessions = db.all(
      `SELECT id, created_at, last_seen_at, ip_address, user_agent
       FROM sessions WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY last_seen_at DESC LIMIT 20`,
      [userId]
    );

    const securityLog = db.all(
      `SELECT id, event_type, ip_address, user_agent, created_at
       FROM security_logs WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    res.status(200).json({
      sessions: sessions.map((s: any) => ({
        id: s.id,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        ipAddress: s.ip_address,
        userAgent: s.user_agent,
      })),
      securityLog: securityLog.map((e: any) => ({
        id: e.id,
        eventType: e.event_type,
        ipAddress: e.ip_address,
        userAgent: e.user_agent,
        createdAt: e.created_at,
      })),
    });
  }),
);

/** POST /api/dashboard/sessions/:id/revoke — Revoke a session */
userDashboardRouter.post(
  '/sessions/:id/revoke',
  requireAuth,
  asyncRoute(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const sessionId = req.params.id;

    // Verify session belongs to this user
    const session = db.get(
      'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
      [sessionId, userId]
    );
    if (!session) throw new HttpError(404, 'session not found', 'not_found');

    const { revokeSession } = require('../db') as typeof import('../db');
    revokeSession(sessionId);

    res.status(200).json({ revoked: true, sessionId });
  }),
);
