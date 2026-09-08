import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit, clearRateLimitBuckets } from './rate-limit';

function readCallResults(middleware: (req: Request, res: Response, next: NextFunction) => void, count: number, pathForCall?: (index: number) => string): boolean[] {
  const accepted: boolean[] = [];
  const req = { ip: '203.0.113.7', path: '/x' } as unknown as Request;
  const res = {} as Response;
  const next = (error?: unknown) => accepted.push(!error);
  for (let i = 0; i < count; i += 1) {
    (req as { path?: string }).path = pathForCall ? pathForCall(i) : `/rows/${i}`;
    middleware(req, res, next);
  }
  return accepted;
}

describe('rate limiter global bypass protection', () => {
  beforeEach(() => clearRateLimitBuckets());
  afterEach(() => clearRateLimitBuckets());

  it('allows requests below the route maximum', () => {
    const limiter = rateLimit({ max: 5, windowMs: 60_000, prefix: 'test' });
    const accepted = readCallResults(limiter, 4);
    assert.deepEqual(accepted, [true, true, true, true]);
  });

  it('blocks a client that sprays many different paths', () => {
    // max=2, globalMax=max*2=4. After 4 unique paths the global bucket is full.
    const limiter = rateLimit({ max: 2, windowMs: 60_000, prefix: 'spray' });
    const accepted = readCallResults(limiter, 5);
    assert.deepEqual(accepted, [true, true, true, true, false]);
  });

  it('also throttles repeated requests to one hot route', () => {
    const limiter = rateLimit({ max: 3, windowMs: 60_000, prefix: 'hot' });
    const accepted = readCallResults(limiter, 4, () => '/hot');
    assert.deepEqual(accepted, [true, true, true, false]);
  });
});
