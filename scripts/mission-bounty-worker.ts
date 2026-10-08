/**
 * Opt-in production runner for the existing GitHub bounty scheduler/execution
 * path. It never creates a GitHub identity, opens a PR, or invents a payout.
 * In GitHub Actions it is normally called once; a dedicated Docker-capable
 * host may run it continuously with --loop.
 */
import { setTimeout as pause } from 'node:timers/promises';
import { applyMissionMigrations, missionDb, type Row } from '../src/mission/database';
import { configuredMissionOwnerEmail, enforceIdentityLock, identityLockVerified } from '../src/mission/identity-lock';
import { configuredGithubBountyWorkflow } from '../src/mission/earning/github-bounty-workflow';
import { runGithubBountyCycle } from '../src/mission/earning/github-bounty-scheduler';

const LOOP_INTERVAL_MS = 15 * 60 * 1000;
function publicFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Do not print provider/GitHub/Docker payloads. They may contain untrusted
  // text or credentials; detailed bounded evidence is in the mission audit.
  return /^[a-z0-9_:-]{1,160}$/i.test(message) ? message : 'bounty_worker_blocked';
}

async function main() {
  if (process.env.ZA141251SA_BOUNTY_WORKER_ENABLED !== 'true') throw new Error('bounty_worker_disabled');
  const loop = process.argv.includes('--loop');
  if (process.argv.some(arg => !['--loop', '--once'].includes(arg))) throw new Error('bounty_worker_invalid_arguments');
  applyMissionMigrations(); enforceIdentityLock();
  const email = configuredMissionOwnerEmail();
  const owner = missionDb.get<Row>("SELECT id FROM mission_owner WHERE email=? AND role='owner' AND status='active'", [email ?? '']);
  if (!email || !owner || !identityLockVerified().ok) throw new Error('bounty_worker_owner_not_configured');
  const actor = { kind: 'owner' as const, id: String(owner.id) };
  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort());
  try {
    do {
      try {
        const result = await runGithubBountyCycle(actor, configuredGithubBountyWorkflow());
        if (result.reason === 'program_not_configured') process.stdout.write('[mission:bounty] scope_gate: program_not_configured\n');
        process.stdout.write(`[mission:bounty] ${JSON.stringify(result)}\n`);
      } catch (error) {
        process.stderr.write(`[mission:bounty] blocked:${publicFailure(error)}\n`);
      }
      if (!loop || stop.signal.aborted) break;
      await pause(LOOP_INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => undefined);
    } while (!stop.signal.aborted);
  } finally { missionDb.close(); }
}
main().catch(error => {
  process.stderr.write(`[mission:bounty] startup_refused:${publicFailure(error)}\n`);
  missionDb.close(); process.exitCode = 1;
});
