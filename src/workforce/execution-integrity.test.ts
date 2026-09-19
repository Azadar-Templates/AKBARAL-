import path from 'node:path';
import os from 'node:os';
process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `execution-integrity-${process.pid}.db`)}`;
import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { usableToolEvidence, verifyWorkforceDelivery } from './delivery-verification';
const { db } = require('../db') as typeof import('../db');
const { applyMigrations } = require('../db/migrate') as typeof import('../db/migrate');
const { assertOpportunityAssignment } = require('./assignment-guard') as typeof import('./assignment-guard');
const { postExecutionCostShares } = require('../economy/execution-accounting') as typeof import('../economy/execution-accounting');
const { insertOpportunity, insertExecution, insertExecutionParticipant, getExecution } = require('../db/economy-repositories') as typeof import('../db/economy-repositories');
const { startExecution } = require('../economy/operations') as typeof import('../economy/operations');
before(() => applyMigrations(db));
after(() => db.close());
it('rejects missing prerequisites anywhere in a long response, not only its preface', () => {
  for (const tail of ['I cannot finish this work.', 'Missing prerequisite: platform account access.', 'This requires owner approval.', 'The API key is not configured.']) {
    assert.equal(verifyWorkforceDelivery('Detailed draft. '.repeat(30) + tail, 2).verified, false);
  }
  assert.equal(verifyWorkforceDelivery('A usable deliverable with concrete details and a supported conclusion.', 0).verified, false);
  assert.equal(verifyWorkforceDelivery('A usable deliverable with concrete details and a supported conclusion.', 1).verified, true);
});
it('distinguishes attempted tools and empty search results from usable evidence', () => {
  const result = { tool: 'web_search', ok: true, content: '[]', data: { results: [] }, durationMs: 1 };
  assert.equal(usableToolEvidence(result), false);
  assert.equal(usableToolEvidence({ ...result, content: 'Search failed', ok: false }), false);
  assert.equal(usableToolEvidence({ ...result, content: 'A supported result', data: { results: [{ url: 'https://example.test/fixture' }] } }), true);
});
it('requires an active verified platform and dedicated account assigned to the exact agent', () => {
  db.run("INSERT INTO economy_platforms (platform_key, name, status) VALUES ('fixture-platform', 'Synthetic platform fixture', 'verified')");
  const opportunity = { platform_key: 'fixture-platform' };
  assert.throws(() => assertOpportunityAssignment(opportunity, 'fixture-agent'), /not assigned/);
  db.run("INSERT INTO economy_opportunity_assignments (id, agent_slug, platform_key, status, earning_workflow_key, assigned_by) VALUES ('fixture-binding', 'fixture-agent', 'fixture-platform', 'pending_account', 'research:v1', 'test')");
  assert.throws(() => assertOpportunityAssignment(opportunity, 'fixture-agent'), /inactive/);
  db.run("UPDATE economy_opportunity_assignments SET status = 'active', dedicated_account_property_id = 'synthetic-property' WHERE id = 'fixture-binding'");
  assert.doesNotThrow(() => assertOpportunityAssignment(opportunity, 'fixture-agent'));
  assert.throws(() => assertOpportunityAssignment(opportunity, 'other-agent'), /not assigned/);
  db.run("UPDATE economy_platforms SET status = 'candidate' WHERE platform_key = 'fixture-platform'");
  assert.throws(() => assertOpportunityAssignment(opportunity, 'fixture-agent'), /not verified/);
  const row = insertOpportunity({ sourceUrlHash: 'integrity-platform', sourceUrl: 'https://example.test/fixture', title: 'Synthetic fixture', category: 'research', platformKey: 'fixture-platform', expectedRevenueCents: 0, expectedCostCents: 0, timeHours: 1, riskLevel: 'low', probability: 0 });
  assert.throws(() => startExecution({ opportunityId: row.id, agentSlug: 'other-agent', authorizedBy: 'owner' }), /not assigned/);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_executions')!.n, 0);
});
it('allocates every cent deterministically, is replay-safe, and accounts for distinct attempts', () => {
  const opportunity = insertOpportunity({ sourceUrlHash: 'integrity-cost', sourceUrl: 'https://example.test/cost', title: 'Synthetic cost fixture', category: 'research', expectedRevenueCents: 0, expectedCostCents: 0, timeHours: 1, riskLevel: 'low', probability: 0 });
  const row = insertExecution({ opportunityId: opportunity.id, agentSlug: 'fixture-lead', timeoutMs: 100 });
  for (const slug of ['fixture-b', 'fixture-a', 'fixture-c']) insertExecutionParticipant({ executionId: row.id, agentSlug: slug, role: 'collaborator', costShareCents: 0 });
  const execution = getExecution(row.id)!;
  postExecutionCostShares(execution, 5);
  postExecutionCostShares(execution, 5);
  const amounts = db.all<{ amount_cents: number }>('SELECT amount_cents FROM economy_ledger ORDER BY agent_slug').map(row => Number(row.amount_cents));
  assert.deepEqual(amounts, [2, 2, 1]);
  assert.deepEqual(db.all<{ cost_share_cents: number }>('SELECT cost_share_cents FROM economy_execution_participants ORDER BY agent_slug').map(row => Number(row.cost_share_cents)), [2, 2, 1]);
  postExecutionCostShares({ ...execution, attempts: 1 }, 1);
  assert.equal(Number(db.get<{ n: number }>('SELECT SUM(amount_cents) AS n FROM economy_ledger')!.n), 6);
});

it('unverified work records incurred cost but no expected revenue; late revocation prevents delivery', async () => {
  const { syncAgentRegistry } = require('../agents/registry') as typeof import('../agents/registry');
  const { modelRouter } = require('../models/router') as typeof import('../models/router');
  const { TOOL_HANDLERS } = require('../tools/registry') as typeof import('../tools/registry');
  const { runWorkforceExecution } = require('./execution') as typeof import('./execution');
  const { updateEconomyPolicy } = require('../db/economy-repositories') as typeof import('../db/economy-repositories');
  syncAgentRegistry();
  const originalModel = modelRouter.complete;
  const originals = { ...TOOL_HANDLERS };
  const run = async (key: string) => {
    const opportunity = insertOpportunity({ sourceUrlHash: key, sourceUrl: 'https://example.test/integrity', title: 'Synthetic integrity work', category: 'research', expectedRevenueCents: 1000, expectedCostCents: 10, timeHours: 1, riskLevel: 'low', probability: 1 });
    const execution = startExecution({ opportunityId: opportunity.id, agentSlug: 'web-research-001', authorizedBy: 'owner' });
    return { outcome: await runWorkforceExecution(execution.executionId), executionId: execution.executionId, opportunityId: opportunity.id };
  };
  try {
    for (const tool of Object.keys(TOOL_HANDLERS)) TOOL_HANDLERS[tool] = async () => ({ tool, ok: true, content: 'Synthetic supporting tool context for tests only.', durationMs: 1 });
    modelRouter.complete = (async () => ({ model: 'synthetic-test', provider: 'fixture', latencyMs: 1, text: 'Detailed draft. '.repeat(30) + 'Missing prerequisite: platform account access.', usage: { costCents: 5 } })) as typeof modelRouter.complete;
    const incomplete = await run('incomplete-output');
    assert.equal(incomplete.outcome.status, 'failed');
    assert.equal(incomplete.outcome.verified, false);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_revenue WHERE opportunity_id = ?', [incomplete.opportunityId])!.n, 0);
    assert.equal(Number(db.get<{ amount_cents: number }>('SELECT amount_cents FROM economy_ledger WHERE ref_id = ?', [`exec:${incomplete.executionId}:api_cost`])!.amount_cents), 5);
    modelRouter.complete = (async () => {
      updateEconomyPolicy({ freeze_spending: 1 });
      return { model: 'synthetic-test', provider: 'fixture', latencyMs: 1, text: 'A sufficiently detailed synthetic deliverable, supported by synthetic tool context.', usage: { costCents: 7 } };
    }) as typeof modelRouter.complete;
    const revoked = await run('late-freeze');
    assert.equal(revoked.outcome.status, 'cancelled');
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_deliveries WHERE execution_id = ?', [revoked.executionId])!.n, 0);
    assert.equal(Number(db.get<{ amount_cents: number }>('SELECT amount_cents FROM economy_ledger WHERE ref_id = ?', [`exec:${revoked.executionId}:api_cost`])!.amount_cents), 7, 'incurred cost survives revocation');
    assert.equal(getExecution(revoked.executionId)!.cost_cents, 7);
    await assert.rejects(() => runWorkforceExecution(revoked.executionId), /not runnable/);
  } finally {
    modelRouter.complete = originalModel;
    Object.assign(TOOL_HANDLERS, originals);
    updateEconomyPolicy({ freeze_spending: 0 });
  }
});

it('persists the authorized property and prevents silent repointing before dispatch', async () => {
  const { runExecution, reassignExecution } = require('../economy/operations') as typeof import('../economy/operations');
  const { modelRouter } = require('../models/router') as typeof import('../models/router');
  const original = modelRouter.complete;
  let modelCalls = 0;
  try {
    modelRouter.complete = async () => { modelCalls += 1; throw new Error('must not call provider'); };
    db.run("UPDATE economy_platforms SET status = 'verified' WHERE platform_key = 'fixture-platform'");
    db.run("UPDATE economy_opportunity_assignments SET agent_slug = 'web-research-001', dedicated_account_property_id = 'original-property' WHERE id = 'fixture-binding'");
    const opportunity = insertOpportunity({ sourceUrlHash: 'binding-snapshot', sourceUrl: 'https://example.test/snapshot', title: 'Synthetic binding fixture', platformKey: 'fixture-platform', category: 'research', expectedRevenueCents: 0, expectedCostCents: 0, timeHours: 1, riskLevel: 'low', probability: 0 });
    const execution = startExecution({ opportunityId: opportunity.id, agentSlug: 'web-research-001', authorizedBy: 'owner' });
    assert.match(getExecution(execution.executionId)!.verification_json!, /original-property/);
    db.run("UPDATE economy_opportunity_assignments SET dedicated_account_property_id = 'repointed-property' WHERE id = 'fixture-binding'");
    const result = await runExecution(execution.executionId);
    assert.equal(result.status, 'cancelled');
    assert.match(result.error!, /binding changed/);
    assert.equal(modelCalls, 0, 'legacy entry point obeys the same runtime snapshot gate');
    const next = startExecution({ opportunityId: opportunity.id, agentSlug: 'web-research-001', authorizedBy: 'owner' });
    reassignExecution(next.executionId, 'web-research-001', 'explicit owner reauthorization fixture', 'test');
    assert.match(getExecution(next.executionId)!.verification_json!, /repointed-property/);
  } finally { modelRouter.complete = original; }
});
