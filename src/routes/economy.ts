import { Router } from 'express';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { requireRole } from '../server/middleware/rbac';
import { HttpError } from '../server/http';
import { appendAuditLog } from '../db';
import { getEconomyPolicy, listEconomyEvents, listExecutions, listOpportunities, getOpportunity, updateEconomyPolicy } from '../db/economy-repositories';
import { DISCOVERY_CATEGORIES, type RiskLevel } from '../economy/policy';
import { evaluateOpportunity as evaluate } from '../economy/operations';
import { runDiscovery, startExecution, runExecution, reconcileStaleExecutions, economyScheduler } from '../economy/operations';
import { buildDashboard, buildDailyReport } from '../economy/report';
import {
  completeSettlement,
  confirmResourceProvisioned,
  decideExpansion,
  expandCapability,
  listAgentProfiles,
  listExpansions,
  listImprovements,
  listLedger,
  listResources,
  listSettlements,
  listUpgrades,
  proposeImprovement,
  proposeSettlement,
  proposeUpgrade,
  applyUpgrade,
  rollbackUpgrade,
  recordImprovementSandboxResult,
  recordLedgerRevenue,
  requestResource,
  retireResource,
  treasurySummary,
} from '../economy/treasury';

/**
 * ZA141251SA private economy API — OWNER + SUPER_ADMIN ONLY.
 *
 * Every route behind requireRole('owner','super_admin'). Ordinary users and
 * staff admins receive 403 and the surface is invisible to them. This is the
 * ONLY HTTP exposure of the private economy; the public site never reads it.
 */
export function createEconomyRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireRole('owner', 'super_admin'));

  // ── Dashboard + reports (L) ─────────────────────────────────────────────
  router.get('/dashboard', (_req, res) => {
    res.status(200).json(buildDashboard());
  });

  router.get('/report/today', (_req, res) => {
    res.status(200).json(buildDailyReport());
  });

  router.get('/events', (req, res) => {
    const limit = clampInt(req.query.limit, 1, 500, 100);
    res.status(200).json({ events: listEconomyEvents(limit) });
  });

  // ── Policy + kill switch (O) ────────────────────────────────────────────
  router.get('/policy', (_req, res) => {
    res.status(200).json({ policy: getEconomyPolicy(), categories: DISCOVERY_CATEGORIES.map((c) => c.key) });
  });

  router.patch('/policy', (req: AuthenticatedRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, string | number> = {};
    const intFields: Array<[string, number, number]> = [
      ['max_concurrent_executions', 1, 10],
      ['max_daily_spend_cents', 0, 100_000],
      ['max_opportunity_cost_cents', 0, 100_000],
      ['min_expected_net_cents', 0, 1_000_000],
      ['settlement_threshold_cents', 0, 10_000_000],
      ['max_economy_agents', 1, 500],
    ];
    for (const [field, min, max] of intFields) {
      if (body[field] !== undefined) patch[field] = clampInt(body[field], min, max, min);
    }
    if (body.min_roi !== undefined) patch.min_roi = Math.min(100, Math.max(0, Number(body.min_roi) || 0));
    if (body.settlement_destination !== undefined) patch.settlement_destination = String(body.settlement_destination).slice(0, 200);
    if (body.economy_model_key !== undefined) patch.economy_model_key = String(body.economy_model_key ?? '').slice(0, 120);
    if (body.autonomous_enabled !== undefined) patch.autonomous_enabled = body.autonomous_enabled ? 1 : 0;
    if (body.discovery_enabled !== undefined) patch.discovery_enabled = body.discovery_enabled ? 1 : 0;
    if (Array.isArray(body.discovery_categories)) {
      const valid = new Set(DISCOVERY_CATEGORIES.map((c) => c.key));
      patch.discovery_categories_json = JSON.stringify(body.discovery_categories.filter((c): c is string => typeof c === 'string' && valid.has(c)));
    }
    const policy = updateEconomyPolicy(patch);
    appendAuditLog({
      actorId: req.auth!.userId,
      action: 'economy.policy.update',
      resourceType: 'economy_policy',
      description: 'ZA141251SA policy updated',
      metadata: patch,
    });
    res.status(200).json({ policy });
  });

  router.post('/kill-switch', (req: AuthenticatedRequest, res) => {
    const engage = req.body?.engage !== false;
    updateEconomyPolicy({ kill_switch: engage ? 1 : 0 });
    appendAuditLog({
      actorId: req.auth!.userId,
      action: engage ? 'economy.kill_switch.engaged' : 'economy.kill_switch.released',
      resourceType: 'economy_policy',
    });
    res.status(200).json({ killSwitch: engage });
  });

  router.post('/tick', async (_req, res) => {
    const result = await economyScheduler.tick();
    res.status(200).json(result);
  });

  // ── Opportunities (A/B/C) ───────────────────────────────────────────────
  router.get('/opportunities', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = clampInt(req.query.limit, 1, 200, 50);
    res.status(200).json({ opportunities: listOpportunities(status, limit) });
  });

  router.post('/opportunities/discover', async (req, res) => {
    const categories = Array.isArray(req.body?.categories)
      ? (req.body.categories as unknown[]).filter((c): c is string => typeof c === 'string')
      : undefined;
    const result = await runDiscovery(categories);
    res.status(200).json(result);
  });

  router.post('/opportunities/:id/evaluate', (req, res) => {
    res.status(200).json(evaluate(req.params.id));
  });

  router.post('/opportunities/:id/authorize', (req: AuthenticatedRequest, res) => {
    const opportunity = requireOpportunity(req.params.id);
    const agentSlug = typeof req.body?.agent_slug === 'string' && req.body.agent_slug.trim().length > 0
      ? req.body.agent_slug.trim()
      : 'web-research-001';
    const start = startExecution({ opportunityId: opportunity.id, agentSlug, authorizedBy: 'owner' });
    appendAuditLog({
      actorId: req.auth!.userId,
      action: 'economy.opportunity.authorize',
      resourceId: opportunity.id,
      description: `owner authorized execution for ${opportunity.id}`,
    });
    res.status(start.created ? 201 : 200).json(start);
  });

  router.post('/executions/:id/run', async (req, res) => {
    try {
      const outcome = await runExecution(req.params.id);
      res.status(200).json(outcome);
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error), 'execution_not_runnable');
    }
  });

  router.get('/executions', (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.status(200).json({ executions: listExecutions(status) });
  });

  router.post('/reconcile', (_req, res) => {
    res.status(200).json(reconcileStaleExecutions());
  });

  // ── Treasury + revenue + settlement (H/I/P) ─────────────────────────────
  router.get('/treasury', (_req, res) => {
    res.status(200).json(treasurySummary());
  });

  router.get('/ledger', (req, res) => {
    res.status(200).json({ ledger: listLedger(clampInt(req.query.limit, 1, 500, 100)) });
  });

  router.post('/revenue', (req: AuthenticatedRequest, res) => {
    const amount = clampInt(req.body?.amount_cents, 1, 1_000_000_000, 0);
    if (!amount) throw new HttpError(400, 'amount_cents must be a positive integer', 'validation_error');
    const evidence = typeof req.body?.evidence === 'string' ? req.body.evidence : '';
    if (evidence.trim().length < 4) throw new HttpError(400, 'evidence is required — revenue is never claimed without evidence', 'validation_error');
    try {
      const posted = recordLedgerRevenue({
        opportunityId: typeof req.body?.opportunity_id === 'string' ? req.body.opportunity_id : null,
        agentSlug: typeof req.body?.agent_slug === 'string' ? req.body.agent_slug : null,
        amountCents: amount,
        evidence,
        externalRef: typeof req.body?.external_ref === 'string' ? req.body.external_ref : null,
      });
      appendAuditLog({ actorId: req.auth!.userId, action: 'economy.revenue.recorded', metadata: { amountCents: amount } });
      res.status(201).json(posted);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), 'revenue_rejected');
    }
  });

  router.post('/settle', (_req, res) => {
    res.status(200).json(proposeSettlement());
  });

  router.post('/settlements/:id/complete', (req: AuthenticatedRequest, res) => {
    try {
      completeSettlement(req.params.id, typeof req.body?.evidence === 'string' ? req.body.evidence : '');
      appendAuditLog({ actorId: req.auth!.userId, action: 'economy.settlement.completed', resourceId: req.params.id });
      res.status(200).json({ completed: true });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), 'settlement_rejected');
    }
  });

  router.get('/settlements', (_req, res) => {
    res.status(200).json({ settlements: listSettlements() });
  });

  // ── Resources (E) ───────────────────────────────────────────────────────
  router.get('/resources', (_req, res) => {
    res.status(200).json({ resources: listResources() });
  });

  router.post('/resources', (req, res) => {
    const kind = String(req.body?.kind ?? '');
    const provider = String(req.body?.provider ?? '');
    const description = String(req.body?.description ?? '');
    if (!kind || !provider || !description) throw new HttpError(400, 'kind, provider and description are required', 'validation_error');
    const monthlyCost = clampInt(req.body?.monthly_cost_cents, 0, 1_000_000, 0);
    res.status(201).json(requestResource({
      kind, provider, description, monthlyCostCents: monthlyCost,
      requestedByAgent: typeof req.body?.requested_by_agent === 'string' ? req.body.requested_by_agent : null,
    }));
  });

  router.post('/resources/:id/provisioned', (req: AuthenticatedRequest, res) => {
    try {
      confirmResourceProvisioned(req.params.id, typeof req.body?.evidence === 'string' ? req.body.evidence : '', req.body?.actual_cost_cents !== undefined ? clampInt(req.body.actual_cost_cents, 0, 1_000_000, 0) : undefined);
      appendAuditLog({ actorId: req.auth!.userId, action: 'economy.resource.provisioned', resourceId: req.params.id });
      res.status(200).json({ provisioned: true });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), 'resource_rejected');
    }
  });

  router.post('/resources/:id/retire', (req: AuthenticatedRequest, res) => {
    retireResource(req.params.id);
    appendAuditLog({ actorId: req.auth!.userId, action: 'economy.resource.retired', resourceId: req.params.id });
    res.status(200).json({ retired: true });
  });

  // ── Self-upgrades (F) ───────────────────────────────────────────────────
  router.get('/upgrades', (_req, res) => {
    res.status(200).json({ upgrades: listUpgrades() });
  });

  router.post('/upgrades', (req, res) => {
    const target = String(req.body?.target ?? '');
    const currentValue = String(req.body?.current_value ?? '');
    const candidateValue = String(req.body?.candidate_value ?? '');
    if (!target || !currentValue || !candidateValue) throw new HttpError(400, 'target, current_value and candidate_value are required', 'validation_error');
    try {
      res.status(201).json(proposeUpgrade({
        target, currentValue, candidateValue,
        benchmark: isRecord(req.body?.benchmark) ? req.body.benchmark : null,
      }));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), 'upgrade_rejected');
    }
  });

  router.post('/upgrades/:id/apply', (req: AuthenticatedRequest, res) => {
    const result = applyUpgrade(req.params.id);
    appendAuditLog({ actorId: req.auth!.userId, action: 'economy.upgrade.apply', resourceId: req.params.id, metadata: result });
    res.status(200).json(result);
  });

  router.post('/upgrades/:id/rollback', (req: AuthenticatedRequest, res) => {
    const result = rollbackUpgrade(req.params.id);
    appendAuditLog({ actorId: req.auth!.userId, action: 'economy.upgrade.rollback', resourceId: req.params.id, metadata: result });
    res.status(200).json(result);
  });

  // ── Self-expansion (D) ──────────────────────────────────────────────────
  router.get('/expansions', (_req, res) => {
    res.status(200).json({ expansions: listExpansions() });
  });

  router.post('/expansions', (req, res) => {
    const gap = String(req.body?.gap ?? '');
    const specialization = String(req.body?.specialization ?? '');
    const systemInstructions = String(req.body?.system_instructions ?? '');
    if (!gap || !specialization || !systemInstructions) throw new HttpError(400, 'gap, specialization and system_instructions are required', 'validation_error');
    res.status(201).json(expandCapability({
      gap, specialization, systemInstructions,
      parentAgentSlug: typeof req.body?.parent_agent_slug === 'string' ? req.body.parent_agent_slug : null,
      name: typeof req.body?.name === 'string' ? req.body.name : undefined,
    }));
  });

  router.post('/expansions/:id/decide', (req: AuthenticatedRequest, res) => {
    const decision = req.body?.decision === 'approve' ? 'approve' : req.body?.decision === 'reject' ? 'reject' : null;
    if (!decision) throw new HttpError(400, "decision must be 'approve' or 'reject'", 'validation_error');
    decideExpansion(req.params.id, decision);
    appendAuditLog({ actorId: req.auth!.userId, action: 'economy.expansion.decide', resourceId: req.params.id, metadata: { decision } });
    res.status(200).json({ decided: decision });
  });

  router.get('/agents', (_req, res) => {
    res.status(200).json({ agents: listAgentProfiles() });
  });

  // ── AKBARAL! improvements (G) ───────────────────────────────────────────
  router.get('/improvements', (_req, res) => {
    res.status(200).json({ improvements: listImprovements() });
  });

  router.post('/improvements', (req, res) => {
    const area = String(req.body?.area ?? '');
    const title = String(req.body?.title ?? '');
    const proposal = String(req.body?.proposal ?? '');
    if (!area || !title || !proposal) throw new HttpError(400, 'area, title and proposal are required', 'validation_error');
    try {
      res.status(201).json(proposeImprovement({ area, title, proposal }));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), 'improvement_rejected');
    }
  });

  router.post('/improvements/:id/sandbox-result', (req, res) => {
    if (!isRecord(req.body?.result)) throw new HttpError(400, 'result object is required', 'validation_error');
    try {
      recordImprovementSandboxResult(req.params.id, req.body.result as Record<string, unknown>);
      res.status(200).json({ recorded: true });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), 'improvement_rejected');
    }
  });

  return router;
}

function requireOpportunity(id: string) {
  const opportunity = getOpportunity(id);
  if (!opportunity) throw new HttpError(404, 'opportunity not found', 'not_found');
  return opportunity;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { RiskLevel };
