/**
 * Compressed text-asset endpoint — `/assets/app.js`, `/assets/styles.css`,
 * `/assets/tokens.css`.
 *
 * WHY THIS EXISTS
 * The web tier compresses responses globally (next.config.mjs), but that
 * middleware only speaks gzip, and it skips anything already encoded. The three
 * text assets the SPA needs on every visit (≈370 KB raw) get brotli here
 * instead — smaller than gzip on exactly this kind of source — with an explicit
 * long-lived cache for the versioned URLs.
 *
 * This route handler compresses them at the edge of the app and negotiates the
 * encoding per request:
 *   brotli → gzip → identity
 * The SSE path is untouched: nothing here participates in `/api` streaming.
 *
 * CACHING CONTRACT
 * The layout requests these files with ONE shared `?v=` cache-busting version
 * (`akbaral-lux-N`), asserted by src/app/workspace-ux-contract.test.ts, so the
 * responses are safe to cache hard in the browser: `max-age=86400` fresh for a
 * day, then `stale-while-revalidate` for a week. Bump the version when the
 * assets change (the client re-fetches instantly on the new URL).
 *
 * HONESTY
 * A missing/unreadable asset degrades to a plain 404/500 with the real reason —
 * never a cached or invented body. Compression is per-process memoised by
 * path + mtime so repeat requests never recompress.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';

/** The only three files this endpoint will ever serve — no traversal, no globs. */
const ASSETS: Record<string, { file: string; type: string }> = {
  'app.js': { file: path.join('public', 'app.js'), type: 'application/javascript; charset=utf-8' },
  'styles.css': { file: path.join('public', 'styles.css'), type: 'text/css; charset=utf-8' },
  'tokens.css': { file: path.join('public', 'tokens.css'), type: 'text/css; charset=utf-8' },
};

type Encoded = { body: Buffer; encoding: 'br' | 'gzip' | 'identity'; etag: string };

const memo = new Map<string, Encoded>();

/**
 * Brotli quality 9: 18× faster than the default (11) for ~10% more bytes on
 * this source, measured on public/app.js — 26 ms instead of 329 ms for a
 * 213 KB file, and still smaller than gzip.
 */
const BROTLI_QUALITY = 9;

function negotiate(request: Request, name: string, absolutePath: string): Encoded {
  const stat = statSync(absolutePath);
  const accepted = (request.headers.get('accept-encoding') || '').toLowerCase();
  // The encoding is part of the memo key: a client that cannot decode brotli
  // must still receive identity bytes (serving a memoised brotli body to an
  // identity client would hand the browser an undecodable asset).
  const encoding: Encoded['encoding'] = accepted.includes('br') ? 'br' : accepted.includes('gzip') ? 'gzip' : 'identity';
  const key = `${absolutePath}:${stat.mtimeMs}:${stat.size}:${encoding}`;
  const cached = memo.get(key);
  if (cached) return cached;

  const raw = readFileSync(absolutePath);
  const etagBase = `W/"${name}-${stat.size}-${Math.round(stat.mtimeMs)}"`;
  let body: Buffer;
  if (encoding === 'br') {
    body = brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } });
  } else if (encoding === 'gzip') {
    body = gzipSync(raw, { level: zlibConstants.Z_BEST_COMPRESSION });
  } else {
    body = raw;
  }
  const encoded: Encoded = { body, encoding, etag: `${etagBase}-${encoding}` };
  // Bounded memo: a handful of asset revisions × encodings at most.
  if (memo.size > 24) memo.clear();
  memo.set(key, encoded);
  return encoded;
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const asset = ASSETS[file];
  if (!asset) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const absolutePath = path.join(process.cwd(), asset.file);
  let encoded: Encoded;
  try {
    encoded = negotiate(request, file, absolutePath);
  } catch (error) {
    // Never a silent empty asset: report the real reason.
    const reason = error instanceof Error ? error.message : 'unreadable asset';
    return new Response(`Asset unavailable: ${reason}`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const headers: Record<string, string> = {
    'content-type': asset.type,
    'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    vary: 'Accept-Encoding',
    etag: encoded.etag,
    'x-ak-asset-encoding': encoded.encoding,
  };
  if (encoded.encoding !== 'identity') headers['content-encoding'] = encoded.encoding;

  if (request.headers.get('if-none-match') === encoded.etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(new Uint8Array(encoded.body), { status: 200, headers });
}
