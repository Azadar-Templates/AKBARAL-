#!/usr/bin/env node
/**
 * AKBARAL! — production recovery drill (blocker #10).
 *
 * Proves, against the REAL databases of the running stack, that:
 *
 *   A. the platform database can be snapshotted safely while the server is
 *      serving (the product's own verified backup), the snapshot matches live
 *      row counts, it restores cleanly, it is fully migrated, and an API
 *      booted on the RESTORED file authenticates the owner and serves the
 *      4,001-agent registry — with a wrong password still refused;
 *   B. the ZA141251SA mission database snapshots the same way and the restored
 *      copy is self-sufficient: integrity ok, hash-chained audit + ledger
 *      verify, exactly one owner, no foreign owner, no live foreign session.
 *
 * Nothing here touches the live data files: the drill works on copies under a
 * scratch directory and removes it first so it is repeatable.
 *
 * Usage:
 *   set -a; . ./.platform-owner.env; set +a
 *   AKBARAL_OWNER_PASSWORD="$(sed -n 2p .platform-owner-credentials.txt)" \
 *     node scripts/verify-recovery.mjs
 *   (mission env is read from .mission-secrets.env when present)
 *
 * Exit code 0 = every check passed.
 */
import { DatabaseSync } from 'node:sqlite';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(new URL('..', import.meta.url).pathname);
const SCRATCH = path.join(os.tmpdir(), 'akbaral-recovery-drill');
const LIVE_PLATFORM = path.join(repo, 'data', 'akbaral.db');
const LIVE_MISSION = path.join(repo, 'mission.db');
const API_PORT = Number(process.env.RECOVERY_API_PORT ?? 4100);

const results = [];
const check = (label, ok, detail = '') => {
  results.push([ok, label, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`);
};
const section = (title) => console.log(`\n── ${title}`);

function run(command, args, env, { allowFail = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (!allowFail && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}\n${out.slice(-1500)}`);
  }
  return { status: result.status, out };
}

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 8000');
  return db;
}

function counts(db, tables) {
  const out = {};
  for (const table of tables) {
    try {
      out[table] = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
    } catch {
      out[table] = -1; // table absent in this schema version
    }
  }
  return out;
}

const MISSION_ENV = (() => {
  const file = path.join(repo, '.mission-secrets.env');
  const env = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
})();

fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });

/* ─────────────────────────────── A. platform ─────────────────────────────── */

section('A. platform database — verified backup while the server serves');

check('the live platform database exists and is a real file', fs.existsSync(LIVE_PLATFORM), `${(fs.statSync(LIVE_PLATFORM).size / 1048576).toFixed(1)} MB`);

const backupDir = path.join(SCRATCH, 'backups');
const backupRun = run('npx', ['tsx', 'src/scripts/backup-db.ts', backupDir, '3'], {
  DATABASE_URL: `file:${LIVE_PLATFORM}`,
});
const backupLine = backupRun.out.split('\n').find((line) => line.includes('backup OK')) ?? '';
const backupFile = /backup OK: (\S+)/.exec(backupLine)?.[1] ?? '';
check('the product takes a verified snapshot of the serving database', backupLine.includes('integrity ok') && backupFile !== '', backupLine.replace(/\[\d+m/g, '').slice(0, 160));
check('the snapshot reports row counts for the core tables', /rows \{"users":\d+/.test(backupLine), /rows (\{[^}]*\})/.exec(backupLine)?.[1]?.slice(0, 140) ?? 'none');

const TABLES = ['users', 'tasks', 'agents', 'projects', 'invoices', 'credit_transactions', 'workflows'];
const live = openDb(LIVE_PLATFORM);
const snapshot = openDb(backupFile);
const liveCounts = counts(live, TABLES);
const snapshotCounts = counts(snapshot, TABLES);
check('the snapshot carries exactly the live row counts', JSON.stringify(liveCounts) === JSON.stringify(snapshotCounts), `live=${JSON.stringify(liveCounts)}`);
check('the snapshot passes SQLite integrity_check on its own', snapshot.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
snapshot.close();
live.close();

section('A2. restore — the snapshot is put back over a damaged live file');

// Simulate the disaster: the "live" file is gone/truncated, only the snapshot
// survives. The restore tool refuses anything it cannot verify.
const restoredTarget = path.join(SCRATCH, 'restored', 'akbaral-restored.db');
fs.mkdirSync(path.dirname(restoredTarget), { recursive: true });
fs.writeFileSync(restoredTarget, Buffer.from('not a database — simulated disaster'));
const corruptRefused = run('npx', ['tsx', 'src/scripts/restore-db.ts', path.join(SCRATCH, 'backups', 'not-a-backup.db')], {
  DATABASE_URL: `file:${restoredTarget}`,
}, { allowFail: true });
check('a restore of an unverifiable file is refused (never a silent bad restore)', corruptRefused.status !== 0 && /refusing to restore unverified backup|FAILED/.test(corruptRefused.out), corruptRefused.out.split('\n').find((l) => l.includes('FAILED'))?.slice(0, 130) ?? 'no output');

const restoreRun = run('npx', ['tsx', 'src/scripts/restore-db.ts', backupFile, path.join(SCRATCH, 'pre-restore')], {
  DATABASE_URL: `file:${restoredTarget}`,
});
const restoreLine = restoreRun.out.split('\n').find((line) => line.includes('restore OK')) ?? '';
check('the verified snapshot restores over the damaged file', restoreLine !== '', restoreLine.slice(0, 180));
check('the unreadable pre-restore file is preserved for forensics, never discarded', restoreLine.includes('preserved verbatim') && fs.readdirSync(path.join(SCRATCH, 'pre-restore')).some((name) => name.startsWith('pre-restore-unreadable-')), restoreLine.match(/preserved verbatim[^;]*/)?.[0]?.slice(0, 120) ?? 'not reported');
const restored = openDb(restoredTarget);
const restoredCounts = counts(restored, TABLES);
check('the restored database matches the live row counts', JSON.stringify(restoredCounts) === JSON.stringify(liveCounts), `restored=${JSON.stringify(restoredCounts)}`);
check('a safety snapshot of the pre-restore file was kept', fs.readdirSync(path.join(SCRATCH, 'pre-restore')).some((name) => name.startsWith('pre-restore-')), path.join('pre-restore', fs.readdirSync(path.join(SCRATCH, 'pre-restore'))[0] ?? ''));
restored.close();

section('A3. the restored database boots and serves the real product');

const migration = run('npx', ['tsx', 'src/db/migrate.ts', '--status'], { DATABASE_URL: `file:${restoredTarget}` });
check('the restored database is fully migrated (no pending work)', /pending migrations:\s*\n\s*\(none\)/.test(migration.out), (migration.out.match(/\[applied\] (\S+) \([^)]*\)\s*$/m)?.[1] ?? 'unknown') + ' … pending (none)');

const ownerPassword = process.env.AKBARAL_OWNER_PASSWORD ?? '';
const ownerEmail = process.env.AKBARAL_OWNER_EMAIL ?? '';
check('the owner credentials for the boot check are available', ownerEmail !== '' && ownerPassword.length >= 12, ownerEmail ? `${ownerEmail.slice(0, 3)}… / secret ${ownerPassword.length} chars` : 'AKBARAL_OWNER_EMAIL missing');

// Guard: never attach to a server some earlier run left behind, and never
// leave one behind ourselves. The drill's API is started in its OWN process
// group so the whole group can be terminated — a killed `npx` wrapper alone
// would orphan the real server and collide with the next run.
const portBusy = await fetch(`http://127.0.0.1:${API_PORT}/api/ready`).then(() => true).catch(() => false);
if (portBusy) {
  console.error(`[recovery] port ${API_PORT} is already serving — stop that process first (the drill must not reuse a stale server)`);
  process.exit(2);
}

const api = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: repo,
  env: {
    ...process.env,
    ...MISSION_ENV,
    DATABASE_URL: `file:${restoredTarget}`,
    PORT: String(API_PORT),
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
const stopApi = () => {
  try { process.kill(-api.pid, 'SIGTERM'); } catch { /* already gone */ }
  try { api.kill('SIGTERM'); } catch { /* already gone */ }
};
process.on('exit', stopApi);
let apiLog = '';
api.stdout.on('data', (chunk) => { apiLog += String(chunk); });
api.stderr.on('data', (chunk) => { apiLog += String(chunk); });
const base = `http://127.0.0.1:${API_PORT}`;
const waitFor = async (predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/ready`);
      const body = await response.json().catch(() => ({}));
      if (predicate(response.status, body)) return { status: response.status, body };
    } catch {
      // server not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${label}\n${apiLog.slice(-800)}`);
};

try {
  const ready = await waitFor((status, body) => status === 200 && body.status === 'ready', 90_000, 'the restored database to report ready');
  const checks = ready.body.checks ?? ready.body;
  check('an API booted on the restored file reports /api/ready', ready.status === 200 && ready.body.status === 'ready', `database=${checks.database?.status ?? checks.database ?? 'n/a'} execution_queue=${checks.execution_queue?.status ?? 'n/a'}`);
  if (api.exitCode !== null) {
    throw new Error(`the API booted on the restored database exited with code ${api.exitCode}\n${apiLog.slice(-1500)}`);
  }

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });
  const loginBody = await login.json().catch(() => ({}));
  check('the owner signs in on the recovered database', login.status === 200 && loginBody.user?.role === 'owner', `HTTP ${login.status} role=${loginBody.user?.role ?? loginBody.error?.code ?? 'n/a'}`);

  const wrong = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ownerEmail, password: `${ownerPassword}-wrong` }),
  });
  check('a wrong password is still refused on the recovered database', wrong.status === 401, `HTTP ${wrong.status}`);

  const agents = await (await fetch(`${base}/api/public/agents`)).json().catch(() => ({}));
  check('the recovered database still serves the 4,001-agent registry', Number(agents.total ?? 0) >= 4_001, `total=${agents.total ?? 'n/a'}`);
} finally {
  stopApi();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try { process.kill(-api.pid, 'SIGKILL'); } catch { /* already gone */ }
  const stillListening = await fetch(`http://127.0.0.1:${API_PORT}/api/ready`).then(() => true).catch(() => false);
  check('the drill leaves no runaway process behind', !stillListening, stillListening ? `port ${API_PORT} still serving` : `port ${API_PORT} released`);
}

/* ──────────────────────────────── B. mission ─────────────────────────────── */

section('B. ZA141251SA mission database — snapshot, restore, chain verification');

if (!fs.existsSync(LIVE_MISSION)) {
  check('the mission database exists', false, LIVE_MISSION);
} else {
  const missionSnapshot = path.join(SCRATCH, 'mission-restored.db');
  const source = openDb(LIVE_MISSION);
  source.exec(`VACUUM INTO '${missionSnapshot.replace(/'/g, "''")}'`);
  const missionTables = ['mission_owner', 'mission_sessions', 'mission_wallets', 'mission_ledger', 'mission_audit', 'mission_work', 'mission_expenses'];
  const liveMissionCounts = counts(source, missionTables);
  source.close();
  const copy = openDb(missionSnapshot);
  const copyCounts = counts(copy, missionTables);
  check('the mission snapshot is a consistent copy of the live mission data', JSON.stringify(liveMissionCounts) === JSON.stringify(copyCounts), `rows=${JSON.stringify(copyCounts)}`);
  check('the mission snapshot passes SQLite integrity_check', copy.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
  copy.close();

  const probe = `
    import { verifyMissionAudit } from './src/mission/database';
    import { verifyLedger } from './src/mission/treasury';
    import { identityLockStatus } from './src/mission/identity-lock';
    import { missionDb } from './src/mission/database';
    const audit = verifyMissionAudit();
    const ledger = verifyLedger();
    const lock = identityLockStatus();
    const configured = lock.configuredEmail ?? '';
    const owners = missionDb.all("SELECT email, status FROM mission_owner ORDER BY status");
    const activeOwners = missionDb.all("SELECT email FROM mission_owner WHERE status = 'active'");
    const foreignActive = missionDb.get(
      "SELECT COUNT(*) AS c FROM mission_owner WHERE status = 'active' AND lower(email) <> ?",
      [configured],
    );
    const foreignSessions = missionDb.get(
      "SELECT COUNT(*) AS c FROM mission_sessions s JOIN mission_owner o ON o.id = s.owner_id " +
      "WHERE s.revoked_at IS NULL AND lower(o.email) <> ?",
      [configured],
    );
    console.log(JSON.stringify({
      auditOk: audit.ok, auditRows: audit.rows, ledgerOk: ledger.ok, ledgerRows: ledger.rows,
      owners: owners.map((row) => ({ email: row.email, status: row.status })),
      activeOwners: activeOwners.map((row) => row.email),
      configuredEmail: configured,
      envOwnerEmail: (process.env.ZA141251SA_OWNER_EMAIL ?? '').trim().toLowerCase(),
      activeForeignOwners: foreignActive?.c ?? -1,
      liveForeignSessions: foreignSessions?.c ?? -1,
      lockEnabled: lock.enabled, lockEnforcedAt: lock.enforcedAt,
      suspendedByLock: lock.ownersSuspended, revokedSessions: lock.sessionsRevoked, revokedLinks: lock.linksRevoked,
    }));
  `;
  const missionProbe = run('npx', ['tsx', '-e', probe], {
    ...MISSION_ENV,
    ZA141251SA_DATABASE_URL: `file:${missionSnapshot}`,
  });
  const verdict = JSON.parse(missionProbe.out.split('\n').find((line) => line.trim().startsWith('{')) ?? '{}');
  check('the restored mission database verifies its hash-chained audit log', verdict.auditOk === true, `rows=${verdict.auditRows ?? 'n/a'}`);
  check('the restored mission database verifies its hash-chained ledger', verdict.ledgerOk === true, `rows=${verdict.ledgerRows ?? 'n/a'}`);
  check(
    'exactly one ACTIVE mission identity, and it is the configured owner email',
    Array.isArray(verdict.activeOwners) && verdict.activeOwners.length === 1 && verdict.activeOwners[0] === verdict.envOwnerEmail && verdict.configuredEmail === verdict.envOwnerEmail,
    `active=${JSON.stringify(verdict.activeOwners ?? [])} env=${verdict.envOwnerEmail ?? 'n/a'} configured=${verdict.configuredEmail ?? 'n/a'}`,
  );
  check('every other mission-owner row is a suspended (locked-out) account', Array.isArray(verdict.owners) && verdict.owners.filter((row) => row.status !== 'active').every((row) => row.status === 'suspended'), JSON.stringify(verdict.owners ?? []));
  check(
    'the restored mission data carries zero foreign active owners and zero live foreign sessions',
    verdict.activeForeignOwners === 0 && verdict.liveForeignSessions === 0,
    `activeForeignOwners=${verdict.activeForeignOwners ?? 'n/a'} liveForeignSessions=${verdict.liveForeignSessions ?? 'n/a'}`,
  );
  check('the restored mission database carries the identity-lock record', typeof verdict.lockEnforcedAt === 'string' && verdict.lockEnforcedAt.length > 0, `email=${verdict.configuredEmail ?? 'n/a'} enforcedAt=${verdict.lockEnforcedAt ?? 'n/a'} suspended=${verdict.suspendedByLock ?? 'n/a'} revokedSessions=${verdict.revokedSessions ?? 'n/a'} revokedLinks=${verdict.revokedLinks ?? 'n/a'}`);
}

/* ───────────────────────────────── verdict ───────────────────────────────── */

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log('failures:');
  for (const [, label, detail] of failed) console.log(`  · ${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`scratch kept for inspection: ${SCRATCH}`);
  process.exit(1);
}
console.log(`scratch: ${SCRATCH}`);
process.exit(0);
