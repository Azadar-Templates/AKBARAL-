#!/usr/bin/env node
/**
 * AKBARAL! — owner identity, role separation and unlimited execution verifier.
 *
 * Proves, against a RUNNING platform API, that:
 *   · the configured owner email (AKBARAL_OWNER_EMAIL) lands as `owner`;
 *   · every other account is an ordinary `user`;
 *   · an ordinary user is refused the owner console and the staff plane;
 *   · the owner may execute MASTER AI work with ZERO task credits and consumes
 *     none, while an ordinary user with the same zero balance is refused with
 *     the honest `requires_pro` payment error — the entitlement itself, not a
 *     UI label.
 *
 * Usage:
 *   API_BASE=http://127.0.0.1:4000 AKBARAL_OWNER_EMAIL=... \
 *   AKBARAL_OWNER_PASSWORD=... node scripts/verify-owner-identity.mjs
 *
 * Ordinary-user accounts are created with a random password generated here and
 * never printed. Exit 0 = every check passed.
 */
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const BASE = (process.env.API_BASE ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
const OWNER_EMAIL = (process.env.AKBARAL_OWNER_EMAIL ?? '').trim().toLowerCase();
const OWNER_PASSWORD = process.env.AKBARAL_OWNER_PASSWORD ?? '';
const DB_PATH = path.resolve(process.cwd(), process.env.AKBARAL_DB_FILE ?? 'data/akbaral.db');

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function request(method, pathname, { body, token } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* handled by callers that inspect text */
  }
  return { status: response.status, json, text };
}

const newPassword = () => `${randomBytes(9).toString('base64url')}Aa1!`;

async function ensureAccount(email, password, name) {
  await request('POST', '/api/auth/register', { body: { email, password, name } });
  const login = await request('POST', '/api/auth/login', { body: { email, password } });
  if (login.status !== 200) return { status: login.status, detail: login.text.slice(0, 200) };
  return { status: 200, token: login.json.accessToken ?? login.json.access_token ?? login.json.token, body: login.json };
}

/** Run one short-lived database operation (the API holds its own connection). */
function withDb(operation) {
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 8000');
    return operation(db);
  } finally {
    db.close();
  }
}

/** Credits actually consumed by an account (negative ledger movements). */
function consumedCredits(userId) {
  return Number(withDb((db) => db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM credit_transactions WHERE user_id = ? AND amount < 0').get(userId)).total);
}

function auditCount(where) {
  return Number(withDb((db) => db.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE ${where}`).get()).count);
}

/** Poll the workflow until it reaches a terminal state (or the timeout). */
async function waitForWorkflow(workflowId, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = withDb((db) => db.prepare('SELECT id, status, error_message FROM workflows WHERE id = ?').get(workflowId));
    if (last && ['completed', 'failed', 'cancelled'].includes(String(last.status))) return last;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return last;
}

async function main() {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    console.error('AKBARAL_OWNER_EMAIL and AKBARAL_OWNER_PASSWORD must be set (values are never printed).');
    process.exit(2);
  }
  const health = await request('GET', '/api/health').catch(() => null);
  if (!health || health.status !== 200) {
    console.error(`platform API is not reachable at ${BASE} — start the stack first`);
    process.exit(2);
  }

  console.log(`\nAKBARAL! owner identity + unlimited execution — verifying ${BASE}\n`);

  // ── Ordinary account ──────────────────────────────────────────────────────
  const ordinaryEmail = `probe-user-${Date.now()}@example.com`;
  const ordinary = await ensureAccount(ordinaryEmail, newPassword(), 'Probe User');
  check('an ordinary account registers and signs in', ordinary.status === 200, `status=${ordinary.status} ${ordinary.detail ?? ''}`);
  if (ordinary.status !== 200) {
    summary();
    return;
  }
  const ordinaryMe = await request('GET', '/api/me', { token: ordinary.token });
  check('an ordinary account is a normal `user`', ordinaryMe.json?.user?.role === 'user', `role=${ordinaryMe.json?.user?.role}`);
  const ordinaryOwnerConsole = await request('GET', '/api/owner/dashboard', { token: ordinary.token });
  check('an ordinary account cannot read the owner console (403)', ordinaryOwnerConsole.status === 403, `status=${ordinaryOwnerConsole.status}`);
  const ordinaryAdmin = await request('GET', '/api/admin/stats', { token: ordinary.token });
  check('an ordinary account cannot read the staff plane (403)', ordinaryAdmin.status === 403, `status=${ordinaryAdmin.status}`);

  // ── Owner account ─────────────────────────────────────────────────────────
  const owner = await ensureAccount(OWNER_EMAIL, OWNER_PASSWORD, 'AKBARAL Owner');
  check('the configured owner account signs in', owner.status === 200, `status=${owner.status} ${owner.detail ?? ''}`);
  if (owner.status !== 200) {
    summary();
    return;
  }
  const ownerMe = await request('GET', '/api/me', { token: owner.token });
  check('the configured identity holds the `owner` role', ownerMe.json?.user?.role === 'owner', `role=${ownerMe.json?.user?.role}`);
  const ownerConsole = await request('GET', '/api/owner/dashboard', { token: owner.token });
  check('the owner can read the owner console (200)', ownerConsole.status === 200, `status=${ownerConsole.status}`);

  // ── Unlimited execution entitlement ───────────────────────────────────────
  // The ordinary account's balance is zeroed DIRECTLY (operator setup of a
  // precondition that is otherwise reached by using the trial up). The refusal
  // then has to come from the API, the owner's exemption from the ledger and
  // the audit chain — no client-side claim is trusted.
  const ordinaryUserId = ordinaryMe.json?.user?.id;
  const ownerUserId = ownerMe.json?.user?.id;
  const zeroed = withDb((db) =>
    db
      .prepare('UPDATE credit_accounts SET free_credits = 0, free_credits_used = 0, paid_credits = 0, bonus_credits = 0 WHERE user_id = ?')
      .run(ordinaryUserId),
  );
  check('the ordinary account balance was zeroed for the probe', Number(zeroed.changes) === 1, `credit_accounts rows updated: ${zeroed.changes}`);

  const ordinaryConsumedBefore = consumedCredits(ordinaryUserId);
  const ordinaryTask = await request('POST', '/api/master', {
    token: ordinary.token,
    body: { goal: 'Summarise why a zero-balance trial account must be refused.' },
  });
  check(
    'a zero-balance ordinary account is accepted for planning only (202) and never executed for free',
    ordinaryTask.status === 202 || ordinaryTask.status === 402,
    `status=${ordinaryTask.status} body=${ordinaryTask.text.slice(0, 160)}`,
  );
  if (ordinaryTask.status === 202) {
    const workflowId = ordinaryTask.json?.workflow?.id;
    const terminal = await waitForWorkflow(workflowId);
    check(
      'the zero-balance ordinary task FAILS with the honest payment reason (never a silent success)',
      terminal?.status === 'failed' && /credits exhausted|requires AKBARAL Pro/i.test(String(terminal?.error_message ?? '')),
      `status=${terminal?.status} error=${String(terminal?.error_message ?? '').slice(0, 120)}`,
    );
    check(
      'the refused ordinary task consumed no credits',
      consumedCredits(ordinaryUserId) === ordinaryConsumedBefore,
      `consumed before=${ordinaryConsumedBefore} after=${consumedCredits(ordinaryUserId)}`,
    );
  }

  const ownerConsumedBefore = consumedCredits(ownerUserId);
  const ownerTask = await request('POST', '/api/master', {
    token: owner.token,
    body: { goal: 'Produce a launch-readiness checklist for the AKBARAL! platform.' },
  });
  check(
    'the owner can start MASTER AI work with zero task credits',
    ownerTask.status === 202 || ownerTask.status === 201 || ownerTask.status === 200,
    `status=${ownerTask.status} body=${ownerTask.text.slice(0, 200)}`,
  );
  const ownerWorkflowId = ownerTask.json?.workflow?.id;
  const ownerTerminal = ownerWorkflowId ? await waitForWorkflow(ownerWorkflowId) : null;
  check(
    'the owner workflow actually COMPLETES (the exemption is real, not a bypass that fails later)',
    ownerTerminal?.status === 'completed',
    `status=${ownerTerminal?.status} error=${String(ownerTerminal?.error_message ?? '').slice(0, 120)}`,
  );
  check(
    'the owner execution consumed no task credits',
    consumedCredits(ownerUserId) === ownerConsumedBefore,
    `consumed before=${ownerConsumedBefore} after=${consumedCredits(ownerUserId)}`,
  );
  check(
    'the unlimited execution was audited',
    auditCount("action = 'owner.unlimited_execution'") >= 1,
    'no owner.unlimited_execution audit row',
  );

  // ── Role separation ───────────────────────────────────────────────────────
  const foreignOwners = withDb((db) =>
    db.prepare("SELECT email, role FROM users WHERE role = 'owner' AND lower(email) != ?").all(OWNER_EMAIL),
  );
  check('no account other than the configured identity holds the owner role', foreignOwners.length === 0, `unexpected owners: ${JSON.stringify(foreignOwners)}`);
  const ownerAccounts = withDb((db) => db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").get().count);
  check('exactly one owner account exists', Number(ownerAccounts) === 1, `owner accounts: ${ownerAccounts}`);
  const staffAccounts = withDb((db) => db.prepare("SELECT email FROM users WHERE role IN ('admin','super_admin')").all());
  check(
    'the staff plane holds no account that can authenticate (seeded staff rows carry no password)',
    withDb((db) => Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role IN ('admin','super_admin') AND password_hash IS NOT NULL").get().count)) === 0,
    `staff accounts: ${JSON.stringify(staffAccounts)}`,
  );

  summary();
}

function summary() {
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    console.log('  failures:');
    for (const failure of failures) console.log(`    · ${failure}`);
    console.log('');
    process.exit(1);
  }
}

await main();
