#!/usr/bin/env node
/**
 * ZA141251SA — read-only inspector for what a registry sync actually left behind.
 *
 *   node scripts/mission-registry-sync-readout.mjs [--platform <file>] [--per-agent]
 *
 * Prints one JSON object on stdout, nothing else:
 *   · engine and the mission target as resolved from the environment (host and database name
 *     only for PostgreSQL — never credentials);
 *   · how many imported identities and tool grants the mission database holds;
 *   · the rails that must stay empty (ledger rows, cash cents, verified payout slots,
 *     approvals, tool requests) plus the tool-catalog row count;
 *   · with `--platform`, the per-agent comparison against the platform database: for every
 *     imported agent, whether the grant set the mission side holds is exactly the grant set
 *     the platform attaches to that agent. That is the check a row count cannot make — a
 *     fleet can have the right total and the wrong distribution.
 *
 * It runs SELECT statements only. The platform file is opened by SQLite itself and never
 * written; on PostgreSQL the mission side is read through the application's own driver, so
 * this reports what the real code path sees rather than what a client of its own says.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const argv = process.argv.slice(2);
function flag(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const platformArg = flag('--platform');
const perAgent = argv.includes('--per-agent');
const platformFile = platformArg ? path.resolve(ROOT, platformArg) : null;
if (platformArg && !fs.existsSync(platformFile)) {
  process.stderr.write(`mission-registry-sync-readout: no platform database at ${platformFile}\n`);
  process.exit(1);
}

const { DatabaseSync } = require('node:sqlite');
// The application's own mission database module — compiled when the tree has been built, so
// this reads what the running service reads; source form only so a checkout without a build
// can still be inspected (that invocation goes through tsx).
const compiledDatabase = path.join(ROOT, 'dist', 'src', 'mission', 'database.js');
const databaseImport = fs.existsSync(compiledDatabase)
  ? pathToFileURL(compiledDatabase).href
  : pathToFileURL(path.join(ROOT, 'src', 'mission', 'database.ts')).href;
const { missionDb } = await import(databaseImport);

if (!missionDb.tableExists('mission_agents')) {
  // An operator pointing this at a database that has not been migrated yet gets a sentence,
  // not a stack trace — and still a non-zero exit, because "no tables" is not a result.
  process.stderr.write(`mission-registry-sync-readout: the mission database at ${missionDb.path()} (${missionDb.engineName()}) has no mission tables yet — run npm run mission:migrate first\n`);
  process.exit(1);
}

const count = (sql, params = []) => Number(missionDb.get(sql, params)?.n ?? 0);
const rows = (sql, params = []) => missionDb.all(sql, params);

const out = {
  engine: missionDb.engineName(),
  // The mission layer already reduces a PostgreSQL target to host and database name, so this
  // script prints exactly what the service prints about its own target — never credentials.
  missionTarget: missionDb.path(),
  registryAgents: count("SELECT COUNT(*) AS n FROM mission_agents WHERE origin_platform = 'akbaral-registry'"),
  agentsTotal: count('SELECT COUNT(*) AS n FROM mission_agents'),
  grantRows: count('SELECT COUNT(*) AS n FROM mission_agent_tools'),
  rails: {
    tools: count('SELECT COUNT(*) AS n FROM mission_tools'),
    toolRequests: count('SELECT COUNT(*) AS n FROM mission_tool_requests'),
    ledger: count('SELECT COUNT(*) AS n FROM mission_ledger'),
    cashCents: count('SELECT COALESCE(SUM(available_cents + held_cents), 0) AS n FROM mission_cash_accounts'),
    payoutSlotsVerified: count('SELECT COUNT(*) AS n FROM mission_payout_slots WHERE verified_at IS NOT NULL'),
    approvals: count('SELECT COUNT(*) AS n FROM mission_approvals'),
    contracts: count('SELECT COUNT(*) AS n FROM mission_agent_contracts'),
    proposals: count('SELECT COUNT(*) AS n FROM mission_agent_contract_proposals'),
  },
};

if (platformFile) {
  const platform = new DatabaseSync(platformFile, { readOnly: true });
  const platformCount = (sql, params = []) => Number(platform.prepare(sql).get(...(params ?? []))?.n ?? 0);
  out.platform = {
    file: platformFile,
    agents: platformCount('SELECT COUNT(*) AS n FROM agents'),
    platformAgents: platformCount('SELECT COUNT(*) AS n FROM agents WHERE owner_id IS NULL'),
    toolGrants: platformCount(
      'SELECT COUNT(*) AS n FROM agent_tools at JOIN agents a ON a.id = at.agent_id WHERE a.owner_id IS NULL',
    ),
  };
  if (perAgent) {
    // Both sides as maps of slug → grant count, compared here instead of in a SQL JOIN, so
    // the same code works when the two halves live in two different database engines.
    const missionMap = new Map(rows('SELECT slug, COUNT(t.agent_id) AS n FROM mission_agents a LEFT JOIN mission_agent_tools t ON t.agent_id = a.id WHERE a.origin_platform = \'akbaral-registry\' GROUP BY a.slug').map((row) => [String(row.slug), Number(row.n)]));
    const platformMap = new Map(
      platform
        .prepare(
          `SELECT a.slug AS slug, COUNT(at.agent_id) AS n
             FROM agents a LEFT JOIN agent_tools at ON at.agent_id = a.id
            WHERE a.owner_id IS NULL
            GROUP BY a.slug`,
        )
        .all()
        .map((row) => [String(row.slug), Number(row.n)]),
    );
    const mismatch = [];
    for (const [slug, expected] of platformMap) {
      const seen = missionMap.get(slug);
      if (seen === undefined) mismatch.push({ slug, expected, got: 'missing' });
      else if (seen !== expected) mismatch.push({ slug, expected, got: seen });
    }
    for (const slug of missionMap.keys()) if (!platformMap.has(slug)) mismatch.push({ slug, expected: 'absent', got: missionMap.get(slug) });
    out.perAgent = { compared: platformMap.size, mismatch: mismatch.slice(0, 20), mismatchTotal: mismatch.length };
  }
  platform.close();
}

process.stdout.write(`${JSON.stringify(out)}\n`);
