import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = process.cwd();
const appDir = join(repoRoot, 'src', 'app');

function routePaths(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const segment = /^\(.*\)$/.test(entry.name) ? '' : `/${entry.name}`;
      const next = `${prefix}${segment}`;
      const child = join(dir, entry.name);
      if (existsSync(join(child, 'page.tsx')) || existsSync(join(child, 'route.ts'))) found.add(next === '' ? '/' : next);
      walk(child, next);
    }
  };
  walk(appDir, '');
  found.add('/');
  return found;
}

const routes = routePaths();
const canonical = ['/', '/signin', '/signup', '/chat', '/work', '/files', '/images', '/projects', '/agents', '/automations', '/dashboard', '/billing', '/pricing', '/settings', '/help'];

test('all one-product canonical routes have real App Router pages', () => {
  for (const route of canonical) {
    assert.ok(routes.has(route), `${route} route file missing`);
  }
  assert.match(readFileSync(join(appDir, 'page.tsx'), 'utf8'), /<LandingReset \/>/, 'root renders the landing reset');
  assert.match(readFileSync(join(appDir, 'signin', 'page.tsx'), 'utf8'), /<AuthCard mode="signin" \/>/, 'signin renders typed auth');
  assert.match(readFileSync(join(appDir, 'settings', 'page.tsx'), 'utf8'), /<SettingsSurface \/>/, 'settings renders real options');
});

test('legacy clean URLs redirect through next.config instead of rendering old UI', () => {
  const config = readFileSync(join(repoRoot, 'next.config.mjs'), 'utf8');
  assert.match(config, /'\/master', '\/workspace'[\s\S]*destination: '\/work'/, 'legacy workspace routes redirect to Task');
  for (const oldPath of ['/about', '/agent-factory', '/contact', '/documentation', '/faq', '/features', '/feedback', '/privacy', '/security', '/terms']) {
    assert.ok(config.includes(`'${oldPath}'`), `${oldPath} stays in the legacy redirect list`);
  }
  for (const current of ['/dashboard', '/projects', '/billing', '/agents', '/help', '/pricing', '/settings']) {
    assert.ok(!new RegExp(`source, destination: '\/chat'[\\s\\S]{0,40}${current.replace('/', '\\/')}`).test(config), `${current} must not redirect to /chat`);
  }
});

test('unknown paths still 404 instead of silently serving the application', () => {
  const dirs: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { dirs.push(entry.name); walk(join(dir, entry.name)); }
    }
  };
  walk(appDir);
  const catchAll = dirs.filter((name) => name.startsWith('[...') || name.startsWith('[[...'));
  assert.deepEqual(catchAll, [], 'a catch-all route would make every unknown path a 200');
  assert.ok(!routes.has('/nonexistent-xyz'));
});

test('private mission identifier stays out of public app routes and assets', () => {
  for (const route of routes) assert.ok(!/za141251sa|mission/i.test(route), `${route} must not exist in the public application`);
  const publicSources = [
    readFileSync(join(appDir, 'page.tsx'), 'utf8'),
    readFileSync(join(appDir, '_components', 'landing-reset.tsx'), 'utf8'),
    readFileSync(join(appDir, '_components', 'app-shell.tsx'), 'utf8'),
    readFileSync(join(repoRoot, 'public', 'app.js'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(publicSources, /ZA141251SA/);
});
