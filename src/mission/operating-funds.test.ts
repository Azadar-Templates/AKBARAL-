/** Disposable database. No real money, no provider calls, no synthetic revenue claims. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `operating-funds-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'fixture-only-operating-funds-session';
process.env.ZA141251SA_CREDENTIAL_KEY = 'fixture-only-operating-funds-credential-key';
// The single-identity lockdown stays ENFORCED, bound to this fixture's owner.
process.env.ZA141251SA_OWNER_EMAIL = 'funding-owner@mission.test';

import { before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { missionDb, applyMissionMigrations, missionId, nowIso } from './database';
import {
  MissionFundingError,
  approveOperatingBudget,
  assertSpendingUnlocked,
  fundingPosture,
  listBlockedResources,
  markBlockedResourceUnblocked,
  reinvestmentPlan,
  requestPaidResource,
  revokeOperatingBudget,
  verifiedRevenueCents,
} from './operating-funds';

const OWNER = 'own_funding_fixture';
const AGENT = 'agt_funding_fixture';

function addRevenue(amountCents: number, options: { verified: boolean; received?: boolean } = { verified: true }): void {
  missionDb.run(
    `INSERT INTO mission_revenue (id, agent_id, amount_cents, currency, source, status, idempotency_key, verifier, received_at)
     VALUES (?, ?, ?, 'USD', 'client', ?, ?, ?, ?)`,
    [
      missionId('rev'),
      AGENT,
      amountCents,
      options.received === false ? 'expected' : 'received',
      `fixture-${randomUUID()}`,
      options.verified ? 'provider-webhook' : null,
      options.received === false ? null : nowIso(),
    ],
  );
}

before(() => {
  applyMissionMigrations();
  missionDb.run(
    "INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'funding-owner@mission.test','fixture','owner','active')",
    [OWNER],
  );
  missionDb.run(
    `INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform)
     VALUES (?, 'funding-fixture-agent', 'Funding fixture agent', 'specialist', 0, 'custom', 'active', 'worker', 'fixture')`,
    [AGENT],
  );
});

beforeEach(() => {
  for (const table of ['mission_blocked_resources', 'mission_operating_budget', 'mission_revenue', 'mission_expenses']) {
    missionDb.run(`DELETE FROM ${table}`);
  }
});

test('a mission with no verified revenue is in FREE MODE and cannot spend anything', () => {
  const posture = fundingPosture();
  assert.equal(posture.mode, 'FREE_MODE');
  assert.equal(posture.verifiedRevenueCents, 0);
  assert.equal(posture.spendingUnlocked, false);
  assert.match(String(posture.lockReason), /no externally received and independently verified mission revenue/i);
  assert.throws(() => assertSpendingUnlocked(500, 'buying an API plan'), (error: unknown) => {
    assert.ok(error instanceof MissionFundingError);
    assert.equal(error.code, 'free_mode_no_verified_revenue');
    return true;
  });
  // Zero-cost resources are always allowed: using a free tier is not spending.
  assert.doesNotThrow(() => assertSpendingUnlocked(0, 'using a free tier'));
});

test('unverified or merely expected revenue never unlocks spending', () => {
  addRevenue(500_000, { verified: false });
  addRevenue(250_000, { verified: true, received: false });
  const posture = fundingPosture();
  assert.equal(verifiedRevenueCents(), 0, 'nothing is verified yet');
  assert.ok(posture.unverifiedRevenueCents >= 750_000);
  assert.equal(posture.spendingUnlocked, false);
  assert.throws(
    () => approveOperatingBudget({ amountCents: 1000, purpose: 'buy a search API plan', actorId: OWNER }),
    /verified mission revenue/i,
  );
});

test('a paid resource requirement is recorded, never silently bought or dropped', () => {
  const decision = requestPaidResource({
    agentId: AGENT,
    opportunityId: 'opp-001',
    resourceKey: 'openai:image_render',
    provider: 'openai',
    kind: 'api',
    purpose: 'render a product image the client asked for',
    estimatedCostCents: 2_000,
  });
  assert.equal(decision.decision, 'blocked');
  if (decision.decision !== 'blocked') return;
  assert.equal(decision.code, 'free_mode_no_verified_revenue');
  const rows = listBlockedResources();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].resource_key, 'openai:image_render');
  assert.equal(rows[0].status, 'blocked_no_verified_funds');
  assert.equal(Number(rows[0].estimated_cost_cents), 2_000);

  // Repeating the same requirement aggregates instead of spamming the ledger.
  requestPaidResource({
    agentId: AGENT,
    opportunityId: 'opp-001',
    resourceKey: 'openai:image_render',
    provider: 'openai',
    kind: 'api',
    purpose: 'render a product image the client asked for',
    estimatedCostCents: 2_000,
  });
  assert.equal(listBlockedResources().length, 1);
  assert.equal(Number(listBlockedResources()[0].occurrences), 2);
});

test('a free alternative is preferred and recorded as free, with no block at all', () => {
  const decision = requestPaidResource({
    agentId: AGENT,
    resourceKey: 'search:web',
    provider: 'tavily',
    kind: 'api',
    purpose: 'research the client brief',
    estimatedCostCents: 1_500,
    freeAlternative: 'wikipedia (keyless, free, attribution required)',
  });
  assert.equal(decision.decision, 'use_free_alternative');
  const row = listBlockedResources()[0];
  assert.equal(row.status, 'free_alternative_used');
  assert.match(String(row.free_alternative), /wikipedia/);
  // Free work must not appear as an unmet funding requirement.
  assert.equal(fundingPosture().blockedResourceCount, 0);
});

test('verified revenue alone does not unlock spending — the owner must approve a capped budget', () => {
  addRevenue(10_000, { verified: true });
  let posture = fundingPosture();
  assert.equal(posture.verifiedRevenueCents, 10_000);
  assert.equal(posture.spendingUnlocked, false, 'money alone is not authorisation');
  assert.match(String(posture.lockReason), /has not approved an operating budget/i);

  assert.throws(
    () => approveOperatingBudget({ amountCents: 10_001, purpose: 'over the verified revenue', actorId: OWNER }),
    /exceeds uncommitted verified revenue/i,
  );
  assert.throws(
    () => approveOperatingBudget({ amountCents: 1_000, purpose: 'agent tries to self-authorise', actorId: AGENT, actorType: 'agent' }),
    /agent cannot approve/i,
  );

  const budget = approveOperatingBudget({ amountCents: 4_000, purpose: 'buy the cheapest blocking API plan', actorId: OWNER });
  assert.equal(Number(budget.amount_cents), 4_000);
  assert.equal(Number(budget.backed_by_verified_revenue_cents), 10_000);

  posture = fundingPosture();
  assert.equal(posture.mode, 'FUNDED');
  assert.equal(posture.spendingUnlocked, true);
  assert.equal(posture.budgetRemainingCents, 4_000);

  // Still capped: a purchase above the approved allowance is refused.
  assert.doesNotThrow(() => assertSpendingUnlocked(4_000, 'buying the plan'));
  assert.throws(() => assertSpendingUnlocked(4_001, 'buying a bigger plan'), /exceeds the remaining owner-approved operating budget/i);

  // And revocable.
  revokeOperatingBudget({ id: String(budget.id), reason: 'postpone the purchase', actorId: OWNER });
  assert.equal(fundingPosture().spendingUnlocked, false);
});

test('the reinvestment plan orders blocked requirements cheapest-first with the revenue needed', () => {
  requestPaidResource({ agentId: AGENT, resourceKey: 'openai:image_render', provider: 'openai', kind: 'api', purpose: 'client product images', estimatedCostCents: 2_000 });
  requestPaidResource({ agentId: AGENT, resourceKey: 'domain:akbaral', provider: 'registrar', kind: 'domain', purpose: 'a production domain for the public site', estimatedCostCents: 1_200 });
  requestPaidResource({ agentId: AGENT, resourceKey: 'search:tavily', provider: 'tavily', kind: 'api', purpose: 'higher volume research', estimatedCostCents: 500 });

  const plan = reinvestmentPlan();
  assert.deepEqual(
    plan.items.map((item) => item.resourceKey),
    ['search:tavily', 'domain:akbaral', 'openai:image_render'],
    'cheapest first, so the smallest verified earning unlocks something real',
  );
  assert.deepEqual(
    plan.items.map((item) => item.unlockedAtVerifiedRevenueCents),
    [500, 1_700, 3_700],
    'cumulative verified revenue required',
  );
  assert.equal(plan.posture.mode, 'FREE_MODE');
  assert.equal(plan.items.every((item) => item.alreadyAffordable === false), true);
});

test('an approved purchase can close the recorded requirement', () => {
  const decision = requestPaidResource({ agentId: AGENT, resourceKey: 'search:tavily', provider: 'tavily', kind: 'api', purpose: 'higher volume research', estimatedCostCents: 500 });
  const resourceId = missionId('res');
  missionDb.run(
    `INSERT INTO mission_resources (id, agent_id, kind, provider, plan, monthly_cost_cents, status)
     VALUES (?, ?, 'api', 'tavily', 'paid', 500, 'active')`,
    [resourceId, AGENT],
  );
  const closed = markBlockedResourceUnblocked({ id: String(decision.record.id), resourceId, actorId: OWNER });
  assert.equal(closed.status, 'unblocked');
  assert.equal(closed.resource_id, resourceId);
  assert.equal(fundingPosture().blockedResourceCount, 0);
});

test('every funding decision is written to the hash-chained audit trail', () => {
  addRevenue(5_000, { verified: true });
  requestPaidResource({ agentId: AGENT, resourceKey: 'openai:image_render', provider: 'openai', kind: 'api', purpose: 'client product images', estimatedCostCents: 2_000 });
  approveOperatingBudget({ amountCents: 2_000, purpose: 'unblock the recorded image requirement', actorId: OWNER });
  const actions = missionDb
    .all<{ action: string }>("SELECT action FROM mission_audit WHERE action LIKE 'funding.%' ORDER BY seq ASC")
    .map((row) => row.action);
  assert.ok(actions.includes('funding.resource_blocked'));
  assert.ok(actions.includes('funding.budget_approved'));
});
