import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { env } from './env';

describe('env', () => {
  it('exposes a database url', () => {
    assert.equal(typeof env.databaseUrl, 'string');
    assert.ok(env.databaseUrl.length > 0);
  });

  it('defaults to development when NODE_ENV is absent', () => {
    assert.equal(env.nodeEnv, 'development');
    assert.equal(env.isProduction, false);
  });

  it('exposes an authentication session secret placeholder', () => {
    assert.equal(typeof env.sessionSecret, 'string');
    assert.ok(env.sessionSecret.length > 0);
  });
});
