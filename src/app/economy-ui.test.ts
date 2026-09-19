import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Owner-console workforce UI contract (2026-09-19).
 *
 * The economy screen must surface the autonomous workforce with LIVE figures
 * only: fleet overview, per-agent inspector, owner→agent command console and
 * the command ledger. No panel may render seeded, estimated or illustrative
 * numbers — every renderer calls a real API route over the real database,
 * and every empty state says plainly that nothing exists yet.
 */

const root = process.cwd();
const appJs = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const page = readFileSync(join(root, 'src', 'app', 'page.tsx'), 'utf8');

const slice = (from: string, to: string) => {
  const start = appJs.indexOf(from);
  assert.ok(start > 0, `${from} exists`);
  const end = appJs.indexOf(to, start);
  assert.ok(end > start, `${to} follows ${from}`);
  return appJs.slice(start, end);
};

describe('owner-console workforce UI (live figures only)', () => {
  it('renders the workforce overview + primaries panels', () => {
    for (const id of ['economy-workforce', 'economy-primaries']) {
      assert.ok(page.includes(`id="${id}"`), `page.tsx carries #${id}`);
    }
    assert.ok(page.includes('Workforce overview'), 'workforce panel is titled');
  });

  it('renders the agent inspector + command console panels', () => {
    for (const id of ['agent-inspector-slug', 'agent-inspector-load', 'economy-agent', 'command-slug', 'command-text', 'command-send', 'economy-command', 'economy-commands']) {
      assert.ok(page.includes(`id="${id}"`), `page.tsx carries #${id}`);
    }
    assert.ok(page.includes('Command console (owner → agent)'), 'command console is titled');
  });

  it('loads the fleet overview from the live workforce-overview endpoint', () => {
    const fn = slice('async function loadWorkforceOverview()', 'async function loadAgentInspector()');
    assert.ok(fn.includes("api('/api/economy/workforce-overview')"), 'fleet stats come from the live endpoint');
    assert.ok(fn.includes("api('/api/workforce/primaries"), 'primaries come from the live endpoint');
    assert.ok(fn.includes('overview.finance'), 'figures are read from the response, never invented');
    assert.ok(fn.includes('until 1:1 coverage grows'), 'empty state is honest about partial coverage');
  });

  it('inspects one agent through its live report endpoint', () => {
    const fn = slice('async function loadAgentInspector()', 'async function loadEconomyCommands()');
    assert.ok(fn.includes('/api/economy/agents/${encodeURIComponent(slug)}/report'), 'inspector hits the per-agent live report');
    assert.ok(fn.includes('report.finance') && fn.includes('report.recentCommands'), 'finance + commands come from the response');
    assert.ok(fn.includes('No commands issued to this agent yet'), 'empty state admits no activity');
  });

  it('issues owner commands through the real command lifecycle', () => {
    const fn = slice('async function sendEconomyCommand()', 'async function loadMissionChat()');
    assert.ok(fn.includes("api('/api/economy/commands', { method: 'POST'"), 'commands POST to the real endpoint');
    assert.ok(fn.includes('idempotency_key'), 'UI issues idempotency keys like every other writer');
    assert.ok(fn.includes('loadEconomyCommands()'), 'the command ledger refreshes after issuing');
    const list = slice('async function loadEconomyCommands()', 'async function sendEconomyCommand()');
    assert.ok(list.includes("api('/api/economy/commands?limit=10')"), 'ledger lists from the live endpoint');
    assert.ok(list.includes('No commands issued yet'), 'empty ledger admits it');
  });

  it('wires the new controls and loads them with the economy screen', () => {
    assert.ok(appJs.includes("$('#agent-inspector-load')?.addEventListener('click'"), 'inspector button is wired');
    assert.ok(appJs.includes("$('#command-send')?.addEventListener('click'"), 'command button is wired');
    const loader = slice('async function loadEconomy()', 'async function loadWorkforceOverview()');
    assert.ok(loader.includes('loadWorkforceOverview().catch(() => {});'), 'overview loads with the screen');
    assert.ok(loader.includes('loadEconomyCommands().catch(() => {});'), 'command ledger loads with the screen');
  });
});
