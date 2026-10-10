import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/**
 * The Overview's read path, measured against the thing it has to survive: a fleet.
 *
 * The deployed console rendered an empty Overview because `GET /api/overview` was doing fleet-sized
 * *write* work inside a page load — `sweepAllAgentDailyTargets()` read and upserted one row per agent,
 * which at 4,001 agents measured 27,976 ms on the PostgreSQL engine the mission database runs on
 * (2,240 ms even on an in-process SQLite file). The mission gateway gives an upstream request
 * `UPSTREAM_TIMEOUT_MS = 15_000` (src/app/mission-gateway/mission-session.ts:51) and answers 502 past
 * that, so the console received no Overview at all — and everything that panel was responsible for
 * rendering, including the read-only label beside it, stayed unrendered.
 *
 * These pins keep the read path a read:
 *   · reading the Overview writes no per-agent rows, and the owner's refresh command still does;
 *   · the statement count is bounded, so it does not grow with the fleet;
 *   · the figures it reports are the same ones the per-agent computation gives, including a met agent;
 *   · the response still carries every field the console dereferences, under the same top-level shape.
 */
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-overview-read-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'overview-read-path-test-secret-not-live';
process.env.ZA141251SA_CREDENTIAL_KEY = '0123456789abcdef0123456789abcdef0123456789ab';

import { before, it } from 'node:test';
import assert from 'node:assert/strict';
const { applyMissionMigrations, missionDb } = require('./database') as typeof import('./database');
const treasury = require('./treasury') as typeof import('./treasury');
const reporting = require('./reporting') as typeof import('./reporting');
const { provisionOwner } = require('./auth') as typeof import('./auth');

/** Every top-level key `GET /api/overview` sends. The client fixture pins the same list — in
 *  src/mission/mission-dashboard-owner-overview.test.ts — because a rename on one side has to be
 *  answered on the other in the same commit. */
const OVERVIEW_TOP_LEVEL_KEYS = [
  'generatedAt', 'fleet', 'isolation', 'identityLock', 'policy', 'agents', 'treasury', 'revenue', 'expenses',
  'upgrades', 'payouts', 'approvals', 'costs', 'targets', 'billionaireDaily', 'selfManagement', 'audit',
  'integrity', 'opportunityCatalog', 'honesty',
];

type Counts = { total: number; reads: number; writes: number; writesBy: string[] };
const WRITE_STATEMENT = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i;

/** Count every statement the mission database sees while `work()` runs. */
function countStatements(work: () => void): Counts {
  const keys = ['get', 'all', 'run'] as const;
  const counts: Counts = { total: 0, reads: 0, writes: 0, writesBy: [] };
  for (const key of keys) {
    const original = (missionDb[key] as (...args: unknown[]) => unknown).bind(missionDb);
    (missionDb as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
      counts.total += 1;
      if (WRITE_STATEMENT.test(String(args[0] ?? ''))) {
        counts.writes += 1;
        counts.writesBy.push(String(args[0]).replace(/\s+/g, ' ').trim().slice(0, 60));
      } else counts.reads += 1;
      return original(...args);
    };
  }
  try {
    work();
  } finally {
    for (const key of keys) delete (missionDb as unknown as Record<string, unknown>)[key];
  }
  return counts;
}

function rowCount(table: string): number {
  return Number(missionDb.get<{ c: number | bigint }>(`SELECT COUNT(*) AS c FROM ${table}`)?.c ?? 0);
}

function insertAgent(slug: string, targetCents: number | null = null): string {
  const id = `agt_ov_${slug}`;
  missionDb.run(
    `INSERT INTO mission_agents (id, slug, name, category, role_key, depth, generation, status, mission_role, origin_platform, capabilities)
     VALUES (?, ?, ?, 'research', 'specialist', 0, 'registry', 'active', 'worker', 'akbaral-registry', '[]')`,
    [id, slug, `Overview read-path agent ${slug}`],
  );
  if (targetCents !== null) missionDb.run('UPDATE mission_agents SET daily_target_cents = ? WHERE id = ?', [targetCents, id]);
  return id;
}

let ownerId = '';
const agentIds: string[] = [];

before(() => {
  applyMissionMigrations();
  const owner = provisionOwner({ email: `overview-read-${randomUUID().slice(0, 8)}@test.local`, password: 'OverviewReadPath!123', displayName: 'Overview Test Owner' });
  ownerId = String((owner as { id?: string }).id ?? missionDb.get<{ id: string }>('SELECT id FROM mission_owner LIMIT 1')?.id);
  assert.ok(ownerId, 'the test needs a mission owner row, because the Overview is owner-gated');
  // One agent meeting a small target, one short of it, and one on the policy default with nothing.
  agentIds.push(insertAgent('ov-met', 1000));
  agentIds.push(insertAgent('ov-short', 1000));
  agentIds.push(insertAgent('ov-default'));
  treasury.recordRevenue({
    amountCents: 1500,
    source: 'fixture-venue',
    status: 'received',
    verifier: 'owner',
    agentId: agentIds[0],
    idempotencyKey: `ov-read-${randomUUID()}`,
    externalRef: 'fixture-receipt-1',
    memo: 'read-path test receipt',
    actorId: ownerId,
  });
  treasury.recordRevenue({
    amountCents: 200,
    source: 'fixture-venue',
    status: 'received',
    verifier: 'owner',
    agentId: agentIds[1],
    idempotencyKey: `ov-read-${randomUUID()}`,
    externalRef: 'fixture-receipt-2',
    memo: 'read-path test receipt',
    actorId: ownerId,
  });
  // Warm the read path so the counts below measure a steady-state page load, not first-run seeding.
  reporting.buildMissionOverview();
  assert.ok(rowCount('mission_agents') >= 3, 'non-vacuity: the fleet this read path is measured against is not empty');
});

it('reading the Overview never writes a row on the fleet’s behalf, whatever the fleet size', () => {
  missionDb.run('DELETE FROM mission_agent_daily_targets');
  assert.equal(rowCount('mission_agent_daily_targets'), 0, 'the measurement starts from a clean per-agent table');
  const perAgentWrites: string[] = [];
  const totals: number[] = [];
  for (let load = 0; load < 3; load += 1) {
    const counts = countStatements(() => reporting.buildMissionOverview());
    totals.push(counts.total);
    perAgentWrites.push(...counts.writesBy.filter((sql) => /mission_agent_daily_targets/i.test(sql)));
  }
  assert.deepEqual(perAgentWrites, [], 'a page load must not write per-agent rows for the owner — that sweep belongs to the refresh command, and writing one row per agent per load is what timed the Overview out');
  assert.equal(rowCount('mission_agent_daily_targets'), 0, 'and the row count proves it: three Overview reads left the table exactly as they found it');
  assert.equal(totals[0], totals[totals.length - 1], 'the work the read path does is the same on every load — here, a fixed reference-table seed, not fleet-sized work');
  const swept = treasury.sweepAllAgentDailyTargets(ownerId);
  assert.equal(swept.swept, rowCount('mission_agents'), 'non-vacuity: writing one row per agent is still what the refresh command does');
  assert.ok(rowCount('mission_agent_daily_targets') >= 3, 'non-vacuity: the table CAN hold per-agent rows, so the zero above was not a missing table');
  const overview = reporting.buildMissionOverview();
  assert.equal(overview.billionaireDaily.dailyTargets.persisted, rowCount('mission_agent_daily_targets'), 'and once rows exist, the Overview reports how many it read');
});

it('the Overview read path issues a bounded number of statements, whatever the fleet size', () => {
  const fleetSize = () => Number(missionDb.get<{ c: number | bigint }>("SELECT COUNT(*) AS c FROM mission_agents WHERE status = 'active'")?.c ?? 0);
  const smallAt = fleetSize();
  const small = countStatements(() => reporting.buildMissionOverview());
  for (let index = 0; index < 37; index += 1) insertAgent(`ov-grow-${index}`);
  const big = countStatements(() => reporting.buildMissionOverview());
  assert.ok(fleetSize() >= smallAt + 37, `non-vacuity: the fleet grew between the two measurements (${smallAt} → ${fleetSize()})`);
  assert.ok(Math.abs(big.total - small.total) <= 2, `the Overview must cost the same with 37 more agents as without them (small=${small.total}, big=${big.total} statements); an O(fleet) read is what timed the panel out in production`);
  assert.equal(big.writes, small.writes, 'and the growth is not paid for with extra writes either');
  const summary = countStatements(() => treasury.agentDailyTargetsFleetSummary());
  assert.ok(summary.total <= 3, `the fleet-wide daily-target figure is a handful of aggregates, not a loop (${summary.total} statement(s))`);
});

it('the fleet figures the Overview reports are the same ones the per-agent computation gives', () => {
  const dailyTargets = reporting.buildMissionOverview().billionaireDaily.dailyTargets;
  const perAgentMet = agentIds.filter((id) => treasury.agentDailyTargetStatus(id, dailyTargets.day).met);
  assert.ok(perAgentMet.length === 1, `non-vacuity: exactly one fixture agent met its target today (saw ${perAgentMet.length})`);
  assert.equal(dailyTargets.met, perAgentMet.length, 'the aggregate says what the per-agent truth says — an agent that met its target is counted, and one that did not is not');
  assert.equal(dailyTargets.agents, rowCount('mission_agents'), 'the fleet count is the stored fleet, counted from active agents');
  assert.equal(dailyTargets.configured, dailyTargets.agents, 'every active agent carries a target, so nothing here is silently excluded');
  assert.equal(dailyTargets.day, new Date().toISOString().slice(0, 10), 'and the day is the UTC day the figures were counted for');
  const shortStatus = treasury.agentDailyTargetStatus(agentIds[1], dailyTargets.day);
  assert.equal(shortStatus.met, false, 'the agent that earned 2.00 of a 10.00 target is not met, whatever the aggregate says');
  assert.ok(dailyTargets.persisted >= 0, 'persisted is reported as a count, including when it is zero');
});

it('the Overview response still carries every field the console dereferences', () => {
  const overview = reporting.buildMissionOverview();
  assert.deepEqual(Object.keys(overview), OVERVIEW_TOP_LEVEL_KEYS, 'the response shape is a contract with the dashboard, so it is pinned key by key');
  // Every one of these is a property renderOverview() reads without a guard of its own. They are read
  // through the declared MissionOverview type here on purpose: if the interface ever stops declaring a
  // field the renderer dereferences, this file stops compiling rather than the console going blank.
  const dereferenced: Array<[string, unknown]> = [
    ['treasury.currency', overview.treasury.currency],
    ['agents.total', overview.agents.total],
    ['agents.registry', overview.agents.registry],
    ['fleet.registered', overview.fleet.registered],
    ['fleet.withPlatform', overview.fleet.withPlatform],
    ['fleet.ready', overview.fleet.ready],
    ['fleet.blocked', overview.fleet.blocked],
    ['fleet.needsOwnerAction', overview.fleet.needsOwnerAction],
    ['fleet.earnedCents', overview.fleet.earnedCents],
    ['fleet.settledProofs', overview.fleet.settledProofs],
    ['fleet.nextAction', overview.fleet.nextAction],
    ['fleet.activation', overview.fleet.activation],
    ['revenue.bySource', overview.revenue.bySource],
    ['revenue.recent', overview.revenue.recent],
    ['targets', overview.targets],
    ['expenses.byCategory', overview.expenses.byCategory],
    ['costs.byCategory', overview.costs.byCategory],
    ['audit.ok', overview.audit.ok],
    ['audit.rows', overview.audit.rows],
    ['integrity.ledger.ok', overview.integrity.ledger.ok],
    ['integrity.ledger.rows', overview.integrity.ledger.rows],
    ['honesty.noFabrication', overview.honesty.noFabrication],
    ['honesty.externalActivationPending', overview.honesty.externalActivationPending],
    ['billionaireDaily.dailyTargets', overview.billionaireDaily.dailyTargets],
  ];
  for (const [pathToField, value] of dereferenced) {
    assert.notEqual(value, undefined, `renderOverview dereferences ${pathToField}; the response must carry it rather than leave the panel to die on it`);
  }
  assert.equal(typeof overview.generatedAt, 'string', 'and it says when it was built');
  assert.ok(overview.fleet.registered >= 3, 'the fleet count in the response is counted from stored rows');
  assert.equal(typeof overview.fleet.claimStatus, 'string', 'and it carries the source mark of the verdict beside it');
});

it('the per-agent list the Overview carries is capped, so a bigger fleet is not a bigger payload', () => {
  const fleetSize = () => Number(missionDb.get<{ c: number | bigint }>("SELECT COUNT(*) AS c FROM mission_agents WHERE status = 'active'")?.c ?? 0);
  // A fresh day: the per-agent figures are then computed from the fleet itself, which is the path a
  // first load of the morning takes and the only one where the fleet size could leak into the payload.
  missionDb.run('DELETE FROM mission_agent_daily_targets');
  let fill = 0;
  while (fleetSize() <= 52) insertAgent(`ov-fill-${(fill += 1)}`);
  const before = reporting.buildMissionOverview();
  assert.ok(fleetSize() > 52, `non-vacuity: the fleet has to be larger than the cap for this to mean anything (saw ${fleetSize()})`);
  assert.equal(before.billionaireDaily.todayPerAgent.length, 50, 'the per-agent list on the Overview is capped at 50 whatever the fleet size');
  const beforeBytes = JSON.stringify(before).length;
  for (let index = 0; index < 20; index += 1) insertAgent(`ov-payload-${index}`);
  const after = reporting.buildMissionOverview();
  assert.equal(after.billionaireDaily.todayPerAgent.length, 50, 'and twenty more agents do not lift that cap');
  assert.ok(Number(after.agents.total) > Number(before.agents.total), 'the fleet count itself still moves, because it is counted rather than sampled');
  const growth = JSON.stringify(after).length - beforeBytes;
  assert.ok(growth < 400, `the payload grows by its counters only — ${growth} bytes for twenty agents, not one entry each`);
});
