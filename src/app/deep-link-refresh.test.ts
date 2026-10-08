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
const canonical = ['/', '/signin', '/signup', '/chat', '/work', '/master', '/workspace', '/files', '/images', '/projects', '/agents', '/agent-factory', '/automations', '/dashboard', '/billing', '/owner', '/mission', '/admin', '/pricing', '/settings', '/help'];

test('all one-product canonical routes have real App Router pages', () => {
  for (const route of canonical) {
    assert.ok(routes.has(route), `${route} route file missing`);
  }
  // The landing reset accepts one optional presentation prop (the owner hero
  // video opt-in); the assertion still means "root renders the landing reset".
  assert.match(readFileSync(join(appDir, 'page.tsx'), 'utf8'), /<LandingReset\b[^>]*\/>/, 'root renders the landing reset');
  assert.match(readFileSync(join(appDir, 'signin', 'page.tsx'), 'utf8'), /<AuthCard mode="signin" \/>/, 'signin renders typed auth');
  assert.match(readFileSync(join(appDir, 'settings', 'page.tsx'), 'utf8'), /<SettingsSurface \/>/, 'settings renders real options');
});

test('legacy workspace aliases redirect while redesigned public routes render real pages', () => {
  const config = readFileSync(join(repoRoot, 'next.config.mjs'), 'utf8');
  assert.match(config, /'\/master', '\/workspace'[\s\S]*destination: '\/work'/, 'legacy workspace routes redirect to Task');
  for (const current of ['/about', '/agent-factory', '/contact', '/documentation', '/faq', '/features', '/feedback', '/privacy', '/security', '/terms']) {
    assert.ok(routes.has(current), `${current} has a real App Router page`);
  }
  for (const current of ['/dashboard', '/projects', '/billing', '/agents', '/help', '/pricing', '/settings']) {
    assert.ok(!new RegExp(`source, destination: '\\/chat'[\\s\\S]{0,40}${current.replace('/', '\\/')}`).test(config), `${current} must not redirect to /chat`);
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
  // The private mission proxy is intentionally the only scoped catch-all: it is
  // owner-gated before any upstream call and is not a public application SPA.
  assert.deepEqual(catchAll, ['[[...path]]'], 'only the owner-gated mission proxy may catch a path suffix');
  assert.ok(!routes.has('/nonexistent-xyz'));
});

test('mission remains an honest customer-facing boundary, not a private operations feed', () => {
  assert.ok(routes.has('/mission'));
  assert.match(readFileSync(join(appDir, 'mission', 'page.tsx'), 'utf8'), /separate owner mission service/);
  const publicSources = [
    readFileSync(join(appDir, 'page.tsx'), 'utf8'),
    readFileSync(join(appDir, '_components', 'landing-reset.tsx'), 'utf8'),
    readFileSync(join(appDir, '_components', 'app-shell.tsx'), 'utf8'),
    readFileSync(join(repoRoot, 'public', 'app.js'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(publicSources, /ZA141251SA/);
});
