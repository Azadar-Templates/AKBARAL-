import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mission-chat-')), 'mission.db')}`;
process.env.ZA141251SA_CREDENTIAL_KEY = 'synthetic-chat-vault-key-not-real-0123456789';
const { applyMissionMigrations, missionDb, verifyMissionAudit } = require('./database') as typeof import('./database');
const { updatePolicy, currentPolicy } = require('./policy') as typeof import('./policy');
const { storeCredential, requestResource, provisionResource, recordResourceUsage, seedTools, setToolStatus } = require('./self-management') as typeof import('./self-management');
const { createWallet, credit, getWallet } = require('./treasury') as typeof import('./treasury');
const { appendAgentMessage, listAgentMessages } = require('./messaging') as typeof import('./messaging');
const { configureAgentChat, listAgentChatJobs, CHAT_MODEL } = require('./chat-state') as typeof import('./chat-state');
const { runNextAgentChat, recoverAgentChatJobs } = require('./chat-worker') as typeof import('./chat-worker');
const { invokeGoogleChat } = require('./chat-provider') as typeof import('./chat-provider');
const { heldResourceBudget } = require('./resource-budget-state') as typeof import('./resource-budget-state');
const { recordResourceCallCost } = require('./resource-budgets') as typeof import('./resource-budgets');
const { settleResourceCall, cancelResourceCall } = require('./resource-calls') as typeof import('./resource-calls');
const owner = { actorType: 'owner' as const, actorId: `synthetic-owner-${randomUUID()}` };
let original: ReturnType<typeof currentPolicy>;
before(() => { applyMissionMigrations(); seedTools(); original = currentPolicy(); updatePolicy({ autonomousEnabled: true, killSwitch: false, maxDailySpendCents: 1000000, maxExpenseCents: 10000, requireApprovalAboveCents: 5000 }, owner.actorId); });
after(() => { updatePolicy(original, owner.actorId); missionDb.close(); });
function fixture(enabled = true) {
  const agentId = `synthetic-chat-agent-${randomUUID()}`;
  missionDb.run("INSERT INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform) VALUES (?, ?, 'Synthetic chat fixture', 'specialist', 0, 'custom', 'active', 'worker', 'mission')", [agentId, agentId]);
  const credential = storeCredential({ provider: 'google', label: 'Synthetic chat credential', secret: 'synthetic-not-a-real-provider-key', scope: ['model.call'], actorId: owner.actorId });
  const resource = requestResource({ agentId, provider: 'google', kind: 'api', credentialId: credential.id, limits: { requests: 5, tokens: 100000 } });
  const resourceId = String(resource.id);
  provisionResource({ id: resourceId, actualCostCents: 0, providerRef: `synthetic-${randomUUID().replace(/[0-9]/g, 'x')}`, evidence: 'Synthetic fixture; no real purchase.', actorId: owner.actorId });
  recordResourceUsage({ id: resourceId, usage: { requests: 0, tokens: 0 }, ...owner });
  const wallet = createWallet({ kind: 'agent', agentId, label: 'Synthetic chat wallet', budgetCents: 100 });
  credit({ walletId: wallet.id, amountCents: 100, category: 'transfer', memo: 'Synthetic fixture funds' });
  const config: import('./chat-state').AgentChatConfig = { enabled, resourceId, walletId: wallet.id, model: CHAT_MODEL, maxInputBytes: 2000, maxOutputTokens: 128, maxCostCents: 40, costBasis: 'Synthetic owner-specified test cap; not a verified provider price.' };
  configureAgentChat(agentId, config, owner);
  const message = (body = 'Synthetic owner message', key: string = randomUUID()) => appendAgentMessage({ agentId, ...owner, body, idempotencyKey: key });
  return { agentId, resourceId, walletId: wallet.id, credentialId: credential.id, config, message };
}
function runChat(f: ReturnType<typeof fixture>, adapter?: import('./chat-provider').ChatAdapter) { return runNextAgentChat(adapter, { agentId: f.agentId }); }
const response = () => ({ outcome: 'succeeded' as const, actualUsage: { requests: 1, tokens: 15 }, providerRef: `synthetic-chat-${randomUUID()}`, evidence: 'Synthetic adapter usage fixture; no actual provider request.', value: 'Synthetic adapter reply, not a real model result.' });
function reconcile(f: ReturnType<typeof fixture>, job: Record<string, any>) {
  if (!job.call_id) return;
  const call = missionDb.get<{ status: string }>('SELECT status FROM mission_resource_calls WHERE id = ?', [job.call_id])!;
  if (call.status === 'reserved') { cancelResourceCall(job.call_id, owner); return; }
  if (['uncertain', 'dispatched'].includes(call.status)) settleResourceCall(job.call_id, owner, { ...response(), actualUsage: { requests: 0, tokens: 0 } });
  if (call.status !== 'cancelled') recordResourceCallCost(f.resourceId, job.call_id, owner, { actualCostCents: 0, providerRef: `synthetic-zero-${randomUUID()}`, evidence: 'Synthetic test adapters incur no external charge.' });
}

it('only opted-in new owner messages enqueue, idempotent replay and agent replies never enqueue again', async () => {
  const f = fixture(false);
  const old = f.message();
  assert.equal(listAgentChatJobs(f.agentId).jobs.length, 0);
  configureAgentChat(f.agentId, { ...f.config, enabled: true }, owner);
  f.message(String(old.message.body), String(old.message.idempotency_key));
  assert.equal(listAgentChatJobs(f.agentId).jobs.length, 0, 'old messages are not retroactively billed');
  const message = f.message();
  f.message(String(message.message.body), String(message.message.idempotency_key));
  assert.equal(listAgentChatJobs(f.agentId).jobs.length, 1);
  appendAgentMessage({ agentId: f.agentId, actorType: 'agent', actorId: f.agentId, body: 'Synthetic manual reply', idempotencyKey: randomUUID(), replyTo: String(message.message.id) });
  assert.equal(listAgentChatJobs(f.agentId).jobs.length, 1);
  assert.equal(listAgentMessages(f.agentId).automaticRepliesConfigured, true);
  await runChat(f, async () => { throw new Error('manual reply should supersede'); });
});

it('manual agent replies supersede queued jobs without any quota or money reservation', async () => {
  const f = fixture(), message = f.message();
  appendAgentMessage({ agentId: f.agentId, actorType: 'agent', actorId: f.agentId, body: 'Synthetic independent manual reply', idempotencyKey: randomUUID(), replyTo: String(message.message.id) });
  let called = false;
  const job = await runChat(f, async () => { called = true; return response(); });
  assert.equal(job!.status, 'superseded'); assert.equal(called, false);
});

it('dispatches one budgeted model call and records a durable reply without recording a guessed charge', async () => {
  const f = fixture(), message = f.message(); let calls = 0;
  const job = await runChat(f, async (permit, signal, request) => {
    calls += 1; assert.equal(signal.aborted, false); assert.equal(permit.agentId, f.agentId);
    assert.equal(request.body, message.message.body); assert.equal(heldResourceBudget(f.walletId), 40);
    assert.equal(await runChat(f, async () => { throw new Error('must not redispatch'); }), null);
    return response();
  });
  assert.equal(calls, 1); assert.equal(job!.status, 'succeeded');
  const messages = listAgentMessages(f.agentId).messages;
  assert.equal(messages.length, 2); assert.equal(messages[1].reply_to, message.message.id);
  assert.equal(getWallet(f.walletId)!.balanceCents, 100);
  assert.equal(heldResourceBudget(f.walletId), 40, 'usage receipt does not prove cost');
  assert.equal(await runChat(f), null);
  reconcile(f, job!);
});

it('policy, tool, scope, message bounds and changed configuration block before invoking a provider', async () => {
  for (const reason of ['policy', 'tool', 'scope', 'bytes', 'config'] as const) {
    const f = fixture(); f.message(reason === 'bytes' ? 'x'.repeat(2001) : undefined);
    if (reason === 'policy') updatePolicy({ autonomousEnabled: false }, owner.actorId);
    if (reason === 'tool') setToolStatus('gemini_api', 'blocked', owner.actorId);
    if (reason === 'scope') missionDb.run("UPDATE mission_credentials SET scope = '[]' WHERE id = ?", [f.credentialId]);
    if (reason === 'config') configureAgentChat(f.agentId, { ...f.config, maxCostCents: 39 }, owner);
    let called = false;
    try {
      const job = await runChat(f, async () => { called = true; return response(); });
      assert.equal(job!.status, 'blocked', reason); assert.equal(called, false);
      assert.equal(heldResourceBudget(f.walletId), 0);
    } finally { updatePolicy({ autonomousEnabled: true }, owner.actorId); if (reason === 'tool') setToolStatus('gemini_api', 'approved', owner.actorId); }
  }
});

it('unknown provider failures keep both holds and never fabricate or automatically retry a reply', async () => {
  const f = fixture(); f.message();
  const job = await runChat(f, async () => { throw new Error('synthetic secret-like provider error must not be stored'); });
  assert.equal(job!.status, 'needs_review'); assert.equal(job!.reason, 'worker_error');
  assert.equal(listAgentMessages(f.agentId).messages.length, 1);
  assert.equal(heldResourceBudget(f.walletId), 40);
  assert.equal(await runChat(f), null);
  assert.ok(!JSON.stringify(job).includes('secret-like'));
  reconcile(f, job!);
});

it('configuration revocation during a call records usage but withholds the reply', async () => {
  const f = fixture(); f.message();
  const job = await runChat(f, async () => { configureAgentChat(f.agentId, { ...f.config, enabled: false }, owner); return response(); });
  assert.equal(job!.status, 'needs_review'); assert.equal(listAgentMessages(f.agentId).messages.length, 1);
  assert.equal(missionDb.get<{ status: string }>('SELECT status FROM mission_resource_calls WHERE id = ?', [job!.call_id])!.status, 'succeeded');
  reconcile(f, job!);
});

it('late reply persistence failure rolls back the message and keeps a recoverable non-replayed job', async () => {
  const f = fixture(); f.message();
  const run = missionDb.run.bind(missionDb);
  missionDb.run = ((sql, params) => { const result = run(sql, params); if (sql.includes('reply_message_id = ?') && params?.[0] === 'succeeded') throw new Error('synthetic reply write failure'); return result; }) as typeof missionDb.run;
  let job;
  try { job = await runChat(f, async () => response()); } finally { missionDb.run = run; }
  assert.equal(job!.status, 'needs_review'); assert.equal(listAgentMessages(f.agentId).messages.length, 1);
  reconcile(f, job!);
});

it('crash recovery marks old dispatched calls uncertain, keeps exposure and forbids automatic replay', async () => {
  const f = fixture(); f.message();
  const job = await runChat(f, async () => {
    missionDb.run("UPDATE mission_agent_chat_jobs SET started_at = '2000-01-01T00:00:00Z' WHERE agent_id = ?", [f.agentId]);
    assert.equal(recoverAgentChatJobs(f.agentId), 1);
    return response();
  });
  assert.equal(job!.status, 'needs_review');
  assert.equal(listAgentMessages(f.agentId).messages.length, 1);
  assert.equal(heldResourceBudget(f.walletId), 40);
  assert.equal(await runChat(f), null);
  reconcile(f, job!);
});

it('fixed Google adapter uses the encrypted credential only in a header, with no tools or redirects', async () => {
  const f = fixture(); f.message();
  const job = await runChat(f, (permit, signal, request) => invokeGoogleChat(permit, signal, request, (async (url, init) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    assert.equal(init!.redirect, 'error'); assert.equal(init!.signal, signal);
    assert.equal((init!.headers as Record<string, string>)['x-goog-api-key'], 'synthetic-not-a-real-provider-key');
    const body = JSON.parse(String(init!.body));
    assert.equal(body.tools, undefined); assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
    assert.equal(body.generationConfig.maxOutputTokens, 128);
    assert.ok(!String(init!.body).includes('synthetic-not-a-real-provider-key'));
    return new Response(JSON.stringify({ responseId: `synthetic-${randomUUID()}`, usageMetadata: { totalTokenCount: 22 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Synthetic transport reply; not a live model call.' }] } }] }));
  }) as typeof fetch));
  assert.equal(job!.status, 'succeeded');
  assert.equal(JSON.parse(String(missionDb.get<{ usage: string }>('SELECT usage FROM mission_resources WHERE id = ?', [f.resourceId])!.usage)).tokens, 22);
  reconcile(f, job!);
});

it('missing usage stays uncertain while a known blocked model response records usage without a reply', async () => {
  for (const actual of [false, true]) {
    const f = fixture(); f.message();
    const job = await runChat(f, (permit, signal, request) => invokeGoogleChat(permit, signal, request, (async () => new Response(JSON.stringify({ responseId: `synthetic-${randomUUID()}`, ...(actual ? { usageMetadata: { totalTokenCount: 8 } } : {}), candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'Not a deliverable' }] } }] }))) as typeof fetch));
    assert.equal(job!.status, 'needs_review');
    assert.equal(missionDb.get<{ status: string }>('SELECT status FROM mission_resource_calls WHERE id = ?', [job!.call_id])!.status, actual ? 'failed' : 'uncertain');
    assert.equal(listAgentMessages(f.agentId).messages.length, 1);
    reconcile(f, job!);
  }
  assert.equal(verifyMissionAudit().ok, true);
});

it('message and durable job creation roll back together on a late queue failure', () => {
  const f = fixture();
  const run = missionDb.run.bind(missionDb);
  missionDb.run = ((sql, params) => { const result = run(sql, params); if (sql.includes('INSERT INTO mission_agent_chat_jobs')) throw new Error('synthetic queue failure'); return result; }) as typeof missionDb.run;
  try { assert.throws(() => f.message(), /synthetic queue failure/); } finally { missionDb.run = run; }
  assert.equal(listAgentMessages(f.agentId).messages.length, 0);
  assert.equal(listAgentChatJobs(f.agentId).jobs.length, 0);
});

it('a crash before dispatch can release the unstarted holds without calling a provider', () => {
  const f = fixture(); f.message();
  const queued = listAgentChatJobs(f.agentId).jobs[0];
  const operations = require('./resource-calls') as typeof import('./resource-calls');
  const call = operations.reserveResourceCall({ resourceId: f.resourceId, agentId: f.agentId, actorType: 'agent', actorId: f.agentId, idempotencyKey: 'synthetic-crash-before-dispatch', operationFingerprint: 'd'.repeat(64), units: { requests: 1, tokens: 100 }, budget: { walletId: f.walletId, maxCostCents: 40 } });
  missionDb.run("UPDATE mission_agent_chat_jobs SET status = 'running', call_id = ?, started_at = '2000-01-01T00:00:00Z' WHERE id = ?", [call.id, queued.id]);
  assert.equal(recoverAgentChatJobs(f.agentId), 1);
  assert.equal(heldResourceBudget(f.walletId), 0);
  assert.equal(missionDb.get<{ status: string }>('SELECT status FROM mission_resource_calls WHERE id = ?', [call.id])!.status, 'cancelled');
  assert.equal(listAgentChatJobs(f.agentId).jobs[0].status, 'needs_review');
});

it('safe-integer message cursors remain PostgreSQL-compatible with stable job pagination', async () => {
  const f = fixture(); f.message(); f.message();
  assert.equal(listAgentMessages(f.agentId, Number.MAX_SAFE_INTEGER).messages.length, 0);
  const first = listAgentChatJobs(f.agentId, Number.MAX_SAFE_INTEGER, 1);
  assert.equal(first.jobs.length, 1); assert.ok(first.nextCursor);
  const last = listAgentChatJobs(f.agentId, first.nextCursor!, 1);
  assert.equal(last.jobs.length, 1); assert.notEqual(first.jobs[0].id, last.jobs[0].id);
  assert.equal(last.nextCursor, null);
  configureAgentChat(f.agentId, { ...f.config, enabled: false }, owner);
  const unexpected = async () => { throw new Error('disabled fixture must not invoke a provider'); };
  await runChat(f, unexpected); await runChat(f, unexpected);
});

it('a scoped worker cannot consume another agent’s retained pending jobs', async () => {
  const other = fixture(), f = fixture(); other.message(); f.message();
  const job = await runChat(f, async permit => { assert.equal(permit.agentId, f.agentId); return response(); });
  assert.equal(job!.status, 'succeeded');
  assert.equal(listAgentChatJobs(other.agentId).jobs[0].status, 'queued');
  configureAgentChat(other.agentId, { ...other.config, enabled: false }, owner);
  assert.equal((await runChat(other, async () => { throw new Error('must not invoke'); }))!.status, 'blocked');
  reconcile(f, job!);
});
it('default runtime cannot bill Google using legacy balance or usage evidence',async()=>{
  const f=fixture();f.message();
  const job=await runNextAgentChat(undefined,{agentId:f.agentId});
  assert.equal(job!.status,'blocked');assert.equal(job!.reason,'verified_vendor_billing_not_configured');
  assert.equal(job!.call_id,null);assert.equal(heldResourceBudget(f.walletId),0);
});
