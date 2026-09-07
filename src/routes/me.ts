import { Router } from 'express';
import { findUserById, getCreditAccount } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId ?? '';
  const user = findUserById(userId);
  if (!user) {
    throw new HttpError(404, 'user not found', 'not_found');
  }
  const account = getCreditAccount(userId);
  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      freeCredits: account?.free_credits ?? 0,
      createdAt: user.created_at,
    },
  });
});
