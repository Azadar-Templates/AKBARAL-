import { Router, type ErrorRequestHandler } from 'express';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { requireRole } from '../server/middleware/rbac';
import { HttpError, asyncRoute } from '../server/http';
import { appendAuditLog } from '../db';
import { getEconomyPolicy, listEconomyEvents, listExecutions, listOpportunities, getOpportunity, updateEconomyPolicy, listMissionThreads,
  getAgentProfileBySlug, listCommands, setAgentQuotas,
} from '../db/economy-repositories';
import { MissionChatError, missionChatHistory, missionChatWithAgent, missionChatWithGroup } from '../economy/mission-chat';
import {
  CommandError, acknowledgeCommand, cancelCommand, commandStatus, completeCommand,
  linkCommandWork, sendCommand,
} from '../economy/commands';
import { agentWorkforceProfile, workforceOverview } from '../economy/agent-report';
import { getAgentBySlug } from '../agents/registry';
import { rateLimit } from '../server/middleware/rate-limit';
import { readinessPayload } from '../server/health';
import { getBody } from '../server/middleware/validation';

/** Map MissionChatError to the standard HttpError envelope (async-safe). */
function toHttpError(error: unknown): unknown {
  if (error instanceof MissionChatError) {
    return new HttpError(error.statusCode, error.message, error.code);
  }
  return error;
}
import { ALL_DISCOVERY_CATEGORY_KEYS, POLICY_INT_RANGES, sanitizeDiscoveryCategories, type RiskLevel } from '../economy/policy';
import {
  HierarchyControlError,
  agentQuotaStatus,
  delegationChain,
  hierarchyControls,
  hierarchyTree,
  listDelegations,
  pauseAgent,
  pauseAllAgents,
  pauseHierarchy,
  resumeAgent,
  resumeAllAgents,
  resumeHierarchy,
  setControl,
  subtreeSpend,
} from '../economy/hierarchy';
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
  agentAccounts,
  listTransfers,
  proposeTreasuryTransfer,
  decideTreasuryTransfer,
  TreasuryTransferError,
  EarningError,
  recordDeliveryPayment,
  listReinvestments,
  proposeReinvestment,
  decideReinvestment,
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
    const dashboard = buildDashboard();
    // System health (PART 5): the same real readiness checks /api/ready runs —
    // database, migrations, uploads, execution queue — plus uptime.
    const readiness = readinessPayload();
    res.status(200).json({
      ...dashboard,
      systemHealth: {
        status: readiness.status,
        uptimeSeconds: readiness.uptimeSeconds,
        checks: readiness.checks.map((check) => ({ name: check.name, ok: check.ok })),
      },
    });
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
    res.status(200).json({ policy: getEconomyPolicy(), categories: [...ALL_DISCOVERY_CATEGORY_KEYS] });
  });

  router.patch('/policy', (req: AuthenticatedRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, string | number> = {};
    // D9: ranges live in policy.ts (POLICY_INT_RANGES) so the API ceiling and
    // the documented scale move together; max_economy_agents now 1–10,000.
    for (const [field, min, max] of POLICY_INT_RANGES) {
      if (body[field] !== undefined) patch[field] = clampInt(body[field], min, max, min);
    }
    if (body.min_roi !== undefined) patch.min_roi = Math.min(100, Math.max(0, Number(body.min_roi) || 0));
    if (body.settlement_destination !== undefined) patch.settlement_destination = String(body.settlement_destination).slice(0, 200);
    if (body.economy_model_key !== undefined) patch.economy_model_key = String(body.economy_model_key ?? '').slice(0, 120);
    if (body.autonomous_enabled !== undefined) patch.autonomous_enabled = body.autonomous_enabled ? 1 : 0;
    if (body.discovery_enabled !== undefined) patch.discovery_enabled = body.discovery_enabled ? 1 : 0;
    if (Array.isArray(body.discovery_categories)) {
      // D4: validate against the full union (legacy + all 21 workforce keys).
      patch.discovery_categories_json = JSON.stringify(sanitizeDiscoveryCategories(body.discovery_categories));
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
    const body = getBody(req);
    const actor = typeof body?.actor === 'string' && body.actor ? (body.actor as string) : 'owner';
    if (actor !== 'owner' && !getAgentBySlug(actor)) {
      throw new HttpError(400, `actor must be "owner" or a registry agent slug (got "${actor}")`, 'invalid_request');
    }
    const result = applyUpgrade(req.params.id, actor);
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

  router.post('/expansions', (req: AuthenticatedRequest, res) => {
    const gap = String(req.body?.gap ?? '');
    const specialization = String(req.body?.specialization ?? '');
    const systemInstructions = String(req.body?.system_instructions ?? '');
    if (!gap || !specialization || !systemInstructions) throw new HttpError(400, 'gap, specialization and system_instructions are required', 'validation_error');
    res.status(201).json(expandCapability({
      gap, specialization, systemInstructions,
      parentAgentSlug: typeof req.body?.parent_agent_slug === 'string' ? req.body.parent_agent_slug : null,
      name: typeof req.body?.name === 'string' ? req.body.name : undefined,
      actor: req.auth?.userId ? `owner:${req.auth.userId}` : 'owner',
      ...(Number.isFinite(Number(req.body?.child_budget_cents)) ? { childBudgetCents: Math.max(0, Number(req.body.child_budget_cents)) } : {}),
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

  // ── Owner ↔ agent mission chat (Section 5; owner-only via the router guard) ──
  router.get('/chat/threads', (req: AuthenticatedRequest, res) => {
    res.status(200).json({ threads: listMissionThreads(req.auth!.userId) });
  });

  router.get('/agents/:slug/chat', (req: AuthenticatedRequest, res) => {
    res.status(200).json(missionChatHistory(req.auth!.userId, req.params.slug));
  });

  router.post(
    '/agents/:slug/chat',
    rateLimit({ prefix: 'mission-chat', max: 30, windowMs: 60_000 }),
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      try {
        const result = await missionChatWithAgent({ ownerUserId: req.auth!.userId, agentSlug: req.params.slug, content });
        res.status(200).json(result);
      } catch (error) {
        throw toHttpError(error);
      }
    }),
  );

  // ── Treasury transfers + agent accounts (PART 8 / PART 10) ───────────────
  router.get('/accounts', (_req, res) => {
    res.status(200).json({ accounts: agentAccounts() });
  });

  router.get('/transfers', (_req, res) => {
    res.status(200).json({ transfers: listTransfers() });
  });

  router.post('/transfers', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    try {
      const result = proposeTreasuryTransfer({
        sourceAgentSlug: String(body?.source_agent_slug ?? ''),
        amountCents: Number(body?.amount_cents ?? 0),
        reason: String(body?.reason ?? ''),
        idempotencyKey: String(body?.idempotency_key ?? ''),
        proposedBy: req.auth!.userId,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof TreasuryTransferError) {
        throw new HttpError(error.statusCode, error.message, error.code);
      }
      throw error;
    }
  });

  router.post('/transfers/:id/approve', (req: AuthenticatedRequest, res) => {
    try {
      const transfer = decideTreasuryTransfer(req.params.id, 'approve', req.auth!.userId);
      res.status(200).json({ transfer });
    } catch (error) {
      if (error instanceof TreasuryTransferError) {
        throw new HttpError(error.statusCode, error.message, error.code);
      }
      throw error;
    }
  });

  router.post('/transfers/:id/reject', (req: AuthenticatedRequest, res) => {
    try {
      const transfer = decideTreasuryTransfer(req.params.id, 'reject', req.auth!.userId);
      res.status(200).json({ transfer });
    } catch (error) {
      if (error instanceof TreasuryTransferError) {
        throw new HttpError(error.statusCode, error.message, error.code);
      }
      throw error;
    }
  });

  // ── Owner ↔ agent group chat (PART 6: approved agent groups) ────────────
  router.post(
    '/chat/group',
    rateLimit({ prefix: 'mission-chat-group', max: 10, windowMs: 60_000 }),
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const agents = Array.isArray(body?.agents)
        ? (body.agents as unknown[]).filter((a): a is string => typeof a === 'string')
        : [];
      const content = typeof body?.content === 'string' ? body.content : '';
      try {
        const result = await missionChatWithGroup({ ownerUserId: req.auth!.userId, agentSlugs: agents, content });
        res.status(200).json(result);
      } catch (error) {
        if (error instanceof MissionChatError) {
          throw new HttpError(error.statusCode, error.message, error.code);
        }
        throw error;
      }
    }),
  );

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

  // ── Hierarchy, delegation and emergency controls (Section 2 / 3 / 14) ────
  //
  // The hierarchy is the delegation record: which agent created which, under
  // which gates, and who was accountable. The controls are the narrow brakes an
  // operator needs during an incident — each one is audited with the actor.

  router.get('/hierarchy', (req, res) => {
    const root = typeof req.query.root === 'string' && req.query.root ? req.query.root : null;
    res.status(200).json({ ...hierarchyTree(root), controls: hierarchyControls() });
  });

  router.get('/hierarchy/delegations', (req, res) => {
    const parent = typeof req.query.parent === 'string' && req.query.parent ? req.query.parent : undefined;
    const child = typeof req.query.child === 'string' && req.query.child ? req.query.child : undefined;
    const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 100;
    res.status(200).json({ delegations: listDelegations({ parentAgentSlug: parent, childAgentSlug: child, limit }) });
  });

  router.get('/hierarchy/:slug', (req, res) => {
    const slug = req.params.slug;
    const profile = getAgentProfileBySlug(slug);
    if (!profile) throw new HttpError(404, `agent ${slug} is not an economy agent`, 'not_found');
    res.status(200).json({
      agent: profile,
      chain: delegationChain(slug),
      subtree: hierarchyTree(slug),
      subtreeSpendCents: subtreeSpend(slug),
      delegations: listDelegations({ parentAgentSlug: slug, limit: 50 }),
    });
  });

  router.post('/hierarchy/:slug/pause', (req: AuthenticatedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'operator pause';
    res.status(200).json(pauseAgent({ agentSlug: req.params.slug, reason, actor: `owner:${req.auth!.userId}` }));
  });

  router.post('/hierarchy/:slug/resume', (req: AuthenticatedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'operator resume';
    res.status(200).json(resumeAgent({ agentSlug: req.params.slug, reason, actor: `owner:${req.auth!.userId}` }));
  });

  router.post('/hierarchy/:slug/pause-tree', (req: AuthenticatedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'operator pause';
    const result = pauseHierarchy({ rootAgentSlug: req.params.slug, reason, actor: `owner:${req.auth!.userId}` });
    res.status(200).json({ ...result, pausedCount: result.paused.length });
  });

  router.post('/hierarchy/:slug/resume-tree', (req: AuthenticatedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'operator resume';
    const result = resumeHierarchy({ rootAgentSlug: req.params.slug, reason, actor: `owner:${req.auth!.userId}` });
    res.status(200).json({ ...result, resumedCount: result.resumed.length });
  });

  router.post('/controls/pause-all', (req: AuthenticatedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'operator pause-all';
    res.status(200).json(pauseAllAgents({ reason, actor: `owner:${req.auth!.userId}` }));
  });

  router.post('/controls/resume-all', (req: AuthenticatedRequest, res) => {
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'operator resume-all';
    res.status(200).json(resumeAllAgents({ reason, actor: `owner:${req.auth!.userId}` }));
  });

  router.post('/controls/:kind', (req: AuthenticatedRequest, res) => {
    const kind = req.params.kind;
    if (kind !== 'spending' && kind !== 'withdrawals' && kind !== 'provider_access') {
      throw new HttpError(400, "kind must be 'spending', 'withdrawals' or 'provider_access'", 'validation_error');
    }
    if (typeof req.body?.frozen !== 'boolean') throw new HttpError(400, 'frozen (boolean) is required', 'validation_error');
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : 'operator control';
    res.status(200).json(setControl({ kind, frozen: req.body.frozen, reason, actor: `owner:${req.auth!.userId}` }));
  });

  router.get('/controls', (_req, res) => {
    res.status(200).json({ controls: hierarchyControls() });
  });

  // ── Delivery payments (verified delivery → realized revenue, exactly once)
  router.post('/delivery-payments', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const payment = recordDeliveryPayment({
      deliveryId: String(body?.delivery_id ?? ''),
      amountCents: clampInt(body?.amount_cents, 1, 1_000_000_000, 0),
      evidence: String(body?.evidence ?? ''),
      externalRef: typeof body?.external_ref === 'string' ? (body.external_ref as string) : undefined,
      recordedBy: req.auth!.userId,
    });
    appendAuditLog({ actorId: req.auth!.userId, action: 'economy.delivery.payment', resourceId: payment.revenueId });
    res.status(201).json(payment);
  });

  // ── Reinvestment (propose → owner decision → executed debit)
  router.get('/reinvestments', (req, res) => {
    res.status(200).json({ reinvestments: listReinvestments(clampInt(req.query.limit, 1, 500, 100)) });
  });

  router.post('/reinvestments', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const result = proposeReinvestment({
      agentSlug: String(body?.agent_slug ?? ''),
      amountCents: clampInt(body?.amount_cents, 1, 1_000_000_000, 0),
      purpose: String(body?.purpose ?? ''),
      idempotencyKey: String(body?.idempotency_key ?? ''),
      proposedBy: req.auth!.userId,
    });
    appendAuditLog({ actorId: req.auth!.userId, action: 'economy.reinvestment.propose', resourceId: result.reinvestment.id });
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  });

  router.post('/reinvestments/:id/approve', (req: AuthenticatedRequest, res) => {
    const decided = decideReinvestment(req.params.id, 'approve', req.auth!.userId);
    appendAuditLog({ actorId: req.auth!.userId, action: 'economy.reinvestment.approve', resourceId: req.params.id });
    res.status(200).json({ reinvestment: decided });
  });

  router.post('/reinvestments/:id/reject', (req: AuthenticatedRequest, res) => {
    const decided = decideReinvestment(req.params.id, 'reject', req.auth!.userId);
    appendAuditLog({ actorId: req.auth!.userId, action: 'economy.reinvestment.reject', resourceId: req.params.id });
    res.status(200).json({ reinvestment: decided });
  });

  // ── Owner → agent commands (issue → acknowledge → link → complete → verify)
  router.post('/commands', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const result = sendCommand({
      ownerUserId: req.auth!.userId,
      agentSlug: String(body?.agent_slug ?? ''),
      instruction: String(body?.instruction ?? ''),
      idempotencyKey: String(body?.idempotency_key ?? ''),
    });
    appendAuditLog({ actorId: req.auth!.userId, action: 'economy.command.issue', resourceId: result.command.id });
    res.status(result.duplicate ? 200 : 201).json(result);
  });

  router.get('/commands', (req, res) => {
    const q = req.query as Record<string, unknown>;
    res.status(200).json({
      commands: listCommands({
        agentSlug: typeof q.agent_slug === 'string' ? q.agent_slug : undefined,
        status: typeof q.status === 'string' ? q.status : undefined,
        limit: clampInt(q.limit, 1, 500, 100),
      }),
    });
  });

  router.get('/commands/:id', (req, res) => {
    res.status(200).json(commandStatus(req.params.id));
  });

  router.post('/commands/:id/acknowledge', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const actor = typeof body?.actor === 'string' && body.actor ? (body.actor as string) : req.auth!.userId;
    res.status(200).json({ command: acknowledgeCommand(req.params.id, actor) });
  });

  router.post('/commands/:id/link', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    res.status(200).json({
      command: linkCommandWork({
        id: req.params.id,
        opportunityId: String(body?.opportunity_id ?? ''),
        executionId: String(body?.execution_id ?? ''),
        actor: req.auth!.userId,
      }),
    });
  });

  router.post('/commands/:id/complete', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    res.status(200).json({
      command: completeCommand({
        id: req.params.id,
        actor: req.auth!.userId,
        resultSummary: String(body?.result_summary ?? ''),
        deliveryId: typeof body?.delivery_id === 'string' ? (body.delivery_id as string) : null,
        failed: body?.failed === true,
        failureReason: typeof body?.failure_reason === 'string' ? (body.failure_reason as string) : undefined,
      }),
    });
  });

  router.post('/commands/:id/cancel', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    res.status(200).json({ command: cancelCommand(req.params.id, String(body?.reason ?? ''), req.auth!.userId) });
  });

  // ── Per-agent workforce profile + quotas + fleet overview
  router.get('/agents/:slug/report', (req, res) => {
    try {
      res.status(200).json({ report: agentWorkforceProfile(req.params.slug) });
    } catch (error) {
      if (error instanceof Error && /does not exist in the registry/.test(error.message)) {
        throw new HttpError(404, error.message, 'agent_not_found');
      }
      throw error;
    }
  });

  router.get('/agents/:slug/quotas', (req, res) => {
    if (!getAgentBySlug(req.params.slug)) throw new HttpError(404, `agent "${req.params.slug}" does not exist in the registry`, 'agent_not_found');
    res.status(200).json({ quotas: agentQuotaStatus(req.params.slug) });
  });

  router.put('/agents/:slug/quotas', (req: AuthenticatedRequest, res) => {
    if (!getAgentBySlug(req.params.slug)) throw new HttpError(404, `agent "${req.params.slug}" does not exist in the registry`, 'agent_not_found');
    const body = getBody(req);
    const numOrNull = (value: unknown): number | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, 'quotas must be non-negative integers or null', 'invalid_request');
      return parsed;
    };
    try {
      setAgentQuotas(req.params.slug, {
        dailySpendQuotaCents: numOrNull(body?.daily_spend_quota_cents),
        monthlySpendQuotaCents: numOrNull(body?.monthly_spend_quota_cents),
      });
    } catch (error) {
      if (error instanceof Error && /does not exist/.test(error.message)) {
        throw new HttpError(404, error.message, 'profile_not_found');
      }
      throw error;
    }
    appendAuditLog({ actorId: req.auth!.userId, action: 'economy.agent.quotas', resourceId: req.params.slug });
    res.status(200).json({ quotas: agentQuotaStatus(req.params.slug) });
  });

  router.get('/workforce-overview', (_req, res) => {
    res.status(200).json({ overview: workforceOverview() });
  });

  // Domain refusals carry their own status and code — a frozen control or a
  // refused transfer must answer 4xx with a machine-readable reason, never a
  // generic 500. Anything that is not a known domain error continues to the
  // application error handler unchanged.
  router.use(((error: unknown, _req, res, next) => {
    const domain = error instanceof HierarchyControlError
      ? { statusCode: error.statusCode, code: error.code, message: error.message }
      : error instanceof TreasuryTransferError
        ? { statusCode: error.statusCode, code: error.code, message: error.message }
        : error instanceof CommandError
          ? { statusCode: error.statusCode, code: error.code, message: error.message }
          : error instanceof EarningError
            ? { statusCode: error.statusCode, code: error.code, message: error.message }
            : null;
    if (!domain) {
      next(error);
      return;
    }
    res.status(domain.statusCode).json({ error: { code: domain.code, message: domain.message } });
  }) as ErrorRequestHandler);

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
