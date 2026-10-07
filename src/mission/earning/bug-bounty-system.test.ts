import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-bounty-system-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'bounty-system-test-session-secret-0123456789';
process.env.ZA141251SA_CREDENTIAL_KEY = 'bounty-system-test-credential-key-0123456789';

import { applyMissionMigrations, missionDb } from '../database';
import { ensurePolicy, setKillSwitch } from '../policy';
import { login, provisionOwner } from '../auth';
import { createMissionServer } from '../server';
import {
  assertInScope,
  approveFindingForSubmission,
  createBountyFinding,
  createBountyProgram,
  cvss31BaseScore,
  findingFingerprint,
  listAgentRegistry,
  listBountyPrograms,
  listScopeAllowlist,
  runBountyAgent,
  runScopedExternalAction,
  upsertScopeAllowlist,
} from './bug-bounty-system';

let ownerId = '';
let ownerToken = '';
let programId = '';
let server: ReturnType<typeof createMissionServer>;
let baseUrl = '';

test.before(async () => {
  applyMissionMigrations();
  ensurePolicy('USD');
  const ownerEmail = `bounty-${randomUUID()}@test.invalid`;
  ownerId = provisionOwner({ email: ownerEmail, password: 'bounty-system-owner-password' }).id;
  ownerToken = login({ email: ownerEmail, password: 'bounty-system-owner-password' }).token;
  programId = String(createBountyProgram({ platform: 'TestPlatform', programHandle: `program-${randomUUID()}`, scopeUrl: 'https://program.invalid/scope', programTermsHash: 'a'.repeat(64), active: true }).id);
  upsertScopeAllowlist(programId, { target: 'example.com', targetType: 'domain', inScope: true, authRequired: false, rateLimitPerMin: 5 });
  upsertScopeAllowlist(programId, { target: 'admin.example.com', targetType: 'domain', inScope: false, authRequired: true });
  server = createMissionServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

async function httpRequest(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function ownerRequest(pathname: string, init: RequestInit = {}) {
  return httpRequest(pathname, { ...init, headers: { authorization: `Bearer ${ownerToken}`, ...(init.headers ?? {}) } });
}

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  missionDb.close();
});

test('registry has fourteen capability definitions and no seeded programs or targets', () => {
  assert.equal(listAgentRegistry().length, 14);
  assert.equal(listBountyPrograms().length, 1, 'only the owner-created fixture exists');
  assert.equal(listScopeAllowlist(programId).length, 2);
});

test('scope gate blocks unlisted and explicitly out-of-scope targets before external callback', async () => {
  assert.throws(() => assertInScope(programId, 'evil.example.net'), /target is not authorized/);
  assert.throws(() => assertInScope(programId, 'admin.example.com'), /target is not authorized/);
  let called = false;
  await assert.rejects(() => runScopedExternalAction({ programId, target: 'evil.example.net', action: async () => { called = true; return true; } }), /target is not authorized/);
  assert.equal(called, false);
  const blockedBeforeAgents = Number(missionDb.get<{ count: number }>("SELECT COUNT(*) AS count FROM scope_gate_events WHERE decision='blocked'")?.count);
  for (const agent of listAgentRegistry()) {
    assert.throws(() => runBountyAgent({ agentType: String(agent.type), programId, target: 'evil.example.net', input: {} }), /target is not authorized/);
  }
  assert.equal(blockedBeforeAgents, 3);
  assert.equal(Number(missionDb.get<{ count: number }>("SELECT COUNT(*) AS count FROM scope_gate_events WHERE decision='blocked'")?.count), 17);
  assert.equal(assertInScope(programId, 'example.com').targetType, 'domain');
});

test('every registered agent uses the scope gate, kill switch and fail-closed money gate', () => {
  const analyst = runBountyAgent({ agentType: 'code_analyst', programId, target: 'example.com', input: { source: 'export function entry(req) { return req.body; }', files: ['src/app.ts'] } });
  assert.equal(analyst.status, 'done');
  assert.throws(() => runBountyAgent({ agentType: 'code_analyst', programId, target: 'evil.example.net', input: { source: 'const x = 1;' } }), /target is not authorized/);
  assert.throws(() => runBountyAgent({ agentType: 'code_analyst', programId, target: 'example.com', input: { source: 'const x = 1;' }, availableTools: [] }), /required tools unavailable/);
  assert.throws(() => runBountyAgent({ agentType: 'code_analyst', programId, target: 'example.com', input: {} }), /required input missing/);
  assert.throws(() => runBountyAgent({ agentType: 'code_analyst', programId, target: 'example.com', input: { source: 'const x = 1;' }, requestedCostCents: 1 }), /cap|money gate/);
  setKillSwitch(true, ownerId);
  assert.throws(() => runBountyAgent({ agentType: 'security_auditor', programId, target: 'example.com', input: { source: 'const x = 1;' } }), /kill switch/);
  setKillSwitch(false, ownerId);
});

test('quality gate computes CVSS and blocks duplicates before approval', () => {
  const vector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
  assert.equal(cvss31BaseScore(vector), 9.8);
  const fingerprint = findingFingerprint(programId, 'example.com', 'xss', 'src/render.ts:10');
  const finding = createBountyFinding({ programId, target: 'example.com', finding: { title: 'Reflected output candidate', summary: 'Output is not encoded.', evidence: 'src/render.ts:10 innerHTML = value', reproduction: 'Local harness observed unsafe output.', impact: 'Attacker-controlled markup executes in the local harness.', remediation: 'Use context-aware output encoding and a vetted sanitizer.', vulnerabilityClass: 'xss', codeLocationPattern: 'src/render.ts:10', cvssVector: vector, cvssJustification: 'Network reachable, no privileges, no user interaction, unchanged scope.' } });
  assert.equal(finding.finding_fingerprint, fingerprint);
  assert.equal(finding.state, 'gated');
  assert.throws(() => createBountyFinding({ programId, target: 'example.com', finding: { title: 'Duplicate', summary: 'Same location.', evidence: 'same', reproduction: 'same', impact: 'same', remediation: 'Use context-aware output encoding.', vulnerabilityClass: 'xss', codeLocationPattern: 'src/render.ts:10', cvssVector: vector } }), /finding rejected: duplicate/);
  const approved = approveFindingForSubmission(ownerId, String(finding.id), { asset: 'example.com', vulnerabilityClass: 'xss', cvssVector: vector, reproduction: 'Local harness observed unsafe output.', title: 'Factual report', evidence: 'Only owner-approved content.', remediation: 'Use context-aware output encoding.' });
  assert.equal(approved.submitted, false);
  assert.equal(approved.approved, true);
});

test('new HTTP routes are owner-only and the legacy external route is hard-blocked', async () => {
  assert.equal((await httpRequest('/api/bounty/programs')).status, 401);
  assert.equal((await httpRequest('/api/bounty/knowledge/usage')).status, 401);
  const knowledge = await ownerRequest('/api/bounty/knowledge');
  assert.equal(knowledge.status, 200);
  assert.ok(knowledge.body.knowledge.length >= 44);
  const pendingLessons = await ownerRequest('/api/bounty/lessons/pending');
  assert.equal(pendingLessons.status, 200);
  const programs = await ownerRequest('/api/bounty/programs');
  assert.equal(programs.status, 200);
  assert.equal(programs.body.programs.length, 1);
  const agents = await ownerRequest('/api/bounty/agents');
  assert.equal(agents.status, 200);
  assert.equal(agents.body.count, 14);
  const run = await ownerRequest('/api/bounty/agents/code_analyst/run', { method: 'POST', body: JSON.stringify({ programId, target: 'example.com', input: { source: 'export function safe() {}' } }) });
  assert.equal(run.status, 200);
  assert.equal(run.body.result.status, 'done');
  const legacy = await ownerRequest('/api/bounty/discover', { method: 'POST', body: '{}' });
  assert.equal(legacy.status, 409);
  assert.equal(legacy.body.error.code, 'scope_control_plane_required');
});
