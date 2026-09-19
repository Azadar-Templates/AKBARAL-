import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mission-resource-calls-')), 'mission.db')}`;
const { applyMissionMigrations, missionDb, verifyMissionAudit } = require('./database') as typeof import('./database');
const { currentPolicy, updatePolicy, setKillSwitch } = require('./policy') as typeof import('./policy');
const { requestResource, provisionResource, recordResourceUsage, resourceReadiness, pendingResourceUsage } = require('./self-management') as typeof import('./self-management');
const { reserveResourceCall, claimResourceCall, cancelResourceCall, markResourceCallUncertain, settleResourceCall, runResourceCall } = require('./resource-calls') as typeof import('./resource-calls');
const owner = { actorType: 'owner' as const, actorId: `synthetic-owner-${randomUUID()}` };
const agentId = `synthetic-agent-${randomUUID()}`;
const agent = { actorType: 'agent' as const, actorId: agentId };
let previousPolicy: ReturnType<typeof currentPolicy>;
before(() => {
  applyMissionMigrations();
  previousPolicy = currentPolicy();
  updatePolicy({ killSwitch: false, requireApprovalAboveCents: 50 }, owner.actorId);
  missionDb.run("INSERT INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform) VALUES (?, ?, 'Synthetic quota fixture', 'specialist', 0, 'custom', 'active', 'worker', 'mission')", [agentId, agentId]);
});
after(() => { updatePolicy(previousPolicy, owner.actorId); missionDb.close(); });
function fixture(limits = { requests: 3, tokens: 30 }) {
  const credentialId = `synthetic-credential-${randomUUID()}`;
  missionDb.run("INSERT INTO mission_credentials (id, provider, label, kind, masked_hint, ciphertext, iv, tag, status) VALUES (?, 'synthetic-provider', 'Metadata fixture only, not a usable credential', 'api_key', 'fixture', 'fixture', 'fixture', 'fixture', 'active')", [credentialId]);
  const resource = requestResource({ agentId, kind: 'api', provider: 'synthetic-provider', credentialId, limits });
  const resourceId = String(resource.id);
  provisionResource({ id: resourceId, actualCostCents: 0, providerRef: `synthetic-${randomUUID().replace(/[0-9]/g, 'x')}`, evidence: 'Synthetic provisioning fixture; no actual purchase.', actorId: owner.actorId });
  recordResourceUsage({ id: resourceId, usage: { requests: 0, tokens: 0 }, ...owner });
  return { resourceId, credentialId, input: { resourceId, agentId, ...agent, idempotencyKey: randomUUID(), operationFingerprint: 'a'.repeat(64), units: { requests: 1, tokens: 10 } } };
}
const receipt = (actualUsage = { requests: 1, tokens: 5 }) => ({ outcome: 'succeeded' as const, actualUsage, providerRef: `synthetic-receipt-${randomUUID()}`, evidence: 'Synthetic usage receipt from a local test adapter, not an external provider.' });
function calls(resourceId: string) { return missionDb.all<{ id: string; status: string }>('SELECT id, status FROM mission_resource_calls WHERE resource_id = ?', [resourceId]); }
function usage(resourceId: string) { return JSON.parse(missionDb.get<{ usage: string }>('SELECT usage FROM mission_resources WHERE id = ?', [resourceId])!.usage); }
function counts() { return ['mission_ledger', 'mission_audit'].map(table => Number(missionDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n)); }
function failAfter(fragment: string, action: () => unknown) {
  const original = missionDb.run.bind(missionDb);
  missionDb.run = ((sql, params) => { const result = original(sql, params); if (sql.includes(fragment)) throw new Error('synthetic late database failure'); return result; }) as typeof missionDb.run;
  try { assert.throws(action, /synthetic late database failure/); } finally { missionDb.run = original; }
}

it('reserves every quota dimension atomically, binds replay content and reports held capacity', () => {
  const { resourceId, input } = fixture();
  const first = reserveResourceCall({ ...input, units: { requests: 3, tokens: 30 } });
  assert.equal(reserveResourceCall({ ...input, units: { tokens: 30, requests: 3 } }).id, first.id);
  assert.equal(calls(resourceId).length, 1);
  assert.throws(() => reserveResourceCall(input), /another reservation/);
  assert.throws(() => reserveResourceCall({ ...input, operationFingerprint: 'b'.repeat(64), units: { requests: 3, tokens: 30 } }), /another reservation/);
  assert.throws(() => reserveResourceCall({ ...input, idempotencyKey: randomUUID() }), /quota|ready/);
  assert.ok(resourceReadiness(resourceId).blockers.includes('quota_reserved:requests'));
  assert.deepEqual(usage(resourceId), { requests: 0, tokens: 0 });
  claimResourceCall(String(first.id), agent);
  assert.throws(() => claimResourceCall(String(first.id), agent), /redispatch/);
});

it('refuses malformed reservations, wrong agents and unavailable credentials without creating holds', () => {
  const { input, resourceId, credentialId } = fixture();
  const invalid: Array<Record<string, number>> = [{ requests: 0, tokens: 1 }, { requests: -1, tokens: 1 }, { requests: 1 }, { requests: 1, tokens: Infinity }];
  for (const units of invalid) {
    assert.throws(() => reserveResourceCall({ ...input, units }), /quota|counter|amount/);
  }
  assert.throws(() => reserveResourceCall({ ...input, actorId: 'other-agent' }), /another agent/);
  assert.throws(() => reserveResourceCall({ ...input, agentId: 'other-agent', ...owner }), /another agent/);
  missionDb.run("UPDATE mission_credentials SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?", [credentialId]);
  assert.throws(() => reserveResourceCall(input), /credential_unavailable/);
  assert.equal(calls(resourceId).length, 0);
});

it('rolls reservation and claim writes back if their audit fails', () => {
  const { input, resourceId } = fixture();
  const before = counts();
  failAfter('INSERT INTO mission_audit', () => reserveResourceCall(input));
  assert.equal(calls(resourceId).length, 0);
  assert.deepEqual(counts(), before);
  const row = reserveResourceCall(input);
  const reserved = counts();
  failAfter('INSERT INTO mission_audit', () => claimResourceCall(String(row.id), agent));
  assert.equal(calls(resourceId)[0].status, 'reserved');
  assert.deepEqual(counts(), reserved);
});

it('cancels an unstarted call after credential rotation, reassignment, quota changes or kill switch', () => {
  for (const change of ['rotation', 'assignment', 'usage', 'kill'] as const) {
    const { input, resourceId, credentialId } = fixture();
    const row = reserveResourceCall({ ...input, units: { requests: 2, tokens: 20 } });
    if (change === 'rotation') missionDb.run('UPDATE mission_credentials SET rotation_count = rotation_count + 1 WHERE id = ?', [credentialId]);
    if (change === 'assignment') missionDb.run('UPDATE mission_resources SET agent_id = NULL WHERE id = ?', [resourceId]);
    if (change === 'usage') recordResourceUsage({ id: resourceId, usage: { requests: 2, tokens: 20 }, ...owner });
    if (change === 'kill') setKillSwitch(true, owner.actorId);
    try {
      assert.throws(() => claimResourceCall(String(row.id), agent), /changed|quota|ready/);
      assert.equal(calls(resourceId)[0].status, 'cancelled');
      assert.equal(Object.keys(pendingResourceUsage(resourceId)).length, 0);
    } finally { if (change === 'kill') setKillSwitch(false, owner.actorId); }
  }
});

it('only unstarted calls can release their hold without a receipt', () => {
  const { input, resourceId } = fixture();
  const row = reserveResourceCall(input);
  cancelResourceCall(String(row.id), agent);
  cancelResourceCall(String(row.id), agent);
  assert.equal(Object.keys(pendingResourceUsage(resourceId)).length, 0);
  const started = reserveResourceCall({ ...input, idempotencyKey: randomUUID() });
  claimResourceCall(String(started.id), agent);
  assert.throws(() => cancelResourceCall(String(started.id), owner), /reconcile dispatched/);
  markResourceCallUncertain(String(started.id), agent);
  assert.equal(pendingResourceUsage(resourceId).requests, 1);
  assert.throws(() => settleResourceCall(String(started.id), agent, receipt()), /owner reconciliation/);
  settleResourceCall(String(started.id), owner, receipt());
  assert.equal(Object.keys(pendingResourceUsage(resourceId)).length, 0);
});

it('settles actual usage exactly once with atomic audit, immutable receipts and no ledger movement', () => {
  const { input, resourceId } = fixture();
  const row = reserveResourceCall(input);
  claimResourceCall(String(row.id), agent);
  const actual = receipt();
  const before = counts();
  failAfter('UPDATE mission_resource_calls SET status', () => settleResourceCall(String(row.id), agent, actual));
  assert.deepEqual(usage(resourceId), { requests: 0, tokens: 0 });
  assert.deepEqual(counts(), before);
  assert.equal(calls(resourceId)[0].status, 'dispatched');
  settleResourceCall(String(row.id), agent, actual);
  const settled = counts();
  settleResourceCall(String(row.id), agent, actual);
  assert.deepEqual(counts(), settled);
  assert.equal(counts()[0], before[0], 'quota accounting never changes mission money');
  assert.deepEqual(usage(resourceId), actual.actualUsage);
  assert.throws(() => settleResourceCall(String(row.id), agent, { ...actual, actualUsage: { requests: 1, tokens: 1 } }), /cannot be changed/);
  const other = reserveResourceCall({ ...input, idempotencyKey: randomUUID() });
  claimResourceCall(String(other.id), agent);
  assert.throws(() => settleResourceCall(String(other.id), agent, actual), /already accounted/);
  assert.equal(verifyMissionAudit().ok, true);
});

it('records real reported overages instead of discarding them to fit a reservation', () => {
  const { input, resourceId } = fixture();
  const row = reserveResourceCall(input);
  claimResourceCall(String(row.id), agent);
  settleResourceCall(String(row.id), agent, receipt({ requests: 4, tokens: 40 }));
  assert.deepEqual(usage(resourceId), { requests: 4, tokens: 40 });
  assert.ok(resourceReadiness(resourceId).blockers.includes('quota_exhausted:tokens'));
  assert.throws(() => reserveResourceCall({ ...input, idempotencyKey: randomUUID() }), /quota|ready/);
});

it('worker wrapper sends at most once for a key and never stores adapter response content', async () => {
  const { input, resourceId } = fixture();
  let invoked = 0;
  const invoke = async () => { invoked++; return { ...receipt(), value: 'synthetic private response payload' }; };
  const result = await runResourceCall(input, invoke);
  assert.equal(result.value, 'synthetic private response payload');
  await assert.rejects(() => runResourceCall(input, invoke), /redispatch/);
  assert.equal(invoked, 1);
  assert.ok(!JSON.stringify(missionDb.all('SELECT * FROM mission_resource_calls WHERE resource_id = ?', [resourceId])).includes(result.value));
});

it('lost responses and malformed receipts retain quota and prohibit blind retry', async () => {
  for (const invalidReceipt of [false, true]) {
    const { input, resourceId } = fixture({ requests: 1, tokens: 10 });
    await assert.rejects(() => runResourceCall(input, async () => {
      if (!invalidReceipt) throw new Error('synthetic provider timeout');
      return { ...receipt({ requests: -1, tokens: 0 }), value: 'unverified synthetic response' };
    }), /timeout|counter/);
    assert.equal(calls(resourceId)[0].status, 'uncertain');
    assert.equal(pendingResourceUsage(resourceId).requests, 1);
    assert.throws(() => reserveResourceCall({ ...input, idempotencyKey: randomUUID() }), /quota|ready/);
  }
});

it('revocation during an awaited call retains actual usage but withholds the result', async () => {
  const { input, resourceId, credentialId } = fixture();
  await assert.rejects(() => runResourceCall(input, async () => {
    missionDb.run("UPDATE mission_credentials SET status = 'revoked' WHERE id = ?", [credentialId]);
    return { ...receipt(), value: 'must not be released after authority changed' };
  }), /result withheld/);
  assert.equal(calls(resourceId)[0].status, 'succeeded');
  assert.deepEqual(usage(resourceId), { requests: 1, tokens: 5 });
  assert.equal(Object.keys(pendingResourceUsage(resourceId)).length, 0);
});

it('provider-declared failure records usage without returning an apparent successful result', async () => {
  const { input, resourceId } = fixture();
  await assert.rejects(() => runResourceCall(input, async () => ({ ...receipt(), outcome: 'failed', value: 'not a deliverable' })), /provider reported failure/);
  assert.equal(calls(resourceId)[0].status, 'failed');
  assert.deepEqual(usage(resourceId), { requests: 1, tokens: 5 });
});

it('uncertain outcomes block a resource even when estimated reserved capacity remains', () => {
  const { input, resourceId } = fixture();
  const row = reserveResourceCall(input);
  claimResourceCall(String(row.id), agent);
  markResourceCallUncertain(String(row.id), agent);
  assert.ok(resourceReadiness(resourceId).blockers.includes('provider_outcome_uncertain'));
  assert.throws(() => reserveResourceCall({ ...input, idempotencyKey: randomUUID() }), /provider_outcome_uncertain/);
  settleResourceCall(String(row.id), owner, receipt());
  assert.equal(resourceReadiness(resourceId).usable, true);
});

it('a crashed or legacy dispatch cannot silently release capacity or authorize new work', () => {
  for (const deadline of [null, '2000-01-01T00:00:00Z', 'invalid']) {
    const { input, resourceId } = fixture();
    const row = reserveResourceCall(input);
    claimResourceCall(String(row.id), agent);
    missionDb.run('UPDATE mission_resource_calls SET deadline_at = ? WHERE id = ?', [deadline, String(row.id)]);
    assert.ok(resourceReadiness(resourceId).blockers.includes('provider_outcome_uncertain'));
    assert.throws(() => settleResourceCall(String(row.id), agent, receipt()), /owner reconciliation/);
    assert.throws(() => cancelResourceCall(String(row.id), owner), /reconcile dispatched/);
    assert.throws(() => reserveResourceCall({ ...input, idempotencyKey: randomUUID() }), /provider_outcome_uncertain/);
    settleResourceCall(String(row.id), owner, receipt());
    assert.equal(pendingResourceUsage(resourceId).requests, undefined);
  }
});

it('worker deadline aborts cooperatively but retains quota when a provider ignores cancellation', async () => {
  const { input, resourceId } = fixture();
  for (const timeoutMs of [0, Infinity, 300001]) await assert.rejects(() => runResourceCall(input, async () => ({ ...receipt(), value: 'must not run' }), { timeoutMs }), /timeout must/);
  assert.equal(calls(resourceId).length, 0);
  let release!: (result: ReturnType<typeof receipt> & { value: string }) => void;
  let signal: AbortSignal | undefined;
  await assert.rejects(() => runResourceCall(input, async (_permit, receivedSignal) => {
    signal = receivedSignal;
    return new Promise<ReturnType<typeof receipt> & { value: string }>(resolve => { release = resolve; });
  }, { timeoutMs: 100 }), /deadline/);
  assert.equal(signal?.aborted, true);
  assert.equal(calls(resourceId)[0].status, 'uncertain');
  assert.equal(pendingResourceUsage(resourceId).requests, 1);
  release({ ...receipt(), value: 'late response must not be delivered or auto-reconciled' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(usage(resourceId), { requests: 0, tokens: 0 });
  assert.equal(calls(resourceId)[0].status, 'uncertain');
  assert.ok(resourceReadiness(resourceId).blockers.includes('provider_outcome_uncertain'));
});

// PGlite uses a single embedded backend, so it is not independent-session
// concurrency evidence. These races intentionally exercise SQLite processes.
if (!process.env.PG_TEST_DATABASE_URL) {
  async function race(inputs: Array<ReturnType<typeof fixture>['input'] & { callId?: string }>) {
    type Result = { phase: string; ok: boolean; code?: string; error?: string };
    const workers = inputs.map(input => fork(path.resolve('scripts/testing/resource-call-racer.ts'), [], {
      execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, QUOTA_RACE_FIXTURE: JSON.stringify(input) },
    }));
    const ready: Array<Promise<void>> = [];
    const results: Array<Promise<Result>> = [];
    for (const worker of workers) {
      ready.push(new Promise<void>((resolve, reject) => {
        worker.on('message', (message: { phase: string }) => { if (message.phase === 'ready') resolve(); });
        worker.once('error', reject);
        worker.once('exit', () => reject(new Error('quota fixture exited before ready')));
      }));
      results.push(new Promise<Result>((resolve, reject) => {
        worker.on('message', (message: Result) => { if (message.phase === 'result') resolve(message); });
        worker.once('error', reject);
        worker.once('exit', () => reject(new Error('quota fixture exited without a result')));
      }));
    }
    // Attach rejection handlers before waiting for the readiness barrier.
    const completed = Promise.all(results);
    void completed.catch(() => {});
    try {
      await Promise.all(ready);
      for (const worker of workers) worker.send('go');
      return await completed;
    } finally { for (const worker of workers) if (worker.exitCode === null) worker.kill(); }
  }
  it('two independent SQLite processes cannot over-reserve the same remaining quota', { timeout: 15000 }, async () => {
    const { input, resourceId } = fixture({ requests: 1, tokens: 10 });
    const outcomes = await race([input, { ...input, idempotencyKey: randomUUID() }]);
    assert.equal(outcomes.filter(result => result.ok).length, 1, JSON.stringify(outcomes));
    assert.ok(['resource_unavailable', 'quota_exhausted'].includes(outcomes.find(result => !result.ok)!.code!));
    assert.equal(calls(resourceId).length, 1);
    assert.equal(pendingResourceUsage(resourceId).requests, 1);
    assert.equal(verifyMissionAudit().ok, true);
  });
  it('two independent SQLite workers cannot dispatch the same reservation twice', { timeout: 15000 }, async () => {
    const { input, resourceId } = fixture();
    const row = reserveResourceCall(input);
    const outcomes = await race([{ ...input, callId: String(row.id) }, { ...input, callId: String(row.id) }]);
    assert.equal(outcomes.filter(result => result.ok).length, 1, JSON.stringify(outcomes));
    assert.equal(outcomes.find(result => !result.ok)!.code, 'conflict');
    assert.equal(calls(resourceId)[0].status, 'dispatched');
    assert.equal(verifyMissionAudit().ok, true);
  });
}
