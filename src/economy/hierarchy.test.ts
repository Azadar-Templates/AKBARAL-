import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db/database';
import { applyMigrations } from '../db/migrate';
import {
  getAgentProfileBySlug,
  getEconomyPolicy,
  setAgentBudgetCents,
  updateEconomyPolicy,
  upsertAgentProfile,
} from '../db/economy-repositories';
import {
  HierarchyControlError,
  assertAgentRunnable,
  assertProviderAccessAllowed,
  assertSpendingAllowed,
  assertWithdrawalsAllowed,
  chargeSpawn,
  delegationChain,
  evaluateSpawn,
  hierarchyControls,
  hierarchyTree,
  listAncestors,
  listDelegations,
  pauseAgent,
  pauseAllAgents,
  pauseHierarchy,
  recordSpawnDecision,
  resumeAgent,
  resumeAllAgents,
  resumeHierarchy,
  setControl,
  subtreeSpend,
} from './hierarchy';

/**
 * ZA141251SA hierarchy + emergency-control tests.
 *
 * These run against the shared test database through the same repositories the
 * server uses, because the thing under test is the decision AND its durable
 * record: every gate must both refuse and leave evidence.
 *
 * The properties being defended:
 *   · no spawn without authorization — depth, children, cap, rate, budget;
 *   · a refusal is recorded with the exact gate that refused it;
 *   · an authorized spawn costs the parent budget and is attributed;
 *   · one control does not silently become another (pausing an agent is not a
 *     kill switch; freezing withdrawals does not freeze spending);
 *   · a paused agent — or one inside a paused subtree — cannot be dispatched.
 */

const TREE = ['h-root', 'h-child-a', 'h-child-b', 'h-grand'];
// Every agent this file creates, so the shared test database is left exactly as
// found (other suites count economy agents against the real cap).
const CREATED_SLUGS = [
  ...TREE,
  'h-budget-parent', 'h-budget-child',
  'h-spend-root', 'h-spend-child', 'h-spend-grand',
  'rate-child-0', 'rate-child-1', 'budget-child-1',
];

let policySnapshot: Record<string, unknown> | null = null;
// Spawn rate is counted over a real 60-minute window in this shared database,
// and earlier suites leave authorized decisions inside that window. Those rows
// are held aside for the duration of this suite and put back afterwards, so the
// rate test measures only the spawns it makes itself.
let rateWindowRows: Array<Record<string, unknown>> = [];

before(() => {
  applyMigrations(db);
  // The policy is shared state in the shared test database: snapshot it so the
  // tests below can change limits freely and leave everything exactly as found
  // (other suites assert against the real policy defaults).
  policySnapshot = { ...getEconomyPolicy() } as unknown as Record<string, unknown>;
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  rateWindowRows = db.all<Record<string, unknown>>('SELECT * FROM economy_delegations WHERE decided_at >= ?', [windowStart]);
  db.run('DELETE FROM economy_delegations WHERE decided_at >= ?', [windowStart]);
  for (const slug of TREE) {
    upsertAgentProfile({
      agentSlug: slug,
      parentAgentSlug: slug === 'h-root' ? null : slug === 'h-grand' ? 'h-child-a' : 'h-root',
      objectives: 'hierarchy test',
    });
  }
  resetPolicy();
  fundTrees();
});

/**
 * A budget is delegation authority: with a zero budget an agent may not spawn
 * (that is the point of the budget gate), so the fixtures fund the tree
 * explicitly and the budget test spends one parent's budget to exhaustion.
 */
function fundTrees(): void {
  for (const slug of TREE) setAgentBudgetCents(slug, 500);
}

after(() => {
  // Leave the shared database the way other test files expect to find it:
  // policy restored to the snapshot, test agents and their audit rows removed,
  // so nothing here can influence another suite's agent counts.
  if (policySnapshot) updateEconomyPolicy(policySnapshot as never);
  else resetPolicy();
  for (const row of rateWindowRows) {
    const columns = Object.keys(row);
    db.run(
      `INSERT OR IGNORE INTO economy_delegations (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map((column) => row[column] as string | number | null),
    );
  }
  try {
    const placeholders = CREATED_SLUGS.map(() => '?').join(', ');
    db.run(`DELETE FROM economy_delegations WHERE parent_agent_slug IN (${placeholders}) OR child_agent_slug IN (${placeholders})`, [...CREATED_SLUGS, ...CREATED_SLUGS]);
    db.run(`DELETE FROM economy_agent_profiles WHERE agent_slug IN (${placeholders})`, CREATED_SLUGS);
  } catch {
    /* ignore */
  }
});

function resetPolicy(patch: Record<string, number> = {}): void {
  updateEconomyPolicy({
    kill_switch: 0,
    autonomous_enabled: 0,
    discovery_enabled: 0,
    max_agent_depth: 2,
    max_children_per_agent: 4,
    max_economy_agents: 50,
    spawn_rate_per_hour: 6,
    spawn_cost_cents: 25,
    freeze_spending: 0,
    freeze_withdrawals: 0,
    provider_access_revoked: 0,
    // The daily ceiling is spent from the shared ledger, and suites that ran
    // before this file already posted today's costs. It is set high here so the
    // gate under test is the one each test sets up itself (the parent budget);
    // tests that need a constrained budget constrain the parent, not the day.
    max_daily_spend_cents: 1_000_000,
    ...patch,
  });
}

describe('hierarchy: spawn authorization', () => {
  it('authorizes a spawn inside every limit and records the full check list', () => {
    resetPolicy();
    fundTrees();
    const decision = evaluateSpawn({ parentAgentSlug: 'h-root', actor: 'test', initiatedBy: 'agent' });
    assert.equal(decision.allowed, true, decision.reason);
    assert.equal(decision.depth, 1);
    assert.equal(decision.costCents, 25);
    assert.deepEqual(
      decision.checks.map((check) => check.name),
      ['kill_switch', 'provider_access', 'spending_freeze', 'parent_exists', 'depth_limit', 'children_limit', 'total_agent_cap', 'spawn_rate', 'budget'],
    );
    assert.equal(decision.checks.filter((check) => !check.passed).length, 0);
  });

  it('refuses on the kill switch and names that gate', () => {
    resetPolicy({ kill_switch: 1 });
    const decision = evaluateSpawn({ parentAgentSlug: 'h-root' });
    assert.equal(decision.allowed, false);
    assert.equal(decision.failedGate, 'kill_switch');
    assert.match(decision.reason, /kill switch engaged/);
    resetPolicy();
  });

  it('refuses when provider access is revoked (the child could not execute)', () => {
    resetPolicy({ provider_access_revoked: 1 });
    const decision = evaluateSpawn({ parentAgentSlug: 'h-root' });
    assert.equal(decision.allowed, false);
    assert.equal(decision.failedGate, 'provider_access');
    assert.match(decision.reason, /provider access revoked/);
    resetPolicy();
  });

  it('an owner-approved hire is not charged to the parent budget', () => {
    resetPolicy({ spawn_cost_cents: 100 });
    const parent = 'h-owner-hire-parent';
    db.run('DELETE FROM economy_agent_profiles WHERE agent_slug = ?', [parent]);
    db.run("DELETE FROM economy_delegations WHERE parent_agent_slug = ? OR child_agent_slug = ?", [parent, parent]);
    upsertAgentProfile({ agentSlug: parent, parentAgentSlug: null, objectives: 'owner hire test' });
    setAgentBudgetCents(parent, 0);
    const ownerHire = evaluateSpawn({ parentAgentSlug: parent, initiatedBy: 'owner' });
    assert.equal(ownerHire.allowed, true, ownerHire.reason);
    assert.equal(ownerHire.costCents, 0, 'an owner hire costs the parent nothing');
    const agentHire = evaluateSpawn({ parentAgentSlug: parent, initiatedBy: 'agent' });
    assert.equal(agentHire.allowed, false, 'the same parent cannot delegate without budget');
    assert.equal(agentHire.failedGate, 'budget');
    resetPolicy();
    fundTrees();
  });

  it('refuses when spending is frozen', () => {
    resetPolicy({ freeze_spending: 1 });
    const decision = evaluateSpawn({ parentAgentSlug: 'h-root' });
    assert.equal(decision.allowed, false);
    assert.equal(decision.failedGate, 'spending_freeze');
    assert.match(decision.reason, /spending frozen/);
    resetPolicy();
  });

  it('refuses an unknown parent rather than creating an orphan', () => {
    resetPolicy();
    const decision = evaluateSpawn({ parentAgentSlug: 'does-not-exist' });
    assert.equal(decision.allowed, false);
    assert.equal(decision.failedGate, 'parent_exists');
    assert.match(decision.reason, /parent agent not found/);
  });

  it('enforces the depth limit', () => {
    resetPolicy({ max_agent_depth: 1 });
    const decision = evaluateSpawn({ parentAgentSlug: 'h-child-a' }); // grandchild = depth 2 > 1
    assert.equal(decision.allowed, false);
    assert.equal(decision.failedGate, 'depth_limit');
    assert.match(decision.reason, /max agent depth reached/);
    resetPolicy();
  });

  it('enforces children-per-parent', () => {
    resetPolicy({ max_children_per_agent: 2 }); // h-root already has 2
    const decision = evaluateSpawn({ parentAgentSlug: 'h-root' });
    assert.equal(decision.allowed, false);
    assert.equal(decision.failedGate, 'children_limit');
    assert.match(decision.reason, /parent child limit reached/);
    resetPolicy();
  });

  it('enforces the owner-tunable total cap (never a hard-coded 4,001)', () => {
    resetPolicy({ max_economy_agents: 4 }); // exactly the profiles created above
    const decision = evaluateSpawn({ parentAgentSlug: 'h-root' });
    assert.equal(decision.allowed, false);
    assert.equal(decision.failedGate, 'total_agent_cap');
    assert.match(decision.reason, /agent cap reached/);
    resetPolicy();
  });

  it('enforces the spawn rate over a real 60-minute window', () => {
    resetPolicy({ spawn_rate_per_hour: 2 });
    fundTrees();
    for (let i = 0; i < 2; i += 1) {
      const allowed = evaluateSpawn({ parentAgentSlug: null });
      assert.equal(allowed.allowed, true, allowed.reason);
      recordSpawnDecision({ decision: allowed, parentAgentSlug: null, childAgentSlug: `rate-child-${i}`, actor: 'test' });
      upsertAgentProfile({ agentSlug: `rate-child-${i}`, parentAgentSlug: null, objectives: 'rate test' });
    }
    const refused = evaluateSpawn({ parentAgentSlug: null });
    assert.equal(refused.allowed, false);
    assert.equal(refused.failedGate, 'spawn_rate');
    assert.match(refused.reason, /spawn rate limit reached/);
    // Rejections do not consume the window: still exactly 2 authorized.
    recordSpawnDecision({ decision: refused, parentAgentSlug: null, actor: 'test' });
    const stillRefused = evaluateSpawn({ parentAgentSlug: null });
    assert.equal(stillRefused.failedGate, 'spawn_rate');
    assert.match(stillRefused.reason, /spawn rate limit reached/);
    resetPolicy({ spawn_rate_per_hour: 6 });
  });

  it('enforces a parent budget: a spawn costs money and an exhausted parent cannot spawn', () => {
    resetPolicy({ spawn_cost_cents: 100 });
    // A dedicated parent so the test is idempotent across runs on a shared DB.
    const parent = 'h-budget-parent';
    const child = 'h-budget-child';
    db.run('DELETE FROM economy_agent_profiles WHERE agent_slug IN (?, ?)', [parent, child]);
    upsertAgentProfile({ agentSlug: parent, parentAgentSlug: null, objectives: 'budget test' });
    setAgentBudgetCents(parent, 100);
    assert.equal(Number(getAgentProfileBySlug(parent)?.spend_cents), 0, 'a fresh parent starts with no spend');

    // The parent delegates on its own initiative: this is the spend the budget
    // gate exists for (an owner-approved hire is not charged to the parent).
    const first = evaluateSpawn({ parentAgentSlug: parent, initiatedBy: 'agent' });
    assert.equal(first.allowed, true, first.reason);
    assert.equal(first.budgetRemainingCents, 100);

    upsertAgentProfile({ agentSlug: child, parentAgentSlug: parent, objectives: 'budget test child' });
    chargeSpawn({ parentAgentSlug: parent, childAgentSlug: child, costCents: 100, childBudgetCents: 50 });
    assert.equal(Number(getAgentProfileBySlug(parent)?.spend_cents), 100, 'the parent really paid the spawn cost');
    assert.equal(Number(getAgentProfileBySlug(child)?.budget_cents), 50, 'the child received the granted budget');

    const second = evaluateSpawn({ parentAgentSlug: parent, initiatedBy: 'agent' });
    assert.equal(second.allowed, false);
    assert.equal(second.failedGate, 'budget');
    assert.match(second.reason, /parent budget exhausted/);
    assert.equal(second.budgetRemainingCents, 0);
    resetPolicy();
    fundTrees();
  });

  it('records a refusal with the failing gate inside the delegation row', () => {
    resetPolicy({ kill_switch: 1 });
    const decision = evaluateSpawn({ parentAgentSlug: 'h-root', gap: 'audit me' });
    recordSpawnDecision({ decision, parentAgentSlug: 'h-root', gap: 'audit me', actor: 'owner:test' });
    const rows = listDelegations({ parentAgentSlug: 'h-root', limit: 1 });
    assert.equal(rows[0]?.decision, 'rejected');
    assert.equal(rows[0]?.child_agent_slug, null);
    const checks = JSON.parse(String(rows[0]?.checks_json)) as Array<{ name: string; passed: boolean }>;
    assert.equal(checks.find((check) => check.name === 'kill_switch')?.passed, false);
    assert.equal(rows[0]?.actor, 'owner:test');
    resetPolicy();
  });
});

describe('hierarchy: structure and provenance', () => {
  it('exposes the tree, depth order and child counts', () => {
    const tree = hierarchyTree();
    const root = tree.nodes.find((node) => node.agentSlug === 'h-root');
    assert.equal(root?.depth, 0);
    assert.ok((root?.childCount ?? 0) >= 2);
    const grand = tree.nodes.find((node) => node.agentSlug === 'h-grand');
    assert.equal(grand?.depth, 2, 'h-grand sits two levels below the top-level root');
    assert.equal(hierarchyTree('h-child-a').nodes.find((node) => node.agentSlug === 'h-grand')?.depth, 1, 'inside its own subtree it is one level down');
    assert.ok(tree.maxDepth >= 1);
  });

  it('returns one subtree only when a root is given', () => {
    const subtree = hierarchyTree('h-child-a');
    assert.deepEqual(subtree.nodes.map((node) => node.agentSlug).sort(), ['h-child-a', 'h-grand']);
  });

  it('resolves the accountability chain from an agent to its root', () => {
    const chain = delegationChain('h-grand');
    assert.deepEqual(chain.map((entry) => entry.agentSlug), ['h-grand', 'h-child-a', 'h-root']);
    assert.equal(chain[chain.length - 1]?.parentAgentSlug, null);
    assert.deepEqual(listAncestors('h-grand'), ['h-child-a', 'h-root']);
    assert.deepEqual(listAncestors('h-root'), []);
  });

  it('sums real spend across a whole subtree', () => {
    const root = 'h-spend-root';
    const child = 'h-spend-child';
    const grandchild = 'h-spend-grand';
    db.run('DELETE FROM economy_agent_profiles WHERE agent_slug IN (?, ?, ?)', [root, child, grandchild]);
    upsertAgentProfile({ agentSlug: root, parentAgentSlug: null, objectives: 'spend test' });
    upsertAgentProfile({ agentSlug: child, parentAgentSlug: root, objectives: 'spend test' });
    upsertAgentProfile({ agentSlug: grandchild, parentAgentSlug: child, objectives: 'spend test' });
    chargeSpawn({ parentAgentSlug: root, childAgentSlug: child, costCents: 30 });
    chargeSpawn({ parentAgentSlug: child, childAgentSlug: grandchild, costCents: 20 });
    assert.equal(subtreeSpend(root), 50, 'the subtree accounts for every descendant it paid for');
    assert.equal(subtreeSpend(child), 20, 'a subtree does not inherit its parent’s spend');
    assert.equal(subtreeSpend(grandchild), 0);
  });
});

describe('hierarchy: emergency controls', () => {
  it('pauses and resumes a single agent, refusing to dispatch it meanwhile', () => {
    pauseAgent({ agentSlug: 'h-child-b', reason: 'under investigation', actor: 'owner:test' });
    assert.equal(getAgentProfileBySlug('h-child-b')?.status, 'paused');
    assert.throws(() => assertAgentRunnable('h-child-b'), (error: unknown) => error instanceof HierarchyControlError && error.code === 'agent_paused');
    resumeAgent({ agentSlug: 'h-child-b', reason: 'cleared', actor: 'owner:test' });
    assert.equal(getAgentProfileBySlug('h-child-b')?.status, 'active');
    assert.doesNotThrow(() => assertAgentRunnable('h-child-b'));
  });

  it('pausing a hierarchy stops the root AND its descendants', () => {
    const result = pauseHierarchy({ rootAgentSlug: 'h-child-a', reason: 'whole branch stop', actor: 'owner:test' });
    assert.ok(result.paused.includes('h-child-a'), 'root paused');
    assert.ok(result.paused.includes('h-grand'), 'descendant paused');
    assert.equal(getAgentProfileBySlug('h-grand')?.status, 'paused');
    assert.throws(
      () => assertAgentRunnable('h-grand'),
      (error: unknown) => error instanceof HierarchyControlError && error.code === 'agent_paused',
    );
    resumeHierarchy({ rootAgentSlug: 'h-child-a', reason: 'cleared', actor: 'owner:test' });
    assert.equal(getAgentProfileBySlug('h-grand')?.status, 'active');
    assert.doesNotThrow(() => assertAgentRunnable('h-grand'));
  });

  it('a paused ancestor blocks an active descendant (accountability flows downward)', () => {
    pauseAgent({ agentSlug: 'h-child-a', reason: 'branch hold', actor: 'owner:test' });
    assert.equal(getAgentProfileBySlug('h-grand')?.status, 'active', 'the descendant itself is untouched');
    assert.throws(
      () => assertAgentRunnable('h-grand'),
      (error: unknown) => error instanceof HierarchyControlError && error.code === 'ancestor_paused',
    );
    resumeAgent({ agentSlug: 'h-child-a', reason: 'cleared', actor: 'owner:test' });
    assert.doesNotThrow(() => assertAgentRunnable('h-grand'));
  });

  it('pause-all stops every agent and switches autonomy off; resume-all does NOT switch it back on', () => {
    updateEconomyPolicy({ autonomous_enabled: 1 });
    const paused = pauseAllAgents({ reason: 'incident', actor: 'owner:test' });
    assert.ok(paused.paused >= 1);
    assert.equal(hierarchyControls().autonomousEnabled, false, 'autonomy must not survive a pause-all');
    const resumed = resumeAllAgents({ reason: 'cleared', actor: 'owner:test' });
    assert.ok(resumed.resumed >= 1);
    assert.equal(hierarchyControls().autonomousEnabled, false, 'resuming agents must not silently re-enable autonomy');
  });

  it('keeps the three brakes independent', () => {
    setControl({ kind: 'withdrawals', frozen: true, reason: 'reconciling', actor: 'owner:test' });
    assert.throws(() => assertWithdrawalsAllowed(), (error: unknown) => error instanceof HierarchyControlError && error.code === 'withdrawals_frozen');
    assert.doesNotThrow(() => assertSpendingAllowed('test'));
    assert.doesNotThrow(() => assertProviderAccessAllowed('test'));

    setControl({ kind: 'spending', frozen: true, reason: 'budget review', actor: 'owner:test' });
    assert.throws(() => assertSpendingAllowed('test'), (error: unknown) => error instanceof HierarchyControlError && error.code === 'spending_frozen');
    assert.doesNotThrow(() => assertProviderAccessAllowed('test'));

    setControl({ kind: 'provider_access', frozen: true, reason: 'key rotation', actor: 'owner:test' });
    assert.throws(() => assertProviderAccessAllowed('test'), (error: unknown) => error instanceof HierarchyControlError && error.code === 'provider_access_revoked');

    const controls = hierarchyControls();
    assert.equal(controls.freezeWithdrawals, true);
    assert.equal(controls.freezeSpending, true);
    assert.equal(controls.providerAccessRevoked, true);
    assert.equal(controls.killSwitch, false, 'narrow brakes must not engage the kill switch');

    for (const kind of ['withdrawals', 'spending', 'provider_access'] as const) {
      setControl({ kind, frozen: false, reason: 'released', actor: 'owner:test' });
    }
    const cleared = hierarchyControls();
    assert.equal(cleared.freezeWithdrawals || cleared.freezeSpending || cleared.providerAccessRevoked, false);
    assert.doesNotThrow(() => assertWithdrawalsAllowed());
  });

  it('reports live control state for the dashboard, including the tunable limits', () => {
    const controls = hierarchyControls();
    for (const key of ['killSwitch', 'autonomousEnabled', 'freezeSpending', 'freezeWithdrawals', 'providerAccessRevoked', 'pausedAgents', 'totalAgents', 'spawnRatePerHour', 'spawnsLastHour', 'spawnCostCents', 'maxAgentDepth', 'maxChildrenPerAgent', 'maxEconomyAgents'] as const) {
      assert.ok(controls[key] !== undefined, `missing control field ${key}`);
    }
    assert.ok(controls.totalAgents >= 4);
  });
});
