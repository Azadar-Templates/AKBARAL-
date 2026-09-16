import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Deep-link refresh contract.
 *
 * The application is hash-routed (`#/login`, `#/projects`, …), so a refresh of
 * a hash URL always reloads `/` and works. A CLEAN path has no such guarantee:
 * unless the server has a real route for it, the browser gets the framework's
 * "404: This page could not be found." page on refresh, on a bookmark, or when
 * the link is shared.
 *
 * That is exactly what production did: `/signin`, `/signup`, `/projects`,
 * `/billing` and `/admin` returned 404 HTML (14 KB) on a direct request while
 * `/` and `/workspace` returned the 146 KB application shell. The server was
 * fine; the routes simply did not exist.
 *
 * This test pins the corrected contract:
 *   1. every clean path the SPA maps to a screen has a real Next route,
 *   2. the SPA's own map and the route set cannot drift apart,
 *   3. unknown paths stay unknown (no catch-all that would swallow real 404s),
 *   4. ZA141251SA is never a public route — the private mission console is a
 *      different application on a different port and must remain unreachable
 *      from the public product.
 */

const repoRoot = process.cwd();
const appDir = join(repoRoot, 'src', 'app');
const spaSource = readFileSync(join(repoRoot, 'public', 'app.js'), 'utf8');

assert.ok(existsSync(join(repoRoot, 'next.config.mjs')), 'tests must run from the repository root');

/** The clean paths the SPA maps to screens (path → view). */
function spaPathViews(): Record<string, string> {
  const match = spaSource.match(/const PATH_VIEWS = \{([\s\S]*?)\};/);
  assert.ok(match, 'public/app.js must define PATH_VIEWS for clean deep links');
  const entries: Record<string, string> = {};
  for (const pair of match[1].matchAll(/'([^']+)':\s*'([^']+)'/g)) {
    entries[pair[1]] = pair[2];
  }
  return entries;
}

/** Every real Next route path present on disk (App Router). */
function routePaths(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Route groups like (public) do not appear in the URL.
      const segment = /^\(.*\)$/.test(entry.name) ? '' : `/${entry.name}`;
      const next = `${prefix}${segment}`;
      const child = join(dir, entry.name);
      if (existsSync(join(child, 'page.tsx')) || existsSync(join(child, 'route.ts'))) {
        found.add(next === '' ? '/' : next);
      }
      walk(child, next);
    }
  };
  walk(appDir, '');
  found.add('/');
  return found;
}

const pathViews = spaPathViews();
const routes = routePaths();

test('every clean deep link the SPA opens has a real server route', () => {
  const paths = Object.keys(pathViews);
  assert.ok(paths.length >= 6, `expected the app surfaces to be mapped, saw: ${paths.join(', ')}`);
  for (const path of paths) {
    assert.ok(routes.has(path), `${path} is mapped by the SPA but has no route file — a refresh there would 404`);
    const page = join(appDir, path.slice(1), 'page.tsx');
    assert.ok(existsSync(page), `${page} must exist`);
    const source = readFileSync(page, 'utf8');
    assert.match(source, /return <Home \/>;/, `${path} must render the application shell`);
    assert.match(source, /robots: \{ index: false/, `${path} is an application surface and must not be indexed`);
  }
});

test('the SPA map and the route set cannot drift apart', () => {
  // Every non-marketing app route on disk must be one the SPA can open.
  const appSurfaces = ['/workspace', '/master', '/signin', '/signup', '/projects', '/billing', '/admin'];
  for (const surface of appSurfaces) {
    assert.ok(routes.has(surface), `${surface} route file missing`);
    assert.ok(pathViews[surface], `${surface} exists but the SPA does not map it to a screen`);
  }
});

test('unknown paths still 404 instead of silently serving the application', () => {
  // A catch-all ([[...slug]]/[...slug]) would turn every typo into a 200 and
  // hide real broken links. There must be none.
  const dirs: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push(entry.name);
        walk(join(dir, entry.name));
      }
    }
  };
  walk(appDir);
  const catchAll = dirs.filter((name) => name.startsWith('[...') || name.startsWith('[[...'));
  assert.deepEqual(catchAll, [], 'a catch-all route would make every unknown path a 200');
  assert.ok(!routes.has('/nonexistent-xyz'));
});

test('ZA141251SA stays out of the public product', () => {
  const publicRoutes = [...routes];
  for (const route of publicRoutes) {
    assert.ok(!/za141251sa|mission/i.test(route), `${route} must not exist in the public application`);
  }
  // The mission console is served by its own process on its own port; nothing
  // in the platform's public assets may point a user at it.
  const spa = spaSource.toLowerCase();
  assert.ok(!spa.includes('za141251sa'), 'the public SPA must not mention the private mission system');
  // Port 4200 must not appear as an ADDRESS (a bare number could just be a
  // timeout — app.js legitimately uses `setTimeout(..., 4200)`).
  assert.doesNotMatch(spa, /(:\/\/|localhost|127\.0\.0\.1|\.e2b\.app)?[:.]4200\b/, 'the public SPA must not link the mission console port');
});
