/** Synthetic local rows only; the scale executor never uses fake GitHub issues. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `bounty-parallel-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'fixture-only-parallel-session';
import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { GithubBountyClient, GithubBountyRateGate } from './github-bounty-client';
import { GithubBountyWorkflow } from './github-bounty-workflow';
import { bountyRunsSnapshot, releaseExpiredBountyRuns, runParallelBountyCycle } from './github-bounty-parallel-executor';
import { applyMissionMigrations, missionDb as db, missionId, type Row } from '../database';
const { registerFixtureRepoProgram } = require('./github-bounty-scope.fixtures') as typeof import('./github-bounty-scope.fixtures');

const owner = { kind: 'owner' as const, id: 'parallel-owner' };
const now = new Date('2026-01-01T00:00:00.000Z');
let workflow: GithubBountyWorkflow;
let issueRows: Row[] = [];

before(() => {
  applyMissionMigrations();
  // scope: every fixture repository is allow-listed under one active program
  registerFixtureRepoProgram(['acme/lease', ...Array.from({ length: 100 }, (_, index) => `acme/widget-${index + 1}`)]);
  db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'parallel@example.invalid','fixture','owner','active')", [owner.id]);
  for (let index = 1; index <= 100; index += 1) {
    const agentId = `parallel-agent-${index}`;
    const opportunityId = `parallel-opportunity-${index}`;
    const moneyId = `parallel-money-${index}`;
    db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Parallel fixture agent','specialist',0,'fixture','active','worker','fixture')", [agentId, agentId]);
    db.run("INSERT INTO mission_money_opportunities (id,title,evidence_url,activity,provider,approved_by,created_at) VALUES (?,?,'https://github.com/acme/widget/issues/1','software_development','github-bounty-settlement',?,?)", [moneyId, `Fixture bounty ${index}`, owner.id, now.toISOString()]);
    db.run("INSERT INTO mission_bounty_opportunities (id,repo_full_name,issue_number,issue_url,title,issue_body,labels_json,hinted_amount_cents,state,observed_at,risk_state,risk_reason,repo_stars,repo_created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [opportunityId, `acme/widget-${index}`, index, `https://github.com/acme/widget-${index}/issues/${index}`, `Fix ${index}`, 'Bounty: $100 for a tested fix.', '[]', 10000, 'discovered', now.toISOString(), 'accepted', null, 100, '2018-01-01T00:00:00.000Z']);
  }
  db.run("UPDATE mission_bounty_opportunities SET claim_state='payable', claim_checked_at=?", [now.toISOString()]);
  issueRows = db.all<Row>('SELECT * FROM mission_bounty_opportunities ORDER BY issue_number');
  const fake = {
    discover: async () => issueRows,
    checkPolicy: async () => ({ ai_contributions_allowed: true }),
    recheckEligibility: async (_actor: unknown, opportunityId: string) => db.get<Row>('SELECT * FROM mission_bounty_opportunities WHERE id=?', [opportunityId])!,
    assign: (_actor: unknown, input: { agentId: string; opportunityId: string }) => {
      const op = db.get<Row>('SELECT * FROM mission_bounty_opportunities WHERE id=?', [input.opportunityId])!;
      const id = missionId('parallel-assignment');
      db.run("INSERT INTO mission_bounty_assignments (id,agent_id,opportunity_id,money_opportunity_id,state,approved_by,created_at) VALUES (?,?,?,?,'eligible',?,?)", [id, input.agentId, input.opportunityId, `parallel-money-${Number(op.issue_number)}`, owner.id, now.toISOString()]);
      return db.get<Row>('SELECT * FROM mission_bounty_assignments WHERE id=?', [id])!;
    },
    executionReadiness: async () => ({ ready: false, reason: 'sandbox_unavailable' as const }),
  } as unknown as GithubBountyWorkflow;
  workflow = fake;
});

after(() => db.close());

it('deduplicates assignment state by issue and caps 100 viable issues at configured N=8', async () => {
  const result = await runParallelBountyCycle(owner, workflow, { maxConcurrency: 8, now: () => now });
  assert.equal(result.availableViableIssues, 100);
  assert.equal(result.assigned, 8);
  assert.equal(result.idleIssues, 92);
  assert.equal(result.idleReason, 'no_viable_opportunity');
  assert.equal(db.get<Row>('SELECT COUNT(*) AS n FROM mission_bounty_assignments')?.n, 8);
  assert.equal(db.get<Row>("SELECT COUNT(*) AS n FROM mission_bounty_runs WHERE state='blocked'")?.n, 8);
  assert.equal(new Set(db.all<Row>('SELECT opportunity_id FROM mission_bounty_assignments').map(row => String(row.opportunity_id))).size, 8);
});

it('never binds an agent to a lead the live claim check says is not payable to us', async () => {
  // A freshly seeded, in-scope, policy-clean lead — the only thing between it and an
  // assignment is the claim verdict, so this pins the gate itself rather than the fixture.
  for (const table of ['mission_bounty_runs', 'mission_bounty_execution_jobs', 'mission_bounty_candidates', 'mission_bounty_assignments']) db.run(`DELETE FROM ${table}`);
  db.run("UPDATE mission_bounty_opportunities SET claim_state='not_payable', claim_reason='claimed_by_other_party', claim_checked_at=? WHERE id='parallel-opportunity-1'", [now.toISOString()]);
  const claimed = db.get<Row>("SELECT * FROM mission_bounty_opportunities WHERE id='parallel-opportunity-1'")!;
  assert.equal(claimed.risk_state, 'accepted', 'the lead is otherwise clean: only the claim verdict stands in the way');
  const w = { ...workflow, discover: async () => [claimed] } as unknown as GithubBountyWorkflow;
  const result = await runParallelBountyCycle(owner, w, { maxConcurrency: 8, now: () => now });
  assert.equal(result.claimsChecked, 1, 'the policy-clean lead gets a live claim verdict recorded');
  assert.equal(result.claimsPayable, 0);
  assert.equal(result.claimsBlocked, 1);
  assert.equal(result.availableViableIssues, 0, 'a claimed bounty is not viable work, however well labelled it is');
  assert.equal(result.assigned, 0);
  assert.equal(db.get<Row>('SELECT COUNT(*) AS n FROM mission_bounty_assignments')?.n, 0, 'no assignment, no money opportunity, no wasted spend');
});

it('releases an expired lease and makes the agent available without duplicating the issue', () => {
  const agentId = 'lease-agent';
  const opportunityId = 'lease-opportunity';
  const moneyId = 'lease-money';
  db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Lease fixture','specialist',0,'fixture','active','worker','fixture')", [agentId, agentId]);
  db.run("INSERT INTO mission_money_opportunities (id,title,evidence_url,activity,provider,approved_by,created_at) VALUES (?,?,'https://github.com/acme/lease/issues/1','software_development','github-bounty-settlement',?,?)", [moneyId, 'Lease fixture', owner.id, now.toISOString()]);
  db.run("INSERT INTO mission_bounty_opportunities (id,repo_full_name,issue_number,issue_url,title,issue_body,labels_json,hinted_amount_cents,state,observed_at,risk_state,risk_reason,repo_stars,repo_created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [opportunityId, 'acme/lease', 1, 'https://github.com/acme/lease/issues/1', 'Lease', 'Bounty: $100', '[]', 10000, 'assigned', now.toISOString(), 'accepted', null, 100, '2018-01-01T00:00:00.000Z']);
  const assignmentId = 'lease-assignment';
  db.run("INSERT INTO mission_bounty_assignments (id,agent_id,opportunity_id,money_opportunity_id,state,approved_by,created_at) VALUES (?,?,?,?,'eligible',?,?)", [assignmentId, agentId, opportunityId, moneyId, owner.id, now.toISOString()]);
  db.run("INSERT INTO mission_bounty_runs (id,assignment_id,opportunity_id,agent_id,state,lease_expires_at,started_at,created_at,updated_at) VALUES ('lease-run',?,?,?,?,?,?,?,?)", [assignmentId, opportunityId, agentId, 'running', new Date(now.getTime() - 1000).toISOString(), now.toISOString(), now.toISOString(), now.toISOString()]);
  assert.equal(releaseExpiredBountyRuns(now), 1);
  const run = db.get<Row>("SELECT state,reason FROM mission_bounty_runs WHERE id='lease-run'")!;
  assert.equal(run.state, 'released');
  assert.equal(run.reason, 'lease_expired');
  assert.equal(bountyRunsSnapshot().released >= 1, true);
});

it('uses a cooldown token bucket for 429 responses without retrying immediately', async () => {
  let clock = 0;
  const gate = new GithubBountyRateGate(1, () => clock);
  await gate.acquire();
  gate.cooldown(5000);
  assert.equal(gate.snapshot().blockedUntil, 5000);
  clock = 5000;
  assert.equal(gate.snapshot().waiters, 0);
});

it('hard-blocks dry-run submission before a GitHub mutation can be reached', async () => {
  let outbound = 0;
  const client = new GithubBountyClient({ accessToken: 'dry-run-fixture-token' }, { fetch: async () => { outbound += 1; throw new Error('must not call'); } });
  const dryWorkflow = new GithubBountyWorkflow(client, undefined, undefined, { dryRun: true });
  await assert.rejects(dryWorkflow.submit(owner, 'anything'), /bounty_dry_run_submission_blocked/);
  assert.equal(outbound, 0);
});
