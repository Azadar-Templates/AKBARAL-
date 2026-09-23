import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../db';
import { applyMigrations } from '../db/migrate';
import { syncAgentRegistry } from '../agents/registry';
import { generateAgentDefinitions } from '../agents/catalog';
import {
  assignPrimaryOpportunity,
  autoAssignPrimaries,
  countPrimaryAssignments,
  discoverPlatformOpportunities,
  earningWorkflowFor,
  getPlatform,
  listPlatforms,
  primaryAgentForPlatform,
  primaryAssignmentForAgent,
  releasePrimaryAssignment,
  seedPlatforms,
  setAssignmentAccount,
  setAssignmentStatus,
} from './platforms';
import { pickWorkforceAgentForOpportunity } from './scheduler';

const AGENTS: string[] = [];
let verifiedKey = '';
const candidateKeys: string[] = [];

function setupCatalog(): void {
  applyMigrations(db);
  syncAgentRegistry();
  seedPlatforms();
  discoverPlatformOpportunities();
  db.run('DELETE FROM economy_opportunity_assignments');
}

function candidateKey(index: number): string {
  const key = candidateKeys[index];
  if (!key) throw new Error(`candidate fixture #${index} missing — catalog too small`);
  return key;
}

describe('workforce 1:1 primaries: exclusivity is enforced, never assumed', () => {
  before(() => {
    setupCatalog();
    const defs = generateAgentDefinitions();
    for (const def of defs.slice(0, 12)) AGENTS.push(def.slug);
    const platforms = listPlatforms({ limit: 10000 });
    verifiedKey = platforms.find((p) => p.status === 'verified')?.platform_key ?? '';
    assert.ok(verifiedKey, 'catalog must hold at least one verified platform');
    for (const p of platforms) {
      if (p.status === 'candidate' && candidateKeys.length < 12) candidateKeys.push(p.platform_key);
    }
    assert.ok(candidateKeys.length >= 10, 'catalog must hold candidate fixtures');
  });

  it('assigns one primary per platform and refuses every shared side with an explicit code', () => {
    const agent = AGENTS[0];
    const platform = candidateKey(0);
    const row = assignPrimaryOpportunity({ agentSlug: agent, platformKey: platform, assignedBy: 'primary-test' });
    assert.equal(row.agent_slug, agent);
    assert.equal(row.platform_key, platform);
    assert.equal(row.status, 'pending_account');
    assert.match(row.earning_workflow_key, /.+:.+:v1/);
    assert.equal(primaryAgentForPlatform(platform), agent);
    assert.equal(primaryAssignmentForAgent(agent)?.platform_key, platform);

    // Same platform, different agent → refused. Same agent, other platform → refused.
    assert.throws(
      () => assignPrimaryOpportunity({ agentSlug: AGENTS[1], platformKey: platform, assignedBy: 'primary-test' }),
      /already answers to primary/,
    );
    assert.throws(
      () => assignPrimaryOpportunity({ agentSlug: agent, platformKey: candidateKey(1), assignedBy: 'primary-test' }),
      /already holds primary/,
    );
    assert.throws(
      () => assignPrimaryOpportunity({ agentSlug: 'no-such-agent-xyz', platformKey: candidateKey(1), assignedBy: 'primary-test' }),
      /does not exist in the registry/,
    );
    assert.throws(
      () => assignPrimaryOpportunity({ agentSlug: AGENTS[1], platformKey: 'no-such-platform-xyz', assignedBy: 'primary-test' }),
      /not in the catalog/,
    );
  });

  it('refuses a primary on a rejected-status row even when the row exists in the table', () => {
    db.run(
      `INSERT OR IGNORE INTO economy_platforms
        (platform_key, name, official_url, mechanism, workforce_categories_json, status,
         payout_evidence, fees, payout_method, minimum_payout, account_kyc, countries,
         risk_level, source_urls_json, verification_date)
       VALUES ('primary-test-rejected', 'Primary Test Rejected', '', 'affiliate', '["affiliate"]', 'rejected',
         'none', '', '', '', 'n/a', '', 'high', '[]', '2026-09-19')`,
    );
    assert.throws(
      () => assignPrimaryOpportunity({ agentSlug: AGENTS[2], platformKey: 'primary-test-rejected', assignedBy: 'primary-test' }),
      /only verified\/candidate rows take a primary/,
    );
    db.run("DELETE FROM economy_platforms WHERE platform_key = 'primary-test-rejected'");
  });

  it('holds the 1:1 guarantee at the database layer, not just in code', () => {
    const beforeCount = countPrimaryAssignments();
    // candidateKey(0) is taken by AGENTS[0] from the first test: raw SQL must fail on every UNIQUE side.
    assert.throws(
      () => db.run(
        `INSERT INTO economy_opportunity_assignments
          (id, agent_slug, platform_key, dedicated_account_property_id, status, required_credentials_json, earning_workflow_key, assigned_by)
         VALUES ('raw-agent-dup', ?, 'raw-platform-free', NULL, 'pending_account', '[]', 'test', 'raw')`,
        [AGENTS[0]],
      ),
      /UNIQUE constraint failed: economy_opportunity_assignments\.agent_slug/,
    );
    assert.throws(
      () => db.run(
        `INSERT INTO economy_opportunity_assignments
          (id, agent_slug, platform_key, dedicated_account_property_id, status, required_credentials_json, earning_workflow_key, assigned_by)
         VALUES ('raw-platform-dup', ?, ?, NULL, 'pending_account', '[]', 'test', 'raw')`,
        [AGENTS[3], candidateKey(0)],
      ),
      /UNIQUE constraint failed: economy_opportunity_assignments\.platform_key/,
    );
    assert.equal(countPrimaryAssignments(), beforeCount);
  });

  it('binds one dedicated account/property per assignment and never shares a property id', () => {
    const withProperty = assignPrimaryOpportunity({
      agentSlug: AGENTS[4], platformKey: candidateKey(2), assignedBy: 'primary-test',
      dedicatedAccountPropertyId: 'acct-prop-001',
    });
    assert.equal(withProperty.status, 'active');
    assert.equal(withProperty.dedicated_account_property_id, 'acct-prop-001');

    const pending = assignPrimaryOpportunity({ agentSlug: AGENTS[5], platformKey: candidateKey(3), assignedBy: 'primary-test' });
    assert.equal(pending.status, 'pending_account');
    const bound = setAssignmentAccount({ agentSlug: AGENTS[5], dedicatedAccountPropertyId: 'acct-prop-002', actor: 'owner' });
    assert.equal(bound.status, 'active');
    assert.equal(bound.dedicated_account_property_id, 'acct-prop-002');

    // Same property anywhere else → refused, both at assign and at bind time.
    assert.throws(
      () => assignPrimaryOpportunity({
        agentSlug: AGENTS[6], platformKey: candidateKey(4), assignedBy: 'primary-test',
        dedicatedAccountPropertyId: 'acct-prop-001',
      }),
      /already bound/,
    );
    assignPrimaryOpportunity({ agentSlug: AGENTS[6], platformKey: candidateKey(4), assignedBy: 'primary-test' });
    assert.throws(
      () => setAssignmentAccount({ agentSlug: AGENTS[6], dedicatedAccountPropertyId: 'acct-prop-002', actor: 'owner' }),
      /already bound/,
    );
    assert.throws(
      () => db.run(
        `INSERT INTO economy_opportunity_assignments
          (id, agent_slug, platform_key, dedicated_account_property_id, status, required_credentials_json, earning_workflow_key, assigned_by)
         VALUES ('raw-property-dup', ?, ?, 'acct-prop-001', 'active', '[]', 'test', 'raw')`,
        [AGENTS[7], candidateKey(5)],
      ),
      /UNIQUE constraint failed: economy_opportunity_assignments\.dedicated_account_property_id/,
    );
  });

  it('moves status through the lifecycle and rejects unknown states', () => {
    const paused = setAssignmentStatus(AGENTS[4], 'paused', 'owner');
    assert.equal(paused.status, 'paused');
    const resumed = setAssignmentStatus(AGENTS[4], 'active', 'owner');
    assert.equal(resumed.status, 'active');
    assert.throws(() => setAssignmentStatus(AGENTS[4], 'launched', 'owner'), /must be one of/);
    assert.throws(() => setAssignmentStatus('no-such-agent-xyz', 'active', 'owner'), /holds no primary/);
  });

  it('describes an executable workflow with credential names, never secret values', () => {
    const platform = getPlatform(verifiedKey);
    assert.ok(platform);
    const workflow = earningWorkflowFor(platform);
    assert.match(workflow.workflowKey, /.+:.+:v1/);
    assert.ok(workflow.credentials.length >= 1);
    assert.ok(workflow.credentials.every((c) => c.length <= 220));
  });

  it('routes platform work to the primary and leaves other work on the legacy path', () => {
    // AGENTS[0] is primary of candidateKey(0); the discovered opportunity row carries the platform key.
    const opp = db.get<{ id: string; platform_key: string | null }>(
      'SELECT id, platform_key FROM economy_opportunities WHERE platform_key = ?', [candidateKey(0)],
    );
    assert.ok(opp, 'discover must stamp the opportunity with its platform key');
    assert.equal(opp.platform_key, candidateKey(0));
    assert.equal(pickWorkforceAgentForOpportunity({ category: 'affiliate', platform_key: candidateKey(0) }), AGENTS[0]);
    const legacy = pickWorkforceAgentForOpportunity({ category: 'affiliate', platform_key: null });
    assert.ok(typeof legacy === 'string' && legacy.length > 0);
  });

  it('releases both sides for reassignment, with a mandatory reason', () => {
    assert.throws(() => releasePrimaryAssignment(AGENTS[1], 'x', 'owner'), /holds no primary|reason is required/);
    assert.throws(() => releasePrimaryAssignment(AGENTS[5], 'x', 'owner'), /reason is required/);
    const released = releasePrimaryAssignment(AGENTS[5], 'test release: property closed', 'owner');
    assert.equal(released.released, true);
    // Both sides free: the agent takes a new platform, the platform takes a new agent.
    const agentAgain = assignPrimaryOpportunity({ agentSlug: AGENTS[5], platformKey: candidateKey(6), assignedBy: 'primary-test' });
    assert.equal(agentAgain.agent_slug, AGENTS[5]);
    const platformAgain = assignPrimaryOpportunity({ agentSlug: AGENTS[8], platformKey: candidateKey(3), assignedBy: 'primary-test' });
    assert.equal(platformAgain.platform_key, candidateKey(3));
  });

  it('auto-matches every assignable platform exactly once and reports the rest honestly', () => {
    db.run('DELETE FROM economy_opportunity_assignments');
    const first = autoAssignPrimaries();
    assert.ok(first.platformsTotal > 100, `catalog holds ${first.platformsTotal} assignable platforms`);
    assert.equal(first.assigned + first.skippedIneligible, first.platformsTotal);
    assert.equal(first.assignmentsTotal, first.assigned);
    // Hard 1:1 proof straight from the table: distinct agents == distinct platforms == rows.
    const check = db.get<{ rows: number; agents: number; platforms: number }>(
      'SELECT COUNT(*) AS rows, COUNT(DISTINCT agent_slug) AS agents, COUNT(DISTINCT platform_key) AS platforms FROM economy_opportunity_assignments',
    );
    assert.ok(check);
    assert.equal(check.rows, first.assigned);
    assert.equal(check.agents, first.assigned);
    assert.equal(check.platforms, first.assigned);
    // Idempotent: a second run changes nothing.
    const second = autoAssignPrimaries();
    assert.equal(second.assigned, 0);
    assert.equal(second.assignmentsTotal, first.assigned);
  });
});
