/**
 * Mission migrations are a boot contract, not an incidental side effect.
 *
 * Production proved what the old shape of this code meant: 49 mission migration files in
 * `db/migrations-mission/`, 45 recorded in the live `mission_migrations` ledger, no
 * mission-migration line in the boot log at all, and `npm run mission:sync-registry` dying on
 * `column "provider_key" of relation "model_providers" does not exist` — because the mission's
 * 0043 and the platform's 0002 had picked the same table name, and the only code that ever
 * applied mission migrations sat behind a flag this deployment did not set.
 *
 * Every assertion below is on behaviour, in the shape the runtime actually has: a boot that
 * applies what is missing, a failure that aborts the boot instead of being logged as a success,
 * and mission commands that resolve their imports in a `dist/`-only image.
 */
import { after, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The repo's mission-test idiom: PostgreSQL when the harness gives us one, a throwaway SQLite
// file otherwise. `npm run mission:pg-check` sets PG_TEST_DATABASE_URL, so this one file runs
// against both engines.
const PG = Boolean(process.env.PG_TEST_DATABASE_URL);
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(makeTemp('mission-boot-db-'), 'mission.db')}`;
process.env.ZA141251SA_CREDENTIAL_KEY = 'synthetic-chat-vault-key-not-real-0123456789';

const {
  applyMissionMigrations,
  applyMissionMigrationsFrom,
  isolateMissionModelProviderTable,
  migrationsDir,
  missionDb,
} = require('./database') as typeof import('./database');

function makeTemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

after(() => {
  try {
    missionDb.close();
  } catch {
    /* never opened */
  }
});

function ledgerNames(): string[] {
  return missionDb.all<{ name: string }>('SELECT name FROM mission_migrations ORDER BY name').map((row) => String(row.name));
}

function allFiles(): string[] {
  return fs.readdirSync(migrationsDir()).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * Drop a probe table. PostgreSQL also needs the dependent mission tables' foreign keys
 * dropped with it, which is what CASCADE is for; SQLite has no such clause. The production
 * path never drops anything — isolateMissionModelProviderTable() renames — so this exists
 * only to put the probe's own tables back.
 */
function dropProbeTable(table: string): void {
  missionDb.exec(
    missionDb.engineName() === 'postgres' ? `DROP TABLE IF EXISTS ${table} CASCADE` : `DROP TABLE IF EXISTS ${table}`,
  );
}

/** A scratch copy of the migration set, so a probe can re-apply one file safely. */

function columnsOf(table: string): string[] {
  return missionDb
    .all<{ column_name?: string; name?: string }>(
      missionDb.engineName() === 'postgres'
        ? 'SELECT column_name FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position'
        : `SELECT name FROM pragma_table_info('${table}')`,
      missionDb.engineName() === 'postgres' ? [table] : [],
    )
    .map((row) => String(row.column_name ?? row.name));
}

const ROLLBACK = Symbol('mission-test-rollback');

/**
 * Run mutating DDL and put the database back. Both engines roll DDL back inside a
 * transaction, which is what lets the shared PostgreSQL test database (used by every other
 * mission test file in the same run) be exercised for the collision cases without any of it
 * leaking out.
 */
function withRollback(fn: () => void): void {
  missionDb.transaction(() => {
    fn();
    throw ROLLBACK;
  });
}

function tryRollback(fn: () => void): void {
  try {
    withRollback(fn);
    throw new Error('the probe transaction committed when it must have rolled back');
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

const run = applyMissionMigrations(missionDb);
const TOTAL = allFiles().length;

it(`applies the whole shipped mission set on ${missionDb.engineName()} (${TOTAL} files)`, () => {
  const ledger = ledgerNames();
  assert.equal(ledger.length, TOTAL, `mission_migrations must record every file; it recorded ${ledger.length}`);
  for (const file of allFiles()) assert.ok(ledger.includes(file), `${file} is missing from the ledger`);
  assert.ok(run.total >= 49, `the mission set is ${run.total} files; the 49 numbered migrations plus their dialect twins are expected`);
});

it('a boot against a database frozen at 0042 ends with the whole set applied, through the real boot entry', (t) => {
  if (PG) {
    t.skip('this case needs a file database it can create and reopen; the PostgreSQL run shares one database');
    return;
  }
  const dir = migrationsDir();
  const files = allFiles();
  // The frozen state is "every migration numbered 0042 or lower". Comparing the number rather
  // than matching 0043-0049 keeps this fixture honest as the set grows: a filter written against
  // one release's numbering silently starts treating the next release's files as already applied,
  // which is how this case would have begun asserting the wrong thing the day 0050 shipped.
  const upTo0042 = files.filter((f) => Number(f.slice(0, 4)) <= 42);
  assert.equal(
    upTo0042.length,
    45,
    `the stuck production ledger is 45 rows: the 42 numbered migrations up to 0042 plus the three shared-number files (observed ${upTo0042.length} of ${files.length}, latest in the frozen set: ${upTo0042.slice(-3).join(', ')})`,
  );

  const root = makeTemp('mission-boot-root-');
  const seedDir = path.join(root, 'db', 'migrations-mission');
  fs.mkdirSync(seedDir, { recursive: true });
  for (const file of upTo0042) fs.copyFileSync(path.join(dir, file), path.join(seedDir, file));
  const dbFile = path.join(root, 'mission.db');
  const url = `file:${dbFile}`;

  // 1. A database at exactly the state production was in, reached the way production reached
  //    it: the boot entry, run from a root that only has the files up to 0042.
  const frozen = runMigrateEntry(url, root);
  assert.equal(frozen.status, 0, `first boot must succeed:\n${frozen.stdout}${frozen.stderr}`);
  assert.match(frozen.stdout, new RegExp(`applied ${upTo0042.length} of ${upTo0042.length} files in this run`), frozen.stdout);

  // 2. The same database, the real migration directory: the boot entry must finish the job.
  const resumed = runMigrateEntry(url, process.cwd());
  assert.equal(resumed.status, 0, `a boot with 45 recorded files must apply the rest and exit 0:\n${resumed.stdout}${resumed.stderr}`);
  assert.match(
    resumed.stdout,
    new RegExp(`applied ${files.length - upTo0042.length} of ${files.length} files in this run`),
    resumed.stdout,
  );
  assert.match(resumed.stdout, new RegExp(`ledger after: ${files.length}/${files.length}`), resumed.stdout);
  assert.match(resumed.stdout, /foreign keys after: clean/, resumed.stdout);
  assert.ok(!/FAILED/.test(`${resumed.stdout}${resumed.stderr}`), 'the resumed boot must not report a failure');

  // 3. And a third start says exactly what a start on a migrated database must say.
  const third = runMigrateEntry(url, process.cwd());
  assert.equal(third.status, 0, third.stderr);
  assert.match(third.stdout, /up to date — all \d+ migration files are applied/, third.stdout);
});

it('a migration that throws aborts the run: its file is not recorded and its message surfaces verbatim', () => {
  const dir = makeTemp('mission-bad-migration-');
  for (const file of allFiles().slice(0, 3)) fs.copyFileSync(path.join(migrationsDir(), file), path.join(dir, file));
  fs.writeFileSync(path.join(dir, '9998_planted_broken.sql'), 'SELECT this_function_does_not_exist(1);\n');

  const before = ledgerNames();
  assert.throws(
    () => applyMissionMigrationsFrom(dir, missionDb),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      // The engine's own words, not a wrapper summarising them away.
      assert.match(message, /this_function_does_not_exist|no such function/i, message);
      return true;
    },
    'a planted broken migration must throw, never be skipped',
  );
  assert.deepEqual(ledgerNames(), before, 'a failed migration must not add a ledger row');
});

it('a mission migration failure aborts the container boot, loudly — never logged as a success', () => {
  const root = makeTemp('mission-boot-abort-');
  // A runtime-image-shaped tree: dist/, db/, .next/ and package.json — and no src/.
  fs.mkdirSync(path.join(root, 'dist', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist', 'src', 'db'), { recursive: true });
  fs.mkdirSync(path.join(root, '.next'), { recursive: true });
  fs.mkdirSync(path.join(root, 'db', 'migrations-mission'), { recursive: true });
  fs.writeFileSync(path.join(root, '.next', 'BUILD_ID'), 'test-build\n');
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'mission-boot-abort-probe', version: '0.0.0' })}\n`);
  // The platform step is not what this test is about: let it pass, then plant a mission
  // migration entry that fails the way a real one does — non-zero, with a message.
  fs.writeFileSync(path.join(root, 'dist', 'src', 'db', 'migrate.js'), "console.log('[db:migrate] database is up to date (probe)');\n");
  fs.writeFileSync(path.join(root, 'dist', 'src', 'index.js'), "console.log('api tier must never be launched');\n");
  fs.writeFileSync(path.join(root, 'dist', 'scripts', 'mission-serve.js'), "console.log('mission child must never be launched');\n");
  fs.writeFileSync(
    path.join(root, 'dist', 'scripts', 'mission-migrate.js'),
    "console.error('planted mission migration failure: relation \"x\" does not exist');\nprocess.exit(1);\n",
  );
  // The file-target precondition is met by an existing (empty) database file, so the failure
  // this test looks for is the migration's, not the mount check's.
  fs.writeFileSync(path.join(root, 'mission.db'), '');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    DATA_DIR: root,
    DATABASE_URL: `file:${path.join(root, 'akbaral.db')}`,
    ZA141251SA_DATABASE_URL: `file:${path.join(root, 'mission.db')}`,
    ZA141251SA_MISSION_SERVER_ENABLED: 'true',
    SESSION_SECRET: 'synthetic-session-secret-for-boot-probe-0123456789',
    // Cleared so this probe cannot inherit a developer's or a CI job's overrides:
    // undefined means unset in the child, exactly as if the variable were absent.
    AKBARAL_ROLES: undefined,
    MISSION_DATABASE_URL: undefined,
    AKBARAL_AUTO_BUILD: undefined,
  };

  const boot = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'start-prod.mjs')], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 90_000,
  });
  const out = `${boot.stdout ?? ''}${boot.stderr ?? ''}`;
  assert.notEqual(boot.status, 0, `the boot must not succeed past a failed mission migration; output:\n${out}`);
  assert.match(out, /applying mission database migrations/, `the boot log must name the step it ran:\n${out}`);
  assert.match(out, /planted mission migration failure/, `the child's error must reach the container log verbatim:\n${out}`);
  assert.match(out, /exited with code 1/, `the wrapper must report the exit code it saw:\n${out}`);
  assert.doesNotMatch(out, /AKBARAL_ROLES=/, 'a boot that failed on migrations must never reach the tier banner');
});

it('every mission command resolves its entry in a runtime-image-shaped tree (dist/ only, no src/)', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  const mission = Object.entries(pkg.scripts).filter(([name]) => name.startsWith('mission:'));
  assert.ok(mission.length >= 13, `expected the full mission command set, found ${mission.length}`);

  const entries = new Map<string, string[]>();
  for (const [name, command] of mission) {
    // A mission command either runs a plain .mjs tool (no TypeScript, therefore no src/
    // imports) or goes through the resolver. Bare `tsx scripts/…` is exactly the shape that
    // cannot work in the runtime image, so it must not come back.
    assert.doesNotMatch(command, /(^|\s)tsx scripts\//, `${name} still runs its entry with bare tsx: ${command}`);
    for (const match of command.matchAll(/mission-run\.mjs\s+([a-z0-9-]+)/g)) {
      entries.set(match[1]!, [...(entries.get(match[1]!) ?? []), name]);
    }
    for (const match of command.matchAll(/node (scripts\/[a-z0-9-]+\.mjs)/g)) {
      assert.ok(fs.existsSync(match[1]!), `${name} points at ${match[1]}, which does not exist`);
    }
  }
  assert.ok(entries.size >= 11, `expected the mission entries to route through the resolver, saw ${entries.size}`);

  const root = makeTemp('mission-entry-shape-');
  fs.mkdirSync(path.join(root, 'dist', 'scripts'), { recursive: true });
  for (const entry of entries.keys()) {
    assert.ok(
      fs.existsSync(path.join('scripts', `${entry}.ts`)),
      `scripts/${entry}.ts is missing but ${entries.get(entry)!.join(', ')} invokes it (tsconfig.backend.json compiles scripts/*.ts into dist/scripts/*.js)`,
    );
    fs.writeFileSync(path.join(root, 'dist', 'scripts', `${entry}.js`), `console.log('resolved:${entry}');\n`);
    const ran = spawnSync(process.execPath, [path.join('scripts', 'mission-run.mjs'), '--root', root, entry], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
    });
    const out = `${ran.stdout ?? ''}${ran.stderr ?? ''}`;
    assert.equal(ran.status, 0, `${entry} must run from a dist/-only tree:\n${out}`);
    assert.match(out, new RegExp(`resolved:${entry}`), `${entry} did not execute the compiled entry:\n${out}`);
    assert.match(out, /compiled entry dist\/scripts/, `${entry} did not say which file it ran:\n${out}`);
    assert.ok(!/MODULE_NOT_FOUND|Cannot find module/.test(out), `${entry} could not resolve its imports in the image shape:\n${out}`);
  }
});

it('the mission provider table ends with exactly the columns the mission code writes', () => {
  const columns = columnsOf('mission_model_providers');
  assert.ok(columns.length > 0, 'mission_model_providers must exist after the migration set runs');

  const source = fs.readFileSync('src/mission/earning/model-layer.ts', 'utf8');
  const written = new Set<string>();
  const insert = source.match(/INSERT INTO mission_model_providers\s*\(([^)]*)\)/);
  assert.ok(insert, 'the provider registry write must name its columns');
  for (const token of insert![1]!.split(',')) written.add(token.trim());
  const update = source.match(/UPDATE mission_model_providers SET ([^`]*) WHERE id=\?/);
  assert.ok(update, 'the provider patch write must name its columns');
  for (const token of update![1]!.split(',')) written.add(token.trim().split('=')[0]!.trim());

  assert.ok(written.size >= 12, `expected the provider writes to name their columns, parsed ${written.size}`);
  const missing = [...written].filter((column) => !columns.includes(column));
  assert.deepEqual(missing, [], `columns the code writes but the migrated schema does not have: ${missing.join(', ')}`);
  assert.ok(written.has('provider_key'), 'the column whose absence froze the mission schema is part of the contract');

  for (const platformOnly of ['key', 'type', 'docs_url', 'api_version', 'env_key', 'capabilities']) {
    assert.ok(!columns.includes(platformOnly), `mission_model_providers must not carry the platform column ${platformOnly}`);
  }
});

it('a database that shares its schema with the platform ends with BOTH provider tables complete', (t) => {
  if (PG) {
    t.skip(
      'this case needs a fresh database it can create and reopen, and the PostgreSQL run shares one. ' +
        'The rule that keeps a shared schema safe is pinned for both engines by the shipped-SQL check ' +
        'below, and the rename that repairs an already-collided database by the case after it.',
    );
    return;
  }
  const root = makeTemp('mission-shared-schema-');
  const dbFile = path.join(root, 'mission.db');
  const url = `file:${dbFile}`;

  // The production shape, on a database nobody has migrated yet: the platform went first and
  // created its own `model_providers` (db/migrations-pg/0002_platform.sql:267,
  // db/migrations/0002_platform.sql:255). Then the mission set is applied to the same schema.
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const seed = new DatabaseSync(dbFile);
  seed.exec(
    `CREATE TABLE model_providers (
       id TEXT PRIMARY KEY,
       key TEXT NOT NULL UNIQUE,
       name TEXT NOT NULL,
       type TEXT NOT NULL DEFAULT 'llm',
       base_url TEXT,
       docs_url TEXT,
       api_version TEXT,
       auth_type TEXT NOT NULL DEFAULT 'bearer',
       env_key TEXT,
       status TEXT NOT NULL DEFAULT 'disabled',
       capabilities TEXT,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  );
  seed
    .prepare(
      `INSERT INTO model_providers (id,key,name,auth_type,status,created_at,updated_at)
       VALUES ('platform-probe','platform-provider','Platform-owned provider row','bearer','disabled',?,?)`,
    )
    .run('2026-10-12T00:00:00.000Z', '2026-10-12T00:00:00.000Z');
  seed.close();

  const boot = runMigrateEntry(url, process.cwd());
  const out = `${boot.stdout ?? ''}${boot.stderr ?? ''}`;
  assert.equal(boot.status, 0, `the mission set must apply into a schema the platform already used:\n${out}`);
  assert.match(out, new RegExp(`ledger after: ${TOTAL}/${TOTAL}`), out);
  assert.match(out, /foreign keys after: clean/, out);

  const check = new DatabaseSync(dbFile);
  try {
    const columnsOf = (table: string): string[] =>
      (check.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((row) => String(row.name));
    const platformColumns = columnsOf('model_providers');
    assert.ok(platformColumns.includes('key'), 'the platform table must still be the platform table');
    assert.ok(
      !platformColumns.includes('provider_key') && !platformColumns.includes('display_name'),
      `the mission must not have altered the platform table; it now has ${platformColumns.join(', ')}`,
    );
    assert.equal(
      (check.prepare(`SELECT COUNT(*) AS count FROM model_providers WHERE key = 'platform-provider'`).get() as { count: number }).count,
      1,
      'the platform row must survive the mission migration run untouched',
    );
    assert.equal(
      (
        check
          .prepare(
            `SELECT COUNT(*) AS count FROM mission_model_providers
             WHERE provider_key IN ('google','openai','anthropic','openrouter','groq','together','deepseek','ollama')`,
          )
          .get() as { count: number }
      ).count,
      8,
      '0043 must seed its eight capability rows into the mission table',
    );
  } finally {
    check.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('no shipped mission migration may name the table the platform owns', () => {
  // `model_providers` is the platform's name (db/migrations-pg/0002_platform.sql:267,
  // db/migrations/0002_platform.sql:255). Mission 0043 used to create and seed that exact
  // name, which is what froze a production mission schema at 0042: on a shared schema the
  // name was already taken by the platform's columns, so every later file that needed
  // `provider_key` failed. This is a hair trigger, not a proof — a name assembled inside a
  // quoted EXECUTE string would slip past it — and the case above is the behavioural one.
  const offenders: string[] = [];
  for (const file of allFiles()) {
    const executable = fs
      .readFileSync(path.join(migrationsDir(), file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ')
      .replace(/'(?:[^']|'')*'/g, "''");
    const hits = executable.match(/\bmodel_providers\b/g) ?? [];
    if (hits.length > 0) offenders.push(`${file}: ${hits.length} reference(s) to the shared name`);
  }
  assert.deepEqual(offenders, [], `mission migrations must speak only of mission_model_providers:\n${offenders.join('\n')}`);
});

it('the mission server migrates before it listens, and a failed migration is rethrown, not swallowed', () => {
  // Structural pin on the second boot path. `scripts/start-prod.mjs` applies the set for
  // the container, and `startMissionServer()` applies it again for whoever runs the mission
  // server directly (`npm run mission:serve`); only the source guarantees the second one
  // cannot repeat the production bug — a migration error caught and logged as a skip,
  // with the socket then opened on an unmigrated schema.
  // Resolved next to the module under test, not from the cwd: the same file has to be the
  // one that is inspected whether this runs from the repo or a copied working tree.
  const source = fs.readFileSync(path.join(path.dirname(require.resolve('./database')), 'server.ts'), 'utf8');
  const listen = source.indexOf('server.listen(');
  assert.ok(listen > 0, 'expected startMissionServer to bind a socket');
  const boot = source.indexOf('migration = applyMissionMigrations(missionDb)');
  assert.ok(boot > 0, 'the mission server must apply its own migrations before binding');
  assert.ok(boot < listen, 'migrations must come before the listen, not after');
  const guard = source.slice(boot, listen);
  assert.match(guard, /FATAL: mission database migrations failed/, 'a failed mission migration must be reported as fatal');
  assert.match(guard, /throw error;/, 'and it must abort the start rather than continue');
  assert.doesNotMatch(
    source.slice(boot, source.indexOf('ensurePolicy(env.currency)')),
    /catch\s*\([^)]*\)\s*\{[^}]*\}\s*(?!.*throw)/s,
    'no migration failure may be caught and continued past',
  );
});

it('renames a legacy mission-shaped provider table once, keeps its rows, and leaves a platform table alone', () => {
  tryRollback(() => {
    const legacyMissionShape = `CREATE TABLE model_providers (
        id TEXT PRIMARY KEY,
        provider_key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        credential_vault_key TEXT NOT NULL,
        models_available_json TEXT NOT NULL DEFAULT '[]',
        default_model TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        cost_per_1k_in REAL NOT NULL DEFAULT 0,
        cost_per_1k_out REAL NOT NULL DEFAULT 0,
        max_concurrency INTEGER NOT NULL DEFAULT 1,
        rate_limit_per_min INTEGER NOT NULL DEFAULT 1,
        health_status TEXT NOT NULL DEFAULT 'unknown',
        last_health_check_at TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        supports_json_schema INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`;

    // A database that applied the OLD 0043: the mission's table, under the shared name.
    dropProbeTable('mission_model_providers');
    dropProbeTable('model_providers');
    missionDb.exec(legacyMissionShape);
    missionDb.run(
      'INSERT INTO model_providers (id,provider_key,display_name,base_url,credential_vault_key,default_model,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      ['mp-probe', 'probe', 'Probe provider', 'https://example.invalid/v1', 'model.probe.api_key', 'probe-model', '2026-10-12T00:00:00.000Z', '2026-10-12T00:00:00.000Z'],
    );

    // A child row that points at the provider, so the rename is proven to carry the
    // relationships with it and not just the name. Both tables here belong to the probe (the
    // real ones are put back by the rollback), because dropping a parent table that another
    // table references is exactly the kind of edit this probe must not do to live schema.
    dropProbeTable('model_health_events');
    missionDb.exec(
      `CREATE TABLE model_health_events (
         id TEXT PRIMARY KEY,
         provider_id TEXT NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
         occurred_at TEXT NOT NULL,
         status TEXT NOT NULL,
         latency_ms INTEGER,
         error_class TEXT,
         recovery_at TEXT
       )`,
    );
    missionDb.run('INSERT INTO model_health_events (id,provider_id,occurred_at,status) VALUES (?,?,?,?)', [
      'mhe-probe',
      'mp-probe',
      '2026-10-12T00:00:00.000Z',
      'ok',
    ]);

    const first = isolateMissionModelProviderTable(missionDb);
    assert.equal(first.renamed, true, first.reason);
    assert.ok(!missionDb.tableExists('model_providers'), 'the shared name must be released back to the platform');
    assert.ok(missionDb.tableExists('mission_model_providers'), 'the mission table must carry the mission name');
    assert.equal(
      missionDb.get<{ display_name: string }>('SELECT display_name FROM mission_model_providers WHERE provider_key = ?', ['probe'])?.display_name,
      'Probe provider',
      'the rename must keep the rows',
    );

    // The child table must still be constrained to the renamed provider table. Inspected
    // rather than provoked: this probe runs inside one transaction, and on PostgreSQL a
    // raised error aborts the whole transaction, which would mask every check below it.
    const childDdl =
      missionDb.engineName() === 'postgres'
        ? (missionDb.get<{ parents: string | null }>(
            `SELECT string_agg(confrelid::regclass::text, ',') AS parents
               FROM pg_constraint
              WHERE conrelid = 'model_health_events'::regclass AND contype = 'f'`,
          )?.parents ?? '')
        : (missionDb.get<{ sql: string | null }>(
            `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'model_health_events'`,
          )?.sql ?? '');
    assert.match(childDdl, /mission_model_providers/, 'the child foreign key must follow the renamed parent');
    const referencesToSharedName =
      (childDdl.match(/model_providers/g) ?? []).length - (childDdl.match(/mission_model_providers/g) ?? []).length;
    assert.equal(referencesToSharedName, 0, 'the child table must not still point at the shared name');

    const second = isolateMissionModelProviderTable(missionDb);
    assert.equal(second.renamed, false);
    assert.match(second.reason, /already exists/);

    // A platform-shaped table of that name is never touched.
    dropProbeTable('model_health_events');
    dropProbeTable('mission_model_providers');
    dropProbeTable('model_providers');
    missionDb.exec(
      legacyMissionShape.replace('provider_key TEXT NOT NULL UNIQUE', 'key TEXT NOT NULL UNIQUE').replace('display_name TEXT NOT NULL', 'name TEXT NOT NULL'),
    );
    const third = isolateMissionModelProviderTable(missionDb);
    assert.equal(third.renamed, false);
    assert.match(third.reason, /left untouched/);
    assert.ok(missionDb.tableExists('model_providers'), 'a platform-shaped table stays exactly where the platform put it');
  });
});

/** Spawn the real boot entry against a chosen database, from a chosen root. */
function runMigrateEntry(databaseUrl: string, cwd: string) {
  const compiled = path.join('dist', 'scripts', 'mission-migrate.js');
  const args = fs.existsSync(compiled)
    ? [path.join(process.cwd(), compiled)]
    : [path.join(process.cwd(), 'node_modules', '.bin', 'tsx'), path.join(process.cwd(), 'scripts', 'mission-migrate.ts')];
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, ZA141251SA_DATABASE_URL: databaseUrl },
  });
}
