/** Scope gate for the GitHub-issue bounty worker. Synthetic fixtures only:
 * disposable DB, in-process transport, no live GitHub, no real money. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `bounty-scope-gate-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'fixture-only-bounty-scope-gate-session-not-live';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';

const testLiveness = setInterval(() => {}, 1000);
const { GithubBountyClient } = require('./github-bounty-client') as typeof import('./github-bounty-client');
const { applyMissionMigrations, missionDb: db } = require('../database') as typeof import('../database');
const { GithubBountyWorkflow } = require('./github-bounty-workflow') as typeof import('./github-bounty-workflow');
const { runGithubBountyCycle } = require('./github-bounty-scheduler') as typeof import('./github-bounty-scheduler');
const { BountyScopeError, updateBountyProgram, upsertScopeAllowlist } = require('./bug-bounty-system') as typeof import('./bug-bounty-system');
const { OciBountySandboxRunner, configuredSandboxRepository, DEFAULT_SANDBOX_IMAGE_REPOSITORY } = require('./github-bounty-sandbox') as typeof import('./github-bounty-sandbox');
const { registerFixtureRepoProgram, SCOPE_TABLES } = require('./github-bounty-scope.fixtures') as typeof import('./github-bounty-scope.fixtures');
const m = require('../money') as typeof import('../money');
const { updatePolicy, setKillSwitch } = require('../policy') as typeof import('../policy');

const owner = { kind: 'owner' as const, id: 'scope-owner' }, agent = 'scope-agent';
const ALLOWED = 'acme/allowed', OTHER = 'acme/other', BLOCKED_BY_DENY = 'acme/denied';
const json = (body: unknown, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Lead { repo: string; number: number }
/** Records every outbound request. Returns leads for any bounty search, even
 * from repositories the test did not allow-list, to prove the gate drops them. */
function transport(leads: Lead[], calls: string[]): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; const p = url.pathname;
    calls.push(`${method} ${p}`);
    if (p === '/search/issues') {
      const q = url.searchParams.get('q') ?? '';
      if (!q.startsWith('label:bounty')) return json({ items: [] });
      return json({ items: leads.map(lead => ({ number: lead.number, html_url: `https://github.com/${lead.repo}/issues/${lead.number}`, title: `Fix ${lead.repo} $100`, body: 'Bounty: $100 for a tested fix.', state: 'open', labels: [{ name: 'bounty' }], repository_url: `https://api.github.com/repos/${lead.repo}` })) });
    }
    const issue = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(p);
    if (issue) return json({ number: Number(issue[2]), html_url: `https://github.com/${issue[1]}/issues/${issue[2]}`, title: `Fix ${issue[1]}`, body: 'Bounty: $100 for a tested fix. The existing suite should pass.', state: 'open', labels: [{ name: 'bounty' }], assignees: [], comments: 0, updated_at: '2026-01-01T00:00:00Z' });
    const issueComments = /^\/repos\/([^/]+\/[^/]+)\/issues\/\d+\/comments$/.exec(p);
    if (issueComments) return json([]);
    const meta = /^\/repos\/([^/]+\/[^/]+)$/.exec(p);
    if (meta) return json({ stargazers_count: 42, forks_count: 3, open_issues_count: 5, created_at: '2018-01-01T00:00:00Z', archived: false, fork: false, default_branch: 'main' });
    const policy = /^\/repos\/([^/]+\/[^/]+)\/contents\/CONTRIBUTING\.md$/.exec(p);
    if (policy) return json({ content: Buffer.from('Contributions welcome, AI-assisted PRs allowed with disclosure.').toString('base64'), encoding: 'base64' });
    if (/\/contents\//.test(p)) return json({}, 404); // other policy files are simply absent
    return json({ message: 'fixture-unhandled' }, 500);
  };
}
function workflow(calls: string[], leads: Lead[] = [{ repo: ALLOWED, number: 7 }]) {
  return new GithubBountyWorkflow(new GithubBountyClient({ accessToken: `fixture-only-token-${randomUUID()}` }, { fetch: transport(leads, calls) }));
}
const outbound = (calls: string[], repo: string) => calls.filter(call => call.includes(`/${repo}`)).length;
const scopeEvents = (repo: string) => db.all<Record<string, unknown>>('SELECT decision, reason FROM scope_gate_events WHERE target=? ORDER BY created_at', [repo]);
const auditBlocks = (repo: string) => db.all('SELECT action FROM mission_audit WHERE action IN (?,?) AND subject_id=?', ['bounty.scope_gate_blocked', 'bounty.scope_gate_program_not_configured', repo]);

const tables = [...SCOPE_TABLES, 'mission_bounty_api_requests', 'mission_bounty_api_cooldown', 'mission_bounty_runs', 'mission_bounty_events', 'mission_bounty_candidates', 'mission_bounty_execution_jobs', 'mission_bounty_assignments', 'mission_bounty_policy', 'mission_bounty_opportunities', 'mission_money_liabilities', 'mission_money_opportunities', 'mission_money_receipts', 'mission_money_ledger', 'mission_earning_jobs', 'mission_opportunity_roi'];

before(() => {
  applyMissionMigrations();
  db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'scope-gate@example.invalid','fixture','owner','active')", [owner.id]);
  db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Scope fixture agent','specialist',0,'custom','active','worker','fixture')", [agent, agent]);
});
beforeEach(() => {
  setKillSwitch(false, owner.id);
  for (const table of tables) { try { db.run(`DELETE FROM ${table}`); } catch { /* table absent in this build */ } }
  updatePolicy({ killSwitch: false, autonomousEnabled: true, currency: 'USD', maxDailySpendCents: 100000, maxExpenseCents: 10000, requireApprovalAboveCents: 500 }, owner.id);
  m.setMoneyGrant(owner, agent, { spendLimitCents: 10000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), status: 'active' });
});
after(() => { try { db.close(); } finally { clearInterval(testLiveness); } });

it('with zero active programs the worker performs no discovery and no outbound call', async () => {
  const calls: string[] = [];
  const result = await runGithubBountyCycle(owner, workflow(calls));
  assert.equal(result.ran, false);
  assert.equal(result.reason, 'program_not_configured');
  assert.equal(calls.length, 0, `expected zero outbound calls, saw ${calls.join(', ')}`);
  assert.equal(auditBlocks('github-issue-bounty').length >= 1, true);
  assert.deepEqual(await workflow(calls).discover(owner), []);
  assert.equal(calls.length, 0);
});

it('an issue whose repository has no matching program is skipped and the refusal is recorded', async () => {
  registerFixtureRepoProgram([ALLOWED]);
  const calls: string[] = [];
  const opportunities = await workflow(calls, [{ repo: ALLOWED, number: 7 }, { repo: OTHER, number: 8 }]).discover(owner);
  assert.deepEqual(opportunities.map(row => String(row.repo_full_name)), [ALLOWED]);
  assert.equal(outbound(calls, OTHER), 0, 'no metadata or policy fetch may touch the non-allow-listed repository');
  const blocked = db.all<Record<string, unknown>>("SELECT detail FROM mission_audit WHERE action='bounty.scope_gate_blocked' AND subject_id=?", [OTHER]);
  assert.equal(blocked.length, 1);
  assert.match(String(blocked[0].detail), /target_not_allowlisted/);
});

it('target_not_allowlisted: policy fetch and assignment are refused with no outbound call', async () => {
  registerFixtureRepoProgram([ALLOWED]);
  const calls: string[] = [];
  const row = db.run("INSERT INTO mission_bounty_opportunities (id,repo_full_name,issue_number,issue_url,title,issue_body,labels_json,hinted_amount_cents,state,observed_at,risk_state) VALUES ('opp-x',?,1,'https://github.com/acme/other/issues/1','t','Bounty: $100','[]',10000,'discovered',?,'accepted')", [OTHER, new Date().toISOString()]);
  assert.ok(row.changes === 1);
  const w = workflow(calls);
  await assert.rejects(w.checkPolicy(owner, 'opp-x'), (e: unknown) => e instanceof BountyScopeError && e.reason === 'target_not_allowlisted');
  assert.throws(() => w.assign(owner, { agentId: agent, opportunityId: 'opp-x' }), (e: unknown) => e instanceof BountyScopeError && e.reason === 'target_not_allowlisted');
  assert.equal(outbound(calls, OTHER), 0);
  assert.equal(db.get<Record<string, unknown>>('SELECT COUNT(*) AS n FROM mission_bounty_assignments')?.n, 0);
  assert.equal(db.get<Record<string, unknown>>('SELECT COUNT(*) AS n FROM mission_money_opportunities')?.n, 0, 'a refused assignment must not create a money opportunity');
  // No program owns this repo, so there is no program-level event; the refusal is audited.
  assert.ok(auditBlocks(OTHER).length >= 1);
});

it('explicitly_out_of_scope: a deny row in any active program blocks even when another active program allows', async () => {
  registerFixtureRepoProgram([BLOCKED_BY_DENY]);
  const denyingProgram = registerFixtureRepoProgram([]);
  upsertScopeAllowlist(denyingProgram, { target: BLOCKED_BY_DENY, targetType: 'repo', inScope: false });
  const calls: string[] = [];
  const w = workflow(calls);
  db.run("INSERT INTO mission_bounty_opportunities (id,repo_full_name,issue_number,issue_url,title,issue_body,labels_json,hinted_amount_cents,state,observed_at,risk_state) VALUES ('opp-d',?,1,'https://github.com/acme/denied/issues/1','t','Bounty: $100','[]',10000,'discovered',?,'accepted')", [BLOCKED_BY_DENY, new Date().toISOString()]);
  await assert.rejects(w.checkPolicy(owner, 'opp-d'), (e: unknown) => e instanceof BountyScopeError && e.reason === 'explicitly_out_of_scope');
  assert.equal(outbound(calls, BLOCKED_BY_DENY), 0);
  assert.ok(scopeEvents(BLOCKED_BY_DENY).some(e => e.reason === 'explicitly_out_of_scope' && e.decision === 'blocked'));
});

it('program_inactive: an allow row under an inactive program is refused', async () => {
  registerFixtureRepoProgram([ALLOWED]); // keep one active program so the reason is program-specific
  const inactive = registerFixtureRepoProgram([OTHER], { active: false });
  assert.ok(inactive);
  const calls: string[] = [];
  db.run("INSERT INTO mission_bounty_opportunities (id,repo_full_name,issue_number,issue_url,title,issue_body,labels_json,hinted_amount_cents,state,observed_at,risk_state) VALUES ('opp-i',?,1,'https://github.com/acme/other/issues/1','t','Bounty: $100','[]',10000,'discovered',?,'accepted')", [OTHER, new Date().toISOString()]);
  await assert.rejects(workflow(calls).checkPolicy(owner, 'opp-i'), (e: unknown) => e instanceof BountyScopeError && e.reason === 'program_inactive');
  assert.equal(outbound(calls, OTHER), 0);
});

it('program_not_configured: with no active program, a direct policy check is refused before any fetch', async () => {
  const calls: string[] = [];
  db.run("INSERT INTO mission_bounty_opportunities (id,repo_full_name,issue_number,issue_url,title,issue_body,labels_json,hinted_amount_cents,state,observed_at,risk_state) VALUES ('opp-n',?,1,'https://github.com/acme/allowed/issues/1','t','Bounty: $100','[]',10000,'discovered',?,'accepted')", [ALLOWED, new Date().toISOString()]);
  await assert.rejects(workflow(calls).checkPolicy(owner, 'opp-n'), (e: unknown) => e instanceof BountyScopeError && e.reason === 'program_not_configured');
  assert.equal(calls.length, 0);
});

it('the claim recheck is scope-gated too: a non-allow-listed repository is refused with no outbound call', async () => {
  registerFixtureRepoProgram([ALLOWED]);
  const calls: string[] = [];
  const w = workflow(calls, []);
  db.run("INSERT INTO mission_bounty_opportunities (id,repo_full_name,issue_number,issue_url,title,issue_body,labels_json,hinted_amount_cents,state,observed_at,risk_state) VALUES ('opp-claim',?,1,'https://github.com/acme/other/issues/1','t','Bounty: $100','[]',10000,'discovered',?,'accepted')", [OTHER, new Date().toISOString()]);
  await assert.rejects(w.recheckEligibility(owner, 'opp-claim'), (e: unknown) => e instanceof BountyScopeError && e.reason === 'target_not_allowlisted');
  assert.equal(outbound(calls, OTHER), 0, 'a claim check may not reach out to a repository that is not in scope');
  assert.equal(db.get<Record<string, unknown>>("SELECT claim_state FROM mission_bounty_opportunities WHERE id='opp-claim'")?.claim_state, null);
});

it('an allow-listed repository passes the gate and proceeds through discovery, policy and assignment', async () => {
  registerFixtureRepoProgram([ALLOWED]);
  const calls: string[] = [];
  const w = workflow(calls, [{ repo: ALLOWED, number: 7 }]);
  const [opportunity] = await w.discover(owner);
  assert.equal(String(opportunity.repo_full_name), ALLOWED);
  await w.checkPolicy(owner, String(opportunity.id));
  await w.recheckEligibility(owner, String(opportunity.id));
  const assignment = w.assign(owner, { agentId: agent, opportunityId: String(opportunity.id) });
  assert.equal(assignment.state, 'eligible');
  assert.ok(scopeEvents(ALLOWED).some(e => e.decision === 'allowed' && e.reason === 'explicit_allowlist_match'));
  assert.equal(outbound(calls, OTHER), 0);
});

it('a scope-gate block creates no assignment, no draft and no execution job', async () => {
  const programId = registerFixtureRepoProgram([ALLOWED]);
  const calls: string[] = [];
  const w = workflow(calls, [{ repo: ALLOWED, number: 7 }]);
  const [opportunity] = await w.discover(owner);
  await w.checkPolicy(owner, String(opportunity.id));
  await w.recheckEligibility(owner, String(opportunity.id));
  const assignment = w.assign(owner, { agentId: agent, opportunityId: String(opportunity.id) });
  // Revoke scope after assignment: the later steps must refuse, not proceed.
  updateBountyProgram(programId, { active: false });
  assert.throws(() => w.queueExecution(owner, String(assignment.id)), (e: unknown) => e instanceof BountyScopeError);
  assert.throws(() => w.draft(owner, String(assignment.id), { key: 'k-blocked', baseBranch: 'main', branchName: 'b', filePath: 'x.ts', fileContent: 'x', commitMessage: 'c', prTitle: 't', prBody: 'b' }), (e: unknown) => e instanceof BountyScopeError);
  assert.equal(db.get<Record<string, unknown>>('SELECT COUNT(*) AS n FROM mission_bounty_execution_jobs')?.n, 0);
  assert.equal(db.get<Record<string, unknown>>('SELECT COUNT(*) AS n FROM mission_bounty_candidates')?.n, 0);
});

it('a submit after scope is revoked is refused before the candidate changes state or any mutation is sent', async () => {
  const programId = registerFixtureRepoProgram([ALLOWED]);
  const calls: string[] = [];
  const w = workflow(calls, [{ repo: ALLOWED, number: 7 }]);
  const [opportunity] = await w.discover(owner);
  await w.checkPolicy(owner, String(opportunity.id));
  await w.recheckEligibility(owner, String(opportunity.id));
  const assignment = w.assign(owner, { agentId: agent, opportunityId: String(opportunity.id) });
  const candidate = w.draft(owner, String(assignment.id), { key: 'k-submit', baseBranch: 'main', branchName: 'fix', filePath: 'src/x.ts', fileContent: 'x', commitMessage: 'Fix', prTitle: 'Fix', prBody: 'Fixes it.' });
  w.approveCandidate(owner, String(candidate.id), String(candidate.content_hash));
  updateBountyProgram(programId, { active: false });
  const before = calls.length;
  await assert.rejects(w.submit(owner, String(candidate.id)), (e: unknown) => e instanceof BountyScopeError && e.reason === 'program_not_configured');
  assert.equal(calls.length, before, 'no GitHub request may be sent after the scope gate refuses');
  assert.equal(db.get<Record<string, unknown>>('SELECT state FROM mission_bounty_candidates WHERE id=?', [String(candidate.id)])?.state, 'eligible');
});

it('sandbox unavailable: a queued execution runs nothing and makes no repository, issue, archive or model call', async () => {
  registerFixtureRepoProgram([ALLOWED]);
  const calls: string[] = [];
  const unavailable = { available: async () => false, inspect: async () => { throw new Error('must not inspect'); }, verify: async () => { throw new Error('must not verify'); } } as any;
  const w = new GithubBountyWorkflow(new GithubBountyClient({ accessToken: `fixture-only-token-${randomUUID()}` }, { fetch: transport([{ repo: ALLOWED, number: 7 }], calls) }), unavailable);
  const [opportunity] = await w.discover(owner);
  await w.checkPolicy(owner, String(opportunity.id));
  await w.recheckEligibility(owner, String(opportunity.id));
  const assignment = w.assign(owner, { agentId: agent, opportunityId: String(opportunity.id) });
  const job = w.queueExecution(owner, String(assignment.id));
  const before = calls.length;
  const result = await w.executeJob(owner, String(job.id));
  assert.equal(result.state, 'blocked');
  assert.equal(result.blocked_reason, 'sandbox_unavailable');
  assert.equal(calls.filter((call, index) => index >= before && /tarball|\/issues\/|\/contents\//.test(call)).length, 0, 'no archive, issue or policy fetch may run without a sandbox');
});

it('sandbox image repository is configurable with the trusted default, and an invalid override fails closed', () => {
  assert.equal(DEFAULT_SANDBOX_IMAGE_REPOSITORY, 'ghcr.io/azadar-templates/akbaral-bounty-sandbox');
  assert.equal(configuredSandboxRepository(undefined), DEFAULT_SANDBOX_IMAGE_REPOSITORY);
  assert.equal(configuredSandboxRepository('   '), DEFAULT_SANDBOX_IMAGE_REPOSITORY);
  assert.equal(configuredSandboxRepository('ghcr.io/owner-registry/sandbox'), 'ghcr.io/owner-registry/sandbox');
  for (const bad of ['ghcr.io/x:latest', 'ghcr.io/../x', 'ghcr.io/x/', 'ghcr.io/x y', 'GHCR.IO/X@sha256:' + 'a'.repeat(64)]) assert.equal(configuredSandboxRepository(bad), null, bad);
  const digest = `sha256:${'b'.repeat(64)}`;
  assert.equal(new OciBountySandboxRunner({ image: digest, runtime: 'docker', repository: 'ghcr.io/owner-registry/sandbox' }).image, `ghcr.io/owner-registry/sandbox@${digest}`);
  assert.equal(new OciBountySandboxRunner({ image: digest, runtime: 'docker', repository: 'ghcr.io/x:tag' }).image, '');
});
