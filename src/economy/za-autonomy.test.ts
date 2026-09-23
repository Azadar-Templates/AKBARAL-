import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createUser, db } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry, getAgentBySlug } from '../agents/registry';
import { generateAgentDefinitions } from '../agents/catalog';
import {
  agentSpendSince,
  getAgentProfileBySlug,
  insertExecution,
  insertOpportunity,
  listCommands,
  postLedger,
  setAgentQuotas,
  updateEconomyPolicy,
} from '../db/economy-repositories';
import { insertDelivery } from '../workforce/repositories';
import { acknowledgeCommand, cancelCommand, completeCommand, linkCommandWork, sendCommand, commandStatus } from './commands';
import { agentQuotaStatus, assertAgentQuota, pauseAgent, resumeAgent } from './hierarchy';
import { currentPolicy } from './policy';
import {
  applyUpgrade,
  confirmResourceProvisioned,
  childToolPermissions,
  completeSettlement,
  expandCapability,
  listSettlements,
  proposeSettlement,
  proposeUpgrade,
  recordLedgerRevenue as recordRevenue,
  requestResource,
} from './treasury';
import { upsertAgentProfile } from '../db/economy-repositories';

let nonce = 0;
function uniq(prefix: string): string {
  nonce += 1;
  return `${prefix}-${Date.now()}-${nonce}-${process.pid}`;
}
let ownerId = '';
let fullToolsAgent = '';
let noToolsAgent = '';

function makeOpportunity(agentSlug: string): { oppId: string; exeId: string } {
  const url = `https://autonomy-test.local/${uniq('opp')}`;
  const opp = insertOpportunity({
    sourceUrlHash: createHash('sha256').update(url).digest('hex'),
    sourceUrl: url, category: 'research', title: 'autonomy fixture', summary: 'fixture',
    expectedRevenueCents: 10_000, expectedCostCents: 100, timeHours: 2,
    riskLevel: 'low', probability: 0.5, estimateBasis: 'autonomy_test_fixture',
  });
  const exe = insertExecution({ opportunityId: opp.id, agentSlug, timeoutMs: 60_000 });
  return { oppId: opp.id, exeId: exe.id };
}

describe('mission autonomy: ledger, settlement, quotas, spawn, upgrades, commands', () => {
  before(() => {
    applyMigrations(db);
    syncAgentRegistry();
    ownerId = String(createUser({ email: `autonomy-owner-${Date.now()}@test.local`, name: 'Autonomy Owner' }).id);
    const defs = generateAgentDefinitions();
    fullToolsAgent = defs.find((d) => d.toolPermissions.includes('web_search') && d.toolPermissions.includes('page_fetch'))!.slug;
    noToolsAgent = defs.find((d) => !d.toolPermissions.includes('web_search') && !d.toolPermissions.includes('page_fetch'))!.slug;
    upsertAgentProfile({ agentSlug: fullToolsAgent, parentAgentSlug: null, objectives: 'autonomy flagship' });
    upsertAgentProfile({ agentSlug: noToolsAgent, parentAgentSlug: null, objectives: 'autonomy limited' });
    updateEconomyPolicy({ kill_switch: 0, freeze_spending: 0, freeze_withdrawals: 0, auto_upgrade_enabled: 0, max_auto_upgrade_cost_cents: 0 });
  });

  after(() => {
    // Restore factory policy defaults (caps, float, destination placeholder,
    // autonomy off) — later suites share this database.
    updateEconomyPolicy({
      kill_switch: 0, freeze_spending: 0, freeze_withdrawals: 0,
      max_daily_spend_cents: 500, max_opportunity_cost_cents: 200,
      settlement_threshold_cents: 1000, settlement_destination: 'owner-configured-settlement',
      auto_upgrade_enabled: 0, max_auto_upgrade_cost_cents: 0,
    });
  });

  it('0022 applies: ledger triggers exist and UPDATE/DELETE abort', () => {
    const triggers = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_ledger_%'");
    assert.deepEqual(triggers.map((t) => t.name).sort(), ['trg_ledger_no_delete', 'trg_ledger_no_update']);
    postLedger({ direction: 'credit', category: 'revenue', amountCents: 100, purpose: 'immutability fixture', refType: 'test', refId: uniq('imm') });
    assert.throws(() => db.run("UPDATE economy_ledger SET amount_cents = 1 WHERE ref_id LIKE 'imm%'"), /immutable/);
    assert.throws(() => db.run("DELETE FROM economy_ledger WHERE ref_id LIKE 'imm%'"), /immutable/);
  });

  it('settlement refuses a missing/placeholder destination, works with a real one', () => {
    recordRevenue({ amountCents: 60_000, evidence: 'autonomy settlement funding ST-A1', externalRef: uniq('ST') });
    updateEconomyPolicy({ settlement_destination: 'owner-configured-settlement', settlement_threshold_cents: 1_000 });
    const refused = proposeSettlement();
    assert.equal(refused.created, false);
    assert.match(refused.reason, /destination is not configured/);
    updateEconomyPolicy({ settlement_destination: 'owner-bank-acct TEST-SETTLE-001' });
    const made = proposeSettlement();
    assert.equal(made.created, true);
    assert.ok(made.settlementId);
    completeSettlement(made.settlementId!, 'autonomy test transfer advice');
    assert.equal(listSettlements().find((s) => s.id === made.settlementId)!.status, 'completed');
  });

  it('resource kinds are allowlisted and account/property fees get their own ledger category', () => {
    assert.throws(() => requestResource({ kind: 'bribe', provider: 'x', description: 'nope', monthlyCostCents: 10 }), /must be one of/);
    recordRevenue({ amountCents: 40_000, evidence: 'autonomy resource funding ST-A2', externalRef: uniq('ST') });
    updateEconomyPolicy({ max_opportunity_cost_cents: 50_000, max_daily_spend_cents: 200_000 });
    const fee = requestResource({ kind: 'account_fee', provider: 'platform-x', description: 'agent platform seat', monthlyCostCents: 500, requestedByAgent: fullToolsAgent });
    assert.equal(fee.decision.status, 'approved');
    confirmResourceProvisioned(fee.resourceId, 'invoice INV-A1 paid by owner', 500);
    const row = db.get<{ category: string; agent_slug: string }>(
      "SELECT category, agent_slug FROM economy_ledger WHERE ref_id = ?",
      [`resource:${fee.resourceId}:provision`],
    );
    assert.equal(row?.category, 'account_cost');
    assert.equal(row?.agent_slug, fullToolsAgent);
  });

  it('per-agent quotas cap spend with exact window accounting', () => {
    const pre = agentQuotaStatus(fullToolsAgent);
    const cap = pre.dailySpentCents + 200;
    setAgentQuotas(fullToolsAgent, { dailySpendQuotaCents: cap, monthlySpendQuotaCents: pre.monthlySpentCents + 5_000 });
    const before = agentQuotaStatus(fullToolsAgent);
    assert.equal(before.dailyQuotaCents, cap);
    assertAgentQuota(fullToolsAgent, 200);
    assert.throws(() => assertAgentQuota(fullToolsAgent, 201), /daily quota/);
    assert.throws(() => setAgentQuotas(fullToolsAgent, { dailySpendQuotaCents: -5 }), /non-negative/);
    assert.throws(() => setAgentQuotas('no-such-agent-xyz', { dailySpendQuotaCents: 5 }), /does not exist/);
    // Quota denial surfaces through resource requests without throwing.
    const denied = requestResource({ kind: 'tool_license', provider: 'tool-x', description: 'over quota', monthlyCostCents: 10_000, requestedByAgent: fullToolsAgent });
    assert.equal(denied.decision.status, 'denied');
    assert.match(denied.decision.reason, /quota/);
    setAgentQuotas(fullToolsAgent, { dailySpendQuotaCents: null, monthlySpendQuotaCents: null });
    assert.equal(getAgentProfileBySlug(fullToolsAgent)?.daily_spend_quota_cents, null);
  });

  it('spawned children never exceed their parent toolset; tool-less parents cannot spawn', () => {
    assert.ok(getAgentBySlug(fullToolsAgent));
    assert.deepEqual(childToolPermissions(fullToolsAgent).sort(), ['page_fetch', 'web_search']);
    assert.deepEqual(childToolPermissions(noToolsAgent), []);
    assert.deepEqual(childToolPermissions(null), ['web_search', 'page_fetch']);
    const rejected = expandCapability({
      gap: 'autonomy tool-less parent check', specialization: 'Autonomy Child',
      systemInstructions: 'Do honest work.', parentAgentSlug: noToolsAgent, initiatedBy: 'agent', actor: noToolsAgent,
    });
    assert.equal(rejected.status, 'rejected');
    assert.match(rejected.blockedReason ?? '', /spawn-safe tools/);
  });

  it('upgrades carry cost, need funding, and auto-execute only under owner-enabled policy', () => {
    setAgentQuotas(fullToolsAgent, { dailySpendQuotaCents: null, monthlySpendQuotaCents: null });
    assert.equal(currentPolicy().autoUpgradeEnabled, false);
    recordRevenue({ amountCents: 30_000, evidence: 'autonomy upgrade funding ST-A3', externalRef: uniq('ST'), agentSlug: fullToolsAgent });
    const unfunded = proposeUpgrade({ target: 'tool', currentValue: 'a', candidateValue: 'b', benchmark: { expectedNetCents: 500 }, costCents: 999_999_999, requestedByAgent: fullToolsAgent });
    assert.equal(unfunded.securityCheck, 'passed');
    const noFunds = applyUpgrade(unfunded.upgradeId, 'owner');
    assert.equal(noFunds.applied, false);
    assert.match(noFunds.reason, /unfunded/);
    // Agent-actor apply with policy OFF → refused even when funded.
    const funded = proposeUpgrade({ target: 'api', currentValue: 'v1', candidateValue: 'v2', benchmark: { expectedNetCents: 500 }, costCents: 100, requestedByAgent: fullToolsAgent });
    const refused = applyUpgrade(funded.upgradeId, fullToolsAgent);
    assert.equal(refused.applied, false);
    assert.match(refused.reason, /auto-upgrade policy is OFF/);
    // Owner enables autonomy with a cap → agent-actor apply executes + posts the cost debit.
    updateEconomyPolicy({ auto_upgrade_enabled: 1, max_auto_upgrade_cost_cents: 500 });
    const auto = applyUpgrade(funded.upgradeId, fullToolsAgent);
    assert.equal(auto.applied, true);
    const debit = db.get<{ amount_cents: number; category: string }>(
      'SELECT amount_cents, category FROM economy_ledger WHERE ref_id = ?', [`upgrade:${funded.upgradeId}:apply`],
    );
    assert.equal(debit?.amount_cents, 100);
    assert.equal(debit?.category, 'upgrade_cost');
    // Over the cap → refused.
    const pricey = proposeUpgrade({ target: 'compute', currentValue: 's', candidateValue: 'm', benchmark: { expectedNetCents: 500 }, costCents: 600, requestedByAgent: fullToolsAgent });
    const overCap = applyUpgrade(pricey.upgradeId, fullToolsAgent);
    assert.equal(overCap.applied, false);
    assert.match(overCap.reason, /exceeds the 500c auto cap/);
    updateEconomyPolicy({ auto_upgrade_enabled: 0, max_auto_upgrade_cost_cents: 0 });
  });

  it('command flow: issue → acknowledge → link → complete with honest verification', () => {
    const { oppId, exeId } = makeOpportunity(fullToolsAgent);
    const key = uniq('cmd');
    const issued = sendCommand({ ownerUserId: ownerId, agentSlug: fullToolsAgent, instruction: 'Autonomy test order: summarize fixture', idempotencyKey: key });
    assert.equal(issued.duplicate, false);
    assert.equal(issued.command.status, 'issued');
    const replay = sendCommand({ ownerUserId: ownerId, agentSlug: fullToolsAgent, instruction: 'different text, same key', idempotencyKey: key });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.command.id, issued.command.id);
    acknowledgeCommand(issued.command.id, fullToolsAgent);
    // Wrong-agent execution cannot be linked.
    const other = makeOpportunity(noToolsAgent);
    assert.throws(() => linkCommandWork({ id: issued.command.id, opportunityId: other.oppId, executionId: other.exeId, actor: ownerId }), /not the commanded/);
    const running = linkCommandWork({ id: issued.command.id, opportunityId: oppId, executionId: exeId, actor: ownerId });
    assert.equal(running.status, 'running');
    // Unverified delivery → honestly 'pending', never 'verified'.
    const draft = insertDelivery({ executionId: exeId, opportunityId: oppId, agentSlug: fullToolsAgent, title: 'draft', evidence: 'fixture', verified: false });
    const pending = completeCommand({ id: issued.command.id, actor: ownerId, resultSummary: 'work finished, proof under review', deliveryId: draft.id });
    assert.equal(pending.status, 'completed');
    assert.equal(pending.verification, 'pending');
    const status = commandStatus(issued.command.id);
    assert.equal(status.deliveryVerified, false);
    assert.equal(status.execution?.id, exeId);
  });

  it('command flow: verified delivery → verified; failures and cancels are explicit', () => {
    const { oppId, exeId } = makeOpportunity(fullToolsAgent);
    const good = sendCommand({ ownerUserId: ownerId, agentSlug: fullToolsAgent, instruction: 'Autonomy verified order', idempotencyKey: uniq('cmd') });
    acknowledgeCommand(good.command.id, fullToolsAgent);
    linkCommandWork({ id: good.command.id, opportunityId: oppId, executionId: exeId, actor: ownerId });
    const proof = insertDelivery({ executionId: exeId, opportunityId: oppId, agentSlug: fullToolsAgent, title: 'proof', evidence: 'fixture proof', verified: true });
    const done = completeCommand({ id: good.command.id, actor: ownerId, resultSummary: 'done with proof', deliveryId: proof.id });
    assert.equal(done.verification, 'verified');
    const bad = sendCommand({ ownerUserId: ownerId, agentSlug: fullToolsAgent, instruction: 'Autonomy failing order', idempotencyKey: uniq('cmd') });
    acknowledgeCommand(bad.command.id, fullToolsAgent);
    const { oppId: o2, exeId: e2 } = makeOpportunity(fullToolsAgent);
    linkCommandWork({ id: bad.command.id, opportunityId: o2, executionId: e2, actor: ownerId });
    const failed = completeCommand({ id: bad.command.id, actor: ownerId, resultSummary: 'provider outage', failed: true, failureReason: 'search provider timeout' });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.verification, 'failed');
    const cancelled = sendCommand({ ownerUserId: ownerId, agentSlug: fullToolsAgent, instruction: 'Autonomy cancelled order', idempotencyKey: uniq('cmd') });
    assert.throws(() => cancelCommand(cancelled.command.id, 'x', ownerId), /reason is required/);
    const gone = cancelCommand(cancelled.command.id, 'owner changed priorities', ownerId);
    assert.equal(gone.status, 'cancelled');
    assert.ok(listCommands({ agentSlug: fullToolsAgent, limit: 50 }).length >= 4);
  });

  it('commands refuse unknown agents, paused agents and kill-switch', () => {
    assert.throws(() => sendCommand({ ownerUserId: ownerId, agentSlug: 'no-such-agent-xyz', instruction: 'x', idempotencyKey: uniq('cmd') }), /does not exist/);
    pauseAgent({ agentSlug: fullToolsAgent, reason: 'autonomy test pause', actor: 'owner' });
    try {
      assert.throws(() => sendCommand({ ownerUserId: ownerId, agentSlug: fullToolsAgent, instruction: 'x', idempotencyKey: uniq('cmd') }), /paused/);
    } finally {
      resumeAgent({ agentSlug: fullToolsAgent, reason: 'autonomy test resume', actor: 'owner' });
    }
    updateEconomyPolicy({ kill_switch: 1 });
    try {
      assert.throws(() => sendCommand({ ownerUserId: ownerId, agentSlug: fullToolsAgent, instruction: 'x', idempotencyKey: uniq('cmd') }), /kill switch/);
    } finally {
      updateEconomyPolicy({ kill_switch: 0 });
    }
    assert.ok(agentSpendSince(fullToolsAgent, new Date(Date.now() - 3600_000).toISOString()) >= 0);
  });
});
