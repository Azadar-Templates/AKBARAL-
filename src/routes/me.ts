import { Router } from 'express';
import { findUserById, getAvailableCredits, getCreditAccount, getTrialStatus, getActiveSubscription } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';
import { hasUnlimitedTaskCredits } from '../auth/entitlements';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.userId ?? '';
  const user = findUserById(userId);
  if (!user) {
    throw new HttpError(404, 'user not found', 'not_found');
  }
  const account = getCreditAccount(userId);
  // Display-only entitlement flag (Section: owner UI/API display fix). This
  // reuses the SAME server-side helper the orchestrator already uses to
  // decide real credit consumption (src/auth/entitlements.ts) — it is not a
  // second implementation of the entitlement, just a read of it, so the
  // trial/credit numbers below (still computed identically for every role)
  // and this flag can never disagree about who is actually unlimited.
  const unlimited = hasUnlimitedTaskCredits(userId);
  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      freeCredits: account ? getAvailableCredits(account) : 0,
      createdAt: user.created_at,
    },
    trial: getTrialStatus(userId),
    subscription: getActiveSubscription(userId),
    unlimited,
  });
});
