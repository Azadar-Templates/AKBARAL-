import { PAYOUT_VERIFICATION_CHECKS } from './payout-verification';
/**
 * ZA141251SA — private mission application tests (HTTP surface + reporting).
 *
 * Verifies the properties that make the mission system private and honest:
 *   · nothing is readable without a mission session or a scoped access link;
 *   · an agent-scoped link can only ever act for the agent it is bound to;
 *   · the health endpoint only exposes non-sensitive state (no secrets);
 *   · sub-agent creation is contract-based and bounded by policy;
 *   · the mission dashboard payload labels targets as TARGETS and reports only
 *     verified realized revenue;
 *   · the private dashboard assets are served by the MISSION server (never by
 *     the public AKBARAL! app).
 */
process.env.ZA141251SA_DATABASE_URL = `file:${require('node:path').join(require('node:os').tmpdir(), `za141251sa-server-${process.pid}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'test-session-secret-0123456789abcdefghijklmnop';
process.env.ZA141251SA_CREDENTIAL_KEY = 'test-credential-key-0123456789abcdefghijklmn';
process.env.ZA141251SA_CURRENCY = 'USD';
process.env.ZA141251SA_BIND_HOST = '127.0.0.1';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';

import { applyMissionMigrations, missionDb, resolveMissionDbPath, type Row } from './database';
import { createAccessLink, login, provisionOwner } from './auth';
import { createMissionServer } from './server';
import { ensurePolicy } from './policy';
import { ensurePayoutSlots, recordRevenue } from './treasury';
import { seedTools } from './self-management';
import { buildAgentReport, buildMissionOverview, createTarget, listTargets, type AgentRow } from './reporting';

const DB_PATH = resolveMissionDbPath();
const OWNER_EMAIL = 'owner@mission.test';
const OWNER_PASSWORD = 'mission-owner-password-1';

let baseUrl = '';
let rootAgentSlug = '';
let rootWalletId = '';
let ownerToken = '';
let server: ReturnType<typeof createMissionServer>;

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function owner(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  return api(path, { ...init, headers: { authorization: `Bearer ${ownerToken}`, ...(init.headers ?? {}) } });
}

test.before(async () => {
  applyMissionMigrations();
  ensurePolicy('USD');
  seedTools();
  ensurePayoutSlots();
  provisionOwner({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
  server = createMissionServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  ownerToken = login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).token;
});

test('health is reachable without auth and exposes no secrets', async () => {
  const { status, body } = await api('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.requiresOwnerAuth, true);
  assert.equal(body.isolation, 'separate process, database and auth');
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes(process.env.ZA141251SA_SESSION_SECRET!), 'the session secret is never exposed');
  assert.ok(!serialized.includes(process.env.ZA141251SA_CREDENTIAL_KEY!), 'the vault key is never exposed');
  assert.ok(!/password|token_hash|csrf/i.test(serialized), 'no credential material in the health payload');
});

test('every private route refuses anonymous callers', async () => {
  for (const path of ['/api/overview', '/api/agents', '/api/treasury', '/api/ledger', '/api/audit', '/api/policy', '/api/payouts', '/api/credentials', '/api/targets', '/api/approvals', '/api/self-management', '/api/reports']) {
    const { status } = await api(path);
    assert.equal(status, 401, `${path} requires authentication`);
  }
  const missing = await api('/api/does-not-exist');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'not_found');
});

test('owner login issues a session; wrong passwords and unknown accounts are refused', async () => {
  const bad = await api('/api/session/login', { method: 'POST', body: JSON.stringify({ email: OWNER_EMAIL, password: 'wrong-password' }) });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, 'unauthorized');
  const previous = ownerToken;

  const ok = await api('/api/session/login', { method: 'POST', body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }) });
  assert.equal(ok.status, 200);
  assert.ok(String(ok.body.token).length > 20);
  // Logging in rotates sessions: the newest token is the live one for the rest
  // of this suite.
  ownerToken = String(ok.body.token);
  const me = await api('/api/session/me', { headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(me.status, 200);
  assert.equal(me.body.owner.email, OWNER_EMAIL);
  assert.equal(me.body.vaultConfigured, true);
  const stale = await api('/api/session/me', { headers: { authorization: 'Bearer zal_not_real' } });
  assert.equal(stale.status, 401, 'an unknown token is refused');
  const rotated = await api('/api/overview', { headers: { authorization: `Bearer ${previous}` } });
  assert.equal(rotated.status, 401, 'the previous session was revoked by the new login');
});

test('the mission overview reports real state, isolation and honesty markers', async () => {
  const { status, body } = await owner('/api/overview');
  assert.equal(status, 200);
  assert.equal(body.honesty.realizedRevenueOnly, true);
  assert.match(body.isolation.platformLedger, /different database/i, 'the platform ledger is explicitly out of scope');
  assert.ok(body.policy.prohibitions.length >= 10, 'prohibitions are surfaced to the dashboard');
  assert.ok(body.policy.prohibitions.some((entry: any) => entry.key === 'fake_engagement' && entry.statement.length > 10));
  assert.equal(body.audit.ok, true, 'the audit chain verifies');
  assert.equal(body.integrity.ledger.ok, true, 'the ledger chain verifies');
  assert.ok(body.selfManagement.tools.blocked >= 1, 'blocked tools are reported');
  assert.ok(body.honesty.externalActivationPending.length >= 1, 'pending external activations are listed, not hidden');
  assert.equal(body.revenue.realizedCents, 0, 'no revenue is reported before any verified receipt exists');
});

test('an access link grants scoped reads and can be revoked', async () => {
  const read = createAccessLink({ label: 'dashboard read', scope: 'dashboard:read', maxUses: 5, expiresInHours: 2, createdBy: 'owner' });
  const overview = await api('/api/overview', { headers: { 'x-mission-link': read.token } });
  assert.equal(overview.status, 200, 'a scoped link can read the dashboard');

  const mutation = await api('/api/targets', {
    method: 'POST',
    headers: { 'x-mission-link': read.token },
    body: JSON.stringify({ label: 'sneaky', amountCents: 1_000_000 }),
  });
  assert.equal(mutation.status, 401, 'a read link cannot mutate anything');

  const { body } = await owner('/api/access-links', { method: 'POST', body: JSON.stringify({ label: 'revocable', scope: 'dashboard:read', expiresInHours: 1 }) });
  assert.ok(body.token.startsWith('zal_'));
  const before = await api('/api/overview', { headers: { 'x-mission-link': body.token } });
  assert.equal(before.status, 200);
  const revoke = await owner(`/api/access-links/${body.link.id}/revoke`, { method: 'POST' });
  assert.equal(revoke.status, 200);
  assert.equal(revoke.body.revoked, true);
  const after = await api('/api/overview', { headers: { 'x-mission-link': body.token } });
  assert.equal(after.status, 401, 'a revoked link stops working immediately');
});

test('an agent-scoped link can only act for its own agent', async () => {
  missionDb.run(
    `INSERT OR IGNORE INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform)
     VALUES ('agt_link_a', 'link-agent-a', 'Link Agent A', 'specialist', 0, 'custom', 'active', 'worker', 'mission')`,
  );
  missionDb.run(
    `INSERT OR IGNORE INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform)
     VALUES ('agt_link_b', 'link-agent-b', 'Link Agent B', 'specialist', 0, 'custom', 'active', 'worker', 'mission')`,
  );
  const link = createAccessLink({ label: 'agent A only', scope: 'agent:self', agentId: 'agt_link_a', expiresInHours: 1, createdBy: 'owner' });

  const own = await api('/api/tools/request', {
    method: 'POST',
    headers: { 'x-mission-link': link.token },
    body: JSON.stringify({ toolKey: 'web_search', justification: 'research for a client brief' }),
  });
  assert.equal(own.status, 201, 'the link may request a tool for its own agent');

  const other = await api('/api/tools/request', {
    method: 'POST',
    headers: { 'x-mission-link': link.token },
    body: JSON.stringify({ agentId: 'agt_link_b', toolKey: 'web_search' }),
  });
  assert.equal(other.status, 403, 'the link cannot act for another agent');

  const spend = await api('/api/expenses', {
    method: 'POST',
    headers: { 'x-mission-link': link.token },
    body: JSON.stringify({ category: 'api', provider: 'openai', description: 'inference', amountCents: 100, idempotencyKey: 'lnk-exp-1' }),
  });
  // Either the wallet does not exist yet (404/409) or policy refuses — never a silent success.
  assert.ok([402, 403, 404, 409].includes(spend.status), `an unbudgeted agent spend is refused (got ${spend.status})`);
});

test('sub-agents can only be created inside policy and contract limits', async () => {
  missionDb.run(
    `INSERT OR IGNORE INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform)
     VALUES ('agt_parent', 'parent-agent', 'Parent Agent', 'specialist', 0, 'custom', 'active', 'supervisor', 'mission')`,
  );
  const unknown = await owner('/api/agents/no-such-agent/children', { method: 'POST', body: JSON.stringify({ name: 'x', activity: 'software_development', budgetCents: 0 }) });
  assert.equal(unknown.status, 404);

  const prohibited = await owner('/api/agents/parent-agent/children', {
    method: 'POST',
    body: JSON.stringify({ name: 'Growth Hacker', specialization: 'engagement farming', activity: 'fake_engagement', budgetCents: 100 }),
  });
  assert.equal(prohibited.status, 403, 'a sub-agent for a prohibited activity is refused');
  assert.equal(prohibited.body.error.code, 'policy_denied');

  const created = await owner('/api/agents/parent-agent/children', {
    method: 'POST',
    body: JSON.stringify({ name: 'Client Delivery Specialist', specialization: 'client-delivery', activity: 'software_development', budgetCents: 5_000 }),
  });
  assert.equal(created.status, 201);
  assert.equal(Number(created.body.agent.depth), 1);
  assert.equal(String(created.body.agent.parent_id), 'agt_parent');
  assert.equal(Number(created.body.contract.budget_cents), 5_000);
  assert.ok(JSON.parse(String(created.body.contract.permissions)).includes('expense.request'), 'the contract states the permissions');
  assert.equal(created.body.wallet.budgetCents, 5_000, 'the sub-agent gets its own budgeted wallet');

  const auditRow = missionDb.get<Row>(`SELECT * FROM mission_audit WHERE action = 'agent.created' ORDER BY seq DESC LIMIT 1`);
  assert.ok(auditRow, 'agent creation is audited');

  // The kill switch stops all further creation.
  await owner('/api/kill-switch', { method: 'POST', body: JSON.stringify({ engage: true }) });
  const blocked = await owner('/api/agents/parent-agent/children', {
    method: 'POST',
    body: JSON.stringify({ name: 'Another', specialization: 'x', activity: 'software_development', budgetCents: 0 }),
  });
  assert.equal(blocked.status, 409, 'the kill switch stops new agents');
  await owner('/api/kill-switch', { method: 'POST', body: JSON.stringify({ engage: false }) });

  // Agent cap: shrink the ceiling and prove it is enforced.
  await owner('/api/policy', { method: 'PATCH', body: JSON.stringify({ maxAgents: 1 }) });
  const capped = await owner('/api/agents/parent-agent/children', {
    method: 'POST',
    body: JSON.stringify({ name: 'Over cap', specialization: 'y', activity: 'software_development', budgetCents: 0 }),
  });
  assert.equal(capped.status, 409, 'the agent ceiling is enforced');
  await owner('/api/policy', { method: 'PATCH', body: JSON.stringify({ maxAgents: 5000 }) });
});

test('agent reports attribute work, revenue, expenses, resources and audit history', async () => {
  const agent = missionDb.get<Row>(`SELECT * FROM mission_agents WHERE slug = 'parent-agent'`);
  assert.ok(agent);
  const { status, body } = await owner('/api/agents/parent-agent/report');
  assert.equal(status, 200);
  assert.equal(body.agent.slug, 'parent-agent');
  assert.equal(body.honesty.realizedOnly, true);
  assert.equal(body.revenue.realizedCents, 0);
  assert.ok(Array.isArray(body.expenses.entries));
  assert.ok(Array.isArray(body.resources));
  assert.equal(body.audit.chainOk, true);

  const snapshot = await owner('/api/agents/parent-agent/snapshot', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(snapshot.status, 201);
  assert.ok(String(snapshot.body.id).startsWith('rpt_'));
  const stored = missionDb.get<Row>('SELECT * FROM mission_reports WHERE id = ?', [String(snapshot.body.id)]);
  assert.ok(String(stored?.checksum).length === 64, 'the report snapshot is checksummed');
  const listed = await owner('/api/reports?agentId=agt_parent');
  assert.equal(listed.status, 200);
  assert.ok(listed.body.reports.length >= 1);
});

test('targets are labelled as targets and progress counts only verified revenue', async () => {
  const created = await owner('/api/targets', { method: 'POST', body: JSON.stringify({ label: 'Aggressive day target', period: 'day', amountCents: 100_000_000 }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.target.label_kind, 'target');
  assert.equal(created.body.target.progressPct, 0, 'an unearned target shows zero progress');
  assert.match(created.body.target.note, /never presented as an achieved result/i);

  const progressBefore = listTargets().find((target) => target.id === created.body.target.id)!;
  assert.equal(progressBefore.actualCents, 0);

  // Record an EXPECTED amount: it must not move the target.
  await owner('/api/revenue', {
    method: 'POST',
    body: JSON.stringify({ agentId: 'agt_parent', amountCents: 100_000_000, source: 'client', status: 'expected', idempotencyKey: 'tgt-expected-1' }),
  });
  assert.equal(listTargets().find((target) => target.id === created.body.target.id)!.actualCents, 0, 'expected revenue never counts as progress');

  // A verified receipt does move it.
  const received = await owner('/api/revenue', {
    method: 'POST',
    body: JSON.stringify({ agentId: 'agt_parent', amountCents: 25_000_000, source: 'client', status: 'received', idempotencyKey: 'tgt-received-1', verifier: 'provider-webhook', externalRef: 'pi_real_ref_1' }),
  });
  assert.equal(received.status, 409);
  assert.equal(received.body.error.code, 'provider_verification_required');
  const after = listTargets().find((target) => target.id === created.body.target.id)!;
  assert.equal(after.actualCents, 0, 'a caller-supplied verifier string cannot establish cash');
  assert.equal(after.progressPct, 0, 'unverified claims do not advance this target');
  assert.ok(after.actualCents < after.amountCents, 'an unmet target stays unmet');
});

test('the payout surface requires owner authority and verified destinations', async () => {
  const slots = await owner('/api/payout-slots');
  assert.equal(slots.status, 200);
  assert.equal(slots.body.slots.length, 4);
  assert.equal(slots.body.count, 4);

  const configure = await owner('/api/payout-slots/1', {
    method: 'POST',
    body: JSON.stringify({ label: 'Primary destination', destinationType: 'bank', maskedAccount: 'ending-4821', currency: 'USD', minPayoutCents: 1_000 }),
  });
  assert.equal(configure.status, 200);
  assert.equal(configure.body.slot.status, 'pending_verification');

  const early = await owner('/api/payouts', { method: 'POST', body: JSON.stringify({ slot: 1, amountCents: 1_000, idempotencyKey: 'srv-pay-1' }) });
  assert.equal(early.status, 409, 'payouts are refused until the destination is verified');

  const emptyVerification = await owner('/api/payout-slots/1/verify', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(emptyVerification.status, 400, 'status-only activation cannot bypass documentary verification');
  const verified = await owner('/api/payout-slots/1/verify', { method: 'POST', body: JSON.stringify({ checks: Object.fromEntries(PAYOUT_VERIFICATION_CHECKS.map(check => [check.key, true])), attestation: 'Synthetic owner attestation for HTTP tests only; no actual payment destination.' }) });
  assert.equal(verified.status, 200);
  for (const status of ['sent','settled','failed']) {
    const result = await owner('/api/payouts/legacy/settle', {method:'POST',body:JSON.stringify({status,settlementRef:'caller-invented-reference'})});
    assert.equal(result.status,409);
    assert.equal(result.body.error.code,'provider_verification_required');
  }
});

test('the private dashboard is served by the mission server only', async () => {
  const asset = await fetch(`${baseUrl}/`);
  assert.equal(asset.status, 200, 'the mission dashboard index is served');
  const html = await asset.text();
  assert.match(asset.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal(asset.headers.get('x-frame-options'), 'DENY');
  assert.match(html, /ZA141251SA/);
  assert.ok(!html.includes('AKBARAL!'), 'the mission dashboard never renders AKBARAL! branding');
});

test('reporting helpers agree with the HTTP payloads', () => {
  const overview = buildMissionOverview();
  assert.equal(overview.honesty.realizedRevenueOnly, true);
  assert.equal(overview.targets[0].label_kind, 'target');
  const agent = missionDb.get<AgentRow>(`SELECT * FROM mission_agents WHERE slug = 'parent-agent'`)!;
  const report = buildAgentReport(agent);
  assert.equal(report.honesty.realizedOnly, true);
  assert.equal(report.agent.slug, 'parent-agent');
  assert.ok(overview.audit.ok && overview.integrity.ledger.ok, 'chains verify');
  void createTarget;
  void recordRevenue;
});

// ── Operator controls (Section 9 / 14): pause, budget, funding, honest refusals

test('an owner can create a root agent with a contract and a funded wallet, and the contract carries the limits', async () => {
  const created = await owner('/api/agents', {
    method: 'POST',
    body: JSON.stringify({ name: 'Control Root', specialization: 'operations', activity: 'software_development', budgetCents: 2000, missionRole: 'director' }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(created.body.agent.slug);
  assert.equal(Number(created.body.contract.budget_cents), 2000);
  const limits = JSON.parse(String(created.body.contract.resource_limits));
  assert.equal(limits.maxSpendCents, 2000);
  assert.equal(Number(created.body.wallet.budgetCents), 2000);
  rootAgentSlug = String(created.body.agent.slug);
  rootWalletId = String(created.body.wallet.id);
});

test('a create request never answers with a list (no silent fake success)', async () => {
  const { status, body } = await owner('/api/agents', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(status, 400);
  assert.equal(body.error.code, 'validation_error');
  assert.equal(body.agents, undefined, 'a rejected create never returns a page of agents');
});

test('pausing an agent is a real brake: the agent cannot act until it is resumed', async () => {
  const paused = await owner(`/api/agents/${rootAgentSlug}/status`, { method: 'POST', body: JSON.stringify({ status: 'paused', reason: 'probe hold' }) });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.agent.status, 'paused');

  const refused = await owner('/api/work', {
    method: 'POST',
    body: JSON.stringify({ agentSlug: rootAgentSlug, title: 'should never be assigned', activity: 'software_development' }),
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'agent_not_active');

  const resumed = await owner(`/api/agents/${rootAgentSlug}/status`, { method: 'POST', body: JSON.stringify({ status: 'active', reason: 'probe clear' }) });
  assert.equal(resumed.status, 200);
  const allowed = await owner('/api/work', {
    method: 'POST',
    body: JSON.stringify({ agentSlug: rootAgentSlug, title: 'assigned after resume', activity: 'software_development' }),
  });
  assert.equal(allowed.status, 201);
});

test('pausing or retiring an agent requires a reason and is audited', async () => {
  const noReason = await owner(`/api/agents/${rootAgentSlug}/status`, { method: 'POST', body: JSON.stringify({ status: 'paused' }) });
  assert.equal(noReason.status, 400);
  const entries = missionDb.all<Row>(`SELECT action, detail FROM mission_audit WHERE action IN ('agent.paused','agent.resumed') ORDER BY seq DESC LIMIT 4`);
  assert.ok(entries.length >= 2, 'pause/resume decisions are in the audit trail');
  const detail = JSON.parse(String(entries.find((entry) => String(entry.action) === 'agent.paused')!.detail));
  assert.equal(detail.reason, 'probe hold');
});

test('owner notes cannot fund real money, even with idempotency keys', async () => {
  for (const amountCents of [0,100,4000]) {
    const result=await owner(`/api/wallets/${rootWalletId}/fund`,{method:'POST',body:JSON.stringify({amountCents,reference:'owner statement only',idempotencyKey:'legacy-deposit'})});
    assert.equal(result.status,409);assert.equal(result.body.error.code,'provider_verification_required');
  }
  assert.equal(Number(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_ledger WHERE idempotency_key=?',['legacy-deposit'])?.n),0);
});

test('the owner controls a wallet budget and can freeze it', async () => {
  const raised = await owner(`/api/wallets/${rootWalletId}`, { method: 'PATCH', body: JSON.stringify({ budgetCents: 3500, label: 'control wallet' }) });
  assert.equal(raised.status, 200);
  assert.equal(raised.body.wallet.budgetCents, 3500);

  const frozen = await owner(`/api/wallets/${rootWalletId}`, { method: 'PATCH', body: JSON.stringify({ status: 'frozen' }) });
  assert.equal(frozen.status, 200);
  assert.equal(frozen.body.wallet.status, 'frozen');
  const refused = await owner('/api/expenses', {
    method: 'POST',
    body: JSON.stringify({ agentSlug: rootAgentSlug, category: 'api', provider: 'p', description: 'frozen wallet', amountCents: 10 }),
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code,'provider_verification_required');

  await owner(`/api/wallets/${rootWalletId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
  const bad = await owner(`/api/wallets/${rootWalletId}`, { method: 'PATCH', body: JSON.stringify({ budgetCents: -5 }) });
  assert.equal(bad.status, 400);
});

test('legacy expense requests cannot claim payment without a provider', async () => {
  for(const amountCents of [1,1000]) {
    const result=await owner('/api/expenses',{method:'POST',body:JSON.stringify({agentSlug:rootAgentSlug,category:'api',provider:'fixture',amountCents,idempotencyKey:`legacy-${amountCents}`})});
    assert.equal(result.status,409);assert.equal(result.body.error.code,'provider_verification_required');
  }
});

test('the kill switch sub-route is reachable on both paths and blocks work', async () => {
  const engaged = await owner('/api/policy/kill-switch', { method: 'POST', body: JSON.stringify({ engage: true }) });
  assert.equal(engaged.status, 200);
  assert.equal(engaged.body.killSwitch, true, 'the policy sub-route engages the switch instead of silently updating policy');
  const blocked = await owner('/api/work', {
    method: 'POST',
    body: JSON.stringify({ agentSlug: rootAgentSlug, title: 'blocked', activity: 'software_development' }),
  });
  assert.equal(blocked.status, 403);
  const released = await owner('/api/kill-switch', { method: 'POST', body: JSON.stringify({ engage: false }) });
  assert.equal(released.body.killSwitch, false);
  const allowed = await owner('/api/work', {
    method: 'POST',
    body: JSON.stringify({ agentSlug: rootAgentSlug, title: 'after release', activity: 'software_development' }),
  });
  assert.equal(allowed.status, 201);
});

test('the agent report lists the delegation children with their state', async () => {
  const child = await owner(`/api/agents/${rootAgentSlug}/children`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Control Child', specialization: 'verification', activity: 'software_development', budgetCents: 250 }),
  });
  assert.equal(child.status, 201);
  const report = await owner(`/api/agents/${rootAgentSlug}`);
  const children = report.body.agent.children;
  assert.ok(children.some((entry: any) => entry.slug === child.body.agent.slug && entry.status === 'active'));
  assert.equal(report.body.agent.childCount, children.length);
});

test('the legacy approval queue cannot bypass provider verification', async () => {
  const id='legacy-finance-approval';
  missionDb.run("INSERT INTO mission_approvals (id,subject_type,subject_id,action,status) VALUES (?,'payout','legacy-payout','payout.approve','pending')",[id]);
  const result=await owner(`/api/approvals/${id}/decide`,{method:'POST',body:JSON.stringify({decision:'approved'})});
  assert.equal(result.status,409);assert.equal(result.body.error.code,'provider_verification_required');
  assert.equal(missionDb.get<Row>('SELECT status FROM mission_approvals WHERE id=?',[id])?.status,'pending');
});

test('private agent messages are durable, replay-safe, scoped and never execute money commands', async () => {
  const before = Number(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_ledger')!.n);
  const input = { message: 'Synthetic owner message: do not execute any payment from this text.', idempotencyKey: 'owner-message-fixture' };
  const stored = await owner('/api/agents/link-agent-a/messages', { method: 'POST', body: JSON.stringify(input) });
  assert.equal(stored.status, 201);
  assert.equal(stored.body.commandExecuted, false);
  const replay = await owner('/api/agents/link-agent-a/messages', { method: 'POST', body: JSON.stringify(input) });
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.message.id, stored.body.message.id);
  const changed = await owner('/api/agents/link-agent-a/messages', { method: 'POST', body: JSON.stringify({ ...input, message: 'changed content' }) });
  assert.equal(changed.status, 409);
  const link = createAccessLink({ label: 'message fixture', scope: 'agent:self', agentId: 'agt_link_a', expiresInHours: 1, createdBy: 'owner' });
  const headers = { 'x-mission-link': link.token };
  const own = await api('/api/agents/link-agent-a/messages', { headers });
  assert.equal(own.status, 200);
  assert.equal(own.body.automaticReplies, false);
  assert.equal(own.body.messages.length, 1);
  const forbidden = await api('/api/agents/link-agent-b/messages', { headers });
  assert.equal(forbidden.status, 403);
  const reply = await api('/api/agents/link-agent-a/messages', { method: 'POST', headers, body: JSON.stringify({ message: 'Synthetic bound-agent reply, actually submitted via its access link.', replyTo: stored.body.message.id, idempotencyKey: 'agent-message-fixture' }) });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.message.actor_type, 'agent');
  const page = await owner(`/api/agents/link-agent-a/messages?after=${stored.body.message.seq}`);
  assert.equal(page.body.messages.length, 1);
  assert.equal(page.body.messages[0].id, reply.body.message.id);
  assert.equal(Number(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_ledger')!.n), before);
  const anonymous = await api('/api/agents/link-agent-a/messages');
  assert.equal(anonymous.status, 401);
});

test('message mutations reject cross-agent, read-only, paused and invalid requests', async () => {
  const bound = createAccessLink({ label: 'negative message fixture', scope: 'agent:self', agentId: 'agt_link_a', expiresInHours: 1, createdBy: 'owner' });
  const read = createAccessLink({ label: 'non-private read fixture', scope: 'dashboard:read', expiresInHours: 1, createdBy: 'owner' });
  const payload = { message: 'Synthetic authorization regression message', idempotencyKey: 'negative-message-fixture', actorType: 'owner', actorId: 'spoofed-owner' };
  const headers = { 'x-mission-link': bound.token };
  assert.equal((await api('/api/agents/link-agent-b/messages', { method: 'POST', headers, body: JSON.stringify(payload) })).status, 403);
  for (const method of ['GET', 'POST']) {
    assert.equal((await api('/api/agents/link-agent-a/messages', { method, headers: { 'x-mission-link': read.token }, ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}) })).status, 403);
  }
  const trusted = await api('/api/agents/link-agent-a/messages', { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(trusted.status, 201);
  assert.equal(trusted.body.message.actor_type, 'agent');
  assert.equal(trusted.body.message.actor_id, 'agt_link_a');
  const crossReply = await owner('/api/agents/link-agent-b/messages', { method: 'POST', body: JSON.stringify({ ...payload, replyTo: trusted.body.message.id }) });
  assert.equal(crossReply.status, 409);
  for (const message of ['', 'x'.repeat(12001)]) {
    assert.equal((await owner('/api/agents/link-agent-a/messages', { method: 'POST', body: JSON.stringify({ ...payload, message }) })).status, 400);
  }
  for (const query of ['after=-1', 'after=NaN', 'limit=0', 'limit=101']) {
    assert.equal((await owner(`/api/agents/link-agent-a/messages?${query}`)).status, 400);
  }
  missionDb.run("UPDATE mission_agents SET status = 'paused' WHERE id = ?", ['agt_link_a']);
  try {
    assert.equal((await api('/api/agents/link-agent-a/messages', { headers })).status, 200);
    assert.equal((await api('/api/agents/link-agent-a/messages', { method: 'POST', headers, body: JSON.stringify(payload) })).status, 409);
  } finally { missionDb.run("UPDATE mission_agents SET status = 'active' WHERE id = ?", ['agt_link_a']); }
});

test('generic approval dispatch completes resource, upgrade and tool subjects without replay or fictitious payments', async () => {
  const ledgerBefore = Number(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_ledger')!.n);
  for (const fixture of [
    { type: 'resource', endpoint: '/api/resources', key: 'resource', input: { kind: 'storage', provider: 'synthetic-provider', monthlyCostCents: 10000 }, resultKey: 'resource' },
    { type: 'upgrade', endpoint: '/api/upgrades', key: 'upgrade', input: { capability: 'Synthetic zero-cost approval fixture', requestedCostCents: 0 }, resultKey: 'upgrade' },
    { type: 'tool', endpoint: '/api/tools/request', key: 'request', input: { toolKey: 'gemini_api' }, resultKey: 'toolRequest' },
  ]) {
    const requested = await owner(fixture.endpoint, { method: 'POST', body: JSON.stringify({ ...fixture.input, agentSlug: 'link-agent-a' }) });
    assert.equal(requested.status, 201, fixture.type);
    const id = requested.body[fixture.key].id;
    const approval = missionDb.get<Row>('SELECT id FROM mission_approvals WHERE subject_type = ? AND subject_id = ?', [fixture.type, id])!;
    const decided = await owner(`/api/approvals/${approval.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body[fixture.resultKey].status, 'approved');
    assert.equal((await owner(`/api/approvals/${approval.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) })).status, 409);
  }
  assert.equal(Number(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_ledger')!.n), ledgerBefore);
});

test('only an owner can bind a stored credential and the response claims no provider verification', async () => {
  const credential = await owner('/api/credentials', { method: 'POST', body: JSON.stringify({ provider: 'synthetic-binding-provider', label: 'Synthetic API fixture', secret: 'synthetic-credential-value-not-real' }) });
  assert.equal(credential.status, 201);
  const created = await owner('/api/resources', { method: 'POST', body: JSON.stringify({ agentSlug: 'link-agent-a', kind: 'api', provider: 'synthetic-binding-provider', monthlyCostCents: 0 }) });
  assert.equal(created.status, 201);
  const url = `/api/resources/${created.body.resource.id}/credential`;
  const payload = { credentialId: credential.body.credential.id, expectedCredentialId: null, reason: 'Synthetic owner-approved binding, not a real integration.' };
  const link = createAccessLink({ label: 'credential binding denial fixture', scope: 'agent:self', agentId: 'agt_link_a', expiresInHours: 1, createdBy: 'owner' });
  assert.equal((await api(url, { method: 'POST', headers: { 'x-mission-link': link.token }, body: JSON.stringify(payload) })).status, 401, 'a scoped agent link is not an owner session');
  const result = await owner(url, { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(result.status, 200);
  assert.equal(result.body.resource.credential_id, payload.credentialId);
  assert.equal(result.body.resource.status, 'approved');
  assert.equal(result.body.providerVerified, false);
  assert.equal(result.body.readiness.usable, false);
  assert.ok(!JSON.stringify(result.body).includes('synthetic-credential-value-not-real'));
});

test('owner call review and reconciliation are private, resource-scoped and never execute payments', async () => {
  const management = require('./self-management') as typeof import('./self-management');
  const operations = require('./resource-calls') as typeof import('./resource-calls');
  const credential = await owner('/api/credentials', { method: 'POST', body: JSON.stringify({ provider: 'synthetic-call-review', label: 'Synthetic review fixture', secret: 'synthetic-credential-value-not-real' }) });
  const resource = management.requestResource({ agentId: 'agt_link_a', provider: 'synthetic-call-review', kind: 'api', credentialId: credential.body.credential.id, limits: { requests: 3 } });
  const id = String(resource.id);
  management.provisionResource({ id, actualCostCents: 0, providerRef: 'synthetic-call-review-invoice', evidence: 'Synthetic fixture only; no real purchase.', actorId: 'owner' });
  management.recordResourceUsage({ id, usage: { requests: 0 }, actorType: 'owner', actorId: 'owner' });
  const input = { resourceId: id, agentId: 'agt_link_a', actorType: 'agent' as const, actorId: 'agt_link_a', operationFingerprint: 'a'.repeat(64), units: { requests: 1 } };
  const held = operations.reserveResourceCall({ ...input, idempotencyKey: 'synthetic-review-hold' });
  const uncertain = operations.reserveResourceCall({ ...input, idempotencyKey: 'synthetic-review-unknown' });
  operations.claimResourceCall(String(uncertain.id), input);
  operations.markResourceCallUncertain(String(uncertain.id), input);
  const before = Number(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_ledger')!.n);
  const base = `/api/resources/${id}/calls`;
  const proof = { outcome: 'succeeded', actualUsage: { requests: 1 }, providerRef: 'synthetic-call-receipt', evidence: 'Synthetic owner receipt, not external provider proof.' };
  for (const scope of ['agent:self', 'dashboard:read'] as const) {
    const link = createAccessLink({ label: 'call review denied fixture', scope, agentId: scope === 'agent:self' ? 'agt_link_a' : undefined, expiresInHours: 1, createdBy: 'owner' });
    const headers = { 'x-mission-link': link.token };
    assert.equal((await api(base, { headers })).status, 401);
    assert.equal((await api(`${base}/${held.id}/cancel`, { method: 'POST', headers, body: '{}' })).status, 401);
    assert.equal((await api(`${base}/${uncertain.id}/reconcile`, { method: 'POST', headers, body: JSON.stringify(proof) })).status, 401);
  }
  assert.equal((await api(base)).status, 401);
  const page = await owner(`${base}?limit=1`);
  assert.equal(page.body.calls.length, 1);
  assert.ok(page.body.nextCursor);
  assert.equal((await owner(`${base}?limit=1&before=${page.body.nextCursor}`)).body.calls.length, 1);
  assert.ok(!JSON.stringify(page.body).includes('binding_snapshot'));
  assert.equal((await owner(`${base}?limit=101`)).status, 400);
  assert.equal((await owner(`${base}/${uncertain.id}/cancel`, { method: 'POST', body: '{}' })).status, 409);
  assert.equal((await owner(`${base}/${held.id}/cancel`, { method: 'POST', body: '{}' })).body.call.status, 'cancelled');
  assert.equal((await owner(`${base}/${uncertain.id}/reconcile`, { method: 'POST', body: JSON.stringify({ ...proof, outcome: 'unknown' }) })).status, 400);
  assert.equal((await owner(`${base}/${uncertain.id}/reconcile`, { method: 'POST', body: JSON.stringify({ ...proof, actualUsage: {} }) })).status, 400);
  const other = management.requestResource({ agentId: 'agt_link_a', provider: 'synthetic-call-review', kind: 'api' });
  assert.equal((await owner(`/api/resources/${other.id}/calls/${uncertain.id}/reconcile`, { method: 'POST', body: JSON.stringify(proof) })).status, 404);
  const settled = await owner(`${base}/${uncertain.id}/reconcile`, { method: 'POST', body: JSON.stringify(proof) });
  assert.equal(settled.status, 200);
  assert.equal(settled.body.moneyMoved, false);
  assert.equal(settled.body.providerVerified, false);
  assert.equal((await owner(`${base}/${uncertain.id}/reconcile`, { method: 'POST', body: JSON.stringify(proof) })).status, 200);
  assert.equal(Number(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_ledger')!.n), before);
});

test('owner cost receipt API records private accounting once and never accepts agent authority', async () => {
  const management = require('./self-management') as typeof import('./self-management');
  const operations = require('./resource-calls') as typeof import('./resource-calls');
  const treasury = require('./treasury') as typeof import('./treasury');
  const policy = require('./policy') as typeof import('./policy');
  const previous = policy.currentPolicy();
  policy.updatePolicy({ maxDailySpendCents: 1000000, maxExpenseCents: 1000, requireApprovalAboveCents: 1000 }, 'owner');
  try {
    const credential = await owner('/api/credentials', { method: 'POST', body: JSON.stringify({ provider: 'synthetic-budget-http', label: 'Synthetic budget fixture', secret: 'synthetic-credential-value-not-real' }) });
    const resource = management.requestResource({ agentId: 'agt_link_a', provider: 'synthetic-budget-http', kind: 'api', credentialId: credential.body.credential.id, limits: { requests: 3 } });
    const id = String(resource.id);
    management.provisionResource({ id, actualCostCents: 0, providerRef: 'synthetic-budget-http-invoice', evidence: 'Synthetic fixture only; no real purchase.', actorId: 'owner' });
    management.recordResourceUsage({ id, usage: { requests: 0 }, actorType: 'owner', actorId: 'owner' });
    const wallet = treasury.ensureAgentWallet('agt_link_a', 'Synthetic budget HTTP wallet');
    treasury.setWalletBudget({ walletId: wallet.id, budgetCents: 100000, actorId: 'owner' });
    treasury.credit({ walletId: wallet.id, amountCents: 100, category: 'transfer', memo: 'Synthetic fixture funds' });
    const actor = { actorType: 'agent' as const, actorId: 'agt_link_a' };
    const call = operations.reserveResourceCall({ resourceId: id, agentId: actor.actorId, ...actor, operationFingerprint: 'c'.repeat(64), idempotencyKey: 'synthetic-http-budget-reservation', units: { requests: 1 }, budget: { walletId: wallet.id, maxCostCents: 40 } });
    operations.claimResourceCall(String(call.id), actor);
    operations.settleResourceCall(String(call.id), actor, { outcome: 'succeeded', actualUsage: { requests: 1 }, providerRef: 'synthetic-budget-http-usage', evidence: 'Synthetic usage; not financial evidence.' });
    const url = `/api/resources/${id}/calls/${call.id}/record-cost`;
    const receipt = { actualCostCents: 25, providerRef: 'synthetic-budget-http-charge', evidence: 'Synthetic financial receipt only, no provider payment.' };
    const link = createAccessLink({ label: 'cost mutation denied', scope: 'agent:self', agentId: 'agt_link_a', expiresInHours: 1, createdBy: 'owner' });
    assert.equal((await api(url, { method: 'POST', headers: { 'x-mission-link': link.token }, body: JSON.stringify({ ...receipt, actorType: 'owner', actorId: 'owner' }) })).status, 401);
    assert.equal((await owner(url, { method: 'POST', body: JSON.stringify({ ...receipt, actualCostCents: null }) })).status, 400);
    assert.equal((await owner(url.replace(id, 'wrong-resource'), { method: 'POST', body: JSON.stringify(receipt) })).status, 404);
    const before = treasury.getWallet(wallet.id)!.balanceCents;
    const result = await owner(url, { method: 'POST', body: JSON.stringify(receipt) });
    assert.equal(result.status, 200);
    assert.equal(result.body.externalPaymentExecuted, false);
    assert.equal(treasury.getWallet(wallet.id)!.balanceCents, before - 25);
    assert.equal((await owner(url, { method: 'POST', body: JSON.stringify(receipt) })).status, 200);
    assert.equal(treasury.getWallet(wallet.id)!.balanceCents, before - 25);
    assert.equal((await owner(url, { method: 'POST', body: JSON.stringify({ ...receipt, actualCostCents: 26 }) })).status, 409);
    const page = await owner(`/api/resources/${id}/calls`);
    assert.equal(page.body.calls[0].budget.actualCents, 25);
    assert.equal(page.body.calls[0].budget.status, 'recorded');
  } finally { policy.updatePolicy(previous, 'owner'); }
});

test('automatic chat configuration and job visibility require owner identity; config is not provider activation', async () => {
  const management = require('./self-management') as typeof import('./self-management');
  const treasury = require('./treasury') as typeof import('./treasury');
  const resource = management.requestResource({ agentId: 'agt_link_a', provider: 'google', kind: 'api' });
  const wallet = treasury.ensureAgentWallet('agt_link_a', 'Synthetic chat HTTP wallet');
  const config = { enabled: true, resourceId: resource.id, walletId: wallet.id, model: 'gemini-2.5-flash', maxInputBytes: 2000, maxOutputTokens: 128, maxCostCents: 40, costBasis: 'Synthetic configuration, no real model access or pricing claim.' };
  const base = '/api/agents/link-agent-a';
  for (const scope of ['agent:self', 'dashboard:read'] as const) {
    const link = createAccessLink({ label: 'chat configuration denied', scope, agentId: scope === 'agent:self' ? 'agt_link_a' : undefined, expiresInHours: 1, createdBy: 'owner' });
    const headers = { 'x-mission-link': link.token };
    assert.equal((await api(`${base}/chat-config`, { headers })).status, 401);
    assert.equal((await api(`${base}/chat-jobs`, { headers })).status, 401);
    assert.equal((await api(`${base}/chat-config`, { method: 'POST', headers, body: JSON.stringify({ ...config, actorType: 'owner' }) })).status, 401);
  }
  assert.equal((await owner(`${base}/chat-config`, { method: 'POST', body: JSON.stringify({ ...config, maxCostCents: 0 }) })).status, 400);
  assert.equal((await owner(`${base}/chat-config`, { method: 'POST', body: JSON.stringify({ ...config, resourceId: undefined }) })).status, 400);
  assert.equal((await owner('/api/agents/link-agent-b/chat-config', { method: 'POST', body: JSON.stringify(config) })).status, 403);
  const configured = await owner(`${base}/chat-config`, { method: 'POST', body: JSON.stringify(config) });
  assert.equal(configured.status, 200); assert.equal(configured.body.providerActivated, false);
  const posted = await owner(`${base}/messages`, { method: 'POST', body: JSON.stringify({ message: 'Synthetic new owner message, no actual provider request', idempotencyKey: 'synthetic-http-chat-message' }) });
  assert.equal(posted.status, 201); assert.equal(posted.body.commandExecuted, false);
  const jobs = await owner(`${base}/chat-jobs`);
  assert.equal(jobs.body.jobs.length, 1); assert.equal(jobs.body.jobs[0].status, 'queued');
  assert.ok(!JSON.stringify(jobs.body).includes('config_snapshot'));
  assert.equal((await owner(`${base}/chat-jobs?limit=101`)).status, 400);
  const settings = await owner(`${base}/chat-config`);
  assert.equal(settings.body.workerLivenessVerified, false);
  assert.equal(settings.body.agentId, 'agt_link_a');
  assert.equal((await owner(`${base}/messages`)).body.automaticRepliesConfigured, true);
});

test('resource periods require owner evidence and preserve prior usage without a purchase or replayed debit', async () => {
  const management = require('./self-management') as typeof import('./self-management');
  const expiry = new Date(Date.now() - 3600000).toISOString();
  const resource = management.requestResource({ agentId: 'agt_link_a', provider: 'synthetic-period-http', kind: 'api', expiresAt: expiry, limits: { requests: 10 } });
  const id = String(resource.id);
  management.provisionResource({ id, actualCostCents: 0, providerRef: 'synthetic-period-http-provision', evidence: 'Synthetic prior resource, not external activation.', actorId: 'owner' });
  management.recordResourceUsage({ id, usage: { requests: 2 }, actorType: 'owner', actorId: 'owner' });
  const body = { idempotencyKey: 'synthetic-period-http-replay', expectedExpiresAt: expiry, periodStart: new Date(Date.now() - 1000).toISOString(), periodEnd: new Date(Date.now() + 86400000).toISOString(), limits: { requests: 20 }, startingUsage: { requests: 1 }, actualCostCents: 0, currency: 'USD', providerRef: 'synthetic-period-http-renewal', evidence: 'Synthetic renewed period evidence, not a real provider receipt.' };
  const route = `/api/resources/${id}/periods`;
  for (const scope of ['agent:self', 'dashboard:read'] as const) {
    const link = createAccessLink({ label: 'period access denied', scope, agentId: scope === 'agent:self' ? 'agt_link_a' : undefined, expiresInHours: 1, createdBy: 'owner' });
    const headers = { 'x-mission-link': link.token };
    assert.equal((await api(route, { headers })).status, 401);
    assert.equal((await api(route, { method: 'POST', headers, body: JSON.stringify({ ...body, actorType: 'owner' }) })).status, 401);
  }
  assert.equal((await owner(route, { method: 'POST', body: JSON.stringify({ ...body, startingUsage: {} }) })).status, 400);
  const result = await owner(route, { method: 'POST', body: JSON.stringify(body) });
  assert.equal(result.status, 200); assert.equal(result.body.externalPaymentExecuted, false); assert.equal(result.body.providerVerified, false);
  assert.equal((await owner(route, { method: 'POST', body: JSON.stringify(body) })).body.duplicate, true);
  assert.equal((await owner(route, { method: 'POST', body: JSON.stringify({ ...body, evidence: 'Different synthetic evidence cannot replace this receipt.' }) })).status, 409);
  const history = await owner(route);
  assert.equal(history.body.periods[0].previous_usage, '{"requests":2}');
  assert.equal(history.body.periods[0].starting_usage, '{"requests":1}');
  assert.ok(!JSON.stringify(history.body).includes('idempotency_key'));
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
});


test('verified cash API is owner-scoped, zero-funded, and exposes audit pagination',async()=>{
  assert.equal((await api('/api/money')).status,401);
  const boot=await owner('/api/money/bootstrap',{method:'POST',body:'{}'});assert.equal(boot.status,200);
  const cash=await owner('/api/money');assert.equal(cash.status,200);assert.equal(cash.body.accounting,'provider_verified_cash_only');assert.equal(cash.body.legacyBalancesImported,false);
  assert.equal(cash.body.accounts.reduce((n:number,a:any)=>n+Number(a.available_cents),0),0);
  const ledger=await owner('/api/money/ledger?limit=10');assert.equal(ledger.status,200);assert.ok(Array.isArray(ledger.body.entries));
  const missingProvider=await owner('/api/money/receipt',{method:'POST',body:JSON.stringify({externalId:'txn_claim'})});
  assert.equal(missingProvider.status,409);assert.equal(missingProvider.body.error.code,'mission_live_provider_not_configured');
});

test('new verified-cash requests reject fabricated funding and preserve zero balances',async()=>{
  const agent=missionDb.get<Row>('SELECT id FROM mission_agents WHERE slug=?',[rootAgentSlug])!;
  const grant=await owner('/api/money/grants',{method:'POST',body:JSON.stringify({agentId:agent.id,spendLimitCents:100,delegationCents:0,expiresAt:new Date(Date.now()+86400000).toISOString()})});assert.equal(grant.status,200);
  const result=await owner('/api/money/request',{method:'POST',body:JSON.stringify({kind:'expense',agentId:agent.id,provider:'stripe-mission',destination:'vendor',category:'api',amountCents:10,maxCostCents:10,idempotencyKey:'unfunded-real-expense'})});
  assert.equal(result.status,409);assert.equal(result.body.error.code,'insufficient_real_funds');
});
test('agent cash read is scoped; ledger, operations and grants cannot leak fleet data',async()=>{
  const agent=missionDb.get<Row>('SELECT id FROM mission_agents WHERE slug=?',[rootAgentSlug])!;
  const link=createAccessLink({scope:'agent:self',agentId:String(agent.id),label:'Synthetic cash-read fixture'});
  const headers={'x-mission-link':link.token};
  const own=await api('/api/money',{headers});assert.equal(own.status,200);assert.equal(own.body.account.agent_id,agent.id);assert.equal(own.body.accounts,undefined);
  assert.equal((await api('/api/money?agentId=another-agent',{headers})).status,403);
  assert.equal((await api('/api/money/ledger?limit=10',{headers})).status,200);
  assert.equal((await api('/api/money/operations?limit=10',{headers})).status,200);
  const mutation=await api('/api/money/revoke-opportunity',{method:'POST',headers,body:JSON.stringify({id:'not-owned'})});assert.equal(mutation.status,409);assert.equal(mutation.body.error.code,'owner_required');
});
test('Agent Factory delegates a finite grant only through explicit parent permission; failure leaves no orphan',async()=>{
  await owner('/api/policy',{method:'PATCH',body:JSON.stringify({allowAgentCreation:true,autonomousEnabled:true,maxChildrenPerAgent:5,maxAgents:5000,maxDepth:4})});
  const root=await owner('/api/agents',{method:'POST',body:JSON.stringify({name:'Synthetic bounded-factory fixture',activity:'software_development',budgetCents:500})});
  assert.equal(root.status,201);assert.equal(root.body.cashAccount.available_cents,0);
  const parent=root.body.agent;
  const link=createAccessLink({scope:'agent:self',agentId:parent.id,label:'Synthetic factory authorization fixture'});
  const headers={'x-mission-link':link.token};
  const payload={name:'Synthetic delegated child fixture',activity:'software_development',budgetCents:30};
  const create=()=>api(`/api/agents/${parent.slug}/children`,{method:'POST',headers,body:JSON.stringify(payload)});
  assert.equal((await create()).status,409);
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_agents WHERE parent_id=?',[parent.id])!.n,0);
  const expiry=new Date(Date.now()+86400000).toISOString();
  assert.equal((await owner('/api/money/grants',{method:'POST',body:JSON.stringify({agentId:parent.id,spendLimitCents:0,delegationCents:40,canCreate:true,expiresAt:expiry})})).status,200);
  const child=await create();assert.equal(child.status,201);assert.equal(child.body.cashAccount.available_cents,0);
  const grant=missionDb.get<Row>('SELECT * FROM mission_money_grants WHERE agent_id=?',[child.body.agent.id])!;
  assert.equal(grant.parent_id,parent.id);assert.equal(grant.spend_limit_cents,30);assert.equal(grant.can_create,0);assert.equal(grant.expires_at,expiry);
  assert.equal((await create()).status,409);
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_agents WHERE parent_id=?',[parent.id])!.n,1);
  missionDb.run("UPDATE mission_agent_contracts SET expires_at='2000-01-01T00:00:00Z' WHERE agent_id=?",[child.body.agent.id]);
  assert.throws(()=>require('./money').grant(child.body.agent.id),/agent_contract_inactive/);
  await owner('/api/agents/'+parent.slug+'/status',{method:'POST',body:JSON.stringify({status:'paused',reason:'Synthetic owner brake'})});
  assert.equal((await api('/api/money',{headers})).status,200,'a paused agent may still read its own accounting');
  assert.equal((await api('/api/money/jobs?limit=1',{headers})).status,200);
  assert.equal((await create()).status,409);
});
test('paid legacy upgrade approval aliases and apply cannot masquerade as verified purchase',async()=>{
  const requested=await owner('/api/upgrades',{method:'POST',body:JSON.stringify({agentSlug:rootAgentSlug,capability:'Synthetic paid-upgrade refusal fixture',requestedCostCents:10})});
  assert.equal(requested.status,201);const id=requested.body.upgrade.id;
  const approval=missionDb.get<Row>('SELECT id FROM mission_approvals WHERE subject_id=?',[id])!;
  for(const url of [`/api/upgrades/${id}/decide`,`/api/approvals/${approval.id}/decide`,`/api/upgrades/${id}/apply`]){
    const result=await owner(url,{method:'POST',body:JSON.stringify({decision:'approved',note:'Owner note is not payment proof'})});
    assert.equal(result.status,409);assert.equal(result.body.error.code,'provider_verification_required');
  }
  assert.equal(missionDb.get<Row>('SELECT status FROM mission_upgrades WHERE id=?',[id])!.status,'requested');
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n,0);
});


test('Awin routes are owner-only and cannot accept caller-invented publishing or settlement proof', async () => {
  const previous = process.env.ZA141251SA_AWIN_ENABLED;
  process.env.ZA141251SA_AWIN_ENABLED = 'false';
  try {
    assert.equal((await api('/api/awin')).status,401);
    const agent=missionDb.get<Row>('SELECT id FROM mission_agents LIMIT 1')!;
    const link=createAccessLink({scope:'agent:self',agentId:String(agent.id),label:'Awin fixture denial'});
    assert.equal((await api('/api/awin',{headers:{'x-mission-link':link.token}})).status,401);
    const view=await owner('/api/awin');assert.equal(view.status,200);
    assert.deepEqual(view.body.blocked,['credentials','property_not_configured','settlement_not_configured']);
    const proof=await owner('/api/awin/reconcile-payout',{method:'POST',body:JSON.stringify({paymentId:'77',externalId:'invented',state:'settled',netCents:99999,propertyVerified:true})});
    assert.equal(proof.status,409);assert.equal(proof.body.error.code,'awin_blocked_settlement_not_configured');
    const before=missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n;
    const discovery=await owner('/api/awin/discover',{method:'POST',body:'{}'});
    assert.equal(discovery.status,409);
    assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n,before);
  } finally { if(previous===undefined)delete process.env.ZA141251SA_AWIN_ENABLED;else process.env.ZA141251SA_AWIN_ENABLED=previous; }
});

test('Freelancer is owner-only, disabled by default, and rejects invented payouts or automated bids', async () => {
  const previous=process.env.ZA141251SA_FREELANCER_ENABLED;process.env.ZA141251SA_FREELANCER_ENABLED='false';
  try {
    assert.equal((await api('/api/freelancer')).status,401);
    const agent=missionDb.get<Row>('SELECT id FROM mission_agents LIMIT 1')!;
    const link=createAccessLink({scope:'agent:self',agentId:String(agent.id),label:'Freelancer fixture denial'});
    assert.equal((await api('/api/freelancer',{headers:{'x-mission-link':link.token}})).status,401);
    const view=await owner('/api/freelancer');assert.equal(view.status,200);assert.equal(view.body.cashBridgeEnabled,false);assert.equal(view.body.lifecycle.length,9);
    const before=missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n;
    for(const command of ['bid','accept-award','withdraw']) {
      const response=await owner(`/api/freelancer/${command}`,{method:'POST',body:JSON.stringify({state:'settled',netCents:99999,currency:'USD'})});assert.equal(response.status,404);
    }
    for(const command of ['observe-payout','reconcile-payout','reconcile-reversal']) {
      const response=await owner(`/api/freelancer/${command}`,{method:'POST',body:JSON.stringify({payoutId:'fixture',externalId:'invented',state:'settled',netCents:99999,currency:'USD',missionOwnershipVerified:true})});
      assert.equal(response.status,409);assert.equal(response.body.error.code,'freelancer_payout_adapter_not_configured');
    }
    const discovery=await owner('/api/freelancer/discover',{method:'POST',body:JSON.stringify({query:'software'})});assert.equal(discovery.status,409);
    assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n,before);
  } finally {if(previous===undefined)delete process.env.ZA141251SA_FREELANCER_ENABLED;else process.env.ZA141251SA_FREELANCER_ENABLED=previous;}
});

test('Upwork is owner/bearer protected, has no live proof adapters, and exposes no financial actuation', async()=>{
  assert.equal((await api('/api/upwork')).status,401);
  const agent=missionDb.get<Row>('SELECT id FROM mission_agents LIMIT 1')!;
  const link=createAccessLink({scope:'agent:self',agentId:String(agent.id),label:'Upwork synthetic denial'});
  assert.equal((await api('/api/upwork',{headers:{'x-mission-link':link.token}})).status,401);
  assert.equal((await api('/api/upwork/inspect',{method:'POST',headers:{cookie:`mission_session=${ownerToken}`,origin:'https://untrusted.invalid'},body:'{}'})).status,401);
  const view=await owner('/api/upwork');assert.equal(view.status,200);assert.equal(view.body.cashBridgeEnabled,false);assert.equal(view.body.lifecycle.length,9);
  const before=missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n;
  for(const command of ['bid','accept-offer','release-milestone','withdraw','pay','buy-connects','import-proof']){
    assert.equal((await owner(`/api/upwork/${command}`,{method:'POST',body:'{}'})).status,404);
  }
  const fake={contractId:'synthetic',milestoneId:'synthetic',workId:'synthetic',payoutId:'synthetic',externalId:'invented',state:'settled',netCents:99999,currency:'USD',missionOwnershipVerified:true};
  for(const command of ['inspect','observe-payout','reconcile-payout','reconcile-reversal'])assert.equal((await owner(`/api/upwork/${command}`,{method:'POST',body:JSON.stringify(fake)})).status,409);
  assert.equal((await owner('/api/upwork/inspect/extra',{method:'POST',body:'{}'})).status,404);
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n,before);
});

test('Fiverr is owner/bearer protected, has no live proof adapters, and exposes no financial actuation', async()=>{
  assert.equal((await api('/api/fiverr')).status,401);
  const agent=missionDb.get<Row>('SELECT id FROM mission_agents LIMIT 1')!;
  const link=createAccessLink({scope:'agent:self',agentId:String(agent.id),label:'Fiverr synthetic denial'});
  assert.equal((await api('/api/fiverr',{headers:{'x-mission-link':link.token}})).status,401);
  assert.equal((await api('/api/fiverr/inspect',{method:'POST',headers:{cookie:`mission_session=${ownerToken}`,origin:'https://untrusted.invalid'},body:'{}'})).status,401);
  const view=await owner('/api/fiverr');assert.equal(view.status,200);assert.equal(view.body.cashBridgeEnabled,false);assert.equal(view.body.lifecycle.length,9);
  const before=missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n;
  for(const command of ['scrape','create-account','create-gig','send-message','deliver','withdraw','pay','early-payout','cash-advance','import-proof']){
    assert.equal((await owner(`/api/fiverr/${command}`,{method:'POST',body:'{}'})).status,404);
  }
  const fake={orderId:'synthetic',workId:'synthetic',payoutId:'synthetic',externalId:'invented',state:'settled',netCents:99999,currency:'USD',missionOwnershipVerified:true};
  for(const command of ['inspect','observe-payout','reconcile-payout','reconcile-reversal'])assert.equal((await owner(`/api/fiverr/${command}`,{method:'POST',body:JSON.stringify(fake)})).status,409);
  assert.equal((await owner('/api/fiverr/inspect/extra',{method:'POST',body:'{}'})).status,404);
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n,before);
});

test('Contra is owner/bearer protected, has no live proof adapters, and exposes no financial actuation', async()=>{
  assert.equal((await api('/api/contra')).status,401);
  const agent=missionDb.get<Row>('SELECT id FROM mission_agents LIMIT 1')!;
  const link=createAccessLink({scope:'agent:self',agentId:String(agent.id),label:'Contra synthetic denial'});
  assert.equal((await api('/api/contra',{headers:{'x-mission-link':link.token}})).status,401);
  assert.equal((await api('/api/contra/inspect',{method:'POST',headers:{cookie:`mission_session=${ownerToken}`,origin:'https://untrusted.invalid'},body:'{}'})).status,401);
  const view=await owner('/api/contra');assert.equal(view.status,200);assert.equal(view.body.cashBridgeEnabled,false);assert.equal(view.body.lifecycle.length,9);
  const before=missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n;
  for(const command of ['scrape','create-account','create-project','send-message','deliver','withdraw','pay','faster-payout','cash-advance','import-proof']){
    assert.equal((await owner(`/api/contra/${command}`,{method:'POST',body:'{}'})).status,404);
  }
  const fake={projectId:'synthetic',workId:'synthetic',payoutId:'synthetic',externalId:'invented',state:'settled',netCents:99999,currency:'USD',missionOwnershipVerified:true};
  for(const command of ['inspect','observe-payout','reconcile-payout','reconcile-reversal'])assert.equal((await owner(`/api/contra/${command}`,{method:'POST',body:JSON.stringify(fake)})).status,409);
  assert.equal((await owner('/api/contra/inspect/extra',{method:'POST',body:'{}'})).status,404);
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n,before);
});

test('Toptal is owner/bearer protected, has no live proof adapters, and exposes no financial actuation', async()=>{
  assert.equal((await api('/api/toptal')).status,401);
  const agent=missionDb.get<Row>('SELECT id FROM mission_agents LIMIT 1')!;
  const link=createAccessLink({scope:'agent:self',agentId:String(agent.id),label:'Toptal synthetic denial'});
  assert.equal((await api('/api/toptal',{headers:{'x-mission-link':link.token}})).status,401);
  assert.equal((await api('/api/toptal/inspect',{method:'POST',headers:{cookie:`mission_session=${ownerToken}`,origin:'https://untrusted.invalid'},body:'{}'})).status,401);
  const view=await owner('/api/toptal');assert.equal(view.status,200);assert.equal(view.body.cashBridgeEnabled,false);assert.equal(view.body.lifecycle.length,9);
  const before=missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n;
  for(const command of ['scrape','create-account','accept-engagement','submit-timesheet','take-screening','auto-track-time','send-message','deliver','withdraw','pay','faster-payout','cash-advance','import-proof']){
    assert.equal((await owner(`/api/toptal/${command}`,{method:'POST',body:'{}'})).status,404);
  }
  const fake={periodId:'synthetic',workId:'synthetic',payoutId:'synthetic',externalId:'invented',state:'settled',netCents:99999,currency:'USD',missionOwnershipVerified:true};
  for(const command of ['inspect','observe-payout','reconcile-payout','reconcile-reversal'])assert.equal((await owner(`/api/toptal/${command}`,{method:'POST',body:JSON.stringify(fake)})).status,409);
  assert.equal((await owner('/api/toptal/inspect/extra',{method:'POST',body:'{}'})).status,404);
  assert.equal(missionDb.get<Row>('SELECT COUNT(*) AS n FROM mission_cash_entries')!.n,before);
});
