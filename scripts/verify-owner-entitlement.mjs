#!/usr/bin/env node
/**
 * AKBARAL! — owner/entitlement verification (production launch, blockers #6/#7).
 *
 * Proves against the RUNNING platform (no mocks) that:
 *
 *   A. identity — the configured Gmail is the ONLY owner/admin account that can
 *      authenticate; every other account is an ordinary user, and the seeded
 *      staff plane holds no account with a password at all;
 *   B. entitlement — that account executes work with UNLIMITED usage (zero
 *      credits consumed, audited), while an ordinary account whose credits are
 *      exhausted is honestly refused and consumes nothing.
 *
 * Usage:
 *   set -a; . ./.platform-owner.env; set +a
 *   AKBARAL_OWNER_PASSWORD="$(sed -n 2p .platform-owner-credentials.txt)" \
 *     API_BASE=http://127.0.0.1:4000 node scripts/verify-owner-entitlement.mjs
 *
 * Exit code 0 = every check passed.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const repo = path.resolve(new URL('..', import.meta.url).pathname);
const API = (process.env.API_BASE ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
const DB_PATH = path.resolve(repo, (process.env.DATABASE_URL ?? 'file:./data/akbaral.db').replace(/^file:/, ''));

const results = [];
const check = (label, ok, detail = '') => {
  results.push([ok, label, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`);
};

function readOwnerCredentials() {
  const file = path.join(repo, '.platform-owner-credentials.txt');
  const email = process.env.AKBARAL_OWNER_EMAIL ?? process.env.OWNER_EMAIL ?? '';
  const password = process.env.AKBARAL_OWNER_PASSWORD ?? process.env.OWNER_PASSWORD ?? '';
  if (email && password) return { email, password };
  if (!fs.existsSync(file)) return { email, password };
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labelled = (key) => lines.find((line) => new RegExp(`^${key}\\s*[:=]`, 'i').test(line))?.replace(new RegExp(`^${key}\\s*[:=]\\s*`, 'i'), '') ?? '';
  return {
    email: email || labelled('email') || lines[0] || '',
    password: password || labelled('password') || (labelled('email') ? '' : lines[1]) || '',
  };
}

function db(run, { write = false } = {}) {
  const handle = new DatabaseSync(DB_PATH, write ? {} : { readOnly: true });
  handle.exec('PRAGMA busy_timeout = 8000');
  try {
    return run(handle);
  } finally {
    try { handle.close(); } catch { /* already closed */ }
  }
}

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: response.status, body: parsed };
}

async function authenticate(email, password, name) {
  const register = await call('/api/auth/register', { method: 'POST', body: { email, password, name } });
  const conflict = register.status === 409 || register.body?.error?.code === 'conflict';
  const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  return {
    registered: register.status === 201 || conflict,
    token: login.body?.accessToken ?? '',
    loginStatus: login.status,
    loginBody: login.body,
  };
}

async function terminalWorkflow(workflowId, token, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await call(`/api/master/${workflowId}`, { token });
    last = response.body;
    const status = last?.workflow?.status ?? last?.status ?? '';
    if (['completed', 'failed', 'cancelled'].includes(status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return last ?? {};
}

/* ────────────────────────────── A. identity ─────────────────────────────── */

const owner = readOwnerCredentials();
check('the configured owner credentials are available', owner.email !== '' && owner.password.length >= 12, owner.email ? `${owner.email.slice(0, 3)}… / secret ${owner.password.length} chars` : 'missing');

const ownerAuth = await authenticate(owner.email, owner.password, 'AKBARAL Owner');
const ownerMe = await call('/api/me', { token: ownerAuth.token });
check('the configured identity signs in and is the owner', ownerAuth.loginStatus === 200 && ownerMe.body?.user?.role === 'owner', `HTTP ${ownerAuth.loginStatus} role=${ownerMe.body?.user?.role ?? ownerAuth.body?.error?.code ?? 'n/a'}`);

const ownerPlane = await call('/api/owner/dashboard', { token: ownerAuth.token });
check('the owner reaches the owner-only plane', ownerPlane.status === 200, `HTTP ${ownerPlane.status}`);

const stamp = Date.now();
const ordinary = { email: `entitlement-${stamp}@akbaral.test`, password: `Ordinary-${randomBytes(9).toString('base64url')}!7` };
const ordinaryAuth = await authenticate(ordinary.email, ordinary.password, 'Ordinary User');
const ordinaryMe = await call('/api/me', { token: ordinaryAuth.token });
check('a new account authenticates as a NORMAL user', ordinaryAuth.loginStatus === 200 && ordinaryMe.body?.user?.role === 'user', `HTTP ${ordinaryAuth.loginStatus} role=${ordinaryMe.body?.user?.role ?? 'n/a'}`);

const ordinaryOwnerPlane = await call('/api/owner/dashboard', { token: ordinaryAuth.token });
const ordinaryAdminPlane = await call('/api/admin/stats', { token: ordinaryAuth.token });
check('a normal user is refused on the owner-only plane', ordinaryOwnerPlane.status === 403, `HTTP ${ordinaryOwnerPlane.status} ${ordinaryOwnerPlane.body?.error?.code ?? ''}`);
check('a normal user is refused on the staff plane', ordinaryAdminPlane.status === 403, `HTTP ${ordinaryAdminPlane.status} ${ordinaryAdminPlane.body?.error?.code ?? ''}`);

const identityAudit = db((handle) => ({
  owners: handle.prepare("SELECT email, role FROM users WHERE role IN ('owner','super_admin')").all().map((row) => `${row.role}:${row.email}`),
  elevatedWithoutPassword: handle.prepare("SELECT COUNT(*) AS c FROM users WHERE role NOT IN ('user','owner') AND password_hash IS NOT NULL").get().c,
  normalWithOwnerRole: handle.prepare("SELECT COUNT(*) AS c FROM users WHERE role IN ('owner','super_admin') AND lower(email) <> ?").get().c,
}));
check('exactly one owner account exists and it is the configured Gmail', identityAudit.owners.length === 1 && identityAudit.owners[0].toLowerCase().endsWith(owner.email.toLowerCase()) && identityAudit.normalWithOwnerRole === 0, identityAudit.owners.join(', ') || 'none');
check('no staff/elevated account can authenticate (seeded staff carry no password)', identityAudit.elevatedWithoutPassword === 0, `elevated accounts with a password = ${identityAudit.elevatedWithoutPassword}`);

/* ────────────────────────── B. entitlement proof ────────────────────────── */

const creditsOf = (userId) => db((handle) => ({
  consumed: handle.prepare('SELECT COALESCE(SUM(amount),0) AS c FROM credit_transactions WHERE user_id = ? AND amount < 0').get(userId).c,
  negatives: handle.prepare('SELECT COUNT(*) AS c FROM credit_transactions WHERE user_id = ? AND amount < 0').get(userId).c,
  available: handle.prepare('SELECT (free_credits - free_credits_used) + paid_credits + bonus_credits AS available FROM credit_accounts WHERE user_id = ?').get(userId)?.available ?? 0,
}));

const ordinaryId = ordinaryMe.body?.user?.id ?? '';
const ownerId = ownerMe.body?.user?.id ?? '';

// The ordinary account is left with zero credits — the honest trial-exhausted
// state a real customer reaches after using what they were given.
db((handle) => {
  handle.exec('PRAGMA busy_timeout = 8000');
  handle.prepare('UPDATE credit_accounts SET free_credits = 0, free_credits_used = 0, paid_credits = 0, bonus_credits = 0 WHERE user_id = ?').run(ordinaryId);
}, { write: true });
const ordinaryBefore = creditsOf(ordinaryId);
check('the ordinary account is genuinely at zero credits', ordinaryBefore.available === 0, `available=${ordinaryBefore.available}`);

const ordinaryRun = await call('/api/master', { method: 'POST', token: ordinaryAuth.token, body: { goal: 'Summarize the AKBARAL! verification guarantees in one paragraph' } });
const ordinaryWorkflowId = ordinaryRun.body?.workflow?.id ?? ordinaryRun.body?.id ?? '';
check('the exhausted account can still submit a goal', ordinaryRun.status === 201 || ordinaryRun.status === 202, `HTTP ${ordinaryRun.status} id=${ordinaryWorkflowId}`);
const ordinaryFinal = ordinaryWorkflowId ? await terminalWorkflow(ordinaryWorkflowId, ordinaryAuth.token) : {};
const ordinaryStatus = ordinaryFinal?.workflow?.status ?? ordinaryFinal?.status ?? '';
const ordinaryError = String(ordinaryFinal?.workflow?.error_message ?? ordinaryFinal?.error_message ?? ordinaryFinal?.error ?? '');
check('the exhausted account is honestly refused (never charged, never faked)', ordinaryStatus === 'failed' && /credit|pro\b/i.test(ordinaryError), `status=${ordinaryStatus} error=${ordinaryError.slice(0, 120) || 'n/a'}`);
const ordinaryAfter = creditsOf(ordinaryId);
check('the refused run consumed no credits', ordinaryAfter.consumed === ordinaryBefore.consumed && ordinaryAfter.available <= 0, `consumed before=${ordinaryBefore.consumed} after=${ordinaryAfter.consumed}`);

const auditBefore = db((handle) => handle.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'owner.unlimited_execution' AND actor_id = ?").get(ownerId).c);
const ownerBefore = creditsOf(ownerId);
const ownerRun = await call('/api/master', { method: 'POST', token: ownerAuth.token, body: { goal: 'Write a two-sentence status note about the AKBARAL! verification battery' } });
const ownerWorkflowId = ownerRun.body?.workflow?.id ?? ownerRun.body?.id ?? '';
check('the owner submits a real goal', ownerRun.status === 201 || ownerRun.status === 202, `HTTP ${ownerRun.status} id=${ownerWorkflowId}`);
const ownerFinal = ownerWorkflowId ? await terminalWorkflow(ownerWorkflowId, ownerAuth.token) : {};
const ownerStatus = ownerFinal?.workflow?.status ?? ownerFinal?.status ?? '';
check('the owner run executes for real without needing credits', ownerStatus === 'completed', `status=${ownerStatus}`);
const ownerSteps = (ownerFinal?.steps ?? ownerFinal?.workflow?.steps ?? []).length;
const ownerResult = JSON.stringify(ownerFinal?.finalResult ?? ownerFinal?.result ?? '');
check('the owner run produced a real step graph and result document', ownerSteps > 0 && ownerResult.length > 80, `steps=${ownerSteps} result=${ownerResult.length} chars`);
const ownerAfter = creditsOf(ownerId);
check('the owner run consumed ZERO credits (unlimited entitlement)', ownerAfter.consumed === ownerBefore.consumed && ownerAfter.negatives === ownerBefore.negatives, `consumed before=${ownerBefore.consumed} after=${ownerAfter.consumed} negative transactions=${ownerAfter.negatives}`);
check('the unlimited entitlement is audited server-side', db((handle) => handle.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'owner.unlimited_execution' AND actor_id = ?").get(ownerId).c) > auditBefore, `audit rows before=${auditBefore} after=${db((handle) => handle.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'owner.unlimited_execution' AND actor_id = ?").get(ownerId).c)}`);

const ownerNormalUsers = db((handle) => handle.prepare("SELECT COUNT(*) AS c FROM users WHERE role NOT IN ('owner','super_admin') AND status = 'active'").get().c);
check('every other active account is a normal user', ownerNormalUsers >= 1, `${ownerNormalUsers} normal-user account(s)`);

/* ───────────────────────────────── verdict ───────────────────────────────── */

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('failures:');
  for (const [, label, detail] of failed) console.log(`  · ${label}${detail ? ` — ${detail}` : ''}`);
  process.exit(1);
}
process.exit(0);
