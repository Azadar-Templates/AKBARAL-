import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Browser-payload delivery contract (2026-09-15).
 *
 * The live report was "the main site takes forever to load". Two real causes
 * were found and fixed; this suite locks the fixes so they cannot silently
 * regress:
 *
 *  1. NOTHING was compressed — the 178 KB document and the ≈370 KB of text
 *     assets travelled raw. Compression is now global, and every streaming
 *     route opts out with `Cache-Control: no-transform` (the compressor skips
 *     those), so the realtime channel is never buffered. The SPA's text assets
 *     additionally get brotli from src/app/assets/[file]/route.ts.
 *  2. EVERY asset shipped `Cache-Control: public, max-age=0`, so each
 *     navigation re-downloaded the whole shell despite the shared `?v=` URL.
 *
 * It also locks the third cause of a slow first paint: the render-blocking
 * Google Fonts stylesheet, which now loads with media="print" and is swapped on
 * after hydration by public/app.js (never a pre-hydration mutation).
 *
 * The live behaviour of all of this is exercised end to end by
 * `npm run smoke:shell` (real HTTP through the web tier).
 */

const root = process.cwd();
const nextConfig = readFileSync(join(root, 'next.config.mjs'), 'utf8');
const layout = readFileSync(join(root, 'src', 'app', 'layout.tsx'), 'utf8');
const appJs = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const assetRoute = readFileSync(join(root, 'src', 'app', 'assets', '[file]', 'route.ts'), 'utf8');

describe('browser payload delivery — compressed, cacheable, off the critical path', () => {
  it('compresses text responses globally AND makes every SSE producer opt out of transforms', () => {
    assert.match(nextConfig, /compress:\s*true/, 'global compression is on (it is what shrinks the 178 KB document)');
    assert.match(nextConfig, /no-transform/, 'the opt-out that makes it safe is documented next to the flag');
    // The invariant that makes any of this safe: a response that streams must
    // carry `no-transform`, or the compressor buffers it into one blob.
    const routeDir = join(root, 'src', 'routes');
    const producers = readdirSync(routeDir).filter((file) => file.endsWith('.ts'));
    const streaming = producers.filter((file) => readFileSync(join(routeDir, file), 'utf8').includes("'text/event-stream'"));
    assert.ok(streaming.length >= 1, `at least one streaming route exists (${streaming.join(', ')})`);
    for (const file of streaming) {
      const source = readFileSync(join(routeDir, file), 'utf8');
      assert.match(source, /Cache-Control'?\s*[:,]\s*'[^']*no-transform/, `${file} must mark its stream no-transform (otherwise compression buffers it)`);
    }
  });

  it('compresses the SPA text assets through a dedicated endpoint, never through /api', () => {
    assert.match(assetRoute, /brotliCompressSync|brotliCompress/, 'brotli is offered first');
    assert.match(assetRoute, /gzipSync|gzip/, 'gzip is offered as the fallback');
    assert.match(assetRoute, /content-encoding/, 'the negotiated encoding is declared on the response');
    assert.match(assetRoute, /vary:\s*'Accept-Encoding'/i, 'the response varies by accept-encoding');
    assert.match(assetRoute, /max-age=86400/, 'compressed assets are cached for a day');
    assert.match(assetRoute, /stale-while-revalidate/, 'and keep serving while revalidating');
    // An allow-list, not a path join: no traversal, no serving arbitrary files.
    assert.match(assetRoute, /const ASSETS: Record<string, \{ file: string; type: string \}> = \{/, 'the endpoint serves a fixed allow-list of files');
    for (const file of ['app.js', 'styles.css', 'tokens.css']) {
      assert.ok(assetRoute.includes(`'${file}'`), `${file} is on the allow-list`);
    }
    assert.ok(!/rewrites[\s\S]{0,400}assets/.test(nextConfig), 'the asset endpoint is not routed through the API rewrite');
  });

  it('serves those assets from the compressed endpoint with one shared cache-busting version', () => {
    const references = [...layout.matchAll(/\/(?:assets\/)?(?:tokens\.css|styles\.css|app\.js)\?v=([\w.-]+)/g)].map((m) => m[0]);
    assert.ok(references.length >= 3, `all three assets are referenced (${references.join(', ')})`);
    assert.ok(references.every((ref) => ref.startsWith('/assets/')), 'every asset goes through the compressed endpoint');
    const versions = new Set(references.map((ref) => ref.split('?v=')[1]));
    assert.equal(versions.size, 1, `one shared version across the shell (${[...versions].join(', ')})`);
  });

  it('the app documents revalidate instead of being cached: a stale shell is a stale product', () => {
    // These two documents decide which screen exists at all, so they must not
    // be held by browsers or shared caches. An earlier revision sent
    // `s-maxage=31536000` here, which let any intermediary pin the old shell
    // for a year — the app could be updated and the browser would still show
    // the previous UI. They now revalidate (ETag -> 304) on every entry.
    // Slice headers() into one segment per `source:` rule (comments and length
    // between the rule and its Cache-Control line vary), then read the value.
    const headerBlock = nextConfig.slice(nextConfig.indexOf('async headers()'), nextConfig.indexOf('export default'));
    const starts = [...headerBlock.matchAll(/source:\s*'([^']+)'/g)].map((m) => ({ source: m[1], at: m.index }));
    const ruleFor = (source: string): string => {
      const index = starts.findIndex((entry) => entry.source === source);
      if (index === -1) return '';
      return headerBlock.slice(starts[index].at, starts[index + 1]?.at ?? headerBlock.length);
    };
    for (const source of ['/', '/workspace']) {
      const rule = ruleFor(source);
      assert.ok(rule, `the ${source} document has an explicit Cache-Control rule`);
      const match = rule.match(/Cache-Control',\s*value:\s*'([^']+)'/);
      assert.ok(match, `the ${source} rule sets Cache-Control (${rule.trim().slice(0, 90)})`);
      const value = match[1];
      assert.match(value, /no-cache/, `${source} revalidates`);
      assert.ok(!/s-maxage/.test(value), `${source} must not invite shared caches to pin it (${value})`);
      assert.ok(!/max-age=[1-9]/.test(value), `${source} must not be served stale from a browser cache (${value})`);
    }
    assert.match(nextConfig, /stale-while-revalidate/, 'the heavy, versioned assets still serve stale while revalidating');
    assert.match(nextConfig, /source:\s*'\/media\/:path\*'[\s\S]{0,200}?max-age=604800/, 'static media is cached for a week');
    const headersBlock = nextConfig.slice(nextConfig.indexOf('async headers()'), nextConfig.indexOf('export default'));
    assert.ok(headersBlock.length > 0, 'the headers() block is present');
    assert.ok(!/source:\s*'\/api/.test(headersBlock), 'no caching rules are added to the realtime API');
  });

  it('moves the webfont request off the render-blocking path and swaps it in after hydration', () => {
    assert.match(layout, /id="ak-fonts"/, 'the font sheet is addressable');
    assert.match(layout, /media="print"/, 'it is requested without blocking first paint');
    assert.match(layout, /fonts\.googleapis\.com/, 'the real Google Fonts sheet is still used (no fake local font)');
    assert.match(appJs, /getElementById\('ak-fonts'\)/, 'the client swaps the sheet');
    assert.match(appJs, /setAttribute\('media',\s*'all'\)/, 'the swap applies the webfonts');
    // The codebase rule: no DOM writes before hydration.
    assert.ok(!/<script[^>]*>[^<]*ak-fonts/.test(layout), 'the swap is not an inline pre-hydration script');
  });

  it('reports an unreadable asset honestly instead of shipping an empty body', () => {
    assert.match(assetRoute, /status:\s*500/, 'a read failure is a real 500');
    assert.match(assetRoute, /cache-control':\s*'no-store'/, 'and it is never cached');
    assert.match(assetRoute, /status:\s*404/, 'unknown files are a real 404');
    assert.match(assetRoute, /if-none-match/i, 'revalidation is answered with a 304, not a re-download');
  });
});
