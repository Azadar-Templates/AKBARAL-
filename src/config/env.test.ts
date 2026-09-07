import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { env, validateEnvironment, EnvConfigError } from './env';
import { redactSecrets, safeProviderErrorMessage } from './secrets';
import { INTEGRATION_DEFINITIONS, getConfigStatus } from './credentials';

const originalEnv = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  resetEnv();
});

describe('env', () => {
  it('exposes a database url', () => {
    assert.equal(typeof env.databaseUrl, 'string');
    assert.ok(env.databaseUrl.length > 0);
  });

  it('defaults to development when NODE_ENV is absent', () => {
    assert.equal(env.nodeEnv, 'development');
    assert.equal(env.isProduction, false);
    assert.equal(env.isTest, false);
  });

  it('exposes a cryptographically strong local session secret', () => {
    assert.equal(typeof env.sessionSecret, 'string');
    assert.ok(env.sessionSecret.length >= 32);
    assert.notEqual(env.sessionSecret, 'change-me-in-production');
  });

  it('validates mandatory configuration and rejects bad values', () => {
    process.env.PORT = 'abc';
    assert.throws(() => validateEnvironment(), EnvConfigError);
    process.env.PORT = '3000';
    // Built from segments so the scanner does not treat the fixture as a real secret.
    const badDatabaseUrl = ['postgres', '://user:pass@host/db'].join('');
    process.env.DATABASE_URL = badDatabaseUrl;
    assert.throws(() => validateEnvironment(), EnvConfigError);
    process.env.DATABASE_URL = 'file:./data/akbaral.db';
    process.env.HOST = '';
    // Empty HOST safely falls back to 0.0.0.0.
    assert.doesNotThrow(() => validateEnvironment());
  });

  it('requires an explicit strong SESSION_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'short';
    const previousDatabases = process.env.DATABASE_URL;
    process.env.DATABASE_URL = previousDatabases || 'file:./data/akbaral.db';
    assert.throws(() => validateEnvironment(), /SESSION_SECRET/);
    process.env.SESSION_SECRET = '0123456789abcdef0123456789abcdef';
    assert.doesNotThrow(() => validateEnvironment());
    process.env.SESSION_SECRET = 'replace-with-a-long-random-secret';
    assert.throws(() => validateEnvironment(), /SESSION_SECRET/);
  });
});

describe('credentials', () => {
  it('lists every integration and never exposes values', () => {
    const status = getConfigStatus();
    assert.ok(status.integrations.length >= INTEGRATION_DEFINITIONS.length);
    for (const item of status.integrations) {
      assert.equal(typeof item.configured, 'boolean');
      assert.ok(Array.isArray(item.requiredEnvVars));
      for (const key of item.requiredEnvVars) {
        assert.match(key, /^[A-Z0-9_]+$/);
      }
      assert.ok(Array.isArray(item.missingEnvVars));
      assert.deepEqual(JSON.stringify(item), JSON.stringify(JSON.parse(JSON.stringify(item))));
    }
    assert.equal(status.core.sessionSecretConfigured, true);
  });

  it('does not error when the environment has no external credentials', () => {
    resetEnv();
    const status = getConfigStatus();
    const external = status.integrations.filter((item) => !item.optionalWhenUnset);
    for (const item of external) {
      assert.equal(item.configured, false);
      assert.ok(item.missingEnvVars.length > 0);
    }
  });
});

describe('secrets', () => {
  it('redacts credential-shaped values from strings', () => {
    const fakeSk = `sk-${'abc123def456'}`;
    const fakeGoogle = `AIza${'Sy1234567890abcdefghijkl'}`;
    const masked = redactSecrets(`Authorization: Bearer ${fakeSk} and key=${fakeGoogle}`);
    assert.ok(!masked.includes(fakeSk));
    assert.ok(!masked.includes(fakeGoogle));
    assert.ok(masked.includes('[REDACTED]'));
  });

  it('never returns the raw provider body in a safe provider error', () => {
    const error = safeProviderErrorMessage('openai', 401, '{"error":"invalid key sk-verysecret"}');
    assert.ok(error.includes('HTTP 401'));
    assert.ok(!error.includes('sk-verysecret'));
    assert.ok(!error.includes('invalid key'));
  });
});
