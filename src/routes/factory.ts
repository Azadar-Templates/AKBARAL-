import { Router } from 'express';
import { agentFactory } from '../orchestrator/agent-factory';
import { findAgentBySlug } from '../db';
import { listCategories } from '../agents/registry';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';
import { getBody, optionalString, requireString } from '../server/middleware/validation';

export function createFactoryRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/categories', (_req, res) => {
    res.status(200).json({ categories: listCategories() });
  });

  router.post('/agents', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const name = requireString(body, 'name', 'name');
    const specialization = requireString(body, 'specialization', 'specialization');
    const description = requireString(body, 'description', 'description');
    const systemInstructions = requireString(body, 'system_instructions', 'system_instructions');
    const created = agentFactory.create({
      userId: req.auth!.userId,
      name,
      specialization,
      description,
      systemInstructions,
      slug: optionalString(body, 'slug') ?? undefined,
      capabilities: asStringArray(body.capabilities),
      inputs: asStringArray(body.inputs),
      outputs: asStringArray(body.outputs),
      modelRequirements: asStringArray(body.model_requirements),
      toolPermissions: asStringArray(body.tool_permissions),
      workflow: asStringArray(body.workflow),
      verificationRules: asStringArray(body.verification_rules),
      securityPermissions: asStringArray(body.security_permissions),
      priceCents: Number(body.price_cents ?? 0) || 0,
      categoryId: optionalString(body, 'category_id') ?? null,
      projectId: optionalString(body, 'project_id') ?? null,
    });
    res.status(201).json({ agent: created });
  });

  router.post('/agents/:slug/test', async (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const goal = requireString(body, 'goal', 'goal');
    const test = await agentFactory.test({ userId: req.auth!.userId, slug: req.params.slug, goal });
    res.status(200).json(test);
  });

  router.get('/agents/:slug/security', (req: AuthenticatedRequest, res) => {
    const agent = findAgentBySlug(req.params.slug);
    if (!agent) {
      throw new HttpError(404, 'agent not found', 'not_found');
    }
    res.status(200).json({ findings: agentFactory.securityReview(req.params.slug), slug: req.params.slug });
  });

  router.get('/agents/:slug/benchmark', (req: AuthenticatedRequest, res) => {
    const agent = findAgentBySlug(req.params.slug);
    if (!agent) {
      throw new HttpError(404, 'agent not found', 'not_found');
    }
    res.status(200).json({ benchmark: agentFactory.benchmark(req.params.slug), slug: req.params.slug });
  });

  router.get('/agents/:slug/versions', (req: AuthenticatedRequest, res) => {
    const agent = findAgentBySlug(req.params.slug);
    if (!agent) {
      throw new HttpError(404, 'agent not found', 'not_found');
    }
    res.status(200).json({ versions: agentFactory.listVersions(req.params.slug) });
  });

  router.post('/agents/:slug/version', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const version = agentFactory.version({
      userId: req.auth!.userId,
      slug: req.params.slug,
      changelog: optionalString(body, 'changelog') ?? undefined,
    });
    res.status(200).json({ version });
  });

  router.patch('/agents/:slug', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const config = {
      name: optionalString(body, 'name') ?? undefined,
      specialization: optionalString(body, 'specialization') ?? undefined,
      description: optionalString(body, 'description') ?? undefined,
      systemInstructions: optionalString(body, 'system_instructions') ?? undefined,
      capabilities: asStringArray(body.capabilities),
      inputs: asStringArray(body.inputs),
      outputs: asStringArray(body.outputs),
      modelRequirements: asStringArray(body.model_requirements),
      toolPermissions: asStringArray(body.tool_permissions),
      workflow: asStringArray(body.workflow),
      verificationRules: asStringArray(body.verification_rules),
      securityPermissions: asStringArray(body.security_permissions),
    };
    const updated = agentFactory.update({ userId: req.auth!.userId, slug: req.params.slug, config });
    res.status(200).json({ agent: updated });
  });

  router.post('/agents/:slug/status', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const status = requireString(body, 'status', 'status');
    const updated = agentFactory.setStatus({ userId: req.auth!.userId, slug: req.params.slug, status });
    res.status(200).json({ agent: updated });
  });

  router.post('/agents/:slug/rollback', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const version = requireString(body, 'version', 'version');
    const updated = agentFactory.rollback({ userId: req.auth!.userId, slug: req.params.slug, version });
    res.status(200).json({ agent: updated });
  });

  router.get('/audit', (req: AuthenticatedRequest, res) => {
    res.status(200).json({ logs: agentFactory.audit(req.auth!.userId) });
  });

  return router;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
