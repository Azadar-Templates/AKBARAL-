import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BRAIN_ROWS,
  brainMap,
  brainTotals,
  undocumentedBrainEnvVars,
  type BrainRow,
} from './brain-map';
import { TOOL_SPECS, PROVIDER_SPECS, MODEL_SPECS } from '../models/catalog';
import { agentDefinitionCount, AGENT_CATEGORIES } from '../agents/catalog';

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * The brain map is only worth anything if it cannot drift from the code. Every
 * row names a file and an exported symbol; these tests fail the build when the
 * claim stops being true.
 */

function source(row: BrainRow): string {
  return fs.readFileSync(path.join(ROOT, row.component), 'utf8');
}

it('every capability points at a source file that exists', () => {
  for (const row of BRAIN_ROWS) {
    assert.ok(fs.existsSync(path.join(ROOT, row.component)), `${row.fn}: ${row.component} does not exist`);
  }
});

it('every capability points at a symbol that is actually exported there', () => {
  for (const row of BRAIN_ROWS) {
    const pattern = new RegExp(
      `export (async )?(function|const|class|interface|type) ${row.symbol}\\b|export \\{[^}]*\\b${row.symbol}\\b`,
    );
    assert.match(source(row), pattern, `${row.fn}: ${row.component} does not export ${row.symbol}`);
  }
});

it('every named tool is a tool the platform really registers', () => {
  const keys = new Set(TOOL_SPECS.map((spec) => spec.key));
  for (const row of BRAIN_ROWS) {
    if (!row.tool) continue;
    // Mission tools live in the mission tool registry, not the model catalog.
    if (row.tool.includes('mission')) continue;
    assert.ok(keys.has(row.tool), `${row.fn}: ${row.tool} is not in TOOL_SPECS`);
  }
});

it('every environment variable in the map is documented in the dependency matrix', () => {
  assert.deepEqual(undocumentedBrainEnvVars(), [], 'brain map requires variables the matrix does not document');
});

it('every claimed proof is a test file that exists', () => {
  for (const row of BRAIN_ROWS) {
    if (!row.verifiedBy) continue;
    assert.ok(fs.existsSync(path.join(ROOT, row.verifiedBy)), `${row.fn}: ${row.verifiedBy} does not exist`);
  }
});

it('status is computed from the environment, never asserted by hand', () => {
  const blocked = brainMap({}, false);
  const reachableAndConfigured = brainMap(
    { GOOGLE_API_KEY: 'x', SMTP_HOST: 'x', SMTP_USER: 'x', SMTP_PASSWORD: 'x', DATABASE_URL: 'x' },
    true,
  );
  const chat = (entries: ReturnType<typeof brainMap>): string =>
    entries.find((entry) => entry.fn === 'Mission agent chat')!.status;
  assert.equal(chat(blocked), 'RUNTIME BLOCKED');
  assert.equal(chat(reachableAndConfigured), 'CODE READY');

  const goal = (entries: ReturnType<typeof brainMap>) =>
    entries.find((entry) => entry.fn === 'Goal understanding')!;
  assert.equal(goal(blocked).status, 'CREDENTIAL REQUIRED');
  assert.match(goal(blocked).blocker, /GOOGLE_API_KEY \| OPENAI_API_KEY/);
  assert.equal(goal(reachableAndConfigured).status, 'CODE READY');
});

it('a capability with no external dependency is WORKING regardless of network', () => {
  const entries = brainMap({}, false);
  for (const fn of ['Planner', 'Ledger + treasury', 'Opportunity scoring', 'Audit trail']) {
    const entry = entries.find((candidate) => candidate.fn === fn);
    assert.ok(entry, `${fn} is mapped`);
    assert.equal(entry.status, 'WORKING', `${fn} needs no provider and must not be reported as blocked`);
    assert.equal(entry.blocker, '');
  }
});

it('only the project status vocabulary is used', () => {
  const allowed = new Set(['WORKING', 'CODE READY', 'CREDENTIAL REQUIRED', 'RUNTIME BLOCKED', 'NOT IMPLEMENTED']);
  for (const entry of brainMap({}, false)) assert.ok(allowed.has(entry.status));
});

it('no row claims a capability the codebase does not implement', () => {
  // Every row that says NOT IMPLEMENTED must have no tool and no endpoint,
  // and every row with an endpoint must require egress.
  for (const entry of brainMap({}, false)) {
    if (entry.status === 'NOT IMPLEMENTED') {
      assert.equal(entry.tool, null, `${entry.fn} claims a tool while declaring itself unimplemented`);
      assert.equal(entry.api, null, `${entry.fn} claims an endpoint while declaring itself unimplemented`);
    }
    if (entry.api && entry.api.startsWith('http')) {
      assert.equal(entry.egress, true, `${entry.fn} calls ${entry.api} but does not declare egress`);
    }
  }
});

it('AKBARAL! and ZA141251SA rows never share a database', () => {
  for (const row of BRAIN_ROWS) {
    if (row.system === 'ZA141251SA') {
      assert.ok(
        !/akbaral\.db/.test(row.dataSource),
        `${row.fn}: a mission capability must not read the AKBARAL! database`,
      );
    } else {
      assert.ok(
        !/mission\.db|mission_/.test(row.dataSource),
        `${row.fn}: a public capability must not read mission tables`,
      );
    }
  }
});

it('totals are counted from the registry, not written down', () => {
  const entries = brainMap({}, false);
  const totals = brainTotals(entries, {
    agents: agentDefinitionCount(),
    reasoningProfiles: 0,
    aiProviders: PROVIDER_SPECS.length,
    toolIntegrations: TOOL_SPECS.length,
    reachableProviders: 0,
  });
  assert.equal(totals.agents, 4001);
  assert.equal(AGENT_CATEGORIES.length, 80);
  assert.equal(totals.aiProviders, PROVIDER_SPECS.length);
  assert.equal(totals.toolIntegrations, TOOL_SPECS.length);
  assert.equal(totals.capabilities, BRAIN_ROWS.length);
  assert.equal(
    totals.working + totals.codeReady + totals.credentialRequired + totals.runtimeBlocked + totals.notImplemented,
    BRAIN_ROWS.length,
  );
  assert.ok(MODEL_SPECS.length >= PROVIDER_SPECS.length);
});

it('every capability states what breaks without it, and blocked ones name an owner action or a runtime limit', () => {
  for (const row of BRAIN_ROWS) {
    assert.ok(row.degraded.length > 20, `${row.fn}: degraded behaviour must be specific`);
    assert.ok(!/^it fails$/i.test(row.degraded.trim()));
  }
  for (const entry of brainMap({}, false)) {
    if (entry.status === 'CREDENTIAL REQUIRED') {
      assert.ok(entry.missing.length > 0, `${entry.fn}: must name the missing variable`);
    }
  }
});
