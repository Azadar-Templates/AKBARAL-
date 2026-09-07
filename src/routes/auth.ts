import { Router } from 'express';
import { register, login, logout, validateRefreshToken, rotateRefreshSession, AuthUserView } from '../auth';
import { asyncRoute, HttpError } from '../server/http';
import { getBody, optionalString, requireString } from '../server/middleware/validation';
import { appendAuditLog, findUserById, getCreditAccount } from '../db';

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncRoute(async (req, res) => {
    const body = getBody(req);
    const user = await register({
      email: requireString(body, 'email', 'email'),
      password: requireString(body, 'password', 'password'),
      name: optionalString(body, 'name'),
    });
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  asyncRoute(async (req, res) => {
    const body = getBody(req);
    const result = await login({
      email: requireString(body, 'email', 'email'),
      password: requireString(body, 'password', 'password'),
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.status(200).json(result);
  }),
);

authRouter.get(
  '/me',
  (req, res, next) => {
    const tokenHeader = req.header('authorization') ?? '';
    const token = tokenHeader.startsWith('Bearer ') ? tokenHeader.slice('Bearer '.length) : '';
    const userId = validateRefreshToken(token);
    if (!userId) {
      next(new HttpError(401, 'invalid or expired refresh token', 'unauthorized'));
      return;
    }
    const user = findUserById(userId);
    if (!user) {
      next(new HttpError(404, 'user not found', 'not_found'));
      return;
    }
    res.status(200).json({ user: toMeView(user) });
  },
);

authRouter.post(
  '/refresh',
  (req, res, next) => {
    const body = getBody(req);
    const refreshToken = requireString(body, 'refresh_token', 'refresh_token');
    const userId = validateRefreshToken(refreshToken);
    if (!userId) {
      next(new HttpError(401, 'invalid or expired refresh token', 'unauthorized'));
      return;
    }
    const { refreshToken: nextRefresh, user } = rotateRefreshSession(userId);
    res.status(200).json({ refreshToken: nextRefresh, user });
  },
);

authRouter.post(
  '/logout',
  (req, res) => {
    const body = getBody(req);
    const refreshToken = requireString(body, 'refresh_token', 'refresh_token');
    logout(refreshToken);
    const userId = validateRefreshToken(refreshToken);
    if (userId) {
      appendAuditLog({
        actorId: userId,
        action: 'auth.logout',
        resourceType: 'session',
        description: 'user logged out',
      });
    }
    res.status(204).send();
  },
);

function toMeView(user: NonNullable<ReturnType<typeof findUserById>>): AuthUserView {
  const account = getCreditAccount(user.id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    freeCredits: account?.free_credits ?? 0,
    createdAt: user.created_at,
  };
}
