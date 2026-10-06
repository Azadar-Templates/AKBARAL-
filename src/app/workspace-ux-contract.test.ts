import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const shell = readFileSync(join(root, 'src/app/_components/app-shell.tsx'), 'utf8');
const shellCss = readFileSync(join(root, 'src/app/_components/app-shell.module.css'), 'utf8');
const workbench = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.tsx'), 'utf8');
const workCss = readFileSync(join(root, 'src/app/_components/workbench/workbench-shell.module.css'), 'utf8');
const dataSurfaces = readFileSync(join(root, 'src/app/_components/data-surfaces.tsx'), 'utf8');

describe('one-product workspace UX contract', () => {
  it('header chrome mounts the exact requested top-level inventory', () => {
    for (const label of ['Chat', 'Task', 'Files & documents', 'Images', 'Projects', 'Agents', 'Automations', 'Dashboard', 'Billing & credits', 'See plans and pricing', 'Settings', 'Help']) {
      assert.ok(shell.includes(`label: '${label}'`), `${label} lives in the shell nav`);
    }
    assert.match(shellCss, /\.topbar\{position:sticky/);
    assert.match(shell, /<WorkspaceNavigation/);
    assert.doesNotMatch(shell, /Collapse navigation|shellCollapsed|className=\{styles\.sidebar\}/);
  });

  it('top bar contains page title and avatar menu with role-gated Owner/Admin', () => {
    assert.match(shell, /<h1>\{title\}<\/h1>/);
    assert.match(shell, /Settings<\/Link>/);
    assert.match(shell, /Billing &amp; credits/);
    assert.match(shell, /Help<\/Link>/);
    assert.match(shell, /canOwner \? <Link href="\/owner" onClick=\{closeAccountMenu\}>Owner<\/Link>/);
    assert.match(shell, /canAdmin \? <Link href="\/admin" onClick=\{closeAccountMenu\}>Admin<\/Link>/);
    assert.match(shell, /Log out/);
  });

  it('Chat centers the large composer and honest empty thread', () => {
    assert.match(workbench, /How can I help\?/);
    assert.match(workbench, /<textarea[^>]*rows=\{4\}/s);
    assert.match(workCss, /\.sessionMain > \.messages,[\s\S]*?width: 100%/);
    assert.match(workCss, /\.page,[\s\S]*?\.session[\s\S]*?width: 100%/);
    assert.doesNotMatch(workCss, /max-width:880px/);
    assert.match(workbench, /No conversation yet\./);
    assert.match(workbench, /Chat never deducts Work task credits/);
  });

  it('Task shows goal input, stages, image upload, preview rail, and export', () => {
    for (const marker of ['Describe the goal.', 'Upload image', 'Export ZIP', 'No artifact yet.', 'Sandboxed Work artifact']) assert.match(workbench, new RegExp(marker.replace(/[.?]/g, '\\$&')));
    for (const stage of ['Understanding', 'Planning', 'Routing', 'Executing', 'Verifying', 'Complete']) assert.match(workbench, new RegExp(stage));
    assert.match(workbench, /\/api\/projects\/\$\{encodeURIComponent\(id\)\}\/files/);
    assert.match(workbench, /\/api\/master\/\$\{encodeURIComponent\(workflowId\)\}\/export/);
  });

  it('Files, Images, Projects, Agents, Automations, Billing render real data and empty states', () => {
    for (const fn of ['FilesSurface', 'ImagesSurface', 'ProjectsSurface', 'AgentsSurface', 'AutomationsSurface', 'BillingSurface']) assert.match(dataSurfaces, new RegExp(`function ${fn}`));
    for (const empty of ['No files yet.', 'No images yet.', 'No projects yet.', 'No automations yet.', 'No invoices yet.', 'No payments yet.']) assert.ok(dataSurfaces.includes(empty), `${empty} exists`);
  });

  it('settings is real options and dashboard is separate', () => {
    assert.match(dataSurfaces, /function SettingsSurface/);
    for (const heading of ['Account', 'Appearance', 'Plan &amp; billing', 'Privacy &amp; security', 'Help &amp; feedback']) assert.ok(dataSurfaces.includes(heading));
    assert.match(dataSurfaces, /function DashboardSurface/);
  });

  it('new workspace styles avoid hardcoded hue colors and horizontal overflow', () => {
    for (const css of [shellCss, workCss]) {
      assert.match(css, /overflow-x:hidden|overflow:auto/);
      assert.match(css, /min-width:0/);
      assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
