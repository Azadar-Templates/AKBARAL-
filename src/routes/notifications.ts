import { Router } from 'express';
import { listNotifications, markNotificationRead, recordAnalyticsEvent, revokeDeviceToken, upsertDeviceToken } from '../db';
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

  // Mobile push device registration (expo-notifications). The app registers
  // after login and on token refresh; re-registering re-owns an existing token
  // (e.g. after re-login as a different user) instead of duplicating rows.
  router.post('/device', (req: AuthenticatedRequest, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const platform = req.body?.platform === 'ios' ? 'ios' : req.body?.platform === 'web' ? 'web' : 'android';
    if (!token.startsWith('ExpoPushToken[') && process.env.NODE_ENV === 'production') {
      res.status(422).json({ error: 'invalid push token' });
      return;
    }
    if (token.length < 16) {
      res.status(422).json({ error: 'invalid push token' });
      return;
    }
    const { id } = upsertDeviceToken({ userId: req.auth!.userId, token, platform });
    res.status(200).json({ deviceId: id, platform });
  });

  router.delete('/device/:token', (req: AuthenticatedRequest, res) => {
    const removed = revokeDeviceToken(req.auth!.userId, req.params.token);
    res.status(removed ? 204 : 404).send();
  });

  router.get('/categories', (_req, res) => {
    res.status(200).json({ categories: ['system', 'task', 'workflow', 'marketplace', 'billing', 'security', 'admin'] });
  });

  return router;
}
