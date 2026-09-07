import { Router } from 'express';
import { listAgents, findAgentBySlug } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';

export const agentsRouter = Router();

agentsRouter.use(requireAuth);

agentsRouter.get('/', (_req: AuthenticatedRequest, res) => {
  const rows = listAgents(200, 0);
  res.status(200).json({
    agents: rows.map((agent) => ({
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      version: agent.version,
      categoryId: agent.category_id,
      runtime: agent.runtime,
      status: agent.status,
      config: agent.config ? safeParse(agent.config) : null,
    })),
  });
});

agentsRouter.get('/:slug', (req: AuthenticatedRequest, res) => {
  const agent = findAgentBySlug(req.params.slug);
  if (!agent) {
    throw new HttpError(404, 'agent not found', 'not_found');
  }
  res.status(200).json({
    agent: {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      version: agent.version,
      categoryId: agent.category_id,
      runtime: agent.runtime,
      status: agent.status,
      config: agent.config ? safeParse(agent.config) : null,
    },
  });
});

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
