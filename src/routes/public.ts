import { Router } from 'express';
import { discoverAgents, getAgentBySlug, listCategories, countAgentRegistry } from '../agents/registry';
import { asyncRoute, HttpError } from '../server/http';

/**
 * Public catalog — powers the public /agents directory.
 *
 * Read-only, unauthenticated, and deliberately restricted:
 *   - ONLY platform registry agents (owner_id IS NULL) — user-created agents
 *     are never exposed here
 *   - ONLY non-sensitive summary fields — system instructions, evaluation
 *     test cases and internal ids are not part of the public DTO
 *   - parameterized queries via the registry's discoverAgents (no raw SQL)
 *   - bounded pagination
 *
 * Global API rate limiting (300/min) applies as with every /api route.
 */

interface PublicAgent {
  slug: string;
  name: string;
  specialization: string;
  description: string;
  category: string;
  categorySlug: string;
  version: string;
  status: string;
  capabilities: string[];
  inputs: string[];
  outputs: string[];
  tools: string[];
  workflow: string[];
  modelRequirements: string[];
  costEstimateCents: number;
}

function toPublicAgent(agent: {
  slug: string; name: string; specialization: string; description: string;
  category: string; categorySlug: string; version: string; status: string;
  capabilities: string[]; inputs: string[]; outputs: string[];
  toolPermissions: string[]; workflow: string[]; modelRequirements: string[];
  costUsage: { estimatedCents: number };
}): PublicAgent {
  return {
    slug: agent.slug,
    name: agent.name,
    specialization: agent.specialization,
    description: agent.description,
    category: agent.category,
    categorySlug: agent.categorySlug,
    version: agent.version,
    status: agent.status,
    capabilities: agent.capabilities,
    inputs: agent.inputs,
    outputs: agent.outputs,
    tools: agent.toolPermissions,
    workflow: agent.workflow,
    modelRequirements: agent.modelRequirements,
    costEstimateCents: agent.costUsage.estimatedCents,
  };
}

export function createPublicRouter(): Router {
  const router = Router();

  router.get(
    '/agents',
    asyncRoute(async (req, res) => {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : undefined;
      const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 64) : undefined;
      const rawLimit = Number(req.query.limit ?? 24);
      const rawOffset = Number(req.query.offset ?? 0);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 60) : 24;
      const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;

      const { agents, total } = discoverAgents({
        query: q && q.length > 0 ? q : undefined,
        category: category && category.length > 0 ? category : undefined,
        status: 'active',
        platformOnly: true,
        limit,
        offset,
      });

      res.status(200).json({
        agents: agents.map(toPublicAgent),
        total,
        limit,
        offset,
      });
    }),
  );

  router.get(
    '/agent-categories',
    asyncRoute(async (_req, res) => {
      res.status(200).json({ categories: listCategories() });
    }),
  );

  router.get(
    '/agents/:slug',
    asyncRoute(async (req, res) => {
      const agent = getAgentBySlug(String(req.params.slug).slice(0, 128));
      // Public detail: platform registry agents only, never user agents.
      if (!agent || agent.ownerId !== null || agent.status !== 'active') {
        throw new HttpError(404, 'agent not found', 'not_found');
      }
      res.status(200).json({ agent: toPublicAgent(agent) });
    }),
  );

  router.get(
    '/registry-stats',
    asyncRoute(async (_req, res) => {
      res.status(200).json({
        agents: countAgentRegistry(),
        // Category count comes from the live categories table via listCategories.
        categories: listCategories().length,
      });
    }),
  );

  return router;
}
