import { Router } from 'express';
import { db, listMarketplaceAgents, createAgentOrder, findAllUserAgents, saveUserAgent, findAgentBySlug, recordAnalyticsEvent, createNotification } from '../db';
import { getAgentBySlug, isAgentVisibleToUser } from '../agents/registry';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';
import { getBody, optionalString } from '../server/middleware/validation';

export function createMarketplaceRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req: AuthenticatedRequest, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'published';
    const agents = listMarketplaceAgents({ status });
    res.status(200).json({ agents });
  });

  router.get('/:slug', (req: AuthenticatedRequest, res) => {
    const agent = getAgentBySlug(req.params.slug);
    if (!agent || !isAgentVisibleToUser(agent, req.auth!.userId)) {
      throw new HttpError(404, 'agent not found', 'not_found');
    }
    const market = db.get('SELECT * FROM agent_marketplace WHERE agent_id = ?', [agent.id]) as Record<string, unknown> | undefined;
    const userRelation = findAllUserAgents(req.auth!.userId, agent.id);
    res.status(200).json({
      agent,
      market,
      installed: userRelation.length > 0,
      saved: userRelation.length > 0 ? Boolean(userRelation[0].saved) : false,
      favorite: userRelation.length > 0 ? Boolean(userRelation[0].favorite) : false,
    });
  });

  router.post('/:slug/install', (req: AuthenticatedRequest, res) => {
    const view = getAgentBySlug(req.params.slug);
    if (!view || !isAgentVisibleToUser(view, req.auth!.userId)) {
      throw new HttpError(404, 'agent not found', 'not_found');
    }
    const agent = findAgentBySlug(req.params.slug);
    if (!agent) {
      throw new HttpError(404, 'agent not found', 'not_found');
    }
    const market = db.get<{ price_cents: number; currency: string; status: string }>('SELECT * FROM agent_marketplace WHERE agent_id = ?', [agent.id]);
    if (market && market.status !== 'published') {
      throw new HttpError(403, 'agent is not published for installation', 'agent_not_published');
    }
    const priceCents = market?.price_cents ?? 0;
    const order = createAgentOrder({ userId: req.auth!.userId, agentId: agent.id, amountCents: priceCents, currency: market?.currency ?? 'PKR' });
    saveUserAgent({ userId: req.auth!.userId, agentId: agent.id, saved: true, favorite: true });
    recordAnalyticsEvent({
      userId: req.auth!.userId,
      eventType: 'marketplace.install',
      payload: { agentSlug: agent.slug, orderId: order.id, priceCents },
    });
    createNotification({
      userId: req.auth!.userId,
      type: 'marketplace.install',
      title: `${agent.slug} installed`,
      body: `Agent added to your Agent World.`,
    });
    res.status(201).json({ order, agentId: agent.id, slug: agent.slug });
  });

  router.post('/:slug/publish', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const agent = findAgentBySlug(req.params.slug);
    if (!agent || !agent.owner_id || String(agent.owner_id) !== req.auth!.userId) {
      throw new HttpError(403, 'only the owner can publish this agent', 'forbidden');
    }
    const priceCents = Number(body.price_cents ?? 0) || 0;
    db.run(
      `INSERT INTO agent_marketplace (id, agent_id, publisher_user_id, price_cents, currency, status, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'PKR', 'published', NULL, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET price_cents=?, status='published', publisher_user_id=?, updated_at=?`,
      [
        `mkt-${Date.now()}`,
        agent.id,
        req.auth!.userId,
        priceCents,
        new Date().toISOString(),
        new Date().toISOString(),
        priceCents,
        req.auth!.userId,
        new Date().toISOString(),
      ],
    );
    recordAnalyticsEvent({ userId: req.auth!.userId, eventType: 'marketplace.publish', payload: { agentSlug: agent.slug, priceCents } });
    res.status(200).json({ slug: agent.slug, status: 'published', priceCents });
  });

  router.post('/:slug/unpublish', (req: AuthenticatedRequest, res) => {
    const agent = findAgentBySlug(req.params.slug);
    if (!agent || !agent.owner_id || String(agent.owner_id) !== req.auth!.userId) {
      throw new HttpError(403, 'only the owner can unpublish this agent', 'forbidden');
    }
    db.run(`UPDATE agent_marketplace SET status = 'removed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE agent_id = ?`, [agent.id]);
    res.status(200).json({ slug: agent.slug, status: 'removed' });
  });

  router.post('/:slug/save', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const view = getAgentBySlug(req.params.slug);
    if (!view || !isAgentVisibleToUser(view, req.auth!.userId)) {
      throw new HttpError(404, 'agent not found', 'not_found');
    }
    const agent = findAgentBySlug(req.params.slug);
    if (!agent) {
      throw new HttpError(404, 'agent not found', 'not_found');
    }
    saveUserAgent({ userId: req.auth!.userId, agentId: agent.id, saved: optionalString(body, 'saved') === 'false' ? false : true, favorite: Boolean(body.favorite) });
    res.status(204).send();
  });

  return router;
}
