/**
 * Publishing platforms (social OAuth preparation).
 *
 * Single source of truth for the platforms a legitimate content workflow can
 * publish to. Pure data + URL builders: no database, no state, no side effects,
 * so both the launch checks and the mission runtime can import it without
 * coupling their lifecycles.
 *
 * HARD RULES encoded here:
 *   · Only the minimum publishing scopes are requested. Engagement metrics are
 *     read back from the same platform API — never synthesized.
 *   · A platform with no registered app is reported as not configured. The code
 *     never pretends a connection exists: `connected` is only ever true after a
 *     real token exchange succeeded.
 *   · Tokens are provider material: they are never embedded in a URL, never
 *     logged, and never returned to a browser.
 */

export type SocialPlatformId = 'youtube' | 'instagram' | 'tiktok';

export interface SocialPlatformDefinition {
  id: SocialPlatformId;
  label: string;
  /** Where the operator registers the app (shown in the UI and the report). */
  consoleUrl: string;
  docsUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
  refreshUrl: string | null;
  revokeUrl: string | null;
  /** Minimum scopes needed to publish. Keep this list as small as possible. */
  scopes: readonly string[];
  /** OAuth client credentials (first present key wins). */
  clientIdKeys: readonly string[];
  clientSecretKeys: readonly string[];
  /** Platform capability keys this connection unlocks (see the mission tool catalog). */
  toolKeys: readonly string[];
  supportsPkce: boolean;
  /** True when the platform issues a long-lived token that must be refreshed. */
  refreshable: boolean;
  /** Free-text notes the dashboard shows next to the "connect" button. */
  notes: string;
}

export const SOCIAL_PLATFORMS: readonly SocialPlatformDefinition[] = [
  {
    id: 'youtube',
    label: 'YouTube (video publishing)',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    docsUrl: 'https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    refreshUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    // upload = publish; readonly = read back real engagement. Nothing broader.
    scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
    clientIdKeys: ['YOUTUBE_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_CLIENT_ID'],
    clientSecretKeys: ['YOUTUBE_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET'],
    toolKeys: ['youtube_publish'],
    supportsPkce: true,
    refreshable: true,
    notes: 'Requires an OAuth consent screen review for the upload scope before non-test users can connect.',
  },
  {
    id: 'instagram',
    label: 'Instagram (Reels/posts via Graph API)',
    consoleUrl: 'https://developers.facebook.com/apps',
    docsUrl: 'https://developers.facebook.com/docs/instagram-api/guides/content-publishing',
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    refreshUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    revokeUrl: null,
    scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'],
    clientIdKeys: ['INSTAGRAM_CLIENT_ID', 'META_APP_ID'],
    clientSecretKeys: ['INSTAGRAM_CLIENT_SECRET', 'META_APP_SECRET'],
    toolKeys: ['instagram_publish'],
    supportsPkce: false,
    refreshable: true,
    notes: 'Publishing requires a Business/Creator account linked to a Facebook Page; app review is required for the publish scope.',
  },
  {
    id: 'tiktok',
    label: 'TikTok (content posting API)',
    consoleUrl: 'https://developers.tiktok.com/apps',
    docsUrl: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    refreshUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    revokeUrl: 'https://open.tiktokapis.com/v2/oauth/revoke/',
    scopes: ['video.publish', 'video.list'],
    clientIdKeys: ['TIKTOK_CLIENT_KEY'],
    clientSecretKeys: ['TIKTOK_CLIENT_SECRET'],
    toolKeys: ['social_publishing'],
    supportsPkce: true,
    refreshable: true,
    notes: 'Direct-post requires the Content Posting API scope; unaudited clients can only post to private/draft until TikTok approves the app.',
  },
] as const;

export function getSocialPlatform(id: string): SocialPlatformDefinition {
  const platform = SOCIAL_PLATFORMS.find((entry) => entry.id === id);
  if (!platform) {
    throw new Error(`unknown social platform "${id}"`);
  }
  return platform;
}

/**
 * The callback URL to register with the platform. This is the exact string the
 * operator must paste into the provider console, so it is derived in one place
 * and returned verbatim by the API/status endpoints.
 */
export function socialRedirectUri(siteUrl: string, platformId: string): string {
  const base = siteUrl.trim().replace(/\/+$/, '');
  return `${base}/api/social/oauth/${platformId}/callback`;
}

/** Which OAuth client keys are present (names only; never the values). */
export function socialClientCredentials(
  env: Record<string, string | undefined>,
  platform: SocialPlatformDefinition,
): { clientId: string; clientSecret: string; clientIdKey: string | null; clientSecretKey: string | null } {
  let clientId = '';
  let clientSecret = '';
  let clientIdKey: string | null = null;
  let clientSecretKey: string | null = null;
  for (const key of platform.clientIdKeys) {
    const value = (env[key] ?? '').trim();
    if (value) {
      clientId = value;
      clientIdKey = key;
      break;
    }
  }
  for (const key of platform.clientSecretKeys) {
    const value = (env[key] ?? '').trim();
    if (value) {
      clientSecret = value;
      clientSecretKey = key;
      break;
    }
  }
  return { clientId, clientSecret, clientIdKey, clientSecretKey };
}

/**
 * Build the authorization URL for a platform. `state` and the PKCE challenge are
 * produced by the caller (they are persisted for single use).
 */
export function buildSocialAuthorizeUrl(input: {
  platform: SocialPlatformDefinition;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge?: string | null;
  /** Override (test fixtures / self-hosted proxies). Defaults to the platform. */
  authorizeUrl?: string | null;
  extraParams?: Record<string, string>;
}): string {
  const url = new URL(input.authorizeUrl || input.platform.authorizeUrl);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', input.state);
  url.searchParams.set('scope', input.platform.scopes.join(' '));
  if (input.codeChallenge) {
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [key, value] of Object.entries(input.extraParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Shape of a token response, normalized across the three platforms. */
export interface SocialTokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Absolute expiry when the platform reports one (never guessed). */
  expiresAt: string | null;
  scopes: string[];
  /** The platform account the token belongs to, when the platform tells us. */
  accountLabel: string | null;
}

function secondsToIso(seconds: unknown): string | null {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + value * 1000).toISOString();
}

/**
 * Normalize a token endpoint response. Every platform reports expiry
 * differently; when a platform does not report one, `expiresAt` stays null —
 * the system never invents an expiry it was not told.
 */
export function normalizeTokenResponse(platformId: SocialPlatformId, json: Record<string, unknown>): SocialTokenSet {
  const accessToken = String(json.access_token ?? '').trim();
  if (!accessToken) {
    throw new Error('token response contained no access_token');
  }
  const refreshToken = String(json.refresh_token ?? '').trim() || null;
  const scopeValue = json.scope ?? json.scopes;
  const scopes = Array.isArray(scopeValue)
    ? scopeValue.map((entry) => String(entry))
    : typeof scopeValue === 'string'
      ? scopeValue.split(/[\s,]+/).filter(Boolean)
      : [];
  const expiresAt =
    secondsToIso(json.expires_in) ??
    (json.expires_at ? new Date(Number(json.expires_at) * 1000).toISOString() : null);
  const accountLabel =
    (typeof json.account_label === 'string' && json.account_label) ||
    (typeof json.open_id === 'string' && json.open_id) ||
    (typeof json.user_id === 'string' && json.user_id) ||
    null;
  void platformId;
  return { accessToken, refreshToken, expiresAt, scopes, accountLabel };
}
