import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { splitSqlStatements, translateScriptForPg, translateSqlForPg } from './driver';

/**
 * Dialect translation regressions that made the PRIVATE mission system
 * impossible to run on managed PostgreSQL (Neon) — the exact database the
 * zero-cost production architecture depends on:
 *
 *   1. SQLite INTEGER is 64-bit, PostgreSQL INTEGER is 32-bit. Mission
 *      migration 0008 writes a $1,000,000,000 daily target (100,000,000,000
 *      cents) and the whole schema died with `integer out of range`.
 *   2. `exec()` receives whole migration files, but every dialect rule is
 *      written for one statement, so only the first statement was translated
 *      (`syntax error at or near "OR"` on a mid-file INSERT OR IGNORE).
 *   3. A statement that starts with a comment was not recognised as an upsert.
 *   4. `datetime('now', …)` has no PostgreSQL equivalent and must keep
 *      returning ISO-8601 TEXT, because every timestamp column is TEXT.
 */
describe('postgres dialect translation', () => {
  it('widens integer COLUMN types to 64-bit, because money is stored in cents', () => {
    assert.match(
      translateSqlForPg('ALTER TABLE mission_agents ADD COLUMN daily_target_cents INTEGER NOT NULL DEFAULT 100000000000'),
      /daily_target_cents BIGINT NOT NULL DEFAULT 100000000000/,
    );
    assert.match(
      translateSqlForPg('CREATE TABLE t (cents INTEGER NOT NULL DEFAULT 0, n INTEGER)'),
      /cents BIGINT NOT NULL DEFAULT 0, n BIGINT/,
    );
  });

  it('never rewrites an identity column or a cast', () => {
    const identity = 'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, cents INTEGER NOT NULL)';
    assert.match(translateSqlForPg(identity), /id INTEGER PRIMARY KEY AUTOINCREMENT/, 'key semantics must not change silently');
    assert.equal(translateSqlForPg('SELECT CAST(x AS INTEGER) FROM t'), 'SELECT CAST(x AS INTEGER) FROM t');
    assert.equal(
      translateSqlForPg('UPDATE mission_policy SET daily_revenue_target_cents = 100000000000'),
      'UPDATE mission_policy SET daily_revenue_target_cents = 100000000000',
      'non-DDL statements are untouched',
    );
  });

  it('translates every datetime() form to ISO-8601 TEXT (columns are TEXT)', () => {
    const iso = /to_char\(.*'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\)/;
    assert.match(translateSqlForPg("INSERT INTO t VALUES (datetime('now'))"), iso);
    assert.match(translateSqlForPg("SELECT * FROM t WHERE a >= datetime('now', '-30 days')"), /interval '-30 days'/);
    assert.match(translateSqlForPg("SELECT * FROM t WHERE a >= datetime('now','-10 minutes')"), /interval '-10 minutes'/);
    assert.match(
      translateSqlForPg("SELECT * FROM t WHERE a >= datetime('now', '-' || ? || ' days')"),
      /\(\(\?\)::text \|\| ' days'\)::interval/,
      'the parameterised form keeps exactly one placeholder so $n rewriting still lines up',
    );
    assert.match(translateSqlForPg('SELECT datetime(created_at) FROM t'), /\(created_at\)::timestamp/);
  });

  it('recognises INSERT OR IGNORE even when the statement starts with comments', () => {
    const statement = "-- seed marker\nINSERT OR IGNORE INTO t (id) VALUES ('x');";
    const translated = translateSqlForPg(statement);
    assert.match(translated, /INSERT INTO t \(id\) VALUES \('x'\) ON CONFLICT DO NOTHING/);
    assert.equal(/INSERT OR IGNORE/i.test(translated), false);
  });

  it('splits scripts without being fooled by semicolons inside strings or comments', () => {
    const script = [
      "INSERT INTO t (note) VALUES ('a; b');",
      '-- a comment with ; inside',
      '/* block ; comment */',
      'CREATE TABLE u (cents INTEGER NOT NULL);',
    ].join('\n');
    const statements = splitSqlStatements(script);
    assert.equal(statements.length, 2, 'two real statements');
    assert.match(statements[0], /'a; b'/);
    const translated = translateScriptForPg(script);
    assert.match(translated, /cents BIGINT NOT NULL/, 'rules apply to statements after the first');
    assert.match(translated, /'a; b'/, 'string literals survive intact');
  });

  it('translates the real mission migration that used to break PostgreSQL', () => {
    const file = path.resolve(process.cwd(), 'db', 'migrations-mission', '0008_billionaire_daily_per_agent.sql');
    const translated = translateScriptForPg(readFileSync(file, 'utf8'));
    assert.match(translated, /daily_target_cents BIGINT NOT NULL DEFAULT 100000000000/);
    assert.match(translated, /target_cents BIGINT NOT NULL/, 'the progress table is widened too');
    assert.equal(/ADD COLUMN \w+ INTEGER\b/i.test(translated), false, 'no 32-bit money column may survive translation');
  });

  it('every mission migration translates without leaving a SQLite-only construct behind', () => {
    const dir = path.resolve(process.cwd(), 'db', 'migrations-mission');
    const files = readFileSync(path.resolve(dir, '0008_billionaire_daily_per_agent.sql'), 'utf8');
    assert.ok(files.length > 0);
    // The full-schema proof is `npm run mission:pg-check` (real PostgreSQL
    // server, 37 migrations, 125 tables). Here we lock the two constructs that
    // silently produced invalid SQL.
    const translated = translateScriptForPg(readFileSync(path.resolve(dir, '0031_provider_readiness.sql'), 'utf8'));
    assert.equal(/INSERT OR IGNORE/i.test(translated), false);
    assert.equal(/datetime\('now'/i.test(translated), false);
  });
});
