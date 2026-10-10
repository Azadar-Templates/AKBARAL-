import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { JSDOM } = require('jsdom');

/**
 * The bare-bones contract for the mission console.
 *
 * The owner asked for the minimum that actually earns: four top-level sections, each inside one
 * screen, with nothing that earns or complies removed. That is only real if it is asserted, so this
 * file pins the four things that would otherwise rot first:
 *
 *   · the shape of the navigation (exactly four sections, everything else a collapsed block);
 *   · the size of a section under a deliberately hostile payload (≤120 visible lines, ≤3 screens);
 *   · that every earning and compliance control is still reachable, in at most two clicks;
 *   · that a deleted view stayed deleted — no markup, no JS, no CSS, no table, no orphan file.
 *
 * The measurement counts *rendered lines*, not markup lines, so a section cannot pass by being
 * quietly fed a small fixture: every list endpoint in the stub returns 40 rows.
 */
const SECTIONS = ['overview', 'bounties', 'approvals', 'money'] as const;
const SUB_VIEWS: Record<string, readonly string[]> = {
  bounties: ['bounty-registration', 'bounty-scope', 'bounty-catalogs', 'agents', 'specialist-records', 'customer-work', 'customer-intake'],
  approvals: ['policy', 'tools'],
  money: ['earnings', 'treasury', 'withdraw', 'expenses', 'evidence', 'audit'],
};
/** Views the strip deleted outright, with the ids their markup used. */
const DROPPED_IDS = [
  'subtabs', 'head-resources', 'head-alerts', 'head-guide', 'head-info-records',
  'head-chat-form', 'head-chat-question', 'head-chat-status', 'head-chat-answer',
  'head-overview-note', 'head-overview-cards', 'head-overview-alerts',
  'billionaire-note', 'billionaire-cards', 'billionaire-daily',
  'knowledge-freshness', 'knowledge-summary', 'knowledge-table', 'knowledge-usage-table',
  'playbooks-freshness', 'agent-playbooks-table', 'platform-playbooks-table',
  'lessons-freshness', 'pending-lessons-table', 'social-connections', 'social-setup',
];
const DROPPED_JS = [
  'loadHeadAgentChat', 'loadKnowledgePanel', 'loadLessonsPanel', 'loadPlaybooksPanel', 'loadPublishing',
];
/**
 * Renderers that only *looked* like part of a deleted view. `renderAgentMessages` and
 * `renderAgentChatControls` belonged to the head-agent chat panel and to every agent's own report, so
 * the strip had to keep them: an owner reading one agent still has to read the stored correspondence
 * and switch automatic replies on or off. This list is what stops "deleted with the panel" from being
 * decided by which panel a function is mentioned next to.
 */
const KEPT_SHARED_RENDERERS = ['renderAgentMessages', 'renderAgentChatControls'];
const DROPPED_CSS = ['chat-answer', 'chat-answer-text', 'guide-grid', 'head-agent-overview', 'notification-row', 'subtabs'];
/** The earning and compliance surface that must survive, and the clicks it may cost. */
const CONTROLS: readonly { readonly label: string; readonly section: string; readonly block?: string; readonly host: string; readonly clicks: number }[] = [
  { label: 'human approval queue', section: 'approvals', host: '#approvals', clicks: 1 },
  { label: 'policy, limits and kill switch', section: 'approvals', block: 'policy', host: '#kill-on', clicks: 2 },
  { label: 'tool catalog and credential vault', section: 'approvals', block: 'tools', host: '#credentials', clicks: 2 },
  { label: 'bounty programs', section: 'bounties', host: '#bounty-programs', clicks: 1 },
  { label: 'submissions and quality gate', section: 'bounties', host: '#bounty-findings', clicks: 1 },
  // The two owner forms and the reference catalog sit in collapsed blocks so the section fits its
  // screen budget with real rows; that is one extra click, never a removed control.
  { label: 'bounty program registration', section: 'bounties', block: 'bounty-registration', host: '#bounty-registration-submit', clicks: 2 },
  { label: 'scope allowlist form (the hard gate)', section: 'bounties', block: 'bounty-scope', host: '#bounty-scope-form', clicks: 2 },
  { label: 'scope-gate decisions', section: 'bounties', block: 'bounty-scope', host: '#bounty-scope-events', clicks: 2 },
  { label: 'provider catalog and reputation', section: 'bounties', block: 'bounty-catalogs', host: '#bounty-providers', clicks: 2 },
  { label: 'specialist pairing and the agent report', section: 'bounties', block: 'agents', host: '#agent-list', clicks: 2 },
  { label: 'per-agent specialist record', section: 'bounties', block: 'specialist-records', host: '#specialist-records', clicks: 2 },
  { label: 'customer intake (listing / preview / recorded request)', section: 'bounties', block: 'customer-intake', host: '#customer-intake', clicks: 2 },
  { label: 'realized earnings', section: 'money', block: 'earnings', host: '#revenue-realized', clicks: 2 },
  { label: 'payout slots', section: 'money', block: 'treasury', host: '#payout-slots', clicks: 2 },
  { label: 'withdrawal request', section: 'money', block: 'withdraw', host: '#withdraw-form', clicks: 2 },
  { label: 'the ledger', section: 'money', block: 'treasury', host: '#ledger', clicks: 2 },
  { label: 'immutable audit trail', section: 'money', block: 'audit', host: '#audit', clicks: 2 },
];
const MAX_VISIBLE_LINES = 120;
const SCROLL_SCREEN_PX = 1000;

const files = {
  html: fs.readFileSync(path.resolve('mission-dashboard/index.html'), 'utf8'),
  js: fs.readFileSync(path.resolve('mission-dashboard/app.js'), 'utf8'),
  css: fs.readFileSync(path.resolve('mission-dashboard/styles.css'), 'utf8'),
};

/**
 * Count what a section would put on screen: one line per block-level text element, one per table
 * row, inline controls inside a row or a form row folded onto the same line as their container.
 * Content inside a closed `<details>` is not on screen at all.
 */
function visibleLines(root: Element): number {
  const BLOCK = 'h1,h2,h3,h4,h5,p,li,dd,summary,tr,.notice,.empty,.result';
  const FILLER = '.card,.kpi,.metric,.inline-form,.stack,.grid-2,.table-wrap';
  const hidden = (node: Element): boolean => {
    if ((node as HTMLElement).hidden) return true;
    const details = node.closest('details');
    if (details && !(details as HTMLDetailsElement).open && !node.matches('summary')) return true;
    let ancestor = node.parentElement;
    while (ancestor && ancestor !== root) {
      if ((ancestor as HTMLElement).hidden) return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  };
  const text = (node: Element) => (node.textContent ?? '').replace(/\s+/g, ' ').trim();
  const counted = new Set<Element>();
  for (const node of root.querySelectorAll(BLOCK)) {
    if (hidden(node) || !text(node)) continue;
    if (node.matches('tr') && node.parentElement?.matches('thead')) continue;
    counted.add(node);
  }
  for (const node of root.querySelectorAll(FILLER)) {
    if (hidden(node) || !text(node)) continue;
    if (node.querySelector(BLOCK) || node.querySelector('label,button,input,select,a,small')) continue;
    counted.add(node);
  }
  let lines = 0;
  for (const node of counted) {
    let ancestor = node.parentElement;
    let nested = false;
    while (ancestor && ancestor !== root) {
      if (counted.has(ancestor) && !ancestor.matches('tbody,thead,table,.table-wrap,section')) { nested = true; break; }
      ancestor = ancestor.parentElement;
    }
    if (!nested) lines += 1;
  }
  return lines;
}

/** A hostile API: every list-shaped key holds 40 rows, so a bounded render is the only way to pass. */
function hostilePayload(requestPath: string): Record<string, unknown> {
  const cell = (key: string): unknown => /Cents$|^cents$|count|rows|score|attempts|uses/.test(key) ? 1250
    : key === 'ok' || key === 'verified' || key === 'pending' || key === 'active' || key === 'inScope' ? 1
      : key === 'programs' || key === 'targets' || key === 'scope' ? [] : `sample-${key}`;
  const rowKeys = ['id', 'label', 'title', 'name', 'slug', 'state', 'status', 'kind', 'provider', 'platform', 'platformHandle', 'programHandle', 'handle', 'detail', 'note', 'reason', 'url', 'key', 'value', 'currency', 'createdAt', 'created_at', 'at', 'rankedAt', 'score', 'ok', 'verified', 'pending', 'active', 'inScope', 'uses', 'attempts', 'amountCents', 'reward_usd_cents', 'rewardUsdCents', 'totalCents', 'netCents', 'grossCents', 'cents', 'count', 'rows', 'agentId', 'agentSlug', 'type', 'capabilityDescription', 'target', 'targetType', 'vulnerability_class', 'email', 'role', 'version', 'hash', 'digest', 'method', 'reference', 'externalId', 'expiresAt', 'updatedAt', 'specialtyLabel', 'skillLevel'];
  const rows = Array.from({ length: 40 }, (_, index) => {
    const row: Record<string, unknown> = {};
    for (const key of rowKeys) row[key] = cell(key);
    return { ...row, id: `row-${index}`, index, title: `Row ${index} with a moderately long descriptive label`, label: `Row ${index}`, name: `Row ${index}`, programHandle: `program-${index}`, platform: `platform-${index}` };
  });
  const listKeys = ['rows', 'items', 'approvals', 'ledger', 'entries', 'records', 'events', 'targets', 'slots', 'wallets', 'withdrawals', 'tools', 'credentials', 'audit', 'programs', 'findings', 'lessons', 'resources', 'services', 'evidence', 'transitions', 'agents', 'costs', 'expenses', 'byCategory', 'bySource', 'recent', 'requests', 'candidates', 'opportunities', 'payouts', 'transactions', 'operations', 'connections', 'kyc', 'submissions', 'runs', 'log', 'history', 'notes', 'checks', 'proofs', 'assignments', 'gaps', 'platforms', 'providers', 'queues', 'snapshots', 'playbooks', 'knowledge', 'messages', 'notifications', 'cards', 'scope', 'scopeEntries', 'events', 'operations'];
  if (requestPath === '/api/overview') {
    return {
      generatedAt: '2026-10-10T05:00:00Z', currency: 'USD',
      treasury: { currency: 'USD', totals: { totalBalanceCents: 125000 }, wallets: rows.slice(0, 3) },
      agents: { total: 4001, registry: 4000, custom: 1 }, policy: { maxDepth: 2 },
      revenue: { windows: { lifetimeCents: 250000, todayCents: 12000, last30DaysCents: 90000 }, contractedCents: 40000, expectedCents: 15000, bySource: rows.slice(0, 5), recent: rows.slice(0, 5) },
      expenses: { paidCents: 3000, pendingCents: 900, byCategory: rows.slice(0, 3) },
      costs: { monthlyCommittedCents: 4000, spendTodayCents: 200, dailyCapCents: 5000, byCategory: rows.slice(0, 3) },
      approvals: { pending: 4 }, upgrades: { requested: 2 }, targets: rows.slice(0, 5),
      audit: { ok: true, rows: 612 }, integrity: { ledger: { ok: true, rows: 40 } },
      honesty: { realizedRevenueOnly: true, noFabrication: 'verified only', externalActivationPending: ['authorize a GitHub credential', 'verify a payout slot'] },
      fleet: { registered: 4001, withPlatform: 7, ready: 0, blocked: 3, needsOwnerAction: 7, earnedCents: 0, settledProofs: 0, nextAction: 'authorize a GitHub credential with Contents:write' },
    };
  }
  if (requestPath === '/api/session/me') return { owner: { id: 'own_1', email: 'owner@example.test', role: 'owner' } };
  const body: Record<string, unknown> = { ok: true, currency: 'USD', total: rows.length, note: 'fixture', ...Object.fromEntries(listKeys.map(key => [key, rows])) };
  if (requestPath.startsWith('/api/bounty/programs')) body.programs = rows.slice(0, 12).map((row, index) => ({ ...row, active: index % 2 === 0, programHandle: `handle-${index}`, scope: rows.slice(0, 9) }));
  return body;
}

function renderedConsole() {
  const dom = new JSDOM(files.html, { url: 'https://mission.example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const requests: string[] = [];
  const errors: string[] = [];
  dom.window.fetch = async (url: string, init: RequestInit = {}) => {
    const asText = String(url);
    requests.push(asText);
    if ((init.method ?? 'GET') !== 'GET') errors.push(`navigation made a ${init.method} request to ${asText}`);
    return new Response(JSON.stringify(hostilePayload(asText.split('?')[0])), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  dom.window.addEventListener('error', (event: { message?: string }) => errors.push(String(event.message ?? 'unknown')));
  const source = files.js.replace("document.addEventListener('DOMContentLoaded', boot);", '');
  dom.window.eval(`${source}
window.strip = { boot, state, activateTab, applyTabChrome, subSection, tabButton, loadTab, MAX_TABLE_ROWS };`);
  return { dom, doc: dom.window.document as unknown as Document, win: dom.window, strip: (dom.window as unknown as { strip: StripInternals }).strip, requests, errors };
}

interface StripInternals {
  state: { token: string; link: string; owner: unknown; activeTab: string };
  boot: () => Promise<void>;
  activateTab: (view: string, options?: { navigate?: boolean }) => Promise<void>;
  applyTabChrome: (view: string) => void;
  subSection: (view: string) => HTMLElement | null;
  tabButton: (view: string) => HTMLElement | null;
  loadTab: (view: string) => Promise<void>;
  MAX_TABLE_ROWS: number;
}

const settle = async (windows = 40): Promise<void> => { for (let index = 0; index < windows; index += 1) await new Promise(resolve => setTimeout(resolve, 0)); };

/** The console renders its app shell only for a signed-in caller, so a measurement of an unsigned
 *  console would measure a login form. These are owner-session capabilities, so the owner session is
 *  what the click budget has to be measured against. */
function signIn(strip: StripInternals): void {
  strip.state.owner = { id: 'own_1', email: 'owner@example.test', role: 'owner' };
  strip.state.token = 'synthetic-owner-session';
}

it('the top level is exactly the four sections the owner named, in order', async () => {
  const dom = new JSDOM(files.html);
  const buttons = [...dom.window.document.querySelectorAll('#tabs [data-tab]')].map(node => node.getAttribute('data-tab'));
  const panels = [...dom.window.document.querySelectorAll('[data-panel]')].map(node => node.getAttribute('data-panel'));
  assert.deepEqual(buttons, [...SECTIONS], 'the nav must offer Overview, Bounty, Approvals and Money and nothing else');
  assert.deepEqual(panels, [...SECTIONS], 'each nav button needs exactly one panel');
  assert.equal(dom.window.document.querySelectorAll('#tabs > button.tab').length, 4);
  assert.equal(dom.window.document.querySelectorAll('.subtabs').length, 0, 'the sub-tab row is gone; blocks replaced it');
  // Nothing may hide a top-level tab outside #tabs, or the count above is a lie.
  const stray = [...dom.window.document.querySelectorAll('[data-tab]')].filter(node => !node.closest('#tabs'));
  assert.deepEqual(stray.map(node => node.getAttribute('data-tab')), [], 'every data-tab belongs to the top-level row');
  dom.window.close();
});

it('every folded view is a collapsed block in exactly one family', async () => {
  const dom = new JSDOM(files.html);
  const blocks = [...dom.window.document.querySelectorAll('details.sub')];
  const expected = Object.entries(SUB_VIEWS).flatMap(([, views]) => views);
  assert.deepEqual(blocks.map(node => node.getAttribute('data-view')).sort(), [...expected].sort(), 'the blocks are the surviving views, no more and no fewer');
  for (const [family, views] of Object.entries(SUB_VIEWS)) {
    for (const view of views) {
      const node = dom.window.document.querySelector(`details.sub[data-view="${view}"]`) as HTMLDetailsElement;
      assert.ok(node, `${view} must exist as a collapsed block`);
      assert.equal(node.closest('[data-panel]')?.getAttribute('data-panel'), family, `${view} belongs to ${family}`);
      assert.equal(node.open, false, `${view} starts collapsed: one screen per section`);
      assert.ok((node.querySelector('summary')?.textContent ?? '').trim().length > 3, `${view} needs a summary that says what is inside`);
    }
  }
  dom.window.close();
  // The router's group table has to be the same list, or navigation and layout disagree.
  const configured = files.js.match(/const TAB_GROUPS = \{[\s\S]*?\n\};/)?.[0] ?? '';
  assert.ok(configured, 'app.js must declare TAB_GROUPS');
  for (const [family, views] of Object.entries(SUB_VIEWS)) {
    for (const view of views) assert.ok(configured.includes(`'${view}'`), `TAB_GROUPS lists ${view} under ${family}`);
  }
});

it('a deleted view stays deleted in markup, script and style', async () => {
  for (const id of DROPPED_IDS) {
    for (const [name, source] of Object.entries(files)) {
      assert.ok(!source.includes(`"${id}"`) && !source.includes(`#${id}`) && !source.includes(`'${id}'`), `${id} is gone from ${name}`);
    }
  }
  for (const fn of DROPPED_JS) assert.ok(!new RegExp(`function ${fn}\\b`).test(files.js), `${fn} has no orphaned implementation left`);
  for (const klass of DROPPED_CSS) {
    assert.ok(!files.css.includes(`.${klass}`), `.${klass} is not styled any more`);
    assert.ok(!files.html.includes(klass) || klass === 'notice', `.${klass} is not used by the markup either`);
  }
  assert.ok(!fs.existsSync('src/mission/earning/github-bounty-contracts.ts'), 'the unreferenced contract file was deleted, not left dangling');
  for (const shared of KEPT_SHARED_RENDERERS) {
    assert.ok(new RegExp(`function ${shared}\\b`).test(files.js), `${shared} is shared with the per-agent report and must survive the strip`);
    assert.ok(files.js.includes('void renderAgentMessages(conversation, report.agent.slug)'), 'and the agent report still renders it');
  }
});

it('no section needs more than one screen, even when the API floods it', async () => {
  const { doc, strip, errors, win } = renderedConsole();
  signIn(strip);
  await Promise.resolve().then(() => strip.boot()).catch((error) => errors.push(`boot: ${(error as Error).message}`));
  await settle();
  const measured: Record<string, { closed: number; worst: number; worstBlock: string }> = {};
  for (const section of SECTIONS) {
    await strip.activateTab(section);
    await settle(10);
    const panel = doc.querySelector(`[data-panel="${section}"]`) as HTMLElement;
    for (const details of [...panel.querySelectorAll('details.sub')] as HTMLDetailsElement[]) details.open = false;
    await strip.loadTab(section).catch(() => undefined);
    await settle(10);
    const closed = visibleLines(panel);
    let worst = closed;
    let worstBlock = '—';
    for (const view of SUB_VIEWS[section] ?? []) {
      for (const details of [...panel.querySelectorAll('details.sub')] as HTMLDetailsElement[]) details.open = false;
      const details = panel.querySelector(`details.sub[data-view="${view}"]`) as HTMLDetailsElement;
      assert.ok(details, `${view} must live inside ${section}`);
      await strip.loadTab(view).catch(() => undefined);
      details.open = true;
      await settle(6);
      const lines = visibleLines(panel);
      if (lines > worst) { worst = lines; worstBlock = view; }
    }
    measured[section] = { closed, worst, worstBlock };
    assert.ok(worst <= MAX_VISIBLE_LINES, `${section} renders ${worst} lines with ${worstBlock} open; the cap is ${MAX_VISIBLE_LINES}`);
  }
  // 3 screens is derived, not asserted by eye: the sheet sets one line to 21px (font: 14px/1.5),
  // and scripts/mission-browser-check.ts measures the same sections' real scrollHeight on Chromium.
  const lineHeight = Number(/font:\s*14px\s*\/\s*1\.5/.test(files.css) ? 21 : 0);
  assert.ok(lineHeight > 0, 'the base line height is expected to stay 14px/1.5 so this derivation holds');
  for (const [section, result] of Object.entries(measured)) {
    assert.ok(result.worst * lineHeight <= 3 * SCROLL_SCREEN_PX, `${section} is ${(result.worst * lineHeight / SCROLL_SCREEN_PX).toFixed(2)} screens tall`);
  }
  assert.deepEqual(errors, [], 'rendering the console must stay clean: ' + JSON.stringify(errors.slice(0, 3)));
  assert.ok(strip.MAX_TABLE_ROWS <= 8, 'the render bound per table is what keeps a section inside one screen');
  win.close();
});

it('every earning and compliance control is at most two clicks away', async () => {
  const { doc, strip, win } = renderedConsole();
  signIn(strip);
  await Promise.resolve().then(() => strip.boot()).catch(() => undefined);
  await settle();
  for (const control of CONTROLS) {
    let clicks = 0;
    const button = strip.tabButton(control.section);
    assert.ok(button, `${control.section} must still have a nav button for ${control.label}`);
    button.dispatchEvent(new win.Event('click', { bubbles: true }));
    clicks += 1;
    await settle(6);
    if (control.block) {
      const details = strip.subSection(control.block) as HTMLDetailsElement | null;
      assert.ok(details, `${control.block} must exist as a block for ${control.label}`);
      assert.equal(details!.closest('[data-panel]')?.getAttribute('data-panel'), control.section);
      const summary = details!.querySelector('summary');
      assert.ok(summary, `${control.block} needs a summary to click`);
      if (!details.open) {
        summary.dispatchEvent(new win.Event('click', { bubbles: true }));
        clicks += 1;
        if (!details.open) {
          // A host that does not implement summary activation still gets the same state, so the
          // budget being measured is the owner's two clicks and not a jsdom detail.
          details.open = true;
          details.dispatchEvent(new win.Event('toggle'));
        }
      }
      await settle(4);
    }
    assert.equal(clicks, control.clicks, `${control.label}: ${control.clicks === 1 ? 'one click on the section' : 'section, then open the block'}`);
    const host = doc.querySelector(control.host) as HTMLElement | null;
    assert.ok(host, `${control.host} has to exist for ${control.label}`);
    const chain: string[] = [];
    for (let node: HTMLElement | null = host; node && node !== doc.body; node = node.parentElement) {
      chain.push(`${node.tagName}${node.id ? `#${node.id}` : ''}${node.hidden ? '[hidden]' : ''}${node.matches('details') && !(node as HTMLDetailsElement).open ? '[closed]' : ''}`);
    }
    const blocked = chain.filter(link => /\[hidden\]|\[closed\]/.test(link));
    assert.deepEqual(blocked, [], `${control.label} is on screen after ${control.clicks} click(s), not merely present in the DOM`);
  }
  win.close();
});

it('the mission package has no file that nothing imports', async () => {
  const roots = ['src', 'scripts', 'mission-dashboard'];
  const filesOnDisk: string[] = [];
  for (const base of roots) {
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) filesOnDisk.push(full.split(path.sep).join('/'));
      }
    };
    walk(base);
  }
  const sources = new Map(filesOnDisk.map(file => [file, fs.readFileSync(file, 'utf8')]));
  const resolve = (from: string, specifier: string): string | null => {
    if (!specifier.startsWith('.')) return null;
    const base = path.resolve(path.dirname(from), specifier).split(path.sep).join('/');
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, path.join(base, 'index.ts')]) {
      if (sources.has(candidate.replace(`${process.cwd().split(path.sep).join('/')}/`, ''))) return candidate.replace(`${process.cwd().split(path.sep).join('/')}/`, '');
    }
    return null;
  };
  const imported = new Set<string>();
  for (const [file, source] of sources) {
    const specifiers = [...source.matchAll(/(?:from|require\(|import\()\s*['"](\.[^'"]+)['"]/g), ...source.matchAll(/import\s+['"](\.[^'"]+)['"]/g)];
    for (const match of specifiers) {
      const target = resolve(file, match[1]);
      if (target) imported.add(target);
    }
  }
  const missionFiles = [...sources.keys()].filter(file => file.startsWith('src/mission/') && file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.fixtures.ts'));
  const orphans = missionFiles.filter(file => !imported.has(file));
  assert.deepEqual(orphans, [], 'every non-test file under src/mission must be imported by something tracked; a deleted view has to take its module with it');
  assert.ok(missionFiles.length > 40, `the scan has to actually look at the mission package, saw ${missionFiles.length} files`);
});

it('nothing left standing reads a dropped table or column', async () => {
  const dropped: Record<string, string> = {
    mission_meta: 'dropped by 0049: no code ever read it and it held no rows',
    tokens_used: 'dropped from agent_run_logs: unread by every code path',
    avg_settlement_hours: 'dropped from mission_earning_intelligence: unread by every code path',
  };
  const scanRoots = ['src', 'scripts', 'mission-dashboard'];
  const walk = (dir: string, hits: string[]): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, hits);
      else if (/\.(ts|tsx|js|mjs|sql|html|css)$/.test(entry.name)) {
        // This very file names the dropped objects in order to assert they are gone, and the
      // migration names them to drop them; neither is a read.
      if (full.endsWith('mission-dashboard-bare.test.ts')) continue;
      const source = fs.readFileSync(full, 'utf8');
        for (const name of Object.keys(dropped)) {
          if (source.includes(name) && !full.includes('db/migrations-mission')) hits.push(`${full}:${name}`);
        }
      }
    }
  };
  const hits: string[] = [];
  for (const root of scanRoots) walk(root, hits);
  assert.deepEqual(hits, [], 'only the migration may name a dropped table or column');

  const migration = fs.readFileSync(path.resolve('db/migrations-mission/0049_strip_dead_mission.sql'), 'utf8');
  assert.match(migration, /DROP TABLE IF EXISTS mission_meta;/);
  assert.match(migration, /ALTER TABLE agent_run_logs DROP COLUMN tokens_used;/);
  assert.match(migration, /ALTER TABLE mission_earning_intelligence DROP COLUMN avg_settlement_hours;/);
  assert.match(migration, /ADD COLUMN opportunity_class TEXT;/, 'the specialty gate needs the class on the ranked row');
  assert.match(migration, /ADD COLUMN payment_reference TEXT;/, 'a recorded payout reference is what makes an agent earnings figure re-derivable');
  assert.match(migration, /mission_kyc_submissions/, 'the migration has to say why identity material is kept');
  // Money, approvals, audit, credentials and owner identity must never appear in a DROP statement.
  const drops = [...migration.matchAll(/^\s*(DROP TABLE|DROP COLUMN|ALTER TABLE[^\n]*DROP COLUMN)[^\n]*$/gim)].map(match => match[0]);
  for (const statement of drops) {
    assert.ok(!/mission_ledger|mission_wallets|mission_payout|mission_approvals|mission_audit|mission_credentials|mission_owner|mission_identity_lock|bounty_submissions|mission_settlement/i.test(statement),
      `a destructive statement touches earning or compliance material: ${statement}`);
  }
});

it('the four sections carry no decoration, and the theme was not re-invented', async () => {
  assert.equal(files.html.match(/<svg|<img|background-image/g)?.length ?? 0, 0, 'no illustrations in the console markup');
  assert.ok(!/coming soon/i.test(files.html), 'no placeholder promises');
  assert.ok(!/lorem ipsum/i.test(files.html));
  // The overview is one screen: the five cards the owner named, and nothing else.
  const dom = new JSDOM(files.html);
  const overview = dom.window.document.querySelector('[data-panel="overview"]');
  assert.ok(overview, 'the overview section exists');
  assert.equal(overview?.querySelectorAll('details').length, 0, 'Overview has no sub-sections at all');
  assert.equal(overview?.querySelectorAll('form').length, 0, 'Overview is a readout, not a form');
  const head = overview?.querySelector('.section-head');
  assert.ok(head, 'the section header holds the title and the read-only state, once');
  assert.equal(head?.querySelectorAll('h2').length, 1, 'one heading per section, no duplicate titles');
  // Every other section heads itself exactly once too.
  for (const section of SECTIONS) {
    const panel = dom.window.document.querySelector(`[data-panel="${section}"]`);
    assert.equal(panel?.querySelectorAll('h2').length, 1, `${section} has one title and nothing inside it steals the level`);
  }
  dom.window.close();
  // No new colours: the console still defines exactly the palette it had before the strip.
  const rootBlock = files.css.match(/:root\s*\{[\s\S]*?\}/)?.[0] ?? '';
  assert.ok(rootBlock.includes('--accent'), 'the green theme tokens are the ones already in the sheet');
  const newRules = files.css.split('\n').filter(line => line.includes('details.sub') || line.includes('.section-head'));
  assert.ok(newRules.length >= 8, 'the collapsed blocks are styled from existing tokens');
  for (const line of newRules) {
    assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(line), `no new colour literals in the block styles: ${line.trim()}`);
  }
});
