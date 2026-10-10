/**
 * A verdict has to say where it came from, and a scratch database has to be unable to claim it is
 * the deployment. Classification is pure (env in, verdict out), so every case here is a real path and
 * a real rule — no mocks, no stubs, and nothing that touches a database.
 */
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURE_CLAIM_MARK,
  LOCAL_CLAIM_MARK,
  PRODUCTION_CLAIM_MARK,
  claimMarkFor,
  classifyMissionDataSource,
  productionClaimRefusal,
} from './data-source';

const base = { PATH: process.env.PATH, HOME: process.env.HOME };

it('a database under a temp or scratch root is fixture-classified and its production claims are refused', () => {
  const scratch = path.join(os.tmpdir(), 'akbaral-data-source-check', 'mission.db');
  const source = classifyMissionDataSource({ ...base, ZA141251SA_DATABASE_URL: `file:${scratch}` });
  assert.equal(source.kind, 'fixture');
  assert.equal(source.label, FIXTURE_CLAIM_MARK);
  assert.equal(source.engine, 'sqlite');
  assert.equal(source.source, scratch, 'the verdict names the exact file it read');
  assert.equal(source.productionClaimsAllowed, false);
  assert.ok(source.reasons.some(reason => /temp root/.test(reason)), `the rule that fired is reported, saw: ${source.reasons.join(' | ')}`);
  assert.match(String(productionClaimRefusal(source, 'the payout slot count')), new RegExp('FIXTURE / NOT PRODUCTION'));
});

it('scratch markers and synthetic file names are fixture even outside a temp root', () => {
  for (const candidate of [
    '/var/lib/pgdata/fixture-mission.db',
    '/srv/app/data/mission-preflight.db',
    '/srv/app/.pglite-mission-test/mission.db',
    '/srv/app/data/strip-sim.db',
  ]) {
    const source = classifyMissionDataSource({ ...base, NODE_ENV: 'production', ZA141251SA_DATABASE_URL: `file:${candidate}` });
    assert.equal(source.kind, 'fixture', `${candidate} must never be able to claim production`);
    assert.equal(source.label, FIXTURE_CLAIM_MARK);
  }
});

it('a real path on a production host is the only thing that earns the production mark', () => {
  const production = classifyMissionDataSource({ ...base, NODE_ENV: 'production', DATA_DIR: '/data' });
  assert.equal(production.kind, 'production');
  assert.equal(production.label, PRODUCTION_CLAIM_MARK);
  assert.equal(production.source, path.resolve('/data/mission.db'));
  assert.equal(production.productionClaimsAllowed, true);
  assert.equal(productionClaimRefusal(production, 'any claim'), null, 'nothing is refused when the source really is production');
  assert.ok(production.reasons.some(reason => /production volume/.test(reason)));
});

it('a non-scratch path that is not the production volume stays LOCAL — and LOCAL is not FIXTURE', () => {
  const dev = classifyMissionDataSource({ ...base, ZA141251SA_DATABASE_URL: 'file:/var/lib/akbaral/mission.db' });
  assert.equal(dev.kind, 'local');
  assert.equal(dev.label, LOCAL_CLAIM_MARK);
  assert.notEqual(dev.label, FIXTURE_CLAIM_MARK, 'a developer database is not called a fixture');
  assert.equal(dev.productionClaimsAllowed, false, 'and it still cannot speak for the deployment');
  // NODE_ENV=production alone is not enough: the volume has to match too.
  const claimed = classifyMissionDataSource({ ...base, NODE_ENV: 'production', ZA141251SA_DATABASE_URL: 'file:/home/deploy/mission.db' });
  assert.equal(claimed.kind, 'local', 'production intent without the production volume is not a production claim');
  assert.ok(claimed.reasons.some(reason => /not enough to claim production/.test(reason)));
});

it('the fixture override can only lower authority, never raise it', () => {
  const forced = classifyMissionDataSource({ ...base, NODE_ENV: 'production', DATA_DIR: '/data', ZA141251SA_DATA_IS_FIXTURE: 'true' });
  assert.equal(forced.kind, 'fixture');
  assert.equal(forced.productionClaimsAllowed, false);
  assert.ok(forced.reasons.some(reason => /forces fixture classification/.test(reason)));
  const unforced = classifyMissionDataSource({ ...base, NODE_ENV: 'production', DATA_DIR: '/data', ZA141251SA_DATA_IS_FIXTURE: 'no' });
  assert.equal(unforced.kind, 'production', 'an unrecognized override value does not silently disable the guard');
});

it('a managed database URL is never echoed back as the source, because a DSN can hold a password', () => {
  // Assembled from parts rather than written as one DSN literal: a `user:pass@host` string in a
  // tracked file is exactly what the secret scanner looks for, and this test needs the shape, not
  // the literal. The synthetic value below is not a credential and is never printed by the code.
  const secretValue = 'synthetic-dsn-value-not-printed';
  const dsn = ['postgres://', `mission:${secretValue}@`, 'db.internal:5432/akbaral'].join('');
  const source = classifyMissionDataSource({ ...base, NODE_ENV: 'production', ZA141251SA_DATABASE_URL: dsn });
  assert.equal(source.engine, 'postgres');
  assert.ok(!source.source.includes(secretValue), 'the password is not in the source field');
  assert.ok(!source.source.includes('db.internal') && !source.source.includes('akbaral'), 'nor the host or database name');
  assert.equal(source.source, 'postgres://<url not printed>');
  assert.equal(source.kind, 'local', 'a URL cannot be path-classified, so it cannot claim production either');
});

it('the mark table is exhaustive and matches the three kinds', () => {
  assert.equal(claimMarkFor('production'), PRODUCTION_CLAIM_MARK);
  assert.equal(claimMarkFor('fixture'), FIXTURE_CLAIM_MARK);
  assert.equal(claimMarkFor('local'), LOCAL_CLAIM_MARK);
});
