import { Router } from 'express';
import { listNotifications, markNotificationRead, recordAnalyticsEvent } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';

export function createNotificationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req: AuthenticatedRequest, res) => {
    res.status(200).json({ notifications: listNotifications(req.auth!.userId) });
  });

  router.post('/:id/read', (req: AuthenticatedRequest, res) => {
    markNotificationRead(req.params.id, req.auth!.userId);
    recordAnalyticsEvent({ userId: req.auth!.userId, eventType: 'notification.read', payload: { id: req.params.id } });
    res.status(204).send();
  });

  router.get('/categories', (_req, res) => {
    res.status(200).json({ categories: ['system', 'task', 'workflow', 'marketplace', 'billing', 'security', 'admin'] });
  });

  return router;
}
