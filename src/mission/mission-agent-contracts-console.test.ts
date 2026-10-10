import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * The owner console's scoped-contract path — prepare, approve, and the gate that refuses a grant
 * that is not exactly what its class allows.
 *
 * WHY THIS FILE EXISTS. Production reports `no_scoped_contract` as one of the two things the fleet is
 * waiting on, and the only way to clear it was `npm run fleet:readiness -- --contracts <class>` followed
 * by `--contracts-approve=<id>`. The owner has no shell on the host. So the remedy existed and the gate
 * stayed shut, which is the same failure shape as "documented, therefore considered done". These tests
 * hold the console path to what the CLI was already held to:
 *
 *   · preparing is idempotent, and preparing is not granting — nothing self-approves;
 *   · every write is owner-only: an anonymous caller and a read-only access link are refused, and no
 *     contract row exists afterwards;
 *   · a proposal whose permission set is empty, or whose budget/spend exceeds its own class, is refused
 *     with the reason recorded in the audit trail;
 *   · `Approve all` grants nothing unless the owner repeats back the exact permission surface, and a
 *     surface that changed in between fails closed;
 *   · the blocker is cleared by the real readiness function, not by a reimplementation of it;
 *   · the console renders the class list, the plain-language permission text and the refusal reasons,
 *     and renders `MISSING` rather than an empty block when the response has nothing in it.
 *
 * Synthetic fixtures only: a disposable database in the temp directory, one owner account, agents with no
 * platform access. No money moves, nothing is executed, and no production surface is touched.
 */
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-contracts-console-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'contracts-console-test-secret-not-live';
process.env.ZA141251SA_CREDENTIAL_KEY = '0123456789abcdef0123456789abcdef0123456789ab';
process.env.ZA141251SA_CURRENCY = 'USD';
process.env.ZA141251SA_BIND_HOST = '127.0.0.1';

import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
const { JSDOM } = require('jsdom');

const { applyMissionMigrations, missionDb } = require('./database') as typeof import('./database');
const { login, provisionOwner } = require('./auth') as typeof import('./auth');
const { createMissionServer } = require('./server') as typeof import('./server');
const contracts = require('./earning/agent-class-contracts') as typeof import('./earning/agent-class-contracts');
const readiness = require('./earning/fleet-readiness') as typeof import('./earning/fleet-readiness');

const OWNER_EMAIL = `contracts-owner-${randomUUID().slice(0, 8)}@test.local`;
const OWNER_PASSWORD = 'ContractsConsole!123';

const WRITE_STATEMENT = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i;

function rowCount(table: string): number {
  return Number(missionDb.get<{ c: number | bigint }>(`SELECT COUNT(*) AS c FROM ${table}`)?.c ?? 0);
}

/** Every contract/proposal/audit row the mission database sees while `work()` runs, plus what it returned. */
function measureWrites<T>(work: () => Promise<T> | T): Promise<{ response: T; writes: string[]; contracts: number; proposals: number; audit: number }> {
  const keys = ['get', 'all', 'run'] as const;
  const before = {
    contracts: rowCount('mission_agent_contracts'),
    proposals: rowCount('mission_agent_contract_proposals'),
    audit: rowCount('mission_audit'),
  };
  const writes: string[] = [];
  for (const key of keys) {
    const original = (missionDb[key] as (...args: unknown[]) => unknown).bind(missionDb);
    (missionDb as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
      if (WRITE_STATEMENT.test(String(args[0] ?? ''))) writes.push(String(args[0]).replace(/\s+/g, ' ').trim().slice(0, 48));
      return original(...args);
    };
  }
  let response!: T;
  return Promise.resolve(work()).then((value: T) => {
    response = value;
    for (const key of keys) delete (missionDb as unknown as Record<string, unknown>)[key];
    return {
      response,
      writes,
      contracts: rowCount('mission_agent_contracts') - before.contracts,
      proposals: rowCount('mission_agent_contract_proposals') - before.proposals,
      audit: rowCount('mission_audit') - before.audit,
    };
  });
}

/** A registry agent with no platform access and no contract — exactly the kind that must not be able to
 *  acquire permission by accident. */
function insertAgent(slug: string): string {
  const id = `agt_cc_${slug}`;
  missionDb.run(
    `INSERT INTO mission_agents (id, slug, name, category, role_key, depth, generation, status, mission_role, origin_platform, capabilities)
     VALUES (?, ?, ?, 'research', 'specialist', 0, 'registry', 'active', 'worker', 'akbaral-registry', '[]')`,
    [id, slug, `Contracts console agent ${slug}`],
  );
  return id;
}

function auditRows(action: string, subjectId?: string): Array<Record<string, unknown>> {
  return subjectId === undefined
    ? missionDb.all('SELECT * FROM mission_audit WHERE action=? ORDER BY seq', [action])
    : missionDb.all('SELECT * FROM mission_audit WHERE action=? AND subject_id=? ORDER BY seq', [action, subjectId]);
}

let ownerId = '';
let baseUrl = '';
let ownerToken = '';
let server: ReturnType<typeof createMissionServer>;

async function api(route: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
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

function owner(route: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  return api(route, { ...init, headers: { authorization: `Bearer ${ownerToken}`, ...(init.headers ?? {}) } });
}

before(async () => {
  applyMissionMigrations();
  const created = provisionOwner({ email: OWNER_EMAIL, password: OWNER_PASSWORD, displayName: 'Contracts Console Owner' });
  ownerId = String((created as { id?: string }).id ?? missionDb.get<{ id: string }>('SELECT id FROM mission_owner LIMIT 1')?.id);
  assert.ok(ownerId, 'the owner-only surface needs a real owner row to be attributed to');
  server = createMissionServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerToken = login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).token;
  assert.ok(ownerToken, 'and a session to exercise it with');
});

after(() => {
  server?.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Preparing: bounded, idempotent, and never a grant
// ─────────────────────────────────────────────────────────────────────────────

it('a second prepare for a class writes no new rows, at any fleet size, and no agent gets a duplicate', async () => {
  insertAgent('cc-idem');
  insertAgent('cc-idem-2');
  const first = await owner('/api/agent-contracts/prepare', { method: 'POST', body: JSON.stringify({ agentClass: 'bounty_research', limit: 2 }) });
  assert.equal(first.status, 200, JSON.stringify(first.body).slice(0, 300));
  assert.equal(Number(first.body.prepared), 2, `the first run prepares the bounded batch (saw ${JSON.stringify(first.body).slice(0, 200)})`);
  const proposalsAfterFirst = rowCount('mission_agent_contract_proposals');
  const contractsAfterFirst = rowCount('mission_agent_contracts');
  assert.equal(contractsAfterFirst, 0, 'preparing granted nothing on the first click either');

  // This is the "run twice → same row count" property, measured the way a fleet will meet it: with 16,000
  // agents registered, a per-agent duplicate check alone would let a second click walk on to the next
  // agents and grow an unreviewed queue. The class-level guard is what makes the button stable.
  const second = await measureWrites(() => owner('/api/agent-contracts/prepare', { method: 'POST', body: JSON.stringify({ agentClass: 'bounty_research', limit: 2 }) }));
  assert.equal(second.response.status, 409, 'a class with an unreviewed batch refuses to prepare another one');
  assert.equal(String(second.response.body.error?.code), 'proposals_already_pending_for_class');
  assert.match(String(second.response.body.error?.message), /2 proposal\(s\) for bounty_research/, 'and it says how many are waiting, so the owner is not guessing');
  assert.equal(rowCount('mission_agent_contract_proposals'), proposalsAfterFirst, 'run twice → the same number of proposal rows');
  assert.equal(second.proposals, 0, 'the write measure sees exactly that: nothing new on the second click');
  assert.equal(rowCount('mission_agent_contracts'), contractsAfterFirst, 'and still nothing granted');

  const duplicates = missionDb.get<{ c: number | bigint }>(
    `SELECT COUNT(*) AS c FROM (SELECT agent_id, agent_class FROM mission_agent_contract_proposals GROUP BY agent_id, agent_class HAVING COUNT(*) > 1)`,
  );
  assert.equal(Number(duplicates?.c ?? 0), 0, 'no agent ever holds two pending proposals for the same class, however often the button is pressed');
  const view = await owner('/api/agent-contracts');
  const research = (view.body.classes as Array<Record<string, any>>).find(row => row.agentClass === 'bounty_research');
  assert.ok(research, 'the class the owner prepared is listed in their own view');
  assert.equal(Number(research.pendingProposals), 2, 'the queue the owner sees is the queue that exists');
});

it('preparing alone leaves the no_scoped_contract blocker in place, as the real readiness function reads it', () => {
  const activation = readiness.ownerActivationPath();
  const entry = activation.all.find(row => row.code === 'no_scoped_contract');
  assert.ok(entry, 'the scoped-contract gate is listed in the owner activation path');
  assert.equal(rowCount('mission_agent_contracts'), 0, 'nothing has been approved in this file yet');
  assert.equal(entry!.cleared, false, 'so the gate stays open even with proposals waiting — "prepared" is not a word that clears a permission gate');
  assert.ok(activation.remaining.some(row => row.code === 'no_scoped_contract'), 'and it is still in the remaining list the owner is shown');
});

it('an owner-only class is refused at the console too, with no row written', async () => {
  insertAgent('cc-owneronly');
  const result = await measureWrites(() => owner('/api/agent-contracts/prepare', { method: 'POST', body: JSON.stringify({ agentClass: 'payout_release', limit: 5 }) }));
  assert.equal(result.response.status, 409, `a payout-release class must be refused outright (saw ${JSON.stringify(result.response.body).slice(0, 200)})`);
  assert.equal(result.proposals, 0, 'refused means nothing was proposed');
  assert.equal(result.contracts, 0, 'and nothing was granted');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Approval is owner-only, at the route and in the module
// ─────────────────────────────────────────────────────────────────────────────

it('an anonymous caller cannot prepare, approve or approve-all, and writes nothing', async () => {
  const proposalId = String(missionDb.get<{ id: string }>("SELECT id FROM mission_agent_contract_proposals WHERE status='pending' ORDER BY requested_at LIMIT 1")?.id ?? '');
  assert.ok(proposalId, 'non-vacuity: there is a pending proposal to attempt to approve');
  for (const [route, body] of [
    ['/api/agent-contracts/prepare', { agentClass: 'bounty_research', limit: 5 }],
    ['/api/agent-contracts/approve', { proposalId }],
    ['/api/agent-contracts/approve-all', { agentClass: 'bounty_research', confirmSurface: 'x'.repeat(16) }],
  ] as const) {
    const result = await measureWrites(() => api(route, { method: 'POST', body: JSON.stringify(body) }));
    assert.equal(result.response.status, 401, `${route} requires a mission session`);
    assert.equal(result.contracts, 0, `${route} wrote no contract row for an anonymous caller`);
    assert.equal(result.proposals, 0, `${route} wrote no proposal row for an anonymous caller`);
  }
});

it('a read-only access link can read the list and cannot approve anything', async () => {
  const created = await owner('/api/access-links', { method: 'POST', body: JSON.stringify({ label: 'contracts-read', scope: 'dashboard:read', expiresInHours: 1 }) });
  assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 200));
  const headers = { 'x-mission-link': created.body.token };
  const read = await api('/api/agent-contracts', { headers });
  assert.equal(read.status, 200, 'the link can see what is waiting, because seeing it is what a read-only console is for');
  assert.ok(Array.isArray(read.body.classes), 'and it sees the same class list the owner sees');
  const proposalId = String(missionDb.get<{ id: string }>("SELECT id FROM mission_agent_contract_proposals WHERE status='pending' ORDER BY requested_at LIMIT 1")?.id ?? '');
  for (const [route, body] of [
    ['/api/agent-contracts/prepare', { agentClass: 'bounty_research', limit: 5 }],
    ['/api/agent-contracts/approve', { proposalId }],
    ['/api/agent-contracts/approve-all', { agentClass: 'bounty_research', confirmSurface: 'x'.repeat(16) }],
  ] as const) {
    const result = await measureWrites(() => api(route, { method: 'POST', headers, body: JSON.stringify(body) }));
    assert.ok(result.response.status === 401 || result.response.status === 403, `${route} must be refused to a read-only link (saw ${result.response.status})`);
    assert.equal(result.contracts, 0, `${route} wrote no contract row from a read-only link`);
    assert.equal(result.proposals, 0, `${route} wrote no proposal row from a read-only link`);
  }
});

it('the anonymous refusal covers the read route as well, so no contract surface leaks', async () => {
  const anonymous = await api('/api/agent-contracts');
  assert.equal(anonymous.status, 401, 'the class list, its counts and the pending proposals are private');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The fail-closed scope gate: empty or over-broad is refused, with the reason recorded
// ─────────────────────────────────────────────────────────────────────────────

function prepareOne(agentSlug: string): { agentId: string; proposalId: string } {
  const agentId = insertAgent(agentSlug);
  const prepared = contracts.prepareClassContract({ kind: 'owner', id: ownerId }, { agentId, agentClass: 'bounty_research' });
  return { agentId, proposalId: String(prepared.id) };
}

it('a contract that would grant nothing is refused, and the refusal says why in the audit trail', () => {
  const { proposalId } = prepareOne('cc-empty');
  missionDb.run("UPDATE mission_agent_contract_proposals SET permissions_json=? WHERE id=?", ['[]', proposalId]);
  const before = rowCount('mission_agent_contracts');
  assert.throws(
    () => contracts.approveClassContractProposal({ kind: 'owner', id: ownerId }, proposalId, 'attempted from a test'),
    (error: unknown) => {
      const code = String((error as { code?: string }).code ?? '');
      assert.equal(code, 'contract_permissions_empty', `the refusal must name the empty grant, not dress it up as drift (saw ${code}: ${(error as Error).message})`);
      return true;
    },
  );
  assert.equal(rowCount('mission_agent_contracts'), before, 'a refusal grants nothing, so the contract table is untouched');
  const recorded = auditRows('agent_contract.approval_refused', proposalId);
  assert.equal(recorded.length, 1, 'a decision to refuse is a decision, and it is recorded');
  assert.match(String(recorded[0].detail ?? ''), /contract_permissions_empty/, 'and the recorded row carries the reason code');
  assert.equal(missionDb.get<{ status: string }>('SELECT status FROM mission_agent_contract_proposals WHERE id=?', [proposalId])?.status, 'pending', 'the refusal also leaves the proposal where it was — for the owner to reject or let expire, not silently consumed');
});

it('a proposal whose budget exceeds its own class ceiling is refused even though the policy cap allows it', () => {
  const { proposalId } = prepareOne('cc-budget');
  // `bounty_research` has a spend ceiling of zero. The pre-existing drift check compares against the
  // global policy maximum, so a budget under that maximum used to pass. The class ceiling is the
  // narrower, honest one, and this is the row that proves the narrower rule is actually applied.
  missionDb.run('UPDATE mission_agent_contract_proposals SET budget_cents=? WHERE id=?', [10, proposalId]);
  const before = rowCount('mission_agent_contracts');
  assert.throws(
    () => contracts.approveClassContractProposal({ kind: 'owner', id: ownerId }, proposalId),
    (error: unknown) => {
      assert.equal(String((error as { code?: string }).code), 'contract_budget_over_broad');
      return true;
    },
  );
  assert.equal(rowCount('mission_agent_contracts'), before, 'and the over-broad grant was not made');
  assert.equal(auditRows('agent_contract.approval_refused', proposalId).length, 1, 'with the reason on record');
});

it('the plain-language list, the permission vocabulary and the class definitions cannot drift apart', () => {
  const grantable = [...contracts.GRANTABLE_PERMISSIONS].sort();
  const explained = Object.keys(contracts.PERMISSION_PLAIN_LANGUAGE).sort();
  assert.deepEqual(explained, grantable, 'every permission that can be granted has a sentence the owner reads, and no sentence describes a permission that cannot be granted');
  for (const permission of grantable) {
    const sentence = (contracts.PERMISSION_PLAIN_LANGUAGE as Record<string, string>)[permission];
    assert.ok(sentence.length > 30, `${permission} is explained in a clause, not a label (${sentence})`);
    assert.doesNotMatch(sentence, /^(may|can|allowed|permitted)$/, `${permission} is not explained by repeating its own key`);
  }
  for (const forbidden of contracts.NEVER_GRANTED_PERMISSIONS) {
    assert.equal((contracts.GRANTABLE_PERMISSIONS as readonly string[]).includes(forbidden), false, `${forbidden} must stay outside the vocabulary a contract can ever hold`);
  }
  for (const definition of contracts.AGENT_CLASS_CONTRACTS) {
    for (const permission of definition.permissions) {
      assert.ok(grantable.includes(permission), `${definition.agentClass} declares ${permission}, which the mission does not enforce`);
      assert.equal(definition.denied.includes(permission), false, `${definition.agentClass} cannot both grant and deny ${permission}`);
    }
    if (definition.ownerOnly) assert.equal(definition.permissions.length, 0, `${definition.agentClass} is owner-only, so it must declare no permission at all — and the console refuses it for saying so`);
    if (definition.resourceLimits.maxSpendCents > 0) assert.equal(definition.requiresMoneyGrant, true, `a class allowed to spend ${definition.resourceLimits.maxSpendCents} cents must require a money grant, or its ceiling is decorative`);
    assert.equal(definition.resourceLimits.maxChildren, 0, `${definition.agentClass} must not create agents`);
    assert.equal(definition.resourceLimits.maxDepth, 1, `${definition.agentClass} must not grow the tree`);
  }
});

it('the class list marks a proposal that would be refused, before the owner clicks it', async () => {
  const { proposalId } = prepareOne('cc-visible');
  missionDb.run("UPDATE mission_agent_contract_proposals SET permissions_json=? WHERE id=?", ['[]', proposalId]);
  const view = await owner('/api/agent-contracts');
  assert.equal(view.status, 200);
  const research = (view.body.classes as Array<Record<string, unknown>>).find(row => row.agentClass === 'bounty_research');
  assert.ok(research, 'the class the proposal belongs to is listed');
  const listed = (research.pending as Array<Record<string, any>>).find(row => row.id === proposalId);
  assert.ok(listed, 'the tampered proposal is in the list the owner reads');
  assert.ok(listed.scopeFault, 'and it is shown with the reason approval would refuse it, so the click is informed');
  assert.equal(String(listed.scopeFault.code), 'contract_permissions_empty');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Approve all: an explicit surface confirmation, and nothing else
// ─────────────────────────────────────────────────────────────────────────────

it('approve-all refuses to grant anything until the owner repeats back the surface, and fails closed when the surface moved', async () => {
  const view = await owner('/api/agent-contracts');
  const research = (view.body.classes as Array<Record<string, any>>).find(row => row.agentClass === 'bounty_research');
  assert.ok(research, 'the class under test is listed');
  const digest = String(research.surface.surfaceDigest);
  const waiting = Number(research.pendingProposals);
  const refusedAhead = (research.pending as Array<Record<string, any>>).filter(row => row.scopeFault).length;
  assert.ok(waiting >= 2, `non-vacuity: proposals are queued to be approved in bulk (saw ${waiting})`);
  assert.match(digest, /^[0-9a-f]{16}$/, 'the surface the owner confirms is a digest of the exact rows, not of a label');

  const wrong = await measureWrites(() => owner('/api/agent-contracts/approve-all', { method: 'POST', body: JSON.stringify({ agentClass: 'bounty_research', confirmSurface: 'deadbeefdeadbeef' }) }));
  assert.equal(wrong.response.status, 409, 'a stale or forged surface is refused');
  assert.equal(String((wrong.response.body as { error?: { code?: string } }).error?.code), 'confirmation_surface_mismatch');
  assert.equal(wrong.contracts, 0, 'and nothing was granted on the way to that refusal');
  assert.equal(auditRows('agent_contract.bulk_approval_refused').length >= 1, true, 'the refusal is recorded, because "why did the button do nothing" needs an answer');

  const missing = await owner('/api/agent-contracts/approve-all', { method: 'POST', body: JSON.stringify({ agentClass: 'bounty_research' }) });
  assert.equal(missing.status, 409, 'no confirmation at all is also a refusal — the button cannot be pressed by an old page');

  const contractsBeforeBulk = rowCount('mission_agent_contracts');
  const bulk = await owner('/api/agent-contracts/approve-all', { method: 'POST', body: JSON.stringify({ agentClass: 'bounty_research', confirmSurface: digest }) });
  assert.equal(bulk.status, 200, JSON.stringify(bulk.body).slice(0, 400));
  assert.equal(Number(bulk.body.granted), waiting - refusedAhead, `every clean row is granted and only the rows the scope gate refuses are not (waiting ${waiting}, refused ${refusedAhead})`);
  assert.equal(Number(bulk.body.refusedCount), refusedAhead, 'and the refusals are counted');
  assert.ok(Array.isArray(bulk.body.refused) && bulk.body.refused.length === refusedAhead, 'each one listed with the reason it was refused');
  for (const entry of bulk.body.refused as Array<Record<string, unknown>>) {
    assert.match(String(entry.code), /^contract_/, `a refusal names a scope code (saw ${JSON.stringify(entry).slice(0, 160)})`);
    assert.ok(String(entry.detail).length > 20, 'and says why in a sentence the owner can act on');
  }
  assert.equal(rowCount('mission_agent_contracts') - contractsBeforeBulk, Number(bulk.body.granted), 'every grant is one row, and no more rows than grants');
});

it('every approval writes an audit entry, and an audit entry appears for nothing that was not approved', async () => {
  const agentId = insertAgent('cc-audited');
  // Its own class, so this test does not depend on another test's queue state — and a class the registry
  // maps no venue to today, which is exactly the kind the console must still let the owner prepare.
  const prepared = await owner('/api/agent-contracts/prepare', { method: 'POST', body: JSON.stringify({ agentClass: 'evidence_verification', limit: 1 }) });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body).slice(0, 300));
  const pending = missionDb.all<{ id: string }>("SELECT id FROM mission_agent_contract_proposals WHERE status='pending' AND agent_id=? AND agent_class='evidence_verification'", [agentId]);
  assert.equal(pending.length, 1, 'the fresh agent has exactly one prepared proposal');
  const contractsBefore = rowCount('mission_agent_contracts');
  const auditBefore = auditRows('agent_contract.activated').length;

  const approved = await owner('/api/agent-contracts/approve', { method: 'POST', body: JSON.stringify({ proposalId: pending[0].id }) });
  assert.equal(approved.status, 200, JSON.stringify(approved.body).slice(0, 300));
  assert.equal(rowCount('mission_agent_contracts') - contractsBefore, 1, 'one approval, one contract row');
  assert.equal(auditRows('agent_contract.activated').length - auditBefore, 1, 'and one audit row for it');
  const recorded = auditRows('agent_contract.activated', agentId);
  assert.equal(recorded.length, 1, 'the audit row is filed against the agent that received the grant');
  assert.match(String(recorded[0].detail ?? ''), /"agentClass":"evidence_verification"/, 'and it states which class was granted');

  // A refusal is recorded too, so "why is this still pending" has an answer in the trail.
  const refusedBefore = auditRows('agent_contract.approval_refused').length;
  const again = await owner('/api/agent-contracts/approve', { method: 'POST', body: JSON.stringify({ proposalId: pending[0].id }) });
  assert.equal(again.status, 409, 'approving the same proposal twice is refused, not doubled');
  assert.equal(String(again.body.error?.code), 'proposal_not_pending', `the refusal says which gate stopped it (saw ${JSON.stringify(again.body).slice(0, 200)})`);
  assert.equal(auditRows('agent_contract.approval_refused').length, refusedBefore, 'the not-pending refusal is the pre-existing gate, which stays silent — the scope refusals are the ones that must be recorded');
});

it('approving a class clears no_scoped_contract in the real readiness function, for the agents that hold a contract', () => {
  const holder = missionDb.get<{ agent_id: string }>("SELECT agent_id FROM mission_agent_contracts WHERE status='active' ORDER BY approved_at LIMIT 1");
  assert.ok(holder, 'non-vacuity: an active contract exists to be read');
  const verdict = readiness.readinessFor(String(holder.agent_id));
  assert.equal(verdict.hasScopedContract, true, 'the per-agent verdict reads the row that was written through the console');
  assert.equal(verdict.blockers.includes('no_scoped_contract'), false, 'and that agent no longer carries the blocker');

  const other = insertAgent('cc-uncleared');
  assert.equal(readiness.readinessFor(other).hasScopedContract, false);
  assert.equal(readiness.readinessFor(other).blockers.includes('no_scoped_contract'), true, 'a peer with no contract of its own still does — clearing the global gate is not clearing an agent');

  const activation = readiness.ownerActivationPath();
  assert.equal(activation.all.find(row => row.code === 'no_scoped_contract')!.cleared, true, 'the global gate the owner list shows is now cleared');
  assert.equal(activation.remaining.some(row => row.code === 'no_scoped_contract'), false, 'and it is out of the remaining list');
});

it('the console path is what the activation list now points the owner at, and the pointer is real', () => {
  const entry = readiness.ownerActivationPath().all.find(row => row.code === 'no_scoped_contract')!;
  assert.equal(entry.how, 'dashboard control', 'the remedy is named as the thing the owner can actually use');
  assert.match(entry.target, /#contracts-block/);
  const html = fs.readFileSync(path.resolve('mission-dashboard/index.html'), 'utf8');
  assert.ok(html.includes('id="contracts-block"'), 'and the block it names exists in the markup the server serves');
  assert.ok(html.includes('id="contracts-prepare-submit"'), 'with the prepare control');
  assert.match(entry.evidence, /src\/mission\/server\.ts:\d+/, 'and the entry cites the route that serves it');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The client: the owner reads what they are approving
// ─────────────────────────────────────────────────────────────────────────────

const dashboard = {
  html: fs.readFileSync(path.resolve('mission-dashboard/index.html'), 'utf8'),
  js: fs.readFileSync(path.resolve('mission-dashboard/app.js'), 'utf8'),
};

/** Every timer the page arms, cleared in the page's own realm — see the note in
 *  mission-dashboard-owner-overview.test.ts: a leaked jsdom interval keeps the test process alive until
 *  the CI batch timeout, and reports a pass as a hang. */
const openPages: Array<() => void> = [];
after(() => {
  for (const release of openPages.splice(0)) release();
});

function bootContractsConsole(options: { link?: string; classes?: unknown; failure?: number } = {}) {
  const dom = new JSDOM(dashboard.html, { url: 'https://mission.example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const window = dom.window as any;
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  const problems: string[] = [];
  window.addEventListener('error', (event: { message?: string }) => problems.push(String(event.message ?? 'unknown')));
  window.addEventListener('unhandledrejection', (event: { reason?: unknown }) => problems.push(`rejection: ${String((event.reason as Error)?.stack ?? event.reason)}`));

  const timers: number[] = [];
  const pageSetInterval = window.setInterval;
  const pageSetTimeout = window.setTimeout;
  window.setInterval = (handler: () => void, ms: number) => { const id = pageSetInterval(handler, ms); timers.push(id); return id; };
  window.setTimeout = (handler: () => void, ms: number) => { const id = pageSetTimeout(handler, ms); timers.push(id); return id; };
  const releasePage = () => {
    if (!openPages.includes(releasePage)) openPages.push(releasePage);
    for (const id of timers) { window.clearInterval(id); window.clearTimeout(id); }
    timers.length = 0;
  };

  const view = {
    generatedAt: '2026-10-10T18:00:00.000Z',
    registry: { agents: 4001, withActiveMoneyGrant: 0, executionBackendConfigured: false, specialists: 0 },
    blocker: { code: 'no_scoped_contract', cleared: false, activeContracts: 0, judgement: 'the gate below counts active contracts across the fleet: one approved contract clears it. Each individual agent still needs its own.' },
    limits: { maxProposalsPerBatch: 200, defaultBatch: 25, proposalTtlDays: 14 },
    classes: options.classes ?? [
      {
        agentClass: 'bounty_research', label: 'Bounty discovery, repository policy reads and live claim rechecks',
        purpose: 'Read-only GitHub discovery.', permissions: ['report.submit'],
        permissionsPlain: ['file a work report or finding so it can be verified and, if it earns, paid'],
        denied: ['payout.send'], never: 'never: create agents, write credentials, send a payout, move wallet money, freeze the treasury, open a pull request',
        resourceLimits: { maxChildren: 0, maxDepth: 1, maxSpendCents: 0, maxConcurrentRuns: 1 }, validityDays: 30,
        ownerOnly: false, requiresSandbox: false, requiresMoneyGrant: false,
        specialistsAssigned: 0, needsIt: 4001, withActiveMoneyGrant: 0, activeContracts: 0, pendingProposals: 1,
        pending: [{ id: 'ccp_1', agentId: 'agt_1', permissions: ['report.submit'], budgetCents: 0, requestedAt: '2026-10-10T17:00:00Z', expiresAt: '2026-10-24T17:00:00Z', expired: false, scopeFault: null }],
        surface: { contracts: 1, permissions: ['report.submit'], totalBudgetCents: 0, totalSpendCapCents: 0, permissionsPlain: ['file a work report'], never: 'never: create agents, write credentials, send a payout, move wallet money, freeze the treasury, open a pull request', surfaceDigest: 'abc123abc123abcd' },
        canPrepareNow: true, blockers: [],
      },
      {
        agentClass: 'bounty_execution', label: 'Sandboxed repository execution and test running for one assigned bounty',
        purpose: 'Runs the pinned sandbox.', permissions: ['tool.request', 'report.submit'],
        permissionsPlain: ['ask for a tool to be run on its behalf — every request is still decided by the tool gate', 'file a work report or finding so it can be verified and, if it earns, paid'],
        denied: ['payout.send'], never: 'never: create agents, write credentials, send a payout, move wallet money, freeze the treasury, open a pull request',
        resourceLimits: { maxChildren: 0, maxDepth: 1, maxSpendCents: 5000, maxConcurrentRuns: 1 }, validityDays: 14,
        ownerOnly: false, requiresSandbox: true, requiresMoneyGrant: true,
        specialistsAssigned: 0, needsIt: 4001, withActiveMoneyGrant: 0, activeContracts: 0, pendingProposals: 0,
        pending: [], surface: { contracts: 0, permissions: [], totalBudgetCents: 0, totalSpendCapCents: 0, permissionsPlain: [], never: 'never: create agents', surfaceDigest: '0000000000000000' },
        canPrepareNow: false, blockers: ['no_agent_holds_an_active_money_grant', 'no_execution_backend'],
      },
      {
        agentClass: 'payout_release', label: 'Release treasury payouts', purpose: 'DECLARED SO THAT REFUSAL IS CODE.',
        permissions: [], permissionsPlain: [], denied: ['payout.send'], never: 'never: create agents', resourceLimits: { maxChildren: 0, maxDepth: 1, maxSpendCents: 0, maxConcurrentRuns: 1 },
        validityDays: 1, ownerOnly: true, requiresSandbox: false, requiresMoneyGrant: false,
        specialistsAssigned: 0, needsIt: 4001, withActiveMoneyGrant: 0, activeContracts: 0, pendingProposals: 0,
        pending: [], surface: { contracts: 0, permissions: [], totalBudgetCents: 0, totalSpendCapCents: 0, permissionsPlain: [], never: 'never: create agents', surfaceDigest: '0000000000000000' },
        canPrepareNow: false, blockers: ['class_owner_only'],
      },
    ],
    note: 'Prepared is not granted.',
  };

  window.fetch = async (url: string, init: RequestInit = {}) => {
    const asText = String(url);
    const pathOnly = asText.replace(/^\/api/, '').split('?')[0];
    let parsed: unknown = null;
    if (typeof init.body === 'string') { try { parsed = JSON.parse(init.body); } catch { parsed = init.body; } }
    requests.push({ path: pathOnly, method: init.method ?? 'GET', body: parsed });
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
    if (options.failure && pathOnly === '/agent-contracts') return json({ error: 'request failed', code: 'bad_gateway' }, options.failure);
    if (pathOnly === '/session/me') return json({ owner: { id: 'own_1', email: 'owner@contracts.local', role: 'owner' }, expiresAt: null, vaultConfigured: true, identityLock: { enabled: true } });
    if (pathOnly === '/agent-contracts') return json(view);
    if (pathOnly === '/agent-contracts/approve-all') return json({ agentClass: 'bounty_research', considered: 1, granted: 1, refused: 0, note: 'granted' });
    if (pathOnly === '/agent-contracts/approve') return json({ contract: { id: 'ctr_1', agent_id: 'agt_1', status: 'active' } });
    if (pathOnly === '/agent-contracts/prepare') return json({ agentClass: 'bounty_research', considered: 1, eligible: 1, prepared: 1, preparedIds: ['ccp_new'], skipped: [] });
    return json({ rows: [], items: [], approvals: { pending: [] }, pending: [], all: [], expenses: [], upgrades: [], targets: [], note: 'fixture' });
  };

  const source = dashboard.js.replace("document.addEventListener('DOMContentLoaded', boot);", '');
  window.eval(`${source}\nwindow.contractsTest = { boot, wire, state, renderContracts, loadContracts };`);
  const api = window.contractsTest as {
    boot: () => Promise<void>;
    wire: () => void;
    state: { token: string; link: string; owner: unknown };
    renderContracts: (payload: unknown, failure: unknown) => void;
    loadContracts: () => Promise<void>;
  };
  const doc = window.document as Document;
  if (options.link) {
    api.state.link = options.link;
    sessionStorageSet(window, 'za_mission_link', options.link);
  } else {
    api.state.token = 'synthetic-owner-token';
    api.state.owner = { id: 'own_1', email: 'owner@contracts.local', role: 'owner' };
  }
  const settle = async () => {
    // The static controls (the prepare form) are bound by the page's own wiring, so a test that presses
    // one has to run the same wiring the browser would. It is one call, and it is the real one.
    api.wire();
    await api.loadContracts();
    for (let index = 0; index < 40; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    releasePage();
  };
  return {
    window, api, requests, problems, settle, releasePage, document: doc,
    text: (selector: string) => (doc.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    cells: (selector: string) => [...doc.querySelectorAll(`${selector} tbody tr`)].map(row => [...row.children].map(cell => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '')),
    buttons: (selector: string, attribute: string) => [...doc.querySelectorAll(`${selector} button[${attribute}]`)].map(node => ({ label: node.textContent ?? '', value: node.getAttribute(attribute) ?? '', surface: node.getAttribute('data-surface') ?? '' })),
    click: async (node: Element) => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); for (let index = 0; index < 25; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); },
    submit: async (form: Element) => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); for (let index = 0; index < 25; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); },
  };
}

function sessionStorageSet(window: any, key: string, value: string): void {
  window.sessionStorage.setItem(key, value);
}

void ownerId;

it('the markup ships the contracts block closed, inside Approvals, and it is not a navigation entry', () => {
  const block = /<details class="control-block" id="contracts-block">[\s\S]*?<\/details>/.exec(dashboard.html)?.[0] ?? '';
  assert.ok(block.length > 0, 'the block exists in the served markup');
  assert.doesNotMatch(block, /data-view=/, 'it is a block inside the Approvals panel, not a view with its own route');
  const approvals = dashboard.html.indexOf('data-panel="approvals"');
  const policy = dashboard.html.indexOf('<details class="sub" data-view="policy"');
  assert.ok(approvals < dashboard.html.indexOf('id="contracts-block"') && dashboard.html.indexOf('id="contracts-block"') < policy, 'it sits under Approvals, above the policy block');
  assert.doesNotMatch(block, /<details[^>]*\bopen\b/, 'and it ships closed: a collapsed block that opened itself would be a notification');
});

it('an owner reads the classes, the counts, and the permission each grant would give in plain language', async () => {
  const harness = bootContractsConsole();
  await harness.settle();
  const rows = harness.cells('#contracts-classes');
  assert.equal(rows.length, 3, 'one row per class the module declares, including the ones no agent may hold');
  const [research, execution, payout] = rows;
  assert.match(research.join('|'), /4,?001/, 'the count of agents that need a contract is the registry count, not a guess');
  assert.match(research.join('|'), /file a work report or finding/, 'the permission is stated in a sentence an owner can read');
  assert.match(execution.join('|'), /ask for a tool to be run on its behalf/, 'including what a tool grant actually means');
  assert.match(execution.join('|'), /not grantable today: no_agent_holds_an_active_money_grant, no_execution_backend/, 'and why a class cannot be granted on this host right now');
  assert.match(payout.join('|'), /Owner-only class/, 'an owner-only class is listed so its refusal is visible');
  assert.equal(harness.buttons('#contracts-classes', 'data-contracts-approve-all').length, 1, 'only the class with prepared proposals offers a bulk approval');
  assert.equal(harness.buttons('#contracts-classes', 'data-contracts-approve-all')[0].surface, 'abc123abc123abcd', 'and it carries the surface digest it is about to confirm');
  assert.match(harness.text('#contracts-blocker'), /blocking the fleet — no active scoped contract/, 'the gate the class list sits under is named');
  assert.deepEqual(harness.problems, [], 'and none of this threw');
});

it('Approve all shows the total permission surface first, and only then posts it back', async () => {
  const harness = bootContractsConsole();
  await harness.settle();
  const before = harness.requests.filter(entry => entry.method === 'POST').length;
  assert.equal(before, 0, 'rendering the block must not send a single write');
  const button = harness.document.querySelector('#contracts-classes button[data-contracts-approve-all]');
  assert.ok(button, 'the bulk control is there to press');
  await harness.click(button);
  assert.equal(harness.requests.filter(entry => entry.method === 'POST').length, 0, 'pressing it asks a question; it does not grant anything');
  const confirmation = harness.text('#contracts-confirm');
  assert.match(confirmation, /1 contract\(s\) would become active/);
  assert.match(confirmation, /permissions granted: report\.submit/);
  assert.match(confirmation, /never: create agents, write credentials, send a payout/);
  await harness.click(harness.document.querySelector('#contracts-confirm-yes')!);
  const posted = harness.requests.find(entry => entry.path === '/agent-contracts/approve-all');
  assert.ok(posted, 'confirming is what sends the request');
  assert.equal((posted.body as { confirmSurface?: string }).confirmSurface, 'abc123abc123abcd', 'and it sends the exact surface the owner was shown, so the server can refuse a list that moved');
  await harness.submit(harness.document.querySelector('#contracts-prepare-form')!);
  const prepared = harness.requests.find(entry => entry.path === '/agent-contracts/prepare');
  assert.ok(prepared, 'the prepare control on the same screen reaches the same module');
  assert.equal((prepared!.body as { agentClass?: string }).agentClass, 'bounty_research', 'and it sends the class the owner selected, not a default');
  assert.equal(Number((prepared!.body as { limit?: number }).limit), 25, 'with the bounded batch the markup declares');
});

it('a read-only link sees the queue and is offered no way to change it', async () => {
  const harness = bootContractsConsole({ link: 'zal_synthetic_read_link' });
  await harness.settle();
  assert.equal(harness.requests.filter(entry => entry.path === '/agent-contracts' && entry.method === 'GET').length, 1, 'a link can read the block');
  assert.equal(harness.buttons('#contracts-classes', 'data-contracts-approve-all').length, 0, 'no bulk approval is rendered for a link session');
  assert.equal(harness.buttons('#contracts-pending', 'data-contracts-approve').length, 0, 'and no per-contract approval either');
  assert.match(harness.text('#contracts-classes'), /read-only session — the owner must approve/);
  await harness.submit(harness.document.querySelector('#contracts-prepare-form')!);
  assert.equal(harness.requests.filter(entry => entry.method === 'POST').length, 0, 'the form refuses locally instead of sending a request the server will refuse');
  assert.match(harness.text('#banner'), /requires the mission owner session/);
});

it('a contracts response that carries nothing renders MISSING and says so, rather than an empty block', async () => {
  const harness = bootContractsConsole({ classes: undefined, failure: 502 });
  await harness.settle();
  assert.match(harness.text('#contracts-classes'), /MISSING — classes is not in the contracts response/);
  assert.match(harness.text('#contracts-blocker'), /request failed \(502\)/, 'the reason for the empty panel is on screen with the empty panel');
  assert.match(harness.text('#contracts-blocker'), /MISSING — the response carries no gate decision/, 'a gate the console could not read is not reported as cleared');
  assert.deepEqual(harness.problems, [], 'and a failed read throws nothing at the owner');
});
