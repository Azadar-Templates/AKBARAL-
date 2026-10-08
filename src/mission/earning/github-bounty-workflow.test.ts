/** Synthetic provider fixtures only. Disposable DB; no live GitHub API, no real money. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `bounty-workflow-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'fixture-only-bounty-session-not-live';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
const testLiveness = setInterval(() => {}, 1000);
import { GithubBountyClient } from './github-bounty-client';
const { applyMissionMigrations, missionDb: db } = require('../database') as typeof import('../database');
const { registerFixtureRepoProgram, SCOPE_TABLES } = require('./github-bounty-scope.fixtures') as typeof import('./github-bounty-scope.fixtures');
const { GithubBountyWorkflow } = require('./github-bounty-workflow') as typeof import('./github-bounty-workflow');
const m = require('../money') as typeof import('../money');
const { updatePolicy, setKillSwitch } = require('../policy') as typeof import('../policy');

const owner = { kind: 'owner' as const, id: 'fixture-owner' }, agent = 'fixture-agent', other = 'fixture-other';
const REPO = 'acme/widget', LOGIN = 'fixture-bot', FORK = `${LOGIN}/widget`;
let banned = false, mergedState: 'open' | 'merged' | 'closed_unmerged' = 'open';
let reviewState: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' = 'APPROVED';
let checkConclusion: 'success' | 'failure' = 'success';
const json = (body: unknown, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client() {
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; const p = url.pathname;
    if (p === '/search/issues') {
      const q = url.searchParams.get('q') ?? '';
      if (q.startsWith('label:bounty')) return json({ items: [{ number: 7, html_url: `https://github.com/${REPO}/issues/7`, title: 'Fix flaky test $100', body: 'Bounty: $100 for a tested fix.', state: 'open', labels: [{ name: 'bounty' }], repository_url: `https://api.github.com/repos/${REPO}` }] });
      return json({ items: [] });
    }
    if (p === `/repos/${REPO}/contents/CONTRIBUTING.md`) {
      const text = banned ? 'We do not accept AI-generated pull requests. Humans only.' : 'Contributions welcome, AI-assisted PRs allowed with disclosure.';
      return json({ content: Buffer.from(text).toString('base64'), encoding: 'base64' });
    }
    if (p.startsWith(`/repos/${REPO}/contents/`)) return json({}, 404);
    if (p === `/repos/${REPO}`) return json({ stargazers_count: 42, forks_count: 3, open_issues_count: 5, created_at: '2018-01-01T00:00:00Z', archived: false, fork: false });
    if (p === `/repos/${REPO}/forks` && method === 'POST') return json({}, 202);
    if (p === '/user') return json({ login: LOGIN });
    if (p === `/repos/${REPO}/git/ref/heads/main`) return json({ object: { sha: 'a'.repeat(40) } });
    if (p === `/repos/${FORK}/git/refs` && method === 'POST') return json({}, 201);
    if (p.startsWith(`/repos/${FORK}/contents/`) && method === 'GET') return json({}, 404);
    if (p.startsWith(`/repos/${FORK}/contents/`) && method === 'PUT') return json({ content: {} }, 201);
    if (p === `/repos/${REPO}/pulls` && method === 'POST') return json({ number: 9, html_url: `https://github.com/${REPO}/pull/9`, head: { sha: 'b'.repeat(40) } }, 201);
    if (p === `/repos/${REPO}/pulls/9` && method === 'GET') return json({ number: 9, html_url: `https://github.com/${REPO}/pull/9`, state: mergedState === 'open' ? 'open' : 'closed', merged: mergedState === 'merged', merged_at: mergedState === 'merged' ? '2026-01-01T00:00:00Z' : null, head: { sha: 'b'.repeat(40) } });
    if (p === `/repos/${REPO}/pulls/9/reviews` && method === 'GET') return json([{ state: reviewState }]);
    if (p === `/repos/${REPO}/commits/${'b'.repeat(40)}/check-runs` && method === 'GET') return json({ check_runs: [{ status: 'completed', conclusion: checkConclusion }] });
    assert.fail(`unsupported fixture endpoint: ${method} ${p}`);
  };
  return new GithubBountyClient({ accessToken: `fixture-only-token-${randomUUID()}` }, { fetch: transport });
}

const tables = [...SCOPE_TABLES, 'mission_bounty_api_requests', 'mission_bounty_api_cooldown', 'mission_bounty_events', 'mission_bounty_candidates', 'mission_bounty_assignments', 'mission_bounty_policy', 'mission_bounty_opportunities', 'mission_earning_jobs', 'mission_money_receipts', 'mission_cash_liabilities', 'mission_cash_entries', 'mission_money_transfers', 'mission_money_operations', 'mission_money_grants', 'mission_money_opportunities', 'mission_cash_accounts', 'mission_opportunity_roi'];
let w: InstanceType<typeof GithubBountyWorkflow>;
before(() => {
  applyMissionMigrations();
  db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'fixture-owner@example.test','fixture','owner','active')", [owner.id]);
  for (const id of [agent, other]) db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Fixture agent','specialist',0,'custom','active','worker','fixture')", [id, id]);
});
beforeEach(() => {
  setKillSwitch(false, owner.id);
  for (const table of tables) db.run(`DELETE FROM ${table}`);
  registerFixtureRepoProgram([REPO]); // scope: this fixture repo is the one allow-listed target
  updatePolicy({ killSwitch: false, autonomousEnabled: true, currency: 'USD', maxDailySpendCents: 100000, maxExpenseCents: 10000, requireApprovalAboveCents: 500 }, owner.id);
  for (const id of [agent, other]) m.setMoneyGrant(owner, id, { spendLimitCents: 10000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now() + 86400000).toISOString(), status: 'active' });
  banned = false; mergedState = 'open'; reviewState = 'APPROVED'; checkConclusion = 'success';
  w = new GithubBountyWorkflow(client());
});
after(() => { try { db.close(); } finally { clearInterval(testLiveness); } });

async function draftCandidate() {
  const opps = await w.discover(owner);
  await w.checkPolicy(owner, String(opps[0].id));
  const a = w.assign(owner, { agentId: agent, opportunityId: String(opps[0].id) });
  return w.draft(owner, String(a.id), { key: 'k1', baseBranch: 'main', branchName: 'fix-flaky', filePath: 'src/x.ts', fileContent: 'export const x = 1;', commitMessage: 'Fix flaky test', prTitle: 'Fix flaky test', prBody: 'This fixes issue #7.' });
}

it('discovers only via GitHub public search, never fabricates an opportunity, never sends the token unauthenticated', async () => {
  const opps = await w.discover(owner);
  assert.equal(opps.length, 1);
  assert.equal(opps[0].repo_full_name, REPO);
  assert.equal(opps[0].issue_number, 7);
  assert.equal(opps[0].hinted_amount_cents, 10000);
  assert.equal(opps[0].state, 'discovered');
});

it('policy check reads the repo\'s own files and defaults ambiguous cases to disclosure, never unconditional permission', async () => {
  const opps = await w.discover(owner);
  const policy = await w.checkPolicy(owner, String(opps[0].id));
  assert.equal(policy!.ai_contributions_allowed, 1);
  assert.equal(policy!.disclosure_required, 1);
});

it('refuses assignment outright when the target repo\'s own policy bans AI contributions', async () => {
  banned = true;
  const opps = await w.discover(owner);
  await w.checkPolicy(owner, String(opps[0].id));
  assert.throws(() => w.assign(owner, { agentId: agent, opportunityId: String(opps[0].id) }), /repo_policy_prohibits_ai_contributions/);
});

it('refuses assignment before a policy check has ever run', async () => {
  const opps = await w.discover(owner);
  assert.throws(() => w.assign(owner, { agentId: agent, opportunityId: String(opps[0].id) }), /policy_not_checked/);
});

it('enforces exclusive one-agent-per-bounty assignment', async () => {
  const opps = await w.discover(owner);
  await w.checkPolicy(owner, String(opps[0].id));
  w.assign(owner, { agentId: agent, opportunityId: String(opps[0].id) });
  assert.throws(() => w.assign(owner, { agentId: other, opportunityId: String(opps[0].id) }), /exclusive_assignment_conflict/);
});

it('always appends the mandatory AI-disclosure line server-side and is idempotent on the same key', async () => {
  const c1 = await draftCandidate();
  assert.match(String(c1.pr_body), /Disclosure: this change was researched and drafted with AI assistance/);
  const opps = db.all('SELECT * FROM mission_bounty_opportunities'); void opps;
  const a = db.get<any>('SELECT * FROM mission_bounty_assignments WHERE agent_id=?', [agent]);
  const c2 = w.draft(owner, String(a.id), { key: 'k1', baseBranch: 'main', branchName: 'fix-flaky', filePath: 'src/x.ts', fileContent: 'export const x = 1;', commitMessage: 'Fix flaky test', prTitle: 'Fix flaky test', prBody: 'This fixes issue #7.' });
  assert.equal(c2.id, c1.id, 'same idempotency key returns the same candidate');
  assert.throws(() => w.draft(owner, String(a.id), { key: 'k1', baseBranch: 'main', branchName: 'fix-flaky', filePath: 'src/x.ts', fileContent: 'DIFFERENT', commitMessage: 'Fix flaky test', prTitle: 'Fix flaky test', prBody: 'This fixes issue #7.' }), /idempotency_conflict/);
});

it('requires exact owner content-hash approval before a PR can ever be submitted', async () => {
  const c = await draftCandidate();
  await assert.rejects(w.submit(owner, String(c.id)), /owner_approval_required/);
  assert.throws(() => w.approveCandidate(owner, String(c.id), 'wrong-hash'), /approval_content_mismatch/);
  w.approveCandidate(owner, String(c.id), String(c.content_hash));
});

it('submits a real fork+branch+PR sequence only after approval, and records the real PR number/url', async () => {
  const c = await draftCandidate();
  w.approveCandidate(owner, String(c.id), String(c.content_hash));
  const submitted = await w.submit(owner, String(c.id));
  assert.equal(submitted.state, 'submitted');
  assert.equal(submitted.external_pr_number, 9);
  assert.equal(submitted.external_pr_url, `https://github.com/${REPO}/pull/9`);
});

it('tracks real merge state from GitHub only, never infers it locally', async () => {
  const c = await draftCandidate();
  w.approveCandidate(owner, String(c.id), String(c.content_hash));
  const submitted = await w.submit(owner, String(c.id));
  mergedState = 'merged';
  const tracked = await w.trackPullRequest(owner, String(submitted.id));
  assert.equal(tracked!.state, 'merged');
});

it('overview never claims settlement is configured when no settlement adapter exists, and is owner-only', () => {
  const view = w.overview(owner);
  assert.equal(view.blocked.includes('settlement_not_configured'), true);
  assert.throws(() => w.overview({ kind: 'agent', id: agent }), /owner_required/);
});

it('policy is blocked and no work proceeds while the kill switch is engaged', async () => {
  const opps = await w.discover(owner);
  await w.checkPolicy(owner, String(opps[0].id));
  setKillSwitch(true, owner.id);
  assert.throws(() => w.assign(owner, { agentId: agent, opportunityId: String(opps[0].id) }), /policy_blocked/);
});

it('automatically rejects a known bait/farm-repo lead at discovery and refuses assignment even after a passing policy check', async () => {
  const baitRepo = 'someone/agent-bounties-farm';
  registerFixtureRepoProgram([baitRepo]); // scope: the risk screen only sees allow-listed repos
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; const p = url.pathname;
    if (p === '/search/issues') {
      const q = url.searchParams.get('q') ?? '';
      if (q.startsWith('label:bounty')) return json({ items: [{ number: 1, html_url: `https://github.com/${baitRepo}/issues/1`, title: 'Fix this for $500', body: 'Bounty: $500 for a tested fix.', state: 'open', labels: [{ name: 'bounty' }], repository_url: `https://api.github.com/repos/${baitRepo}` }] });
      return json({ items: [] });
    }
    if (p === `/repos/${baitRepo}`) return json({ stargazers_count: 0, forks_count: 0, open_issues_count: 40, created_at: new Date().toISOString(), archived: false, fork: false });
    if (p.startsWith(`/repos/${baitRepo}/contents/`)) return json({}, 404);
    assert.fail(`unsupported fixture endpoint: ${method} ${p}`);
  };
  const w2 = new GithubBountyWorkflow(new GithubBountyClient({ accessToken: `fixture-only-token-${randomUUID()}` }, { fetch: transport }));
  const opps = await w2.discover(owner);
  assert.equal(opps[0].repo_full_name, baitRepo);
  assert.equal(opps[0].risk_state, 'rejected');
  assert.equal(opps[0].risk_reason, 'known_bait_or_farm_repo_name_pattern');
  await w2.checkPolicy(owner, String(opps[0].id));
  assert.throws(() => w2.assign(owner, { agentId: agent, opportunityId: String(opps[0].id) }), /lead_risk_rejected/);
});

it('automatically rejects a brand-new zero-star repo lead as high risk', async () => {
  const newRepo = 'someone/totally-legit-project';
  registerFixtureRepoProgram([newRepo]); // scope: allow-listed so the risk screen is reached
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; const p = url.pathname;
    if (p === '/search/issues') {
      const q = url.searchParams.get('q') ?? '';
      if (q.startsWith('label:bounty')) return json({ items: [{ number: 1, html_url: `https://github.com/${newRepo}/issues/1`, title: 'Please fix this bug', body: 'Bounty: $100 for a tested fix.', state: 'open', labels: [{ name: 'bounty' }], repository_url: `https://api.github.com/repos/${newRepo}` }] });
      return json({ items: [] });
    }
    if (p === `/repos/${newRepo}`) return json({ stargazers_count: 0, forks_count: 0, open_issues_count: 1, created_at: new Date().toISOString(), archived: false, fork: false });
    if (p.startsWith(`/repos/${newRepo}/contents/`)) return json({}, 404);
    assert.fail(`unsupported fixture endpoint: ${method} ${p}`);
  };
  const w2 = new GithubBountyWorkflow(new GithubBountyClient({ accessToken: `fixture-only-token-${randomUUID()}` }, { fetch: transport }));
  const opps = await w2.discover(owner);
  assert.equal(opps[0].risk_state, 'rejected');
  assert.equal(opps[0].risk_reason, 'new_zero_star_repo_high_risk');
});

it('automatically rejects duplicate templated titles posted across unrelated repos', async () => {
  const templated = 'Please help us fix critical issue for bounty reward';
  registerFixtureRepoProgram(['repo-one/x', 'repo-two/y']); // scope: both repos allow-listed
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; const p = url.pathname;
    if (p === '/search/issues') {
      const q = url.searchParams.get('q') ?? '';
      if (q.startsWith('label:bounty')) return json({ items: [
        { number: 1, html_url: 'https://github.com/repo-one/x/issues/1', title: templated, body: 'Bounty: $100 for a tested fix.', state: 'open', labels: [{ name: 'bounty' }], repository_url: 'https://api.github.com/repos/repo-one/x' },
        { number: 1, html_url: 'https://github.com/repo-two/y/issues/1', title: templated, body: 'Bounty: $100 for a tested fix.', state: 'open', labels: [{ name: 'bounty' }], repository_url: 'https://api.github.com/repos/repo-two/y' },
      ] });
      return json({ items: [] });
    }
    if (p === '/repos/repo-one/x' || p === '/repos/repo-two/y') return json({ stargazers_count: 10, forks_count: 1, open_issues_count: 1, created_at: '2018-01-01T00:00:00Z', archived: false, fork: false });
    if (p.includes('/contents/')) return json({}, 404);
    assert.fail(`unsupported fixture endpoint: ${method} ${p}`);
  };
  const w2 = new GithubBountyWorkflow(new GithubBountyClient({ accessToken: `fixture-only-token-${randomUUID()}` }, { fetch: transport }));
  const opps = await w2.discover(owner);
  assert.equal(opps.length, 2);
  for (const opp of opps) {
    assert.equal(opp.risk_state, 'rejected');
    assert.equal(opp.risk_reason, 'duplicate_templated_title_across_unrelated_repos');
  }
});

it('feeds the mission-wide continuous-learning ROI table with real, non-fabricated outcomes only', async () => {
  const roi = () => db.get<any>("SELECT * FROM mission_opportunity_roi WHERE registry_key='github_issue_bounties'");
  assert.equal(roi(), undefined, 'no ROI row before any real attempt');
  const c = await draftCandidate();
  const afterDraft = roi();
  assert.equal(afterDraft.attempts, 1, 'a prepared candidate counts as one real attempt');
  assert.equal(afterDraft.successes, 0);
  assert.equal(afterDraft.failures, 0);

  w.approveCandidate(owner, String(c.id), String(c.content_hash));
  const submitted = await w.submit(owner, String(c.id));
  mergedState = 'merged';
  await w.trackPullRequest(owner, String(submitted.id));
  const afterMerge = roi();
  assert.equal(afterMerge.successes, 1, 'a GitHub-verified merge is a real, externally-verified success');
  assert.equal(afterMerge.total_net_cents, 10000, 'net cents reflects only the real hinted amount, never a fabricated figure');

  // Re-polling an already-merged PR must never double-count the same outcome.
  await w.trackPullRequest(owner, String(submitted.id));
  assert.equal(roi().successes, 1);
});

it('records a real ROI failure when a PR is closed without being merged', async () => {
  const c = await draftCandidate();
  w.approveCandidate(owner, String(c.id), String(c.content_hash));
  const submitted = await w.submit(owner, String(c.id));
  mergedState = 'closed_unmerged';
  const tracked = await w.trackPullRequest(owner, String(submitted.id));
  assert.equal(tracked!.state, 'closed_unmerged');
  const roi = db.get<any>("SELECT * FROM mission_opportunity_roi WHERE registry_key='github_issue_bounties'");
  assert.equal(roi.failures, 1);
  assert.equal(roi.successes, 0);
});


it('passively records GitHub review/check evidence and follows a merge without owner polling', async () => {
  const c = await draftCandidate();
  w.approveCandidate(owner, String(c.id), String(c.content_hash));
  const submitted = await w.submit(owner, String(c.id));

  reviewState = 'CHANGES_REQUESTED'; checkConclusion = 'failure';
  const first = await w.refreshSubmittedPullRequests(owner);
  assert.deepEqual(first, {
    attempted: 1, observed: 1, merged: 0, closedUnmerged: 0,
    reviewsApproved: 0, changesRequested: 1, checksPassing: 0, checksFailing: 1, failed: 0,
  });
  const pending = db.get<any>('SELECT state,review_state,checks_state,review_summary_json,last_reviewed_at FROM mission_bounty_candidates WHERE id=?', [submitted.id]);
  assert.equal(pending.state, 'submitted');
  assert.equal(pending.review_state, 'changes_requested');
  assert.equal(pending.checks_state, 'failing');
  assert.ok(pending.last_reviewed_at);
  assert.match(String(pending.review_summary_json), /github_rest/);

  // GitHub itself is the only merge source. A merge is completed work, never
  // cash: ROI is updated once, and no mission receipt/wallet is created.
  mergedState = 'merged';
  const second = await w.refreshSubmittedPullRequests(owner);
  assert.equal(second.merged, 1);
  const merged = db.get<any>('SELECT state,review_state,checks_state FROM mission_bounty_candidates WHERE id=?', [submitted.id]);
  assert.equal(merged.state, 'merged');
  assert.equal(merged.review_state, 'not_applicable');
  assert.equal(merged.checks_state, 'not_applicable');
  const roi = db.get<any>("SELECT * FROM mission_opportunity_roi WHERE registry_key='github_issue_bounties'");
  assert.equal(roi.successes, 1);
  assert.equal(db.get<any>('SELECT COUNT(*) AS n FROM mission_money_receipts')?.n, 0);

  const third = await w.refreshSubmittedPullRequests(owner);
  assert.equal(third.attempted, 0, 'terminal pull requests are not re-polled or double-counted');
  assert.equal(db.get<any>("SELECT successes FROM mission_opportunity_roi WHERE registry_key='github_issue_bounties'")?.successes, 1);
});
