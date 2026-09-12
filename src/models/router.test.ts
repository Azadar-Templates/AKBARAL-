import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelRouter } from './router';
import { classifyExecutionError } from '../orchestrator/errors';

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
      const decision = modelRouter.route({ preferredModelKey: 'gemini-3.8-flash', capability: ['research'] });
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
  it('reports an honest aggregated error when NO provider is configured (regression: last-chain-entry message)', async () => {
    const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY'] as const;
    const saved = keys.map((k) => process.env[k]);
    for (const k of keys) delete process.env[k];
    try {
      await assert.rejects(
        modelRouter.complete({ capability: ['research'] }, [{ role: 'user', content: 'hello' }]),
        (error: Error & { code?: string }) => {
          // The OLD behavior surfaced only the last chain entry
          // ("openai is not configured; set OPENAI_API_KEY"), misleading
          // users into thinking one key was missing. The honest error lists
          // every required credential.
          assert.match(error.message, /AI providers are not configured/);
          // Message-based classifiers (src/orchestrator) match the literal
          // substring 'not configured' when the error code is lost across
          // serialization — the aggregated message must keep classifying as
          // provider_not_configured (permanent, non-retryable).
          assert.ok(error.message.includes('not configured'), 'message must keep the not-configured classifier contract');
          assert.match(error.message, /OPENAI_API_KEY/);
          assert.match(error.message, /ANTHROPIC_API_KEY/);
          assert.match(error.message, /GOOGLE_API_KEY/);
          assert.equal(error.code, 'provider_not_configured');
          return true;
        },
      );
    } finally {
      keys.forEach((k, i) => {
        if (saved[i] === undefined) delete process.env[k];
        else process.env[k] = saved[i];
      });
    }
  });

  it('still surfaces the single-provider message when only SOME providers are unconfigured', async () => {
    // With a Google key present, the chain contains an available provider;
    // a completion attempt must NOT throw the aggregated "no AI provider"
    // error — it proceeds to the real provider call (which fails with a
    // provider error, not a configuration error).
    const saved = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = 'regression-test-key';
    try {
      await assert.rejects(
        modelRouter.complete({ capability: ['research'] }, [{ role: 'user', content: 'hello' }]),
        (error: Error & { code?: string }) => {
          assert.ok(!/no AI provider is configured/.test(error.message), 'must not claim no provider is configured when one is available');
          return true;
        },
      );
    } finally {
      if (saved === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = saved;
    }
  });
  it('aggregated unconfigured message still classifies as permanent (non-retryable) when the error code is lost', () => {
    // failExecution() re-derives the code from the message string alone once
    // the error crosses a serialization boundary — this locks that contract.
    const message = 'AI providers are not configured; set at least one of OPENAI_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY';
    const classification = classifyExecutionError({ message });
    assert.equal(classification.code, 'provider_not_configured');
    assert.equal(classification.retryable, false);
  });
});
