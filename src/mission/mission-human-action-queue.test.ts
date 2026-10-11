import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * The owner's side of the human-action queue: `mission_human_action_tasks`, the table `owner_action_pending`
 * is counted from.
 *
 * WHY THIS FILE EXISTS. Production reported exactly one outstanding blocker — "clear the 2 open task(s) in
 * the Approvals queue" — and the console had no queue and no button. The table had two writers
 * (earning/agent-class-contracts.ts:296 and earning/fleet-readiness.ts:589) and its only resolver
 * (`human-action-gate.ts:98`) was never called by any route, so the instruction pointed at a panel that
 * could not carry it out. That is a circle: the fleet is blocked by a task, the task is decided by an owner,
 * and the owner had nowhere to decide it. These tests hold the new path to what the rest of the mission is
 * held to:
 *
 *   · every open entry is listed with the subject it actually refers to (class + how much is still pending,
 *     or the gate code a roll-up describes), never with a bare "action required";
 *   · approving an entry that points at a scoped-contract batch grants it through the contract module, so the
 *     surface digest is still required and an empty or over-broad proposal is still refused;
 *   · an entry whose subject has gone is reported stale and stays open until an owner closes it — no
 *     auto-close, no sweep, no expiry;
 *   · rejecting needs a short recorded reason and settles nothing else: the proposals, contracts and money it
 *     may point at are untouched, and the pending count before and after is recorded as proof;
 *   · no agent identity decides anything here, and the owner-only checks are refused with zero rows written;
 *   · closing never deletes: the task row and its audit rows both survive;
 *   · `owner_action_pending` is cleared by the real readiness function, not by a reimplementation of it.
 *
 * Synthetic fixtures only: a disposable database in the temp directory, one owner account, agents with no
 * platform access. Nothing is executed, no money moves, and no production surface is touched.
 */
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-human-action-queue-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'human-action-queue-test-secret-not-live';
process.env.ZA141251SA_CREDENTIAL_KEY = '0123456789abcdef0123456789abcdef0123456789ab';
process.env.ZA141251SA_CURRENCY = 'USD';
process.env.ZA141251SA_BIND_HOST = '127.0.0.1';

import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
const { JSDOM } = require('jsdom');

const { applyMissionMigrations, missionDb, verifyMissionAudit } = require('./database') as typeof import('./database');
const { login, provisionOwner } = require('./auth') as typeof import('./auth');
const { createMissionServer } = require('./server') as typeof import('./server');
const queue = require('./human-action-queue') as typeof import('./human-action-queue');
const contracts = require('./earning/agent-class-contracts') as typeof import('./earning/agent-class-contracts');
const readiness = require('./earning/fleet-readiness') as typeof import('./earning/fleet-readiness');

type Row = Record<string, unknown>;

const OWNER_EMAIL = `queue-owner-${randomUUID().slice(0, 8)}@test.local`;
const OWNER_PASSWORD = 'HumanActionQueue!123';

let ownerId = '';
let baseUrl = '';
let ownerToken = '';
let server: ReturnType<typeof createMissionServer>;

function row<T = Row>(sql: string, params: unknown[] = []): T | undefined {
  return missionDb.get<T>(sql, params as never[]);
}
function rows<T = Row>(sql: string, params: unknown[] = []): T[] {
  return missionDb.all<T>(sql, params as never[]);
}
function count(table: string, where = ''): number {
  return Number(missionDb.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}${where ? ` WHERE ${where}` : ''}`)?.c ?? 0);
}
function insertAgent(slug: string): string {
  const id = `agt_hq_${slug}`;
  missionDb.run(
    `INSERT INTO mission_agents (id, slug, name, category, role_key, depth, generation, status, mission_role, origin_platform, capabilities)
     VALUES (?, ?, ?, 'research', 'specialist', 0, 'registry', 'active', 'worker', 'akbaral-registry', '[]')`,
    [id, slug, `Queue agent ${slug}`],
  );
  return id;
}
/** The whole queue table, as the owner's decisions could have left it. A mutation check compares this. */
function queueSnapshot(): string {
  return JSON.stringify(rows('SELECT id, agent_id, action_type, status, notes, updated_at FROM mission_human_action_tasks ORDER BY id'));
}
function taskState(id: string): { status: string; notes: string; completedBy: string } {
  const task = row<{ status: string; notes: string; completed_by: string }>('SELECT status, notes, completed_by FROM mission_human_action_tasks WHERE id=?', [id])!;
  return { status: String(task.status), notes: String(task.notes ?? ''), completedBy: String(task.completed_by ?? '') };
}
function auditFor(action: string, subjectId: string): Row[] {
  return rows('SELECT * FROM mission_audit WHERE action=? AND subject_id=? ORDER BY seq', [action, subjectId]);
}
/** Every entry a test decided, so the "closing never deletes" check has a real id to point at. */
const decidedTaskIds: string[] = [];

function blockersOf(agentId: string): string[] {
  const verdict = readiness.readinessFor(agentId) as unknown as { blockers: string[] };
  return [...verdict.blockers].sort();
}

async function api(route: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${route}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}
function owner(route: string, init: RequestInit = {}) {
  return api(route, { ...init, headers: { authorization: `Bearer ${ownerToken}`, ...(init.headers ?? {}) } });
}
function ownerActor() {
  return { kind: 'owner' as const, id: ownerId };
}
/** Reads the queue through the route, because that is what the owner sees. */
async function openQueue(): Promise<{ status: number; body: any }> {
  const result = await owner('/api/human-actions');
  assert.equal(result.status, 200, `the owner can read the queue (${JSON.stringify(result.body)})`);
  return result;
}
function itemFor(body: any, taskId: string): any {
  const found = (body.items ?? []).find((item: any) => String(item.taskId) === String(taskId));
  assert.ok(found, `the queue lists ${taskId}`);
  return found;
}
/** Prepares a batch through the module and returns the task it filed, so no test hand-writes a task. */
function prepareBatch(agentClass: string, limit: number): { taskId: string; proposalIds: string[]; agentIds: string[] } {
  const before = rows<{ id: string }>("SELECT id FROM mission_human_action_tasks WHERE status='pending' ORDER BY id").map(r => r.id);
  const result = contracts.prepareClassContractsForClass(ownerActor(), { agentClass, limit }) as unknown as { preparedIds: string[] };
  const afterIds = rows<{ id: string }>("SELECT id FROM mission_human_action_tasks WHERE status='pending' ORDER BY id").map(r => r.id);
  const [taskId] = afterIds.filter(id => !before.includes(id));
  assert.ok(taskId, `preparing ${agentClass} filed an owner task for the batch`);
  return { taskId, proposalIds: result.preparedIds, agentIds: result.preparedIds.map(id => String(row<{ agent_id: string }>('SELECT agent_id FROM mission_agent_contract_proposals WHERE id=?', [id])!.agent_id)) };
}

before(async () => {
  applyMissionMigrations();
  const created = provisionOwner({ email: OWNER_EMAIL, password: OWNER_PASSWORD, displayName: 'Queue Owner' });
  ownerId = String((created as { id?: string }).id ?? row<{ id: string }>('SELECT id FROM mission_owner LIMIT 1')!.id);
  server = createMissionServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerToken = login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).token;
  insertAgent('a1'); insertAgent('a2'); insertAgent('a3'); insertAgent('a4');
});

after(() => {
  server?.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The list: what is open, and what each entry is waiting for
// ─────────────────────────────────────────────────────────────────────────────

it('an empty queue reports itself empty, with nothing counted and nothing invented', async () => {
  assert.equal(count('mission_human_action_tasks', "status='pending'"), 0, 'the fixture starts with no open entry');
  const { body } = await openQueue();
  assert.deepEqual(body.items, [], 'and the console shows an empty list, not a missing one');
  assert.equal(body.blocker.code, 'owner_action_pending');
  assert.equal(body.blocker.openOwnerTasks, 0);
  assert.deepEqual(body.counts, { open: 0, actionable: 0, stale: 0, unreadableSubject: 0, gatesReadable: true });
  assert.equal(body.truncated, false);
});

it('the two open manual_approval tasks are listed with the real subject and reason that filed them', async () => {
  const research = prepareBatch('bounty_research', 2);
  const evidence = prepareBatch('evidence_verification', 2);
  assert.equal(count('mission_human_action_tasks', "status='pending' AND action_type='manual_approval'"), 2, 'one entry per prepared batch, as production reports');

  const { body } = await openQueue();
  assert.equal(body.counts.open, 2);
  assert.equal(body.counts.actionable, 2, 'both point at proposals that are genuinely waiting on the owner');
  assert.equal(body.blocker.openOwnerTasks, 2, 'which is exactly the number the blocker quotes');

  for (const [entry, agentClass] of [[research, 'bounty_research'], [evidence, 'evidence_verification']] as const) {
    const item = itemFor(body, entry.taskId);
    assert.equal(item.actionType, 'manual_approval');
    assert.equal(item.actionLabel, 'manual approval', 'and the kind is readable, not only a snake_case key');
    assert.equal(item.subject.kind, 'contract-batch');
    assert.equal(item.subject.agentClass, agentClass, 'the exact class the batch belongs to, resolved from the stored row');
    assert.equal(item.subject.pending, 2);
    assert.deepEqual(item.subject.proposalIds.slice().sort(), entry.proposalIds.slice().sort(), 'and the proposal ids it refers to');
    assert.match(item.subject.waitingFor, /awaiting the owner's decision/);
    assert.match(item.reason, /await owner approval/, 'the reason the agent filed is shown verbatim');
    assert.ok(Date.parse(item.raisedAt) > 0, 'with when it was raised');
    assert.equal(item.agentId, entry.agentIds[0], 'against the agent the queue entry belongs to');
    assert.match(item.approveEffect, /through the contract module/);
    assert.ok(item.subject.surface, 'the surface an approval would create is shown before the click');
    assert.deepEqual(item.subject.surface.permissions, agentClass === 'bounty_research' ? ['report.submit'] : ['report.submit']);
  }
});

it('a roll-up entry is listed but never counted as an owner task, so the queue cannot feed itself', async () => {
  const reconciled = readiness.reconcileOwnerActions() as unknown as { created: string[]; openTotal: number };
  const rollups = rows<{ id: string; notes: string }>("SELECT id, notes FROM mission_human_action_tasks WHERE notes LIKE 'fleet-readiness:%' AND status='pending'");
  assert.ok(rollups.length > 0 || reconciled.created.length === 0, 'either roll-ups exist to be described or none were needed');

  const { body } = await openQueue();
  const rollupItems = (body.items ?? []).filter((item: any) => item.subject?.kind === 'fleet-gate');
  for (const item of rollupItems) {
    assert.equal(item.actionable, false, 'a roll-up describes a global gate; deciding it here grants nothing');
    assert.match(item.approveEffect, /does not change the .* gate/, 'and the panel says so before the owner clicks');
    assert.match(item.subject.waitingFor, /gate/, 'with the gate code it stands for');
  }
  assert.equal(
    body.blocker.openOwnerTasks,
    count('mission_human_action_tasks', "status='pending' AND (notes IS NULL OR notes NOT LIKE 'fleet-readiness:%')"),
    'the number matches the readiness rule for open owner tasks, roll-ups excluded',
  );
  assert.equal(body.blocker.openOwnerTasks, 2, 'and that number is still the two batches, no matter how many roll-ups the reconciler filed');
  assert.equal(body.counts.open, body.items.length);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Approving: the grant goes through the module that owns contracts
// ─────────────────────────────────────────────────────────────────────────────

it('nothing is granted without the surface the owner repeated back, and the entry stays open', async () => {
  const { body } = await openQueue();
  const item = body.items.find((entry: any) => entry.subject?.agentClass === 'bounty_research');
  assert.ok(item, 'the research batch is still waiting');
  const contractsBefore = count('mission_agent_contracts');
  const snapshot = queueSnapshot();

  const wrong = await owner(`/api/human-actions/${item.taskId}/approve`, { method: 'POST', body: JSON.stringify({ confirmSurface: 'ffff0000ffff0000' }) });
  assert.equal(wrong.status, 409, 'a stale or invented digest is refused');
  assert.equal(wrong.body?.error?.code, 'confirmation_surface_mismatch');
  const silent = await owner(`/api/human-actions/${item.taskId}/approve`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(silent.status, 409, 'and so is approving without stating a surface at all');

  assert.equal(count('mission_agent_contracts'), contractsBefore, 'no contract row exists after either refusal');
  assert.equal(queueSnapshot(), snapshot, 'the queue row was not touched by a refused decision');
  assert.ok(auditFor('agent_contract.bulk_approval_refused', 'bounty_research').length >= 2, 'each refusal is in the audit trail against the class');
});

it('the owner approves the entry, the batch is granted through the module, and the entry closes with it', async () => {
  const { body } = await openQueue();
  const item = body.items.find((entry: any) => entry.subject?.agentClass === 'bounty_research');
  const [a1, a2] = item.subject.proposalIds.map((id: string) => String(row<{ agent_id: string }>('SELECT agent_id FROM mission_agent_contract_proposals WHERE id=?', [id])!.agent_id));
  const beforeA1 = blockersOf(a1);
  const beforeA2 = blockersOf(a2);
  assert.ok(beforeA1.includes('no_scoped_contract') && beforeA1.includes('owner_action_pending'), 'a1 is blocked by both the contract and the queue');
  assert.ok(!beforeA2.includes('owner_action_pending'), 'a2 has no queue entry of its own');

  const result = await owner(`/api/human-actions/${item.taskId}/approve`, { method: 'POST', body: JSON.stringify({ confirmSurface: item.subject.surface.surfaceDigest }) });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.effect, 'granted_and_closed');
  assert.equal(result.body.grants.granted, 2, 'both proposals in the batch became contracts');
  assert.equal(result.body.grants.refusedCount, 0);

  decidedTaskIds.push(item.taskId);
  assert.equal(count('mission_agent_contracts'), 2, 'granted through the contract module, not around it');
  assert.equal(taskState(item.taskId).status, 'completed', 'the entry closes because the batch it pointed at is decided');
  assert.match(taskState(item.taskId).notes, /surface [0-9a-f]{16}/, 'recorded against the task id, with the digest that was confirmed');
  assert.equal(taskState(item.taskId).completedBy, ownerId, 'attributed to the owner who clicked');

  assert.deepEqual(blockersOf(a1).filter(code => code !== 'no_scoped_contract'), beforeA1.filter(code => code !== 'no_scoped_contract'), 'nothing else about a1 changed');
  assert.ok(blockersOf(a1).includes('owner_action_pending'), 'a1 still has the evidence batch open — one entry does not clear another');
  assert.deepEqual(blockersOf(a2), beforeA2.filter(code => code !== 'no_scoped_contract'), 'a2 is unblocked on contracts only');

  const gates = (readiness.ownerActivationPath() as unknown as { all: Array<{ code: string; cleared: boolean }> }).all;
  assert.equal(gates.find(entry => entry.code === 'no_scoped_contract')!.cleared, true, 'the global contract gate cleared');
  assert.equal(gates.find(entry => entry.code === 'owner_action_pending')!.cleared, false, 'and the queue gate did not, because an entry is still open');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Rejecting: a reason, and nothing else
// ─────────────────────────────────────────────────────────────────────────────

it('a rejection without a reason is refused; with one, the fleet stays exactly as blocked', async () => {
  const { body } = await openQueue();
  const item = body.items.find((entry: any) => entry.subject?.agentClass === 'evidence_verification');
  const a1 = String(row<{ agent_id: string }>('SELECT agent_id FROM mission_agent_contract_proposals WHERE id=?', [item.subject.proposalIds[0]])!.agent_id);
  const before = blockersOf(a1);
  const contractsBefore = count('mission_agent_contracts');
  const pendingBefore = count('mission_agent_contract_proposals', "status='pending' AND agent_class='evidence_verification'");
  assert.equal(pendingBefore, 2, 'two proposals are still waiting on this batch');

  const shrug = await owner(`/api/human-actions/${item.taskId}/reject`, { method: 'POST', body: JSON.stringify({ reason: '   ' }) });
  assert.equal(shrug.status, 409, 'a blank reason is not a decision');
  assert.equal(shrug.body?.error?.code, 'reason_required');
  assert.equal(taskState(item.taskId).status, 'pending', 'and the refused attempt changed nothing');

  const tooLong = await owner(`/api/human-actions/${item.taskId}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'x'.repeat(600) }) });
  assert.equal(tooLong.status, 409, 'nor is an essay');
  assert.equal(tooLong.body?.error?.code, 'reason_too_long');

  const decided = await owner(`/api/human-actions/${item.taskId}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'not this quarter; the surface needs a second look first' }) });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));
  assert.equal(decided.body.effect, 'rejected');
  assert.equal(decided.body.pendingProposalsAfter, 2, 'the proposals survive the rejection untouched');
  assert.match(decided.body.note, /still pending, untouched by this rejection/);

  assert.equal(count('mission_agent_contracts'), contractsBefore, 'no contract was granted by a rejection');
  assert.equal(count('mission_agent_contract_proposals', "status='pending' AND agent_class='evidence_verification'"), pendingBefore, 'and none was refused on the owner’s behalf either');
  decidedTaskIds.push(item.taskId);
  const state = taskState(item.taskId);
  assert.equal(state.status, 'cancelled', 'only the marker is cancelled');
  assert.match(state.notes, /rejected from the mission owner console — not this quarter/, 'with the reason stored on the row');

  const audit = auditFor('human_action.task_rejected', item.taskId);
  assert.equal(audit.length, 1, 'and one audit entry, against the task id');
  const detail = JSON.parse(String(audit[0].detail));
  assert.equal(detail.contractsWritten, 0);
  assert.equal(detail.pendingProposalsBefore, 2);
  assert.equal(detail.pendingProposalsAfter, 2, 'the before/after count is the proof that a rejection is not partial');
  assert.match(detail.reason, /not this quarter/);

  const after = blockersOf(a1);
  assert.ok(!after.includes('owner_action_pending'), 'the queue gate reports clear, because the owner decided the entry');
  assert.deepEqual(after, before.filter(code => code !== 'owner_action_pending'), 'and nothing else about that agent moved');
  // "Exactly as blocked as before" is a claim about the requirement, not about the marker: the batch is still
  // sitting unreviewed, so the queue guard still refuses a second prepare for that class.
  const classView = (contracts.classContractConsoleView() as unknown as { classes: Array<{ agentClass: string; pendingProposals: number; activeContracts: number }> }).classes
    .find(entry => entry.agentClass === 'evidence_verification')!;
  assert.equal(classView.pendingProposals, 2, 'the rejection left both proposals pending in the class the entry pointed at');
  assert.equal(classView.activeContracts, 0, 'and granted nothing');
  const guard = await owner('/api/agent-contracts/prepare', { method: 'POST', body: JSON.stringify({ agentClass: 'evidence_verification', limit: 1 }) });
  assert.equal(guard.status, 409, 'the class is still mid-review, which is the blocked state surviving the rejection');
  assert.equal(guard.body?.error?.code, 'proposals_already_pending_for_class');
  assert.equal((readiness.ownerActivationPath() as unknown as { all: Array<{ code: string; cleared: boolean }> }).all.find(entry => entry.code === 'owner_action_pending')!.cleared, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Staleness: reported, closable, never auto-closed
// ─────────────────────────────────────────────────────────────────────────────

it('an entry whose subject is gone is stale: closable by the owner, and open until then', async () => {
  const batch = prepareBatch('bounty_research', 2);
  assert.equal(batch.agentIds.length, 2, 'the next unprepared agents got a fresh batch');
  const before = blockersOf(batch.agentIds[0]);
  assert.ok(before.includes('owner_action_pending'), 'and its first agent is blocked by the entry');

  // Settle the proposals the way the module does — refuse them one by one. The batch has nothing pending,
  // and the entry it filed is left describing something that no longer exists.
  for (const id of batch.proposalIds) contracts.rejectClassContractProposal(ownerActor(), id, 'refused from the test that settles a batch');
  assert.equal(count('mission_agent_contract_proposals', "status='pending' AND agent_class='bounty_research'"), 0);

  // Nothing sweeps it away — not the reconciler, not the proposal expiry it never had.
  readiness.reconcileOwnerActions();
  contracts.expireStaleProposals();
  assert.equal(taskState(batch.taskId).status, 'pending', 'no code closes a stale entry by itself');

  const { body } = await openQueue();
  const item = itemFor(body, batch.taskId);
  assert.equal(item.subject.stale, true, 'it is labelled stale instead');
  assert.equal(item.actionable, false, 'and says plainly that approving it grants nothing');
  assert.match(item.subject.waitingFor, /nothing any more/);
  assert.match(item.approveEffect, /no contract row is created or changed by this click/);
  assert.ok(body.counts.stale >= 1, 'the stale count includes this entry');
  const rollupStale = (body.items ?? []).filter((entry: any) => entry.subject?.kind === 'fleet-gate' && entry.subject?.stale === true);
  assert.equal(rollupStale.length, body.counts.stale - 1, 'and every other stale row is a roll-up whose gate has since cleared — reported, not swept');

  const closed = await owner(`/api/human-actions/${batch.taskId}/approve`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.effect, 'closed_stale');
  assert.equal(closed.body.note, 'no contract row was written by this click — the batch it referred to has nothing pending any more');
  decidedTaskIds.push(batch.taskId);
  assert.equal(count('mission_agent_contracts'), 2, 'still the two from the granted batch — nothing was written here');
  assert.match(taskState(batch.taskId).notes, /closed as stale from the mission owner console/);
  assert.deepEqual(blockersOf(batch.agentIds[0]), before.filter(code => code !== 'owner_action_pending'), 'closing clears the queue blocker and only that one');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Who may decide: owner only, in every direction
// ─────────────────────────────────────────────────────────────────────────────

it('no agent identity — head agent included — may approve, reject or bulk-resolve an entry', async () => {
  // The research class is the one with nothing pending after the previous tests, so this prepares; the
  // evidence class still has its unreviewed batch and would be (correctly) refused a second one.
  const batch = prepareBatch('bounty_research', 1);
  const agentId = batch.agentIds[0];
  const snapshot = queueSnapshot();
  const contractsBefore = count('mission_agent_contracts');

  for (const attempt of [
    () => queue.approveHumanActionTask({ kind: 'agent', id: agentId }, { taskId: batch.taskId, confirmSurface: 'anything' }),
    () => queue.rejectHumanActionTask({ kind: 'agent', id: agentId }, { taskId: batch.taskId, reason: 'an agent deciding its own unblock' }),
  ]) {
    assert.throws(attempt, (error: Error & { code?: string }) => error.code === 'owner_required' && /never by an agent/.test(error.message));
  }
  assert.equal(queueSnapshot(), snapshot, 'and nothing was written while it was refused');
  assert.equal(count('mission_agent_contracts'), contractsBefore);
  const refused = auditFor('human_action.decision_refused', 'none');
  assert.ok(refused.length >= 2, 'each refusal is audited against the actor that tried it');
  assert.equal(JSON.parse(String(refused[0].detail)).actorKind, 'agent');

  // The route has no bulk endpoint at all, so "bulk-resolve" is not a thing anyone could reach.
  const bulk = await owner('/api/human-actions/bulk-resolve', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(bulk.status, 404, 'no bulk route exists');
  const bulkAll = await owner('/api/human-actions/approve-all', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(bulkAll.status, 404, 'nor a decide-everything route');
});

it('anonymous and read-link callers are refused, and not one queue row changes', async () => {
  const snapshot = queueSnapshot();
  const anonRead = await api('/api/human-actions');
  assert.equal(anonRead.status, 401, 'the queue, its reasons and the agent ids behind it are private');
  const { body } = await openQueue();
  const target = body.items[0];
  assert.ok(target, 'there is an open entry to try to decide');

  const anonApprove = await api(`/api/human-actions/${target.taskId}/approve`, { method: 'POST', body: JSON.stringify({ confirmSurface: target.subject?.surface?.surfaceDigest ?? '' }) });
  assert.equal(anonApprove.status, 401, 'and an anonymous decision is refused outright');
  const anonReject = await api(`/api/human-actions/${target.taskId}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'no session at all' }) });
  assert.equal(anonReject.status, 401);

  const link = await owner('/api/access-links', { method: 'POST', body: JSON.stringify({ label: 'queue-read', scope: 'dashboard:read', expiresInHours: 1 }) });
  assert.equal(link.status, 201, 'a read link is a real thing an operator can mint');
  const token = String((link.body as any)?.token ?? (link.body as any)?.link?.token ?? '');
  assert.ok(token.length > 8, 'with a token to present');

  const linkRead = await api('/api/human-actions', { headers: { 'x-mission-link': token } });
  assert.equal(linkRead.status, 200, 'it may read the queue, like every other panel');
  for (const decision of ['approve', 'reject']) {
    const refused = await api(`/api/human-actions/${target.taskId}/${decision}`, { method: 'POST', headers: { 'x-mission-link': token }, body: JSON.stringify({ reason: 'link holder', confirmSurface: target.subject?.surface?.surfaceDigest ?? '' }) });
    assert.ok(refused.status === 401 || refused.status === 403, `a read link cannot ${decision} an entry (saw ${refused.status})`);
  }

  // A mission account whose role is not `owner` must not decide a queue entry either. The mission answers
  // this at its own owner gate — `assertCanMutate` (auth.ts:206) for a role session that still resolves,
  // `requireOwner` (server.ts:374) for one that no longer resolves at all — so both refusals are correct
  // and the point of the test is that neither of them writes a row.
  missionDb.run("UPDATE mission_owner SET role='operator' WHERE id=?", [ownerId]);
  const operator = await api(`/api/human-actions/${target.taskId}/approve`, { method: 'POST', body: JSON.stringify({}) });
  assert.ok(operator.status === 401 || operator.status === 403, `a non-owner role cannot decide an entry (saw ${operator.status} ${JSON.stringify(operator.body)})`);
  missionDb.run("UPDATE mission_owner SET role='owner' WHERE id=?", [ownerId]);
  ownerToken = login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).token;
  assert.ok(ownerToken, 'the owner can sign back in after the role is restored');

  assert.equal(queueSnapshot(), snapshot, 'and across every refusal above, zero task rows were mutated');
  const unknown = await owner('/api/human-actions/hat_never_filed/approve', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(unknown.status, 404, 'a task that does not exist is not silently accepted');
  assert.equal(queueSnapshot(), snapshot, 'a 404 for an id that was never filed wrote nothing either');

  // Last, let the owner actually decide one of these entries, so the entry the deletion test below inspects
  // was decided through this route rather than assumed to be — and it is the only row that moves.
  const decided = await owner(`/api/human-actions/${target.taskId}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'owner deferred this batch to next week' }) });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));
  assert.notEqual(queueSnapshot(), snapshot, 'the one decision that was allowed is the one row that moved');
  decidedTaskIds.push(target.taskId);
});

it('a decided entry is closed, never deleted: the row and its whole audit trail survive', () => {
  assert.ok(decidedTaskIds.length >= 3, `the tests above decided entries through the real route (saw ${decidedTaskIds.length})`);
  for (const taskId of decidedTaskIds) {
    assert.equal(count('mission_human_action_tasks', `id='${taskId}'`), 1, 'the row is still there');
    const status = taskState(taskId).status;
    assert.ok(status === 'completed' || status === 'cancelled', `decided, not deleted (${status})`);
    assert.equal(auditFor('human_action.created', taskId).length, 1, 'the agent’s filing is untouched');
    assert.equal(auditFor('human_action.resolved', taskId).length, 1, 'the owner’s resolution is appended beside it, not over it');
    assert.match(taskState(taskId).notes, /mission owner console|closed as stale|rejected from/, 'and the row itself says who decided and how');
  }
  const chain = verifyMissionAudit() as { ok: boolean; rows: number; brokenAtSeq?: number; detail?: string };
  assert.equal(chain.ok, true, `the audit chain still verifies${chain.detail ? ` (${chain.detail} at ${chain.brokenAtSeq})` : ''}`);
  assert.ok(chain.rows > 0, 'and it is a chain with rows in it, not an empty pass');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The markup and the client that shows it
// ─────────────────────────────────────────────────────────────────────────────

const dashboard = {
  html: fs.readFileSync(path.resolve('mission-dashboard/index.html'), 'utf8'),
  js: fs.readFileSync(path.resolve('mission-dashboard/app.js'), 'utf8'),
  queue: fs.readFileSync(path.resolve('src/mission/human-action-queue.ts'), 'utf8'),
};

it('the queue block ships closed inside Approvals, and it is not a navigation entry', () => {
  const block = /<details class="control-block" id="human-actions-block">[\s\S]*?<\/details>/.exec(dashboard.html)?.[0] ?? '';
  assert.ok(block.length > 0, 'the block exists in the served markup');
  assert.doesNotMatch(block, /data-view=/, 'a block inside Approvals, not a view with its own route');
  assert.doesNotMatch(block, /<details[^>]*\bopen\b/, 'and it ships closed');
  for (const id of ['human-actions-note', 'human-actions-list', 'human-actions-confirm']) {
    assert.match(block, new RegExp(`id="${id}"`), `with its ${id} host`);
  }
  const approvals = dashboard.html.indexOf('data-panel="approvals"');
  const contractsBlock = dashboard.html.indexOf('id="contracts-block"');
  const policy = dashboard.html.indexOf('<details class="sub" data-view="policy"');
  assert.ok(approvals < contractsBlock && contractsBlock < dashboard.html.indexOf('id="human-actions-block"') && dashboard.html.indexOf('id="human-actions-block"') < policy, 'contracts block first, then the queue, both above the policy sub-section');
  assert.match(dashboard.html.replace(/\s+/g, ' '), /Nothing here closes by itself: there is no expiry, no sweep and no bulk resolve/, 'and the copy says plainly that nothing closes by itself');

  assert.match(dashboard.js, /await loadHumanActions\(\);/, 'the Approvals arm of loadTab fetches the queue');
  assert.match(dashboard.js, /api\('\/human-actions'\)/, 'through the owner route');
  assert.match(dashboard.js, /`\/human-actions\/\$\{encodeURIComponent\(taskId\)\}\/\$\{decision\}`/);
  assert.doesNotMatch(dashboard.js, /human-actions\/(bulk|resolve)/, 'and there is no bulk control to render');

  const entry = (readiness.ownerActivationPath() as unknown as { all: Array<{ code: string; how: string; target: string; evidence: string; action: string }> }).all.find(row => row.code === 'owner_action_pending')!;
  assert.equal(entry.how, 'dashboard control');
  assert.match(entry.target, /#human-actions-block/, 'the blocker points at the block that exists');
  assert.match(entry.evidence, /index\.html:227/, 'with its line');
  assert.match(entry.evidence, /server\.ts:\d+ \(the owner-only route\)/);
  assert.match(entry.action, /Human-action queue/, 'and names the control in the instruction');
});

/** Every timer the page arms, cleared in the page's own realm — a leaked interval reports a pass as a hang. */
const openPages: Array<() => void> = [];
after(() => {
  for (const release of openPages.splice(0)) release();
});

type QueuePayload = {
  generatedAt: string;
  items: Array<Record<string, unknown>>;
  total: number;
  shown: number;
  truncated: boolean;
  counts: Record<string, unknown>;
  blocker: { code: string; openOwnerTasks: number };
  note: string;
};

function queuePayload(overrides: Partial<QueuePayload> = {}): QueuePayload {
  const base: QueuePayload = {
    generatedAt: '2026-10-11T09:00:00.000Z',
    items: [
      {
        taskId: 'hat_research', actionType: 'manual_approval', actionLabel: 'manual approval', agentId: 'agt_hq_a1',
        opportunityId: null, reason: "2 scoped contract proposal(s) prepared for class 'bounty_research' and await owner approval.",
        raisedAt: '2026-10-11T08:00:00.000Z', notes: null, actionable: true,
        subject: {
          kind: 'contract-batch', agentClass: 'bounty_research', pending: 2, proposalIds: ['ccp_1', 'ccp_2'], stale: false,
          waitingFor: "2 scoped contract proposal(s) for class 'bounty_research' awaiting the owner's decision.",
          surface: { contracts: 2, permissions: ['report.submit'], totalBudgetCents: 0, permissionsPlain: ['file a work report'], never: 'never: create agents', surfaceDigest: 'abcd1234abcd1234' },
        },
        approveEffect: 'approves those 2 proposal(s) through the contract module', rejectEffect: 'cancels this entry with the reason recorded',
      },
      {
        taskId: 'hat_stale', actionType: 'manual_approval', actionLabel: 'manual approval', agentId: 'agt_hq_a3',
        opportunityId: null, reason: "2 scoped contract proposal(s) prepared for class 'evidence_verification' and await owner approval.",
        raisedAt: '2026-10-11T08:30:00.000Z', notes: null, actionable: false,
        subject: {
          kind: 'contract-batch', agentClass: 'evidence_verification', pending: 0, proposalIds: [], stale: true, surface: null,
          waitingFor: "nothing any more: no pending proposal exists for class 'evidence_verification'",
        },
        approveEffect: 'closes this stale entry only', rejectEffect: 'cancels this entry with the reason recorded',
      },
    ],
    total: 2, shown: 2, truncated: false,
    counts: { open: 2, actionable: 1, stale: 1, unreadableSubject: 0, gatesReadable: true },
    blocker: { code: 'owner_action_pending', openOwnerTasks: 2 },
    note: 'Nothing closes on its own.',
  };
  return { ...base, ...overrides };
}

function bootQueueConsole(options: { link?: string; payload?: QueuePayload | null; failure?: number } = {}) {
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

  window.fetch = async (url: string, init: RequestInit = {}) => {
    const asText = String(url);
    const pathOnly = asText.replace(/^\/api/, '').split('?')[0];
    let parsed: unknown = null;
    if (typeof init.body === 'string') { try { parsed = JSON.parse(init.body); } catch { parsed = init.body; } }
    requests.push({ path: pathOnly, method: init.method ?? 'GET', body: parsed });
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
    if (options.failure && pathOnly === '/human-actions') return json({ error: 'request failed', code: 'bad_gateway' }, options.failure);
    if (pathOnly === '/session/me') return json({ owner: { id: 'own_1', email: 'owner@queue.local', role: 'owner' }, expiresAt: null, vaultConfigured: true, identityLock: { enabled: true } });
    if (pathOnly === '/human-actions') return json(options.payload ?? queuePayload());
    if (/^\/human-actions\/[^/]+\/approve$/.test(pathOnly)) return json({ effect: 'granted_and_closed', note: 'granted' });
    if (/^\/human-actions\/[^/]+\/reject$/.test(pathOnly)) return json({ effect: 'rejected', note: 'cancelled with the reason' });
    return json({ items: [], rows: [], approvals: { pending: [] }, pending: [], all: [], classes: [], registry: {}, blocker: {}, targets: [], note: 'fixture' });
  };

  const source = dashboard.js.replace("document.addEventListener('DOMContentLoaded', boot);", '');
  window.eval(`${source}\nwindow.queueTest = { boot, wire, state, renderQueue, loadHumanActions };`);
  const api = window.queueTest as {
    boot: () => Promise<void>;
    wire: () => void;
    state: { token: string; link: string; owner: unknown };
    renderQueue: (payload: unknown, failure: unknown) => void;
    loadHumanActions: () => Promise<void>;
  };
  const doc = window.document as Document;
  if (options.link) {
    api.state.link = options.link;
    window.sessionStorage.setItem('za_mission_link', options.link);
  } else {
    api.state.token = 'synthetic-owner-token';
    api.state.owner = { id: 'own_1', email: 'owner@queue.local', role: 'owner' };
  }
  const settle = async () => {
    api.wire();
    await api.loadHumanActions();
    for (let index = 0; index < 40; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    releasePage();
  };
  return {
    window, api, requests, problems, settle, releasePage, document: doc,
    text: (selector: string) => (doc.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    cells: (selector: string) => [...doc.querySelectorAll(`${selector} tbody tr`)].map(rowNode => [...rowNode.children].map(cell => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '')),
    buttons: (selector: string, attribute: string) => [...doc.querySelectorAll(`${selector} button[${attribute}]`)].map(node => ({ label: node.textContent ?? '', value: node.getAttribute(attribute) ?? '', surface: node.getAttribute('data-surface') ?? '' })),
    click: async (node: Element) => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); for (let index = 0; index < 25; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); },
    submit: async (form: Element) => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); for (let index = 0; index < 25; index += 1) await new Promise((resolve) => setTimeout(resolve, 0)); },
  };
}

it('the owner reads each entry, what it waits for, and what each button would do', async () => {
  const harness = bootQueueConsole();
  await harness.settle();
  const rowsRendered = harness.cells('#human-actions-list');
  assert.equal(rowsRendered.length, 2, 'both open entries render');
  const [first, second] = rowsRendered;
  assert.match(first.join(' | '), /bounty_research/, 'with the class the batch belongs to');
  assert.match(first.join(' | '), /2 proposal\(s\) pending for that class/);
  assert.match(first.join(' | '), /await owner approval/, 'and the reason the agent filed');
  assert.match(second.join(' | '), /stale — closable by the owner, never auto-closed/, 'a leftover entry says so on its row');
  assert.match(harness.text('#human-actions-note'), /2 owner task\(s\) open — this is exactly what owner_action_pending counts/);

  const approve = harness.buttons('#human-actions-list', 'data-queue-approve');
  assert.deepEqual(approve.map(button => button.value), ['hat_research'], 'only the actionable entry offers a grant');
  assert.equal(approve[0].surface, 'abcd1234abcd1234', 'and it carries the surface digest the server will demand back');
  assert.deepEqual(harness.buttons('#human-actions-list', 'data-queue-close').map(button => button.value), ['hat_stale'], 'the stale one is offered a close instead, never a grant');
  assert.deepEqual(harness.buttons('#human-actions-list', 'data-queue-reject').map(button => button.value), ['hat_research', 'hat_stale'], 'and either may be rejected with a reason');

  await harness.click(harness.document.querySelector('#human-actions-list button[data-queue-approve]')!);
  assert.match(harness.text('#human-actions-confirm'), /file a work report/, 'the confirm panel shows the permission the click creates');
  assert.match(harness.text('#human-actions-confirm'), /total budget across them: 0\.00 USD/);
  await harness.click(harness.document.querySelector('#human-actions-confirm-yes')!);
  const posted = harness.requests.filter(entry => entry.method === 'POST');
  assert.deepEqual(posted.map(entry => entry.path), ['/human-actions/hat_research/approve']);
  assert.deepEqual((posted[0].body as Record<string, unknown>), { confirmSurface: 'abcd1234abcd1234' }, 'and it sends only the digest it displayed');

  await harness.click(harness.document.querySelector('#human-actions-list button[data-queue-reject]')!);
  const form = harness.document.querySelector('#human-actions-reject-form')!;
  assert.ok(form, 'rejection is a form, because the reason has to be recorded');
  (form.querySelector('input[name="reason"]') as HTMLInputElement).value = 'surface too wide for this quarter';
  await harness.submit(form);
  const rejected = harness.requests.filter(entry => entry.path.endsWith('/reject'));
  assert.equal(rejected.length, 1, 'one request, with the reason in it');
  assert.deepEqual(rejected[0].body, { reason: 'surface too wide for this quarter' });
  assert.deepEqual(harness.problems, [], 'and nothing threw at the owner');
});

it('a read-only session sees the queue and cannot decide it', async () => {
  const harness = bootQueueConsole({ link: 'synthetic-read-link-token' });
  await harness.settle();
  assert.match(harness.text('#human-actions-list'), /read-only session — only the owner decides this/);
  assert.equal(harness.buttons('#human-actions-list', 'data-queue-approve').length, 0, 'no grant button is rendered for a link session');
  assert.equal(harness.buttons('#human-actions-list', 'data-queue-reject').length, 0, 'nor a reject one');
  assert.equal(harness.requests.filter(entry => entry.method === 'POST').length, 0, 'and the panel issued no write');
});

it('a queue that could not be read renders MISSING and the reason, not an empty queue', async () => {
  const harness = bootQueueConsole({ failure: 502 });
  await harness.settle();
  assert.match(harness.text('#human-actions-list'), /MISSING — the human-action queue is MISSING/);
  assert.match(harness.text('#human-actions-note'), /request failed \(502\)/, 'with the reason on screen beside it');
  assert.doesNotMatch(harness.text('#human-actions-note'), /no owner task is open/, 'a failed read is never allowed to read as an empty queue');
  assert.deepEqual(harness.problems, [], 'and the failure is handled, not thrown');
});

it('the module never deletes a task and never claims an agent decided one', () => {
  assert.doesNotMatch(dashboard.queue, /DELETE FROM mission_human_action_tasks/, 'no delete statement exists in the queue module');
  assert.doesNotMatch(dashboard.queue, /UPDATE mission_human_action_tasks/, 'nor a status write around the gate: the gate module owns the transition');
  assert.match(dashboard.queue, /resolveHumanActionTask\(/, 'resolution goes through the gate module, once per decision');
  assert.match(dashboard.queue, /approveAllClassContractProposals\(/, 'and the grant through the contract module');
  assert.match(dashboard.queue, /actor\.kind !== 'owner'/, 'with the agent refusal stated explicitly, before any read or write');
});
