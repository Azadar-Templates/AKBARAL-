import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `admission-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'synthetic-admission-tests-not-live';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { missionDb as db, applyMissionMigrations, type Row } from '../database';
import { provisionOwner } from '../auth';
import { updatePolicy, setKillSwitch } from '../policy';
import * as Engine from './earning-engine';
import {
  admissionCeiling, allocateBatch, candidateAgentsFor, maxConcurrentWorkPerAgent, candidatePoolSize,
  MAX_ITEMS_PER_CYCLE, ensureCatalogPersisted,
} from './workload-allocator';

const keepAlive = setInterval(() => {}, 1000);
let ownerId = '';
const seed = randomUUID().slice(0, 8);

function agent(slug: string, capabilities: string[]): string {
  const id = `agt-adm-${slug}-${randomUUID().slice(0, 8)}`;
  // Slugs are ordered lexically by the candidate query, so the fixtures sort first and
  // stay inside the scanned window no matter how large the materialized registry is.
  db.run(
    "INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'registry','active','worker','akbaral-registry',?)",
    [id, `0000-${seed}-${slug}`, `Admission ${slug}`, 'specialist', JSON.stringify(capabilities)],
  );
  return id;
}

function opportunity(index: number): Row {
  return Engine.discoverOpportunity({
    registryKey: 'software_development', provider: `OSS Program ${seed}-${index}`, platform: 'GitHub',
    grossCents: 10000 + index, expectedFeesCents: 0, expectedCostsCents: 0,
    paymentMethod: 'bounty payout', settlementEvidence: 'awaiting maintainer merge',
    opportunityExpiry: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    evidenceJson: { brief: `issue ${index}` },
  }) as Row;
}

/** Set an env var for one call and put the process env back exactly as it was. */
function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const previous = Object.prototype.hasOwnProperty.call(process.env, name) ? { value: process.env[name] } : null;
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (previous === null) delete process.env[name]; else process.env[name] = previous.value;
  }
}

before(() => {
  applyMissionMigrations();
  const owner = provisionOwner({ email: 'adm-owner@example.test', password: 'StrongPass!123', displayName: 'Admission Owner' }) as { id?: string; owner?: { id: string } };
  ownerId = String(owner.id ?? owner.owner?.id ?? 'adm-owner');
  agent('coder', ['coding', 'reasoning', 'test_generator']);
  agent('writer', ['writing', 'content_production']);
});

beforeEach(() => {
  setKillSwitch(false, ownerId);
  updatePolicy({ currency: 'USD', killSwitch: false, autonomousEnabled: true, maxAgents: 5000, maxDailySpendCents: 100000, maxExpenseCents: 10000, requireApprovalAboveCents: 5000 } as never, ownerId);
  for (const table of ['mission_earning_engine_opportunities', 'mission_allocator_assignments', 'mission_result_verifications', 'mission_execution_evidence']) {
    try { db.run(`DELETE FROM ${table}`); } catch { /* nothing yet */ }
  }
});

after(() => { try { db.close(); } finally { clearInterval(keepAlive); } });

it('admission is bounded by real eligible work, not by an arbitrary 50', () => {
  assert.equal(admissionCeiling().cycleLimit, 0);
  assert.equal(admissionCeiling().reason, 'no_eligible_work');
  for (let i = 0; i < 61; i += 1) opportunity(i);
  const ceiling = admissionCeiling();
  assert.equal(ceiling.pendingEligible, 61);
  assert.equal(ceiling.throttle, null);
  assert.equal(ceiling.cycleLimit, 61, 'every eligible item is admitted in one cycle');
  assert.equal(ceiling.reason, 'all_eligible_admitted');
  const batch = allocateBatch();
  assert.equal(batch.length, 61, 'the historical Math.min(50, …) lid is gone');
  assert.ok(allocateBatch(7).length === 7, 'an explicit smaller batch is still honored');
});

it('an operator throttle and an anti-runaway bound are the only lids', () => {
  for (let i = 0; i < 12; i += 1) opportunity(i);
  const throttled = withEnv('ZA141251SA_MAX_AGENTS_PER_CYCLE', '5', () => ({ ceiling: admissionCeiling(), batch: allocateBatch() }));
  assert.equal(throttled.ceiling.cycleLimit, 5);
  assert.equal(throttled.ceiling.reason, 'operator_throttle_5');
  assert.equal(throttled.batch.length, 5, 'the operator throttle, when set, is what the cycle walks');
  const bad = withEnv('ZA141251SA_MAX_AGENTS_PER_CYCLE', '0', () => admissionCeiling());
  assert.equal(bad.throttle, null, '0 means no throttle, not "nothing"');
  assert.ok(MAX_ITEMS_PER_CYCLE >= 1000, 'documented anti-runaway bound');
});

it('the kill switch still stops admission', () => {
  opportunity(0);
  setKillSwitch(true, ownerId);
  const ceiling = admissionCeiling();
  assert.equal(ceiling.cycleLimit, 0);
  assert.equal(ceiling.reason, 'kill_switch_engaged');
  assert.deepEqual(allocateBatch(), []);
  setKillSwitch(false, ownerId);
  assert.equal(allocateBatch().length, 1);
});

it('candidates are filtered by capability and by how much each agent already holds', () => {
  const opp = opportunity(500);
  const required = { required_capabilities_json: '["coding"]', required_tools_json: '["test_generator"]' };
  db.run('UPDATE mission_earning_engine_opportunities SET required_capabilities_json=?, required_tools_json=? WHERE id=?',
    [required.required_capabilities_json, required.required_tools_json, String(opp.id)]);
  const refreshed = Engine.getEngineOpportunity(String(opp.id))!;
  const pool = candidateAgentsFor(refreshed, 2000);
  assert.ok(pool.length >= 1);
  assert.ok(pool.every(r => String(r.capabilities).includes('coding')), 'only agents whose persisted tags match are scanned');
  assert.ok(pool.some(r => String(r.slug).endsWith('-coder')));
  assert.ok(!pool.some(r => String(r.slug).endsWith('-writer')), 'a non-matching specialist is not scanned for this job');

  // Fill the coder's work slots, then it must drop out of the candidate pool.
  const coderId = String(pool.find(r => String(r.slug).endsWith('-coder'))!.id);
  const cap = maxConcurrentWorkPerAgent();
  for (let i = 0; i < cap; i += 1) {
    const busy = opportunity(600 + i);
    db.run("UPDATE mission_earning_engine_opportunities SET exclusive_agent_id=?, verification_state='executing' WHERE id=?", [coderId, String(busy.id)]);
  }
  const after = candidateAgentsFor(refreshed, 2000);
  assert.ok(!after.some(r => String(r.id) === coderId), 'a saturated agent stops being a candidate');
  assert.equal(candidatePoolSize(), 200, 'default pool size keeps one pass linear in matches');
});

it('a materialized 4,001-agent registry admits nothing without verified work, and one item with it', () => {
  const persisted = ensureCatalogPersisted();
  assert.ok(persisted >= 4000, `the 4,001+ registry is present in the mission DB (${persisted})`);
  assert.equal(admissionCeiling().cycleLimit, 0, 'thousands of agents, zero eligible work → zero admitted');
  assert.deepEqual(allocateBatch(), []);
  opportunity(900);
  assert.equal(admissionCeiling().cycleLimit, 1, 'exactly the one real opportunity is admitted');
  assert.equal(allocateBatch().length, 1);
});
