/**
 * Platform catalog integrity: what may be asserted about a venue, and what must be refused.
 * These tests exist because the dangerous failure here is not a crash — it is a fleet confidently
 * sending work to a place that is closed, restricted, or was never checked.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `plancat-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'synthetic-platform-catalog-tests-not-live';
import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { missionDb as db, applyMissionMigrations, type Row } from '../database';
import { provisionOwner } from '../auth';
import { OPPORTUNITY_REGISTRY } from './opportunity-registry';
import {
  AUTHORIZED_ACCOUNT_GROUPS, GMAIL_GROUPS, VERIFIED_PLATFORM_RECORDS, applyPlatformCatalog, catalogSummary,
  evidenceDigestFor, latestEvidence, normalizePlatformId, platformRecordFor, resolvePermissions, resolveToolKeys,
} from './platform-catalog';

const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));
let ownerId = '';
let applied: ReturnType<typeof applyPlatformCatalog> | null = null;
let summary: ReturnType<typeof catalogSummary> | null = null;

function record(id: string): NonNullable<ReturnType<typeof platformRecordFor>> {
  const found = platformRecordFor(id);
  assert.ok(found, `catalog record ${id} should exist`);
  return found!;
}
function rowFor(id: string): Row {
  const registryId = normalizePlatformId(id);
  const row = db.get<Row>('SELECT * FROM mission_platforms WHERE id IN (?,?)', [id, registryId]);
  assert.ok(row, `registry row for ${id} should exist after --apply-catalog`);
  return row!;
}

before(() => {
  applyMissionMigrations();
  ownerId = String(provisionOwner({ email: `cat-${randomUUID().slice(0, 8)}@example.invalid`, password: `synthetic-catalog-${randomUUID()}` }).id);
  applied = applyPlatformCatalog({ kind: 'owner', id: ownerId });
  // A second pass is what carries an already-QUALIFIED venue into POLICY_REVIEW: each call may
  // advance one step, which is the ceiling a code-driven catalog write is allowed.
  applyPlatformCatalog({ kind: 'owner', id: ownerId });
  summary = catalogSummary();
});

it('never asserts more than it verified: every active record cites an official source and states its reading', () => {
  for (const entry of VERIFIED_PLATFORM_RECORDS) {
    assert.match(entry.officialUrl, /^https:\/\//, `${entry.platformId} official url must be https`);
    if (entry.verdict === 'active') {
      assert.ok(entry.sourceCitations.length >= 1, `${entry.platformId} is claimed active without a source`);
      assert.ok(entry.verdictReason.length > 20, `${entry.platformId} active reason is too thin to audit`);
      assert.ok(entry.skills.length >= 1, `${entry.platformId} is assignable but declares no skill to train`);
    }
    if (entry.verdict === 'unverified') {
      // An unverified venue must say why it is unverified rather than leaving the field blank.
      assert.ok(entry.verdictReason.includes('today'), `${entry.platformId} unverified reason must state what was not read`);
      // An unverified verdict may come from reading nothing, or from reading only what somebody
      // else said about the venue. It may never come from a primary read — that would be a verdict.
      assert.ok(entry.verifiedVia === 'none' || entry.verifiedVia === 'secondary_source',
        `${entry.platformId} claims unverified after a ${entry.verifiedVia} read of the venue itself`);
    }
  }
});

it('maps every venue onto an existing opportunity class instead of inventing a parallel taxonomy', () => {
  const known = new Set(OPPORTUNITY_REGISTRY.map(entry => entry.key));
  for (const entry of VERIFIED_PLATFORM_RECORDS) {
    assert.ok(known.has(entry.opportunityClass), `${entry.platformId} names a class the registry does not have: ${entry.opportunityClass}`);
  }
  // The security venues land on classes the engine already reasons about, and grants on the
  // sponsorship class rather than a bespoke "grant" label.
  assert.equal(platformRecordFor('immunefi')!.opportunityClass, 'bug_bounties');
  assert.equal(platformRecordFor('sherlock')!.opportunityClass, 'contests_challenges');
  assert.equal(platformRecordFor('gitcoin')!.opportunityClass, 'open_source_sponsorship');
});

it('keeps platform ids unique and refuses to double-count a program as a platform', () => {
  const ids = VERIFIED_PLATFORM_RECORDS.map(entry => entry.platformId);
  assert.equal(new Set(ids).size, ids.length, 'duplicate platform id in the catalog');
  // OpenZeppelin's bounty is one Immunefi program; Spearbit's competitions run on Cantina.
  assert.equal(record('open_zeppelin_bounty').verdict, 'unsuitable');
  assert.equal(record('spearbit').verdict, 'unsuitable');
  const assignable = summary!.rows.filter(row => row.assignable).map(row => row.catalogId);
  assert.ok(!assignable.includes('open_zeppelin_bounty') && !assignable.includes('spearbit'), 'a deduped venue must not take a slot');
});

it('records the venues the owner named that are closed, blocked or unread — and does not assign them', () => {
  const byId = new Map(summary!.rows.map(row => [row.catalogId, row]));
  assert.equal(byId.get('code4rena')!.verdict, 'inactive', 'Code4rena wound down and must not read as available');
  assert.ok(byId.get('code4rena')!.blockingReasons.includes('verdict_inactive'));
  assert.equal(byId.get('cantina')!.verdict, 'blocked', 'invite-only participation is a block, not a difficulty');
  assert.equal(byId.get('dorahacks')!.verdict, 'blocked');
  assert.equal(byId.get('paladin')!.verdict, 'unverified', 'an unread venue may not be promoted or dismissed');
  assert.equal(byId.get('layer3')!.verdict, 'unverified');
  assert.equal(byId.get('hats_finance')!.verdict, 'unverified');
  // Patchstack is open and paying, but it bans the automated-report pattern we would be.
  const patchstack = byId.get('patchstack')!;
  assert.equal(patchstack.verdict, 'active', 'a venue that pays humans is still active for research');
  assert.equal(patchstack.automationPolicy, 'prohibited');
  assert.ok(patchstack.blockingReasons.includes('automation_prohibited'), 'prohibited automation must block assignment');
});

it('accounts for the owner grouping labels without implying an account exists for all of them', () => {
  assert.deepEqual([...GMAIL_GROUPS], ['mission', 'gmail-1', 'gmail-2', 'gmail-3', 'gmail-4']);
  assert.deepEqual([...AUTHORIZED_ACCOUNT_GROUPS], ['mission', 'gmail-1', 'gmail-2', 'gmail-3']);
  // The fourth grouping is the owner's label with no authorized identity behind it. Venues mapped
  // there are still verified, and the gap is stated instead of papered over.
  const yeswehack = record('yeswehack');
  assert.equal(yeswehack.gmailGroup, 'gmail-4');
  assert.equal(yeswehack.verdict, 'active');
});

it('writes one registry row and one evidence record per venue, and is idempotent on re-run', () => {
  assert.ok(applied!.observed >= 21, `observed ${applied!.observed} venues`);
  assert.ok(applied!.created + applied!.existing === applied!.observed);
  assert.ok(applied!.evidenced >= applied!.observed - 6, 'a venue with no evidence row would let assignment guess');
  const first = Number(db.get<Row>('SELECT COUNT(*) AS c FROM mission_platform_evidence')?.c ?? 0);
  assert.ok(first >= applied!.observed);
  const again = applyPlatformCatalog({ kind: 'owner', id: ownerId });
  assert.equal(again.evidenced, 0, 're-applying the same reading must not duplicate evidence');
  assert.equal(again.created, 0, 're-applying must not create a second registry row');
  assert.equal(again.existing, again.observed);
});

it('treats the evidence record as the only path to a lifecycle advance, and never past POLICY_REVIEW', () => {
  const statuses = (db.all<Row>('SELECT status FROM mission_platforms') ?? []).map(row => String(row.status));
  for (const status of new Set(statuses)) {
    assert.ok(['DISCOVERED', 'QUALIFIED', 'POLICY_REVIEW', 'ACTIVE', 'RESTRICTED', 'BLOCKED', 'PAYMENT_VERIFICATION_READY', 'PERMITTED'].includes(status), `unexpected status ${status}`);
  }
  // Nothing the catalog wrote on its own may sit in PERMITTED/ACTIVE: those are owner decisions.
  for (const entry of VERIFIED_PLATFORM_RECORDS) {
    const status = String(rowFor(entry.platformId).status);
    assert.ok(!['PERMITTED', 'ACTIVE', 'PAYMENT_VERIFICATION_READY'].includes(status), `${entry.platformId} advanced past policy review without the owner`);
  }
  assert.equal(String(rowFor('github_issue_bounties').status), 'POLICY_REVIEW', 'the live-verified venue should have reached policy review');
  assert.equal(String(rowFor('code4rena').status), 'RESTRICTED', 'a wound-down venue must be visibly restricted, not quietly absent');
});

it('keys evidence to the id actually stored, whichever spelling created the row', () => {
  // Seed inserts raw ids; discovery normalizes them. A single hard-coded convention would put the
  // evidence row on a platform id that does not exist, which the foreign key rejects.
  assert.equal(normalizePlatformId('github_issue_bounties'), 'github-issue-bounties');
  for (const entry of VERIFIED_PLATFORM_RECORDS) {
    const evidence = latestEvidence(entry.platformId);
    assert.ok(evidence, `${entry.platformId} has no evidence row reachable by either spelling`);
  }
  const keyed = db.all<Row>(`SELECT e.platform_id AS id FROM mission_platform_evidence e
    LEFT JOIN mission_platforms p ON p.id = e.platform_id WHERE p.id IS NULL`);
  assert.equal(keyed.length, 0, 'every evidence row must hang off a registry row that exists');
});

it('summarises staleness against the reading date rather than the row creation date', () => {
  const fresh = catalogSummary({ maxAgeDays: 30 });
  assert.equal(fresh.rows.filter(row => row.blockingReasons.includes('verification_stale')).length, 0, 'today is not stale');
  const impossiblyFresh = catalogSummary({ maxAgeDays: -1, now: () => new Date(Date.now() - 86_400_000) });
  assert.ok(impossiblyFresh.rows.every(row => row.blockingReasons.length > 0), 'a negative window must block everything');
  assert.equal(impossiblyFresh.counts.assignable, 0);
});

it('resolves tool keys against the connector registry and reports gaps instead of granting wishes', () => {
  const resolved = resolveToolKeys(['hackerone', 'definitely_not_a_tool']);
  assert.deepEqual(resolved.missing, ['definitely_not_a_tool']);
  assert.equal(resolved.resolved.length, 1);
  assert.equal(resolved.resolved[0].key, 'hackerone');
  for (const entry of VERIFIED_PLATFORM_RECORDS) {
    const check = resolveToolKeys(entry.toolKeys);
    assert.deepEqual(check.missing, [], `${entry.platformId} names a tool with no connector contract`);
  }
});

it('derives permissions from the class contract and refuses anything else', () => {
  assert.deepEqual([...resolvePermissions('bounty_research', []).permissions], ['report.submit']);
  assert.throws(() => resolvePermissions('bounty_research', ['tool.request'] as never), /specialist_permission_not_grantable/);
  assert.throws(() => resolvePermissions('owner_submission', []), /specialist_class_owner_only/);
  assert.throws(() => resolvePermissions('ghost_class', []), /specialist_class_unknown/);
});

it('binds a digest to each reading so a re-verification is distinguishable from a re-hash', () => {
  const digests = VERIFIED_PLATFORM_RECORDS.map(entry => evidenceDigestFor(entry));
  assert.equal(new Set(digests).size, digests.length, 'digests must differ per venue');
  const patched = { ...record('sherlock'), verdictReason: `${record('sherlock').verdictReason} (re-read)` };
  assert.notEqual(evidenceDigestFor(patched), evidenceDigestFor(record('sherlock')), 'a changed reading must change the digest');
});

it('refuses to fabricate the payout terms of a venue it could not read', () => {
  for (const entry of VERIFIED_PLATFORM_RECORDS.filter(row => row.verdict === 'unverified')) {
    assert.ok(entry.accountRequirements.every(line => line !== 'unknown' || entry.platformId === 'paladin'), `${entry.platformId} invented account terms`);
    assert.equal(entry.openOpportunities, null, `${entry.platformId} claims an opportunity count it never read`);
    assert.equal(entry.maxRewardUsdCents, null, `${entry.platformId} claims a reward ceiling it never read`);
  }
});
