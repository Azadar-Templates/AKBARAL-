import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { register, login, logout, rotateRefreshSession, validateRefreshToken } from './service';
import { db, findUserByEmail } from '../db';

const suffix = randomBytes(6).toString('hex');
const email = `auth-${suffix}@akbaral.test`;
let userId = '';
let refresh = '';

describe('authentication service', () => {
  before(async () => {
    await register({ email, password: 'correct-horse-battery-staple', name: 'Auth Test User' });
    const user = findUserByEmail(email);
    assert.ok(user);
    userId = user.id;

    const result = await login({
      email,
      password: 'correct-horse-battery-staple',
      ipAddress: '127.0.0.1',
      userAgent: 'node-test',
    });
    refresh = result.refreshToken;
    assert.ok(result.accessToken.length > 0);
  });

  after(() => {
    db.run('DELETE FROM users WHERE id = ?', [userId]);
    db.close();
  });

  it('registers a user with a hashed password and a credit account', () => {
    const user = findUserByEmail(email);
    assert.ok(user);
    assert.notEqual(user.password_hash, 'correct-horse-battery-staple');
  });

  it('rejects duplicate registration', async () => {
    await assert.rejects(
      () => register({ email, password: 'another-password' }),
      /already registered/,
    );
  });

  it('logs in and produces a valid refresh token', () => {
    const resolved = validateRefreshToken(refresh);
    assert.equal(resolved, userId);
  });

  it('does not accept wrong passwords', async () => {
    await assert.rejects(
      () => login({ email, password: 'wrong-password' }),
      /invalid email or password/,
    );
  });

  it('rotates refresh sessions and invalidates the old token', () => {
    const next = rotateRefreshSession(userId, refresh);
    assert.equal(validateRefreshToken(next.refreshToken), userId);
    assert.equal(validateRefreshToken(refresh), null, 'old refresh token must be revoked on rotation');
    logout(next.refreshToken);
    assert.equal(validateRefreshToken(next.refreshToken), null);
  });
});
