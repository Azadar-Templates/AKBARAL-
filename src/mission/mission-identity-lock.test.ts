/**
 * ZA141251SA — single-identity lockdown tests.
 *
 * Requirement under test: ONLY the configured mission identity may
 * authenticate, and every other identity is blocked with ZERO mission-data
 * access — including accounts and sessions that existed before the lockdown
 * was switched on.
 *
 * Runs against a throwaway mission database in the system temp directory and
 * never touches the platform database or a running server.
 */
process.env.ZA141251SA_DATABASE_URL = `file:${require('node:path').join(require('node:os').tmpdir(), `za141251sa-lock-${process.pid}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'test-session-secret-0123456789abcdefghijklmnop';
process.env.ZA141251SA_CREDENTIAL_KEY = 'test-credential-key-0123456789abcdefghijklmn';
process.env.ZA141251SA_CURRENCY = 'USD';
delete process.env.ZA141251SA_OWNER_EMAIL;

import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMissionMigrations, missionDb, nowIso, sha256, appendMissionAudit, type Row } from './database';
import { MissionAuthError, createAccessLink, listAccessLinks, login, provisionOwner, resolveAccessLink, resolveSession } from './auth';
import {
  activeForeignOwnerCount,
  configuredMissionOwnerEmail,
  enforceIdentityLock,
  identityLockEnabled,
  identityLockStatus,
  identityLockVerified,
  isIdentityPermitted,
  liveForeignSessionCount,
  provisioningRefusalReason,
} from './identity-lock';

const OWNER = 'zanaveed555@gmail.com';
const OWNER_PASSWORD = 'owner-password-123456';
const FOREIGN = 'someone-else@example.com';
const FOREIGN_PASSWORD = 'foreign-password-123456';

applyMissionMigrations();

function sessionCountFor(email: string): number {
  return Number(
    missionDb.get<Row>(
      `SELECT COUNT(*) AS count FROM mission_sessions s JOIN mission_owner o ON o.id = s.owner_id
        WHERE lower(o.email) = ? AND s.revoked_at IS NULL`,
      [email],
    )?.count ?? 0,
  );
}

test('lockdown is OFF and honest when no identity is configured', () => {
  assert.equal(configuredMissionOwnerEmail(), null);
  assert.equal(identityLockEnabled(), false);
  assert.equal(isIdentityPermitted('anyone@example.com'), true);
  assert.equal(provisioningRefusalReason('anyone@example.com'), null);
  const status = identityLockStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.enforcedAt, null);
  const verified = identityLockVerified();
  assert.equal(verified.ok, false, 'an un-configured lockdown must never report itself as verified');
  assert.match(String(verified.reason), /not configured/);
  // The page it reports is safe by construction: MissionAuthError is the type
  // the HTTP layer maps to a status code.
  assert.ok(new MissionAuthError(403, 'x', 'identity_restricted') instanceof Error);
});

test('pre-lockdown world: a second account can exist (so the sweep has work to do)', () => {
  provisionOwner({ email: OWNER, password: OWNER_PASSWORD, displayName: 'Owner' });
  provisionOwner({ email: FOREIGN, password: FOREIGN_PASSWORD, displayName: 'Former operator' });
  const ownerSession = login({ email: OWNER, password: OWNER_PASSWORD });
  const foreignSession = login({ email: FOREIGN, password: FOREIGN_PASSWORD });
  assert.equal(sessionCountFor(OWNER), 1);
  assert.equal(sessionCountFor(FOREIGN), 1);
  assert.equal(resolveSession(foreignSession.token)?.owner.email, FOREIGN);
  // A pre-existing, unrevoked access link — the "everything else" case.
  const link = createAccessLink({ label: 'pre-lockdown operator link', scope: 'dashboard:read' });
  assert.ok(resolveAccessLink(link.token), 'link is usable before the lockdown');
  // Keep the owner session for the post-lockdown assertions.
  assert.equal(resolveSession(ownerSession.token)?.owner.email, OWNER);
});

test('with the lockdown ON: only the configured identity can authenticate', () => {
  process.env.ZA141251SA_OWNER_EMAIL = OWNER;
  assert.equal(configuredMissionOwnerEmail(), OWNER);
  assert.equal(identityLockEnabled(), true);
  assert.equal(isIdentityPermitted(OWNER), true);
  assert.equal(isIdentityPermitted(OWNER.toUpperCase()), true, 'comparison is case-insensitive');
  assert.equal(isIdentityPermitted(FOREIGN), false);

  // A foreign login is refused even with the CORRECT password: the refusal is
  // an allowlist decision, not a credential outcome.
  assert.throws(
    () => login({ email: FOREIGN, password: FOREIGN_PASSWORD }),
    (error: unknown) => error instanceof MissionAuthError && error.statusCode === 403 && error.code === 'identity_restricted',
  );
  // The refusal text never discloses the configured address.
  const refusal = provisioningRefusalReason(FOREIGN)!;
  assert.ok(!refusal.includes(OWNER), 'the refusal must not echo the configured identity');
  assert.match(refusal, /single configured identity/);
});

test('with the lockdown ON: a second mission account cannot be provisioned', () => {
  assert.throws(
    () => provisionOwner({ email: 'second-owner@example.com', password: 'another-password-123456' }),
    (error: unknown) => error instanceof MissionAuthError && error.statusCode === 403 && error.code === 'identity_restricted',
  );
  assert.equal(missionDb.get<Row>('SELECT id FROM mission_owner WHERE email = ?', ['second-owner@example.com']), undefined);
  // Re-keying the configured identity stays allowed (that is the owner's own
  // password rotation path).
  assert.equal(provisioningRefusalReason(OWNER), null);
});

test('enforcement sweep suspends foreign accounts, revokes their sessions and pre-existing links', () => {
  const enforcement = enforceIdentityLock();
  assert.equal(enforcement.swept, true, 'the first enforcement must perform the sweep');
  assert.equal(enforcement.foreignActiveOwners, 0, 'no foreign account may remain active');
  assert.equal(activeForeignOwnerCount(), 0);
  assert.equal(liveForeignSessionCount(), 0);

  const foreignRow = missionDb.get<Row>('SELECT status FROM mission_owner WHERE lower(email) = ?', [FOREIGN])!;
  assert.equal(String(foreignRow.status), 'suspended');
  assert.equal(sessionCountFor(FOREIGN), 0, 'every foreign session is revoked, not merely ignored');
  assert.equal(listAccessLinks().every((entry) => entry.revokedAt !== null), true, 'pre-existing access links are revoked');
  assert.equal(identityLockStatus().ownersSuspended >= 1, true);
  assert.equal(identityLockStatus().sessionsRevoked >= 1, true);
  assert.equal(identityLockStatus().linksRevoked >= 1, true);

  // Enforcement is idempotent and audits itself.
  const second = enforceIdentityLock();
  assert.equal(second.swept, false, 'a second boot must not re-run the destructive sweep');
  const audit = missionDb.get<Row>("SELECT COUNT(*) AS count FROM mission_audit WHERE action = 'identity_lock.enforced'")!;
  assert.equal(Number(audit.count), 1);
});

test('a foreign session minted before the lockdown is refused AND revoked on use', () => {
  // Simulate a session that survived the sweep: insert one directly, the way
  // a session row from an older deployment would look.
  const foreignOwner = missionDb.get<Row>('SELECT id FROM mission_owner WHERE lower(email) = ?', [FOREIGN])!;
  const rawToken = 'pre-lockdown-token';
  missionDb.run(
    `INSERT INTO mission_sessions (id, owner_id, token_hash, csrf_hash, expires_at) VALUES (?, ?, ?, ?, ?)`,
    ['ses_prelock', String(foreignOwner.id), sha256(rawToken), null, new Date(Date.now() + 3600_000).toISOString()],
  );
  assert.equal(resolveSession(rawToken), null, 'a foreign session must never resolve');
  const row = missionDb.get<Row>('SELECT revoked_at FROM mission_sessions WHERE id = ?', ['ses_prelock'])!;
  assert.ok(row.revoked_at, 'the refused session is revoked so it fails closed everywhere');
});

test('the configured identity still authenticates, reads, and is the only live session', () => {
  const session = login({ email: OWNER, password: OWNER_PASSWORD });
  assert.equal(session.owner.email, OWNER);
  assert.equal(session.owner.role, 'owner');
  const resolved = resolveSession(session.token);
  assert.equal(resolved?.owner.email, OWNER);
  assert.equal(liveForeignSessionCount(), 0);
  const verified = identityLockVerified();
  assert.equal(verified.ok, true, `lockdown must be verified clean, got: ${verified.reason}`);
  assert.equal(verified.reason, null);
});

test('changing the configured identity re-sweeps and invalidates the old identity', () => {
  process.env.ZA141251SA_OWNER_EMAIL = 'new-owner@example.com';
  const enforcement = enforceIdentityLock();
  assert.equal(enforcement.swept, true, 'an identity change must re-run the sweep');
  assert.equal(enforcement.configuredEmail, 'new-owner@example.com');
  // The previous identity is suspended, so its still-valid token resolves to
  // nothing.
  const previousOwner = missionDb.get<Row>('SELECT status FROM mission_owner WHERE lower(email) = ?', [OWNER])!;
  assert.equal(String(previousOwner.status), 'suspended');
  assert.equal(liveForeignSessionCount(), 0);
  assert.equal(identityLockStatus().linksRevoked >= 1, true);
  // And the new identity is the only one that may authenticate.
  assert.equal(isIdentityPermitted(OWNER), false);
  assert.equal(isIdentityPermitted('new-owner@example.com'), true);
});

test('audit detail records a fingerprint, never the raw address', () => {
  appendMissionAudit({ actorType: 'system', action: 'test.marker' });
  const rows = missionDb.all<Row>("SELECT detail FROM mission_audit WHERE action = 'identity_lock.enforced'");
  for (const row of rows) {
    const detail = String(row.detail);
    assert.ok(!detail.includes('zanaveed555@gmail.com'), 'the audit chain must not carry the raw identity');
    assert.ok(!detail.includes('new-owner@example.com'), 'the audit chain must not carry the raw identity');
    assert.ok(detail.includes('…@'), 'a masked fingerprint is expected instead');
  }
  assert.equal(nowIso().endsWith('Z'), true);
});
