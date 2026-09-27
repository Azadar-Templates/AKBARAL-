/**
 * Free public URL discovery.
 *
 * A custom domain costs money. Every free host this project can actually run
 * on already hands the deployment a working HTTPS hostname (`*.hf.space`,
 * `*.onrender.com`, …), so the public URL is derivable instead of purchasable:
 * nothing in AKBARAL! needs a bought domain to go live.
 *
 * Precedence:
 *   1. AKBARAL_SITE_URL — explicit owner configuration always wins.
 *   2. The host's own injected hostname (read-only detection, never guessed).
 *   3. Nothing — the caller keeps its existing not-configured behaviour.
 *
 * A domain may be bought LATER out of verified mission revenue; until then the
 * free hostname is the production hostname and is treated as such by
 * robots.txt, sitemap.xml, OAuth redirect URIs and payment return URLs.
 */

export interface DetectedPublicUrl {
  url: string;
  /** The platform that supplied it, for honest reporting. */
  source: string;
  /** The environment variable the value came from. */
  envKey: string;
}

type Env = Record<string, string | undefined>;

function clean(value: string | undefined): string {
  return String(value ?? '').trim();
}

function https(host: string): string {
  const bare = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return bare ? `https://${bare}` : '';
}

/**
 * Detect the free public HTTPS URL this deployment is already served on.
 * Returns null when the process is not running on a recognised host.
 */
export function detectPlatformPublicUrl(env: Env = process.env): DetectedPublicUrl | null {
  // Hugging Face Spaces (Docker SDK): SPACE_HOST is the full public hostname.
  const spaceHost = clean(env.SPACE_HOST);
  if (spaceHost) return { url: https(spaceHost), source: 'Hugging Face Spaces', envKey: 'SPACE_HOST' };
  const spaceId = clean(env.SPACE_ID); // "owner/space-name"
  if (spaceId.includes('/')) {
    const [owner, space] = spaceId.split('/');
    const slug = `${owner}-${space}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (slug.length > 1) return { url: https(`${slug}.hf.space`), source: 'Hugging Face Spaces', envKey: 'SPACE_ID' };
  }
  // Render injects the full external URL.
  const render = clean(env.RENDER_EXTERNAL_URL);
  if (render) return { url: https(render), source: 'Render', envKey: 'RENDER_EXTERNAL_URL' };
  const renderHost = clean(env.RENDER_EXTERNAL_HOSTNAME);
  if (renderHost) return { url: https(renderHost), source: 'Render', envKey: 'RENDER_EXTERNAL_HOSTNAME' };
  // Koyeb, Fly.io, Railway, Vercel and a generic escape hatch.
  const koyeb = clean(env.KOYEB_PUBLIC_DOMAIN);
  if (koyeb) return { url: https(koyeb), source: 'Koyeb', envKey: 'KOYEB_PUBLIC_DOMAIN' };
  const fly = clean(env.FLY_APP_NAME);
  if (fly) return { url: https(`${fly}.fly.dev`), source: 'Fly.io', envKey: 'FLY_APP_NAME' };
  const railway = clean(env.RAILWAY_PUBLIC_DOMAIN);
  if (railway) return { url: https(railway), source: 'Railway', envKey: 'RAILWAY_PUBLIC_DOMAIN' };
  const vercel = clean(env.VERCEL_URL);
  if (vercel) return { url: https(vercel), source: 'Vercel', envKey: 'VERCEL_URL' };
  const generic = clean(env.PUBLIC_URL);
  if (generic && /^https?:\/\//i.test(generic)) {
    return { url: generic.replace(/\/+$/, ''), source: 'PUBLIC_URL', envKey: 'PUBLIC_URL' };
  }
  return null;
}

/**
 * The URL the public site should present itself as: explicit configuration
 * first, then the free platform hostname.
 */
export function resolvePublicSiteUrl(env: Env = process.env): DetectedPublicUrl | null {
  const explicit = clean(env.AKBARAL_SITE_URL);
  if (explicit) {
    return { url: explicit.replace(/\/+$/, ''), source: 'explicit configuration', envKey: 'AKBARAL_SITE_URL' };
  }
  return detectPlatformPublicUrl(env);
}
