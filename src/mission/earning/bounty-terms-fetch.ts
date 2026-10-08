import { createHash } from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';

/**
 * ZA141251SA — owner-only scope terms fetch (server side).
 *
 * The bounty registration form needs `programTermsHash`: exactly 64 hex
 * characters, the SHA-256 of the program's own public scope page
 * (`bug-bounty-system.ts` refuses anything else). Rather than asking the owner
 * to run `sha256sum` in a terminal, the mission server fetches that page and
 * returns the digest.
 *
 * That makes this module the only place where the mission dereferences a URL a
 * human typed, so it fails closed on every axis:
 *
 *   · `https:` only, default port only, no credentials in the URL;
 *   · every resolved address must be public — loopback, private, link-local,
 *     unique-local, multicast/reserved and the IPv4-mapped / IPv4-compatible /
 *     NAT64 / 6to4 wrappers around them are all refused, and the check runs
 *     again on every redirect hop (so a hostname cannot flip to an internal
 *     address between the first request and the next);
 *   · redirects are followed manually, same-origin only, at most three hops;
 *   · one 10s abort budget for the whole chain, a 2 MB streaming cap, HTML only;
 *   · a refusal carries no hash, no byte length and no preview.
 *
 * TWO DELIBERATE IMPLEMENTATION NOTES
 *
 * 1. `net.BlockList` is NOT used. Node stores IPv4 rules as IPv4-mapped IPv6
 *    internally, so a rule like `::ffff:0:0/96` — the obvious way to express
 *    "block IPv4-mapped addresses" — matches EVERY IPv4 address and would block
 *    the entire public internet. Addresses are parsed into bytes here instead,
 *    and IPv4-mapped forms are unwrapped to their IPv4 part before checking.
 * 2. `URL.hostname` keeps the brackets on IPv6 literals (`[::1]`), so brackets
 *    are stripped before any address parse or check.
 *
 * No network call happens in this module's tests: `fetchImpl` and `resolveHost`
 * are injectable, and production uses the defaults on `bountyTermsFetchDeps`.
 */

export type BountyTermsRefusalReason =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'unsupported_port'
  | 'url_credentials'
  | 'unresolvable_host'
  | 'blocked_address'
  | 'redirect_cross_origin'
  | 'too_many_redirects'
  | 'timeout'
  | 'too_large'
  | 'unsupported_content_type'
  | 'non_2xx'
  | 'network_error';

export interface BountyTermsSuccess {
  ok: true;
  /** The URL the digest was taken from — the final same-origin URL after any redirects. */
  scopeUrl: string;
  /** Lowercase hex SHA-256 of the response bytes — exactly what `programTermsHash` requires. */
  sha256: string;
  byteLength: number;
  fetchedAtMs: number;
  /** The first 500 characters of the fetched HTML, decoded as UTF-8. */
  contentPreview: string;
}

export interface BountyTermsRefusal {
  ok: false;
  reason: BountyTermsRefusalReason;
  /** Owner-readable and honest. Never contains an internal address. */
  message: string;
}

export type BountyTermsResult = BountyTermsSuccess | BountyTermsRefusal;

export interface BountyTermsFetchOptions {
  /** Injected for tests; production uses the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; production resolves through `node:dns`. */
  resolveHost?: (hostname: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  now?: () => number;
}

export interface BountyTermsDeps {
  fetchImpl: typeof fetch;
  resolveHost: (hostname: string) => Promise<string[]>;
}

/** Abort budget for the whole chain (all hops and the body read together). */
export const BOUNTY_TERMS_TIMEOUT_MS = 10_000;
/** Response size cap, enforced while streaming — never buffered unbounded. */
export const BOUNTY_TERMS_MAX_BYTES = 2 * 1024 * 1024;
/** Same-origin redirect limit. */
export const BOUNTY_TERMS_MAX_REDIRECTS = 3;
/** Preview length returned to the dashboard form. */
export const BOUNTY_TERMS_PREVIEW_CHARS = 500;

// ── Address classification ───────────────────────────────────────────────────
// Everything is parsed to bytes and matched against explicit prefixes. See note
// (1) above for why `net.BlockList` cannot be used for this.

const IPV4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],        // "this network"
  ['10.0.0.0', 8],       // private
  ['100.64.0.0', 10],    // carrier-grade NAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local (cloud metadata lives here)
  ['172.16.0.0', 12],    // private
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // documentation (TEST-NET-1)
  ['192.168.0.0', 16],   // private
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // documentation (TEST-NET-2)
  ['203.0.113.0', 24],   // documentation (TEST-NET-3)
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved, includes 255.255.255.255
];

const IPV6_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],           // unspecified
  ['::1', 128],          // loopback
  ['fc00::', 7],         // unique local
  ['fe80::', 10],        // link-local
  ['ff00::', 8],         // multicast
  ['2001:db8::', 32],    // documentation
];

/** Strip the brackets `URL.hostname` keeps on IPv6 literals (`[::1]` → `::1`). */
export function stripIpBrackets(hostname: string): string {
  const trimmed = hostname.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed;
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

function parseIpv6(value: string): number[] | null {
  let text = stripIpBrackets(value);
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (!text) return null;
  // An embedded dotted-quad (`::ffff:10.0.0.1`) becomes two hextets.
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    if (lastColon < 0) return null;
    const embedded = parseIpv4(text.slice(lastColon + 1));
    if (!embedded) return null;
    const high = ((embedded[0] << 8) | embedded[1]).toString(16);
    const low = ((embedded[2] << 8) | embedded[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const compressed = text.indexOf('::');
  if (compressed >= 0 && text.indexOf('::', compressed + 1) >= 0) return null; // at most one '::'
  const head = compressed >= 0 ? text.slice(0, compressed) : text;
  const tail = compressed >= 0 ? text.slice(compressed + 2) : '';
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const groups = [...headGroups, ...tailGroups];
  if (groups.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) return null;
  if (compressed >= 0) {
    if (groups.length > 7) return null; // '::' must stand for at least one zero group
  } else if (groups.length !== 8) {
    return null;
  }
  const expanded = compressed >= 0
    ? [...headGroups, ...Array(8 - groups.length).fill('0'), ...tailGroups]
    : headGroups;
  const bytes: number[] = [];
  for (const group of expanded) {
    const hextet = parseInt(group, 16);
    bytes.push((hextet >> 8) & 0xff, hextet & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function inCidr(bytes: number[], network: number[], prefix: number): boolean {
  const wholeBytes = Math.floor(prefix / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== network[index]) return false;
  }
  const remainder = prefix % 8;
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (bytes[wholeBytes] & mask) === (network[wholeBytes] & mask);
}

const IPV4_BLOCKED_CIDRS = IPV4_BLOCKED.map(([network, prefix]) => ({ bytes: parseIpv4(network)!, prefix }));
const IPV6_BLOCKED_CIDRS = IPV6_BLOCKED.map(([network, prefix]) => ({ bytes: parseIpv6(network)!, prefix }));

function ipv4IsPublic(bytes: number[]): boolean {
  return !IPV4_BLOCKED_CIDRS.some((cidr) => inCidr(bytes, cidr.bytes, cidr.prefix));
}

function ipv6IsPublic(bytes: number[]): boolean {
  const zeroLead = bytes.slice(0, 10).every((byte) => byte === 0);
  const mapped = zeroLead && bytes[10] === 0xff && bytes[11] === 0xff; // ::ffff:a.b.c.d
  const compatible = zeroLead && bytes[10] === 0 && bytes[11] === 0; // ::a.b.c.d (deprecated)
  if (mapped || compatible) {
    const embedded = bytes.slice(12);
    // `::` itself (all zero) stays blocked through the IPv4 0.0.0.0/8 rule.
    if (mapped || embedded.some((byte) => byte !== 0)) return ipv4IsPublic(embedded);
  }
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b
    && bytes.slice(4, 12).every((byte) => byte === 0)) {
    return ipv4IsPublic(bytes.slice(12));
  }
  // 6to4 2002::/16 embeds an IPv4 address in the following 32 bits.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return ipv4IsPublic(bytes.slice(2, 6));
  return !IPV6_BLOCKED_CIDRS.some((cidr) => inCidr(bytes, cidr.bytes, cidr.prefix));
}

/**
 * Is this literal address routable on the public internet? Anything that is not
 * an address at all is `false`, so a caller can never treat a parse failure as
 * permission.
 */
export function isPublicIpAddress(address: string): boolean {
  const bare = stripIpBrackets(address);
  const family = net.isIP(bare);
  if (family === 4) {
    const bytes = parseIpv4(bare);
    return bytes ? ipv4IsPublic(bytes) : false;
  }
  if (family === 6) {
    const bytes = parseIpv6(bare);
    return bytes ? ipv6IsPublic(bytes) : false;
  }
  return false;
}

/** Resolve a hostname through DNS, or pass a literal through unchanged. */
export async function defaultResolveHost(hostname: string): Promise<string[]> {
  const bare = stripIpBrackets(hostname);
  if (!bare) throw new Error('empty hostname');
  if (net.isIP(bare)) return [bare];
  const records = await dns.promises.lookup(bare, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/**
 * Injection seam. Production always uses these defaults; tests replace them so
 * no test ever reaches the network.
 */
export const bountyTermsFetchDeps: BountyTermsDeps = {
  fetchImpl: (input, init) => globalThis.fetch(input, init),
  resolveHost: defaultResolveHost,
};

// ── Guard + fetch ────────────────────────────────────────────────────────────

function refusal(reason: BountyTermsRefusalReason, message: string): BountyTermsRefusal {
  return { ok: false, reason, message };
}

function formatLimit(maxBytes: number): string {
  if (maxBytes >= 1024 * 1024) return `${Math.round(maxBytes / (1024 * 1024))} MB`;
  return `${maxBytes} bytes`;
}

/**
 * Scheme, port, credentials and every resolved address — checked once per hop.
 * Returns a refusal, or `null` when the URL is safe to dereference.
 */
async function guardTarget(
  target: URL,
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<BountyTermsRefusal | null> {
  if (target.protocol !== 'https:') {
    return refusal('unsupported_scheme', 'the scope page must be an https:// URL');
  }
  if (target.username || target.password) {
    return refusal('url_credentials', 'a scope URL must not embed credentials');
  }
  // WHATWG normalisation drops `:443` for https, so any remaining port is a
  // non-default one (and `http://host:443` never gets here — scheme first).
  if (target.port !== '') {
    return refusal('unsupported_port', 'the scope page must use the default https port');
  }
  if (!target.hostname) return refusal('invalid_url', 'the scope URL must name a host');

  let addresses: string[];
  const literal = stripIpBrackets(target.hostname);
  if (net.isIP(literal)) {
    // A literal address is classified directly and never delegated to DNS, so
    // no resolver (real, injected or compromised) can vouch for `127.0.0.1`.
    addresses = [literal];
  } else {
    try {
      addresses = await resolveHost(target.hostname);
    } catch {
      return refusal('unresolvable_host', 'the scope page host could not be resolved');
    }
  }
  if (!addresses.length) return refusal('unresolvable_host', 'the scope page host could not be resolved');
  for (const address of addresses) {
    if (!isPublicIpAddress(address)) {
      // Deliberately no address in the message.
      return refusal('blocked_address', 'the scope page host resolves to a non-public address; refusing to fetch it');
    }
  }
  return null;
}

/**
 * Fetch a bounty program's public scope page and hash exactly the bytes that
 * were served. Fail closed: every refusal path returns before a hash exists, and
 * the return type makes "refusal plus hash" impossible to express.
 */
export async function fetchBountyTerms(
  scopeUrl: string,
  options: BountyTermsFetchOptions = {},
): Promise<BountyTermsResult> {
  const fetchImpl = options.fetchImpl ?? bountyTermsFetchDeps.fetchImpl;
  const resolveHost = options.resolveHost ?? bountyTermsFetchDeps.resolveHost;
  const timeoutMs = options.timeoutMs ?? BOUNTY_TERMS_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? BOUNTY_TERMS_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? BOUNTY_TERMS_MAX_REDIRECTS;
  const now = options.now ?? Date.now;

  const raw = typeof scopeUrl === 'string' ? scopeUrl.trim() : '';
  if (!raw) return refusal('invalid_url', 'scopeUrl is required');
  let current: URL;
  try {
    current = new URL(raw);
  } catch {
    return refusal('invalid_url', 'scopeUrl must be an absolute URL');
  }
  // The scheme check deliberately happens inside `guardTarget` (first), so
  // `file:///…`, `javascript:…` and friends are reported as unsupported schemes
  // rather than parsed as host-less URLs.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const guarded = await guardTarget(current, resolveHost);
      if (guarded) return guarded;

      let response: Response;
      try {
        response = await fetchImpl(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' },
        });
      } catch {
        if (controller.signal.aborted) {
          return refusal('timeout', `the scope page did not respond within ${Math.round(timeoutMs / 1000)}s`);
        }
        return refusal('network_error', 'the scope page could not be reached');
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return refusal('non_2xx', `the scope page redirected without a Location header (status ${response.status})`);
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return refusal('redirect_cross_origin', 'the scope page redirected to an invalid URL');
        }
        if (next.origin !== current.origin) {
          return refusal('redirect_cross_origin', 'the scope page redirected to a different origin; refusing to follow it');
        }
        if (hop === maxRedirects) {
          return refusal('too_many_redirects', `the scope page redirected more than ${maxRedirects} times`);
        }
        current = next;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        return refusal('non_2xx', `the scope page responded ${response.status}`);
      }

      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (contentType !== 'text/html') {
        return refusal('unsupported_content_type', `the scope page is ${contentType || 'of an unknown content type'}, not HTML`);
      }

      const declared = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(declared) && declared > maxBytes) {
        return refusal('too_large', `the scope page is larger than the ${formatLimit(maxBytes)} limit`);
      }

      const body = response.body;
      if (!body) return refusal('network_error', 'the scope page returned no body');

      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          total += value.byteLength;
          if (total > maxBytes) {
            // Stop mid-stream: the oversized body is never buffered.
            await reader.cancel().catch(() => undefined);
            return refusal('too_large', `the scope page is larger than the ${formatLimit(maxBytes)} limit`);
          }
          chunks.push(value);
        }
      } catch {
        if (controller.signal.aborted) {
          return refusal('timeout', 'the scope page did not finish responding in time');
        }
        return refusal('network_error', 'the scope page could not be read');
      }

      const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      return {
        ok: true,
        scopeUrl: current.toString(),
        sha256: createHash('sha256').update(buffer).digest('hex'),
        byteLength: buffer.byteLength,
        fetchedAtMs: now(),
        contentPreview: buffer.toString('utf8').slice(0, BOUNTY_TERMS_PREVIEW_CHARS),
      };
    }
    // Unreachable in practice: the loop returns on its final hop.
    return refusal('too_many_redirects', `the scope page redirected more than ${maxRedirects} times`);
  } finally {
    clearTimeout(timer);
  }
}
