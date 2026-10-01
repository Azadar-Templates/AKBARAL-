/** Synthetic provider fixtures only. Disposable DB; no live GitHub API, no real money. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `bounty-scheduler-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'fixture-only-bounty-scheduler-session-not-live';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
const testLiveness = setInterval(() => {}, 1000);
import { GithubBountyClient } from './github-bounty-client';
const { applyMissionMigrations, missionDb: db } = require('../database') as typeof import('../database');
const { GithubBountyWorkflow } = require('./github-bounty-workflow') as typeof import('./github-bounty-workflow');
const { runGithubBountyCycle } = require('./github-bounty-scheduler') as typeof import('./github-bounty-scheduler');
const m = require('../money') as typeof import('../money');
const { updatePolicy, setKillSwitch } = require('../policy') as typeof import('../policy');

const owner = { kind: 'owner' as const, id: 'fixture-owner' }, agent = 'fixture-agent';
const REPO = 'acme/widget';
const json = (body: unknown, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client() {
  const transport: typeof fetch = async (input) => {
    const url = new URL(String(input)); const p = url.pathname;
    if (p === '/search/issues') {
      const q = url.searchParams.get('q') ?? '';
      if (q.startsWith('label:bounty')) return json({ items: [{ number: 7, html_url: `https://github.com/${REPO}/issues/7`, title: 'Fix flaky test $100', state: 'open', labels: [{ name: 'bounty' }], repository_url: `https://api.github.com/repos/${REPO}` }] });
      return json({ items: [] });
    }
    if (p === `/repos/${REPO}`) return json({ stargazers_count: 42, forks_count: 3, open_issues_count: 5, created_at: '2018-01-01T00:00:00Z', archived: false, fork: false });
    if (p === `/repos/${REPO}/contents/CONTRIBUTING.md`) return json({ content: Buffer.from('Contributions welcome, AI-assisted PRs allowed with disclosure.').toString('base64'), encoding: 'base64' });
    if (p.startsWith(`/repos/${REPO}/contents/`)) return json({}, 404);
    assert.fail(`unsupported fixture endpoint: GET ${p}`);
  };
  // Unique token per test: the client's self-imposed rate-limit window is keyed by
  // token hash and shared at module scope, so reusing accessToken:null across many
  // fast back-to-back tests in one process would spuriously throttle later tests.
  return new GithubBountyClient({ accessToken: `fixture-only-token-${randomUUID()}` }, { fetch: transport });
}

const tables = ['mission_bounty_api_requests', 'mission_bounty_api_cooldown', 'mission_bounty_events', 'mission_bounty_candidates', 'mission_bounty_assignments', 'mission_bounty_policy', 'mission_bounty_opportunities', 'mission_bounty_scheduler_state', 'mission_bounty_review_scheduler_state', 'mission_opportunity_roi', 'mission_money_grants'];
let w: InstanceType<typeof GithubBountyWorkflow>;
before(() => {
  applyMissionMigrations();
  db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'fixture-owner@example.test','fixture','owner','active')", [owner.id]);
  db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Fixture agent','specialist',0,'custom','active','worker','fixture')", [agent, agent]);
});
beforeEach(() => {
  setKillSwitch(false, owner.id);
  for (const table of tables) db.run(`DELETE FROM ${table}`);
  db.run("INSERT INTO mission_bounty_scheduler_state (id, last_attempted_at, last_result) VALUES ('global', NULL, NULL)");
  db.run("INSERT INTO mission_bounty_review_scheduler_state (id, last_attempted_at, last_result) VALUES ('global', NULL, NULL)");
  updatePolicy({ killSwitch: false, autonomousEnabled: true, currency: 'USD', maxDailySpendCents: 100000, maxExpenseCents: 10000, requireApprovalAboveCents: 500 }, owner.id);
  w = new GithubBountyWorkflow(client());
});
after(() => { try { db.close(); } finally { clearInterval(testLiveness); } });

it('runs the full discover -> policy-check -> assign sweep on the first call with zero owner/agent action', async () => {
  const result = await runGithubBountyCycle(owner, w);
  assert.equal(result.ran, true);
  assert.equal(result.discovered, 1);
  assert.equal(result.rejected, 0);
  assert.equal(result.policyChecked, 1);
  assert.equal(result.policyAllowed, 1);
  // No agent has a money grant configured yet, so assignment is an honest skip, not a fabricated success.
  assert.equal(result.assigned, 0);
  assert.equal(result.prReviewAttempted, 0, 'the first passive monitor has no submitted PR to poll');
  assert.equal(result.prReviewed, 0);
  const opp = db.get<any>('SELECT * FROM mission_bounty_opportunities LIMIT 1');
  assert.equal(opp.risk_state, 'accepted');
});

it('assigns to a real available agent once a money grant exists, with zero owner/agent action beyond configuring the grant', async () => {
  m.setMoneyGrant(owner, agent, { spendLimitCents: 10000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), status: 'active' });
  const result = await runGithubBountyCycle(owner, w);
  assert.equal(result.assigned, 1);
  const assignment = db.get<any>('SELECT * FROM mission_bounty_assignments LIMIT 1');
  assert.equal(assignment.agent_id, agent);
  assert.equal(assignment.state, 'eligible');
  assert.equal(result.executionAttempted, 0, 'the host lacks a provisioned OCI runtime in this synthetic fixture');
  assert.equal(result.executionReason, 'sandbox_unavailable');
});

it('self-paces: does not re-run a full sweep within the minimum interval, even if called again immediately', async () => {
  const first = await runGithubBountyCycle(owner, w);
  assert.equal(first.ran, true);
  const second = await runGithubBountyCycle(owner, w);
  assert.equal(second.ran, false);
  assert.equal(second.reason, 'not_due');
  // Still exactly one opportunity recorded — the second call made no new GitHub requests.
  assert.equal(db.get<any>('SELECT COUNT(*) AS n FROM mission_bounty_opportunities')?.n, 1);
});

it('never aborts the cycle on a transient/rate-limited error and records the attempt so the gate still applies', async () => {
  const failing = new GithubBountyClient({ accessToken: `fixture-only-token-${randomUUID()}` }, { fetch: async () => { throw new Error('network down'); } });
  const w2 = new GithubBountyWorkflow(failing);
  const result = await runGithubBountyCycle(owner, w2);
  assert.equal(result.ran, true);
  assert.equal(result.discovered, 0);
  const state = db.get<any>("SELECT * FROM mission_bounty_scheduler_state WHERE id='global'");
  assert.match(String(state.last_result), /^failed:/);
});
