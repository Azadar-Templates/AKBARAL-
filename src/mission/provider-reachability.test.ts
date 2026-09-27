import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GEMINI_HOST,
  GEMINI_PROBE_URL,
  checkProviderReachability,
  reachabilityNote,
  resetProviderReachabilityCache,
} from './provider-reachability';
import { CHAT_MODEL } from './chat-state';

/**
 * The preflight exists so the dashboard can never imply that chat works when
 * the runtime cannot reach the provider at all. It must be unauthenticated,
 * truthful in both directions, and cheap enough to call on every render.
 */

describe('provider reachability preflight', () => {
  beforeEach(() => resetProviderReachabilityCache());

  it('probes the real Gemini endpoint for the configured model', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const transport = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response('{}', { status: 401 });
    }) as unknown as typeof fetch;

    const result = await checkProviderReachability({ transport, force: true });
    assert.equal(seen!.url, GEMINI_PROBE_URL);
    assert.match(seen!.url, new RegExp(GEMINI_HOST));
    assert.equal(result.model, CHAT_MODEL);
  });

  it('never sends a credential while probing', async () => {
    let headers: Record<string, string> = {};
    const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
      headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
      return new Response('{}', { status: 403 });
    }) as unknown as typeof fetch;

    await checkProviderReachability({ transport, force: true });
    for (const forbidden of ['x-goog-api-key', 'authorization', 'cookie', 'x-api-key']) {
      assert.equal(forbidden in headers, false, `the probe must not send ${forbidden}`);
    }
  });

  it('treats any HTTP answer — including 401 — as a reachable network path', async () => {
    const transport = (async () => new Response('{"error":"missing key"}', { status: 401 })) as unknown as typeof fetch;
    const result = await checkProviderReachability({ transport, force: true });
    assert.equal(result.reachable, true);
    assert.equal(result.status, 'REACHABLE');
    assert.equal(result.httpStatus, 401);
    assert.match(reachabilityNote(result), /can reach/);
    assert.doesNotMatch(reachabilityNote(result), /RUNTIME BLOCKED/);
  });

  it('reports a transport failure as RUNTIME BLOCKED with the real cause and blames the network, not the key', async () => {
    const transport = (async () => {
      const error = new TypeError('fetch failed');
      (error as { cause?: unknown }).cause = { code: 'ECONNRESET' };
      throw error;
    }) as unknown as typeof fetch;

    const result = await checkProviderReachability({ transport, force: true });
    assert.equal(result.reachable, false);
    assert.equal(result.status, 'RUNTIME BLOCKED');
    assert.match(result.detail, /ECONNRESET/);
    const note = reachabilityNote(result);
    assert.match(note, /RUNTIME BLOCKED/);
    assert.match(note, /stored encrypted/);
    assert.match(note, /infrastructure limit, not a wrong key/);
  });

  it('reports a timeout honestly instead of guessing', async () => {
    const transport = (async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as unknown as typeof fetch;
    const result = await checkProviderReachability({ transport, force: true });
    assert.equal(result.reachable, false);
    assert.match(result.detail, /timed out/);
  });

  it('caches for a short while so the dashboard can call it freely, and force bypasses the cache', async () => {
    let calls = 0;
    const transport = (async () => { calls += 1; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const first = await checkProviderReachability({ transport, force: true });
    const second = await checkProviderReachability({ transport });
    assert.equal(calls, 1);
    assert.equal(second.cached, true);
    assert.equal(first.reachable, second.reachable);
    await checkProviderReachability({ transport, force: true });
    assert.equal(calls, 2);
  });

  it('never leaks a key-shaped value into its own output', async () => {
    const transport = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const result = await checkProviderReachability({ transport, force: true });
    const serialized = JSON.stringify(result) + reachabilityNote(result);
    assert.doesNotMatch(serialized, /key=|x-goog-api-key|[A-Za-z0-9_-]{30,}/);
  });
});
