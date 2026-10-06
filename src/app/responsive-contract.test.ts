import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const shellCss = readFileSync(join(root, 'src/app/_components/app-shell.module.css'), 'utf8');
const workCss = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');
const landingCss = readFileSync(join(root, 'src/app/_components/landing-reset.module.css'), 'utf8');
const workbench = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.tsx'), 'utf8');
const dataSurfaces = readFileSync(join(root, 'src/app/_components/data-surfaces.tsx'), 'utf8');

describe('responsive + honest empty-state contract for UI reset', () => {
  it('app shell uses sidebar + main grid and collapses to a drawer under 1024px', () => {
    assert.match(shellCss, /grid-template-columns:280px minmax\(0,1fr\)/);
    // Menu/rail fix: the collapsed rail is a true 56px icon strip (the A!
    // mark and 44px toggle stay unclipped inside it — see menu-rail-fix tests).
    assert.match(shellCss, /shellCollapsed\{grid-template-columns:56px minmax\(0,1fr\)/);
    assert.match(shellCss, /@media\(max-width:1023px\)/);
    assert.match(shellCss, /transform:translateX\(-105%\)/);
    assert.match(shellCss, /width:min\(310px,86vw\)/);
  });

  it('topbar, content, and rows guard against horizontal overflow', () => {
    for (const marker of ['overflow-x:hidden', 'min-width:0', 'max-width:100%', 'overflow-wrap:anywhere']) assert.match(shellCss, new RegExp(marker.replace(/[()]/g, '\\$&')));
    assert.match(shellCss, /@media\(max-width:767px\)/);
    assert.match(shellCss, /@media\(max-width:360px\)/);
  });

  it('chat composer is four-line minimum and sends on Enter with Shift+Enter preserved', () => {
    assert.match(workbench, /<textarea[^>]*rows=\{4\}/s);
    // The floor is now viewport-aware: 96px on desktop, 44px on a phone, and
    // the cap follows the live viewport (dvh) rather than a static vh.
    assert.match(workCss, /\.composer textarea\{[^}]*min-height:(?:96|112)px/);
    assert.match(workCss, /max-height:\s*30dvh/);
    assert.match(workCss, /@media\(max-width:639px\)[\s\S]*?\.composer textarea\s*\{[^}]*min-height:\s*44px/);
    assert.match(workbench, /event\.key === 'Enter' && !event\.shiftKey/);
  });

  it('task preview rail places export above the sandboxed preview', () => {
    const exportIndex = workbench.indexOf('Export ZIP');
    const previewIndex = workbench.indexOf('Sandboxed Work artifact');
    assert.ok(exportIndex > 0 && previewIndex > exportIndex, 'export appears before preview iframe');
    assert.match(workCss, /previewRail/);
    assert.match(workCss, /previewBox\{min-height:420px/);
    assert.match(workCss, /iframe\{width:100%;height:100%;min-height:420px/);
  });

  it('task stages and work grid collapse cleanly', () => {
    assert.match(workCss, /grid-template-columns:minmax\(0,1fr\) minmax\(320px,420px\)/);
    assert.match(workCss, /@media\(max-width:1000px\)\{\.workGrid\{grid-template-columns:(?:1fr|minmax\(0,1fr\))\}/);
    assert.match(workCss, /@media\(max-width:639px\)/);
    assert.match(workCss, /@media\(max-width:360px\)/);
  });

  it('landing and pricing cards use responsive one-column fallbacks', () => {
    assert.match(landingCss, /@media\(max-width:880px\)/);
    assert.match(landingCss, /@media\(max-width:560px\)/);
    assert.match(landingCss, /grid-template-columns:1fr/);
    assert.match(dataSurfaces, /AKBARAL_PLANS\.map/);
  });

  it('real data pages render honest empty states, not mock rows', () => {
    for (const text of ['No Work tasks yet.', 'No chats yet.', 'No files yet.', 'No images yet.', 'No projects yet.', 'No automations yet.', 'No invoices yet.', 'No payments yet.']) {
      assert.ok(dataSurfaces.includes(text), `${text} exists`);
    }
    assert.doesNotMatch(dataSurfaces, /mock|sample row|demo row/i);
  });

  it('new UI CSS uses tokens and no hardcoded hex colors', () => {
    for (const css of [shellCss, workCss, landingCss]) {
      assert.match(css, /var\(--accent\)/);
      assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
