import type { NextFunction, Response } from 'express';
import { HttpError } from '../http';
import type { AuthenticatedRequest } from './auth';

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new HttpError(401, 'authentication required', 'unauthorized'));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new HttpError(403, 'insufficient permissions', 'forbidden'));
      return;
    }
    next();
  };
}
