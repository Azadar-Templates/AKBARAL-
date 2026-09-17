import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, hashToken, newBearerToken } from './password';

describe('password & token security', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    assert.notEqual(hash, 'correct-horse-battery-staple');
    assert.ok(hash.startsWith('scrypt$'));
    assert.equal(await verifyPassword('correct-horse-battery-staple', hash), true);
    assert.equal(await verifyPassword('wrong-password', hash), false);
  });

  it('produces distinct salts per hash', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    assert.notEqual(a, b);
  });

  it('hashes bearer tokens and generates 256-bit tokens', () => {
    const token = newBearerToken();
    assert.equal(token.length >= 32, true);
    const hash = hashToken(token);
    assert.equal(hashToken(token), hash);
    assert.notEqual(hashToken('other'), hash);
  });
});
