import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const component = readFileSync(join(process.cwd(), 'src/app/_components/workbench/workbench-shell.tsx'), 'utf8');
const css = readFileSync(join(process.cwd(), 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');
const workspace = readFileSync(join(process.cwd(), 'src/app/workspace/page.tsx'), 'utf8');
const chatRoute = readFileSync(join(process.cwd(), 'src/routes/chat.ts'), 'utf8');
const legacyClient = readFileSync(join(process.cwd(), 'public/app.js'), 'utf8');
const legacyLoader = readFileSync(join(process.cwd(), 'src/app/_components/legacy-app-loader.tsx'), 'utf8');

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

  it('makes the typed Chat shell the post-auth default and isolates it from the legacy bundle', () => {
    assert.match(legacyClient, /function afterSignIn\(\)[\s\S]*window\.location\.href = '\/chat'/);
    assert.match(legacyClient, /if \(state\.user\) \{\s*window\.location\.href = '\/chat'/);
    assert.match(legacyLoader, /!\['\/', '\/signin', '\/signup'\]\.includes/);
    assert.match(component, /initialMode = 'chat'/);
  });

  it('keeps user navigation simple and role-gates advanced console entry points', () => {
    for (const item of ['New Chat', 'New Work Task', 'Settings', 'Chat', 'Work']) assert.match(component, new RegExp(item));
    assert.match(component, /\['owner', 'super_admin'\]\.includes[\s\S]*Owner console/);
    assert.match(component, /\['admin', 'super_admin'\]\.includes[\s\S]*Admin console/);
    assert.match(component, /\/api\/me/);
    for (const oldItem of ['Agent Factory', 'Automations', 'Marketplace']) assert.doesNotMatch(component, new RegExp(`>${oldItem}<`));
  });

  it('groups Chat and Work history by date without changing their APIs', () => {
    for (const label of ['Today', 'Yesterday', 'Previous 7 days', 'Earlier']) assert.match(component, new RegExp(label));
    assert.match(component, /groupByDate/);
    assert.match(component, /api\('\/api\/chat'/);
    assert.match(component, /api\('\/api\/workflows'/);
  });

  it('contains no explicit any type in new Phase 2B implementation', () => {
    assert.doesNotMatch(component, /\bany\b/);
    assert.doesNotMatch(chatRoute, /\bany\b/);
  });
});
