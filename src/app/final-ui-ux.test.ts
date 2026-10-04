import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const landing = read('src/app/_components/landing-reset.tsx');
const page = read('src/app/page.tsx');
const appShell = read('src/app/_components/app-shell.tsx');
const workbench = read('src/app/_components/workbench/workbench-shell.tsx');
const workbenchCss = read('src/app/_components/workbench/workbench-shell.module.css');
const dataSurfaces = read('src/app/_components/data-surfaces.tsx');
const authCard = read('src/app/_components/auth-card.tsx');

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const path = `${dir}/${entry}`;
    const stat = statSync(join(root, path));
    if (stat.isDirectory()) out.push(...collectFiles(path));
    else out.push(path);
  }
  return out;
}

describe('AKBARAL! full UI/UX reset contract', () => {
  it('root is always the landing page and not the sign-in view', () => {
    assert.match(page, /<LandingReset \/>/);
    assert.match(landing, /One Intelligence\. Every Solution\./);
    assert.match(landing, /Go to your workspace/);
    assert.match(landing, /One simple product/);
    assert.doesNotMatch(page + landing, /location\.hash = '#\/login'|Sign in to your workspace/);
  });

  it('landing sections follow the required one-product flow', () => {
    const markers = ['topbar', 'hero', 'chips', 'features-title', 'integrations-title', 'thread-title', 'agents-title', 'security-title', 'steps-title', 'faq-title', 'final-title', 'footer'];
    let previous = -1;
    for (const marker of markers) {
      const index = landing.indexOf(marker);
      assert.ok(index > previous, `${marker} appears in order`);
      previous = index;
    }
  });

  it('settings is a real options page and not the dashboard', () => {
    for (const heading of ['Account', 'Appearance', 'Plan &amp; billing', 'Privacy &amp; security', 'Help &amp; feedback']) {
      assert.ok(dataSurfaces.includes(heading), `${heading} heading exists`);
    }
    const settingsSlice = dataSurfaces.slice(dataSurfaces.indexOf('export function SettingsSurface'), dataSurfaces.indexOf('async function loadProjectDetails'));
    assert.doesNotMatch(settingsSlice, /User Dashboard/);
    assert.match(read('src/app/settings/page.tsx'), /<SettingsSurface \/>/);
  });

  it('signed-in chrome exposes exactly the requested navigation inventory', () => {
    for (const label of ['+ New chat', 'Task', 'Files & documents', 'Images', 'Projects', 'Agents', 'Automations', 'Dashboard', 'Billing & credits', 'See plans and pricing', 'Settings', 'Help']) {
      assert.ok(appShell.includes(`label: '${label}'`), `${label} is in NAV_ITEMS`);
    }
    for (const old of ['Marketplace', 'Agent Factory', 'CRM', 'Start Building']) assert.doesNotMatch(appShell, new RegExp(old));
  });

  it('chat and task composers are large, auto-growing, and honest about credits', () => {
    assert.match(workbench, /<textarea[^>]*rows=\{4\}/s);
    assert.match(workbenchCss, /min-height:112px/);
    assert.match(workbenchCss, /max-height:30vh/);
    assert.match(workbench, /Enter' && !event\.shiftKey/);
    assert.match(workbench, /Chat never deducts Work task credits/);
    assert.match(workbench, /Credits are consumed only on success — failures refund automatically/);
  });

  it('pricing is the exact six-plan USD table everywhere it is used', () => {
    const pricing = read('src/app/_lib/pricing.ts');
    for (const entry of ["Free', price: '$0', tasks: '5 tasks'", "Starter', price: '$10', tasks: '25 tasks'", "Pro', price: '$50', tasks: '100 tasks'", "Business', price: '$90', tasks: '250 tasks'", "Scale', price: '$200', tasks: '750 tasks'", "Enterprise', price: '$400', tasks: '2,000 tasks'"]) {
      assert.ok(pricing.includes(entry), `${entry} exists`);
    }
    assert.match(pricing, /All prices are USD/);
  });

  it('public runtime sources contain no forbidden reference strings or private identifier', () => {
    const files = [...collectFiles('src/app'), ...collectFiles('public')].filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'));
    const source = files.map((file) => read(file)).join('\n');
    assert.doesNotMatch(source, /Atlas|WorkOS|Slack|use\.ai|ChatGPT/i);
    assert.doesNotMatch(source, /ZA141251SA/);
  });

  it('auth remains minimal and config-gated without setup copy', () => {
    assert.match(authCard, /type="email"/);
    assert.match(authCard, /type="password"/);
    assert.match(authCard, /provider\.key === 'google' \|\| provider\.key === 'github'/);
    assert.doesNotMatch(authCard, /setup needed|client_secret|callback uri|debug/i);
  });
});
