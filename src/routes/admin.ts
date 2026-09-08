import { Router } from 'express';
import { db, listModels, listEnabledProviders, setFeatureFlag, listFeatureFlags, logAdminAction, feedbackStats } from '../db';
import { billingService } from '../billing/service';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { requireRole } from '../server/middleware/rbac';
import { HttpError } from '../server/http';
import { getBody, requireString } from '../server/middleware/validation';
import { discoverAgents, countAgentRegistry } from '../agents/registry';
import { getConfigStatus } from '../config/credentials';

export function createAdminRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireRole('admin', 'super_admin'));

  router.get('/stats', (_req: AuthenticatedRequest, res) => {
    const stats = {
      users: db.get<{ count: number }>('SELECT COUNT(*) AS count FROM users')?.count ?? 0,
      tasks: db.get<{ count: number }>('SELECT COUNT(*) AS count FROM tasks')?.count ?? 0,
      workflows: db.get<{ count: number }>('SELECT COUNT(*) AS count FROM workflows')?.count ?? 0,
      agents: countAgentRegistry(),
      models: db.get<{ count: number }>('SELECT COUNT(*) AS count FROM models')?.count ?? 0,
      modelRuns: db.get<{ count: number }>('SELECT COUNT(*) AS count FROM model_runs')?.count ?? 0,
      creditsGranted: db.get<{ sum: number }>('SELECT COALESCE(SUM(amount), 0) AS sum FROM credit_transactions WHERE amount > 0')?.sum ?? 0,
      creditsConsumed: db.get<{ sum: number }>('SELECT COALESCE(SUM(amount), 0) AS sum FROM credit_transactions WHERE amount < 0')?.sum ?? 0,
      revenuePaidCents: db.get<{ sum: number }>('SELECT COALESCE(SUM(total_cents), 0) AS sum FROM invoices WHERE status = \'paid\'')?.sum ?? 0,
      activeSubscriptions: db.get<{ count: number }>('SELECT COUNT(*) AS count FROM subscriptions WHERE status IN (\'trialing\',\'active\')')?.count ?? 0,
      failedTasks: db.get<{ count: number }>('SELECT COUNT(*) AS count FROM tasks WHERE status = \'failed\'')?.count ?? 0,
      securityEvents: db.get<{ count: number }>('SELECT COUNT(*) AS count FROM security_logs')?.count ?? 0,
      ...feedbackStats(),
    };
    res.status(200).json({ stats });
  });

  router.get('/analytics', (_req: AuthenticatedRequest, res) => {
    const revenueCents = db.get<{ sum: number }>('SELECT COALESCE(SUM(total_cents), 0) AS sum FROM invoices WHERE status = \'paid\'')?.sum ?? 0;
    const costCents = db.get<{ sum: number }>('SELECT COALESCE(SUM(cost_cents), 0) AS sum FROM model_runs WHERE status = \'succeeded\'')?.sum ?? 0;
    const completedTasks = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM tasks WHERE status = \'completed\'')?.count ?? 0;
    const costPerTask = completedTasks > 0 ? costCents / completedTasks : 0;
    const grossMarginCents = revenueCents - costCents;
    const grossMarginPct = revenueCents > 0 ? Math.round((grossMarginCents / revenueCents) * 10000) / 100 : 0;
    res.status(200).json({ revenueCents, costCents, grossMarginCents, grossMarginPct, costPerTask, completedTasks });
  });

  router.get('/agents', (req: AuthenticatedRequest, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const result = discoverAgents({ query, category, status, limit: 100, offset: 0 });
    res.status(200).json(result);
  });

  router.post('/agents/:slug/status', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const status = requireString(body, 'status', 'status');
    if (!['active', 'disabled', 'deprecated'].includes(status)) {
      throw new HttpError(400, 'invalid status', 'validation_error');
    }
    const row = db.get<{ id: string }>('SELECT id FROM agents WHERE slug = ?', [req.params.slug]);
    if (!row) {
      throw new HttpError(404, 'agent not found', 'not_found');
    }
    db.run('UPDATE agents SET status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', [status, row.id]);
    logAdminAction({ actorUserId: req.auth!.userId, action: 'agent.status.changed', targetType: 'agent', targetId: row.id, payload: { status } });
    res.status(200).json({ id: row.id, status });
  });

  router.get('/models', (_req, res) => {
    res.status(200).json({
      models: listModels().map(safeModelView),
      providers: listEnabledProviders().map(safeProviderView),
    });
  });

  /**
   * Admin-only production configuration status.
   *
   * Returns configured booleans and required env var NAMES only. It never
   * returns a credential value, a bearer token, a database URL with a password
   * or any other secret.
   */
  router.get('/config/status', (_req: AuthenticatedRequest, res) => {
    res.status(200).json(getConfigStatus());
  });

  router.post('/models/:key/status', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const status = requireString(body, 'status', 'status');
    const row = db.get<{ id: string }>('SELECT id FROM models WHERE key = ?', [req.params.key]);
    if (!row) {
      throw new HttpError(404, 'model not found', 'not_found');
    }
    db.run('UPDATE models SET status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', [status, row.id]);
    logAdminAction({ actorUserId: req.auth!.userId, action: 'model.status.changed', targetType: 'model', targetId: row.id, payload: { status } });
    res.status(200).json({ id: row.id, status });
  });

  router.get('/feature-flags', (_req, res) => {
    res.status(200).json({ flags: listFeatureFlags() });
  });

  router.post('/feature-flags', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const key = requireString(body, 'key', 'key');
    setFeatureFlag({
      key,
      value: typeof body.value === 'string' ? body.value : null,
      description: typeof body.description === 'string' ? body.description : null,
      enabled: Boolean(body.enabled),
    });
    res.status(200).json({ key, enabled: Boolean(body.enabled) });
  });

  router.post('/settle-payment', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const userId = requireString(body, 'user_id', 'user_id');
    const invoiceId = requireString(body, 'invoice_id', 'invoice_id');
    const amountCents = Number(body.amount_cents ?? 0);
    const credits = Number(body.credits ?? 0);
    if (!amountCents || !credits) {
      throw new HttpError(400, 'amount_cents and credits are required', 'validation_error');
    }
    const settled = billingService.settleManualPayment({ userId, invoiceId, amountCents, credits, reference: body.reference ? String(body.reference) : undefined });
    logAdminAction({ actorUserId: req.auth!.userId, action: 'payment.settled', targetType: 'invoice', targetId: invoiceId, payload: { userId, credits } });
    res.status(200).json({ settled });
  });

  router.post('/emergency-stop', (req: AuthenticatedRequest, res) => {
    setFeatureFlag({ key: 'emergency_stop', value: 'true', description: 'Global execution emergency stop', enabled: true });
    logAdminAction({ actorUserId: req.auth!.userId, action: 'system.emergency_stop' });
    res.status(200).json({ emergencyStop: true });
  });

  router.post('/system/resume', (req: AuthenticatedRequest, res) => {
    setFeatureFlag({ key: 'emergency_stop', value: 'false', description: 'Global execution emergency stop', enabled: false });
    logAdminAction({ actorUserId: req.auth!.userId, action: 'system.emergency_stop_cleared' });
    res.status(200).json({ emergencyStop: false });
  });

  return router;
}

function safeModelView(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    providerKey: row.provider_key,
    capability: row.capability,
    modality: row.modality,
    contextTokens: row.context_tokens,
    maxOutputTokens: row.max_output_tokens,
    costInputPerMillionCents: row.cost_input_per_million_cents,
    costOutputPerMillionCents: row.cost_output_per_million_cents,
    costPerImageCents: row.cost_per_image_cents,
    latencyMs: row.latency_ms,
    reliability: row.reliability,
    strengths: safeStringArray(row.strengths),
    weaknesses: safeStringArray(row.weaknesses),
    status: row.status,
    isDefault: row.is_default,
  };
}

function safeProviderView(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    docsUrl: row.docs_url,
    // The env var NAME is exposed so an operator knows what to configure; the
    // value is intentionally never read into this response.
    requiredEnvVar: row.env_key,
    capabilities: safeStringArray(row.capabilities),
    status: row.status,
  };
}

function safeStringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
