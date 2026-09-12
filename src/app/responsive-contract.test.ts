import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Responsive + honest-error-state contract (September 2026 launch hardening).
 *
 * Locks the structural guarantees the production UX depends on so a future
 * edit cannot silently regress them:
 *
 *   1. The MASTER workspace is a two-zone responsive grid (goal/input +
 *      execution console) that collapses to one column under 1080px.
 *   2. The execution console is a bounded, scrollable panel — long results
 *      can never push the page into unbounded vertical growth.
 *   3. Auto-fill grids use min() guards so a fixed minimum track can never
 *      overflow a 320px viewport.
 *   4. The pricing grid steps 3 -> 2 -> 1 columns (2-col tablet step
 *      prevents the previous 3-col -> 1-col jump that left large empty
 *      space between 1081-1180px and cramped cards at 768-1024px).
 *   5. The container gutters tighten on small phones (400px).
 *   6. The client ships honest, actionable error states: the misleading
 *      "No knowledge results." empty state is gone; every real failure
 *      mode has a distinct, honest message; no fake completion copy.
 *   7. The SPA mounts the new console/result/info hooks.
 */

const root = process.cwd();
const css = readFileSync(join(root, 'public', 'styles.css'), 'utf8');
const appJs = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const page = readFileSync(join(root, 'src', 'app', 'page.tsx'), 'utf8');

describe('responsive + honest error-state contract', () => {
  it('MASTER workspace is a two-zone grid that collapses under 1080px', () => {
    assert.match(css, /\.master-layout\s*\{\s*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(320px,\s*2fr\)\s*3fr/, 'master-layout grid definition');
    assert.match(css, /@media \(max-width: 1080px\)\s*\{[\s\S]*?\.master-layout\s*\{\s*grid-template-columns:\s*1fr;/, 'master-layout single-column collapse at 1080px');
    assert.match(css, /\.master-side\s*\{\s*display:\s*grid;[^}]*min-width:\s*0/, 'side column guards min-width for overflow');
  });

  it('execution console is bounded and scrollable, never unbounded', () => {
    assert.match(css, /\.master-console\s*\{[^}]*max-height:\s*min\(58vh,\s*640px\)[^}]*overflow-y:\s*auto/, 'console max-height + scroll');
    assert.match(css, /\.master-console\s*\{[^}]*overflow-wrap:\s*anywhere/, 'console wraps long tokens (URLs, JSON)');
    assert.match(css, /@media \(max-width: 1080px\)\s*\{[\s\S]*?\.master-console\s*\{\s*max-height:\s*none/, 'console height limit lifted when stacked');
  });

  it('auto-fill grids use min() guards so fixed tracks cannot overflow 320px viewports', () => {
    const autoFill = css.match(/grid-template-columns:\s*repeat\(auto-(?:fill|fit),\s*minmax\([^;]*;/g) ?? [];
    assert.ok(autoFill.length >= 4, 'expected at least four auto-fill grids');
    for (const rule of autoFill) {
      assert.match(
        rule,
        /minmax\(min\(\d+px,\s*100%\),\s*1fr\)/,
        `auto-fill grid must guard its minimum with min(): ${rule}`,
      );
    }
  });

  it('pricing grid steps 3 -> 2 -> 1 columns across the breakpoints', () => {
    assert.match(css, /\.price-grid\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(3,\s*1fr\)/, '3 columns on desktop');
    assert.match(css, /@media \(max-width: 1180px\)\s*\{\s*\.price-grid\s*\{\s*grid-template-columns:\s*1fr 1fr;/, '2 columns at 1180px');
    assert.match(css, /@media \(max-width: 640px\)\s*\{\s*\.price-grid\s*\{\s*grid-template-columns:\s*1fr;/, '1 column at 640px');
  });

  it('container gutters tighten progressively on small screens', () => {
    assert.match(css, /@media \(max-width: 720px\)\s*\{\s*\.aw-container\s*\{\s*padding-left:\s*20px/, '20px at 720px');
    assert.match(css, /@media \(max-width: 400px\)\s*\{\s*\.aw-container\s*\{\s*padding-left:\s*16px/, '16px at 400px');
  });

  it('toolbar inputs flex without overflowing narrow viewports', () => {
    assert.match(css, /\.toolbar input\s*\{\s*flex:\s*1 1 220px;\s*min-width:\s*0/, 'toolbar input flex basis with min-width guard');
  });

  it('the misleading "No knowledge results." empty state is gone from the client', () => {
    assert.ok(!appJs.includes('No knowledge results.'), 'generic empty state must not exist');
    assert.match(appJs, /Your knowledge base is empty/, 'empty-base state exists');
    assert.match(appJs, /No matches for/, 'genuine no-match state exists');
    assert.match(appJs, /Knowledge search failed/, 'search-failure state exists (never faked as empty)');
  });

  it('client maps every real failure mode to an honest, actionable message', () => {
    for (const marker of [
      'provider_not_configured',
      'provider_auth',
      'provider_rate_limited',
      'provider_outage',
      'verification_failed',
      'timed_out',
      'cancelled',
      'requires_pro',
    ]) {
      assert.ok(appJs.includes(`${marker}:`), `friendlyTaskError must handle ${marker}`);
    }
    // Honesty rules: failures are never dressed as success.
    assert.match(appJs, /credit was refunded/, 'refund outcome is stated');
    assert.match(appJs, /Nothing unverified is ever returned as a success/, 'verification failure copy is explicit');
  });

  it('SPA mounts the console, result, environment-info and workspace-empty hooks', () => {
    assert.match(page, /id="master-output"/, 'console output mount');
    assert.match(page, /id="master-result"/, 'terminal result mount');
    assert.match(page, /id="master-console-state"/, 'console state chip');
    assert.match(page, /id="master-info-body"/, 'environment info mount');
    assert.match(page, /id="project-workspace"/, 'project inspector mount');
    assert.match(page, /Select a project to inspect/, 'honest workspace empty state in markup');
  });

  it('client bundle still contains no provider credential material', () => {
    assert.ok(!appJs.includes('GOOGLE_API_KEY='), 'no key assignments');
    assert.ok(!appJs.includes('AIza'), 'no Google key literals');
    assert.ok(!/Bearer\s+[A-Za-z0-9._-]{20,}/.test(appJs), 'no hardcoded bearer tokens');
    // The environment panel may only ever reference env key NAMES from the
    // server-provided /api/models payload, never values.
    assert.match(appJs, /p\.configured/, 'provider availability comes from the server response');
  });
});
