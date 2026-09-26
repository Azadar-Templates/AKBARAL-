import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../http';
import { env } from '../../config/env';

interface RateEntry {
  hits: number;
  resetAt: number;
}

const buckets = new Map<string, RateEntry>();

/**
 * Which identity does a request get throttled under?
 *
 * SECURITY FIX 2026-09-26: the limiter keyed purely on `req.ip`. With
 * `TRUST_PROXY` set (required in this deployment — the public Next.js tier
 * proxies /api/* to the API tier) Express derives `req.ip` from the
 * X-Forwarded-For header, so ANY caller could rotate that header and get a
 * fresh bucket on every request. Verified by
 * src/security/attack-surface.test.ts: 330 consecutive /api/health calls with
 * rotating spoofed forwarded IPs were all accepted.
 *
 * A well-behaved proxy appends exactly the hops it owns, so a chain LONGER than
 * the configured trusted-hop count is proof that the client injected addresses
 * of its own. In that case the forwarded value is discarded and the socket
 * address — the one thing a remote caller cannot forge — becomes the key. Every
 * spoofing client therefore collapses into the same bucket (fail closed) while
 * genuine clients behind a compliant proxy keep their own.
 */
function clientKey(req: Request): string {
  // `req.socket` is absent in unit tests that hand-build a request object, so
  // fall back to req.ip there rather than throwing inside the middleware.
  const socketIp = req.socket?.remoteAddress ?? req.ip ?? 'unknown';
  const trustedHops = Number(env.trustProxy) || 0;
  if (trustedHops <= 0) return socketIp;
  // The RAW header is what matters: with `trust proxy: n` Express already
  // slices the chain down to the trusted hops, so req.ips can never reveal the
  // injected entries. Counting the raw addresses does.
  const raw = req.headers?.['x-forwarded-for'];
  const chain = (Array.isArray(raw) ? raw.join(',') : (raw ?? ''))
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (chain.length === 0) return socketIp;
  if (chain.length > trustedHops) return `socket:${socketIp}`;
  return req.ip ?? socketIp;
}

/**
 * In-memory sliding-window rate limiter.
 * Replace with a shared store (Redis) when running multiple instances.
 *
 * Each layer keeps two buckets per client: a per-route bucket (so a hot
 * endpoint can be throttled independently) and a layer-global bucket (so an
 * attacker cannot bypass limits by spraying many different paths).
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
    const ip = clientKey(req);
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
