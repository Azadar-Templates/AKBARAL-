#!/usr/bin/env node
/**
 * ZA141251SA — single-identity lockdown verifier (black-box + database truth).
 *
 * Proves, against a RUNNING mission server, that:
 *   · the configured identity can authenticate and read mission data;
 *   · NO other identity can authenticate — even with a syntactically valid
 *     password and even when the account exists — and is refused by the
 *     allowlist, never by a credential outcome;
 *   · anonymous callers and stale/link tokens get nothing;
 *   · the database itself holds no second active account and no live session
 *     belonging to another identity.
 *
 * Usage:
 *   MISSION_BASE=http://127.0.0.1:4200 \
 *   ZA141251SA_OWNER_EMAIL=... ZA141251SA_OWNER_PASSWORD=... \
 *   node scripts/verify-mission-identity-lock.mjs
 *
 * Exit 0 = every check passed. Exit 1 = at least one check failed (each failure
 * prints the observed status/body, so a failure is never a mystery).
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const BASE = (process.env.MISSION_BASE ?? 'http://127.0.0.1:4200').replace(/\/+$/, '');
const OWNER_EMAIL = (process.env.ZA141251SA_OWNER_EMAIL ?? '').trim().toLowerCase();
const OWNER_PASSWORD = process.env.ZA141251SA_OWNER_PASSWORD ?? '';
const DB_PATH = path.resolve(process.cwd(), process.env.ZA141251SA_DB_FILE ?? process.env.ZA141251SA_DATABASE_URL?.replace(/^file:/, '') ?? 'mission.db');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function post(pathname, body, headers = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body is reported verbatim by the caller */
  }
  return { status: response.status, json, text };
}

async function get(pathname, headers = {}) {
  const response = await fetch(`${BASE}${pathname}`, { headers });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: response.status, json, text };
}

async function main() {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    console.error('ZA141251SA_OWNER_EMAIL and ZA141251SA_OWNER_PASSWORD must be set (they are never printed).');
    process.exit(2);
  }

  console.log(`\nZA141251SA identity lockdown — verifying ${BASE}\n`);
  const reachable = await get('/api/overview').catch(() => null);
  if (!reachable) {
    console.error(`mission server is not reachable at ${BASE} — start it with \`npm run mission:serve\``);
    process.exit(2);
  }

  // ── 1. Anonymous access ───────────────────────────────────────────────────
  const anon = await get('/api/overview');
  check('anonymous read of mission data is refused (401)', anon.status === 401, `status=${anon.status}`);

  const badToken = await get('/api/session/me', { authorization: 'Bearer not-a-real-session-token' });
  check('a forged session token is refused (401)', badToken.status === 401, `status=${badToken.status}`);

  // ── 2. Foreign identities are refused by the allowlist ────────────────────
  const probeEmail = `lockdown-probe-${Date.now()}@example.com`;
  const unknown = await post('/api/session/login', { email: probeEmail, password: 'irrelevant-password-123456' });
  check(
    'an unknown identity cannot authenticate (403 identity_restricted)',
    unknown.status === 403 && unknown.json?.error?.code === 'identity_restricted',
    `status=${unknown.status} body=${unknown.text.slice(0, 160)}`,
  );

  for (const credential of ['password', 'owner-password-123456', OWNER_PASSWORD]) {
    const attempt = await post('/api/session/login', { email: 'prior-operator@example.com', password: credential });
    check(
      `a foreign account is refused (403) regardless of the password supplied [${credential === OWNER_PASSWORD ? 'the owner password' : 'a plausible password'}]`,
      attempt.status === 403 && attempt.json?.error?.code === 'identity_restricted',
      `status=${attempt.status} body=${attempt.text.slice(0, 160)}`,
    );
  }
  const responseText = unknown.text;
  check('the refusal never discloses the configured identity', !responseText.includes(OWNER_EMAIL), 'the configured address appeared in the refusal body');

  // ── 3. The configured identity works ─────────────────────────────────────
  const session = await post('/api/session/login', { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  check('the configured identity authenticates (200)', session.status === 200, `status=${session.status} body=${session.text.slice(0, 160)}`);
  if (session.status !== 200) {
    summary();
    return;
  }
  check('the configured identity is the owner', session.json?.owner?.role === 'owner', `role=${session.json?.owner?.role}`);
  const token = session.json.token;

  const me = await get('/api/session/me', { authorization: `Bearer ${token}` });
  check('session/me reports the lockdown as enforced', me.status === 200 && me.json?.identityLock?.enabled === true, `status=${me.status} identityLock=${JSON.stringify(me.json?.identityLock)}`);
  check(
    'session/me confirms the configured identity',
    (me.json?.identityLock?.configuredEmail ?? '').toLowerCase() === OWNER_EMAIL,
    `configuredEmail=${me.json?.identityLock?.configuredEmail}`,
  );

  const overview = await get('/api/overview', { authorization: `Bearer ${token}` });
  check('the configured identity can read mission data (200)', overview.status === 200, `status=${overview.status}`);
  check(
    'overview reports the lockdown state',
    overview.json?.identityLock?.enabled === true,
    `identityLock=${JSON.stringify(overview.json?.identityLock)}`,
  );

  // ── 4. Database truth (the HTTP surface is not taken on trust) ────────────
  let db = null;
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  } catch (error) {
    check('mission database is readable for the direct check', false, String(error.message ?? error));
  }
  if (db) {
    const owners = db.prepare('SELECT email, status FROM mission_owner').all();
    const activeForeign = owners.filter((row) => String(row.status) === 'active' && String(row.email).toLowerCase() !== OWNER_EMAIL);
    check('exactly one active mission account exists, and it is the configured identity', activeForeign.length === 0, `active foreign accounts: ${JSON.stringify(activeForeign)}`);
    check('the configured identity is present and active', owners.some((row) => String(row.email).toLowerCase() === OWNER_EMAIL && String(row.status) === 'active'));

    const liveForeign = db
      .prepare(
        `SELECT COUNT(*) AS count FROM mission_sessions s JOIN mission_owner o ON o.id = s.owner_id
          WHERE s.revoked_at IS NULL AND lower(o.email) != ? AND s.expires_at > ?`,
      )
      .get(OWNER_EMAIL, new Date().toISOString());
    check('no live session belongs to another identity', Number(liveForeign.count) === 0, `live foreign sessions: ${liveForeign.count}`);

    const lockRow = db.prepare('SELECT locked_email, enforced_at FROM mission_identity_lock ORDER BY enforced_at DESC LIMIT 1').get();
    check('the lockdown was enforced and recorded', Boolean(lockRow?.enforced_at) && String(lockRow?.locked_email).toLowerCase() === OWNER_EMAIL, `lock row: ${JSON.stringify(lockRow)}`);
  }

  summary();
}

function summary() {
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    console.log('  failures:');
    for (const failure of failures) console.log(`    · ${failure}`);
    console.log('');
    process.exit(1);
  }
}

await main();
