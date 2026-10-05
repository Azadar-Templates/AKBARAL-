import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const publicSources = [
  readFileSync(join(root, 'src', 'app', 'page.tsx'), 'utf8'),
  readFileSync(join(root, 'src', 'app', '_components', 'landing-reset.tsx'), 'utf8'),
  readFileSync(join(root, 'src', 'app', '_components', 'app-shell.tsx'), 'utf8'),
  readFileSync(join(root, 'next.config.mjs'), 'utf8'),
].join('\n');
const appJs = readFileSync(join(root, 'public', 'app.js'), 'utf8');

describe('private economy surfaces are not part of the public UI reset', () => {
  it('does not mount private workforce/economy panels on the landing page', () => {
    for (const id of ['economy-workforce', 'economy-primaries', 'agent-inspector-slug', 'economy-command', 'economy-commands']) {
      assert.ok(!publicSources.includes(id), `${id} is not mounted by public App Router pages`);
    }
  });

  it('keeps private mission identifiers out of public app sources', () => {
    assert.doesNotMatch(publicSources, /ZA141251SA/);
    assert.doesNotMatch(appJs, /ZA141251SA/);
  });

  it('keeps canonical navigation focused on the one product inventory', () => {
    for (const label of ['Chat', 'Task', 'Files & documents', 'Images', 'Projects', 'Agents', 'Automations', 'Dashboard', 'Billing & credits', 'See plans and pricing', 'Settings', 'Help']) {
      assert.ok(publicSources.includes(label), `${label} is in the canonical app shell`);
    }
  });
});
