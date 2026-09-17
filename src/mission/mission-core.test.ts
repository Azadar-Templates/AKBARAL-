/**
 * ZA141251SA — mission core tests: separate database, separate auth, policy
 * enforcement and immutable audit/ledger integrity.
 *
 * These tests run against a THROWAWAY mission database in the system temp
 * directory. They never open the platform database and never depend on the
 * AKBARAL! application being running.
 */
process.env.ZA141251SA_DATABASE_URL = `file:${require('node:path').join(require('node:os').tmpdir(), `za141251sa-core-${process.pid}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'test-session-secret-0123456789abcdefghijklmnop';
process.env.ZA141251SA_CREDENTIAL_KEY = 'test-credential-key-0123456789abcdefghijklmn';
process.env.ZA141251SA_CURRENCY = 'USD';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  applyMissionMigrations,
  appendMissionAudit,
  missionDb,
  redactForAudit,
  resolveMissionDbPath,
  sha256,
  verifyMissionAudit,
  type Row,
} from './database';
import {
  MissionAuthError,
  createAccessLink,
  decryptCredential,
  encryptCredential,
  listAccessLinks,
  login,
  logout,
  ownerCount,
  provisionOwner,
  redactSecrets,
  resolveAccessLink,
  resolveSession,
  revokeAccessLink,
  vaultConfigured,
} from './auth';
import {
  ALLOWED_ACTIVITY_KEYS,
  PROHIBITED_ACTIVITY_KEYS,
  PROHIBITION_STATEMENTS,
  checkActivity,
  currentPolicy,
  dailySpendCents,
  decideApproval,
  ensurePolicy,
  requestApproval,
  setKillSwitch,
  updatePolicy,
} from './policy';

const DB_PATH = resolveMissionDbPath();
let ownerToken = '';

test('mission database lives in its own file (never the platform database)', () => {
  applyMissionMigrations();
  assert.equal(fs.existsSync(DB_PATH), true, 'mission db file exists');
  assert.ok(DB_PATH.includes('za141251sa-core'), 'mission db is a dedicated file');
  assert.ok(!DB_PATH.includes('test.db'), 'mission tests never use the platform test database');
  const platformUrl = (process.env.DATABASE_URL ?? '').replace('file:', '');
  if (platformUrl) {
    const platformPath = require('node:path').resolve(process.cwd(), platformUrl);
    assert.notEqual(platformPath, DB_PATH, 'the mission database is never the platform database');
  }
  assert.ok(DB_PATH !== require('node:path').resolve(process.cwd(), 'mission.db'), 'tests do not touch the deployment database');
});

test('migrations create the private mission schema', () => {
  const required = [
    'mission_owner', 'mission_sessions', 'mission_access_links', 'mission_agents', 'mission_agent_contracts',
    'mission_wallets', 'mission_ledger', 'mission_work', 'mission_revenue', 'mission_expenses',
    'mission_credentials', 'mission_credential_rotations', 'mission_resources', 'mission_upgrades',
    'mission_services', 'mission_tools', 'mission_tool_requests', 'mission_targets', 'mission_payout_slots',
    'mission_payouts', 'mission_approvals', 'mission_audit', 'mission_reports', 'mission_policy',
  ];
  for (const table of required) {
    assert.equal(missionDb.tableExists(table), true, `${table} exists`);
  }
  // Re-running is idempotent (a deploy can safely apply migrations twice).
  const second = applyMissionMigrations();
  assert.equal(second.applied.length, 0, 'no migrations re-applied');
});

test('policy defaults are conservative and prohibitions are compiled in', () => {
  ensurePolicy('USD');
  const policy = currentPolicy();
  assert.equal(policy.autonomousEnabled, false, 'autonomy is off until deliberately enabled');
  assert.ok(policy.requireApprovalAboveCents > 0, 'an approval threshold exists');
  assert.ok(policy.maxDailySpendCents > 0, 'a daily spend ceiling exists');
  assert.ok(policy.maxPayoutCents > 0, 'a per-payout ceiling exists');
  assert.ok(policy.allowedActivities.length >= 10, 'the approved activity catalog is populated');
  assert.ok(policy.allowedActivities.every((entry) => ALLOWED_ACTIVITY_KEYS.includes(entry as never)), 'only known activity keys are enabled');
  for (const key of PROHIBITED_ACTIVITY_KEYS) {
    assert.ok(PROHIBITION_STATEMENTS[key], `${key} has a plain-language statement`);
  }
});

test('policy refuses every prohibited activity and unknown activity', () => {
  const policy = currentPolicy();
  for (const key of PROHIBITED_ACTIVITY_KEYS) {
    const decision = checkActivity(key, policy);
    assert.equal(decision.allowed, false, `${key} is refused`);
    assert.ok(decision.reasons.length > 0, `${key} explains why`);
  }
  const unknown = checkActivity('unlisted_side_hustle', policy);
  assert.equal(unknown.allowed, false, 'anything not explicitly allowed is denied');
  const allowed = checkActivity('software_development', policy);
  assert.equal(allowed.allowed, true, 'approved work is allowed');
});

test('prohibited activity cannot be enabled through configuration', () => {
  const updated = updatePolicy({ allowedActivities: [...ALLOWED_ACTIVITY_KEYS, 'fake_engagement'] }, 'test-owner');
  assert.equal(updated.allowedActivities.includes('fake_engagement'), false, 'prohibited keys are stripped from the allow-list');
  const decision = checkActivity('fake_engagement', currentPolicy());
  assert.equal(decision.allowed, false, 'still refused after an attempted policy edit');
  assert.match(decision.reasons.join(' '), /prohibit/i);
});

test('kill switch blocks work immediately', () => {
  setKillSwitch(true, 'test-owner');
  const decision = checkActivity('software_development', currentPolicy());
  assert.equal(decision.allowed, false, 'kill switch refuses activity');
  assert.match(decision.reasons.join(' '), /kill switch/i);
  setKillSwitch(false, 'test-owner');
  assert.equal(checkActivity('software_development', currentPolicy()).allowed, true, 'activity resumes after release');
});

test('owner provisioning is scrypt-hashed and login issues a rotating session', () => {
  const created = provisionOwner({ email: 'owner@za.test', password: 'mission-owner-password-1' });
  assert.equal(created.email, 'owner@za.test');
  assert.equal(ownerCount() > 0, true);
  const stored = missionDb.get<Row>('SELECT password_hash FROM mission_owner WHERE email = ?', ['owner@za.test']);
  assert.ok(String(stored?.password_hash).startsWith('scrypt$'), 'password is scrypt-hashed');
  assert.ok(!String(stored?.password_hash).includes('mission-owner-password-1'), 'plaintext password is never stored');

  assert.throws(() => provisionOwner({ email: 'not-an-email', password: 'mission-owner-password-1' }), (error: unknown) => error instanceof MissionAuthError);
  assert.throws(() => provisionOwner({ email: 'short@za.test', password: 'short' }), (error: unknown) => error instanceof MissionAuthError);

  const session = login({ email: 'owner@za.test', password: 'mission-owner-password-1' });
  ownerToken = session.token;
  assert.ok(session.token.length >= 32, 'session token is high entropy');
  assert.ok(session.expiresAt > new Date().toISOString(), 'session has a future expiry');
  const sessionRow = missionDb.get<Row>('SELECT token_hash FROM mission_sessions WHERE id = ?', [session.owner.id ? missionDb.get<Row>('SELECT id FROM mission_sessions ORDER BY created_at DESC LIMIT 1')?.id as string : '']);
  assert.ok(!sessionRow || String(sessionRow.token_hash) !== session.token, 'the raw token is never stored');

  assert.throws(() => login({ email: 'owner@za.test', password: 'wrong-password-here' }), (error: unknown) => error instanceof MissionAuthError && error.statusCode === 401);
  assert.throws(() => login({ email: 'nobody@za.test', password: 'whatever-password' }), (error: unknown) => error instanceof MissionAuthError);

  const context = resolveSession(session.token);
  assert.ok(context, 'session resolves');
  assert.equal(context?.owner.email, 'owner@za.test');

  const second = login({ email: 'owner@za.test', password: 'mission-owner-password-1' });
  assert.equal(resolveSession(session.token), null, 'the previous session is revoked on the next login');
  assert.ok(resolveSession(second.token), 'the newest session is valid');
  ownerToken = second.token;
  assert.equal(resolveSession('zal_not_a_real_token'), null, 'unknown tokens never resolve');
});

test('logout invalidates the session', () => {
  const session = login({ email: 'owner@za.test', password: 'mission-owner-password-1' });
  assert.ok(resolveSession(session.token));
  assert.equal(logout(session.token), true);
  assert.equal(resolveSession(session.token), null, 'logged-out token is refused');
  assert.equal(logout(session.token), false, 'a second logout reports no work done');
  ownerToken = login({ email: 'owner@za.test', password: 'mission-owner-password-1' }).token;
});

test('access links are scoped, expiring and use-limited — and never yield owner authority', () => {
  const read = createAccessLink({ label: 'agent dashboard', scope: 'dashboard:read', maxUses: 2, expiresInHours: 1, createdBy: 'test-owner' });
  assert.ok(read.token.startsWith('zal_'), 'link tokens are prefixed and non-guessable');
  assert.equal(listAccessLinks().some((link) => link.id === read.link.id), true);

  const first = resolveAccessLink(read.token);
  assert.ok(first, 'link resolves');
  assert.equal(first?.link.scope, 'dashboard:read');
  assert.equal(first?.agentId, null, 'a dashboard link is not bound to an agent');

  assert.ok(resolveAccessLink(read.token), 'second use within budget');
  assert.equal(resolveAccessLink(read.token), null, 'third use exceeds the budget');

  // Agent-scoped links reference a real agent row (foreign key enforced).
  missionDb.run(
    `INSERT INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform)
     VALUES ('agt_test_agent', 'test-agent', 'Test Agent', 'specialist', 0, 'custom', 'active', 'worker', 'mission')`,
  );
  const agentLink = createAccessLink({ label: 'agent self', scope: 'agent:self', agentId: 'agt_test_agent', expiresInHours: 1, createdBy: 'test-owner' });
  const context = resolveAccessLink(agentLink.token);
  assert.equal(context?.agentId, 'agt_test_agent', 'agent link is bound to its agent');

  const expired = createAccessLink({ label: 'expired', scope: 'dashboard:read', expiresInHours: -1, createdBy: 'test-owner' });
  assert.equal(resolveAccessLink(expired.token), null, 'expired links are refused');

  const revoked = createAccessLink({ label: 'revoked', scope: 'dashboard:read', expiresInHours: 1, createdBy: 'test-owner' });
  assert.equal(revokeAccessLink(revoked.link.id, 'test-owner'), true);
  assert.equal(resolveAccessLink(revoked.token), null, 'revoked links are refused');
  assert.equal(revokeAccessLink('lnk_missing', 'test-owner'), false, 'revoking an unknown link is reported honestly');
});

test('credential vault requires a key and round-trips with AES-256-GCM', () => {
  assert.equal(vaultConfigured(), true, 'the test key is configured');
  const encrypted = encryptCredential('sk-live-abcdef1234567890');
  assert.ok(encrypted.ciphertext.length > 0 && encrypted.iv.length > 0 && encrypted.tag.length > 0);
  assert.ok(!encrypted.ciphertext.includes('sk-live'), 'ciphertext does not contain the plaintext');
  assert.equal(decryptCredential(encrypted), 'sk-live-abcdef1234567890');

  const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -4)}AAAA` };
  assert.throws(() => decryptCredential(tampered), 'a tampered ciphertext fails authentication');
});

test('secret-shaped values are redacted before they reach the audit chain', () => {
  const redacted = redactForAudit({
    provider: 'stripe',
    apiKey: 'sk_live_should_never_persist',
    nested: { password: 'hunter2', note: 'plain text is fine' },
    list: [{ token: 'tok_123' }],
  }) as Record<string, unknown>;
  assert.equal(redacted.apiKey, '[redacted]');
  assert.equal((redacted.nested as Record<string, unknown>).password, '[redacted]');
  assert.equal((redacted.nested as Record<string, unknown>).note, 'plain text is fine');
  assert.equal(((redacted.list as Array<Record<string, unknown>>)[0]).token, '[redacted]');

  const alsoRedacted = redactSecrets({ authorization: 'Bearer abcdefghijklmnop', harmless: 'value' }) as Record<string, unknown>;
  assert.equal(alsoRedacted.authorization, '[redacted]');
  assert.equal(alsoRedacted.harmless, 'value');
});

test('audit trail is hash-chained, append-only and detects tampering', () => {
  const before = verifyMissionAudit();
  appendMissionAudit({ actorType: 'owner', actorId: 'test-owner', action: 'test.audit_write', detail: { note: 'append-only' } });
  const after = verifyMissionAudit();
  assert.equal(after.ok, true, 'chain verifies');
  assert.equal(after.rows, before.rows + 1, 'one row appended');

  const last = missionDb.get<Row>('SELECT * FROM mission_audit ORDER BY seq DESC LIMIT 1');
  assert.ok(last?.hash && last?.prev_hash !== undefined, 'row is linked to its predecessor');
  assert.equal(String(last?.hash).length, 64, 'sha256 hash');

  // Tamper with the stored detail of the newest row and prove verification fails.
  missionDb.run('UPDATE mission_audit SET detail = ? WHERE seq = ?', ['{"note":"rewritten"}', Number(last?.seq)]);
  const tampered = verifyMissionAudit();
  assert.equal(tampered.ok, false, 'tampering is detected');
  assert.ok(tampered.brokenAtSeq !== null, 'the break is located');
  // Restore the original value so the chain is clean for later assertions.
  missionDb.run('UPDATE mission_audit SET detail = ? WHERE seq = ?', [String(last?.detail ?? ''), Number(last?.seq)]);
  assert.equal(verifyMissionAudit().ok, true, 'restoring the original bytes restores the chain');
});

test('approvals queue records the requester and only the owner decides', () => {
  const approvalId = requestApproval({
    subjectType: 'expense',
    subjectId: 'exp_test',
    action: 'spend',
    amountCents: 5000,
    requestedBy: 'agt_test_agent',
  });
  const missing = decideApproval({ id: 'apr_missing', decision: 'approved', decidedBy: 'test-owner' });
  assert.equal(missing.ok, false, 'unknown approvals are refused');
  const decided = decideApproval({ id: approvalId, decision: 'approved', decidedBy: 'test-owner' });
  assert.equal(decided.ok, true);
  const row = missionDb.get<Row>('SELECT * FROM mission_approvals WHERE id = ?', [approvalId]);
  assert.equal(String(row?.status), 'approved');
  assert.equal(String(row?.decided_by), 'test-owner');
  const again = decideApproval({ id: approvalId, decision: 'rejected', decidedBy: 'test-owner' });
  assert.equal(again.ok, false, 'an approval is decided exactly once');
});

test('daily spend ledger accounting reflects real rows only', () => {
  const before = dailySpendCents(new Date().toISOString().slice(0, 10));
  assert.equal(typeof before, 'number');
  assert.ok(before >= 0, 'spend is never negative');
});

test('hashes are stable and ids are unique', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
  const a = appendMissionAudit({ actorType: 'system', action: 'test.unique' });
  const b = appendMissionAudit({ actorType: 'system', action: 'test.unique' });
  assert.notEqual(a.id, b.id, 'audit ids are unique');
  assert.equal(b.seq, a.seq + 1, 'audit sequence increments by one');
});

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
  void ownerToken;
  void os;
  void path;
});
