/** Synthetic execution pipeline: no Docker, model, repository code, GitHub
 * mutation, money, or network provider is used. The runner/provider are typed
 * fakes so this test proves orchestration and fail-closed boundaries. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `bounty-execution-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'fixture-only-bounty-execution-session-not-live';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
const liveness = setInterval(() => {}, 1000);
import { GithubBountyClient } from './github-bounty-client';
import type { BountySandboxRunner, BountySolutionProposal, SandboxInspection, SandboxVerification } from './github-bounty-sandbox';
import type { BountySolutionInput, BountySolutionProvider } from './github-bounty-solution-provider';
const { applyMissionMigrations, missionDb: db } = require('../database') as typeof import('../database');
const { GithubBountyWorkflow } = require('./github-bounty-workflow') as typeof import('./github-bounty-workflow');
const money = require('../money') as typeof import('../money');
const { updatePolicy, setKillSwitch } = require('../policy') as typeof import('../policy');

const owner = { kind: 'owner' as const, id: 'execution-owner' }, agent = 'execution-agent', REPO = 'acme/widget';
const tables = ['mission_bounty_candidates', 'mission_bounty_execution_jobs', 'mission_bounty_events', 'mission_bounty_assignments', 'mission_bounty_policy', 'mission_bounty_opportunities', 'mission_bounty_api_requests', 'mission_bounty_api_cooldown', 'mission_opportunity_roi', 'mission_money_grants', 'mission_money_opportunities', 'mission_cash_liabilities', 'mission_cash_entries', 'mission_money_transfers', 'mission_money_operations'];
const json = (body: unknown, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client() {
  const transport: typeof fetch = async input => {
    const url = new URL(String(input)), p = url.pathname;
    if (p === '/search/issues') return json({ items: [{ number: 7, html_url: `https://github.com/${REPO}/issues/7`, title: 'Correct escaped query handling $100 bounty', state: 'open', labels: [{ name: 'bounty' }], repository_url: `https://api.github.com/repos/${REPO}` }] });
    if (p === `/repos/${REPO}/contents/CONTRIBUTING.md`) return json({ content: Buffer.from('AI-assisted changes are allowed if disclosed.').toString('base64'), encoding: 'base64' });
    if (p.startsWith(`/repos/${REPO}/contents/`)) return json({}, 404);
    if (p === `/repos/${REPO}/issues/7`) return json({ number: 7, html_url: `https://github.com/${REPO}/issues/7`, state: 'open', title: 'Correct escaped query handling', body: 'The parser should preserve a backslash in escaped query values.', labels: [{ name: 'bounty' }] });
    if (p === `/repos/${REPO}`) return json({ stargazers_count: 42, forks_count: 3, open_issues_count: 5, created_at: '2018-01-01T00:00:00Z', archived: false, fork: false, default_branch: 'main' });
    if (p === `/repos/${REPO}/tarball/main`) return new Response(new Uint8Array([31, 139, 8, 0]), { status: 200, headers: { 'content-length': '4' } });
    assert.fail(`unsupported fixture endpoint ${p}`);
  };
  return new GithubBountyClient({ accessToken: `fixture-token-${randomUUID()}` }, { fetch: transport });
}

const proposal: BountySolutionProposal = {
  files: [{ path: 'src/parser.ts', content: 'export const preserveEscape = (value: string) => value.replaceAll("\\\\", "\\\\");\n' }],
  testArgv: [['npm', 'test', '--', 'parser']], commitMessage: 'Fix escaped query parsing', prTitle: 'Fix escaped query parsing', prBody: 'Fixes #7 with an isolated sandbox verification.',
};
class FakeRunner implements BountySandboxRunner {
  inspected = 0; verified = 0; shouldPass = true;
  async available() { return true; }
  async inspect(archive: Uint8Array): Promise<SandboxInspection> { this.inspected++; assert.equal(archive.byteLength, 4); return { ok: true, summary: 'Synthetic isolated manifest.', files: ['src/parser.ts', 'package.json'] }; }
  async verify(_archive: Uint8Array, received: BountySolutionProposal): Promise<SandboxVerification> { this.verified++; assert.deepEqual(received, proposal); return this.shouldPass ? { ok: true, summary: 'Synthetic sandbox test success.', tests: [{ argv: proposal.testArgv[0], exitCode: 0, output: 'ok' }] } : { ok: false, summary: 'Synthetic sandbox test failure.', reason: 'test_failed', tests: [{ argv: proposal.testArgv[0], exitCode: 1, output: 'failed' }] }; }
}
class FakeSolutions implements BountySolutionProvider {
  inputs: BountySolutionInput[] = [];
  available() { return true; }
  async generate(input: BountySolutionInput) { this.inputs.push(input); return proposal; }
}
let runner: FakeRunner, solutions: FakeSolutions, workflow: InstanceType<typeof GithubBountyWorkflow>;
before(() => {
  applyMissionMigrations();
  db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'execution-owner@example.test','fixture','owner','active')", [owner.id]);
  db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Execution agent','specialist',0,'custom','active','worker','fixture')", [agent, agent]);
});
beforeEach(() => {
  setKillSwitch(false, owner.id);
  // Candidate and execution job cross-reference after a successful run.
  db.run('UPDATE mission_bounty_execution_jobs SET candidate_id=NULL');
  for (const table of tables) db.run(`DELETE FROM ${table}`);
  updatePolicy({ killSwitch: false, autonomousEnabled: true, currency: 'USD', maxDailySpendCents: 100000, maxExpenseCents: 10000, requireApprovalAboveCents: 500 }, owner.id);
  money.setMoneyGrant(owner, agent, { spendLimitCents: 10000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), status: 'active' });
  runner = new FakeRunner(); solutions = new FakeSolutions(); workflow = new GithubBountyWorkflow(client(), runner, solutions);
});
after(() => { try { db.close(); } finally { clearInterval(liveness); } });

async function assigned() {
  const opportunity = (await workflow.discover(owner))[0];
  await workflow.checkPolicy(owner, String(opportunity.id));
  return workflow.assign(owner, { agentId: agent, opportunityId: String(opportunity.id) });
}

it('runs only the opaque archive through the runner, drafts only after passed sandbox tests, and does not submit a PR', async () => {
  const assignment = await assigned();
  const queued = workflow.queueExecution(owner, String(assignment.id));
  assert.equal(queued.state, 'queued');
  const done = await workflow.executeQueued(owner);
  assert.equal(done!.state, 'drafted');
  assert.equal(runner.inspected, 1); assert.equal(runner.verified, 1); assert.equal(solutions.inputs.length, 1);
  const candidate = db.get<any>('SELECT * FROM mission_bounty_candidates');
  assert.equal(candidate.state, 'eligible', 'existing owner-hash approval/submit gates remain in force');
  assert.equal(candidate.execution_job_id, done!.id);
  assert.match(String(candidate.pr_body), /Disclosure: this change was researched and drafted with AI assistance/);
  assert.equal(db.get<any>('SELECT COUNT(*) AS n FROM mission_bounty_events WHERE state=\'submitted\'')?.n, 0);
  assert.equal(db.get<any>('SELECT COUNT(*) AS n FROM mission_money_receipts')?.n, 0);
});

it('blocks instead of drafting when explicit sandbox tests fail', async () => {
  runner.shouldPass = false;
  const assignment = await assigned(); workflow.queueExecution(owner, String(assignment.id));
  const done = await workflow.executeQueued(owner);
  assert.equal(done!.state, 'blocked');
  assert.equal(done!.blocked_reason, 'sandbox_tests_failed');
  assert.equal(db.get<any>('SELECT COUNT(*) AS n FROM mission_bounty_candidates')?.n, 0);
  const stored = JSON.parse(String(done!.verification_json));
  assert.equal(stored.tests[0].exitCode, 1);
});
