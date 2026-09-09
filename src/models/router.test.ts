import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRouter } from './router';

describe('model router', () => {
  after(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  it('resolves Google models from GOOGLE_API_KEY and prefers configured models', () => {
    const saved = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = 'test-key';
    try {
      const decision = modelRouter.route({ preferredModelKey: 'gemini-2.0-flash', capability: ['research'] });
      assert.equal(decision.model.providerKey, 'google');
      assert.equal(decision.available, true);
      assert.equal(decision.requiredEnvKey, 'GOOGLE_API_KEY');

      const chain = (modelRouter as unknown as { fallbackChain: (d: unknown, r: unknown) => Array<{ providerKey: string }> }).fallbackChain(
        decision,
        { capability: ['research'] },
      );
      const providers = chain.map((entry) => entry.providerKey);
      assert.ok(providers.includes('openai'), 'openai must be in the fallback chain');
      assert.ok(providers.includes('anthropic'), 'anthropic must be in the fallback chain');
      assert.ok(providers.includes('google'), 'google must be in the fallback chain');
    } finally {
      if (saved === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = saved;
    }
  });

  it('returns an honest unavailable decision when no provider credential is set', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const decision = modelRouter.route({ capability: ['research'] });
    assert.equal(decision.available, false);
    assert.match(decision.requiredEnvKey ?? '', /API_KEY/);
  });
});
