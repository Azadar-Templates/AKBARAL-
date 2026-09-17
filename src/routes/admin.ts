import { Router } from 'express';
import { db, listModels, listEnabledProviders, setFeatureFlag, listFeatureFlags, logAdminAction, feedbackStats, searchAdminActions } from '../db';
import { billingService } from '../billing/service';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { requireRole } from '../server/middleware/rbac';
import { HttpError } from '../server/http';
import { getBody, requireString } from '../server/middleware/validation';
import { discoverAgents, countAgentRegistry } from '../agents/registry';
import { executionQueue } from '../orchestrator/queue';
import { agentDefinitionCount } from '../agents/catalog';
import { getConfigStatus } from '../config/credentials';
import { PROVIDER_SPECS } from '../models/catalog';
import { externalHttpRequest } from '../integrations/http';
import { asyncRoute } from '../server/http';

/**
 * Lightweight registry integrity summary for admin monitoring: DB count vs
 * generated catalog count, duplicate slug/specialization detection and
 * category coverage. The full contract-diversity audit remains
 * `npm run audit:registry`.
 */
function registryIntegrity(): { dbAgents: number; catalogAgents: number; complete: boolean; duplicateSlugs: number; categoriesWithAgents: number } {
  const dbAgents = countAgentRegistry();
  const catalogAgents = agentDefinitionCount();
  const duplicateSlugs = db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM (SELECT slug FROM agents GROUP BY slug HAVING COUNT(*) > 1)',
  )?.count ?? 0;
  const categoriesWithAgents = db.get<{ count: number }>(
    'SELECT COUNT(DISTINCT category_id) AS count FROM agents WHERE category_id IS NOT NULL',
  )?.count ?? 0;
  return { dbAgents, catalogAgents, complete: dbAgents >= catalogAgents, duplicateSlugs, categoriesWithAgents };
}

export function createAdminRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireRole('admin', 'super_admin'));

  router.get('/audit', (req: AuthenticatedRequest, res) => {
    // Audit log search (Milestone 9): filter by actor, action prefix and an
    // optional time range; bounded pagination, newest first.
    const actor = typeof req.query.actor === 'string' && req.query.actor.trim() ? req.query.actor.trim() : undefined;
    const action = typeof req.query.action === 'string' && req.query.action.trim() ? req.query.action.trim() : undefined;
    const from = typeof req.query.from === 'string' && req.query.from.trim() ? req.query.from.trim() : undefined;
    const to = typeof req.query.to === 'string' && req.query.to.trim() ? req.query.to.trim() : undefined;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const result = searchAdminActions({
      actorUserId: actor,
      actionPrefix: action,
      from,
      to,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    res.status(200).json(result);
  });

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
      registryIntegrity: registryIntegrity(),
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
    // Feature flag changes are privileged platform changes — audit them.
    logAdminAction({
      actorUserId: req.auth!.userId,
      action: 'feature_flag.updated',
      targetType: 'feature_flag',
      targetId: key,
      payload: { enabled: Boolean(body.enabled) },
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

  // --- Execution queue observability + admin cancellation (Milestone 3) ----
  // Provider health (Milestone 4): DB-derived run statistics per model
  // provider — total/succeeded/failed runs, average latency, last error and
  // last usage — plus credential presence. `?live=1` additionally performs a
  // real, cheap models-list request against each configured provider with a
  // short timeout; unconfigured providers are reported honestly as such.
  // Billing overview (Milestone 8): revenue, provider costs, gross margin,
  // credit flows, subscription state, trial conversion and marketplace
  // commission — aggregated from real records only.
  router.get('/billing/overview', (_req: AuthenticatedRequest, res) => {
    res.status(200).json({ overview: billingService.adminBillingOverview() });
  });

  router.get('/providers/health', asyncRoute(async (req: AuthenticatedRequest, res) => {
    const live = req.query.live === '1' || req.query.live === 'true';
    const providers = listEnabledProviders() as Array<Record<string, unknown>>;
    const rows = PROVIDER_SPECS.map((spec) => {
      const row = providers.find((candidate) => String(candidate.key) === spec.key);
      const stats = db.get<{ total: number; succeeded: number; failed: number; avgLatencyMs: number | null; lastUsedAt: string | null }>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                AVG(latency_ms) AS avgLatencyMs,
                MAX(created_at) AS lastUsedAt
         FROM model_runs WHERE provider_key = ?`,
        [spec.key],
      );
      const lastError = db.get<{ error_message: string | null; created_at: string }>(
        `SELECT error_message, created_at FROM model_runs
         WHERE provider_key = ? AND status = 'failed' AND error_message IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [spec.key],
      );
      return {
        key: spec.key,
        name: spec.name,
        envKey: spec.envKey,
        configured: Boolean(process.env[spec.envKey]),
        status: row ? String(row.status) : 'enabled',
        runs: {
          total: stats?.total ?? 0,
          succeeded: stats?.succeeded ?? 0,
          failed: stats?.failed ?? 0,
          avgLatencyMs: stats?.avgLatencyMs !== null && stats?.avgLatencyMs !== undefined ? Math.round(Number(stats.avgLatencyMs)) : null,
          lastUsedAt: stats?.lastUsedAt ?? null,
          lastError: lastError ? { message: lastError.error_message, at: lastError.created_at } : null,
        },
        live: null as null | { ok: boolean; latencyMs: number; detail?: string },
      };
    });

    if (live) {
      await Promise.all(
        PROVIDER_SPECS.map(async (spec) => {
          const target = rows.find((row) => row.key === spec.key);
          if (!target) {
            return;
          }
          if (!target.configured) {
            target.live = { ok: false, latencyMs: 0, detail: `not configured: set ${spec.envKey}` };
            return;
          }
          const started = Date.now();
          try {
            const apiKey = process.env[spec.envKey] ?? '';
            let url: string;
            const override = process.env[`${spec.key.toUpperCase()}_BASE_URL`];
            const base = ((override && override.trim()) || (spec.baseUrl ?? '')).replace(/\/+$/, '');
            if (spec.key === 'anthropic') {
              url = `${base}/models`;
            } else if (spec.key === 'google') {
              url = `${base}/models?key=${apiKey}`;
            } else {
              url = `${base}/models`;
            }
            await externalHttpRequest(spec.key, url, {
              method: 'GET',
              headers: spec.key === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${apiKey}` },
              timeoutMs: 8_000,
            });
            target.live = { ok: true, latencyMs: Date.now() - started };
          } catch (error) {
            target.live = {
              ok: false,
              latencyMs: Date.now() - started,
              detail: error instanceof Error ? error.message : 'live check failed',
            };
          }
        }),
      );
    }

    res.status(200).json({ providers: rows, liveChecked: live });
  }));

  router.get('/queue/jobs', (req: AuthenticatedRequest, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const result = executionQueue.listJobs({ status, limit, offset });
    res.status(200).json({
      jobs: result.jobs,
      total: result.total,
      stats: executionQueue.stats(),
    });
  });

  router.post('/queue/cancel-all', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'admin bulk cancellation';
    const result = executionQueue.adminCancelAll(req.auth!.userId, reason);
    logAdminAction({
      actorUserId: req.auth!.userId,
      action: 'queue.cancel_all',
      targetType: 'execution_queue',
      payload: { cancelled: result.cancelled, reason },
    });
    res.status(200).json(result);
  });

  router.post('/tasks/:id/cancel', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'cancelled by admin';
    const result = executionQueue.cancelTask(req.params.id, req.auth!.userId, reason);
    if (!result.cancelled) {
      throw new HttpError(409, 'task cannot be cancelled (already terminal)', 'conflict');
    }
    logAdminAction({
      actorUserId: req.auth!.userId,
      action: 'task.admin_cancel',
      targetType: 'task',
      targetId: req.params.id,
      payload: { reason },
    });
    res.status(200).json({ task: { id: req.params.id, status: 'cancelled' }, jobId: result.jobId ?? null });
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
