/**
 * Shared SSRF / URL safety helpers.
 *
 * The platform never lets user-controlled URLs reach private network ranges.
 * Deployments that intentionally route search/page-fetch through an internal
 * provider may set AKBARAL_ALLOW_PRIVATE_PROVIDER=1, but normal production
 * stays on the deny-by-default path.
 */

const PRIVATE_HOST_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.|::1$|::$|localhost$|.*\.local$|.*\.internal$)/i;

function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

function isPrivateHostname(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (PRIVATE_HOST_RE.test(host)) {
    return true;
  }
  // IPv6 loopback, link-local, private unique-local, and IPv4-mapped forms.
  if (
    host === '::1' ||
    host === '::' ||
    /^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:|^fe80:/i.test(host) ||
    /^::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/i.test(host)
  ) {
    return true;
  }
  return false;
}

function assertHttpUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} refused: invalid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} refused: only http/https URLs are allowed`);
  }
  return url;
}

export function assertPublicHttpUrl(raw: string): string {
  const url = assertHttpUrl(raw, 'page_fetch');
  if (isPrivateHostname(url.hostname)) {
    throw new Error(`page_fetch refused: private host "${url.hostname}" is blocked (SSRF protection)`);
  }
  return url.toString();
}

/**
 * Validate a configured provider/search endpoint. Private endpoints are
 * permitted only when AKBARAL_ALLOW_PRIVATE_PROVIDER=1 is explicitly set.
 */
export function assertProviderHttpUrl(raw: string): string {
  const url = assertHttpUrl(raw, 'provider');
  const allowPrivate = process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER === '1';
  if (!allowPrivate && isPrivateHostname(url.hostname)) {
    throw new Error(
      `provider refused: private host "${url.hostname}" is blocked; set AKBARAL_ALLOW_PRIVATE_PROVIDER=1 only for a trusted internal provider`,
    );
  }
  return url.toString();
}

/**
 * Validate a user-influenced source URL that is fetched through a trusted
 * provider proxy.
 *
 * `AKBARAL_ALLOW_PRIVATE_PROVIDER=1` relaxes validation ONLY for the operator's
 * configured internal provider. It must never turn arbitrary user-supplied
 * source URLs into a generic SSRF bypass: a private source URL is accepted only
 * when it is on the SAME host as the trusted internal search/fetch provider.
 * Public URLs are always allowed.
 */
export function assertAllowedSourceUrl(raw: string, providerBase?: string): string {
  const url = assertHttpUrl(raw, 'page_fetch');
  if (!isPrivateHostname(url.hostname)) {
    return url.toString();
  }
  const allowPrivate = process.env.AKBARAL_ALLOW_PRIVATE_PROVIDER === '1';
  if (!allowPrivate || !providerBase) {
    throw new Error(
      `page_fetch refused: private host "${url.hostname}" is blocked (SSRF protection)`,
    );
  }
  const base = assertHttpUrl(providerBase, 'provider');
  if (base.hostname !== url.hostname) {
    throw new Error(
      `page_fetch refused: private source "${url.hostname}" is not on the trusted provider host "${base.hostname}"`,
    );
  }
  return url.toString();
}

export function isPrivateHttpUrl(raw: string): boolean {
  try {
    const url = assertHttpUrl(raw, 'url');
    return isPrivateHostname(url.hostname);
  } catch {
    return true;
  }
}
