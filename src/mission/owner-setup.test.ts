/**
 * ZA141251SA — one-time owner password setup link.
 *
 * Requirements under test:
 *  - the link is single-use, time-limited and attempt-limited;
 *  - it can only ever re-key the configured mission identity;
 *  - the password is stored as a scrypt hash and never lands in the token
 *    state file or the verification report;
 *  - a verification report cannot be filed by a client that never held a
 *    mission session.
 *
 * Runs against a throwaway mission database in the system temp directory.
 */
const os = require('node:os') as typeof import('node:os');
const nodePath = require('node:path') as typeof import('node:path');

const TMP_DIR = nodePath.join(os.tmpdir(), `za141251sa-setup-${process.pid}`);
require('node:fs').mkdirSync(TMP_DIR, { recursive: true });

process.env.ZA141251SA_DATABASE_URL = `file:${nodePath.join(TMP_DIR, 'mission.db')}`;
process.env.ZA141251SA_SESSION_SECRET = 'test-session-secret-0123456789abcdefghijklmnop';
process.env.ZA141251SA_CREDENTIAL_KEY = 'test-credential-key-0123456789abcdefghijklmn';
process.env.ZA141251SA_OWNER_EMAIL = 'zanaveed555@gmail.com';

import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMissionMigrations, missionDb, type Row } from './database';
import { MissionAuthError, login, logout } from './auth';
import {
  attestRecentSession,
  clearOwnerSetupToken,
  completeOwnerSetup,
  issueOwnerSetupToken,
  maskedOwnerEmail,
  ownerSetupAvailability,
  ownerSetupPageServable,
  ownerSetupStatePath,
  recordOwnerSetupVerification,
  verificationReportPath,
} from './owner-setup';

const OWNER = 'zanaveed555@gmail.com';
const PASSWORD = 'setup-link-password-9713';

applyMissionMigrations();

test('no setup surface exists until a link is issued', () => {
  clearOwnerSetupToken();
  assert.equal(ownerSetupAvailability().available, false);
  assert.equal(ownerSetupPageServable(), false);
  assert.throws(() => completeOwnerSetup({ token: 'anything', password: PASSWORD }), (error: unknown) => {
    assert.ok(error instanceof MissionAuthError);
    assert.equal(error.statusCode, 404);
    return true;
  });
});

test('the issued link masks the identity and never stores the password', () => {
  const { token, expiresAt } = issueOwnerSetupToken(30);
  const availability = ownerSetupAvailability();
  assert.equal(availability.available, true);
  assert.equal(availability.maskedEmail, maskedOwnerEmail(OWNER));
  assert.ok(!String(availability.maskedEmail).includes('zanaveed555'));
  assert.ok(Date.parse(expiresAt) > Date.now());

  // The token is stored as a digest, not in the clear.
  const state = fs.readFileSync(ownerSetupStatePath(), 'utf8');
  assert.ok(!state.includes(token));

  const result = completeOwnerSetup({ token, password: PASSWORD });
  assert.equal(result.ok, true);
  assert.equal(result.email, OWNER);

  const stored = missionDb.get<Row>('SELECT password_hash FROM mission_owner WHERE email = ?', [OWNER]);
  assert.ok(String(stored?.password_hash).startsWith('scrypt$'));
  assert.ok(!String(stored?.password_hash).includes(PASSWORD));
  assert.ok(!fs.readFileSync(ownerSetupStatePath(), 'utf8').includes(PASSWORD));

  // The new password authenticates.
  const session = login({ email: OWNER, password: PASSWORD });
  assert.ok(session.token.length > 20);
});

test('a consumed link cannot be replayed, though the page keeps a grace window', () => {
  const state = JSON.parse(fs.readFileSync(ownerSetupStatePath(), 'utf8'));
  assert.ok(state.consumedAt, 'the link records its consumption');
  assert.equal(ownerSetupAvailability().available, false);
  assert.equal(ownerSetupPageServable(), true);
  assert.throws(() => completeOwnerSetup({ token: 'replayed', password: PASSWORD }), MissionAuthError);
});

test('a wrong token is refused and burns the link after repeated attempts', () => {
  issueOwnerSetupToken(30);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.throws(() => completeOwnerSetup({ token: `wrong-${attempt}`, password: PASSWORD }), MissionAuthError);
  }
  assert.equal(ownerSetupAvailability().available, false, 'the link is burned after too many attempts');
});

test('a weak password is rejected without consuming the link', () => {
  const { token } = issueOwnerSetupToken(30);
  assert.throws(() => completeOwnerSetup({ token, password: 'short' }), (error: unknown) => {
    assert.ok(error instanceof MissionAuthError);
    assert.equal(error.statusCode, 400);
    return true;
  });
  assert.equal(ownerSetupAvailability().available, true);
  assert.equal(completeOwnerSetup({ token, password: PASSWORD }).ok, true);
});

test('verification reports require a real mission session and store booleans only', () => {
  assert.equal(attestRecentSession(null), false);
  assert.equal(attestRecentSession('not-a-session-token'), false);

  const session = login({ email: OWNER, password: PASSWORD });
  assert.equal(attestRecentSession(session.token), true);
  // Still attested after sign-out: the report is filed once logout is proven.
  logout(session.token);
  assert.equal(attestRecentSession(session.token), true);

  const checks = recordOwnerSetupVerification({
    password_set: true,
    owner_login: true,
    session_persists_across_reload: true,
    logout_clears_session: true,
    foreign_identity_denied: true,
    wrong_password_denied: true,
    // Anything not on the fixed allowlist is dropped, so nothing free-form
    // (and therefore nothing secret) can reach the report.
    injected: PASSWORD,
  } as Record<string, unknown>);
  assert.equal(Object.keys(checks).length, 6);
  const report = fs.readFileSync(verificationReportPath(), 'utf8');
  assert.ok(!report.includes(PASSWORD));
  assert.ok(!report.includes(OWNER), 'the report masks the owner address');
});

test('the link keys the configured identity only — the client cannot choose one', () => {
  const { token } = issueOwnerSetupToken(30);
  // An email supplied by the client is ignored: completeOwnerSetup takes the
  // address from ZA141251SA_OWNER_EMAIL and nothing else.
  const result = completeOwnerSetup({
    token,
    password: PASSWORD,
    email: 'attacker@example.com',
  } as unknown as { token: string; password: string });
  assert.equal(result.email, OWNER);
  assert.equal(missionDb.get<Row>('SELECT id FROM mission_owner WHERE email = ?', ['attacker@example.com']), undefined);
  clearOwnerSetupToken();
});

test('no setup link can be issued without a configured mission identity', () => {
  delete process.env.ZA141251SA_OWNER_EMAIL;
  assert.throws(() => issueOwnerSetupToken(30), (error: unknown) => {
    assert.ok(error instanceof MissionAuthError);
    assert.equal(error.statusCode, 400);
    return true;
  });
  process.env.ZA141251SA_OWNER_EMAIL = OWNER;
});
