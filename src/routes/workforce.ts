import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../server/middleware/auth';
import { requireRole } from '../server/middleware/rbac';
import { HttpError } from '../server/http';
import { appendAuditLog } from '../db';
import { WORKFORCE_CATEGORIES } from '../workforce/categories';
import { listWorkforceAccounts, workforceAccountFor, workforceLedgerHistory, workforceTransfersFor, ensureWorkforceProfiles } from '../workforce/wallets';
import { integrationStatus, workforceReadiness } from '../workforce/integrations';
import { getComm, listComms, listDeliveries, listSourceHealth, listWorkflows, setSourceStatus, setWorkflowStatus } from '../workforce/repositories';
import { COMMS_TEMPLATES, confirmCommSent, decideComm, requestComm, sendApprovedComm, CommsError } from '../workforce/comms';
import { delegateWork, DelegationError } from '../workforce/delegation';
import { runWorkforceExecution } from '../workforce/execution';
import { pickWorkforceAgent, workforceDiscovery, workforceScheduler } from '../workforce/scheduler';
import { buildWorkforceReport } from '../workforce/report';

/**
 * WORKFORCE API — OWNER + SUPER_ADMIN ONLY.
 * The private 4,000+ agent earning workforce. Invisible to ordinary users;
 * the public site never reads it.
 */
export function createWorkforceRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireRole('owner', 'super_admin'));

  router.get('/report', (_req, res) => {
    res.status(200).json(buildWorkforceReport());
  });

  router.get('/categories', (_req, res) => {
    res.status(200).json({ categories: WORKFORCE_CATEGORIES });
  });

  // ── Wallets (per-agent internal ledger) ──
  router.get('/accounts', (req, res) => {
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const offset = clampInt(req.query.offset, 0, 100000, 0);
    const onlyWithActivity = req.query.activity === '1';
    res.status(200).json(listWorkforceAccounts({ limit, offset, onlyWithActivity }));
  });

  router.get('/accounts/:slug', (req, res) => {
    res.status(200).json({
      account: workforceAccountFor(req.params.slug),
      ledger: workforceLedgerHistory(req.params.slug, 100),
      transfers: workforceTransfersFor(req.params.slug),
    });
  });

  router.post('/wallets/ensure', (req: AuthenticatedRequest, res) => {
    const result = ensureWorkforceProfiles();
    appendAuditLog({ actorId: req.auth!.userId, action: 'workforce.wallets.ensure', description: `workforce coverage assured (${result.total} profiles)` });
    res.status(200).json(result);
  });

  // ── Integrations (honest provider matrix) ──
  router.get('/integrations', (_req, res) => {
    res.status(200).json({ integrations: integrationStatus(), readiness: workforceReadiness() });
  });

  // ── Discovery + execution ──
  router.post('/discover', async (req, res) => {
    const categories = Array.isArray(req.body?.categories)
      ? (req.body.categories as unknown[]).filter((c): c is string => typeof c === 'string')
      : undefined;
    res.status(200).json(await workforceDiscovery(categories));
  });

  router.post('/executions/:id/run', async (req, res) => {
    try {
      res.status(200).json(await runWorkforceExecution(req.params.id));
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error), 'execution_not_runnable');
    }
  });

  router.get('/match/:category', (req, res) => {
    res.status(200).json({ category: req.params.category, agentSlug: pickWorkforceAgent(req.params.category) });
  });

  router.post('/tick', async (_req, res) => {
    res.status(200).json(await workforceScheduler.tick());
  });

  router.get('/deliveries', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.status(200).json({
      deliveries: listDeliveries({
        executionId: q.executionId, opportunityId: q.opportunityId, agentSlug: q.agentSlug,
        limit: clampInt(q.limit, 1, 500, 100),
      }),
    });
  });

  // ── Risk protection: source health ──
  router.get('/sources', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.status(200).json({ sources: listSourceHealth(status) });
  });

  router.post('/sources/clear', (req: AuthenticatedRequest, res) => {
    const key = String(req.body?.source_key ?? '');
    if (!key) throw new HttpError(400, 'source_key is required', 'validation_error');
    setSourceStatus(key, 'active', null);
    appendAuditLog({ actorId: req.auth!.userId, action: 'workforce.source.cleared', resourceId: key });
    res.status(200).json({ cleared: key });
  });

  router.post('/sources/block', (req: AuthenticatedRequest, res) => {
    const key = String(req.body?.source_key ?? '');
    const status = String(req.body?.status ?? 'blocked');
    if (!key) throw new HttpError(400, 'source_key is required', 'validation_error');
    if (!['unavailable', 'restricted', 'unreliable', 'blocked'].includes(status)) {
      throw new HttpError(400, 'status must be unavailable|restricted|unreliable|blocked', 'validation_error');
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : 'blocked by owner';
    setSourceStatus(key, status as 'blocked', reason);
    appendAuditLog({ actorId: req.auth!.userId, action: 'workforce.source.blocked', resourceId: key, metadata: { status } });
    res.status(200).json({ blocked: key, status });
  });

  // ── Workflow health ──
  router.get('/workflows', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.status(200).json({ workflows: listWorkflows(status) });
  });

  router.post('/workflows/replace', (req: AuthenticatedRequest, res) => {
    const { agentSlug, category, workflowKey, replacedBy } = (req.body ?? {}) as Record<string, string>;
    if (!agentSlug || !category || !workflowKey) throw new HttpError(400, 'agentSlug, category and workflowKey are required', 'validation_error');
    setWorkflowStatus(agentSlug, category, workflowKey, 'replaced', typeof replacedBy === 'string' ? replacedBy : null);
    appendAuditLog({ actorId: req.auth!.userId, action: 'workforce.workflow.replaced', resourceId: `${agentSlug}/${category}/${workflowKey}` });
    res.status(200).json({ replaced: `${agentSlug}/${category}/${workflowKey}` });
  });

  router.post('/workflows/retire', (req: AuthenticatedRequest, res) => {
    const { agentSlug, category, workflowKey } = (req.body ?? {}) as Record<string, string>;
    if (!agentSlug || !category || !workflowKey) throw new HttpError(400, 'agentSlug, category and workflowKey are required', 'validation_error');
    setWorkflowStatus(agentSlug, category, workflowKey, 'retired', null);
    appendAuditLog({ actorId: req.auth!.userId, action: 'workforce.workflow.retired', resourceId: `${agentSlug}/${category}/${workflowKey}` });
    res.status(200).json({ retired: `${agentSlug}/${category}/${workflowKey}` });
  });

  router.post('/workflows/reactivate', (req: AuthenticatedRequest, res) => {
    const { agentSlug, category, workflowKey } = (req.body ?? {}) as Record<string, string>;
    if (!agentSlug || !category || !workflowKey) throw new HttpError(400, 'agentSlug, category and workflowKey are required', 'validation_error');
    setWorkflowStatus(agentSlug, category, workflowKey, 'active', null);
    appendAuditLog({ actorId: req.auth!.userId, action: 'workforce.workflow.reactivated', resourceId: `${agentSlug}/${category}/${workflowKey}` });
    res.status(200).json({ reactivated: `${agentSlug}/${category}/${workflowKey}` });
  });

  // ── Customer communications (approval-gated) ──
  router.get('/comms/templates', (_req, res) => {
    res.status(200).json({ templates: [...COMMS_TEMPLATES] });
  });

  router.get('/comms', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.status(200).json({ comms: listComms(status) });
  });

  router.get('/comms/:id', (req, res) => {
    const row = getComm(req.params.id);
    if (!row) throw new HttpError(404, 'communication request not found', 'not_found');
    res.status(200).json({ comm: row });
  });

  router.post('/comms', (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, string>;
      res.status(201).json({
        comm: requestComm({
          agentSlug: String(body.agentSlug ?? ''),
          channel: String(body.channel ?? ''),
          recipient: String(body.recipient ?? ''),
          template: String(body.template ?? ''),
          contentPreview: String(body.contentPreview ?? ''),
          consentBasis: String(body.consentBasis ?? ''),
          executionId: typeof body.executionId === 'string' ? body.executionId : null,
          opportunityId: typeof body.opportunityId === 'string' ? body.opportunityId : null,
        }),
      });
    } catch (error) {
      if (error instanceof CommsError) throw new HttpError(error.statusCode, error.message, error.code);
      throw error;
    }
  });

  router.post('/comms/:id/decide', (req: AuthenticatedRequest, res) => {
    try {
      const decision = req.body?.decision === 'approve' ? 'approve' : req.body?.decision === 'reject' ? 'reject' : null;
      if (!decision) throw new HttpError(400, "decision must be 'approve' or 'reject'", 'validation_error');
      res.status(200).json({ comm: decideComm(req.params.id, decision, req.auth!.userId) });
    } catch (error) {
      if (error instanceof CommsError) throw new HttpError(error.statusCode, error.message, error.code);
      throw error;
    }
  });

  router.post('/comms/:id/send', async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, string>;
      res.status(200).json({
        comm: await sendApprovedComm(req.params.id, {
          recipient: String(body.recipient ?? ''),
          body: String(body.body ?? ''),
          from: typeof body.from === 'string' ? body.from : undefined,
        }),
      });
    } catch (error) {
      if (error instanceof CommsError) throw new HttpError(error.statusCode, error.message, error.code);
      throw error;
    }
  });

  router.post('/comms/:id/confirm-sent', (req: AuthenticatedRequest, res) => {
    try {
      const providerRef = String(req.body?.providerRef ?? '');
      res.status(200).json({ comm: confirmCommSent(req.params.id, providerRef, req.auth!.userId) });
    } catch (error) {
      if (error instanceof CommsError) throw new HttpError(error.statusCode, error.message, error.code);
      throw error;
    }
  });

  // ── Delegation (sub-agents via the Factory) ──
  router.post('/delegate', (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.status(201).json(delegateWork({
        parentAgentSlug: String(body.parentAgentSlug ?? ''),
        gap: String(body.gap ?? ''),
        specialization: String(body.specialization ?? ''),
        systemInstructions: String(body.systemInstructions ?? ''),
        ...(Number.isFinite(Number(body.childBudgetCents)) ? { childBudgetCents: Math.max(0, Number(body.childBudgetCents)) } : {}),
        ...(Array.isArray(body.requestedTools) ? { requestedTools: (body.requestedTools as unknown[]).filter((t): t is string => typeof t === 'string') } : {}),
        ...(Array.isArray(body.categories) ? { categories: (body.categories as unknown[]).filter((t): t is string => typeof t === 'string') } : {}),
        ...(typeof body.executionId === 'string' ? { executionId: body.executionId } : {}),
        ...(typeof body.role === 'string' ? { role: body.role } : {}),
      }));
    } catch (error) {
      if (error instanceof DelegationError) throw new HttpError(error.statusCode, error.message, error.code);
      throw error;
    }
  });

  return router;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}
