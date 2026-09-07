import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../http';

interface RateEntry {
  hits: number;
  resetAt: number;
}

const buckets = new Map<string, RateEntry>();

/**
 * In-memory sliding-window rate limiter.
 * Replace with a shared store (Redis) when running multiple instances.
 */
export function rateLimit(options: { windowMs?: number; max?: number; prefix?: string }) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const prefix = options.prefix ?? 'global';

  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = `${prefix}:${req.ip ?? 'unknown'}:${req.path}`;
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { hits: 1, resetAt: now + windowMs });
      next();
      return;
    }
    entry.hits += 1;
    if (entry.hits > max) {
      next(new HttpError(429, 'rate limit exceeded', 'rate_limited'));
      return;
    }
    next();
  };
}

export function clearRateLimitBuckets(): void {
  buckets.clear();
}
