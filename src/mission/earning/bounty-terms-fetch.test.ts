import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOUNTY_TERMS_MAX_BYTES,
  BOUNTY_TERMS_MAX_REDIRECTS,
  BOUNTY_TERMS_PREVIEW_CHARS,
  BOUNTY_TERMS_TIMEOUT_MS,
  fetchBountyTerms,
  isPublicIpAddress,
  defaultResolveHost,
  type BountyTermsResult,
} from './bounty-terms-fetch';

/**
 * ZA141251SA — scope terms fetch protections.
 *
 * No test here touches the network: the fetch implementation and the resolver
 * are injected. Every refusal case additionally asserts that the fetch was never
 * even attempted (or was attempted exactly once for the fetch-visible failures)
 * and that no hash came back with the refusal.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_HTML = '<!doctype html><html><head><title>Fixture scope</title></head><body><h1>Scope</h1><p>*.fixture.example is in scope. Do not test third parties.</p></body></html>';
/** SHA-256 of the exact UTF-8 bytes of FIXTURE_HTML (160 bytes). */
const FIXTURE_SHA = '612e48fd81e27d1edac3217d75f9535c0c51b62d5356c8f97d54ca29e5dfcf90';
const SCOPE_URL = 'https://scope.test/security/scope';
const PUBLIC_IP = '93.184.216.34';
const PUBLIC_IPV6 = '2606:4700:4700::1111';

const publicResolve = async (): Promise<string[]> => [PUBLIC_IP];

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof (input as Request).url === 'string') return (input as Request).url;
  return String(input);
}

/** One recorded call. */
interface Call { url: string; init?: RequestInit }

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    calls.push({ url, init });
    return await handler(url, init);
  }) as typeof fetch;
}

function html(body: string, init: { status?: number; contentType?: string; url?: string } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'text/html; charset=utf-8' },
  });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location, 'content-type': 'text/html' } });
}

const neverResponds: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
  const signal = init?.signal;
  if (!signal) {
    reject(new Error('the fetch was called without an abort signal'));
    return;
  }
  const abort = (): void => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  if (signal.aborted) {
    abort();
    return;
  }
  signal.addEventListener('abort', abort, { once: true });
});

/** Refusals must never carry a hash, a length or a preview. */
function assertRefused(result: BountyTermsResult, reason: string): void {
  assert.equal(result.ok, false, `expected a refusal (${reason})`);
  if (result.ok) return;
  assert.equal(result.reason, reason);
  assert.ok(result.message.length > 0, 'a refusal has an honest message');
  assert.ok(!('sha256' in result), 'a refusal never carries a hash');
  assert.ok(!('contentPreview' in result), 'a refusal never carries a preview');
}

// ── Defaults ─────────────────────────────────────────────────────────────────

test('the documented limits are the ones enforced', () => {
  assert.equal(BOUNTY_TERMS_TIMEOUT_MS, 10_000);
  assert.equal(BOUNTY_TERMS_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(BOUNTY_TERMS_MAX_REDIRECTS, 3);
  assert.equal(BOUNTY_TERMS_PREVIEW_CHARS, 500);
});

// ── Happy path ───────────────────────────────────────────────────────────────

test('a public https scope page is hashed byte-for-byte', async () => {
  const calls: Call[] = [];
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls),
    resolveHost: publicResolve,
    now: () => 1_700_000_000_000,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sha256, FIXTURE_SHA, 'the digest is the SHA-256 of the served bytes');
  assert.match(result.sha256, /^[a-f0-9]{64}$/, 'the digest satisfies programTermsHash validation');
  assert.equal(result.byteLength, Buffer.byteLength(FIXTURE_HTML, 'utf8'));
  assert.equal(result.fetchedAtMs, 1_700_000_000_000);
  assert.equal(result.contentPreview, FIXTURE_HTML);
  assert.equal(result.scopeUrl, SCOPE_URL);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SCOPE_URL);
  assert.equal(calls[0].init?.redirect, 'manual', 'redirects are never followed by the runtime handler');
});

test('the preview is capped at 500 characters of text', async () => {
  const long = `<html><body>${'x'.repeat(900)}</body></html>`;
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => html(long), []),
    resolveHost: publicResolve,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.contentPreview.length, 500);
  assert.equal(result.contentPreview, long.slice(0, 500));
});

test('an explicitly stated default port (:443) is accepted', async () => {
  const result = await fetchBountyTerms('https://scope.test:443/security/scope', {
    fetchImpl: stubFetch(() => html(FIXTURE_HTML), []),
    resolveHost: publicResolve,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sha256, FIXTURE_SHA);
});

test('a same-origin redirect within the hop limit is followed and hashed', async () => {
  const calls: Call[] = [];
  const finalUrl = 'https://scope.test/security/scope-final';
  const fetchImpl = stubFetch((url) => (url === SCOPE_URL ? redirect('/security/scope-final') : html(FIXTURE_HTML)), calls);
  const result = await fetchBountyTerms(SCOPE_URL, { fetchImpl, resolveHost: publicResolve });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sha256, FIXTURE_SHA);
  assert.equal(result.scopeUrl, finalUrl, 'the reported URL is the one the digest came from');
  assert.deepEqual(calls.map((call) => call.url), [SCOPE_URL, finalUrl]);
});

test('three same-origin redirects are still followed; the fourth is refused', async () => {
  const hops = ['https://scope.test/a', 'https://scope.test/b', 'https://scope.test/c'];
  const calls: Call[] = [];
  const threeThenHtml = stubFetch((url) => {
    if (url === SCOPE_URL) return redirect('/a');
    const index = hops.indexOf(url);
    if (index >= 0 && index < hops.length - 1) return redirect(`/${['a', 'b', 'c'][index + 1]}`);
    return html(FIXTURE_HTML);
  }, calls);
  const allowed = await fetchBountyTerms(SCOPE_URL, { fetchImpl: threeThenHtml, resolveHost: publicResolve });
  assert.equal(allowed.ok, true, 'three hops is the documented maximum and is allowed');
  assert.equal(calls.length, 4);

  const fourRedirects = stubFetch((url) => {
    if (url === SCOPE_URL) return redirect('https://scope.test/1');
    const depth = Number(new URL(url).pathname.slice(1));
    return depth >= 4 ? html(FIXTURE_HTML) : redirect(`https://scope.test/${depth + 1}`);
  }, []);
  assertRefused(await fetchBountyTerms(SCOPE_URL, { fetchImpl: fourRedirects, resolveHost: publicResolve }), 'too_many_redirects');
});

test('a redirect loop is refused as too_many_redirects', async () => {
  const calls: Call[] = [];
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => redirect('https://scope.test/security/scope'), calls),
    resolveHost: publicResolve,
  });
  assertRefused(result, 'too_many_redirects');
  assert.equal(calls.length, 4, 'the loop stops at the hop limit');
});

// ── URL shape ────────────────────────────────────────────────────────────────

test('only https scope pages are eligible', async () => {
  for (const url of ['http://scope.test/scope', 'http://scope.test:443/scope', 'ftp://scope.test/scope', 'file:///etc/passwd', 'javascript:alert(1)']) {
    const calls: Call[] = [];
    const result = await fetchBountyTerms(url, { fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls), resolveHost: publicResolve });
    assertRefused(result, 'unsupported_scheme');
    assert.equal(calls.length, 0, `${url} is never requested`);
  }
});

test('a non-default port is refused without any request', async () => {
  const calls: Call[] = [];
  const result = await fetchBountyTerms('https://scope.test:8443/scope', {
    fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls),
    resolveHost: publicResolve,
  });
  assertRefused(result, 'unsupported_port');
  assert.equal(calls.length, 0);
});

test('credentials embedded in the URL are refused without any request', async () => {
  for (const url of ['https://user:pass@scope.test/scope', 'https://user@scope.test/scope']) {
    const calls: Call[] = [];
    const result = await fetchBountyTerms(url, { fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls), resolveHost: publicResolve });
    assertRefused(result, 'url_credentials');
    assert.equal(calls.length, 0);
  }
});

test('a relative or unparseable scopeUrl is refused as invalid_url', async () => {
  for (const url of ['', '   ', 'scope.test/scope', 'not a url']) {
    const calls: Call[] = [];
    const result = await fetchBountyTerms(url, { fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls), resolveHost: publicResolve });
    assertRefused(result, 'invalid_url');
    assert.equal(calls.length, 0);
  }
});

// ── Address classification ───────────────────────────────────────────────────

test('private, loopback, link-local and reserved addresses are not public', () => {
  const blocked = [
    '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.4.4', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '100.64.1.1', '224.0.0.1', '255.255.255.255',
    '[::1]', '::1', '::', 'fe80::1', 'fd00::1', 'fcff::1', 'ff02::1', '2001:db8::1',
    '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:192.168.0.1', '[::ffff:169.254.169.254]',
    '::127.0.0.1', '64:ff9b::a00:1',
    'not-an-ip', '',
  ];
  for (const address of blocked) {
    assert.equal(isPublicIpAddress(address), false, `${address} must not be treated as public`);
  }
});

test('real public addresses are public (guards against the IPv4-mapped BlockList trap)', () => {
  // A BlockList rule of ::ffff:0:0/96 — the naive way to block IPv4-mapped IPv6 —
  // also matches every IPv4 address. These must stay allowed.
  for (const address of [PUBLIC_IP, '8.8.8.8', '1.1.1.1', '172.32.0.1', PUBLIC_IPV6]) {
    assert.equal(isPublicIpAddress(address), true, `${address} is a public address`);
  }
});

test('literal private addresses are refused before any request', async () => {
  const literals = [
    ['https://127.0.0.1/scope', '127.0.0.1'],
    ['https://10.0.0.5/scope', '10.0.0.5'],
    ['https://172.16.4.4/scope', '172.16.4.4'],
    ['https://192.168.1.1/scope', '192.168.1.1'],
    ['https://169.254.169.254/latest/meta-data', '169.254.169.254'],
  ];
  for (const [url, expected] of literals) {
    const calls: Call[] = [];
    const result = await fetchBountyTerms(url, {
      fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls),
      resolveHost: async (hostname) => [hostname],
    });
    assertRefused(result, 'blocked_address');
    assert.equal(calls.length, 0, `${expected} is never dialled`);
    if (!result.ok) assert.ok(!result.message.includes(expected), 'the refusal never echoes an internal address');
  }
});

test('a literal address is classified directly, even if the resolver claims otherwise', async () => {
  const calls: Call[] = [];
  const result = await fetchBountyTerms('https://127.0.0.1/scope', {
    fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls),
    resolveHost: async () => [PUBLIC_IP], // a lying resolver must not unlock loopback
  });
  assertRefused(result, 'blocked_address');
  assert.equal(calls.length, 0);
});

test('an IPv6 loopback literal with brackets is refused (brackets are stripped before the check)', async () => {
  const calls: Call[] = [];
  // No resolveHost injection: the default resolver passes IP literals through
  // without touching DNS, which also proves the bracketed form is handled.
  const result = await fetchBountyTerms('https://[::1]/scope', { fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls) });
  assertRefused(result, 'blocked_address');
  assert.equal(calls.length, 0);
  assert.deepEqual(await defaultResolveHost('[::1]'), ['::1']);
});

test('an IPv4-mapped private literal is refused', async () => {
  for (const url of ['https://[::ffff:10.0.0.1]/scope', 'https://[::ffff:192.168.0.1]/scope', 'https://[::ffff:127.0.0.1]/scope']) {
    const calls: Call[] = [];
    const result = await fetchBountyTerms(url, { fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls) });
    assertRefused(result, 'blocked_address');
    assert.equal(calls.length, 0);
  }
});

test('a public IPv4 literal is fetched (not blocked by an over-broad rule)', async () => {
  const calls: Call[] = [];
  const result = await fetchBountyTerms(`https://${PUBLIC_IP}/scope`, {
    fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls),
    resolveHost: async (hostname) => [hostname],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sha256, FIXTURE_SHA);
  assert.equal(calls.length, 1);
});

test('every resolved address must be public', async () => {
  const calls: Call[] = [];
  const mixed = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls),
    resolveHost: async () => [PUBLIC_IP, '10.0.0.5'],
  });
  assertRefused(mixed, 'blocked_address');
  assert.equal(calls.length, 0, 'a host with any internal address is never dialled');

  const internalOnly = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => html(FIXTURE_HTML), []),
    resolveHost: async () => ['fd00::5'],
  });
  assertRefused(internalOnly, 'blocked_address');
});

test('a host that cannot be resolved fails closed', async () => {
  const calls: Call[] = [];
  const failure = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => html(FIXTURE_HTML), calls),
    resolveHost: async () => { throw new Error('ENOTFOUND'); },
  });
  assertRefused(failure, 'unresolvable_host');
  assert.equal(calls.length, 0);

  const empty = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => html(FIXTURE_HTML), []),
    resolveHost: async () => [],
  });
  assertRefused(empty, 'unresolvable_host');
});

test('a host that re-resolves to an internal address on a later hop is refused', async () => {
  // DNS rebinding: public on the first lookup, internal on the redirect hop.
  const answers = [PUBLIC_IP, '127.0.0.1'];
  const calls: Call[] = [];
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch((url) => (url === SCOPE_URL ? redirect('https://scope.test/next') : html(FIXTURE_HTML)), calls),
    resolveHost: async () => [answers.shift() ?? '127.0.0.1'],
  });
  assertRefused(result, 'blocked_address');
  assert.equal(calls.length, 1, 'the rebound hop is never requested');
});

// ── Redirect target ──────────────────────────────────────────────────────────

test('a cross-origin redirect is refused and never followed', async () => {
  const calls: Call[] = [];
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => redirect('https://elsewhere.test/scope'), calls),
    resolveHost: publicResolve,
  });
  assertRefused(result, 'redirect_cross_origin');
  assert.equal(calls.length, 1, 'the other origin is never requested');
});

test('a redirect to another scheme is refused as cross-origin', async () => {
  const calls: Call[] = [];
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => redirect('http://scope.test/scope'), calls),
    resolveHost: publicResolve,
  });
  assertRefused(result, 'redirect_cross_origin');
  assert.equal(calls.length, 1);
});

// ── Response handling ────────────────────────────────────────────────────────

test('a non-2xx scope page is refused', async () => {
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => html('<html>missing</html>', { status: 404 }), []),
    resolveHost: publicResolve,
  });
  assertRefused(result, 'non_2xx');
});

test('a redirect without a Location header is refused', async () => {
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => new Response(null, { status: 302 }), []),
    resolveHost: publicResolve,
  });
  assertRefused(result, 'non_2xx');
});

test('only text/html is accepted', async () => {
  for (const contentType of ['application/json', 'text/plain; charset=utf-8', 'application/xhtml+xml', '', 'application/octet-stream']) {
    const result = await fetchBountyTerms(SCOPE_URL, {
      fetchImpl: stubFetch(() => new Response(FIXTURE_HTML, { status: 200, headers: { 'content-type': contentType } }), []),
      resolveHost: publicResolve,
    });
    assertRefused(result, 'unsupported_content_type');
  }
});

test('a body over the cap is refused mid-read and never buffered', async () => {
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(1024 * 1024).fill(0x41)); // 1 MB per pull
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }), []),
    resolveHost: publicResolve,
  });
  assertRefused(result, 'too_large');
  assert.equal(cancelled, true, 'the body stream is cancelled rather than drained');
  assert.ok(pulls <= 4, `reading stopped as soon as the 2 MB cap was passed (pulled ${pulls} MB)`);
});

test('a declared oversize Content-Length is refused before reading the body', async () => {
  // A small real body behind an oversize declared length: if the header were not
  // checked first, the body would be hashed and this would succeed.
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: stubFetch(() => new Response(FIXTURE_HTML, {
      status: 200,
      headers: { 'content-type': 'text/html', 'content-length': String(BOUNTY_TERMS_MAX_BYTES + 1) },
    }), []),
    resolveHost: publicResolve,
  });
  assertRefused(result, 'too_large');
});

test('a scope page that never answers times out and returns no hash', async () => {
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: neverResponds,
    resolveHost: publicResolve,
    timeoutMs: 25,
  });
  assertRefused(result, 'timeout');
});

test('a transport failure is refused as network_error', async () => {
  const result = await fetchBountyTerms(SCOPE_URL, {
    fetchImpl: (async () => { throw new Error('ECONNRESET'); }) as typeof fetch,
    resolveHost: publicResolve,
  });
  assertRefused(result, 'network_error');
});

test('every refusal path is fail-closed: no hash, no preview, no length', async () => {
  const cases: Array<[string, string, typeof fetch]> = [
    ['unsupported_scheme', 'http://scope.test/scope', stubFetch(() => html(FIXTURE_HTML), [])],
    ['unsupported_port', 'https://scope.test:8443/scope', stubFetch(() => html(FIXTURE_HTML), [])],
    ['url_credentials', 'https://u:p@scope.test/scope', stubFetch(() => html(FIXTURE_HTML), [])],
    ['blocked_address', 'https://10.0.0.5/scope', stubFetch(() => html(FIXTURE_HTML), [])],
    ['redirect_cross_origin', SCOPE_URL, stubFetch(() => redirect('https://elsewhere.test/x'), [])],
    ['too_many_redirects', SCOPE_URL, stubFetch(() => redirect('https://scope.test/loop'), [])],
    ['non_2xx', SCOPE_URL, stubFetch(() => html('nope', { status: 500 }), [])],
    ['unsupported_content_type', SCOPE_URL, stubFetch(() => html('{}', { contentType: 'application/json' }), [])],
    ['timeout', SCOPE_URL, neverResponds],
    ['network_error', SCOPE_URL, (async () => { throw new Error('boom'); }) as typeof fetch],
  ];
  for (const [reason, url, fetchImpl] of cases) {
    const result = await fetchBountyTerms(url, {
      fetchImpl,
      resolveHost: async (hostname) => (hostname.includes('10.0.0.5') ? ['10.0.0.5'] : [PUBLIC_IP]),
      timeoutMs: 25,
    });
    assertRefused(result, reason);
  }
});
