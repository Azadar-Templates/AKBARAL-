/**
 * ONE-OFF, sandbox-only, read-only verification script. NOT part of the
 * production build or CI. Never writes to GitHub, never spends money, never
 * fabricates data. Uses a disposable throwaway sqlite file so it leaves no
 * trace in any real mission database. Exercises the real, unmodified
 * GithubBountyWorkflow.discover() against the live public GitHub Search API
 * to get final real counts for the Request 24 report.
 */
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `live-bounty-check-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'live-check-session-not-persisted-not-real';

async function main() {
  const { applyMissionMigrations, missionDb: db } = await import('../src/mission/database');
  const { GithubBountyWorkflow } = await import('../src/mission/earning/github-bounty-workflow');
  const { configuredGithubBountyClient } = await import('../src/mission/earning/github-bounty-client');
  const { updatePolicy, setKillSwitch } = await import('../src/mission/policy');

  applyMissionMigrations();
  const ownerId = 'live-check-owner';
  db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,?,?,'owner','active')", [ownerId, 'live-check@example.test', 'x']);
  setKillSwitch(false, ownerId);
  updatePolicy({ killSwitch: false, autonomousEnabled: true, currency: 'USD', maxDailySpendCents: 100000, maxExpenseCents: 10000, requireApprovalAboveCents: 500 }, ownerId);
  const owner = { kind: 'owner' as const, id: ownerId };

  const client = configuredGithubBountyClient(process.env);
  console.log(`authenticated=${client.authenticated} (unauthenticated discovery is fully supported, just lower rate limit)`);
  const workflow = new GithubBountyWorkflow(client);

  const opportunities = await workflow.discover(owner);
  console.log(`\nTotal discovered leads this pass: ${opportunities.length}`);

  const accepted = opportunities.filter((o: any) => o.risk_state === 'accepted');
  const rejected = opportunities.filter((o: any) => o.risk_state === 'rejected');
  console.log(`Accepted (passed automatic fraud/bait risk screen): ${accepted.length}`);
  console.log(`Rejected (automatic fraud/bait risk screen): ${rejected.length}`);
  const byReason: Record<string, number> = {};
  for (const o of rejected) byReason[String(o.risk_reason)] = (byReason[String(o.risk_reason)] ?? 0) + 1;
  console.log('Rejection reasons breakdown:', JSON.stringify(byReason, null, 2));

  console.log('\nAccepted leads (repo#issue, stars, hinted amount):');
  for (const o of accepted) console.log(`  ${o.repo_full_name}#${o.issue_number}  stars=${o.repo_stars}  hinted=${o.hinted_amount_cents == null ? 'none' : `$${(Number(o.hinted_amount_cents) / 100).toFixed(2)}`}`);

  console.log('\nRunning repo AI-contribution-policy check on accepted leads...');
  let policyAllowed = 0, policyBanned = 0, policyErrored = 0;
  for (const o of accepted) {
    try {
      const policy = await workflow.checkPolicy(owner, String(o.id));
      if (policy && Number(policy.ai_contributions_allowed)) policyAllowed++; else policyBanned++;
    } catch (error) {
      policyErrored++;
      console.log(`  policy check error for ${o.repo_full_name}: ${(error as Error).message}`);
    }
  }
  console.log(`Policy-allowed (genuinely executable pending owner PR-content approval): ${policyAllowed}`);
  console.log(`Policy-banned (repo's own CONTRIBUTING/AI policy prohibits AI PRs): ${policyBanned}`);
  console.log(`Policy-check errors (network/rate-limit, left unresolved): ${policyErrored}`);

  db.close();
}
main().catch(error => { console.error(error); process.exit(1); });
