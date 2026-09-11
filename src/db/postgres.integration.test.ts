/**
 * PostgreSQL integration tests for AKBARAL!'s critical database paths.
 *
 * These run ONLY when PG_TEST_DATABASE_URL is set, against a real
 * PostgreSQL engine (the PGlite wire-protocol harness by default —
 * `npm run test:pg` — or a real server/Neon URL). The regular `npm test`
 * suite remains SQLite-only, so CI without PostgreSQL simply skips this
 * file with a visible notice.
 *
 * Covered: the synchronous bridge itself, dialect translation, user
 * lifecycle (triggers + transactions), the trust/credit engine
 * (consume → refund → idempotent double-refund), task lifecycle, the
 * OR IGNORE billing-event guard, transaction rollback, and FTS knowledge
 * search parity between the engines.
 */
import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { db, Database, createUser, findUserByEmail, setUserPasswordHash, createTask, updateTaskStatus, consumeTaskCredit, refundTaskCredit, getCreditAccount, indexKnowledgeItem, searchKnowledge } from './index';
import { translateSqlForPg, placeholdersToPg, resolveDbEngine } from './database';

const PG_URL = process.env.PG_TEST_DATABASE_URL ?? '';
const RUN = PG_URL.length > 0;

const createdAt = Date.now();
const cleanup: Array<() => void> = [];

before(() => {
  if (!RUN) {
    console.log('[postgres.integration] PG_TEST_DATABASE_URL not set — SKIPPING (npm run test:pg to run)');
  }
});

after(() => {
  while (cleanup.length > 0) {
    const fn = cleanup.pop();
    try { fn?.(); } catch { /* best-effort teardown */ }
  }
});

describe('dialect translation (engine-agnostic unit checks)', { skip: !RUN ? 'requires PG_TEST_DATABASE_URL' : false }, () => {
  it('rewrites placeholders but never inside string literals', () => {
    assert.equal(placeholdersToPg("SELECT * FROM t WHERE a = ? AND b = 'why?' AND c = ?"), 'SELECT * FROM t WHERE a = $1 AND b = \'why?\' AND c = $2');
  });

  it('translates strftime to byte-identical ISO-8601 output', () => {
    assert.equal(
      translateSqlForPg("UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"),
      "UPDATE users SET updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') WHERE id = ?",
    );
  });

  it('translates json_extract to a json cast', () => {
    assert.equal(
      translateSqlForPg("SELECT json_extract(config, '$.specialization') AS s FROM agents"),
      "SELECT (config::json->>\"specialization\") AS s FROM agents",
    );
  });

  it('translates INSERT OR IGNORE to ON CONFLICT DO NOTHING', () => {
    assert.equal(
      translateSqlForPg('INSERT OR IGNORE INTO processed_billing_events (provider) VALUES (?)'),
      'INSERT INTO processed_billing_events (provider) VALUES (?) ON CONFLICT DO NOTHING',
    );
  });

  it('blocks PRAGMA on the PostgreSQL engine', () => {
    assert.throws(() => translateSqlForPg('PRAGMA integrity_check'));
  });

  it('translates FTS5 MATCH to websearch_to_tsquery', () => {
    assert.equal(
      translateSqlForPg('SELECT ki.id FROM knowledge_fts fts JOIN knowledge_items ki ON ki.rowid = fts.rowid WHERE knowledge_fts MATCH ?'),
      'SELECT ki.id FROM knowledge_fts fts JOIN knowledge_items ki ON ki.rowid = fts.rowid WHERE fts.tsv @@ websearch_to_tsquery(\'simple\', ?)',
    );
  });

  it('selects the engine from the URL scheme', () => {
    assert.equal(resolveDbEngine('postgres://u:p@h/db'), 'postgres');
    assert.equal(resolveDbEngine('postgresql://u:p@h/db'), 'postgres');
    assert.equal(resolveDbEngine('file:./data/akbaral.db'), 'sqlite');
    assert.equal(resolveDbEngine(':memory:'), 'sqlite');
  });
});

describe('PostgreSQL critical-path integration', { skip: !RUN ? 'requires PG_TEST_DATABASE_URL' : false }, () => {
  it('runs on the postgres engine with the full migration set', () => {
    assert.equal(db.engine, 'postgres');
    assert.ok(db.tableExists('users'), 'users table missing');
    assert.ok(db.tableExists('agents'), 'agents table missing');
    assert.ok(db.tableExists('knowledge_fts'), 'FTS mirror table missing');
    const agents = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM agents');
    assert.equal(agents?.c, 4001, 'agent registry must be exactly 4001');
  });

  it('user lifecycle: create, find, password update fires the updated_at trigger', () => {
    const email = `pg-int-${createdAt}@akbaral.test`;
    const user = createUser({ email, name: 'PG Integration', passwordHash: 'x', freeCredits: 1 });
    cleanup.push(() => db.run('DELETE FROM users WHERE id = ?', [user.id]));
    assert.equal(user.email, email);

    const found = findUserByEmail(email);
    assert.ok(found, 'user not found by email');

    setUserPasswordHash(user.id, 'newhash');
    const updated = findUserByEmail(email);
    assert.equal(updated?.password_hash, 'newhash');
    assert.ok(updated?.updated_at && updated.updated_at >= found!.updated_at, 'updated_at trigger did not advance');
  });

  it('credit engine: consume → refund → double refund is idempotent and atomic', () => {
    const email = `pg-credit-${createdAt}@akbaral.test`;
    const user = createUser({ email, name: 'PG Credit', freeCredits: 2 });
    cleanup.push(() => db.run('DELETE FROM users WHERE id = ?', [user.id]));

    const task = createTask({ userId: user.id, title: 'pg credit task' });

    const consumed = consumeTaskCredit({ userId: user.id, taskId: task.id });
    assert.ok(consumed, 'consume failed');
    let account = getCreditAccount(user.id)!;
    assert.equal(account.free_credits, 1, 'exactly one free credit must be consumed');

    const refunded = refundTaskCredit({ userId: user.id, taskId: task.id });
    assert.ok(refunded, 'refund failed');
    account = getCreditAccount(user.id)!;
    assert.equal(account.free_credits, 2, 'credit must be restored');

    const doubleRefund = refundTaskCredit({ userId: user.id, taskId: task.id });
    account = getCreditAccount(user.id)!;
    assert.equal(account.free_credits, 2, 'double refund must not double-credit');
    assert.equal(doubleRefund?.id, refunded?.id, 'idempotent refund returns the original transaction');

    const doubleConsume = consumeTaskCredit({ userId: user.id, taskId: task.id });
    account = getCreditAccount(user.id)!;
    assert.equal(account.free_credits, 2, 're-consuming a refunded task must not consume again');
    assert.equal(doubleConsume?.id, consumed?.id, 'idempotent consume returns the original transaction');
  });

  it('task lifecycle: create → running → completed with status transitions', () => {
    const email = `pg-task-${createdAt}@akbaral.test`;
    const user = createUser({ email, name: 'PG Task' });
    cleanup.push(() => db.run('DELETE FROM users WHERE id = ?', [user.id]));

    const task = createTask({ userId: user.id, title: 'pg lifecycle', inputData: { goal: 'test goal' } });
    updateTaskStatus({ id: task.id, status: 'running' });
    updateTaskStatus({ id: task.id, status: 'completed' });

    const row = db.get<{ status: string; input_data: string }>('SELECT status, input_data FROM tasks WHERE id = ?', [task.id]);
    assert.equal(row?.status, 'completed');
    assert.equal(JSON.parse(row!.input_data).goal, 'test goal');
  });

  it('INSERT OR IGNORE guard: billing events deduplicate', () => {
    const email = `pg-dedup-${createdAt}@akbaral.test`;
    const user = createUser({ email, name: 'PG Dedup' });
    cleanup.push(() => db.run('DELETE FROM users WHERE id = ?', [user.id]));
    const eventKey = `evt-pg-${createdAt}`;

    const run = () => db.run(
      'INSERT OR IGNORE INTO processed_billing_events (provider, provider_event_id, event_type, processed_at) VALUES (?, ?, ?, ?)',
      ['stripe', eventKey, 'payment.succeeded', new Date().toISOString()],
    );
    const first = run();
    const second = run();
    assert.ok(first.changes === 1, 'first insert must apply');
    assert.ok(second.changes === 0, 'duplicate insert must be ignored');
    cleanup.push(() => db.run('DELETE FROM processed_billing_events WHERE provider_event_id = ?', [eventKey]));
  });

  it('transactions roll back atomically on error', () => {
    const email = `pg-tx-${createdAt}@akbaral.test`;
    const user = createUser({ email, name: 'PG Tx' });
    cleanup.push(() => db.run('DELETE FROM users WHERE id = ?', [user.id]));

    assert.throws(() =>
      db.transaction(() => {
        db.run("UPDATE users SET name = 'should-not-persist' WHERE id = ?", [user.id]);
        throw new Error('intentional rollback');
      }),
    );
    const row = db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [user.id]);
    assert.equal(row?.name, 'PG Tx', 'rollback did not restore the row');
    assert.equal(db.isTransaction, false, 'transaction flag must reset after rollback');
  });

  it('FTS knowledge search finds indexed content', () => {
    const email = `pg-fts-${createdAt}@akbaral.test`;
    const user = createUser({ email, name: 'PG FTS' });
    cleanup.push(() => db.run('DELETE FROM users WHERE id = ?', [user.id]));

    const item = indexKnowledgeItem({
      userId: user.id,
      title: 'Quantum flux capacitor notes',
      content: 'The quantum flux capacitor stabilizes temporal drift in orchestration pipelines.',
    });

    const hits = searchKnowledge(user.id, 'quantum flux') as Array<{ id: string }>;
    assert.ok(hits.some((h) => h.id === item.id), 'FTS search must find the indexed item by query');

    const misses = searchKnowledge(user.id, 'zimbabwe unicycle') as Array<{ id: string }>;
    assert.equal(misses.filter((m) => m.id === item.id).length, 0, 'FTS must not match unrelated terms');
  });

  it('constructed Database instances report postgres and honor close()', () => {
    const extra = new Database(PG_URL);
    assert.equal(extra.engine, 'postgres');
    const one = extra.get<{ ready: number }>('SELECT 1 AS ready');
    assert.equal(one?.ready, 1);
    extra.close();
    assert.equal(extra.isOpen, false);
  });
});
