/**
 * ZA141251SA registry sync — the knobs and the diagnosis, tested where they live.
 *
 * These two decisions used to sit inside `scripts/mission-sync-registry.ts`, which means the only
 * way to exercise them was to run a sync. A script with a top-level `main()` cannot be imported
 * without executing it (an attempt to do so in this repo's session started a real sync against the
 * checkout's data directory), so a typo'd `ZA141251SA_SYNC_BATCH` and a mis-classified connection
 * failure could only be discovered in production. Moving them into `registry-sync-config.ts` makes
 * them testable, and this file is that test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SYNC_BATCH_AGENTS,
  MAX_SYNC_BATCH_AGENTS,
  classifyProbeFailure,
  probeDiagnosis,
  syncBatchSize,
} from './registry-sync-config';

describe('ZA141251SA_SYNC_BATCH', () => {
  it('defaults to 500 agents per transaction when the operator says nothing', () => {
    assert.equal(syncBatchSize(''), DEFAULT_SYNC_BATCH_AGENTS);
    assert.equal(syncBatchSize(undefined), DEFAULT_SYNC_BATCH_AGENTS);
    assert.equal(syncBatchSize('   '), DEFAULT_SYNC_BATCH_AGENTS);
    assert.equal(DEFAULT_SYNC_BATCH_AGENTS, 500, 'the default is what production has always run with');
  });

  it('honors a deliberate value so a slow managed database can use smaller batches', () => {
    for (const value of ['1', '50', '250', '999']) assert.equal(syncBatchSize(value), Number(value));
    assert.equal(syncBatchSize(String(MAX_SYNC_BATCH_AGENTS)), MAX_SYNC_BATCH_AGENTS);
    assert.equal(syncBatchSize(`  ${MAX_SYNC_BATCH_AGENTS}  `), MAX_SYNC_BATCH_AGENTS, 'surrounding whitespace is not a typo');
  });

  it('refuses a value that would change the shape of the run, instead of clamping it', () => {
    // Clamping is the wrong kindness: an operator who typed 5000 and silently got 1000 would read
    // the per-batch log lines as if they had configured the run they asked for.
    for (const value of ['0', '-5', '1001', '50000', 'abc', '5.5', '5 0', '0x10', 'Infinity', 'NaN']) {
      assert.throws(() => syncBatchSize(value), /ZA141251SA_SYNC_BATCH must be a whole number/, `"${value}" must be refused by name`);
    }
    assert.throws(() => syncBatchSize('0'), /between 1 and 1000/);
  });

  it('reads the environment variable the documentation names', () => {
    const previous = process.env.ZA141251SA_SYNC_BATCH;
    try {
      process.env.ZA141251SA_SYNC_BATCH = '123';
      assert.equal(syncBatchSize(), 123, 'the sync script calls this with no argument, so the env is the contract');
    } finally {
      if (previous === undefined) delete process.env.ZA141251SA_SYNC_BATCH;
      else process.env.ZA141251SA_SYNC_BATCH = previous;
    }
  });
});

describe('mission database probe diagnosis', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['connect ECONNREFUSED 127.0.0.1:5432', 'refused', /socket was REFUSED/],
    ['read ECONNRESET', 'reset', /RESET/],
    ['getaddrinfo ENOTFOUND neon.example', 'reset', /RESET or the host never resolved/],
    ['timeout exceeded when trying to connect', 'slow', /OUT OF TIME/],
    ['connect ETIMEDOUT 10.0.0.5:5432', 'slow', /OUT OF TIME/],
    ['Connection terminated unexpectedly', 'not-postgres', /not as a usable PostgreSQL session/],
    ['error: no pg_hba.conf entry for host', 'not-postgres', /not as a usable PostgreSQL session/],
    ['something else entirely', 'unclassified', /does not classify/],
  ];

  it('classifies each socket-level failure by its evidence, not by a substring', () => {
    for (const [reason, kind] of cases) {
      assert.equal(classifyProbeFailure(reason), kind, `${reason} must classify as ${kind}`);
    }
    // The trap this exists to avoid: the message the command prints contains the word "TIMEOUT"
    // because it names the budget variables. Classification must never read its own text.
    assert.equal(
      classifyProbeFailure('connect ECONNREFUSED 127.0.0.1:5432 (AKBARAL_PG_CONNECT_TIMEOUT_MS was 30000)'),
      'refused',
      'a refused socket stays refused even when the word TIMEOUT appears',
    );
  });

  it('tells the operator what to do, and never claims a write happened', () => {
    for (const [reason, , pattern] of cases) {
      const diagnosis = probeDiagnosis(reason);
      assert.match(diagnosis, pattern, `${reason} must produce the ${pattern} explanation`);
      assert.match(diagnosis, /Nothing was written and no batch was started/);
      assert.match(diagnosis, /AKBARAL_PG_CONNECT_TIMEOUT_MS/, 'the budget that bound the attempt is named in the failure');
    }
  });

  it('points at the warm-the-database answer only for the slow case', () => {
    assert.match(probeDiagnosis('connect ETIMEDOUT 10.0.0.5:5432'), /AKBARAL_PG_CONNECT_ATTEMPTS/);
    assert.doesNotMatch(probeDiagnosis('connect ECONNREFUSED 127.0.0.1:5432'), /AKBARAL_PG_CONNECT_ATTEMPTS/);
  });
});
