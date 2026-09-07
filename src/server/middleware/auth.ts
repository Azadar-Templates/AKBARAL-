import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../../security';
import { HttpError } from '../http';

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    email: string;
    role: string;
    sessionId: string;
  };
}

/**
 * Validate the `Authorization: Bearer <token>` header.
 *
 * The JWT signature is verified; the database-backed session is checked lazily
 * by services that need it. This middleware is used by the authenticated API.
 */
export function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';

  if (!token) {
    next(new HttpError(401, 'missing bearer token', 'unauthorized'));
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    next(new HttpError(401, 'invalid or expired token', 'unauthorized'));
    return;
  }

  req.auth = {
    userId: payload.sub,
    email: payload.email,
    role: payload.role,
    sessionId: payload.sid,
  };
  next();
}
