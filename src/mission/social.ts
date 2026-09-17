import { createHash, randomBytes } from 'node:crypto';
import {
  SOCIAL_PLATFORMS,
  buildSocialAuthorizeUrl,
  getSocialPlatform,
  normalizeTokenResponse,
  socialClientCredentials,
  socialRedirectUri,
  type SocialPlatformDefinition,
  type SocialTokenSet,
} from '../social/platforms';
import { MissionAuthError, decryptCredential, encryptCredential, vaultConfigured } from './auth';
import { appendMissionAudit, missionDb, missionId, nowIso, sha256, type Row } from './database';
import { MissionSelfServiceError, revokeCredential, storeCredential } from './self-management';

/**
 * Social publishing connections (YouTube / Instagram / TikTok).
 *
 * PREPARATION WITHOUT FABRICATION. This module implements the complete OAuth
 * authorization-code flow and token storage, and it refuses to do anything else
 * when a platform app is not registered:
 *
 *   · `socialPlatformStatus()` reports, per platform, whether the client
 *     credentials exist (names only), the exact redirect URI to register, and
 *     whether a REAL connection exists. Nothing is ever reported as connected
 *     just because the code exists.
 *   · `beginSocialAuthorization()` refuses with `provider_not_configured` when
 *     the app is not registered, listing the environment variables required.
 *   · `completeSocialAuthorization()` verifies the state (single-use, TTL,
 *     platform-bound), exchanges the code with the platform, and stores the
 *     tokens encrypted in the mission vault. A failed exchange surfaces the
 *     provider's status — no connection row is created and no token invented.
 *   · Tokens are never returned by any function that a route can serialize:
 *     only `socialAccessToken()` (in-process, for provider calls) decrypts them.
 *
 * Engagement figures are never synthesized anywhere in this flow: a connected
 * platform is a pipe, not a source of numbers.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export interface SocialPlatformStatus {
  id: string;
  label: string;
  /** Client credentials are present (client id AND secret). */
  appConfigured: boolean;
  /** Client credential env var names involved (names only). */
  requiredEnvKeys: string[];
  presentEnvKeys: string[];
  /** The exact redirect URI to paste into the provider console. */
  redirectUri: string;
  consoleUrl: string;
  docsUrl: string;
  scopes: string[];
  notes: string;
  /** A real token exchange has completed and the token has not expired. */
  connected: boolean;
  status: 'not_configured' | 'disconnected' | 'connected' | 'expired' | 'error';
  accountLabel: string | null;
  grantedScopes: string[];
  connectedAt: string | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  lastError: string | null;
  credentialId: string | null;
  /** Tool keys this connection unlocks. */
  toolKeys: string[];
}

function rowFor(platform: string): Row | undefined {
  return missionDb.get<Row>('SELECT * FROM social_connections WHERE platform = ?', [platform]);
}

function parseScopes(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.round((time - Date.now()) / (24 * 3600 * 1000));
}

/** Provider endpoints are overridable for hermetic tests, like OAUTH_*_BASE_URL. */
function endpoint(platform: SocialPlatformDefinition, kind: 'authorize' | 'token' | 'revoke'): string | null {
  const override = (process.env[`SOCIAL_${platform.id.toUpperCase()}_${kind.toUpperCase()}_URL`] ?? '').trim();
  if (override) return override;
  if (kind === 'authorize') return platform.authorizeUrl;
  if (kind === 'token') return platform.tokenUrl;
  return platform.revokeUrl;
}

export function socialPlatformStatuses(siteUrl: string): SocialPlatformStatus[] {
  return SOCIAL_PLATFORMS.map((platform) => {
    const credentials = socialClientCredentials(process.env, platform);
    const appConfigured = Boolean(credentials.clientId && credentials.clientSecret);
    const row = rowFor(platform.id);
    const expiresAt = row?.expires_at ? String(row.expires_at) : null;
    const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
    const storedStatus = row ? String(row.status) : 'disconnected';
    const connected = storedStatus === 'connected' && !expired;
    const status: SocialPlatformStatus['status'] = !appConfigured
      ? 'not_configured'
      : connected
        ? 'connected'
        : storedStatus === 'error'
          ? 'error'
          : expired && storedStatus === 'connected'
            ? 'expired'
            : 'disconnected';
    const requiredEnvKeys = [...platform.clientIdKeys, ...platform.clientSecretKeys];
    const presentEnvKeys = [credentials.clientIdKey, credentials.clientSecretKey].filter((key): key is string => Boolean(key));
    return {
      id: platform.id,
      label: platform.label,
      appConfigured,
      requiredEnvKeys,
      presentEnvKeys,
      redirectUri: socialRedirectUri(siteUrl, platform.id),
      consoleUrl: platform.consoleUrl,
      docsUrl: platform.docsUrl,
      scopes: [...platform.scopes],
      notes: platform.notes,
      connected,
      status,
      accountLabel: row?.account_label ? String(row.account_label) : null,
      grantedScopes: row ? parseScopes(row.scopes) : [],
      connectedAt: row?.connected_at ? String(row.connected_at) : null,
      expiresAt,
      daysUntilExpiry: daysUntil(expiresAt),
      lastError: row?.last_error ? String(row.last_error) : null,
      credentialId: row?.credential_id ? String(row.credential_id) : null,
      toolKeys: [...platform.toolKeys],
    };
  });
}

export interface SocialAuthorization {
  platform: string;
  authorizeUrl: string;
  redirectUri: string;
  stateExpiresAt: string;
}

/**
 * Start an authorization: create a single-use state (and PKCE verifier where the
 * platform supports it) and return the provider URL the owner must open.
 */
export function beginSocialAuthorization(input: { platform: string; ownerId: string; siteUrl: string }): SocialAuthorization {
  const platform = getSocialPlatform(input.platform);
  const credentials = socialClientCredentials(process.env, platform);
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new MissionAuthError(
      503,
      `${platform.label} app is not registered — set ${[...platform.clientIdKeys, ...platform.clientSecretKeys].join(' and ')}`,
      'provider_not_configured',
    );
  }
  const authorizeUrl = endpoint(platform, 'authorize');
  if (!authorizeUrl) {
    throw new MissionAuthError(503, `${platform.label} authorize URL is not configured`, 'provider_not_configured');
  }
  const state = randomBytes(32).toString('base64url');
  const verifier = platform.supportsPkce ? randomBytes(48).toString('base64url') : null;
  const challenge = verifier ? createHash('sha256').update(verifier).digest('base64url') : null;
  const redirectUri = socialRedirectUri(input.siteUrl, platform.id);
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  missionDb.run(
    `INSERT INTO social_oauth_states (id, state_hash, platform, owner_id, code_verifier, redirect_uri, created_at, expires_at, consumed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [missionId('sos'), sha256(state), platform.id, input.ownerId, verifier, redirectUri, nowIso(), expiresAt],
  );
  appendMissionAudit({
    actorType: 'owner',
    actorId: input.ownerId,
    action: 'social.authorization_started',
    subjectType: 'platform',
    subjectId: platform.id,
    detail: { redirectUri, pkce: Boolean(verifier) },
  });
  return {
    platform: platform.id,
    authorizeUrl: buildSocialAuthorizeUrl({
      platform,
      clientId: credentials.clientId,
      redirectUri,
      state,
      codeChallenge: challenge,
      authorizeUrl,
    }),
    redirectUri,
    stateExpiresAt: expiresAt,
  };
}

interface ConsumedState {
  platform: string;
  ownerId: string | null;
  codeVerifier: string | null;
  redirectUri: string;
}

function consumeState(state: string, platformId: string, redirectUri: string): ConsumedState {
  const hash = sha256(state);
  const result = missionDb.run(
    `UPDATE social_oauth_states SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    [nowIso(), hash, nowIso()],
  );
  if (result.changes !== 1) {
    throw new MissionSelfServiceError(400, 'the authorization state is invalid, expired or already used', 'invalid_state');
  }
  const row = missionDb.get<Row>('SELECT * FROM social_oauth_states WHERE state_hash = ?', [hash])!;
  if (String(row.platform) !== platformId) {
    throw new MissionSelfServiceError(400, 'the authorization state belongs to a different platform', 'invalid_state');
  }
  if (String(row.redirect_uri) !== redirectUri) {
    throw new MissionSelfServiceError(400, 'the callback URL does not match the one that started the authorization', 'invalid_state');
  }
  return {
    platform: String(row.platform),
    ownerId: row.owner_id ? String(row.owner_id) : null,
    codeVerifier: row.code_verifier ? String(row.code_verifier) : null,
    redirectUri: String(row.redirect_uri),
  };
}

/**
 * Exchange the authorization code for tokens. Errors are reported with the
 * provider's own status and a sanitized message — never with the client secret
 * or the token. Nothing is stored on failure.
 */
async function exchangeCode(input: {
  platform: SocialPlatformDefinition;
  code: string;
  redirectUri: string;
  codeVerifier: string | null;
}): Promise<SocialTokenSet> {
  const credentials = socialClientCredentials(process.env, input.platform);
  const tokenUrl = endpoint(input.platform, 'token');
  if (!tokenUrl) throw new MissionAuthError(503, `${input.platform.label} token URL is not configured`, 'provider_not_configured');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);
  if (input.platform.id === 'tiktok') {
    // TikTok requires the client key/secret in the body under these names.
    body.set('client_key', credentials.clientId);
  }

  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new MissionSelfServiceError(
      502,
      `could not reach ${input.platform.label} to exchange the authorization code (${error instanceof Error ? error.message : 'network error'})`,
      'provider_unreachable',
    );
  }
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (!response.ok) {
    // The provider's error code is useful; its message can echo request data,
    // so only a bounded, sanitized string is stored.
    const providerError = String(json.error ?? json.error_description ?? '').slice(0, 160);
    throw new MissionSelfServiceError(
      502,
      `${input.platform.label} rejected the authorization code (HTTP ${response.status}${providerError ? `: ${providerError}` : ''})`,
      'provider_rejected',
    );
  }
  try {
    return normalizeTokenResponse(input.platform.id, json);
  } catch {
    throw new MissionSelfServiceError(502, `${input.platform.label} returned no access token`, 'provider_rejected');
  }
}

export interface SocialConnectionPublic {
  platform: string;
  label: string;
  accountLabel: string | null;
  scopes: string[];
  connectedAt: string;
  expiresAt: string | null;
  credentialId: string | null;
  /** The environment variable a publishing tool resolves the token from. */
  accessEnvVar: string;
}

/**
 * Complete an authorization: verify state, exchange the code, store the tokens
 * encrypted, and record the connection. Returns the PUBLIC view only.
 */
export async function completeSocialAuthorization(input: {
  platform: string;
  code: string;
  state: string;
  ownerId: string;
  siteUrl: string;
}): Promise<SocialConnectionPublic> {
  if (!vaultConfigured()) {
    throw new MissionAuthError(
      503,
      'the credential vault is not configured (set ZA141251SA_CREDENTIAL_KEY to a 32+ character secret) — refusing to store a provider token unencrypted',
      'vault_not_configured',
    );
  }
  const platform = getSocialPlatform(input.platform);
  const redirectUri = socialRedirectUri(input.siteUrl, platform.id);
  const state = consumeState(input.state, platform.id, redirectUri);
  if (state.ownerId && state.ownerId !== input.ownerId) {
    throw new MissionSelfServiceError(403, 'the authorization belongs to a different signed-in owner', 'forbidden');
  }
  const tokens = await exchangeCode({ platform, code: input.code, redirectUri, codeVerifier: state.codeVerifier });
  const accessEnvVar = `${platform.id.toUpperCase()}_ACCESS_TOKEN`;

  // Rotate an existing connection's credential instead of accumulating rows.
  const existing = rowFor(platform.id);
  const previousCredentialId = existing?.credential_id ? String(existing.credential_id) : null;
  if (previousCredentialId) {
    try {
      revokeCredential(previousCredentialId, input.ownerId, `replaced by a new ${platform.label} authorization`);
    } catch {
      // A stale credential row that cannot be revoked must not block a fresh,
      // working connection — the audit trail below records the replacement.
    }
  }
  const credential = storeCredential({
    provider: platform.id,
    label: `${platform.label} publishing token`,
    kind: 'oauth_access_token',
    scope: tokens.scopes.length > 0 ? tokens.scopes : [...platform.scopes],
    envVar: accessEnvVar,
    secret: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    actorId: input.ownerId,
  });

  // The refresh token is stored separately so a rotation never loses it.
  if (tokens.refreshToken) {
    storeCredential({
      provider: `${platform.id}:refresh`,
      label: `${platform.label} refresh token`,
      kind: 'oauth_refresh_token',
      scope: [],
      envVar: `${platform.id.toUpperCase()}_REFRESH_TOKEN`,
      secret: tokens.refreshToken,
      expiresAt: null,
      actorId: input.ownerId,
    });
  }

  const now = nowIso();
  if (existing) {
    missionDb.run(
      `UPDATE social_connections
          SET account_label = ?, scopes = ?, status = 'connected', credential_id = ?, access_env_var = ?,
              token_type = ?, connected_by = ?, connected_at = ?, expires_at = ?, last_error = NULL, updated_at = ?
        WHERE platform = ?`,
      [
        tokens.accountLabel,
        JSON.stringify(tokens.scopes.length > 0 ? tokens.scopes : [...platform.scopes]),
        credential.id,
        accessEnvVar,
        'Bearer',
        input.ownerId,
        now,
        tokens.expiresAt,
        now,
        platform.id,
      ],
    );
  } else {
    missionDb.run(
      `INSERT INTO social_connections (id, platform, account_label, scopes, status, credential_id, access_env_var, token_type, connected_by, connected_at, expires_at, last_refresh_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'connected', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      [
        missionId('soc'),
        platform.id,
        tokens.accountLabel,
        JSON.stringify(tokens.scopes.length > 0 ? tokens.scopes : [...platform.scopes]),
        credential.id,
        accessEnvVar,
        'Bearer',
        input.ownerId,
        now,
        tokens.expiresAt,
        now,
        now,
      ],
    );
  }

  appendMissionAudit({
    actorType: 'owner',
    actorId: input.ownerId,
    action: 'social.connected',
    subjectType: 'platform',
    subjectId: platform.id,
    // Scopes and expiry are safe; the token and refresh token are structurally absent.
    detail: { accountLabel: tokens.accountLabel, scopes: tokens.scopes, expiresAt: tokens.expiresAt, credentialId: credential.id },
  });

  return {
    platform: platform.id,
    label: platform.label,
    accountLabel: tokens.accountLabel,
    scopes: tokens.scopes.length > 0 ? tokens.scopes : [...platform.scopes],
    connectedAt: now,
    expiresAt: tokens.expiresAt,
    credentialId: credential.id,
    accessEnvVar,
  };
}

/** Record a failed authorization attempt honestly (no connection is created). */
export function recordSocialAuthorizationFailure(input: { platform: string; ownerId: string | null; reason: string }): void {
  let platformId = input.platform;
  try {
    platformId = getSocialPlatform(input.platform).id;
  } catch {
    return; // unknown platform: nothing to record against
  }
  const now = nowIso();
  const existing = rowFor(platformId);
  const bounded = input.reason.slice(0, 200);
  if (existing) {
    missionDb.run(`UPDATE social_connections SET status = 'error', last_error = ?, updated_at = ? WHERE platform = ?`, [bounded, now, platformId]);
  } else {
    missionDb.run(
      `INSERT INTO social_connections (id, platform, account_label, scopes, status, credential_id, access_env_var, token_type, connected_by, connected_at, expires_at, last_refresh_at, last_error, created_at, updated_at)
       VALUES (?, ?, NULL, '[]', 'error', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
      [missionId('soc'), platformId, bounded, now, now],
    );
  }
  appendMissionAudit({
    actorType: input.ownerId ? 'owner' : 'system',
    actorId: input.ownerId,
    action: 'social.authorization_failed',
    subjectType: 'platform',
    subjectId: platformId,
    detail: { reason: bounded },
  });
}

export interface SocialDisconnectResult {
  platform: string;
  status: 'disconnected';
  credentialRevoked: boolean;
  providerRevoked: boolean;
  providerRevokeResult: string;
}

/**
 * Disconnect a platform: revoke the stored credential locally and ask the
 * provider to revoke the token when it exposes a revocation endpoint. A failed
 * provider revocation is reported as such (the local credential is still gone).
 */
export async function disconnectSocial(input: { platform: string; ownerId: string; reason?: string | null }): Promise<SocialDisconnectResult> {
  const platform = getSocialPlatform(input.platform);
  const row = rowFor(platform.id);
  const storedStatus = row ? String(row.status) : 'none';
  if (!row || storedStatus === 'disconnected' || storedStatus === 'pending') {
    // Nothing to disconnect is reported honestly rather than silently succeeding.
    throw new MissionSelfServiceError(404, `${platform.label} is not connected`, 'not_found');
  }
  const credentialId = row.credential_id ? String(row.credential_id) : null;
  // The token must be read BEFORE the local credential is revoked: revocation
  // clears the credential, and without the token we could not ask the platform
  // to invalidate remote access.
  const token = credentialId ? socialAccessTokenByCredential(credentialId) : null;
  let credentialRevoked = false;
  if (credentialId) {
    try {
      revokeCredential(credentialId, input.ownerId, input.reason ?? 'owner disconnected the platform');
      credentialRevoked = true;
    } catch {
      credentialRevoked = false;
    }
  }

  let providerRevoked = false;
  let providerRevokeResult = 'not attempted';
  const revokeUrl = endpoint(platform, 'revoke');
  if (revokeUrl && token) {
    try {
      const body = new URLSearchParams(platform.id === 'youtube' ? { token } : { access_token: token, client_id: socialClientCredentials(process.env, platform).clientId });
      const response = await fetch(revokeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      providerRevoked = response.ok;
      providerRevokeResult = `HTTP ${response.status}`;
    } catch (error) {
      providerRevokeResult = `unreachable (${error instanceof Error ? error.message : 'network error'})`;
    }
  } else if (!revokeUrl) {
    providerRevokeResult = 'platform exposes no revocation endpoint — remove the connection from the platform account settings to invalidate remote access';
  }

  const now = nowIso();
  missionDb.run(
    `UPDATE social_connections SET status = 'disconnected', credential_id = NULL, access_env_var = NULL, updated_at = ? WHERE platform = ?`,
    [now, platform.id],
  );
  missionDb.run(`DELETE FROM social_oauth_states WHERE platform = ? AND consumed_at IS NULL`, [platform.id]);
  appendMissionAudit({
    actorType: 'owner',
    actorId: input.ownerId,
    action: 'social.disconnected',
    subjectType: 'platform',
    subjectId: platform.id,
    detail: { credentialRevoked, providerRevoked, providerRevokeResult },
  });
  return { platform: platform.id, status: 'disconnected', credentialRevoked, providerRevoked, providerRevokeResult };
}

/**
 * In-process access to a connected platform's token. Never exposed over HTTP:
 * used by provider calls only.
 */
export function socialAccessToken(platformId: string): { token: string; envVar: string } | null {
  const row = rowFor(platformId);
  if (!row || String(row.status) !== 'connected' || !row.credential_id) return null;
  const token = socialAccessTokenByCredential(String(row.credential_id));
  if (!token) return null;
  return { token, envVar: row.access_env_var ? String(row.access_env_var) : `${platformId.toUpperCase()}_ACCESS_TOKEN` };
}

function socialAccessTokenByCredential(credentialId: string): string | null {
  const row = missionDb.get<Row>('SELECT * FROM mission_credentials WHERE id = ? AND status = ?', [credentialId, 'active']);
  if (!row) return null;
  try {
    return decryptCredential({
      ciphertext: String(row.ciphertext),
      iv: String(row.iv),
      tag: String(row.tag),
    });
  } catch {
    return null;
  }
}

/**
 * Roll a token forward after a refresh. The plaintext never leaves this module;
 * the caller (a publishing tool) performs the provider call itself.
 */
export function storeRefreshedToken(input: { platform: string; accessToken: string; expiresAt: string | null; actorId?: string | null }): void {
  const platform = getSocialPlatform(input.platform);
  const row = rowFor(platform.id);
  if (!row) {
    throw new MissionSelfServiceError(404, `${platform.label} is not connected`, 'not_found');
  }
  const existingCredentialId = row.credential_id ? String(row.credential_id) : null;
  const accessEnvVar = row.access_env_var ? String(row.access_env_var) : `${platform.id.toUpperCase()}_ACCESS_TOKEN`;
  const encrypted = encryptCredential(input.accessToken);
  const now = nowIso();
  if (existingCredentialId) {
    missionDb.run(
      `UPDATE mission_credentials SET ciphertext = ?, iv = ?, tag = ?, masked_hint = ?, expires_at = ?, last_rotated_at = ?, rotation_count = rotation_count + 1 WHERE id = ?`,
      [encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.hint, input.expiresAt, now, existingCredentialId],
    );
  } else {
    const credential = storeCredential({
      provider: platform.id,
      label: `${platform.label} publishing token`,
      kind: 'oauth_access_token',
      scope: [...platform.scopes],
      envVar: accessEnvVar,
      secret: input.accessToken,
      expiresAt: input.expiresAt,
      actorId: input.actorId ?? null,
    });
    missionDb.run(`UPDATE social_connections SET credential_id = ?, updated_at = ? WHERE platform = ?`, [credential.id, now, platform.id]);
  }
  missionDb.run(`UPDATE social_connections SET status = 'connected', expires_at = ?, last_refresh_at = ?, last_error = NULL, updated_at = ? WHERE platform = ?`, [
    input.expiresAt,
    now,
    now,
    platform.id,
  ]);
  appendMissionAudit({
    actorType: input.actorId ? 'owner' : 'system',
    actorId: input.actorId ?? null,
    action: 'social.token_refreshed',
    subjectType: 'platform',
    subjectId: platform.id,
    detail: { expiresAt: input.expiresAt },
  });
}

/** Platforms whose stored token is missing or expired — publishing is refused. */
export function expiredConnections(): Array<{ platform: string; status: string; daysUntilExpiry: number | null }> {
  return missionDb
    .all<Row>(`SELECT platform, status, expires_at FROM social_connections WHERE status = 'connected'`)
    .map((row) => ({
      platform: String(row.platform),
      status: String(row.status),
      daysUntilExpiry: daysUntil(row.expires_at ? String(row.expires_at) : null),
    }))
    .filter((entry) => entry.daysUntilExpiry !== null && entry.daysUntilExpiry <= 0);
}
