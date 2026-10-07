import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-model-platform-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'model-platform-test-session-secret-0123456789';
process.env.ZA141251SA_CREDENTIAL_KEY = 'model-platform-test-credential-key-0123456789';

import { applyMissionMigrations, missionDb } from '../database';
import { ensurePolicy } from '../policy';
import { provisionOwner } from '../auth';
import { storeCredential } from '../self-management';
import { createBountyProgram, upsertScopeAllowlist, runBountyAgent } from './bug-bounty-system';
import {
  createModelProvider, createMissionModelClient, listModelProviders, modelCallObservability, setModelSpendCap,
} from './model-layer';
import { adapterFor, listPlatformAdapters, platformAdapterReadOnlyProof, savePlatformAllocation } from './platform-adapters';
import {
  buildPlatformSubmissionPayload, lessonsSnapshot, recordPlatformFeedback, reputationForProgram, saveQualityPolicy, validateFindingForSubmission,
} from './discipline-engine';
import { createBountyFinding } from './bug-bounty-system';

let ownerId = '';
let programId = '';

const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

test.before(() => {
  applyMissionMigrations();
  ensurePolicy('USD');
  ownerId = provisionOwner({ email: `model-${randomUUID()}@test.invalid`, password: 'model-platform-owner-password' }).id;
  programId = String(createBountyProgram({ platform: 'ModelTest', programHandle: `model-${randomUUID()}`, scopeUrl: 'https://scope.invalid', programTermsHash: 'b'.repeat(64), active: true }).id);
  upsertScopeAllowlist(programId, { target: 'authorized.example', targetType: 'domain', inScope: true, authRequired: false });
  upsertScopeAllowlist(programId, { target: 'blocked.example', targetType: 'domain', inScope: false, authRequired: false });
});

test.after(() => missionDb.close());

test('registers eight provider records and all seventeen read-only adapters without secrets or targets', () => {
  assert.equal(listModelProviders().length, 8);
  assert.equal(listPlatformAdapters().length, 17);
  assert.equal(platformAdapterReadOnlyProof().submitCapability, 'none');
  for (const row of listModelProviders()) {
    assert.match(String(row.credentialVaultKey), /^model\./);
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'ciphertext'), false);
  }
});

test('model provider fallback is scope-gated, logged, and returns only actual token usage', async () => {
  const first = createModelProvider({ providerKey: `test-first-${randomUUID()}`, displayName: 'Test first', baseUrl: 'https://first.invalid/v1', credentialVaultKey: 'model.test.first', modelsAvailable: ['first'], defaultModel: 'first', priority: 1, costPer1kIn: 1, costPer1kOut: 1, enabled: true, supportsJsonSchema: true }, ownerId);
  const second = createModelProvider({ providerKey: `test-second-${randomUUID()}`, displayName: 'Test second', baseUrl: 'https://second.invalid/v1', credentialVaultKey: 'model.test.second', modelsAvailable: ['second'], defaultModel: 'second', priority: 2, costPer1kIn: 1, costPer1kOut: 1, enabled: true, supportsJsonSchema: true }, ownerId);
  storeCredential({ provider: String(first.providerKey), label: 'test first vault metadata', envVar: 'model.test.first', secret: 'first-secret-value', actorId: ownerId });
  storeCredential({ provider: String(second.providerKey), label: 'test second vault metadata', envVar: 'model.test.second', secret: 'second-secret-value', actorId: ownerId });
  setModelSpendCap('global', 100000, 'lifetime', ownerId);
  const calls: string[] = [];
  const client = createMissionModelClient({ retryBaseMs: 0, transport: { fetch: async (url) => { calls.push(String(url)); if (String(url).includes('first')) return response({ error: 'provider outage' }, 500); return response({ choices: [{ message: { content: 'verified model response' } }], usage: { prompt_tokens: 4, completion_tokens: 6 } }); }, sleep: async () => {} } });
  const result = await client.generate({ messages: [{ role: 'user', content: 'scope-safe request' }], scope: { programId, target: 'authorized.example' } });
  assert.equal(result.text, 'verified model response');
  assert.deepEqual([result.inputTokens, result.outputTokens], [4, 6]);
  assert.ok(calls.length >= 2);
  assert.ok(modelCallObservability().some((row) => row.status === 'fallback'));
  const before = calls.length;
  await assert.rejects(() => client.generate({ model: 'second', messages: [{ role: 'user', content: 'blocked' }], scope: { programId, target: 'blocked.example' } }), /scope|authorized/);
  assert.equal(calls.length, before, 'out-of-scope model request never calls transport');
});

test('structured calls fail closed instead of falling back to a provider without schema support', async () => {
  const provider = createModelProvider({ providerKey: `schema-${randomUUID()}`, displayName: 'Schema test', baseUrl: 'https://schema.invalid/v1', credentialVaultKey: 'model.schema.test', modelsAvailable: ['schema'], defaultModel: 'schema', priority: 1, enabled: true, supportsJsonSchema: false }, ownerId);
  storeCredential({ provider: String(provider.providerKey), label: 'schema test metadata', envVar: 'model.schema.test', secret: 'schema-secret-value', actorId: ownerId });
  const client = createMissionModelClient({ transport: { fetch: async () => response({ choices: [], usage: {} }) } });
  await assert.rejects(() => client.generateStructured({ model: 'schema', messages: [{ role: 'user', content: 'structured' }], jsonSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }, scope: { programId, target: 'authorized.example' } }), /schema/);
});

test('paid model calls fail closed when the owner cap is breached', async () => {
  setModelSpendCap('global', 0, 'lifetime', ownerId);
  const provider = createModelProvider({ providerKey: `cap-${randomUUID()}`, displayName: 'Cap test', baseUrl: 'https://cap.invalid/v1', credentialVaultKey: 'model.cap.test', modelsAvailable: ['cap'], defaultModel: 'cap', priority: 1, costPer1kIn: 10, costPer1kOut: 10, enabled: true, supportsJsonSchema: true }, ownerId);
  storeCredential({ provider: String(provider.providerKey), label: 'cap test metadata', envVar: 'model.cap.test', secret: 'cap-secret-value', actorId: ownerId });
  const client = createMissionModelClient({ transport: { fetch: async () => response({ choices: [], usage: {} }) } });
  await assert.rejects(() => client.generate({ model: 'cap', messages: [{ role: 'user', content: 'paid' }], scope: { programId, target: 'authorized.example' } }), /spend cap/);
});

test('every adapter returns an honest typed status and never offers an outbound submission', async () => {
  for (const row of listPlatformAdapters()) {
    const result = await adapterFor(String(row.platformKey)).discoverPrograms({ programId, target: 'authorized.example' });
    assert.ok(['unavailable', 'auth_required', 'not_implemented', 'ok'].includes(result.status));
    assert.notEqual(result.status, 'ok', `${row.platformKey} must not fabricate public data`);
    const invalid = adapterFor(String(row.platformKey)).buildSubmissionPayload({ title: 'weak' }, { programId, target: 'authorized.example' });
    assert.equal(invalid.status, 'not_ready');
  }
});

test('discipline requires a policy, blocks weak findings, and raises risk on platform feedback', () => {
  const finding = createBountyFinding({ programId, target: 'authorized.example', finding: { title: 'Evidence-complete issue', summary: 'Observed unsafe behavior.', evidence: 'attached evidence', reproduction: 'safe local reproduction', impact: 'security impact', remediation: 'Use context-aware output encoding.', vulnerabilityClass: 'xss', codeLocationPattern: 'src/view.ts:1', cvssVector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', cvssJustification: 'fully justified' } });
  assert.equal(validateFindingForSubmission({ findingId: String(finding.id), platformKey: 'hackerone' }).ready, false);
  assert.ok(lessonsSnapshot().some((lesson) => lesson.reasonCode === 'missing_policy'));
  saveQualityPolicy({ programId, minConfidenceThreshold: 0.5, maxSubmissionsPerWeek: 2, minCvssForSubmit: 7 }, ownerId);
  const result = validateFindingForSubmission({ findingId: String(finding.id), platformKey: 'hackerone' });
  assert.equal(result.ready, true);
  const payload = buildPlatformSubmissionPayload({ findingId: String(finding.id), platformKey: 'hackerone' });
  assert.equal(payload.submitted, false);
  recordPlatformFeedback({ programId, findingId: String(finding.id), platformKey: 'hackerone', outcome: 'rejected_duplicate', detail: 'owner-supplied platform feedback' }, ownerId);
  assert.equal(reputationForProgram(programId)?.riskLevel, 'caution');
});

test('allocation is explicit and unallocated platform runs are blocked', () => {
  assert.throws(() => runBountyAgent({ agentType: 'security_auditor', platformKey: 'hackerone', programId, target: 'authorized.example', input: { source: 'const safe = true;' } }), /not allocated/);
  const saved = savePlatformAllocation({ platformKey: 'hackerone', agentType: 'security_auditor', concurrency: 1, priority: 1, strategy: 'web/API research' }, ownerId);
  assert.equal(String(saved.platform_key), 'hackerone');
});
