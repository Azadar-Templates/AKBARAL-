/**
 * ZA141251SA mission bootstrap CLI — `npm run mission:init`
 *
 * This is an OPERATOR command for the private mission system. It creates (or
 * upgrades) the mission database and provisions the mission owner account. It
 * touches nothing in the AKBARAL! platform database.
 *
 * Required for a fresh deployment (set these in the mission process env, never
 * in source control):
 *   ZA141251SA_OWNER_EMAIL      owner sign-in email
 *   ZA141251SA_OWNER_PASSWORD   owner sign-in password (>= 12 characters)
 * Recommended:
 *   ZA141251SA_DATABASE_URL     default file:./mission.db
 *   ZA141251SA_SESSION_SECRET   >= 32 chars (sessions)
 *   ZA141251SA_CREDENTIAL_KEY   >= 32 chars (credential vault)
 *
 * Without the owner env vars the command still migrates the schema and prints
 * exactly which variables are missing — it never invents an account.
 */
import {
  applyMissionMigrations,
  missionDb,
  missionEnv,
  verifyMissionAudit,
  type Row,
} from '../src/mission/database';
import { displayDatabaseTarget } from '../src/db/display-target';
import { EXTERNAL_ACTIVATION, seedTools } from '../src/mission/self-management';
import { PROHIBITION_STATEMENTS, currentPolicy, ensurePolicy } from '../src/mission/policy';
import { ownerCount, provisionOwner, vaultConfigured } from '../src/mission/auth';
import { enforceIdentityLock, identityLockEnabled, identityLockStatus, identityLockVerified } from '../src/mission/identity-lock';
import { ensurePayoutSlots, treasurySummary, verifyLedger } from '../src/mission/treasury';

function line(label: string, value: string): void {
  process.stdout.write(`  ${label.padEnd(26, '.')} ${value}\n`);
}

async function main(): Promise<void> {
  const env = missionEnv();
  process.stdout.write('\nZA141251SA — mission system bootstrap\n');
  process.stdout.write('═'.repeat(72) + '\n');
  line('database', displayDatabaseTarget(env.databaseUrl));
  line('bind host (default)', env.bindHost);
  line('port (default)', String(env.port));
  line('session secret', process.env.ZA141251SA_SESSION_SECRET ? 'configured' : 'NOT configured (login refuses to issue a session)');
  line('credential vault key', vaultConfigured() ? 'configured' : 'NOT configured (credential storage disabled)');

  process.stdout.write('\n  migrations\n');
  const migration = applyMissionMigrations();
  if (migration.applied.length === 0) line('applied', `none — ${migration.total} already applied`);
  else for (const entry of migration.applied) line('applied', entry);
  line('tables present', String(missionDb.tableCount()));

  ensurePolicy(env.currency);
  const toolsInserted = seedTools();
  const slots = ensurePayoutSlots();
  const policy = currentPolicy(env.currency);
  line('policy', `depth<=${policy.maxDepth} children<=${policy.maxChildrenPerAgent} agents<=${policy.maxAgents}`);
  line('daily spend cap', `${policy.maxDailySpendCents} cents`);
  line('approval threshold', `${policy.requireApprovalAboveCents} cents`);
  line('activity categories', String(policy.allowedActivities.length));
  line('tools seeded', `${toolsInserted} new`);
  line('payout slots', String(slots.length));

  const email = (process.env.ZA141251SA_OWNER_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.ZA141251SA_OWNER_PASSWORD ?? '';
  if (email && password) {
    const existing = missionDb.get<Row>('SELECT id FROM mission_owner WHERE email = ?', [email]);
    const owner = provisionOwner({ email, password });
    line('mission owner', existing ? `already present (${owner.email}); password refreshed` : `created ${owner.email}`);
  } else {
    const missing: string[] = [];
    if (!email) missing.push('ZA141251SA_OWNER_EMAIL');
    if (!password) missing.push('ZA141251SA_OWNER_PASSWORD');
    line('mission owner', `not provisioned — missing ${missing.join(', ')}`);
    line('existing owners', String(ownerCount()));
  }

  // ── Single-identity lockdown ──────────────────────────────────────────────
  // Everything that is not the configured identity is pushed out NOW: foreign
  // accounts suspended, their sessions revoked, pre-existing access links
  // revoked. Runs after provisioning so the configured identity is present.
  const lock = enforceIdentityLock();
  const lockCheck = identityLockVerified();
  if (!identityLockEnabled()) {
    line('identity lockdown', 'OFF — set ZA141251SA_OWNER_EMAIL to restrict authentication to one identity');
  } else {
    line('identity lockdown', lockCheck.ok ? `ENFORCED (${lock.swept ? 'sweep ran now' : 'already enforced'})` : `FAILED — ${lockCheck.reason}`);
    line('  suspended accounts', String(identityLockStatus().ownersSuspended));
    line('  sessions revoked', String(identityLockStatus().sessionsRevoked));
    line('  access links revoked', String(identityLockStatus().linksRevoked));
  }

  const audit = verifyMissionAudit();
  const ledger = verifyLedger();
  const treasury = treasurySummary();
  line('audit chain', audit.ok ? `verified (${audit.rows} entries)` : `BROKEN at seq ${audit.brokenAtSeq}: ${audit.detail}`);
  line('ledger chain', ledger.ok ? `verified (${ledger.rows} rows)` : `BROKEN at ${ledger.brokenAtId}: ${ledger.detail}`);
  line('treasury balance', `${treasury.totals.totalBalanceCents} cents across ${treasury.wallets.length} wallets`);

  process.stdout.write('\n  Prohibited (compiled in, cannot be enabled by configuration):\n');
  for (const [key, statement] of Object.entries(PROHIBITION_STATEMENTS)) {
    process.stdout.write(`    · ${key}: ${statement}\n`);
  }

  process.stdout.write('\n  Still requires external provider activation (nothing invented here):\n');
  for (const entry of EXTERNAL_ACTIVATION) {
    process.stdout.write(`    · ${entry.provider} — ${entry.action}\n      why: ${entry.why}\n`);
  }

  process.stdout.write('\n  Next: npm run mission:serve   (private dashboard on the configured port)\n\n');
}

main().catch((error) => {
  process.stderr.write(`\nmission:init failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
