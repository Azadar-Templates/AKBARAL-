import { Router } from 'express';
import { discoverAgents, getAgentBySlug, isAgentVisibleToUser, listCategories, countAgentRegistry } from '../agents/registry';
import { saveUserAgent, findAllUserAgents } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';
import { getBody } from '../server/middleware/validation';

export const agentsRouter = Router();

agentsRouter.use(requireAuth);

agentsRouter.get('/categories', (_req, res) => {
  res.status(200).json({
    categories: listCategories(),
    total: countAgentRegistry(),
  });
});

agentsRouter.get('/', (req: AuthenticatedRequest, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : undefined;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const limit = Number(req.query.limit ?? 50);
  const offset = Number(req.query.offset ?? 0);
  const result = discoverAgents({ query, category, status, limit, offset, userId: req.auth!.userId });
  res.status(200).json(result);
});

agentsRouter.post('/:slug/save', (req: AuthenticatedRequest, res) => {
  const body = getBody(req);
  const favorite = Boolean(body.favorite);
  const saved = Boolean(body.saved);
  const agent = getAgentBySlug(req.params.slug);
  if (!agent) {
    throw new HttpError(404, 'agent not found', 'not_found');
  }
  saveUserAgent({ userId: req.auth!.userId, agentId: agent.id, saved, favorite });
  res.status(204).send();
});

agentsRouter.get('/:slug', (req: AuthenticatedRequest, res) => {
  const agent = getAgentBySlug(req.params.slug);
  if (!agent || !isAgentVisibleToUser(agent, req.auth!.userId)) {
    throw new HttpError(404, 'agent not found', 'not_found');
  }
  const rows = findAllUserAgents(req.auth!.userId, agent.id);
  res.status(200).json({
    agent,
    saved: rows.length > 0 ? Boolean(rows[0].saved) : false,
    favorite: rows.length > 0 ? Boolean(rows[0].favorite) : false,
  });
});
