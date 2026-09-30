import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { updateEconomyPolicy } from '../db/economy-repositories';
import { activationStageReport } from './activation-stage';

/**
 * Controlled activation-stage model — every stage count must be a real,
 * verifiable query result, never inferred or inflated.
 */

const suffix = randomBytes(6).toString('hex');

function cleanup(): void {
  db.run(`DELETE FROM economy_revenue WHERE opportunity_id LIKE ?`, [`act-opp-%${suffix}`]);
  db.run(`DELETE FROM economy_executions WHERE opportunity_id LIKE ?`, [`act-opp-%${suffix}`]);
  db.run(`DELETE FROM economy_opportunities WHERE id LIKE ?`, [`act-opp-%${suffix}`]);
  db.run(`DELETE FROM economy_opportunity_assignments WHERE platform_key LIKE ?`, [`act-plat-%${suffix}`]);
  db.run(`DELETE FROM economy_platforms WHERE platform_key LIKE ?`, [`act-plat-%${suffix}`]);
}

before(() => {
  applyMigrations(db);
  updateEconomyPolicy({ autonomous_enabled: 0, kill_switch: 0, max_concurrent_executions: 2 } as never);
});

beforeEach(() => {
  cleanup();
});

describe('activation-stage report: real counts, honest defaults', () => {
  it('stage 0 (registered) always equals the live agent registry count', () => {
    const report = activationStageReport();
    const registered = db.get<{ total: number }>('SELECT COUNT(*) AS total FROM agents');
    assert.equal(report.counts.stage0Registered, Number(registered?.total ?? 0));
  });

  it('stage 1 (policy-eligible) is honestly 0 while autonomy is disabled — not a bug, the safety default', () => {
    updateEconomyPolicy({ autonomous_enabled: 0 } as never);
    const report = activationStageReport();
    assert.equal(report.counts.stage1PolicyEligible, 0);
    assert.equal(report.policy.autonomousEnabled, false);
  });

  it('stage 2 (assigned) counts only ACTIVE 1:1 platform assignments, never candidates/pending', () => {
    const platformKey = `act-plat-1-${suffix}`;
    db.run(
      `INSERT INTO economy_platforms (platform_key, name, status) VALUES (?, ?, 'verified')`,
      [platformKey, `Activation Test Platform ${suffix}`],
    );
    const before1 = activationStageReport().counts.stage2Assigned;
    db.run(
      `INSERT INTO economy_opportunity_assignments (id, agent_slug, platform_key, status, assigned_by)
       VALUES (?, ?, ?, 'pending_account', 'test')`,
      [`act-assign-pending-${suffix}`, `agent-pending-${suffix}`, platformKey],
    );
    assert.equal(activationStageReport().counts.stage2Assigned, before1, 'pending_account is not counted');

    db.run(`UPDATE economy_opportunity_assignments SET status = 'active' WHERE platform_key = ?`, [platformKey]);
    const after = activationStageReport();
    assert.equal(after.counts.stage2Assigned, before1 + 1, 'active assignment is counted exactly once');
    assert.ok(after.assignedAgents.includes(`agent-pending-${suffix}`));
  });

  it('stage 3 (verified work) requires status=completed AND a non-empty verification_json', () => {
    const opportunityId = `act-opp-1-${suffix}`;
    const agentSlug = `agent-work-${suffix}`;
    db.run(
      `INSERT INTO economy_opportunities (id, source_url_hash, source_url, title, category, status) VALUES (?, ?, ?, 'test opp', 'research_and_analysis', 'completed')`,
      [opportunityId, `act-hash-1-${suffix}`, `https://example.test/act-1-${suffix}`],
    );
    db.run(
      `INSERT INTO economy_executions (id, opportunity_id, agent_slug, idempotency_key, status, verification_json)
       VALUES (?, ?, ?, ?, 'completed', NULL)`,
      [`act-exec-unverified-${suffix}`, opportunityId, agentSlug, `act-idem-unverified-${suffix}`],
    );
    const withoutVerification = activationStageReport();
    assert.ok(!withoutVerification.settledAgents.includes(agentSlug));

    db.run(`UPDATE economy_executions SET verification_json = ? WHERE id = ?`, [
      JSON.stringify({ verifiedBy: 'test', ok: true }),
      `act-exec-unverified-${suffix}`,
    ]);
    const withVerification = activationStageReport();
    assert.ok(withVerification.counts.stage3VerifiedWork >= 1);
  });

  it('stage 4 (settled) requires received/settled revenue WITH both evidence AND external_ref — a bare claim never counts', () => {
    const opportunityId = `act-opp-2-${suffix}`;
    const agentSlug = `agent-settled-${suffix}`;
    db.run(
      `INSERT INTO economy_opportunities (id, source_url_hash, source_url, title, category, status) VALUES (?, ?, ?, 'test opp 2', 'research_and_analysis', 'completed')`,
      [opportunityId, `act-hash-2-${suffix}`, `https://example.test/act-2-${suffix}`],
    );
    db.run(
      `INSERT INTO economy_executions (id, opportunity_id, agent_slug, idempotency_key, status, verification_json)
       VALUES (?, ?, ?, ?, 'completed', ?)`,
      [`act-exec-settled-${suffix}`, opportunityId, agentSlug, `act-idem-settled-${suffix}`, JSON.stringify({ ok: true })],
    );
    db.run(
      `INSERT INTO economy_revenue (id, opportunity_id, state, amount_cents, evidence, external_ref)
       VALUES (?, ?, 'received', 500, NULL, NULL)`,
      [`act-rev-no-evidence-${suffix}`, opportunityId],
    );
    const noEvidence = activationStageReport();
    assert.ok(!noEvidence.settledAgents.includes(agentSlug), 'revenue without evidence/external_ref must never count as settled');

    db.run(
      `UPDATE economy_revenue SET evidence = ?, external_ref = ? WHERE id = ?`,
      ['real provider statement line', 'ext-ref-123', `act-rev-no-evidence-${suffix}`],
    );
    const withEvidence = activationStageReport();
    assert.ok(withEvidence.settledAgents.includes(agentSlug), 'revenue with real evidence + external ref counts');
    assert.ok(withEvidence.counts.stage4Settled >= 1);
  });

  it('stage 5 (expansion-ready) is false until at least one real settlement exists', () => {
    updateEconomyPolicy({ max_concurrent_executions: 2 } as never);
    // No settlements from this describe block's isolated cleanup state guarantee
    // stage4=0 is possible in a clean DB, but other suites may have inserted
    // real-looking fixtures; assert the logical implication instead of an
    // absolute count.
    const report = activationStageReport();
    if (report.counts.stage4Settled === 0) {
      assert.equal(report.stage5ExpansionReady, false);
      assert.match(report.stage5Reason, /no agent has reached Stage 4/);
    } else {
      assert.equal(typeof report.stage5ExpansionReady, 'boolean');
    }
  });

  it('never fabricates: honesty note is present and counts are internally consistent', () => {
    const report = activationStageReport();
    assert.ok(report.honesty.note.length > 0);
    assert.ok(report.counts.stage2Assigned >= report.assignedAgents.length - 0); // exact by construction
    assert.equal(report.counts.stage2Assigned, report.assignedAgents.length);
    assert.equal(report.counts.stage4Settled, report.settledAgents.length);
    assert.ok(report.counts.stage0Registered >= report.counts.stage1PolicyEligible);
  });
});
