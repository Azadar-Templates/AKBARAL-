import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createUser, db } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry } from '../agents/registry';
import {
  insertExecution,
  insertOpportunity,
  updateEconomyPolicy,
  upsertAgentProfile,
} from '../db/economy-repositories';
import { agentAccountFor } from '../economy/treasury';
import { reassignExecution } from '../economy/operations';
import {
  decideReinvestment,
  listReinvestments,
  proposeReinvestment,
  recordDeliveryPayment,
  recordLedgerRevenue as recordRevenue,
} from '../economy/treasury';
import { setAgentOverlay } from './repositories';
import { insertDelivery } from './repositories';
import {
  assignPlatform,
  categoriesForMechanism,
  countPlatforms,
  discoverPlatformOpportunities,
  getPlatform,
  listAgentPlatforms,
  listPlatforms,
  matchPlatformsForAgent,
  seedPlatforms,
} from './platforms';


const EARN_AGENT = 'web-research-001';
const EARN_AGENT2 = 'software-engineering-strategist-001';
let nonce = 0;
function uniq(prefix: string): string {
  nonce += 1;
  return `${prefix}-${Date.now()}-${nonce}`;
}

function makeOpportunity(category = 'research'): { id: string } {
  const url = `https://earning-test.local/${uniq('opp')}`;
  const inserted = insertOpportunity({
    sourceUrlHash: createHash('sha256').update(url).digest('hex'),
    sourceUrl: url,
    category,
    title: `earning test opportunity (${category})`,
    summary: 'synthetic fixture for the earning-loop tests (never real revenue)',
    expectedRevenueCents: 10_000,
    expectedCostCents: 100,
    timeHours: 2,
    riskLevel: 'low',
    probability: 0.5,
    estimateBasis: 'earning_test_fixture',
  });
  return { id: inserted.id };
}

describe('earning workforce: platform catalog', () => {
  before(() => {
    applyMigrations(db);
    syncAgentRegistry();
    seedPlatforms();
    upsertAgentProfile({ agentSlug: EARN_AGENT, parentAgentSlug: null, objectives: 'earning test flagship' });
    upsertAgentProfile({ agentSlug: EARN_AGENT2, parentAgentSlug: null, objectives: 'earning test engineer' });
    setAgentOverlay(EARN_AGENT, { capabilities: ['research'], categories: ['research', 'affiliate'] });
    setAgentOverlay(EARN_AGENT2, { capabilities: ['coding'], categories: ['research'] });
  });

  it('seeds verified+candidate rows, refuses every rejected row, reseed is idempotent', () => {
    // Seed file: 153 rows = 6 verified + 139 candidate + 8 rejected.
    assert.equal(countPlatforms(), 145);
    const again = seedPlatforms();
    assert.equal(again.total, 145);
    assert.equal(again.seeded, 145);
    assert.equal(again.skipped_rejected, 8);
    assert.equal(getPlatform('888starz'), undefined);
    assert.equal(getPlatform('peerfly'), undefined);
    const amazon = getPlatform('amazon-associates');
    assert.ok(amazon);
    assert.equal(amazon.status, 'verified');
    assert.match(amazon.payout_evidence, /fee schedule/i);
  });

  it('lists verified rows first and filters by category', () => {
    const all = listPlatforms({ limit: 145 });
    assert.equal(all.length, 145);
    assert.equal(all[0].status, 'verified');
    assert.ok(all.filter((p) => p.status === 'verified').length >= 6);
    const affiliate = listPlatforms({ category: 'affiliate', limit: 145 });
    assert.ok(affiliate.length > 50);
    assert.ok(affiliate.every((p) => JSON.parse(p.workforce_categories_json).includes('affiliate')));
  });

  it('maps inventory mechanisms to workforce categories', () => {
    assert.deepEqual(categoriesForMechanism('affiliate_network'), ['affiliate']);
    assert.deepEqual(categoriesForMechanism('freelance_services'), ['freelance']);
    assert.deepEqual(categoriesForMechanism('marketplace_selling'), ['marketplaces', 'ecommerce']);
    assert.deepEqual(categoriesForMechanism('something-unknown'), ['research']);
  });

  it('matches platforms to an agent by eligibility, verified first', () => {
    const matched = matchPlatformsForAgent(EARN_AGENT, 20);
    assert.ok(matched.length > 0);
    assert.equal(matched[0].status, 'verified');
    assert.deepEqual(matchPlatformsForAgent('no-such-agent-xyz', 5), []);
  });

  it('assigns platforms with validation + idempotent duplicates', () => {
    const first = assignPlatform(EARN_AGENT, 'amazon-associates', 'owner');
    assert.equal(first.assigned, true);
    const replay = assignPlatform(EARN_AGENT, 'amazon-associates', 'owner');
    assert.equal(replay.duplicate, true);
    assert.throws(() => assignPlatform('no-such-agent-xyz', 'amazon-associates', 'owner'), /does not exist in the registry/);
    assert.throws(() => assignPlatform(EARN_AGENT, 'no-such-platform', 'owner'), /not in the catalog/);
    const mine = listAgentPlatforms(EARN_AGENT);
    assert.ok(mine.some((p) => p.platform_key === 'amazon-associates'));
  });

  it('discovers opportunities from the catalog with labelled estimates', () => {
    const sweep = discoverPlatformOpportunities({ limit: 5, verifiedOnly: true });
    assert.equal(sweep.searched, 5);
    assert.ok(sweep.created + sweep.duplicates === 5);
    const again = discoverPlatformOpportunities({ limit: 5, verifiedOnly: true });
    assert.equal(again.created, 0);
    assert.equal(again.duplicates, 5);
    const rows = db.all<{ estimate_basis: string }>(
      "SELECT estimate_basis FROM economy_opportunities WHERE estimate_basis LIKE 'platform_catalog_%' LIMIT 3",
    );
    assert.ok(rows.length > 0);
    assert.match(rows[0].estimate_basis, /^platform_catalog_(verified|candidate)_/);
  });
});

describe('earning workforce: delivery payments close the loop', () => {
  before(() => {
    applyMigrations(db);
    syncAgentRegistry();
  });

  it('verified delivery + payment evidence → received revenue exactly once', () => {
    const opp = makeOpportunity();
    const exe = insertExecution({ opportunityId: opp.id, agentSlug: EARN_AGENT2, timeoutMs: 60_000 });
    const delivery = insertDelivery({
      executionId: exe.id, opportunityId: opp.id, agentSlug: EARN_AGENT2,
      title: 'earning test deliverable', evidence: 'fixture evidence', verified: true,
    });
    const before = agentAccountFor(EARN_AGENT2).realizedRevenueCents;
    const payment = recordDeliveryPayment({
      deliveryId: delivery.id, amountCents: 12_345,
      evidence: 'platform payout advice PO-EARN-1', externalRef: uniq('PO'), recordedBy: 'owner',
    });
    assert.ok(payment.posted);
    assert.ok(payment.revenueId.length > 0);
    assert.equal(agentAccountFor(EARN_AGENT2).realizedRevenueCents, before + 12_345);
    assert.throws(
      () => recordDeliveryPayment({ deliveryId: delivery.id, amountCents: 100, evidence: 'second claim PO-X', recordedBy: 'owner' }),
      /exactly once/,
    );
  });

  it('unverified delivery, missing evidence and ghosts are refused', () => {
    const opp = makeOpportunity();
    const exe = insertExecution({ opportunityId: opp.id, agentSlug: EARN_AGENT2, timeoutMs: 60_000 });
    const unverified = insertDelivery({
      executionId: exe.id, opportunityId: opp.id, agentSlug: EARN_AGENT2,
      title: 'unverified work', evidence: 'fixture', verified: false,
    });
    assert.throws(
      () => recordDeliveryPayment({ deliveryId: unverified.id, amountCents: 100, evidence: 'PO-X1', recordedBy: 'owner' }),
      /not verified/,
    );
    assert.throws(
      () => recordDeliveryPayment({ deliveryId: 'eco_dlv_ghost', amountCents: 100, evidence: 'PO-X2', recordedBy: 'owner' }),
      /does not exist/,
    );
    const verified = insertDelivery({
      executionId: exe.id, opportunityId: opp.id, agentSlug: EARN_AGENT2,
      title: 'verified work', evidence: 'fixture', verified: true,
    });
    assert.throws(
      () => recordDeliveryPayment({ deliveryId: verified.id, amountCents: 100, evidence: '', recordedBy: 'owner' }),
      /evidence is required/,
    );
  });
});

describe('earning workforce: approved reinvestment', () => {
  let ownerId = '';
  before(() => {
    applyMigrations(db);
    syncAgentRegistry();
    upsertAgentProfile({ agentSlug: EARN_AGENT2, parentAgentSlug: null, objectives: 'earning test engineer' });
    // Audit log references a real user row (FK) — decisions carry its id.
    ownerId = String(createUser({ email: `earning-owner-${Date.now()}-${process.pid}@test.local`, name: 'Earning Test Owner' }).id);
  });

  it('funded surplus → propose → approve executes a reinvestment debit', () => {
    recordRevenue({ amountCents: 20_000, evidence: 'reinvest test funding PO-R1', agentSlug: EARN_AGENT2 });
    const before = agentAccountFor(EARN_AGENT2).availableCents;
    assert.ok(before >= 5_000);
    const proposed = proposeReinvestment({
      agentSlug: EARN_AGENT2, amountCents: 5_000, purpose: 'test ad spend',
      idempotencyKey: uniq('riv'), proposedBy: 'owner',
    });
    assert.equal(proposed.idempotentReplay, false);
    assert.equal(proposed.reinvestment.status, 'proposed');
    const replay = proposeReinvestment({
      agentSlug: EARN_AGENT2, amountCents: 5_000, purpose: 'test ad spend',
      idempotencyKey: proposed.reinvestment.idempotency_key, proposedBy: 'owner',
    });
    assert.equal(replay.idempotentReplay, true);
    const decided = decideReinvestment(proposed.reinvestment.id, 'approve', ownerId);
    assert.equal(decided.status, 'executed');
    assert.equal(agentAccountFor(EARN_AGENT2).availableCents, before - 5_000);
    assert.ok(listReinvestments().some((r) => r.id === proposed.reinvestment.id));
  });

  it('unfunded, frozen and final decisions are refused', () => {
    assert.throws(
      () => proposeReinvestment({ agentSlug: EARN_AGENT2, amountCents: 99_999_999, purpose: 'too much', idempotencyKey: uniq('riv'), proposedBy: 'owner' }),
      /never exceed evidence-backed/,
    );
    updateEconomyPolicy({ freeze_spending: 1 });
    try {
      assert.throws(
        () => proposeReinvestment({ agentSlug: EARN_AGENT2, amountCents: 100, purpose: 'frozen', idempotencyKey: uniq('riv'), proposedBy: 'owner' }),
        /frozen/i,
      );
    } finally {
      updateEconomyPolicy({ freeze_spending: 0 });
    }
    const proposed = proposeReinvestment({
      agentSlug: EARN_AGENT2, amountCents: 100, purpose: 'finality check',
      idempotencyKey: uniq('riv'), proposedBy: 'owner',
    });
    decideReinvestment(proposed.reinvestment.id, 'reject', ownerId);
    assert.throws(() => decideReinvestment(proposed.reinvestment.id, 'approve', ownerId), /already rejected/);
  });
});

describe('earning workforce: execution reassignment', () => {
  before(() => {
    applyMigrations(db);
    syncAgentRegistry();
    upsertAgentProfile({ agentSlug: EARN_AGENT, parentAgentSlug: null, objectives: 'earning test flagship' });
    upsertAgentProfile({ agentSlug: EARN_AGENT2, parentAgentSlug: null, objectives: 'earning test engineer' });
    setAgentOverlay(EARN_AGENT, { capabilities: ['research'], categories: ['research'] });
    setAgentOverlay(EARN_AGENT2, { capabilities: ['coding'], categories: ['youtube'] });
  });

  it('authorized execution moves to an eligible agent with a reason', () => {
    const opp = makeOpportunity('research');
    const started = insertExecution({ opportunityId: opp.id, agentSlug: EARN_AGENT2, timeoutMs: 60_000 });
    assert.equal(started.created, true);
    const moved = reassignExecution(started.id, EARN_AGENT, 'engineer workflow failed twice — flagship takes over', 'owner');
    assert.equal(moved.reassigned, true);
    const row = db.get<{ agent_slug: string }>('SELECT agent_slug FROM economy_executions WHERE id = ?', [started.id]);
    assert.equal(row?.agent_slug, EARN_AGENT);
  });

  it('terminal, ghost, ineligible and reasonless handoffs are refused', () => {
    const opp = makeOpportunity('research');
    const started = insertExecution({ opportunityId: opp.id, agentSlug: EARN_AGENT, timeoutMs: 60_000 });
    db.run("UPDATE economy_executions SET status = 'completed' WHERE id = ?", [started.id]);
    assert.throws(() => reassignExecution(started.id, EARN_AGENT2, 'too late', 'owner'), /only authorized/);
    assert.throws(() => reassignExecution('eco_exe_ghost', EARN_AGENT, 'ghost', 'owner'), /not found/);
    const opp2 = makeOpportunity('research');
    const live = insertExecution({ opportunityId: opp2.id, agentSlug: EARN_AGENT, timeoutMs: 60_000 });
    // EARN_AGENT2 serves only 'youtube' here → ineligible for research work.
    assert.throws(() => reassignExecution(live.id, EARN_AGENT2, 'blind handoff attempt', 'owner'), /not eligible/);
    assert.throws(() => reassignExecution(live.id, EARN_AGENT, '', 'owner'), /reason is required/);
    assert.throws(() => reassignExecution(live.id, 'no-such-agent-xyz', 'ghost agent', 'owner'), /does not exist/);
  });
});
