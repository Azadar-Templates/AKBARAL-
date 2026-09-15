/**
 * ZA141251SA mission server entry — `npm run mission:serve`
 *
 * Runs the private mission application on its OWN port. Nothing in the AKBARAL!
 * public app serves this; discovery is impossible from the public surface.
 *
 * Bind behaviour:
 *   default 127.0.0.1  → reachable only on the machine it runs on (recommended;
 *                        pair with an authenticated private tunnel for remote
 *                        access by authorised agents)
 *   ZA141251SA_BIND_HOST=0.0.0.0 → explicit opt-in for a private network/container
 *
 * The server refuses to start with a wildcard bind unless an owner account can
 * exist (owner provisioning env or an already-provisioned owner), so a private
 * dashboard is never exposed without an authentication path.
 */
import { missionEnv, missionDb, verifyMissionAudit } from '../src/mission/database';
import { ownerCount, vaultConfigured } from '../src/mission/auth';
import { startMissionServer } from '../src/mission/server';
import { verifyLedger } from '../src/mission/treasury';

async function main(): Promise<void> {
  const env = missionEnv();
  const host = env.bindHost;

  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    const hasOwner = ownerCount() > 0 || (process.env.ZA141251SA_OWNER_EMAIL && process.env.ZA141251SA_OWNER_PASSWORD);
    if (!hasOwner) {
      process.stderr.write(
        `mission:serve refused: bind host ${host} would expose the private dashboard but no mission owner exists.\n` +
          'Run `npm run mission:init` with ZA141251SA_OWNER_EMAIL and ZA141251SA_OWNER_PASSWORD first.\n',
      );
      process.exit(1);
    }
  }

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
  process.stdout.write('  isolation            separate process, database, auth and secrets from AKBARAL!\n\n');

  const shutdown = async (signal: string) => {
    process.stdout.write(`\nmission:serve received ${signal}; shutting down\n`);
    await running.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  process.stderr.write(`mission:serve failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
