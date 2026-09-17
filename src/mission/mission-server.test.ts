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
import { ensurePayoutSlots, recordRevenue, listWallets } from './treasury';
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
  assert.equal(received.status, 201);
  const after = listTargets().find((target) => target.id === created.body.target.id)!;
  assert.equal(after.actualCents, 25_000_000, 'verified receipts count toward the target');
  assert.equal(after.progressPct, 25, 'progress is a real percentage, not a claim');
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

  await owner('/api/payout-slots/1/verify', { method: 'POST', body: JSON.stringify({}) });
  const missionWallet = listWallets('mission')[0];
  assert.ok(missionWallet, 'a mission treasury wallet exists');
  const request = await owner('/api/payouts', { method: 'POST', body: JSON.stringify({ slot: 1, amountCents: 2_000, idempotencyKey: 'srv-pay-2', memo: 'provider fee coverage' }) });
  assert.equal(request.status, 201);
  assert.equal(request.body.payout.status, 'pending_approval');
  const approve = await owner(`/api/payouts/${request.body.payout.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.payout.status, 'approved');
  const settleNoRef = await owner(`/api/payouts/${request.body.payout.id}/settle`, { method: 'POST', body: JSON.stringify({ status: 'settled' }) });
  assert.equal(settleNoRef.status, 400, 'settlement needs a provider reference');
  const settle = await owner(`/api/payouts/${request.body.payout.id}/settle`, { method: 'POST', body: JSON.stringify({ status: 'settled', settlementRef: 'po_provider_ref_1' }) });
  assert.equal(settle.status, 200);
  assert.equal(settle.body.payout.status, 'settled');
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

test('owner funding is real, idempotent and never counted as revenue', async () => {
  const key = `fund-${Date.now()}`;
  const first = await owner(`/api/wallets/${rootWalletId}/fund`, {
    method: 'POST',
    body: JSON.stringify({ amountCents: 4000, reference: 'bank transfer 12345', idempotencyKey: key }),
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.wallet.balanceCents, 4000);
  assert.equal(first.body.category, 'owner_capital');

  const retry = await owner(`/api/wallets/${rootWalletId}/fund`, {
    method: 'POST',
    body: JSON.stringify({ amountCents: 4000, reference: 'bank transfer 12345', idempotencyKey: key }),
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicated, true);
  assert.equal(retry.body.wallet.balanceCents, 4000, 'a retried request cannot double-credit the wallet');

  const revenue = missionDb.get<Row>(`SELECT COUNT(*) AS count FROM mission_revenue WHERE wallet_id = ?`, [rootWalletId]);
  assert.equal(Number(revenue?.count ?? 0), 0, 'owner capital is not revenue');
  const ledger = missionDb.get<Row>(`SELECT COUNT(*) AS count FROM mission_ledger WHERE idempotency_key = ?`, [key]);
  assert.equal(Number(ledger?.count ?? 0), 1, 'exactly one ledger row for the retried deposit');
});

test('funding requires a reference and a positive amount', async () => {
  const noRef = await owner(`/api/wallets/${rootWalletId}/fund`, { method: 'POST', body: JSON.stringify({ amountCents: 100, reference: '', idempotencyKey: 'k-1' }) });
  assert.equal(noRef.status, 400);
  const noKey = await owner(`/api/wallets/${rootWalletId}/fund`, { method: 'POST', body: JSON.stringify({ amountCents: 100, reference: 'bank transfer 9', idempotencyKey: '' }) });
  assert.equal(noKey.status, 400);
  const zero = await owner(`/api/wallets/${rootWalletId}/fund`, { method: 'POST', body: JSON.stringify({ amountCents: 0, reference: 'bank transfer 9', idempotencyKey: 'k-2' }) });
  assert.equal(zero.status, 400);
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
  assert.match(String(refused.body.error.message), /wallet_frozen/);

  await owner(`/api/wallets/${rootWalletId}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
  const bad = await owner(`/api/wallets/${rootWalletId}`, { method: 'PATCH', body: JSON.stringify({ budgetCents: -5 }) });
  assert.equal(bad.status, 400);
});

test('an expense uses the agent wallet, auto-executes under the threshold and queues above it', async () => {
  const policy = (await owner('/api/policy')).body.policy;
  const under = await owner('/api/expenses', {
    method: 'POST',
    body: JSON.stringify({ agentSlug: rootAgentSlug, category: 'api', provider: 'provider-a', description: 'under threshold', amountCents: Math.max(1, Math.floor(policy.requireApprovalAboveCents / 2)) }),
  });
  assert.equal(under.status, 201, `under-threshold expense: ${JSON.stringify(under.body)}`);
  assert.equal(under.body.expense.status, 'paid', 'below the threshold the spend executes immediately');

  // The budget is authority, the balance is money: raise the ceiling before
  // committing more than what is left of the previous budget.
  const raised = await owner(`/api/wallets/${rootWalletId}`, { method: 'PATCH', body: JSON.stringify({ budgetCents: policy.requireApprovalAboveCents * 2 }) });
  assert.equal(raised.status, 200);
  const over = await owner('/api/expenses', {
    method: 'POST',
    body: JSON.stringify({ agentSlug: rootAgentSlug, category: 'api', provider: 'provider-a', description: 'over threshold', amountCents: policy.requireApprovalAboveCents + 1 }),
  });
  assert.equal(over.status, 201, `over-threshold expense: ${JSON.stringify(over.body)}`);
  assert.equal(over.body.expense.status, 'requested');
  assert.ok(over.body.approvalId, 'an approval was queued');

  const rejected = await owner(`/api/expenses/${over.body.expense.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'rejected', note: 'not this month' }) });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.expense.status, 'rejected');
  const again = await owner(`/api/expenses/${over.body.expense.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: 'approved' }) });
  assert.equal(again.status, 409, 'a decided expense cannot be re-decided');
});

test('an agent wallet is resolved automatically and a missing wallet states the real requirement', async () => {
  const orphan = await owner('/api/agents', {
    method: 'POST',
    body: JSON.stringify({ name: 'No Wallet Agent', specialization: 'scratch', activity: 'software_development', budgetCents: 0, missionRole: 'worker' }),
  });
  const slug = String(orphan.body.agent.slug);
  const walletId = String(orphan.body.wallet.id);
  missionDb.run('DELETE FROM mission_wallets WHERE id = ?', [walletId]);
  const expense = await owner('/api/expenses', {
    method: 'POST',
    body: JSON.stringify({ agentSlug: slug, category: 'api', provider: 'p', description: 'no wallet', amountCents: 10 }),
  });
  assert.equal(expense.status, 409);
  assert.equal(expense.body.error.code, 'wallet_required');
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

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
});
