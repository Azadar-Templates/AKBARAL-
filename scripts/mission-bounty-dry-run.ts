/**
 * Read-only, isolated scale validation for the GitHub bounty executor.
 *
 * The only external calls this command makes are GETs to api.github.com through
 * the configured bounty client. It uses a disposable mission database and
 * synthetic local worker rows solely to exercise assignment/execution state;
 * it never creates an account, credits money, calls submit(), or writes to a
 * repository/PR upstream.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'akbaral-bounty-dry-run-'));
  process.env.DRY_RUN = 'true';
  process.env.ZA141251SA_DATABASE_URL = `file:${join(directory, 'mission.db')}`;
  // No secret is printed or created. An absent GitHub credential (authoritative name
  // ZA141251SA_GITHUB_TOKEN, then GITHUB_TOKEN, then GH_TOKEN) is intentional: discovery here
  // stays read-only and unauthenticated.
  try {
    // These imports must happen after the disposable DB target is selected.
    // eslint/tsc accepts require here because the project includes node types.
    const { applyMissionMigrations, missionDb: db } = require('../src/mission/database') as typeof import('../src/mission/database');
    type Row = import('../src/mission/database').Row;
    const { updatePolicy, ensurePolicy } = require('../src/mission/policy') as typeof import('../src/mission/policy');
    const { setMoneyGrant } = require('../src/mission/money') as typeof import('../src/mission/money');
    const { configuredGithubBountyWorkflow } = require('../src/mission/earning/github-bounty-workflow') as typeof import('../src/mission/earning/github-bounty-workflow');
    const { runParallelBountyCycle } = require('../src/mission/earning/github-bounty-parallel-executor') as typeof import('../src/mission/earning/github-bounty-parallel-executor');

    applyMissionMigrations();
    const owner = { kind: 'owner' as const, id: 'dry-run-owner' };
    db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'dry-run-owner@example.invalid','not-a-login-secret','owner','active')", [owner.id]);
    ensurePolicy('USD');
    updatePolicy({ killSwitch: false, autonomousEnabled: true, currency: 'USD', maxDailySpendCents: 100000, maxExpenseCents: 10000, requireApprovalAboveCents: 500 }, owner.id);

    const agentIds = Array.from({ length: 8 }, (_, index) => `dry-run-agent-${index + 1}`);
    for (const agentId of agentIds) {
      db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Disposable dry-run worker','specialist',0,'dry-run','active','worker','isolated')", [agentId, agentId]);
      setMoneyGrant(owner, agentId, { spendLimitCents: 10000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), status: 'active' });
    }

    const result = await runParallelBountyCycle(owner, configuredGithubBountyWorkflow(), { maxConcurrency: 8, dryRun: true });
    const opportunities = db.all<Row>('SELECT repo_full_name,issue_number,issue_url,hinted_amount_cents,risk_state FROM mission_bounty_opportunities ORDER BY observed_at DESC');
    const drafts = db.all<Row>(`SELECT c.id,c.repo_full_name,c.external_pr_url,c.state,c.pr_title,c.content_hash
      FROM mission_bounty_candidates c ORDER BY c.updated_at DESC`);
    const blocked = db.all<Row>(`SELECT id,assignment_id,state,blocked_reason FROM mission_bounty_execution_jobs ORDER BY updated_at DESC`);
    process.stdout.write(JSON.stringify({
      mode: 'DRY_RUN',
      outboundPullRequestSubmission: 'UNREACHABLE',
      externalWriteCalls: 0,
      result,
      realGithubOpportunities: opportunities.map(row => ({ ...row, amountCents: row.hinted_amount_cents })),
      draftPrSummaries: drafts,
      blockedExecutionJobs: blocked,
      note: 'Issue URLs and declared amounts are retained only when returned by GitHub search. No settlement, account, credit, or upstream PR mutation is performed.',
    }, null, 2) + '\n');
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_:-]{1,160}$/i.test(error.message) ? error.message : 'dry_run_blocked';
    process.stderr.write(JSON.stringify({ mode: 'DRY_RUN', status: 'BLOCKED', code, outboundPullRequestSubmission: 'UNREACHABLE' }) + '\n');
    process.exitCode = 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

void main();
