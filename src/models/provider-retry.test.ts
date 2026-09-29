import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { GoogleProvider, ProviderCallError, isRetryableProviderError } from './client';
import { MODEL_SPECS, type ModelSpec } from './catalog';
import { backoffDelayMs, resolveRetryPolicy, withRetries, DEFAULT_RETRY_POLICY } from './retry';
import { selectGeminiCandidates, geminiModelsSupportingGeneration } from '../launch/checks';

/**
 * Transient-failure handling for the REAL provider path.
 *
 * Google documents HTTP 503 UNAVAILABLE (and 429/500/502/504) as transient and
 * prescribes retrying with truncated exponential backoff + jitter. These tests
 * drive the real GoogleProvider adapter against a local HTTP server that
 * genuinely answers 503 — nothing is mocked at the provider level and no
 * success is ever synthesised: every PASS below is a real HTTP 200 the adapter
 * obtained by retrying, or an honest failure after the budget is exhausted.
 */

interface Fixture {
  baseUrl: string;
  hits: string[];
  close(): Promise<void>;
}

/** Local Gemini-shaped server; `plan` decides the status of each hit. */
async function startGeminiFixture(plan: (hit: number, path: string) => number): Promise<Fixture> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      const path = req.url ?? '/';
      hits.push(path);
      const status = plan(hits.length, path);
      if (status >= 400) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: status, status: 'UNAVAILABLE', message: 'The model is overloaded. Please try again later.' } }));
        return;
      }
      if (path.includes('streamGenerateContent')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'streamed-ok' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } })}\n\n`);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'retry-ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1beta`,
    hits,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

const saved = new Map<string, string | undefined>();
const ENV_KEYS = [
  'GOOGLE_API_KEY',
  'GOOGLE_BASE_URL',
  'AKBARAL_ALLOW_PRIVATE_PROVIDER',
  'AKBARAL_PROVIDER_MAX_ATTEMPTS',
  'AKBARAL_PROVIDER_RETRY_BASE_MS',
  'AKBARAL_PROVIDER_RETRY_MAX_DELAY_MS',
];

const geminiSpec: ModelSpec =
  MODEL_SPECS.find((spec) => spec.providerKey === 'google' && spec.capability === 'llm') ??
  (() => {
    throw new Error('catalog has no google llm model');
  })();

describe('provider transient-failure retry (Gemini 503)', () => {
  before(() => {
    for (const key of ENV_KEYS) saved.set(key, process.env[key]);
    process.env.GOOGLE_API_KEY = 'test-google-key';
    process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER = '1';
    // Keep the shape (exponential, jittered, bounded) but run it fast.
    process.env.AKBARAL_PROVIDER_RETRY_BASE_MS = '1';
    process.env.AKBARAL_PROVIDER_RETRY_MAX_DELAY_MS = '4';
  });

  after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('retries a real 503 and returns the real response that follows', async () => {
    const fixture = await startGeminiFixture((hit) => (hit < 3 ? 503 : 200));
    process.env.GOOGLE_BASE_URL = fixture.baseUrl;
    try {
      const result = await new GoogleProvider().chat(geminiSpec, [{ role: 'user', content: 'ping' }]);
      assert.equal(result.text, 'retry-ok', 'the text comes from a real HTTP 200, not a fabricated fallback');
      assert.equal(result.provider, 'google');
      assert.equal(fixture.hits.length, 3, 'two 503s were retried, the third attempt succeeded');
    } finally {
      await fixture.close();
    }
  });

  it('fails honestly with the real upstream status when every attempt is 503', async () => {
    const fixture = await startGeminiFixture(() => 503);
    process.env.GOOGLE_BASE_URL = fixture.baseUrl;
    try {
      await assert.rejects(
        () => new GoogleProvider().chat(geminiSpec, [{ role: 'user', content: 'ping' }]),
        (error: unknown) => {
          assert.ok(error instanceof ProviderCallError, 'the real provider error is rethrown');
          assert.equal(error.status, 503, 'the honest upstream status survives the retries');
          assert.equal(error.retryable, true);
          return true;
        },
      );
      assert.equal(fixture.hits.length, resolveRetryPolicy().maxAttempts, 'the retry budget is bounded');
    } finally {
      await fixture.close();
    }
  });

  it('never retries a permanent failure (403) — the budget is for transients only', async () => {
    const fixture = await startGeminiFixture(() => 403);
    process.env.GOOGLE_BASE_URL = fixture.baseUrl;
    try {
      await assert.rejects(() => new GoogleProvider().chat(geminiSpec, [{ role: 'user', content: 'ping' }]));
      assert.equal(fixture.hits.length, 1, 'a rejected credential fails on the first attempt');
    } finally {
      await fixture.close();
    }
  });

  it('retries a stream that failed before delivering any token', async () => {
    const fixture = await startGeminiFixture((hit) => (hit < 2 ? 503 : 200));
    process.env.GOOGLE_BASE_URL = fixture.baseUrl;
    const tokens: string[] = [];
    try {
      const result = await new GoogleProvider().streamChat(geminiSpec, [{ role: 'user', content: 'ping' }], (token) =>
        tokens.push(token),
      );
      assert.deepEqual(tokens, ['streamed-ok']);
      assert.equal(result.text, 'streamed-ok');
      assert.equal(fixture.hits.length, 2);
    } finally {
      await fixture.close();
    }
  });

  it('classifies retryable vs permanent provider errors', () => {
    assert.equal(isRetryableProviderError(new ProviderCallError('google', 'x', 503)), true);
    assert.equal(isRetryableProviderError(new ProviderCallError('google', 'x', 429)), true);
    assert.equal(isRetryableProviderError(new ProviderCallError('google', 'x', 403)), false);
    assert.equal(isRetryableProviderError(new ProviderCallError('google', 'x', 404)), false);
    assert.equal(isRetryableProviderError(new Error('not a provider error')), false);
    // A hung provider (no HTTP status) is NOT retried in place: that would
    // multiply worst-case latency. The router's provider fallback handles it.
    assert.equal(isRetryableProviderError(new ProviderCallError('google', 'timeout')), false);
  });

  it('backs off exponentially, with jitter, bounded by the cap', () => {
    const policy = { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 4_000 };
    assert.equal(backoffDelayMs(1, policy, () => 1), 500);
    assert.equal(backoffDelayMs(2, policy, () => 1), 1_000);
    assert.equal(backoffDelayMs(3, policy, () => 1), 2_000);
    assert.equal(backoffDelayMs(9, policy, () => 1), 4_000, 'truncated at maxDelayMs');
    assert.equal(backoffDelayMs(1, policy, () => 0), 250, 'jitter floor is 50% of the window');
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const delay = backoffDelayMs(attempt, policy);
      assert.ok(delay >= 0 && delay <= policy.maxDelayMs, `delay ${delay} stays within the cap`);
    }
    assert.equal(DEFAULT_RETRY_POLICY.maxAttempts, 3);
  });

  it('withRetries stops at the attempt cap and rethrows the original error', async () => {
    let calls = 0;
    const boom = new ProviderCallError('google', 'overloaded', 503);
    await assert.rejects(
      () =>
        withRetries(
          async () => {
            calls += 1;
            throw boom;
          },
          { isRetryable: isRetryableProviderError, policy: { maxAttempts: 4, baseDelayMs: 0, maxDelayMs: 0 } },
        ),
      (error: unknown) => error === boom,
    );
    assert.equal(calls, 4);
  });
});

describe('Gemini candidate selection from a real ListModels payload', () => {
  const payload = {
    models: [
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ],
  };

  it('reads only models that actually support generateContent', () => {
    assert.deepEqual(geminiModelsSupportingGeneration(payload), ['gemini-3.5-flash', 'gemini-3.1-flash-lite']);
    assert.deepEqual(geminiModelsSupportingGeneration({}), []);
  });

  it('keeps catalog models that Google is currently offering, in preference order', () => {
    const offered = geminiModelsSupportingGeneration(payload);
    assert.deepEqual(selectGeminiCandidates('', offered, ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite']), [
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
    ]);
  });

  it('honours an explicit operator override first when it is offered', () => {
    const offered = geminiModelsSupportingGeneration(payload);
    assert.equal(selectGeminiCandidates('gemini-3.1-flash-lite', offered, ['gemini-3.5-flash'])[0], 'gemini-3.1-flash-lite');
  });

  it('falls back to models Google itself advertises — never an invented ID', () => {
    const discovered = selectGeminiCandidates('', ['gemini-9.9-flash', 'gemini-9.9-pro', 'text-embedding-004'], [
      'gemini-retired-model',
    ]);
    assert.deepEqual(discovered, ['gemini-9.9-flash', 'gemini-9.9-pro']);
    for (const id of discovered) {
      assert.ok(['gemini-9.9-flash', 'gemini-9.9-pro'].includes(id), 'every candidate came from the live ListModels response');
    }
  });

  it('uses the catalog order when ListModels gave nothing to filter on', () => {
    assert.deepEqual(selectGeminiCandidates('', [], ['gemini-3.5-flash', 'gemini-3.8-flash']), [
      'gemini-3.5-flash',
      'gemini-3.8-flash',
    ]);
  });
});
