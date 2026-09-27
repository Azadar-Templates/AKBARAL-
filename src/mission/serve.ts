/**
 * ZA141251SA mission server — production entry point.
 *
 * `scripts/mission-serve.ts` (tsx, development) and the compiled
 * `dist/src/mission/serve.js` (production container / `AKBARAL_ROLES=mission`)
 * both run THIS function, so the private tier has exactly one bootstrap
 * contract: identical bind guard, identity lockdown sweep, audit and ledger
 * verification, and shutdown handling. Before this existed the mission tier
 * had no compiled entry at all and simply never started in a deployed
 * container — the dashboard was unreachable in production even though the
 * image carried its database path.
 *
 * Bind behaviour:
 *   default 127.0.0.1  → reachable only on the machine it runs on
 *   ZA141251SA_BIND_HOST=0.0.0.0 → explicit opt-in for a private network or a
 *                        container whose ingress is authenticated
 *
 * The server refuses a wildcard bind unless an owner account exists or a
 * single-use owner setup link is pending, so the private dashboard is never
 * exposed without an authentication path.
 */
import { missionEnv, missionDb, verifyMissionAudit } from './database';
import { ownerCount, vaultConfigured } from './auth';
import { ownerSetupAvailability } from './owner-setup';
import { enforceIdentityLock, identityLockEnabled, identityLockVerified } from './identity-lock';
import { startMissionServer } from './server';
import { verifyLedger } from './treasury';

export async function serveMission(): Promise<void> {
  const env = missionEnv();
  const host = env.bindHost;

  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    // A pending single-use owner setup link is the sanctioned bootstrap path:
    // it only ever re-keys the identity in ZA141251SA_OWNER_EMAIL, it expires,
    // and it means the owner types their password into their own browser
    // instead of putting it in an environment variable. Without an owner AND
    // without such a link the dashboard still refuses to listen publicly.
    const setup = ownerSetupAvailability();
    const hasOwner = ownerCount() > 0 || (process.env.ZA141251SA_OWNER_EMAIL && process.env.ZA141251SA_OWNER_PASSWORD);
    if (!hasOwner && setup.available) {
      process.stdout.write(
        `mission server — no owner account yet; listening only to accept the one-time setup link for ${setup.maskedEmail} (expires ${setup.expiresAt}).\n`,
      );
    } else if (!hasOwner) {
      process.stderr.write(
        `mission server refused: bind host ${host} would expose the private dashboard but no mission owner exists.\n` +
          'Run `npm run mission:owner-setup-link` (password typed in the browser) or `npm run mission:init` with ZA141251SA_OWNER_EMAIL and ZA141251SA_OWNER_PASSWORD.\n',
      );
      process.exit(1);
    }
  }

  // Single-identity lockdown runs BEFORE the listener opens: any foreign
  // account is suspended, its sessions revoked and pre-existing access links
  // revoked, so the socket can only ever answer to the configured identity.
  const lock = enforceIdentityLock();
  const lockCheck = identityLockVerified();

  const running = await startMissionServer({ host, port: env.port });
  const audit = verifyMissionAudit();
  const ledger = verifyLedger();

  process.stdout.write('\nZA141251SA mission system — private application\n');
  process.stdout.write(`  listening            http://${host}:${running.port}\n`);
  process.stdout.write(`  database             ${missionDb.path()}\n`);
  process.stdout.write(`  owner accounts       ${ownerCount()}\n`);
  process.stdout.write(`  credential vault     ${vaultConfigured() ? 'configured' : 'disabled (ZA141251SA_CREDENTIAL_KEY not set)'}\n`);
  process.stdout.write(`  audit chain          ${audit.ok ? `verified (${audit.rows})` : 'BROKEN'}\n`);
  process.stdout.write(`  ledger chain         ${ledger.ok ? `verified (${ledger.rows})` : 'BROKEN'}\n`);
  process.stdout.write(
    `  identity lockdown    ${
      identityLockEnabled()
        ? lockCheck.ok
          ? `ENFORCED — single identity only (${lock.swept ? 'sweep ran on this boot' : `swept ${lock.enforcedAt}`})`
          : `FAILED — ${lockCheck.reason}`
        : 'OFF — set ZA141251SA_OWNER_EMAIL to restrict authentication to one identity'
    }\n`,
  );
  process.stdout.write('  isolation            separate process, database, auth and secrets from AKBARAL!\n\n');

  if (identityLockEnabled() && !lockCheck.ok) {
    process.stderr.write(`mission server refused: identity lockdown verification failed (${lockCheck.reason})\n`);
    await running.close();
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    process.stdout.write(`\nmission server received ${signal}; shutting down\n`);
    await running.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (require.main === module) {
  serveMission().catch((error) => {
    process.stderr.write(`mission server failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
