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
 *
 * Each layer keeps two buckets per IP: a per-route bucket (so a hot endpoint
 * can be throttled independently) and a layer-global bucket (so an attacker
 * cannot bypass limits by spraying many different paths).
 */
export function rateLimit(options: { windowMs?: number; max?: number; prefix?: string }) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const globalMax = Math.max(max * 2, max + 1);
  const prefix = options.prefix ?? 'global';

  function hit(bucketKey: string, limit: number, now: number): boolean {
    const entry = buckets.get(bucketKey);
    if (!entry || entry.resetAt <= now) {
      buckets.set(bucketKey, { hits: 1, resetAt: now + windowMs });
      return true;
    }
    entry.hits += 1;
    return entry.hits <= limit;
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const globalKey = `${prefix}:global:${ip}`;
    const routeKey = `${prefix}:${ip}:${req.path}`;

    if (!hit(globalKey, globalMax, now) || !hit(routeKey, max, now)) {
      next(new HttpError(429, 'rate limit exceeded', 'rate_limited'));
      return;
    }
    next();
  };
}

export function clearRateLimitBuckets(): void {
  buckets.clear();
}
