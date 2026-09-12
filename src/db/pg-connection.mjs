/**
 * PostgreSQL connection-string SSL hardening (single source of truth).
 *
 * Why this exists: pg 8.x's bundled pg-connection-string treats
 * sslmode=prefer/require/verify-ca as aliases for verify-full — and prints a
 * SECURITY WARNING telling you to say 'verify-full' explicitly — because in
 * pg 9 those modes will silently adopt weaker libpq semantics. Neon's
 * default pooled connection string uses sslmode=require, so every
 * production process start emitted that warning.
 *
 * normalizeSslMode() upgrades remote (non-local) connection strings to an
 * EXPLICIT sslmode=verify-full:
 *   - sslmode missing / ssl=true        → sslmode=verify-full appended
 *   - sslmode=prefer|require|verify-ca  → rewritten to verify-full
 *     (byte-identical behavior under pg 8.x — the warning itself documents
 *      these are aliases — now future-proof and warning-free)
 *   - sslmode=disable|no-verify on a REMOTE host → REFUSED with a clear
 *     error: sending database credentials in plaintext (or skipping
 *     certificate verification) to a remote host is never appropriate.
 *   - local hosts (localhost / loopback / private ranges / *.local,
 *     *.internal) → returned UNCHANGED (developer machines, local docker).
 *
 * Security rules:
 *   - The connection string is NEVER logged, printed or included in error
 *     messages (it contains credentials).
 *   - Only the sslmode parameter is touched — the rest of the string
 *     (including exact credential encoding) is preserved byte-for-byte via
 *     string surgery, not URL re-encoding.
 */

const VERIFY_FULL = 'verify-full';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

function isLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (LOCAL_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true;
  // RFC1918 / link-local / unique-local IPv6
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
  if (/^169\.254\.\d+\.\d+$/.test(host)) return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host === 'fe80::1') return true;
  return false;
}

/** Extract the hostname of a postgres:// connection string without logging anything. */
function extractHost(connectionString) {
  const match = /^[a-zA-Z0-9+.-]*:\/\/[^/@]*@([^/?]+)/.exec(connectionString);
  const authority = match ? match[1] : /^[a-zA-Z0-9+.-]*:\/\/([^/?]+)/.exec(connectionString)?.[1];
  if (!authority) return '';
  if (authority.startsWith('[')) return authority.slice(0, authority.indexOf(']') + 1); // [IPv6]:port
  return authority.split(':')[0]; // strip :port
}

/**
 * @param {string} connectionString
 * @returns {{ connectionString: string, sslmode: string, changed: boolean, remote: boolean }}
 * @throws {Error} when a REMOTE connection explicitly requests an insecure
 *   SSL mode (disable / no-verify). The error never contains the URL.
 */
export function normalizeSslMode(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new Error('postgres connection string is required');
  }
  const host = extractHost(connectionString);
  const remote = !isLocalHost(host);

  const queryIndex = connectionString.indexOf('?');
  const base = queryIndex === -1 ? connectionString : connectionString.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : connectionString.slice(queryIndex + 1);

  const params = query ? query.split('&') : [];
  let sslmode = '';
  let sslmodeIndex = -1;
  for (let i = 0; i < params.length; i += 1) {
    const key = params[i].split('=')[0];
    if (key === 'sslmode') {
      sslmode = params[i].slice('sslmode='.length).toLowerCase();
      sslmodeIndex = i;
      break;
    }
  }
  const hasSslTrue = params.some((param) => param === 'ssl=true');

  if (!remote) {
    return { connectionString, sslmode: sslmode || (hasSslTrue ? 'ssl-true' : 'none'), changed: false, remote: false };
  }

  if (sslmode === 'disable' || sslmode === 'no-verify' || sslmode === 'allow') {
    throw new Error(
      `refusing insecure database connection: sslmode='${sslmode}' on a remote host (explicit TLS with certificate verification is required; use sslmode=verify-full)`,
    );
  }

  if (sslmode === VERIFY_FULL) {
    return { connectionString, sslmode, changed: false, remote: true };
  }

  // Missing sslmode (or ssl=true / prefer / require / verify-ca): force an
  // EXPLICIT verify-full. Under pg 8.x this is byte-for-byte the same
  // behavior the library already applied (aliases of verify-full) — the
  // change removes the deprecation warning and protects against pg 9.
  const normalizedParam = `sslmode=${VERIFY_FULL}`;
  let normalized;
  if (sslmodeIndex >= 0) {
    params[sslmodeIndex] = normalizedParam;
    normalized = `${base}?${params.join('&')}`;
  } else if (params.length > 0) {
    normalized = `${base}?${params.join('&')}&${normalizedParam}`;
  } else {
    normalized = `${base}?${normalizedParam}`;
  }
  return { connectionString: normalized, sslmode: VERIFY_FULL, changed: true, remote: true };
}

export default normalizeSslMode;
