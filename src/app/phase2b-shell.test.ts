import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const component = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.tsx'), 'utf8');
const css = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');
const appShell = readFileSync(join(root, 'src/app/_components/app-shell.tsx'), 'utf8');
const chatPage = readFileSync(join(root, 'src/app/chat/page.tsx'), 'utf8');
const workPage = readFileSync(join(root, 'src/app/work/page.tsx'), 'utf8');
const chatRoute = readFileSync(join(root, 'src/routes/chat.ts'), 'utf8');

describe('typed Chat/Task shell contract', () => {
  it('uses dedicated App Router routes with the unified signed-in chrome', () => {
    assert.match(chatPage, /<WorkbenchShell initialMode="chat" \/>/);
    assert.match(workPage, /<WorkbenchShell initialMode="work" \/>/);
    assert.match(component, /<AppShell title=\{title\}>/);
    assert.match(appShell, /NAV_ITEMS/);
  });

  it('provides streaming Chat, stop, model choice, Markdown, copy, and no task credits', () => {
    assert.match(component, /gemini-3\.8-flash/);
    assert.match(component, /readSse/);
    assert.match(component, /abortRef\.current\?\.abort/);
    assert.match(component, /<select value=\{model\}/);
    assert.match(component, /function Markdown/);
    assert.match(component, /<CopyButton value=\{message\.content\}/);
    assert.match(component, /Chat never deducts Work task credits/);
    assert.match(chatRoute, /creditsUsed: 0/);
  });

  it('provides Task progress, cancellation, upload, preview, and export', () => {
    for (const stage of ['Understanding', 'Planning', 'Routing', 'Executing', 'Verifying', 'Complete']) assert.match(component, new RegExp(stage));
    assert.match(component, /cancelWork/);
    assert.match(component, /refunded/);
    assert.match(component, /Upload image/);
    assert.match(component, /Sandboxed Work artifact/);
    assert.match(component, /downloadArtifact/);
    assert.match(component, /Export ZIP/);
    assert.match(component, /Credits are consumed only on success/);
  });

  it('enforces responsive layout and large controls using existing tokens', () => {
    assert.match(css, /min-height:44px/);
    assert.match(css, /@media\(max-width:1000px\)/);
    assert.match(css, /@media\(max-width:620px\)/);
    assert.match(css, /@media\(max-width:360px\)/);
    assert.match(css, /var\(--accent\)/);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}/);
  });

  it('keeps the one-product navigation exact and removes old broad menu entries', () => {
    for (const item of ['Chat', 'Task', 'Files & documents', 'Images', 'Projects', 'Agents', 'Automations', 'Dashboard', 'Billing & credits', 'See plans and pricing', 'Settings', 'Help']) assert.match(appShell, new RegExp(item.replace('+', '\\+')));
    for (const oldItem of ['Marketplace', 'Agent Factory', 'CRM']) assert.doesNotMatch(appShell + component, new RegExp(oldItem));
  });

  it('contains no explicit any type in the typed shell', () => {
    assert.doesNotMatch(component, /\bany\b/);
  });
});
