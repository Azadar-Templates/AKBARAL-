import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-bounty-system-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'bounty-system-test-session-secret-0123456789';
process.env.ZA141251SA_CREDENTIAL_KEY = 'bounty-system-test-credential-key-0123456789';

import { applyMissionMigrations, missionDb, type Row } from '../database';
import { ensurePolicy, setKillSwitch } from '../policy';
import { login, provisionOwner } from '../auth';
import { createMissionServer } from '../server';
import {
  approveFindingForSubmission,
  assertInScope,
  createBountyFinding,
  createBountyProgram,
  cvss31BaseScore,
  findingFingerprint,
  getBountyProgram,
  listAgentRegistry,
  listBountyPrograms,
  listScopeAllowlist,
  runBountyAgent,
  runScopedExternalAction,
  updateBountyProgram,
  upsertScopeAllowlist
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
  programId = String(createBountyProgram({ platform: 'TestPlatform', programHandle: `program-${randomUUID()}`, scopeUrl: 'https://program.invalid/scope', programTermsHash: 'a'.repeat(64) }).id);
  upsertScopeAllowlist(programId, { target: 'example.com', targetType: 'domain', inScope: true, authRequired: false, rateLimitPerMin: 5 });
  upsertScopeAllowlist(programId, { target: 'admin.example.com', targetType: 'domain', inScope: false, authRequired: true });
  updateBountyProgram(programId, { active: true });
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
// ── The owner-facing bounty path: register → terms → scope → activate ──────────────────────────
// These four steps are the whole of what the Bounty section can do today, so each link of the chain
// is asserted where it is enforced: the row, the HTTP route, and the gate the worker has to pass.

test('registering a program writes the row and the same program is listed back through the route', async () => {
  const handle = `listed-${randomUUID()}`;
  const created = await ownerRequest('/api/bounty/programs', {
    method: 'POST',
    body: JSON.stringify({ platform: 'TestPlatform', programHandle: handle, scopeUrl: 'https://program.invalid/scope', programTermsHash: 'e'.repeat(64) }),
  });
  assert.equal(created.status, 201, 'the owner can register a program');
  const programId = String(created.body.program.id);
  assert.equal(created.body.program.programHandle, handle);
  assert.equal(created.body.program.active, false, 'a registered program starts inactive');
  assert.equal(created.body.program.programTermsHash, 'e'.repeat(64), 'the terms digest is stored on the program row');

  const persisted = missionDb.get<Row>('SELECT platform, program_handle, scope_url, program_terms_hash, active FROM bounty_programs WHERE id = ?', [programId]);
  assert.ok(persisted, 'the row exists in the mission database');
  assert.equal(String(persisted!.program_handle), handle);
  assert.equal(Number(persisted!.active), 0);

  const listed = await ownerRequest('/api/bounty/programs');
  assert.equal(listed.status, 200);
  const found = (listed.body.programs as Array<Record<string, unknown>>).find((row) => row.id === programId);
  assert.ok(found, 'the program is listed back to the owner');
  assert.equal(String(found!.scopeUrl), 'https://program.invalid/scope');
  const audit = missionDb.get<Row>(`SELECT detail FROM mission_audit WHERE action = 'bounty.program_created' AND subject_id = ?`, [programId]);
  assert.ok(audit, 'registration is recorded in the audit trail');
  assert.ok(!/token|password|secret/i.test(String(audit!.detail)), 'the audit detail carries no credential material');
});

test('a program with zero in-scope targets cannot be activated, by either write path', () => {
  const lonely = createBountyProgram({ platform: 'TestPlatform', programHandle: `lonely-${randomUUID()}`, scopeUrl: 'https://program.invalid/scope', programTermsHash: 'f'.repeat(64) });
  const lonelyId = String(lonely.id);
  assert.equal(getBountyProgram(lonelyId)!.active, false, 'it starts inactive');

  assert.throws(
    () => createBountyProgram({ platform: 'TestPlatform', programHandle: `armed-${randomUUID()}`, scopeUrl: 'https://program.invalid/scope', programTermsHash: 'f'.repeat(64), active: true }),
    (error: unknown) => (error as { code?: string; statusCode?: number }).code === 'scope_required'
      && (error as { statusCode?: number }).statusCode === 409,
    'an active-on-create registration is refused rather than silently downgraded',
  );
  assert.throws(
    () => updateBountyProgram(lonelyId, { active: true }),
    (error: unknown) => (error as { code?: string }).code === 'scope_required',
    'activation with no allowlist row is refused',
  );

  // An out-of-scope row is not a target: the gate the worker obeys would still block everything, so
  // the row must not be enough to arm the program.
  upsertScopeAllowlist(lonelyId, { target: `denied-${randomUUID()}.example`, targetType: 'domain', inScope: false });
  assert.throws(
    () => updateBountyProgram(lonelyId, { active: true }),
    (error: unknown) => (error as { code?: string }).code === 'scope_required',
    'a program whose only row is explicitly out of scope stays unactivatable',
  );
  assert.equal(getBountyProgram(lonelyId)!.active, false, 'the refusal left the program inactive');
});

test('activation after one in-scope target succeeds and puts the program in front of the worker', async () => {
  const program = createBountyProgram({ platform: 'TestPlatform', programHandle: `armed-${randomUUID()}`, scopeUrl: 'https://program.invalid/scope', programTermsHash: 'a'.repeat(64) });
  const id = String(program.id);
  const target = `armed-${randomUUID()}.example`;
  upsertScopeAllowlist(id, { target, targetType: 'domain', inScope: true });

  const refused = await ownerRequest(`/api/bounty/programs/${encodeURIComponent(id)}/scope`);
  assert.equal(refused.status, 200, 'the scope list is readable before activation');
  assert.equal((refused.body.scope as unknown[]).length, 1);

  const armed = await ownerRequest(`/api/bounty/programs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
  assert.equal(armed.status, 200, 'one in-scope target is enough to arm the program');

  const listed = listBountyPrograms().find((row) => String(row.id) === id)!;
  assert.equal(listed.active, true, 'with one in-scope target the program is active');
  // The scheduler refuses to run at all while no program is active; this is its exact predicate.
  assert.ok(missionDb.get<Row>('SELECT id FROM bounty_programs WHERE active=1'), 'the worker now has an active program to act on');
  assert.equal(assertInScope(id, target).target, target, 'the gate lets the in-scope target through');
  const audit = missionDb.get<Row>(`SELECT detail FROM mission_audit WHERE action = 'bounty.program_activation_changed' AND subject_id = ? ORDER BY seq DESC`, [id]);
  assert.ok(audit, 'the activation is in the audit trail');
  assert.match(String(audit!.detail), /"active":true/);
});

test('a refused activation is recorded, and the refusal carries no credential material', async () => {
  const program = createBountyProgram({ platform: 'TestPlatform', programHandle: `refused-${randomUUID()}`, scopeUrl: 'https://program.invalid/scope', programTermsHash: 'b'.repeat(64) });
  const id = String(program.id);
  const attempted = await ownerRequest(`/api/bounty/programs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
  assert.equal(attempted.status, 409);
  assert.equal(attempted.body.error.code, 'scope_required');
  assert.match(attempted.body.error.message, /in-scope target/i, 'the message names the fix the owner can perform');
  const audit = missionDb.get<Row>(`SELECT detail FROM mission_audit WHERE action = 'bounty.program_activation_refused' AND subject_id = ?`, [id]);
  assert.ok(audit, 'a refusal to arm the worker is itself auditable');
  const serialized = JSON.stringify([attempted.body, audit!.detail]);
  assert.ok(!/Bearer|password|private_key|ciphertext|ghp_/i.test(serialized), 'neither the response nor the audit row echoes a credential');
});

test('a target outside the program scope is refused by the gate that the worker runs through', async () => {
  const program = getBountyProgram(programId)!;
  assert.equal(program.active, true, 'the suite program is active with its two allowlist rows');
  assert.equal(assertInScope(programId, 'example.com').target, 'example.com');
  // The scope error carries one code (`target_out_of_scope`) and the specific refusal in `reason`, so
  // the reason is what has to be right — and the status is a 403, never a warning.
  assert.throws(() => assertInScope(programId, 'anything-else.example'), (error: unknown) => (error as { reason?: string; statusCode?: number }).reason === 'target_not_allowlisted' && (error as { statusCode?: number }).statusCode === 403);
  assert.throws(() => assertInScope(programId, 'admin.example.com'), (error: unknown) => (error as { reason?: string; statusCode?: number }).reason === 'explicitly_out_of_scope' && (error as { statusCode?: number }).statusCode === 403);
  const events = missionDb.all<Row>(`SELECT decision, reason FROM scope_gate_events WHERE program_id = ? ORDER BY id DESC LIMIT 3`, [programId]);
  assert.ok(events.length >= 3, 'the gate records every decision, allowed or blocked');
  const terms = await ownerRequest('/api/bounty/programs/fetch-terms', { method: 'POST', body: JSON.stringify({ scopeUrl: 'https://user:***@program.invalid/scope' }) });
  assert.equal(terms.status, 400, 'a scope URL that embeds a credential is refused outright');
  assert.ok(!/hunter2/.test(JSON.stringify(terms.body)), 'the refused credential is not echoed back');
});
