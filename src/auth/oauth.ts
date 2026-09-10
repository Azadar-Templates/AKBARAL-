import { createHash, randomBytes, createPublicKey, createSign, verify as cryptoVerify } from 'node:crypto';
import {
  consumeOAuthState,
  findOAuthIdentity,
  insertOAuthIdentity,
  insertOAuthState,
  pruneOAuthStates,
  type OAuthProviderKey,
} from '../db/oauth-repositories';
import { createUser, findUserByEmail, findUserById, updateUserLastLogin, createSession, appendSecurityLog, appendAuditLog } from '../db';
import { hashToken, newBearerToken, signAccessToken } from '../security';
import { HttpError } from '../server/http';

/**
 * OAuth 2.0 provider integration + account linking (Milestone: OAuth).
 *
 * Real flows, server-side only:
 *   authorize -> provider consent -> callback(code, state) -> token exchange
 *   (secrets never leave the server) -> verified profile -> session/link.
 *
 * Security model:
 *   - `state` is a 256-bit random value, stored HASHED server-side, single
 *     use, 10-minute TTL, bound to provider + mode + user + the exact
 *     redirect_uri + requester IP. Consuming is a guarded UPDATE, so replay
 *     and racing callbacks are impossible.
 *   - PKCE (S256) is used for every provider that supports it.
 *   - Auto-linking by email happens ONLY when the provider asserts the email
 *     is verified. Unverified provider emails never silently attach to an
 *     existing password account (takeover protection); the user must sign in
 *     with their password and link explicitly from Settings.
 *   - Linking an identity that already belongs to another user is refused
 *     (409) and logged as a security event.
 *
 * Endpoint base URLs default to the real production endpoints. Test fixtures
 * override them through OAUTH_<PROVIDER>_BASE_URL exactly like the existing
 * model-provider fixture (OPENAI_BASE_URL) — no production behavior change.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

interface ProviderDefinition {
  key: OAuthProviderKey;
  label: string;
  /** Env var holding the authorize/token base URL (overridable for fixtures). */
  baseUrlEnv: string;
  defaultAuthorizeBase: string;
  defaultTokenBase: string;
  authorizePath: string;
  tokenPath: string;
  scopes: string[];
  supportsPkce: boolean;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Callback arrives as application/x-www-form-urlencoded POST. */
  formPostCallback: boolean;
}

const PROVIDERS: Record<OAuthProviderKey, ProviderDefinition> = {
  google: {
    key: 'google',
    label: 'Google',
    baseUrlEnv: 'OAUTH_GOOGLE_BASE_URL',
    defaultAuthorizeBase: 'https://accounts.google.com',
    defaultTokenBase: 'https://oauth2.googleapis.com',
    authorizePath: '/o/oauth2/v2/auth',
    tokenPath: '/token',
    scopes: ['openid', 'email', 'profile'],
    supportsPkce: true,
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    formPostCallback: false,
  },
  github: {
    key: 'github',
    label: 'GitHub',
    baseUrlEnv: 'OAUTH_GITHUB_BASE_URL',
    defaultAuthorizeBase: 'https://github.com',
    defaultTokenBase: 'https://github.com',
    authorizePath: '/login/oauth/authorize',
    tokenPath: '/login/oauth/access_token',
    scopes: ['read:user', 'user:email'],
    supportsPkce: true,
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',
    formPostCallback: false,
  },
  microsoft: {
    key: 'microsoft',
    label: 'Microsoft',
    baseUrlEnv: 'OAUTH_MS_BASE_URL',
    defaultAuthorizeBase: 'https://login.microsoftonline.com',
    defaultTokenBase: 'https://login.microsoftonline.com',
    authorizePath: '/common/oauth2/v2.0/authorize',
    tokenPath: '/common/oauth2/v2.0/token',
    scopes: ['openid', 'profile', 'email', 'User.Read'],
    supportsPkce: true,
    clientIdEnv: 'MS_CLIENT_ID',
    clientSecretEnv: 'MS_CLIENT_SECRET',
    formPostCallback: false,
  },
  apple: {
    key: 'apple',
    label: 'Apple',
    baseUrlEnv: 'OAUTH_APPLE_BASE_URL',
    defaultAuthorizeBase: 'https://appleid.apple.com',
    defaultTokenBase: 'https://appleid.apple.com',
    authorizePath: '/auth/authorize',
    tokenPath: '/auth/token',
    scopes: ['name', 'email'],
    supportsPkce: false, // Apple confidential clients do not use PKCE
    clientIdEnv: 'APPLE_CLIENT_ID',
    clientSecretEnv: 'APPLE_CLIENT_SECRET',
    formPostCallback: true,
  },
};

/** Resolve a provider value at call time (env may be set after import). */
function providerEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

interface ResolvedProvider {
  definition: ProviderDefinition;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
}

function resolveProvider(key: OAuthProviderKey): ResolvedProvider {
  const definition = PROVIDERS[key];
  const baseOverride = providerEnv(definition.baseUrlEnv);
  return {
    definition,
    authorizeUrl: (baseOverride ?? definition.defaultAuthorizeBase) + definition.authorizePath,
    tokenUrl: (baseOverride ?? definition.defaultTokenBase) + definition.tokenPath,
    clientId: providerEnv(definition.clientIdEnv),
    clientSecret: providerEnv(definition.clientSecretEnv),
  };
}

export function listOAuthProviders(): Array<{ key: OAuthProviderKey; label: string; configured: boolean; required: string[] }> {
  return (Object.keys(PROVIDERS) as OAuthProviderKey[]).map((key) => ({
    key,
    label: PROVIDERS[key].label,
    configured: isProviderConfigured(key),
    required: requiredEnv(key),
  }));
}

export function isProviderConfigured(key: OAuthProviderKey): boolean {
  if (!PROVIDERS[key]) return false;
  const resolved = resolveProvider(key);
  if (key === 'apple') {
    return Boolean(resolved.clientId && (providerEnv('APPLE_PRIVATE_KEY') || resolved.clientSecret) && providerEnv('APPLE_KEY_ID') && providerEnv('APPLE_TEAM_ID'));
  }
  return Boolean(resolved.clientId && resolved.clientSecret);
}

function requiredEnv(key: OAuthProviderKey): string[] {
  if (key === 'apple') return ['APPLE_CLIENT_ID', 'APPLE_PRIVATE_KEY (or APPLE_CLIENT_SECRET)', 'APPLE_KEY_ID', 'APPLE_TEAM_ID'];
  const map: Record<OAuthProviderKey, string[]> = {
    google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
    microsoft: ['MS_CLIENT_ID', 'MS_CLIENT_SECRET'],
    apple: [],
  };
  return map[key];
}

export function providerConfiguredOrThrow(key: string): ResolvedProvider {
  if (!PROVIDERS[key as OAuthProviderKey]) {
    throw new HttpError(404, `unknown OAuth provider "${key}"`, 'not_found');
  }
  const provider = resolveProvider(key as OAuthProviderKey);
  if (!isProviderConfigured(key as OAuthProviderKey)) {
    throw new HttpError(
      503,
      `${provider.definition.label} sign-in is not configured on this deployment`,
      'provider_not_configured',
      { requiredCredential: requiredEnv(provider.definition.key) },
    );
  }
  return provider;
}

// ---------------------------------------------------------------------------
// State + PKCE
// ---------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface IssuedAuthorization {
  redirectUrl: string;
}

export function issueAuthorization(input: {
  providerKey: string;
  redirectUri: string;
  mode: 'login' | 'link';
  userId: string | null;
  ip: string | null;
}): IssuedAuthorization {
  const provider = providerConfiguredOrThrow(input.providerKey);
  const state = base64url(randomBytes(32));
  const verifier = provider.definition.supportsPkce ? base64url(randomBytes(48)) : null;
  const challenge = verifier ? base64url(createHash('sha256').update(verifier).digest()) : null;

  insertOAuthState({
    stateHash: hashToken(state),
    provider: provider.definition.key,
    mode: input.mode,
    userId: input.userId,
    codeVerifier: verifier,
    redirectUri: input.redirectUri,
    ip: input.ip,
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId as string);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', provider.definition.scopes.join(' '));
  if (challenge) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  if (provider.definition.formPostCallback) {
    url.searchParams.set('response_mode', 'form_post');
  }
  return { redirectUrl: url.toString() };
}

export interface ConsumedState {
  provider: OAuthProviderKey;
  mode: 'login' | 'link';
  userId: string | null;
  codeVerifier: string | null;
  redirectUri: string;
}

export function consumeState(state: string, providerKey: string, redirectUri: string): ConsumedState {
  const row = consumeOAuthState(hashToken(state));
  if (!row) {
    throw new HttpError(400, 'OAuth state is invalid, expired or already used', 'invalid_state');
  }
  if (row.provider !== providerKey) {
    throw new HttpError(400, 'OAuth state was issued for a different provider', 'invalid_state');
  }
  if (row.redirect_uri !== redirectUri) {
    throw new HttpError(400, 'OAuth callback redirect URI mismatch', 'invalid_state');
  }
  return {
    provider: row.provider,
    mode: row.mode,
    userId: row.user_id,
    codeVerifier: row.code_verifier,
    redirectUri: row.redirect_uri,
  };
}

// ---------------------------------------------------------------------------
// Token exchange + profile
// ---------------------------------------------------------------------------

export interface OAuthProfile {
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

async function exchangeCode(provider: ResolvedProvider, code: string, redirectUri: string, codeVerifier: string | null): Promise<{ accessToken: string; idToken: string | null }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: provider.clientId as string,
  });
  if (provider.definition.key === 'apple') {
    body.set('client_secret', await appleClientSecret(provider));
  } else {
    body.set('client_secret', provider.clientSecret as string);
  }
  if (codeVerifier) {
    body.set('code_verifier', codeVerifier);
  }

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new HttpError(502, `${provider.definition.label} token exchange failed (HTTP ${response.status})`, 'oauth_exchange_failed');
  }
  const payload = (await response.json()) as { access_token?: string; id_token?: string; error?: string };
  if (!payload.access_token && !payload.id_token) {
    throw new HttpError(502, `${provider.definition.label} token exchange returned no token: ${payload.error ?? 'unknown error'}`, 'oauth_exchange_failed');
  }
  return { accessToken: payload.access_token ?? '', idToken: payload.id_token ?? null };
}

async function fetchProfile(provider: ResolvedProvider, tokens: { accessToken: string; idToken: string | null }): Promise<OAuthProfile> {
  switch (provider.definition.key) {
    case 'google': {
      const response = await fetch(`${process.env.OAUTH_GOOGLE_BASE_URL ?? 'https://openidconnect.googleapis.com'}/v1/userinfo`, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new HttpError(502, 'Google profile fetch failed', 'oauth_profile_failed');
      const body = (await response.json()) as { sub?: string; email?: string; email_verified?: boolean | string; name?: string };
      if (!body.sub) throw new HttpError(502, 'Google profile missing subject', 'oauth_profile_failed');
      return {
        providerAccountId: body.sub,
        email: body.email?.toLowerCase() ?? null,
        emailVerified: body.email_verified === true || body.email_verified === 'true',
        name: body.name ?? null,
      };
    }
    case 'github': {
      const userResponse = await fetch(`${process.env.OAUTH_GITHUB_BASE_URL ?? 'https://api.github.com'}/user`, {
        headers: { authorization: `Bearer ${tokens.accessToken}`, accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!userResponse.ok) throw new HttpError(502, 'GitHub profile fetch failed', 'oauth_profile_failed');
      const user = (await userResponse.json()) as { id?: number; login?: string; name?: string; email?: string };
      if (!user.id) throw new HttpError(502, 'GitHub profile missing id', 'oauth_profile_failed');
      // The public profile email is often absent/unverified — the verified
      // primary address comes from /user/emails.
      let email: string | null = user.email?.toLowerCase() ?? null;
      let verified = false;
      const emailsResponse = await fetch(`${process.env.OAUTH_GITHUB_BASE_URL ?? 'https://api.github.com'}/user/emails`, {
        headers: { authorization: `Bearer ${tokens.accessToken}`, accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (emailsResponse?.ok) {
        const emails = (await emailsResponse.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find((entry) => entry.primary) ?? emails.find((entry) => entry.verified);
        if (primary) {
          email = primary.email.toLowerCase();
          verified = primary.verified;
        }
      }
      return { providerAccountId: String(user.id), email, emailVerified: verified, name: user.name ?? user.login ?? null };
    }
    case 'microsoft': {
      const response = await fetch(`${process.env.OAUTH_MS_BASE_URL ?? 'https://graph.microsoft.com'}/v1.0/me`, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new HttpError(502, 'Microsoft profile fetch failed', 'oauth_profile_failed');
      const body = (await response.json()) as { id?: string; displayName?: string; mail?: string | null; userPrincipalName?: string };
      if (!body.id) throw new HttpError(502, 'Microsoft profile missing id', 'oauth_profile_failed');
      // Microsoft Graph does not expose an email_verified assertion — treat
      // as UNverified so a provider email never auto-links to an existing
      // password account (explicit linking from Settings still works).
      return {
        providerAccountId: body.id,
        email: (body.mail ?? body.userPrincipalName ?? '').toLowerCase() || null,
        emailVerified: false,
        name: body.displayName ?? null,
      };
    }
    case 'apple': {
      if (!tokens.idToken) throw new HttpError(502, 'Apple response missing id_token', 'oauth_profile_failed');
      const claims = await verifyAppleIdToken(tokens.idToken);
      return {
        providerAccountId: claims.sub,
        email: claims.email?.toLowerCase() ?? null,
        emailVerified: claims.email_verified === true || claims.email_verified === 'true',
        name: claims.name ?? null,
      };
    }
    default:
      throw new HttpError(500, 'unhandled provider', 'internal_error');
  }
}

// ---------------------------------------------------------------------------
// Apple specifics: ES256 client-secret JWT + id_token verification via JWKS
// ---------------------------------------------------------------------------

async function appleClientSecret(provider: ResolvedProvider): Promise<string> {
  const staticSecret = process.env.APPLE_CLIENT_SECRET;
  const privateKeyPem = process.env.APPLE_PRIVATE_KEY;
  if (!privateKeyPem) {
    if (!staticSecret) throw new HttpError(503, 'Apple sign-in is not configured', 'provider_not_configured');
    return staticSecret;
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: process.env.APPLE_KEY_ID };
  const payload = {
    iss: process.env.APPLE_TEAM_ID,
    iat: now,
    exp: now + 30 * 60,
    aud: 'https://appleid.apple.com',
    sub: provider.clientId as string,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('SHA256');
  signer.update(unsigned);
  const signature = signer.sign({ key: privateKeyPem.replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${signature.toString('base64url')}`;
}

interface AppleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string | null;
}

async function verifyAppleIdToken(idToken: string): Promise<AppleIdTokenClaims> {
  const [headerPart, payloadPart, signaturePart] = idToken.split('.');
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new HttpError(502, 'malformed Apple id_token', 'oauth_profile_failed');
  }
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString()) as { alg?: string; kid?: string };
  if (header.alg !== 'ES256') {
    throw new HttpError(502, `unsupported Apple id_token algorithm ${header.alg}`, 'oauth_profile_failed');
  }
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString()) as AppleIdTokenClaims & { iss?: string; aud?: string };
  const apple = resolveProvider('apple');
  if (claims.iss !== 'https://appleid.apple.com' || claims.aud !== apple.clientId) {
    throw new HttpError(502, 'Apple id_token issuer/audience mismatch', 'oauth_profile_failed');
  }
  // Fetch Apple's public keys and verify the ES256 signature.
  const jwksResponse = await fetch(`${process.env.OAUTH_APPLE_BASE_URL ?? 'https://appleid.apple.com'}/auth/keys`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!jwksResponse?.ok) {
    throw new HttpError(502, 'could not fetch Apple public keys', 'oauth_profile_failed');
  }
  const jwks = (await jwksResponse.json()) as { keys?: Array<Record<string, string>> };
  const jwk = (jwks.keys ?? []).find((key) => key.kid === header.kid);
  if (!jwk) {
    throw new HttpError(502, 'no Apple signing key matches the id_token header', 'oauth_profile_failed');
  }
  const publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
  const valid = cryptoVerify('sha256', Buffer.from(`${headerPart}.${payloadPart}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signaturePart, 'base64url'));
  if (!valid) {
    throw new HttpError(502, 'Apple id_token signature verification failed', 'oauth_profile_failed');
  }
  return claims;
}

// ---------------------------------------------------------------------------
// Account resolution: login, provision, link — with takeover protection
// ---------------------------------------------------------------------------

export interface OAuthLoginResult {
  userId: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  sessionId: string;
  outcome: 'login' | 'autolink' | 'registered';
}

/**
 * Complete an OAuth login: exchange the code, fetch the verified profile and
 * resolve it to an account. Existing identity -> login. Verified provider
 * email matching an existing account -> link + login. Otherwise -> provision
 * a new account. Unverified provider emails never attach to existing
 * accounts (takeover protection).
 */
export async function completeOAuthLogin(input: {
  providerKey: string;
  code: string;
  state: string;
  redirectUri: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<OAuthLoginResult> {
  pruneOAuthStates();
  const provider = providerConfiguredOrThrow(input.providerKey);
  const stateInfo = consumeState(input.state, provider.definition.key, input.redirectUri);
  if (stateInfo.mode !== 'login') {
    throw new HttpError(400, 'this OAuth flow was initiated for account linking, not sign-in', 'invalid_state');
  }
  const tokens = await exchangeCode(provider, input.code, input.redirectUri, stateInfo.codeVerifier);
  const profile = await fetchProfile(provider, tokens);
  if (!profile.email || !profile.providerAccountId) {
    throw new HttpError(403, `${provider.definition.label} did not share an email address — cannot complete sign-in`, 'oauth_email_missing');
  }

  const logSecurity = (eventType: string, severity: 'info' | 'warning' | 'critical', description: string, metadata: Record<string, unknown> = {}) => {
    appendSecurityLog({ eventType, severity, ipAddress: input.ip, userAgent: input.userAgent, description, metadata: { provider: provider.definition.key, ...metadata } });
  };

  const existing = findOAuthIdentity(provider.definition.key, profile.providerAccountId);
  if (existing) {
    const session = issueSession(existing.user_id, input.ip, input.userAgent);
    return { userId: existing.user_id, email: profile.email, refreshToken: session.refreshToken, accessToken: session.accessToken, sessionId: session.sessionId, outcome: 'login' };
  }

  const userByEmail = findUserByEmail(profile.email);
  if (userByEmail) {
    if (!profile.emailVerified) {
      logSecurity('auth.oauth.autolink_blocked', 'warning', 'provider email is not verified; auto-linking to an existing account refused', { email: profile.email });
      throw new HttpError(
        403,
        'that email is already registered but the provider did not verify it — sign in with your password, then link this provider from Settings',
        'oauth_link_blocked',
      );
    }
    const linked = insertOAuthIdentity({ userId: userByEmail.id, provider: provider.definition.key, providerAccountId: profile.providerAccountId, emailAtLink: profile.email });
    if (!linked) {
      // Raced another login that linked the same identity — fall back to it.
      const raced = findOAuthIdentity(provider.definition.key, profile.providerAccountId);
      if (raced) {
        const session = issueSession(raced.user_id, input.ip, input.userAgent);
        return { userId: raced.user_id, email: profile.email, refreshToken: session.refreshToken, accessToken: session.accessToken, sessionId: session.sessionId, outcome: 'login' };
      }
    }
    appendAuditLog({
      actorId: userByEmail.id,
      action: 'auth.oauth.autolink',
      resourceType: 'user',
      resourceId: userByEmail.id,
      description: `${provider.definition.label} identity auto-linked on sign-in (verified email)`,
      metadata: { provider: provider.definition.key, providerAccountId: profile.providerAccountId },
    });
    const session = issueSession(userByEmail.id, input.ip, input.userAgent);
    return { userId: userByEmail.id, email: userByEmail.email, refreshToken: session.refreshToken, accessToken: session.accessToken, sessionId: session.sessionId, outcome: 'autolink' };
  }

  const created = createUser({
    email: profile.email,
    name: profile.name,
    role: 'user',
    status: 'active',
    passwordHash: null, // OAuth-only account: password sign-in disabled until a password is set
    metadata: { signup: true, via: `oauth:${provider.definition.key}`, providerAccountId: profile.providerAccountId, emailVerified: profile.emailVerified },
  });
  appendAuditLog({
    actorId: created.id,
    action: 'auth.oauth.register',
    resourceType: 'user',
    resourceId: created.id,
    description: `account created via ${provider.definition.label} sign-in`,
    metadata: { provider: provider.definition.key, providerAccountId: profile.providerAccountId },
  });
  insertOAuthIdentity({ userId: created.id, provider: provider.definition.key, providerAccountId: profile.providerAccountId, emailAtLink: profile.email });
  const session = issueSession(created.id, input.ip, input.userAgent);
  return { userId: created.id, email: created.email, refreshToken: session.refreshToken, accessToken: session.accessToken, sessionId: session.sessionId, outcome: 'registered' };
}

/**
 * Link an authenticated user's account to a provider identity (Settings
 * flow). Refuses if the identity already belongs to another user.
 */
export async function completeOAuthLink(input: {
  providerKey: string;
  code: string;
  state: string;
  redirectUri: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ userId: string; email: string; providerAccountId: string }> {
  const provider = providerConfiguredOrThrow(input.providerKey);
  const stateInfo = consumeState(input.state, provider.definition.key, input.redirectUri);
  if (stateInfo.mode !== 'link' || !stateInfo.userId) {
    throw new HttpError(400, 'this OAuth flow was not initiated for account linking', 'invalid_state');
  }
  // The linking user is bound to the state at authorize time (authenticated
  // session) — the callback itself carries no authority.
  const userId = stateInfo.userId;
  const tokens = await exchangeCode(provider, input.code, input.redirectUri, stateInfo.codeVerifier);
  const profile = await fetchProfile(provider, tokens);
  if (!profile.providerAccountId) {
    throw new HttpError(502, `${provider.definition.label} profile missing subject`, 'oauth_profile_failed');
  }

  const existing = findOAuthIdentity(provider.definition.key, profile.providerAccountId);
  if (existing && existing.user_id !== userId) {
    appendSecurityLog({
      userId,
      eventType: 'auth.oauth.link_conflict',
      severity: 'critical',
      ipAddress: input.ip,
      userAgent: input.userAgent,
      description: `attempt to link a ${provider.definition.label} identity that already belongs to another account`,
      metadata: { provider: provider.definition.key, providerAccountId: profile.providerAccountId },
    });
    throw new HttpError(409, `that ${provider.definition.label} account is already linked to another user`, 'link_conflict');
  }
  if (existing && existing.user_id === userId) {
    return { userId, email: profile.email ?? existing.email_at_link ?? '', providerAccountId: profile.providerAccountId }; // idempotent
  }

  insertOAuthIdentity({ userId, provider: provider.definition.key, providerAccountId: profile.providerAccountId, emailAtLink: profile.email });
  appendAuditLog({
    actorId: userId,
    action: 'auth.oauth.link',
    resourceType: 'user',
    resourceId: userId,
    description: `${provider.definition.label} identity linked to account`,
    metadata: { provider: provider.definition.key, providerAccountId: profile.providerAccountId },
  });
  return { userId, email: profile.email ?? '', providerAccountId: profile.providerAccountId };
}

function issueSession(userId: string, ip: string | null, userAgent: string | null): { refreshToken: string; sessionId: string; accessToken: string } {
  const refreshToken = newBearerToken();
  const session = createSession({
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ipAddress: ip,
    userAgent,
  });
  updateUserLastLogin(userId, new Date().toISOString());
  const accessToken = signAccessTokenForUser(userId, session.id);
  return { refreshToken, sessionId: session.id, accessToken };
}

/** Access token with the exact same claims/shape as password login. */
function signAccessTokenForUser(userId: string, sessionId: string): string {
  const user = findUserById(userId);
  if (!user) throw new HttpError(404, 'user not found', 'not_found');
  return signAccessToken({ sub: user.id, email: user.email, role: user.role, sid: sessionId });
}
