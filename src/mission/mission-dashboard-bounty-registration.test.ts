import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../mission-dashboard');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

test('owner registration markup is complete and safe', () => {
  assert.match(html, /id="bounty-registration"[^>]*data-owner-only="true"/);
  for (const field of ['bounty-platform', 'bounty-other-platform', 'bounty-scope-url', 'bounty-terms-hash', 'bounty-registration-targets', 'bounty-activate-now', 'bounty-registration-submit']) assert.match(html, new RegExp(`id="${field}"`));
  assert.match(html, /value="github"/); assert.match(html, /value="immunefi"/); assert.match(html, /value="code4rena"/); assert.match(html, /value="sherlock"/); assert.match(html, /value="hackerone"/); assert.match(html, /value="bugcrowd"/); assert.match(html, /value="other"/);
  assert.match(html, /Only add targets this program has publicly listed as in scope/);
  assert.match(html, /Activating allows the worker to act on these targets/);
  assert.match(html, /<pre id="bounty-terms-preview"><\/pre>/);
  assert.doesNotMatch(html, /<pre[^>]*aria-label=/i);
  assert.doesNotMatch(app, /ZA141251SA_/);
  assert.doesNotMatch(html, /ZA141251SA_/);
});

test('registration client contract fetches server terms and never hashes client-side', () => {
  assert.match(app, /api\('\/bounty\/programs\/fetch-terms'/);
  assert.match(app, /body: \{ scopeUrl: url \}/);
  assert.match(app, /result\.sha256/);
  assert.match(app, /error\.code.*error\.message/);
  assert.doesNotMatch(app, /crypto\.subtle|createHash|sha256sum/i);
});

test('registration sequence creates inactive, saves scopes, and activates last conditionally', () => {
  const create = app.indexOf("api('/bounty/programs', { method: 'POST'");
  const scope = app.indexOf("/scope`, { method: 'POST'");
  const activate = app.indexOf("body: { active: true }");
  assert.ok(create >= 0 && scope > create && activate > scope);
  assert.match(app.slice(create, scope), /active: false/);
  assert.match(app.slice(scope, activate), /inScope: true/);
  assert.match(app.slice(activate - 500, activate + 80), /activate-now.*checked|rows\.length/);
  assert.match(app, /program_exists/);
  assert.match(app, /Partial failure/);
});

test('program cards have honest empty state and zero-target activation guard', () => {
  assert.match(app, /No bounty programs registered yet\. The worker stays idle until a program is active with at least one in-scope target/);
  assert.match(app, /toggle\.disabled = !program\.active && targets\.length === 0/);
  assert.match(app, /GET\`?\,?\s*.*\/scope|api\(`\/bounty\/programs\/\$\{encodeURIComponent\(program\.id\)\}\/scope/);
});

test('service worker uses v2 and removes older private shell caches', () => {
  assert.match(worker, /private-mission-shell-v2/);
  assert.match(worker, /caches\.keys\(\)/);
  assert.match(worker, /key !== CACHE/);
  assert.match(worker, /caches\.delete\(key\)/);
  assert.match(worker, /cached \|\| fetch/);
});
