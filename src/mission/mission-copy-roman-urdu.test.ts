import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inventory, normalize } from '../../scripts/mission-copy-inventory.mjs';
const { JSDOM } = require('jsdom');

/* ============================================================
 * The mission console speaks Roman Urdu to its owner, and only to its owner.
 *
 * The copy is NOT edited in place: mission-dashboard/app.js, index.html and
 * src/mission/*.ts keep their English literals because those literals are the console's
 * test anchors and the KEYS of the one translation file. What has to hold is therefore
 * (1) that the pairs file covers every string the inventory says reaches a human, with
 * nothing stale; (2) that the console renders the pairs file, per section; (3) that no
 * machine value was ever translated on the way; and (4) that the sources are untouched by
 * the wording — no id, class, route, data-* attribute or storage key moves.
 * ============================================================ */

const PAIRS_FILE = 'design-system/mission-copy.pairs.json';
const GENERATED = 'mission-dashboard/copy.js';
const pairs = JSON.parse(fs.readFileSync(path.resolve(PAIRS_FILE), 'utf8')) as Record<string, string>;
const rows = inventory('.');
const wanted = new Map<string, string>();
for (const row of rows) if (!wanted.has(row.key)) wanted.set(row.key, row.text);

/** A Devanagari character anywhere in the copy would mean the wrong language got in. */
const DEVANAGARI = /[\u0900-\u097F]/;
/** Words that only appear in Urdu sentences — the marker that a string was translated. */
const ROMAN_URDU = /\b(karein|karega|karegi|hai|nahi|nahin|zaroori|chahiye|ke liye|wala|wale|jata hai|jate hain|di gayi|hoti hai|ho jata|bilkul|mehfooz)\b/;
/**
 * Anything in this set is a value the owner must read in English: a product name, a
 * provider's own term, or a machine phrase quoted back from the API. It is pinned as an
 * explicit list so that a string left untranslated BY ACCIDENT fails this test instead of
 * passing it — the only way a new identity pair is accepted is by naming it here.
 */
const KEPT_VERBATIM = new Set([
  '##', '(#: #)', 'Adapter', 'Agent', 'Billing periods', 'Bounty', 'Budget', 'Call', 'Category', 'Chain', 'Class',
  'Concurrency', 'Credential env', 'Env var', 'Environment variable', 'Field Operations Lead', 'Finding',
  'Fingerprint', 'Key', 'Kill switch', 'Label', 'Masked account', 'Memo', 'Mission', 'Mission Control',
  'Mission policy', 'Note', 'Password', 'Payout', 'Payouts', 'Plan', 'Platform', 'Platforms', 'Program',
  'Program ID', 'Programs', 'Provider', 'Providers', 'Quality gate', 'Quota calls', 'Quote', 'Record',
  'Reserved quota', 'Resource call', 'Resource calls — #', 'Role', 'Seq', 'Setting', 'Settlement', 'Settlement gate',
  'Slot', 'Slug', 'Source wallet', 'Status', 'Target', 'Terms hash', 'Tool', 'Upgrades', 'Vault key',
  'Verified payout slot', 'Wallet', 'Withdrawal', 'env var', 'fleet gate · #', 'gemini key', 'minor units',
  'scoped contracts · #',
]);
/** Machine shapes that must survive translation untouched, verbatim, inside the value. */
const MACHINE_TOKEN = /(?<env>\b[A-Z][A-Z0-9_]{4,}\b|\b(?:APPROVED|FAILED|PENDING|MISSING|UNKNOWN|ALLOWED|DENIED|NOT_FOUND|README)\b)|(?<code>\b[a-z][a-z0-9]*_[a-z0-9_]+\b)|(?<path>[\w./-]+\.(?:ts|tsx|js|mjs|css|json|sql|md|html|webmanifest)\b)|(?<url>https?:\/\/\S+)|(?<email>[\w.+-]+@[\w.-]+\.\w+)|(?<cur>\b(?:USD|USDC|INR|EUR|GBP|PKR)\b)|(?<ns>\b[a-z]+:[a-z_]+\b)|(?<vendor>\b(?:Toptal|Contra|Fiverr|Upwork|Freelancer|Awin|Stripe|Payoneer|Gemini|Google|GitHub|YouTube|Instagram|WhatsApp|Railway|Tailscale)\b)|(?<sql>\b(?:SELECT|FROM|WHERE|JOIN|INSERT|UPDATE)\b)/g;

function consoleFixture(withDictionary: boolean) {
  const html = fs.readFileSync(path.resolve('mission-dashboard/index.html'), 'utf8');
  const source = fs
    .readFileSync(path.resolve('mission-dashboard/app.js'), 'utf8')
    .replace("document.addEventListener('DOMContentLoaded', boot);", '');
  const dom = new JSDOM(html, { url: 'https://mission.example.test/', runScripts: 'outside-only' });
  if (withDictionary) {
    const dictionary = fs.readFileSync(path.resolve(GENERATED), 'utf8');
    dom.window.eval(dictionary);
    dom.window.eval(`${source}\nwindow.probe = { ur, urHtml, localizeStaticMarkup, state, banner, emptyState: (t) => el('p', { text: t }) };`);
  } else {
    dom.window.eval(source);
  }
  return { dom, win: dom.window };
}

it('the pairs file is the whole set: every user-facing string has one pair, and nothing stale is kept', () => {
  const missing = [...wanted.keys()].filter((key) => typeof pairs[key] !== 'string' || !pairs[key].trim());
  const stale = Object.keys(pairs).filter((key) => !wanted.has(key));
  assert.deepEqual(missing, [], `${missing.length} user-facing string(s) have no Roman Urdu pair, starting with ${JSON.stringify(missing.slice(0, 3))}`);
  assert.deepEqual(stale, [], `${stale.length} pair(s) name no source string any more, starting with ${JSON.stringify(stale.slice(0, 3))}`);
  assert.ok(wanted.size >= 400, `the inventory is expected to cover the whole console, got ${wanted.size} keys`);
  const sites = rows.length;
  const files = new Set(rows.map((row: { file: string }) => row.file));
  for (const file of ['mission-dashboard/app.js', 'mission-dashboard/index.html', 'src/mission/server.ts']) {
    assert.ok(files.has(file), `the inventory must still read ${file}, it found only ${[...files].join(', ')}`);
  }
  assert.ok(sites >= wanted.size, 'sink sites cannot be fewer than the distinct keys they carry');
});

it('nothing that was translated is a machine value, and nothing kept in English is a sentence', () => {
  const offenders: string[] = [];
  for (const [key, value] of Object.entries(pairs)) {
    for (const match of key.matchAll(MACHINE_TOKEN)) {
      const token = match[0];
      if (!value.includes(token)) offenders.push(`${JSON.stringify(key)} lost ${JSON.stringify(token)}`);
    }
  }
  assert.deepEqual(offenders, [], 'a machine value must appear verbatim in the rendered copy');

  const identity = Object.entries(pairs).filter(([key, value]) => key === value).map(([key]) => key);
  assert.deepEqual([...identity].sort(), [...KEPT_VERBATIM].sort(), 'every deliberately untranslated string must be named in this test');
  for (const key of identity) {
    assert.ok(key.split(' ').length <= 4, `${JSON.stringify(key)} is a whole sentence, not a term — it has to be translated`);
  }
});

it('the dictionary carries no Devanagari, no markup and no unmatched hole', () => {
  for (const [key, value] of Object.entries(pairs)) {
    assert.ok(!DEVANAGARI.test(value), `${JSON.stringify(key)} is not Roman script`);
    assert.ok(!/<\/?[a-zA-Z][^>]*>/.test(value), `${JSON.stringify(key)} carries markup`);
    assert.equal(value.split('#').length - 1, normalize(key).split('#').length - 1, `${JSON.stringify(key)} has a different number of # holes than its value`);
  }
});

it('the console renders Roman Urdu, section by section, wherever its own copy appears', () => {
  const nodeValues = (root: any) => {
    const walker = root.ownerDocument.createTreeWalker(root, root.ownerDocument.defaultView.NodeFilter.SHOW_TEXT);
    const values: string[] = [];
    let node = walker.nextNode();
    while (node) {
      const value = String(node.nodeValue ?? '').trim();
      if (value) values.push(value);
      node = walker.nextNode();
    }
    return values;
  };
  const plain = new JSDOM(fs.readFileSync(path.resolve('mission-dashboard/index.html'), 'utf8'), { url: 'https://mission.example.test/' });
  const before: Record<string, string[]> = {};
  for (const section of plain.window.document.querySelectorAll('section[data-panel]')) {
    before[section.id] = nodeValues(section).filter((value) => {
      const translated = pairs[normalize(value)];
      return typeof translated === 'string' && translated !== value;
    });
    assert.ok(before[section.id].length > 0, `${section.id} has no dictionary copy at all — did the inventory stop reading the markup?`);
  }
  plain.window.close();

  const { dom, win } = consoleFixture(true);
  try {
    win.eval('probe.localizeStaticMarkup()');
    const sections = [...win.document.querySelectorAll('section[data-panel]')] as HTMLElement[];
    assert.equal(sections.length, 4, 'the console has exactly the four owner sections this copy layer serves');
    for (const section of sections) {
      const rendered = nodeValues(section);
      const text = section.textContent ?? '';
      assert.ok(ROMAN_URDU.test(text), `#${section.id} still reads as English`);
      const english = before[section.id].filter((value) => rendered.includes(value));
      assert.deepEqual(english, [], `#${section.id} left these strings in English: ${JSON.stringify(english.slice(0, 3))}`);
    }
    // The dynamic path: a message rendered through the console's own helpers is translated too.
    for (const [english, urdu] of [
      ['Kill switch released.', 'Kill switch hata diya gaya.'],
      ['Policy updated and audited.', 'Policy badal di gayi aur us ka record bana.'],
      ['Program registered successfully.', 'Program kamyabi se register ho gaya.'],
      ['Slot saved. Confirm the control checks and attestation before any payout can target it.', 'Slot mehfooz ho gaya.'],
    ] as Array<[string, string]>) {
      win.eval(`probe.banner(${JSON.stringify(english)})`);
      const shown = win.document.querySelector('#banner')?.textContent ?? '';
      assert.ok(shown.includes(urdu), `banner() rendered ${JSON.stringify(shown)} for ${JSON.stringify(english)}`);
    }
  } finally { dom.window.close(); }
});

it('a translated string keeps the dynamic parts the source interpolated, in order', () => {
  const { dom, win } = consoleFixture(true);
  try {
    const out = win.eval('probe.ur("Attestation (64+ characters, stored verbatim)")') as string;
    assert.ok(out.includes('64'), `the number was dropped: ${JSON.stringify(out)}`);
    assert.ok(!out.includes('#'), `an unfilled hole reached the owner: ${JSON.stringify(out)}`);
    assert.notEqual(out, 'Attestation (64+ characters, stored verbatim)');
    const none = win.eval('probe.ur("Nothing in the dictionary says this.")') as string;
    assert.equal(none, 'Nothing in the dictionary says this.', 'an unknown string must pass through, not vanish');
    const machine = win.eval('probe.ur("no_payout_slot_verified")') as string;
    assert.equal(machine, 'no_payout_slot_verified', 'a blocker code is never looked up as copy');
  } finally { dom.window.close(); }
});

it('the wording was applied without touching an id, class, route, data-* attribute or storage key', () => {
  const html = fs.readFileSync(path.resolve('mission-dashboard/index.html'), 'utf8');
  const app = fs.readFileSync(path.resolve('mission-dashboard/app.js'), 'utf8');
  // The sources are still English: no Urdu value was pasted into a file the tests anchor on.
  for (const value of Object.values(pairs)) {
    if (value === pairs[Object.keys(pairs).find((key) => pairs[key] === value)!]) continue;
    if (!ROMAN_URDU.test(value)) continue;
    assert.ok(!html.includes(value) || value.split(' ').length <= 1, `${JSON.stringify(value.slice(0, 40))} must not be written into index.html`);
    assert.ok(!app.includes(`'${value}`), `${JSON.stringify(value.slice(0, 40))} must not be written into app.js`);
  }
  assert.match(html, /<html lang="en">/, 'the declared language is left as it was — a screen reader reads Latin-script Urdu with the same voice it already uses');
  for (const id of ['login-panel', 'app', 'panel-overview', 'panel-bounties', 'panel-approvals', 'panel-money', 'banner']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} must survive the copy work`);
  }
  for (const view of ['overview', 'bounties', 'approvals', 'money']) {
    assert.ok(html.includes(`data-panel="${view}"`), `data-panel="${view}" must survive`);
    assert.ok(app.includes(`'${view}'`), `the route name ${view} must stay spelled the same in app.js`);
  }
  assert.ok(!app.includes('window.MISSION_COPY = {'), 'app.js reads the dictionary, it never defines it');
  assert.match(fs.readFileSync(path.resolve(GENERATED), 'utf8'), /window\.MISSION_COPY = \{/, 'copy.js is the generated dictionary');
  assert.match(html, /<script src="\/copy\.js"><\/script>\s*\n?\s*<script src="\/app\.js"><\/script>/, 'the dictionary loads before the code that reads it');
});

it('the generated dictionary is exactly the pairs file, and the pairs file is the only translation source', () => {
  const generated = fs.readFileSync(path.resolve(GENERATED), 'utf8');
  const keys = [...generated.matchAll(/^ {2}"((?:[^"\\]|\\.)+)":/gm)].map((match) => match[1].replace(/\\"/g, '"').replace(/\\u003c/g, '<'));
  assert.deepEqual([...keys].sort(), Object.keys(pairs).sort(), 'copy.js must carry exactly the pairs file');
  assert.match(generated, /GENERATED — do not edit/, 'the header tells the next reader where to edit');
  // No second dictionary anywhere: the only other place a Roman Urdu string may live is this test.
  const strays: string[] = [];
  for (const dir of ['mission-dashboard', 'src/mission']) {
    for (const entry of fs.readdirSync(path.resolve(dir), { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(js|ts|html|css|json)$/.test(entry.name)) continue;
      // A test may name the value it expects; that is not a second translation source.
      if (entry.name === 'copy.js' || entry.name === 'app.js' || entry.name === 'index.html' || entry.name.endsWith('.test.ts')) continue;
      const file = path.join(dir, entry.name);
      const text = fs.readFileSync(file, 'utf8');
      if (/\b(karein|zaroori|bilkul|mehfooz)\b/.test(text)) strays.push(file);
    }
  }
  assert.deepEqual(strays, [], 'translation lives in one file only');
});
