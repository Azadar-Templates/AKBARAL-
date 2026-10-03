import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const component = readFileSync(join(process.cwd(), 'src/app/_components/workbench/workbench-shell.tsx'), 'utf8');
const css = readFileSync(join(process.cwd(), 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');
const workspace = readFileSync(join(process.cwd(), 'src/app/workspace/page.tsx'), 'utf8');
const chatRoute = readFileSync(join(process.cwd(), 'src/routes/chat.ts'), 'utf8');

describe('Phase 2B typed Chat/Work shell contract', () => {
  it('uses a dedicated App Router shell with animated Chat and Work tabs', () => {
    assert.match(workspace, /<WorkbenchShell\s*\/>/);
    assert.match(component, /layoutId="active-mode"/);
    assert.match(component, /role="tablist"/);
    assert.match(component, /role="tab"/);
  });

  it('provides streaming Chat, stop, regenerate, model choice, Markdown/code, and copy', () => {
    assert.match(component, /gemini-3\.8-flash/);
    assert.match(component, /readSse/);
    assert.match(component, /abortRef\.current\?\.abort/);
    assert.match(component, /Regenerate/);
    assert.match(component, /function Markdown/);
    assert.match(component, /Copy to clipboard/);
    assert.match(chatRoute, /creditsUsed: 0/);
    assert.match(chatRoute, /No task credit was deducted/);
  });

  it('provides MASTER Work progress, cancellation/refund language, history and artifacts', () => {
    for (const stage of ['Understanding', 'Planning', 'Routing', 'Executing', 'Verifying', 'Complete']) assert.match(component, new RegExp(stage));
    assert.match(component, /\/cancel/);
    assert.match(component, /refunded/);
    assert.match(component, /Final artifact/);
    assert.match(component, /downloadArtifact/);
    assert.match(component, /openWork/);
    assert.match(component, /retryWork/);
    assert.match(component, /5 successful tasks during the 30-day Free trial/);
  });

  it('enforces responsive 320/768/1440-capable layout and 44px controls using existing tokens', () => {
    assert.match(css, /min-height:44px/);
    assert.match(css, /@media\(max-width:760px\)/);
    assert.match(css, /@media\(max-width:360px\)/);
    assert.match(css, /var\(--accent\)/);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}/);
  });

  it('contains no explicit any type in new Phase 2B implementation', () => {
    assert.doesNotMatch(component, /\bany\b/);
    assert.doesNotMatch(chatRoute, /\bany\b/);
  });
});
