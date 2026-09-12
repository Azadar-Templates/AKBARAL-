import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * Preview-stack contract (Phase 3 final fix).
 *
 * Incident: the browser preview showed the sandbox platform's own error
 * page ("Something went wrong. Please try again."). Root cause: the QA
 * stack process had been stopped, so the preview proxied to a dead port —
 * the message is NOT part of this application (verified: zero occurrences
 * in source, in the entire git history via `git log -S`, in served pages,
 * and in the Next.js runtime text). The operational half of the fix is
 * keeping the stack running; these tests lock the app-side wiring that
 * keeps the proxied preview functional, so a config or shell regression
 * cannot silently reintroduce a broken preview:
 *
 *   1. next.config.mjs keeps allowedDevOrigins for the preview host —
 *      without it the proxied origin's dev-mode resources are rejected.
 *   2. The /api, /uploads and /ws rewrites keep the SPA's same-origin
 *      calls working through the single preview port.
 *   3. The web tier must not emit frame-blocking headers (the preview
 *      embeds the app in an iframe; the JSON API keeps its own strict
 *      CSP + X-Frame-Options, which is correct for non-HTML responses).
 *   4. public/app.js must still parse — the SPA entry cannot be shipped
 *      with a syntax error (the server would happily serve a 500-byte
 *      broken script and the preview would look "dead").
 *   5. The page shell must still mount the SPA root and reference the
 *      versioned assets (app.js / styles.css / tokens.css).
 */

interface RewriteRule {
  source: string;
  destination: string;
}

interface NextConfigShape {
  allowedDevOrigins?: string[];
  rewrites?: () => Promise<RewriteRule[] | { after?: RewriteRule[]; before?: RewriteRule[]; fallback?: RewriteRule[] }>;
  headers?: unknown;
}

// The suite always runs from the repository root (npm test invokes tsx
// there); the existence guard fails loudly if that assumption ever breaks
// instead of reading the wrong tree.
const repoRoot = process.cwd() + '/';
assert.ok(existsSync(`${repoRoot}next.config.mjs`), 'tests must run from the repository root');

function readRepo(relativePath: string): string {
  return readFileSync(`${repoRoot}${relativePath}`, 'utf8');
}

describe('preview stack contract', () => {
  it('next.config.mjs allows the proxied preview dev origin', async () => {
    const config = (await import('../../next.config.mjs')).default as NextConfigShape;
    const origins = config.allowedDevOrigins ?? [];
    assert.ok(
      origins.some((origin) => origin === '*.e2b.app' || origin.endsWith('.e2b.app')),
      `allowedDevOrigins must include the sandbox preview host (*.e2b.app); got ${JSON.stringify(origins)}`,
    );
  });

  it('rewrites /api, /uploads and /ws to the backend so same-origin SPA calls survive the single preview port', async () => {
    const config = (await import('../../next.config.mjs')).default as NextConfigShape;
    assert.equal(typeof config.rewrites, 'function', 'rewrites() must stay configured');
    const raw = await config.rewrites!();
    const rules = Array.isArray(raw) ? raw : [...(raw?.before ?? []), ...(raw?.after ?? []), ...(raw?.fallback ?? [])];
    for (const expected of ['/api/:path*', '/uploads/:path*', '/ws/:path*']) {
      const rule = rules.find((entry) => entry.source === expected);
      assert.ok(rule, `rewrite for ${expected} must exist; got ${JSON.stringify(rules.map((r) => r.source))}`);
      assert.ok(
        rule.destination.endsWith(expected),
        `rewrite for ${expected} must forward to the backend path (got ${rule.destination})`,
      );
    }
  });

  it('the web tier does not emit frame-blocking headers (preview embeds the app in an iframe)', async () => {
    const config = (await import('../../next.config.mjs')).default as NextConfigShape;
    const serialized = JSON.stringify(config.headers ?? config).toLowerCase();
    assert.ok(!serialized.includes('x-frame-options'), 'web tier must not set X-Frame-Options');
    assert.ok(!serialized.includes('frame-ancestors'), 'web tier must not set frame-ancestors');
  });

  it('public/app.js parses as valid JavaScript', () => {
    const source = readRepo('public/app.js');
    // Compile without executing: a syntax error in the SPA entry would
    // leave the preview permanently on the boot veil.
    new vm.Script(source, { filename: 'public/app.js' });
  });

  it('the page shell mounts the SPA and references the versioned assets', () => {
    const page = readRepo('src/app/page.tsx');
    const layout = readRepo('src/app/layout.tsx');
    assert.ok(page.includes('id="app-root"'), 'page must expose the SPA mount (#app-root)');
    assert.ok(page.includes('id="boot-veil"'), 'page must keep the boot veil (removed only after SPA boot)');
    assert.ok(page.includes('id="toast-root"'), 'page must keep the toast root (user-visible error surface)');
    const shell = `${page}\n${layout}`;
    for (const asset of ['/app.js', '/styles.css', '/tokens.css']) {
      assert.ok(shell.includes(asset), `page shell must reference ${asset}`);
    }
  });
});
