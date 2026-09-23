import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${path.join(os.tmpdir(), `intl-reg-${randomUUID()}.db`)}`;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'synthetic-intl-reg-tests-not-live';

// Run platform DB migrations
import { runMigrate } from '../db/migrate';
runMigrate();

import { after, it, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, createUser, findUserById } from '../db';

const keepAlive = setInterval(() => {}, 1000);
after(() => { try { db.close(); } finally { clearInterval(keepAlive); } });

describe('international customer registration', () => {
  it('registration accepts country field in metadata', () => {
    const user = createUser({
      email: `test-pk-${randomUUID().slice(0,8)}@international.test`,
      name: 'Pakistan User',
      metadata: { country: 'PK', signup: true },
    });
    assert.ok(user.id, 'User should be created');
    assert.equal(user.email.toLowerCase().includes('test-pk'), true);

    // Verify country is stored in metadata
    const found = findUserById(user.id);
    assert.ok(found, 'User should be found');
    assert.ok(found.metadata, 'Metadata should be stored');
    const meta = JSON.parse(found.metadata!);
    assert.equal(meta.country, 'PK', 'Country should be stored in metadata');
  });

  it('registration works without country field (backward compatible)', () => {
    const user = createUser({
      email: `test-nocountry-${randomUUID().slice(0,8)}@international.test`,
      name: 'No Country User',
    });
    assert.ok(user.id);

    const found = findUserById(user.id);
    assert.ok(found);
    // metadata should exist (may be null or default)
    if (found.metadata) {
      const meta = JSON.parse(found.metadata);
      assert.equal(meta.country, undefined, 'No country should be set');
    }
  });

  it('registration works for users from various countries', () => {
    const countries = ['US', 'GB', 'DE', 'IN', 'BR', 'JP', 'AU', 'CA', 'PH', 'NG', 'KE', 'ZA'];
    for (const country of countries) {
      const user = createUser({
        email: `test-${country.toLowerCase()}-${randomUUID().slice(0,8)}@international.test`,
        name: `${country} User`,
        metadata: { country },
      });
      assert.ok(user.id, `User from ${country} should be created`);

      const found = findUserById(user.id);
      const meta = JSON.parse(found!.metadata!);
      assert.equal(meta.country, country, `Country ${country} should be stored`);
    }
  });

  it('registration does NOT restrict by country (no geo-blocking)', () => {
    // Verify there's no country validation or restriction in createUser
    // Even sanctioned countries should be able to register (access may be limited elsewhere)
    const user = createUser({
      email: `test-sanctioned-${randomUUID().slice(0,8)}@international.test`,
      name: 'Sanctioned Country User',
      metadata: { country: 'CU' },
    });
    assert.ok(user.id, 'User from sanctioned country should still be able to register');
    assert.equal(user.status, 'active', 'User should be active');
  });

  it('email-based registration is unique regardless of country', () => {
    const email = `duplicate-${randomUUID().slice(0,8)}@international.test`;
    createUser({ email, name: 'First', metadata: { country: 'US' } });

    // Second registration with same email should fail
    assert.throws(
      () => createUser({ email, name: 'Second', metadata: { country: 'PK' } }),
      /unique|duplicate|already/i,
      'Duplicate email should be rejected regardless of country'
    );
  });
});

describe('auth service — country in user view', () => {
  it('toUserView includes country from metadata', async () => {
    const { register } = await import('../auth/service');
    const email = `viewservice-${randomUUID().slice(0,8)}@international.test`;
    const user = await register({
      email,
      password: 'StrongPass!123',
      name: 'View Test User',
      metadata: { country: 'DE' },
    });

    assert.ok(user.id, 'User should be registered');
    assert.equal(user.country, 'DE', 'Country should be included in user view');
  });

  it('toUserView returns null country when not set', async () => {
    const { register } = await import('../auth/service');
    const email = `viewnocountry-${randomUUID().slice(0,8)}@international.test`;
    const user = await register({
      email,
      password: 'StrongPass!123',
      name: 'No Country View Test',
    });

    assert.ok(user.id);
    // country should be null or undefined when not set
    assert.ok(user.country === null || user.country === undefined, 'Country should be null when not set');
  });
});
