import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createAgent, createUser, db, Database } from './index';
import { applyMigrations, listMigrationFiles, resolveMigrationsDir } from './migrate';
import { insertExecution, insertOpportunity, upsertAgentProfile } from './economy-repositories';
import { insertComm, insertDelivery, getAgentOverlay, recordSourceOutcome, recordWorkflowOutcome, setAgentOverlay } from '../workforce/repositories';
import { assignPrimaryOpportunity, primaryAssignmentForAgent, releasePrimaryAssignment, setAssignmentAccount } from '../workforce/platforms';
import { agentAccountFor, decideReinvestment, proposeReinvestment, recordDeliveryPayment } from '../economy/treasury';
import { ensureImageBrief } from '../workforce/images';
import { raiseAlert } from '../workforce/alerts';

// Engine-neutral behavior tests. npm test runs these on SQLite; test:pg runs
// the SAME assertions through the PostgreSQL wire-protocol/worker bridge.
// All identities, evidence and money below are local test fixtures only.
const stamp = randomUUID();
const agentSlugs = [0, 1, 2].map((i) => `parity-${stamp}-${i}`);
const platformKeys = [0, 1, 2].map((i) => `parity-platform-${stamp}-${i}`);
let ownerId: string;
let opportunityId: string;
let executionId: string;
const savedAlertEmail = process.env.OWNER_ALERT_EMAIL;
// Every migration at or after 0018 — i.e. the complement of the pre-0018
// baseline this file installs below. Expressed as an ordering, not a hardcoded
// ordinal regex, so adding a migration does not silently drop it from the
// upgrade and column-parity assertions.
const workforceFiles = listMigrationFiles().filter((name) => name >= '0018_');
const workforceTables = workforceFiles.flatMap((file) =>
  [...readFileSync(path.join(resolveMigrationsDir('sqlite'), file), 'utf8').matchAll(/^CREATE TABLE (\w+)/gm)].map((m) => m[1]),
);

before(() => {
  delete process.env.OWNER_ALERT_EMAIL; // never send email from local fixtures
  applyMigrations(db);
  ownerId = createUser({ email: `parity-${stamp}@example.test`, name: 'Local parity fixture' }).id;
  for (const slug of agentSlugs) {
    createAgent({ name: 'Local parity fixture', slug });
    upsertAgentProfile({ agentSlug: slug, parentAgentSlug: null, objectives: 'test fixture, not production work' });
  }
  for (const key of platformKeys) {
    db.run('INSERT INTO economy_platforms (platform_key, name, mechanism, status) VALUES (?, ?, ?, ?)',
      [key, 'Local parity fixture', 'affiliate', 'candidate']);
  }
  opportunityId = insertOpportunity({
    sourceUrlHash: createHash('sha256').update(stamp).digest('hex'),
    sourceUrl: `https://example.test/${stamp}`, category: 'research', title: 'Local parity fixture',
    expectedRevenueCents: 1000, expectedCostCents: 0, timeHours: 1, riskLevel: 'low',
    probability: 0.5, estimateBasis: 'synthetic test fixture, not income', platformKey: platformKeys[0],
  }).id;
  executionId = insertExecution({ opportunityId, agentSlug: agentSlugs[0], timeoutMs: 1000 }).id;
});

after(() => {
  // npm test shares its disposable DB across files. Remove only this run's
  // fixtures so later catalog counts/financial tests are not contaminated.
  try {
    for (const slug of agentSlugs) {
      // `economy_ledger` is deliberately absent: migration 0022 makes money
      // history append-only at the database layer (trg_ledger_no_delete), so a
      // fixture row cannot be erased — and must not be. It is scoped to this
      // run's unique agent slugs, and the only unfiltered ledger aggregate in
      // the suite lives in execution-integrity.test.ts, which pins its own
      // private database file, so these rows contaminate nothing.
      for (const table of ['economy_reinvestments', 'economy_workflows', 'economy_comms', 'workforce_image_requests', 'economy_agent_profiles']) {
        db.run(`DELETE FROM ${table} WHERE agent_slug = ?`, [slug]);
      }
      db.run('DELETE FROM agents WHERE slug = ?', [slug]);
      db.run('DELETE FROM economy_events WHERE actor = ?', [slug]);
    }
    if (opportunityId) {
      db.run('DELETE FROM economy_revenue WHERE opportunity_id = ?', [opportunityId]);
      db.run('DELETE FROM economy_opportunities WHERE id = ?', [opportunityId]);
    }
    for (const key of platformKeys) db.run('DELETE FROM economy_platforms WHERE platform_key = ?', [key]);
    db.run('DELETE FROM workforce_staged_knowledge WHERE knowledge_item_id = ?', [stamp]);
    db.run('DELETE FROM workforce_staged_files WHERE file_id = ?', [stamp]);
    db.run('DELETE FROM economy_source_health WHERE domain = ?', [`${stamp}.example.test`]);
    db.run('DELETE FROM owner_alerts WHERE dedupe_key LIKE ?', [`%${stamp}%`]);
    if (ownerId) {
      db.run('DELETE FROM audit_logs WHERE actor_id = ?', [ownerId]);
      db.run('DELETE FROM economy_events WHERE actor = ?', [ownerId]);
      db.run('DELETE FROM users WHERE id = ?', [ownerId]);
    }
  } finally {
    if (savedAlertEmail === undefined) delete process.env.OWNER_ALERT_EMAIL;
    else process.env.OWNER_ALERT_EMAIL = savedAlertEmail;
    db.close();
  }
});

describe('workforce storage parity (SQLite and PostgreSQL)', () => {
  it('exposes all workforce columns, matching a freshly migrated SQLite schema', () => {
    const reference = new Database(':memory:');
    try {
      applyMigrations(reference);
      for (const table of [...workforceTables, 'economy_agent_profiles', 'economy_opportunities']) {
        const expected = reference.all<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name).sort();
        const actual = db.engine === 'postgres'
          ? db.all<{ name: string }>('SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', [table]).map((r) => r.name).sort()
          : db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name).sort();
        assert.deepEqual(actual, expected, table);
      }
      assert.deepEqual(applyMigrations(db), [], 'reapplying migrations must be a checksum-verified no-op');
    } finally { reference.close(); }
  });

  it('persists category overlays, source protection, workflow failures and owner alerts', () => {
    setAgentOverlay(agentSlugs[0], { capabilities: ['research'], categories: ['research', 'affiliate'] });
    assert.deepEqual(getAgentOverlay(agentSlugs[0]).categories, ['research', 'affiliate']);
    const domain = `${stamp}.example.test`;
    for (let i = 0; i < 3; i++) {
      recordSourceOutcome({ domain, category: 'research', ok: false, error: 'test source unavailable' });
      recordWorkflowOutcome({ agentSlug: agentSlugs[0], category: 'research', workflowKey: stamp, ok: false, error: 'test workflow failure' });
    }
    assert.equal(db.get<{ status: string }>('SELECT status FROM economy_source_health WHERE domain = ?', [domain])?.status, 'unreliable');
    assert.equal(db.get<{ status: string }>('SELECT status FROM economy_workflows WHERE workflow_key = ?', [stamp])?.status, 'failed');
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM owner_alerts WHERE dedupe_key LIKE ?', [`%${stamp}%`])?.n, 2);
  });

  it('stores staging references, governed image requests and unapproved communications', () => {
    db.run('INSERT INTO workforce_staged_knowledge (knowledge_item_id, staged_by) VALUES (?, ?)', [stamp, ownerId]);
    db.run('INSERT INTO workforce_staged_files (file_id, staged_by) VALUES (?, ?)', [stamp, ownerId]);
    db.run('INSERT INTO workforce_image_requests (id, agent_slug, prompt) VALUES (?, ?, ?)', [stamp, agentSlugs[0], 'test brief — never sent to a provider']);
    assert.equal(db.get<{ status: string }>('SELECT status FROM workforce_image_requests WHERE id = ?', [stamp])?.status, 'requested');
    const comm = insertComm({ agentSlug: agentSlugs[0], channel: 'email', recipientMasked: 't***@example.test',
      template: 'test', contentPreview: 'local fixture only', consentBasis: 'local test, no send' });
    assert.equal(comm.status, 'requested');
    assert.match(comm.created_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    const brief = { executionId, opportunityId, agentSlug: agentSlugs[0], prompt: 'local test image brief, never rendered' };
    const image = ensureImageBrief(brief);
    assert.equal(image.status, 'requested');
    assert.equal(ensureImageBrief(brief).id, image.id, 'retry reuses the open brief on either engine');
  });

  it('deduplicates alerts using portable ordering and records missing email configuration', async () => {
    const input = { condition: 'source-blocked' as const, title: 'local test alert', dedupeKey: `dedupe-${stamp}` };
    const first = await raiseAlert(input);
    const second = await raiseAlert(input);
    assert.equal(first.delivery_status, 'not_configured');
    assert.equal(second.id, first.id);
    assert.equal(second.occurrences, 2);
  });

  it('enforces exclusive agent/platform/property keys and permits multiple pending accounts', () => {
    const first = assignPrimaryOpportunity({ agentSlug: agentSlugs[0], platformKey: platformKeys[0], assignedBy: ownerId });
    const second = assignPrimaryOpportunity({ agentSlug: agentSlugs[1], platformKey: platformKeys[1], assignedBy: ownerId });
    assert.equal(first.dedicated_account_property_id, null);
    assert.equal(second.dedicated_account_property_id, null);
    const rawInsert = (agent: string, platform: string, property: string | null): void => {
      // Simple protocol for deliberately failing SQL: pglite-socket 0.2.11
      // emits extra ReadyForQuery messages after extended-protocol errors.
      // This still exercises the real engine's UNIQUE constraints; normal
      // repository operations above/below remain parameterized through pg.
      const literal = (value: string | null): string => value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`;
      db.exec(`INSERT INTO economy_opportunity_assignments (id, agent_slug, platform_key, dedicated_account_property_id, assigned_by)
        VALUES (${[randomUUID(), agent, platform, property, ownerId].map(literal).join(', ')})`);
    };
    const uniqueViolation = /UNIQUE constraint failed|duplicate key value violates unique constraint/i;
    assert.throws(() => rawInsert(agentSlugs[0], platformKeys[2], null), uniqueViolation);
    assert.throws(() => rawInsert(agentSlugs[2], platformKeys[0], null), uniqueViolation);
    const property = `test-account-${stamp}`;
    assert.equal(setAssignmentAccount({ agentSlug: agentSlugs[0], dedicatedAccountPropertyId: property, actor: ownerId }).status, 'active');
    assert.throws(() => rawInsert(agentSlugs[2], platformKeys[2], property), uniqueViolation);
    assert.throws(() => setAssignmentAccount({ agentSlug: agentSlugs[1], dedicatedAccountPropertyId: property, actor: ownerId }), /already bound/);
    releasePrimaryAssignment(agentSlugs[1], 'local parity test release', ownerId);
    assert.equal(primaryAssignmentForAgent(agentSlugs[1]), undefined);
    assert.equal(assignPrimaryOpportunity({ agentSlug: agentSlugs[1], platformKey: platformKeys[2], assignedBy: ownerId }).platform_key, platformKeys[2]);
  });

  it('refuses unverified revenue and records a verified fixture delivery only once', () => {
    const input = { executionId, opportunityId, agentSlug: agentSlugs[0], title: 'Synthetic test delivery', evidence: 'test-only work product' };
    const unverified = insertDelivery({ ...input, verified: false });
    assert.throws(() => recordDeliveryPayment({ deliveryId: unverified.id, amountCents: 1000, evidence: 'test-only receipt', recordedBy: ownerId }), /verified/i);
    const delivery = insertDelivery({ ...input, verified: true });
    const before = agentAccountFor(agentSlugs[0]).availableCents;
    const payment = { deliveryId: delivery.id, amountCents: 1000, evidence: 'synthetic test receipt — no actual payment', recordedBy: ownerId };
    assert.equal(recordDeliveryPayment(payment).posted, true);
    assert.equal(agentAccountFor(agentSlugs[0]).availableCents, before + 1000);
    assert.throws(() => recordDeliveryPayment(payment), /already has a recorded payment/);
    assert.equal(agentAccountFor(agentSlugs[0]).availableCents, before + 1000);
  });

  it('requires realized balance and an explicit decision for reinvestment; replay does not double debit', () => {
    const before = agentAccountFor(agentSlugs[0]).availableCents;
    assert.throws(() => proposeReinvestment({ agentSlug: agentSlugs[0], amountCents: before + 1,
      purpose: 'local unfunded fixture', idempotencyKey: `unfunded-${stamp}`, proposedBy: ownerId }), /never exceed evidence-backed/);
    const proposal = proposeReinvestment({ agentSlug: agentSlugs[0], amountCents: 100,
      purpose: 'local fixture allocation, not external spend', idempotencyKey: stamp, proposedBy: ownerId });
    assert.equal(proposal.reinvestment.status, 'proposed');
    assert.equal(agentAccountFor(agentSlugs[0]).availableCents, before);
    assert.equal(decideReinvestment(proposal.reinvestment.id, 'approve', ownerId).status, 'executed');
    assert.equal(agentAccountFor(agentSlugs[0]).availableCents, before - 100);
    decideReinvestment(proposal.reinvestment.id, 'approve', ownerId);
    assert.equal(agentAccountFor(agentSlugs[0]).availableCents, before - 100);
  });

  it('upgrades a 0017 database without changing owner-tuned policy or historical records', () => {
    const schema = `workforce_upgrade_${stamp.replace(/-/g, '')}`;
    const isolated = db.engine === 'postgres' ? db : new Database(':memory:');
    const previousPath = db.engine === 'postgres'
      ? db.get<{ value: string }>("SELECT current_setting('search_path') AS value")!.value : null;
    try {
      if (db.engine === 'postgres') {
        db.exec(`CREATE SCHEMA ${schema}`);
        db.exec(`SET search_path TO ${schema}`);
      }
      isolated.exec(`CREATE TABLE _migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`);
      const dir = resolveMigrationsDir(isolated.engine);
      for (const file of listMigrationFiles(dir).filter((name) => name < '0018_')) {
        const sql = readFileSync(path.join(dir, file), 'utf8');
        isolated.transaction((tx) => {
          tx.exec(sql);
          tx.run('INSERT INTO _migrations (name, checksum, applied_at) VALUES (?, ?, ?)',
            [file, createHash('sha256').update(sql).digest('hex'), '2026-09-19T00:00:00.000Z']);
        });
      }
      isolated.run("INSERT OR IGNORE INTO economy_policy (id) VALUES ('global')");
      isolated.run("UPDATE economy_policy SET max_economy_agents = 37, max_daily_spend_cents = 321, kill_switch = 1, freeze_spending = 1 WHERE id = 'global'");
      isolated.run("INSERT INTO economy_policy (id) VALUES ('default-fixture')");
      isolated.run("INSERT INTO economy_events (id, kind, actor, summary) VALUES ('history-fixture', 'test', 'owner', 'preserve historical fixture')");
      const beforePolicy = isolated.get<Record<string, unknown>>("SELECT * FROM economy_policy WHERE id = 'global'")!;
      const beforeHistory = isolated.get("SELECT * FROM economy_events WHERE id = 'history-fixture'");
      const ledger = isolated.all('SELECT * FROM _migrations ORDER BY name');
      assert.equal(ledger.length, 17);
      assert.deepEqual(applyMigrations(isolated), workforceFiles);
      const afterPolicy = isolated.get<Record<string, unknown>>("SELECT * FROM economy_policy WHERE id = 'global'")!;
      assert.deepEqual(Object.fromEntries(Object.keys(beforePolicy).map((key) => [key, afterPolicy[key]])), { ...beforePolicy });
      assert.equal(afterPolicy.reinvest_share_bps, 0, 'new reinvestment policy stays disabled');
      assert.equal(afterPolicy.daily_revenue_target_cents, 0, 'migration invents no revenue target');
      assert.deepEqual(isolated.get("SELECT * FROM economy_events WHERE id = 'history-fixture'"), beforeHistory);
      assert.deepEqual(isolated.all("SELECT * FROM _migrations WHERE name < '0018_' ORDER BY name"), ledger);
      assert.equal(isolated.get<{ n: number }>("SELECT max_economy_agents AS n FROM economy_policy WHERE id = 'default-fixture'")?.n, 5000);
      assert.deepEqual(applyMigrations(isolated), []);
    } finally {
      if (previousPath !== null) {
        db.get("SELECT set_config('search_path', ?, false)", [previousPath]);
        db.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); // this test-created schema only
      } else isolated.close();
    }
  });

});
