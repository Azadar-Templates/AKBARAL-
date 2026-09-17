import { Router } from 'express';
import { requireAuth } from '../server/middleware/auth';
import { requireRole } from '../server/middleware/rbac';
import { db } from '../db';
import { buildOwnerDashboard } from '../business/owner-analytics';

/**
 * AKBARAL! Owner Console API — OWNER + SUPER_ADMIN ONLY.
 *
 * Business analytics for the platform owner: real users, signups, plans,
 * purchases/revenue, tasks, credits, agents, API/storage/compute costs and
 * system health — every value queried live from the platform database.
 *
 * Two guarantees this router enforces:
 *   1. Least privilege: `requireRole('owner','super_admin')` on the whole
 *      router, so staff admins and ordinary users receive 403.
 *   2. Ledger separation: this surface reports AKBARAL! customer revenue only.
 *      It never reads the private ZA141251SA mission database or treasury, so
 *      the two ledgers cannot be mixed by accident.
 */
export function createOwnerRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireRole('owner', 'super_admin'));

  router.get('/dashboard', (_req, res) => {
    res.status(200).json({ dashboard: buildOwnerDashboard() });
  });

  /** Growth: users and signups over a configurable window (1..180 days). */
  router.get('/growth', (req, res) => {
    const days = Math.min(180, Math.max(1, Number(req.query.days ?? 30) || 30));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const signups = db.all<{ day: string; count: number }>(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
       FROM users WHERE created_at >= ? GROUP BY day ORDER BY day`,
      [since],
    );
    const logins = db.all<{ day: string; count: number }>(
      `SELECT substr(last_login_at, 1, 10) AS day, COUNT(*) AS count
       FROM users WHERE last_login_at >= ? GROUP BY day ORDER BY day`,
      [since],
    );
    const totals = db.get<{ total: number; verified: number; never_logged_in: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN email_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified,
              SUM(CASE WHEN last_login_at IS NULL THEN 1 ELSE 0 END) AS never_logged_in
       FROM users`,
    );
    res.status(200).json({
      window: { days, since },
      signups,
      activeUsers: logins,
      totals: {
        total: Number(totals?.total ?? 0),
        verified: Number(totals?.verified ?? 0),
        neverLoggedIn: Number(totals?.never_logged_in ?? 0),
      },
      source: 'platform-database',
    });
  });

  /** Revenue: invoices/payments (AKBARAL! customer revenue only). */
  router.get('/revenue', (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30) || 30));
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const totals = db.get<{ paid: number; refunded: number; outstanding: number; currency: string | null }>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents ELSE 0 END), 0) AS paid,
         COALESCE(SUM(CASE WHEN status = 'refunded' THEN total_cents ELSE 0 END), 0) AS refunded,
         COALESCE(SUM(CASE WHEN status IN ('due','pending') THEN total_cents ELSE 0 END), 0) AS outstanding,
         MAX(currency) AS currency
       FROM invoices`,
    );
    const byDay = db.all<{ day: string; cents: number; count: number }>(
      `SELECT substr(COALESCE(paid_at, created_at), 1, 10) AS day, COALESCE(SUM(total_cents),0) AS cents, COUNT(*) AS count
       FROM invoices WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= ?
       GROUP BY day ORDER BY day`,
      [since],
    );
    const invoices = db.all(
      `SELECT id, number, status, total_cents, currency, provider, paid_at, created_at
       FROM invoices ORDER BY created_at DESC LIMIT 50`,
    );
    res.status(200).json({
      window: { days, since },
      totals: {
        paidCents: Number(totals?.paid ?? 0),
        refundedCents: Number(totals?.refunded ?? 0),
        outstandingCents: Number(totals?.outstanding ?? 0),
        currency: totals?.currency ?? 'USD',
      },
      byDay,
      invoices,
      ledger: 'akbaral-customer-revenue',
      missionRevenueExcluded: true,
    });
  });

  /** Costs: recorded API (model) cost, storage, compute activity. */
  router.get('/costs', (_req, res) => {
    const models = db.all(
      `SELECT model_key, COALESCE(provider_key,'unknown') AS provider_key,
              COUNT(*) AS runs, COALESCE(SUM(cost_cents),0) AS cost_cents,
              COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
              AVG(latency_ms) AS avg_latency_ms
       FROM model_runs GROUP BY model_key, provider_key ORDER BY cost_cents DESC`,
    );
    const storage = db.get<{ files: number; bytes: number }>(
      'SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes),0) AS bytes FROM files',
    );
    const jobs = db.all<{ job_type: string; status: string; count: number }>(
      'SELECT job_type, status, COUNT(*) AS count FROM execution_jobs GROUP BY job_type, status',
    );
    res.status(200).json({
      api: { byModel: models },
      storage: { files: Number(storage?.files ?? 0), bytes: Number(storage?.bytes ?? 0) },
      compute: { byJobTypeAndStatus: jobs },
      externalProviderCosts: {
        available: false,
        reason: 'Provider invoices (hosting/database/search/CDN) are not in the platform database. Connect the provider billing API to include them — nothing is estimated.',
      },
    });
  });

  /** System health for the owner view (same real readiness checks as /api/ready). */
  router.get('/health', async (_req, res) => {
    const { readinessPayload } = await import('../server/health');
    const readiness = readinessPayload();
    res.status(200).json({
      status: readiness.status,
      uptimeSeconds: readiness.uptimeSeconds,
      checks: readiness.checks,
      node: process.version,
    });
  });

  /**
   * Recent platform audit trail (owner-visible subset). Read-only: audit rows
   * are append-only by construction elsewhere in the platform.
   */
  router.get('/audit', (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const rows = db.all(
      `SELECT id, actor_id, action, resource_type, resource_id, description, created_at
       FROM audit_logs ORDER BY rowid DESC LIMIT ?`,
      [limit],
    );
    res.status(200).json({ audit: rows, limit });
  });

  return router;
}
