import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { countAgentProfiles, getEconomyPolicy, updateEconomyPolicy, upsertAgentProfile } from '../db/economy-repositories';
import { currentPolicy, POLICY_INT_RANGES } from './policy';
import { evaluateSpawn } from './hierarchy';

describe('D9 delegation policy at 4,001-agent scale (spending still governed)', () => {
  before(() => {
    applyMigrations(db);
    // Shipped money-governance values, stated explicitly so later suites inherit truth.
    updateEconomyPolicy({
      autonomous_enabled: 0, kill_switch: 0, discovery_enabled: 0,
      max_daily_spend_cents: 500, max_opportunity_cost_cents: 200,
      spawn_cost_cents: 50, spawn_rate_per_hour: 6,
    } as never);
  });

  it('fresh policy rows start at the 4,001-scale cap (and the original row is restored)', () => {
    const saved = db.get<Record<string, unknown>>('SELECT * FROM economy_policy WHERE id = ?', ['global'])!;
    try {
      db.run("DELETE FROM economy_policy WHERE id = 'global'");
      const fresh = getEconomyPolicy();
      assert.equal(fresh.max_economy_agents, 5000);
      assert.equal(fresh.autonomous_enabled, 0, 'fresh rows must not enable autonomy');
      assert.equal(fresh.discovery_enabled, 0, 'fresh rows must not enable discovery');
    } finally {
      db.run("DELETE FROM economy_policy WHERE id = 'global'");
      const cols = Object.keys(saved);
      db.run(`INSERT INTO economy_policy (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map((c) => saved[c] as null | number | string));
    }
    assert.deepEqual(
      db.get<Record<string, unknown>>('SELECT * FROM economy_policy WHERE id = ?', ['global']),
      saved,
    );
  });

  it('migrated policy carries the scale cap (owner-tuned caps are never overwritten)', () => {
    const row = getEconomyPolicy();
    assert.ok(row.max_economy_agents >= 4001, `cap must cover the registry, got ${row.max_economy_agents}`);
  });

  it('the cap gate passes registry-scale counts and still refuses beyond the cap', () => {
    const stamp = Date.now();
    const slugs: string[] = [];
    try {
      for (let i = 0; i < 60; i += 1) {
        const slug = `d9scale-${stamp}-${i}`;
        slugs.push(slug);
        upsertAgentProfile({ agentSlug: slug });
      }
      assert.ok(countAgentProfiles() > 50, 'test setup must exceed the OLD cap');
      const base = currentPolicy();
      const oldCap = evaluateSpawn({ initiatedBy: 'owner', policy: { ...base, maxEconomyAgents: 50 } });
      assert.equal(oldCap.allowed, false);
      assert.equal(oldCap.failedGate, 'total_agent_cap');
      const newCap = evaluateSpawn({ initiatedBy: 'owner', policy: { ...base, maxEconomyAgents: 5000 } });
      assert.equal(newCap.allowed, true, `owner spawn must pass at scale cap: ${newCap.reason} (${newCap.reasonDetail})`);
    } finally {
      db.run(`DELETE FROM economy_agent_profiles WHERE agent_slug LIKE 'd9scale-${stamp}-%'`);
    }
  });

  it('agent-initiated spawns with no budget are STILL refused (money governance preserved)', () => {
    const parent = `d9parent-${Date.now()}`;
    try {
      upsertAgentProfile({ agentSlug: parent }); // budget 0 — nothing funded
      const decision = evaluateSpawn({
        parentAgentSlug: parent, initiatedBy: 'agent',
        policy: { ...currentPolicy(), maxEconomyAgents: 5000 },
      });
      assert.equal(decision.allowed, false);
      assert.equal(decision.failedGate, 'budget');
      assert.equal(decision.reason, 'parent budget exhausted');
      assert.equal(decision.costCents, 50, 'spawn cost is still charged, not waived');
    } finally {
      db.run('DELETE FROM economy_agent_profiles WHERE agent_slug = ?', [parent]);
    }
  });

  it('money gates keep shipped values; only the count ceiling moved', () => {
    const policy = currentPolicy();
    assert.equal(policy.spawnCostCents, 50);
    assert.equal(policy.maxDailySpendCents, 500);
    assert.equal(policy.maxOpportunityCostCents, 200);
    assert.equal(policy.spawnRatePerHour, 6);
    const ranges = new Map(POLICY_INT_RANGES.map(([field, min, max]) => [field, { min, max }]));
    assert.deepEqual(ranges.get('max_economy_agents'), { min: 1, max: 10_000 });
    assert.deepEqual(ranges.get('spawn_cost_cents'), { min: 0, max: 100_000 });
    assert.deepEqual(ranges.get('max_daily_spend_cents'), { min: 0, max: 100_000 });
    assert.deepEqual(ranges.get('spawn_rate_per_hour'), { min: 0, max: 1_000 });
  });

  it('autonomy stays OFF (scale preparation enables no spending)', () => {
    const policy = currentPolicy();
    assert.equal(policy.autonomousEnabled, false);
    assert.equal(policy.discoveryEnabled, false);
    assert.equal(policy.killSwitch, false);
  });
});
