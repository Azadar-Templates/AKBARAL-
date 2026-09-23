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
      `SELECT id, title, status, agent_category, created_at, updated_at, completed_at, credits_consumed
       FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
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

    // Get recent invoices
    const invoices = db.all(
      `SELECT id, number, amount_cents, currency, status, created_at, paid_at
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
        recent: tasks.map((t: any) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          agentCategory: t.agent_category,
          createdAt: t.created_at,
          updatedAt: t.updated_at,
          completedAt: t.completed_at,
          creditsConsumed: Number(t.credits_consumed ?? 0),
        })),
        counts: Object.fromEntries(taskCounts.map((t: any) => [t.status, Number(t.count)])),
      },
      billing: {
        invoices: invoices.map((i: any) => ({
          id: i.id,
          number: i.number,
          amountCents: Number(i.amount_cents),
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

    let query = 'SELECT * FROM tasks WHERE user_id = ?';
    const params: any[] = [userId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const tasks = db.all(query, params);

    const counts = db.all(
      'SELECT status, COUNT(*) as count FROM tasks WHERE user_id = ? GROUP BY status',
      [userId]
    );

    res.status(200).json({
      tasks: tasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        agentCategory: t.agent_category,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        completedAt: t.completed_at,
        creditsConsumed: Number(t.credits_consumed ?? 0),
      })),
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
      'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
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
      'SELECT * FROM execution_logs WHERE execution_id IN (SELECT id FROM agent_executions WHERE task_id = ?) ORDER BY created_at ASC LIMIT 100',
      [req.params.id]
    );

    res.status(200).json({
      task: {
        id: (task as any).id,
        title: (task as any).title,
        description: (task as any).description,
        status: (task as any).status,
        agentCategory: (task as any).agent_category,
        createdAt: (task as any).created_at,
        updatedAt: (task as any).updated_at,
        completedAt: (task as any).completed_at,
        creditsConsumed: Number((task as any).credits_consumed ?? 0),
      },
      events: events.map((e: any) => ({
        id: e.id,
        eventType: e.event_type,
        detail: e.detail,
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
      'SELECT * FROM credit_transactions WHERE account_id = (SELECT id FROM credit_accounts WHERE user_id = ?) ORDER BY created_at DESC LIMIT 50',
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
        amountCents: Number(i.amount_cents),
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
       FROM security_log WHERE user_id = ?
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
