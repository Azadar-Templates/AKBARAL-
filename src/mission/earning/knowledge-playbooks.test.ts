import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-knowledge-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'knowledge-test-session-secret-0123456789';
process.env.ZA141251SA_CREDENTIAL_KEY = 'knowledge-test-credential-key-0123456789';

import { applyMissionMigrations, missionDb } from '../database';
import { ensurePolicy } from '../policy';
import { provisionOwner } from '../auth';
import { createBountyFinding, createBountyProgram, runBountyAgent, upsertScopeAllowlist } from './bug-bounty-system';
import { KNOWLEDGE_DEFINITIONS, seedKnowledgeBase, validateKnowledgeReference } from './knowledge-catalog';
import {
  approveKnowledgeImprovement,
  listPendingImprovements,
  proposeKnowledgeImprovement,
  recordLearningEvent,
} from './knowledge-learning';
import {
  knowledgeUsageSnapshot,
  listAgentPlaybooks,
  listKnowledge,
  listPlatformPlaybooks,
  retrieveKnowledge,
} from './knowledge-retrieval';

let ownerId = '';
let programId = '';

test.before(() => {
  applyMissionMigrations();
  ensurePolicy('USD');
  ownerId = provisionOwner({ email: `knowledge-${randomUUID()}@test.invalid`, password: 'knowledge-owner-password' }).id;
  programId = String(createBountyProgram({ platform: 'KnowledgeTest', programHandle: `knowledge-${randomUUID()}`, scopeUrl: 'https://scope.invalid', programTermsHash: 'c'.repeat(64), active: true }).id);
  upsertScopeAllowlist(programId, { target: 'authorized.example', targetType: 'domain', inScope: true });
});

test.after(() => missionDb.close());

test('seeds the requested knowledge classes, provenance and all seventeen unverified platform playbooks', () => {
  const knowledge = listKnowledge();
  assert.equal(knowledge.length, KNOWLEDGE_DEFINITIONS.length);
  assert.equal(knowledge.filter((row) => row.category === 'web').length, 20);
  assert.equal(knowledge.filter((row) => row.category === 'web3').length, 20);
  assert.equal(knowledge.filter((row) => row.category === 'github').length, 4);
  assert.equal(knowledge.filter((row) => (row.commonFalsePositives as unknown[]).length > 0).length, knowledge.length);
  for (const definition of KNOWLEDGE_DEFINITIONS) for (const reference of definition.realWorldReferences) assert.equal(validateKnowledgeReference(reference), true);
  assert.ok(knowledge.every((row) => row.sourceType === 'authoritative_reference' && row.referenceStatus === 'verified'));
  const platforms = listPlatformPlaybooks();
  assert.equal(platforms.length, 17);
  assert.ok(platforms.every((row) => row.status === 'needs_owner_confirmation' && row.sourceType === 'unverified' && (row.requiredFields as unknown[]).length === 0));
  assert.equal(listAgentPlaybooks().length, 14);
});

test('adds playbooks for persisted registry roles without creating any agent records', () => {
  for (let index = 0; index < 150; index += 1) {
    const role = `registry-fixture-${index}`;
    missionDb.run("INSERT OR IGNORE INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,?,'specialist',0,'fixture','active','worker','test')", [role, role, `Synthetic registry role ${index}`]);
  }
  const before = Number(missionDb.get<{ count: number }>('SELECT COUNT(*) AS count FROM mission_agents')?.count ?? 0);
  const result = seedKnowledgeBase();
  assert.equal(result.registryPlaybooks, 150);
  assert.equal(Number(missionDb.get<{ count: number }>('SELECT COUNT(*) AS count FROM mission_agents')?.count ?? 0), before);
  assert.equal(listAgentPlaybooks().length, 164);
});

test('ranks Solidity and REST contexts, while empty retrieval falls back to a generic pass', () => {
  const solidity = retrieveKnowledge({ agentRole: 'security_auditor', language: 'Solidity', fileTypes: ['.sol'], entryPointSignals: ['oracle callback'] });
  const solidityClasses = solidity.knowledge.slice(0, 8).map((row) => row.vulnClass);
  assert.ok(solidityClasses.includes('reentrancy'));
  assert.ok(solidityClasses.includes('oracle_price_manipulation'));
  assert.ok(solidityClasses.includes('integer_overflow_precision'));
  const rest = retrieveKnowledge({ agentRole: 'security_auditor', category: 'web', language: 'REST API', framework: 'Express', entryPointSignals: ['database query', 'object id', 'URL fetch'] });
  const restClasses = rest.knowledge.slice(0, 8).map((row) => row.vulnClass);
  assert.ok(restClasses.includes('sql_injection'));
  assert.ok(restClasses.includes('idor_bola'));
  assert.ok(restClasses.includes('ssrf'));
  const empty = retrieveKnowledge({ agentRole: 'unmapped_role', category: 'infra', language: 'unknown-fictional-language' });
  assert.equal(empty.genericPass, true);
  assert.equal(empty.knowledge.length, 0);
  assert.equal(empty.trace.genericPass, true);
});

test('analysis runs consult first and persist knowledge id plus exact version in the run log', () => {
  const result = runBountyAgent({ agentType: 'code_analyst', programId, target: 'authorized.example', input: { source: 'contract Vault { function withdraw() external { (bool ok,) = msg.sender.call(""); } }', files: ['Vault.sol'], language: 'Solidity', entryPointSignals: ['external call'] } });
  assert.equal(result.status, 'done');
  const trace = result.knowledgeTrace as { knowledge: Array<{ id: string; version: number }>; genericPass: boolean };
  assert.ok(trace.knowledge.length > 0);
  assert.equal(trace.genericPass, false);
  const row = missionDb.get<{ knowledge_trace_json: string; generic_analysis_pass: number }>('SELECT knowledge_trace_json,generic_analysis_pass FROM agent_run_logs WHERE id=?', [String(result.runId)])!;
  const persisted = JSON.parse(row.knowledge_trace_json);
  assert.deepEqual(persisted.knowledge.map((item: { id: string; version: number }) => [item.id, item.version]), trace.knowledge.map((item) => [item.id, item.version]));
  assert.equal(row.generic_analysis_pass, 0);
  assert.ok(knowledgeUsageSnapshot().some((entry) => Number(entry.consultedCount) > 0));
});

test('knowledge version pinning and false-positive review block known noise but permit a clean finding', () => {
  const vector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
  assert.throws(() => createBountyFinding({ programId, target: 'authorized.example', finding: { title: 'Guarded callback', summary: 'A callback appears reentrant.', evidence: 'The function uses a nonReentrant guard modifier before its external call.', reproduction: 'Safe local harness did not reenter.', impact: 'No observed impact.', remediation: 'Retain the guard and checks-effects-interactions ordering.', vulnerabilityClass: 'reentrancy', codeLocationPattern: 'Vault.sol:10', cvssVector: vector } }), /false_positive/);
  const finding = createBountyFinding({ programId, target: 'authorized.example', finding: { title: 'Unprotected callback', summary: 'External callback can observe mutable state.', evidence: 'Vault.sol:20 updates the balance after the external call.', reproduction: 'Safe local harness observed the invariant violation.', impact: 'A caller can repeat the withdrawal in the authorized fixture.', remediation: 'Apply checks-effects-interactions and a narrowly scoped reentrancy guard.', vulnerabilityClass: 'reentrancy', codeLocationPattern: 'Vault.sol:20', cvssVector: vector, knowledgeTrace: { agentRole: 'security_auditor' } } });
  const trace = JSON.parse(String(finding.knowledge_trace_json));
  assert.ok(trace.knowledge.some((item: { id: string; version: number }) => item.id === 'vk-reentrancy' && item.version === 1));
});

test('only owner-outcome learning can propose changes, approval is required, and it affects later retrieval', () => {
  const eventId = recordLearningEvent({ source: 'owner_feedback', vulnClass: 'reentrancy', reasonCode: 'owner_fp', detail: 'Owner confirmed trusted administrator callback is a false-positive pattern.', createdBy: ownerId });
  const pending = proposeKnowledgeImprovement({ knowledgeId: 'vk-reentrancy', agentRole: 'security_auditor', changeType: 'add_false_positive', changeDetail: 'trusted administrator callback', evidenceRef: eventId });
  assert.ok(listPendingImprovements().some((row) => row.id === pending.id));
  const before = retrieveKnowledge({ agentRole: 'security_auditor', language: 'Solidity', entryPointSignals: ['callback'] }).knowledge.find((row) => row.vulnClass === 'reentrancy')!;
  assert.equal((before.approvedImprovements as unknown[]).some((row: any) => row.id === pending.id), false);
  approveKnowledgeImprovement(ownerId, String(pending.id));
  const after = retrieveKnowledge({ agentRole: 'security_auditor', language: 'Solidity', entryPointSignals: ['callback'] }).knowledge.find((row) => row.vulnClass === 'reentrancy')!;
  assert.equal((after.approvedImprovements as unknown[]).some((row: any) => row.id === pending.id), true);
  const lower = proposeKnowledgeImprovement({ knowledgeId: 'vk-reentrancy', agentRole: 'security_auditor', changeType: 'tighten_confidence_floor', changeDetail: 'confidence floor to 0.10', evidenceRef: eventId });
  assert.throws(() => approveKnowledgeImprovement(ownerId, String(lower.id)), /lower/);
});
