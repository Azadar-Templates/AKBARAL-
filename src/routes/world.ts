import { Router } from 'express';
import { findAgentBySlug, listMyAgentWorld, setUserAgentFavorite, removeUserAgent } from '../db';
import { getAgentBySlug, isAgentVisibleToUser } from '../agents/registry';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';

/**
 * Agent World (Milestone 7) — the user's personal agent surface.
 *
 *   GET    /api/world?q=        — my saved/installed agents with real usage
 *                                  signals (task counts, executions, last used)
 *   POST   /api/world/:slug/favorite — toggle favorite
 *   DELETE /api/world/:slug     — remove an agent from my world
 */
export function createWorldRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req: AuthenticatedRequest, res) => {
    const q = typeof req.query.q === 'string' && req.query.q.trim().length > 0 ? req.query.q.trim() : undefined;
    const agents = listMyAgentWorld(req.auth!.userId, { q });
    res.status(200).json({
      agents,
      summary: {
        total: agents.length,
        favorites: agents.filter((agent) => agent.favorite === 1).length,
      },
    });
  });

  router.post('/:slug/favorite', (req: AuthenticatedRequest, res) => {
    const agent = resolveMyAgent(req.params.slug, req.auth!.userId);
    const current = Boolean(
      (listMyAgentWorld(req.auth!.userId).find((row) => String(row.slug) === req.params.slug) as { favorite?: number } | undefined)?.favorite,
    );
    const updated = setUserAgentFavorite(req.auth!.userId, String(agent.id), !current);
    if (!updated) {
      throw new HttpError(404, 'agent not found in your world', 'not_found');
    }
    res.status(200).json({ slug: req.params.slug, favorite: !current });
  });

  router.delete('/:slug', (req: AuthenticatedRequest, res) => {
    const agent = resolveMyAgent(req.params.slug, req.auth!.userId);
    const removed = removeUserAgent(req.auth!.userId, String(agent.id));
    if (!removed) {
      throw new HttpError(404, 'agent not found in your world', 'not_found');
    }
    res.status(200).json({ removed: true, slug: req.params.slug });
  });

  return router;
}

function resolveMyAgent(slug: string, userId: string): { id: string } {
  const view = getAgentBySlug(slug);
  if (!view || !isAgentVisibleToUser(view, userId)) {
    throw new HttpError(404, 'agent not found', 'not_found');
  }
  const agent = findAgentBySlug(slug);
  if (!agent) {
    throw new HttpError(404, 'agent not found', 'not_found');
  }
  return { id: String(agent.id) };
}
