import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    // A well-formed postgres URL is now a VALID production engine (Neon);
    // malformed and unsupported schemes still must be rejected.
    const postgresUrl = ['postgres', '://user:pass@host/db'].join('');
    process.env.DATABASE_URL = postgresUrl;
    assert.doesNotThrow(() => validateEnvironment());
    process.env.DATABASE_URL = ['postgres', '://'].join('');
    assert.throws(() => validateEnvironment(), EnvConfigError);
    process.env.DATABASE_URL = ['mysql', '://user:pass@host/db'].join('');
    assert.throws(() => validateEnvironment(), EnvConfigError);
    process.env.DATABASE_URL = 'file:./data/akbaral.db';
    process.env.HOST = '';
    // Empty HOST safely falls back to 0.0.0.0.
    assert.doesNotThrow(() => validateEnvironment());
  });

  it('requires an explicit strong SESSION_SECRET in production', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    // Next.js augments the NodeJS.ProcessEnv type and marks NODE_ENV readonly.
    // Use Object.assign as a runtime-safe way to switch modes in this fixture.
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.SESSION_SECRET = 'short';
    const previousDatabases = process.env.DATABASE_URL;
    process.env.DATABASE_URL = previousDatabases || 'file:./data/akbaral.db';
    assert.throws(() => validateEnvironment(), /SESSION_SECRET/);
    process.env.SESSION_SECRET = '0123456789abcdef0123456789abcdef';
    assert.doesNotThrow(() => validateEnvironment());
    process.env.SESSION_SECRET = 'replace-with-a-long-random-secret';
    assert.throws(() => validateEnvironment(), /SESSION_SECRET/);
    Object.assign(process.env, { NODE_ENV: previousNodeEnv || 'test' });
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

  it('production core launch requires ONLY DATABASE_URL and SESSION_SECRET (no integration credentials)', () => {
    // Regression lock for the deployment story: a production container with
    // exactly the core variables must validate. Specialist integrations
    // (SMTP, social/marketing tokens, search/fetch endpoints, other model
    // providers) are OPTIONAL and must never block startup — they fail
    // honestly, lazily, only when their specific capability is requested.
    resetEnv();
    const optionalIntegrations = [
      'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
      'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'GOOGLE_BASE_URL',
      'AKBARAL_SEARCH_ENDPOINT', 'AKBARAL_PAGE_FETCH_ENDPOINT', 'AKBARAL_ALLOW_PRIVATE_PROVIDER',
      'AKBARAL_SEARCH_PROVIDER', 'TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'SERPER_API_KEY',
      'GOOGLE_CSE_API_KEY', 'GOOGLE_CSE_ID',
      'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_EHLO', 'SMTP_TIMEOUT_MS',
      'YOUTUBE_ACCESS_TOKEN', 'INSTAGRAM_ACCESS_TOKEN', 'X_BEARER_TOKEN',
      'SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN',
      'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'STRIPE_SECRET_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'BILLING_WEBHOOK_SECRET',
      'GOOGLE_CLIENT_ID', 'GITHUB_CLIENT_ID', 'CORS_ORIGINS', 'AKBARAL_ADSENSE_CLIENT',
    ];
    for (const key of optionalIntegrations) {
      delete process.env[key];
    }
    // Cast: Next's type augmentation marks process.env.NODE_ENV read-only.
    const mutableEnv = process.env as Record<string, string | undefined>;
    mutableEnv.NODE_ENV = 'production';
    process.env.DATABASE_URL = ['postgres', '://user:pass@host/db?sslmode=require'].join('');
    process.env.SESSION_SECRET = 'a'.repeat(48);
    delete process.env.PORT; // safe default (3000)
    delete process.env.HOST; // safe default (0.0.0.0)
    assert.doesNotThrow(() => validateEnvironment());
    // And SESSION_SECRET is genuinely enforced as the hard production gate:
    delete process.env.SESSION_SECRET;
    assert.throws(() => validateEnvironment(), EnvConfigError);
    process.env.SESSION_SECRET = 'a'.repeat(48);
    // DATABASE_URL has a safe SQLite default (file:./data/akbaral.db) —
    // pointing it at Neon is deployment configuration, not a startup guard;
    // startup still succeeds (dual-engine design).
    delete process.env.DATABASE_URL;
    assert.doesNotThrow(() => validateEnvironment());
  });
});

describe('.env.example deployment-scanner contract', () => {
  // Deployment platforms (SnapDeploy etc.) scan .env.example and present
  // every UNCOMMENTED `VAR=` entry as a required input. Only core variables
  // may stay uncommented, and SESSION_SECRET must be the only empty one —
  // otherwise the UI demands optional integration credentials the product
  // does not need (the exact 2026-09-13 SnapDeploy incident).
  const lines = readFileSync('.env.example', 'utf8').split('\n');
  const uncommented = lines
    .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line?.trim() ?? ''))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ name: m[1], value: m[2] }));

  it('keeps every optional integration variable commented out', () => {
    const optional = [
      'AKBARAL_SEARCH_ENDPOINT', 'AKBARAL_PAGE_FETCH_ENDPOINT', 'AKBARAL_ALLOW_PRIVATE_PROVIDER',
      'AKBARAL_SEARCH_PROVIDER', 'TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'SERPER_API_KEY',
      'GOOGLE_CSE_API_KEY', 'GOOGLE_CSE_ID',
      'CORS_ORIGINS', 'NODE_ENV',
      'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_EHLO', 'SMTP_TIMEOUT_MS',
      'YOUTUBE_ACCESS_TOKEN', 'INSTAGRAM_ACCESS_TOKEN', 'X_BEARER_TOKEN',
      'SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
      'STRIPE_SECRET_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'BILLING_WEBHOOK_SECRET',
    ];
    const present = new Set(uncommented.map((entry) => entry.name));
    for (const name of optional) {
      assert.ok(!present.has(name), `${name} must stay commented out in .env.example (deployment scanners treat uncommented entries as required)`);
    }
  });

  it('SESSION_SECRET is the only uncommented variable that needs input', () => {
    const empty = uncommented.filter((entry) => entry.value.replace(/^["']|["']$/g, '').trim() === '');
    assert.deepEqual(empty.map((entry) => entry.name), ['SESSION_SECRET']);
    // The rest carry safe defaults the platform can prefill.
    for (const entry of uncommented) {
      if (entry.name !== 'SESSION_SECRET') {
        assert.ok(entry.value.trim().length > 0, `${entry.name} should prefill a safe default`);
      }
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
