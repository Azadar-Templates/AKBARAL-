import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * REGRESSION LOCK — owner/super_admin credit pill (2026-09-30).
 *
 * Audit found the header correctly reading "owner workspace · unlimited
 * execution" (role-derived) while the separate credit pill next to it still
 * showed "Trial · 1 free" — raw, un-role-aware billing bookkeeping from
 * `/api/me`. Real execution was never limited (see
 * src/orchestrator/owner-entitlement.test.ts, unchanged by this fix); this
 * was a display bug in `updateCreditPill()`/`loadMe()`.
 *
 * The fix: `/api/me` now returns an explicit `unlimited` flag computed by
 * the SAME `hasUnlimitedTaskCredits` helper the orchestrator already uses
 * (src/routes/me.test — backend coverage lives in
 * src/routes/owner-entitlement-display.test.ts, which exercises the real
 * HTTP responses end to end). This file locks the CLIENT side: the pill
 * must read that flag and never fall through to the trial/credit branch
 * when it is true, and normal users must render through the exact same
 * code path as before (unchanged).
 *
 * `public/app.js` is a plain, unbundled script with no module exports (see
 * its closing IIFE), so — consistent with every other test that covers it
 * (e.g. src/app/economy-ui.test.ts) — this is a source-contract test rather
 * than a full DOM execution test.
 */

const root = process.cwd();
const appJs = readFileSync(join(root, 'public', 'app.js'), 'utf8');

const slice = (from: string, to: string) => {
  const start = appJs.indexOf(from);
  assert.ok(start > 0, `${from} exists`);
  const end = appJs.indexOf(to, start);
  assert.ok(end > start, `${to} follows ${from}`);
  return appJs.slice(start, end);
};

describe('owner/super_admin credit pill — unlimited execution, never "Trial · N free"', () => {
  it('loadMe() captures the server-computed unlimited flag from /api/me, and nothing else derives it', () => {
    const fn = slice('async function loadMe()', 'function updateCreditPill()');
    assert.ok(fn.includes("api('/api/me')"), 'still reads the real /api/me endpoint');
    assert.ok(fn.includes('state.unlimited = Boolean(body.unlimited)'), 'the server flag is captured verbatim, never recomputed from role on the client');
    assert.ok(fn.includes('state.trial = body.trial') && fn.includes('state.user = body.user'), 'existing fields are still captured unchanged');
  });

  it('updateCreditPill() shows "Unlimited execution" and returns before the trial/credit branch when unlimited', () => {
    const full = slice('function updateCreditPill()', "shellPill.title = onTrial ? `${credits} free task credits on trial` : `${credits} task credits`;\n    }\n  }");

    assert.ok(full.includes('if (state.unlimited)'), 'the unlimited flag gates the pill before anything else');
    assert.ok(full.includes("'Unlimited execution'"), 'the exact label the owner should see');
    assert.ok(!/Trial · \$\{credits\}/.test(full.split('if (state.unlimited)')[1].split('return;')[0]), 'the unlimited branch never falls through to the trial wording');

    const unlimitedBranch = full.slice(full.indexOf('if (state.unlimited)'), full.indexOf('return;') + 'return;'.length);
    assert.ok(!unlimitedBranch.includes('Trial'), 'no "Trial" text anywhere in the unlimited branch');
    assert.ok(!unlimitedBranch.includes('free tasks'), 'no misleading free-task-count wording in the unlimited branch');
    assert.ok(unlimitedBranch.includes('return;'), 'the unlimited branch exits before the trial/credit computation below it');
  });

  it('normal-user rendering path (onTrial / Credits) is textually unchanged after the unlimited branch', () => {
    const fn = slice('function updateCreditPill()', '\n  }\n\n');
    assert.ok(fn.includes('const onTrial = Boolean(state.trial?.active ?? state.trial?.isActive)'), 'trial detection logic unchanged');
    assert.ok(fn.includes('`Trial · ${credits} free tasks`') && fn.includes('`Credits · ${credits}`'), 'normal-user pill wording unchanged');
    assert.ok(fn.includes("`Trial · ${credits} free`") && fn.includes('free task credits on trial'), 'shell pill wording unchanged for normal users');
  });

  it('state has an explicit unlimited field, defaulting to false before /api/me resolves', () => {
    const initState = slice('const state = {', '};');
    assert.ok(initState.includes('unlimited: false'), 'unlimited defaults to false, never undefined, before the first /api/me response');
  });
});
