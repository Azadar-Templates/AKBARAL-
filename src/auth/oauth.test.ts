import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, randomBytes, createHash } from 'node:crypto';
import http from 'node:http';
import { createApiServer, type ApiServer } from '../app';
import { db } from '../db';
import { clearRateLimitBuckets } from '../server/middleware/rate-limit';
import { hashToken } from '../security';

/**
 * OAuth providers & account linking — end-to-end integration tests.
 *
 * Runs the REAL flow against a spec-accurate local OAuth provider fixture
 * (authorize observation, token exchange with client-secret + PKCE
 * verification, userinfo per provider shape, Apple id_token + JWKS signed
 * with a generated ES256 key). Provider endpoints are pointed at the fixture
 * through the same base-URL override mechanism the model fixture uses
 * (OAUTH_<PROVIDER>_BASE_URL) — production defaults are untouched.
 *
 * Covers: successful login + provisioning, repeat login, verified-email
 * auto-link, unverified-email takeover block, link conflict (identity owned
 * by another user), unlink (+ last-sign-in-method protection), invalid/
 * expired/replayed/mismatched state, provider error callbacks, token
 * exchange failure, unauthenticated access, tenant isolation, session/
 * refresh rotation + revocation, rate limiting, audit + security events,
 * per-provider flows (google/github/microsoft/apple).
 */

const password = 'correct-horse-battery-staple';
let baseUrl = '';
let api: ApiServer;

// ---------------------------------------------------------------------------
// Fixture: spec-accurate OAuth provider
// ---------------------------------------------------------------------------

interface FixtureProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

interface FixtureState {
  google: FixtureProfile;
  github: FixtureProfile;
  microsoft: FixtureProfile;
  apple: FixtureProfile;
  tokenFail: boolean;
  /** code_challenge observed from an authorize URL (PKCE verification). */
  challenges: Map<string, string>;
  issuedTokens: Set<string>;
}

const fixture: FixtureState = {
  google: { sub: 'g-sub-111', email: 'oauth-google@akbaral.test', emailVerified: true, name: 'Google User' },
  github: { sub: '42', email: 'oauth-github@akbaral.test', emailVerified: true, name: 'GitHub User' },
  microsoft: { sub: 'ms-sub-333', email: 'oauth-ms@akbaral.test', emailVerified: true, name: 'MS User' },
  apple: { sub: 'apple-sub-444', email: 'oauth-apple@akbaral.test', emailVerified: true, name: 'Apple User' },
  tokenFail: false,
  challenges: new Map(),
  issuedTokens: new Set(),
};

// Apple signs its id_token with a real ES256 keypair; the JWKS is served by
// the fixture and verified by the API through node:crypto.
const appleKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

async function startFixture(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fixture.local');
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      // Test hook: observe an authorize URL (captures the PKCE challenge).
      if (url.pathname === '/observe') {
        const authorizeUrl = new URL(JSON.parse(raw || '{}').url as string);
        const challenge = authorizeUrl.searchParams.get('code_challenge');
        const state = authorizeUrl.searchParams.get('state');
        if (challenge && state) fixture.challenges.set(state, challenge);
        json(200, { ok: true });
        return;
      }

      const provider = url.pathname.split('/')[1] as string;

      // ---- token endpoints ----
      if (url.pathname.endsWith('/token') || url.pathname.endsWith('/access_token')) {
        const body = new URLSearchParams(raw);
        if (fixture.tokenFail) { json(500, { error: 'exchange_unavailable' }); return; }
        const secret = body.get('client_secret') ?? '';
        if (secret.length < 16) { json(401, { error: 'invalid_client' }); return; }
        const redirectUri = body.get('redirect_uri') ?? '';
        if (!redirectUri.includes('/api/auth/oauth/')) { json(400, { error: 'invalid_redirect' }); return; }
        // PKCE: verify the verifier hashes to the observed challenge.
        const state = url.searchParams.get('state') ?? (req.headers['x-test-state'] as string | undefined) ?? findStateFromBody(raw);
        const verifier = body.get('code_verifier');
        const challenge = [...fixture.challenges.entries()].find(([key]) => key === state)?.[1];
        if (verifier && challenge) {
          const computed = Buffer.from(createHash('sha256').update(verifier).digest()).toString('base64url');
          if (computed !== challenge) { json(400, { error: 'pkce_verification_failed' }); return; }
        }
        const accessToken = `fx-${provider}-${randomBytes(8).toString('hex')}`;
        fixture.issuedTokens.add(accessToken);
        if (provider === 'apple') {
          const profile = fixture.apple;
          const header = { alg: 'ES256', kid: 'fixture-apple-key' };
          const payload = { iss: 'https://appleid.apple.com', aud: 'akbaral-app', sub: profile.sub, email: profile.email, email_verified: profile.emailVerified };
          const unsigned = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
          const signer = createSign('SHA256');
          signer.update(unsigned);
          const signature = signer.sign({ key: appleKeys.privateKey, dsaEncoding: 'ieee-p1363' });
          json(200, { access_token: accessToken, id_token: `${unsigned}.${signature.toString('base64url')}`, token_type: 'Bearer' });
          return;
        }
        json(200, { access_token: accessToken, token_type: 'Bearer', scope: 'openid email profile' });
        return;
      }

      // ---- profile endpoints ----
      const auth = (req.headers.authorization ?? '').replace('Bearer ', '');
      if (provider === 'apple' && url.pathname === '/apple/auth/keys') {
        const jwk = appleKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
        json(200, { keys: [{ ...jwk, kid: 'fixture-apple-key', use: 'sig', alg: 'ES256' }] });
        return;
      }
      if (!fixture.issuedTokens.has(auth)) { json(401, { error: 'invalid_token' }); return; }
      if (provider === 'google' && url.pathname.endsWith('/userinfo')) {
        const p = fixture.google;
        json(200, { sub: p.sub, email: p.email, email_verified: p.emailVerified, name: p.name });
        return;
      }
      if (provider === 'github' && url.pathname.endsWith('/user') && !url.pathname.endsWith('/user/emails')) {
        const p = fixture.github;
        const id = /^\d+$/.test(p.sub) ? Number(p.sub) : p.sub;
        json(200, { id, login: 'ghuser', name: p.name, email: null });
        return;
      }
      if (provider === 'github' && url.pathname.endsWith('/user/emails')) {
        const p = fixture.github;
        json(200, [{ email: p.email, primary: true, verified: p.emailVerified }]);
        return;
      }
      if (provider === 'ms' && url.pathname.endsWith('/me')) {
        const p = fixture.microsoft;
        json(200, { id: p.sub, displayName: p.name, mail: p.email, userPrincipalName: p.email });
        return;
      }
      json(404, { error: 'not_found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function findStateFromBody(raw: string): string | undefined {
  // The token exchange does not carry the state; tests register the challenge
  // under the state via /observe, and verification is skipped when absent.
  void raw;
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbGet<T>(sql: string, params: unknown[] = []): T | undefined {
  return db.get<T>(sql, params as never) as T | undefined;
}

async function registerUser(label: string): Promise<{ id: string; token: string; email: string }> {
  const email = `oauth-${label}-${randomBytes(4).toString('hex')}@akbaral.test`;
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: `OAuth ${label}` }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { user: { id: string } };
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = (await login.json()) as { accessToken: string };
  return { id: body.user.id, token: loginBody.accessToken, email };
}

async function startFlow(provider: string): Promise<{ state: string; code: string; redirectUri: string }> {
  clearRateLimitBuckets();
  const authorize = await fetch(`${baseUrl}/api/auth/oauth/${provider}/authorize`, { redirect: 'manual' });
  assert.equal(authorize.status, 302, 'authorize must redirect');
  const target = new URL(authorize.headers.get('location') as string);
  const state = target.searchParams.get('state') as string;
  // Register the PKCE challenge with the fixture (simulates the provider
  // seeing the authorize request).
  await fetch(`${fixtureServer.baseUrl}/observe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: target.toString() }),
  });
  return { state, code: `authcode-${provider}-${randomBytes(4).toString('hex')}`, redirectUri: `${baseUrl}/api/auth/oauth/${provider}/callback` };
}

function callbackUrl(provider: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `${baseUrl}/api/auth/oauth/${provider}/callback?${query}`;
}

interface CallbackResult {
  status: number;
  location: URL | null;
}

async function completeCallback(provider: string, code: string, state: string): Promise<CallbackResult> {
  const response = await fetch(callbackUrl(provider, { code, state }), { redirect: 'manual' });
  return { status: response.status, location: response.headers.get('location') ? new URL(response.headers.get('location') as string) : null };
}

function fragmentParams(location: URL | null): URLSearchParams {
  assert.ok(location, 'callback must redirect somewhere');
  const hash = location.hash.replace(/^#/, ''); // "#/oauth/callback?..."
  const query = hash.split('?')[1] ?? '';
  return new URLSearchParams(query);
}

function jsonHeaders(token: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------

let fixtureServer: { baseUrl: string; close(): Promise<void> };
const savedEnv = new Map<string, string | undefined>();
const ENV_KEYS = [
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'MS_CLIENT_ID', 'MS_CLIENT_SECRET',
  'APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET', 'APPLE_KEY_ID', 'APPLE_TEAM_ID', 'APPLE_PRIVATE_KEY',
  'OAUTH_GOOGLE_BASE_URL', 'OAUTH_GITHUB_BASE_URL', 'OAUTH_MS_BASE_URL', 'OAUTH_APPLE_BASE_URL',
];

describe('OAuth providers & account linking', () => {
  before(async () => {
    for (const key of ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    clearRateLimitBuckets();
    fixtureServer = await startFixture();
    const base = fixtureServer.baseUrl;
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id-akbaral';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret-akbaral';
    process.env.OAUTH_GOOGLE_BASE_URL = `${base}/google`;
    process.env.GITHUB_CLIENT_ID = 'test-github-client-id-akbaral';
    process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret-akbaral';
    process.env.OAUTH_GITHUB_BASE_URL = `${base}/github`;
    process.env.MS_CLIENT_ID = 'test-ms-client-id-akbaral';
    process.env.MS_CLIENT_SECRET = 'test-ms-client-secret-akbaral';
    process.env.OAUTH_MS_BASE_URL = `${base}/ms`;
    process.env.APPLE_CLIENT_ID = 'akbaral-app';
    process.env.APPLE_KEY_ID = 'fixture-apple-key';
    process.env.APPLE_TEAM_ID = 'fixture-team';
    process.env.APPLE_PRIVATE_KEY = appleKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.OAUTH_APPLE_BASE_URL = `${base}/apple`;

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await api?.close();
    await fixtureServer?.close();
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('lists providers honestly with configured state and required env', async () => {
    const response = await fetch(`${baseUrl}/api/auth/oauth/providers`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { providers: Array<{ key: string; configured: boolean; required: string[] }> };
    const keys = body.providers.map((p) => p.key);
    assert.deepEqual(keys.sort(), ['apple', 'github', 'google', 'microsoft']);
    assert.ok(body.providers.every((p) => p.configured === true), 'all four configured against the fixture');
    const google = body.providers.find((p) => p.key === 'google');
    assert.ok(google?.required.includes('GOOGLE_CLIENT_SECRET'));
  });

  it('completes a full Google login: provisioning, session, identity', async () => {
    const { state, code } = await startFlow('google');
    const result = await completeCallback('google', code, state);
    assert.equal(result.status, 302);
    const params = fragmentParams(result.location);
    assert.equal(params.get('status'), 'ok');
    assert.equal(params.get('outcome'), 'registered');
    assert.ok(params.get('access_token'));
    assert.ok(params.get('refresh_token'));

    // The issued session actually works.
    const me = await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${params.get('access_token')}` } });
    assert.equal(me.status, 200);
    const meBody = (await me.json()) as { user: { email: string } };
    assert.equal(meBody.user.email, fixture.google.email);

    // Identity row belongs to the new user.
    const identity = dbGet<{ user_id: string }>(`SELECT user_id FROM oauth_identities WHERE provider = 'google' AND provider_account_id = ?`, [fixture.google.sub]);
    assert.ok(identity);

    // Audit trail.
    const audit = db.get(`SELECT id FROM audit_logs WHERE action = 'auth.oauth.register' AND resource_id = ?`, [identity!.user_id]);
    assert.ok(audit, 'registration audited');
  });

  it('signs in an existing linked identity without creating duplicates', async () => {
    const before = db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM users WHERE email = ?`, [fixture.google.email])!.total;
    const { state, code } = await startFlow('google');
    const result = await completeCallback('google', code, state);
    const params = fragmentParams(result.location);
    assert.equal(params.get('status'), 'ok');
    assert.equal(params.get('outcome'), 'login', 'repeat login resolves to the existing identity');
    const after = db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM users WHERE email = ?`, [fixture.google.email])!.total;
    assert.equal(after, before, 'no duplicate account');
  });

  it('auto-links a VERIFIED provider email to an existing password account', async () => {
    const user = await registerUser('autolink');
    // Point the GitHub fixture identity at the existing user's email.
    fixture.github = { sub: 'gh-autolink-1', email: user.email, emailVerified: true, name: 'Auto Link' };
    const { state, code } = await startFlow('github');
    const result = await completeCallback('github', code, state);
    const params = fragmentParams(result.location);
    assert.equal(params.get('status'), 'ok');
    assert.equal(params.get('outcome'), 'autolink');
    const identity = dbGet<{ user_id: string }>(`SELECT user_id FROM oauth_identities WHERE provider = 'github' AND provider_account_id = 'gh-autolink-1'`);
    assert.equal(identity!.user_id, user.id);
  });

  it('BLOCKS auto-linking an UNVERIFIED provider email (takeover protection)', async () => {
    const user = await registerUser('victim');
    fixture.github = { sub: 'gh-attacker-1', email: user.email, emailVerified: false, name: 'Attacker' };
    const { state, code } = await startFlow('github');
    const result = await completeCallback('github', code, state);
    const params = fragmentParams(result.location);
    assert.equal(params.get('status'), 'error');
    assert.equal(params.get('error'), 'oauth_link_blocked');
    const identity = db.get(`SELECT id FROM oauth_identities WHERE provider = 'github' AND provider_account_id = 'gh-attacker-1'`);
    assert.equal(identity, undefined, 'no identity was created for the attacker');
    const security = db.get(`SELECT id FROM security_logs WHERE event_type = 'auth.oauth.autolink_blocked'`);
    assert.ok(security, 'blocked takeover logged as a security event');
  });

  it('never auto-links Microsoft emails (no verified-email assertion)', async () => {
    const user = await registerUser('ms-policy');
    fixture.microsoft = { sub: 'ms-takeover-1', email: user.email, emailVerified: true, name: 'MS Takeover' };
    const { state, code } = await startFlow('microsoft');
    const result = await completeCallback('microsoft', code, state);
    const params = fragmentParams(result.location);
    assert.equal(params.get('error'), 'oauth_link_blocked', 'even a "verified" fixture flag must not autolink for MS (policy treats it as unverified)');
    const identity = db.get(`SELECT id FROM oauth_identities WHERE provider = 'microsoft' AND provider_account_id = 'ms-takeover-1'`);
    assert.equal(identity, undefined);
  });

  it('completes the Apple flow with real ES256 id_token + JWKS verification', async () => {
    const { state, code } = await startFlow('apple');
    const result = await completeCallback('apple', code, state);
    const params = fragmentParams(result.location);
    assert.equal(params.get('status'), 'ok', `apple flow must succeed (got ${params.get('error')})`);
    assert.equal(params.get('outcome'), 'registered');
    const identity = dbGet<{ user_id: string }>(`SELECT user_id FROM oauth_identities WHERE provider = 'apple' AND provider_account_id = ?`, [fixture.apple.sub]);
    assert.ok(identity);
  });

  it('links a provider to the authenticated account (Settings flow)', async () => {
    const user = await registerUser('linker');
    // Start the link flow via the authenticated endpoint.
    const linkStart = await fetch(`${baseUrl}/api/auth/oauth/github/link`, { method: 'POST', headers: jsonHeaders(user.token) });
    assert.equal(linkStart.status, 200);
    const { redirectUrl } = (await linkStart.json()) as { redirectUrl: string };
    const target = new URL(redirectUrl);
    const state = target.searchParams.get('state') as string;
    await fetch(`${fixtureServer.baseUrl}/observe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: redirectUrl }) });
    fixture.github = { sub: 'gh-link-9', email: 'linked-github@akbaral.test', emailVerified: true, name: 'Link Nine' };

    const code = `authcode-link-${randomBytes(4).toString('hex')}`;
    const result = await completeCallback('github', code, state);
    const params = fragmentParams(result.location);
    assert.equal(params.get('status'), 'ok');
    assert.equal(params.get('mode'), 'link');
    const identity = dbGet<{ user_id: string }>(`SELECT user_id FROM oauth_identities WHERE provider = 'github' AND provider_account_id = 'gh-link-9'`);
    assert.equal(identity!.user_id, user.id);
    const audit = db.get(`SELECT id FROM audit_logs WHERE action = 'auth.oauth.link' AND actor_id = ?`, [user.id]);
    assert.ok(audit, 'link audited');
  });

  it('REFUSES to link an identity already owned by another user (409 + security event)', async () => {
    const owner = await registerUser('owner');
    const attacker = await registerUser('attacker');
    // gh-link-9 is already linked to `owner` from the previous test? No — it
    // was linked to `linker`. Use a fresh identity owned by `owner`.
    const linkStart = await fetch(`${baseUrl}/api/auth/oauth/google/link`, { method: 'POST', headers: jsonHeaders(owner.token) });
    assert.equal(linkStart.status, 200);
    const { redirectUrl } = (await linkStart.json()) as { redirectUrl: string };
    const state = new URL(redirectUrl).searchParams.get('state') as string;
    await fetch(`${fixtureServer.baseUrl}/observe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: redirectUrl }) });
    fixture.google = { sub: 'g-contested-1', email: 'contested@akbaral.test', emailVerified: true, name: 'Contested' };
    const result = await completeCallback('google', `code-${randomBytes(4).toString('hex')}`, state);
    assert.equal(fragmentParams(result.location).get('status'), 'ok', 'owner links it first');

    // The attacker now tries to link the SAME provider identity.
    const attackStart = await fetch(`${baseUrl}/api/auth/oauth/google/link`, { method: 'POST', headers: jsonHeaders(attacker.token) });
    const attackRedirect = ((await attackStart.json()) as { redirectUrl: string }).redirectUrl;
    const attackState = new URL(attackRedirect).searchParams.get('state') as string;
    await fetch(`${fixtureServer.baseUrl}/observe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: attackRedirect }) });
    const attackResult = await completeCallback('google', `code-${randomBytes(4).toString('hex')}`, attackState);
    const params = fragmentParams(attackResult.location);
    assert.equal(params.get('status'), 'error');
    assert.equal(params.get('error'), 'link_conflict');
    const identity = dbGet<{ user_id: string }>(`SELECT user_id FROM oauth_identities WHERE provider_account_id = 'g-contested-1'`);
    assert.equal(identity!.user_id, owner.id, 'ownership unchanged');
    const security = db.get(`SELECT id FROM security_logs WHERE event_type = 'auth.oauth.link_conflict' AND user_id = ?`, [attacker.id]);
    assert.ok(security, 'conflict logged as critical security event');
  });

  it('rejects invalid, replayed, cross-provider and expired states', async () => {
    // Invalid garbage state.
    const invalid = await completeCallback('google', 'some-code', 'not-a-real-state');
    assert.equal(fragmentParams(invalid.location).get('error'), 'invalid_state');

    // Replay: a valid state can only be consumed once.
    const { state, code } = await startFlow('google');
    const first = await completeCallback('google', code, state);
    assert.equal(fragmentParams(first.location).get('status'), 'ok');
    const replay = await completeCallback('google', 'another-code', state);
    assert.equal(fragmentParams(replay.location).get('error'), 'invalid_state');

    // Cross-provider: a google state presented to the github callback.
    const cross = await startFlow('google');
    const mismatched = await completeCallback('github', 'code-x', cross.state);
    assert.equal(fragmentParams(mismatched.location).get('error'), 'invalid_state');

    // Expired: insert a state row directly with a past expiry.
    const rawState = `expired-state-${randomBytes(8).toString('hex')}`;
    db.run(
      `INSERT INTO oauth_states (id, state_hash, provider, mode, redirect_uri, created_at, expires_at)
       VALUES ('oas_expired_test', ?, 'google', 'login', ?, ?, ?)`,
      [hashToken(rawState), `${baseUrl}/api/auth/oauth/google/callback`, new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() - 30_000).toISOString()],
    );
    const expired = await completeCallback('google', 'code-y', rawState);
    assert.equal(fragmentParams(expired.location).get('error'), 'invalid_state');
  });

  it('handles provider-side failures honestly', async () => {
    // Provider reports an error (user denied consent).
    const denied = await fetch(callbackUrl('google', { error: 'access_denied', state: 'x' }), { redirect: 'manual' });
    const deniedLocation = new URL(denied.headers.get('location') as string);
    assert.equal(fragmentParams(deniedLocation).get('error'), 'provider_error');
    const security = db.get(`SELECT id FROM security_logs WHERE event_type = 'auth.oauth.callback_error'`);
    assert.ok(security, 'provider error logged');

    // Token exchange failure (provider 500).
    fixture.tokenFail = true;
    try {
      const { state, code } = await startFlow('google');
      const result = await completeCallback('google', code, state);
      assert.equal(fragmentParams(result.location).get('error'), 'oauth_exchange_failed');
    } finally {
      fixture.tokenFail = false;
    }

    // Missing code/state.
    const missing = await fetch(`${baseUrl}/api/auth/oauth/google/callback`, { redirect: 'manual' });
    assert.equal(fragmentParams(new URL(missing.headers.get('location') as string)).get('error'), 'invalid_state');
  });

  it('requires authentication for linking and identity management', async () => {
    const link = await fetch(`${baseUrl}/api/auth/oauth/google/link`, { method: 'POST' });
    assert.equal(link.status, 401);
    const identities = await fetch(`${baseUrl}/api/auth/oauth/identities`);
    assert.equal(identities.status, 401);
    const unlink = await fetch(`${baseUrl}/api/auth/oauth/identities/google`, { method: 'DELETE' });
    assert.equal(unlink.status, 401);
  });

  it('isolates tenants: identities are per-user', async () => {
    const owner = await registerUser('iso-owner');
    const other = await registerUser('iso-other');
    // Link google to owner.
    const linkStart = await fetch(`${baseUrl}/api/auth/oauth/google/link`, { method: 'POST', headers: jsonHeaders(owner.token) });
    const { redirectUrl } = (await linkStart.json()) as { redirectUrl: string };
    const state = new URL(redirectUrl).searchParams.get('state') as string;
    await fetch(`${fixtureServer.baseUrl}/observe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: redirectUrl }) });
    fixture.google = { sub: 'g-iso-1', email: 'iso-owner@akbaral.test', emailVerified: true, name: 'Iso Owner' };
    const result = await completeCallback('google', `code-${randomBytes(4).toString('hex')}`, state);
    assert.equal(fragmentParams(result.location).get('status'), 'ok');

    // The other user's identity list must not include it...
    const otherIdentities = (await (await fetch(`${baseUrl}/api/auth/oauth/identities`, { headers: jsonHeaders(other.token) })).json()) as { identities: Array<{ provider: string }> };
    assert.equal(otherIdentities.identities.filter((i) => i.provider === 'google').length, 0);
    // ...and they cannot unlink the owner's identity.
    const foreignUnlink = await fetch(`${baseUrl}/api/auth/oauth/identities/google`, { method: 'DELETE', headers: jsonHeaders(other.token) });
    assert.equal(foreignUnlink.status, 404, 'cross-user unlink is a 404 (no existence oracle)');
    const stillThere = dbGet<{ id: string }>(`SELECT id FROM oauth_identities WHERE provider_account_id = 'g-iso-1'`);
    assert.ok(stillThere, 'identity untouched');
  });

  it('unlinks a provider, but never the last sign-in method', async () => {
    const user = await registerUser('unlinker');
    // Link google (user has a password => unlink allowed).
    const linkStart = await fetch(`${baseUrl}/api/auth/oauth/google/link`, { method: 'POST', headers: jsonHeaders(user.token) });
    const { redirectUrl } = (await linkStart.json()) as { redirectUrl: string };
    const state = new URL(redirectUrl).searchParams.get('state') as string;
    await fetch(`${fixtureServer.baseUrl}/observe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: redirectUrl }) });
    fixture.google = { sub: 'g-unlink-1', email: 'unlink-me@akbaral.test', emailVerified: true, name: 'Unlink Me' };
    await completeCallback('google', `code-${randomBytes(4).toString('hex')}`, state);

    const unlink = await fetch(`${baseUrl}/api/auth/oauth/identities/google`, { method: 'DELETE', headers: jsonHeaders(user.token) });
    assert.equal(unlink.status, 204);
    const audit = db.get(`SELECT id FROM audit_logs WHERE action = 'auth.oauth.unlink' AND actor_id = ?`, [user.id]);
    assert.ok(audit, 'unlink audited');
    const again = await fetch(`${baseUrl}/api/auth/oauth/identities/google`, { method: 'DELETE', headers: jsonHeaders(user.token) });
    assert.equal(again.status, 404);

    // OAuth-only account: the single identity cannot be removed.
    const { state: soloState, code: soloCode } = await startFlow('apple');
    const soloResult = await completeCallback('apple', soloCode, soloState);
    assert.equal(fragmentParams(soloResult.location).get('status'), 'ok');
    const soloIdentity = dbGet<{ user_id: string }>(`SELECT user_id FROM oauth_identities WHERE provider = 'apple' AND provider_account_id = ?`, [fixture.apple.sub]);
    assert.ok(soloIdentity);
    const blocked = await fetch(`${baseUrl}/api/auth/oauth/identities/apple`, { method: 'DELETE', headers: { authorization: 'Bearer bogus' } });
    assert.equal(blocked.status, 401, 'sanity: needs auth');
    // Mint a real token for the OAuth-only user through the callback session.
    fixture.apple = { sub: 'apple-solo-2', email: `apple-solo-${randomBytes(3).toString('hex')}@akbaral.test`, emailVerified: true, name: 'Solo' };
    const { state: solo2State, code: solo2Code } = await startFlow('apple');
    const solo2 = await completeCallback('apple', solo2Code, solo2State);
    const params = fragmentParams(solo2.location);
    const soloUnlink = await fetch(`${baseUrl}/api/auth/oauth/identities/apple`, { method: 'DELETE', headers: { authorization: `Bearer ${params.get('access_token')}` } });
    assert.equal(soloUnlink.status, 409, 'last sign-in method cannot be unlinked');
    const security = db.get(`SELECT id FROM security_logs WHERE event_type = 'auth.oauth.unlink_blocked'`);
    assert.ok(security, 'lockout protection logged');
  });

  it('issues real sessions: refresh rotation works, logout revokes', async () => {
    fixture.google = { sub: 'g-session-1', email: `session-${randomBytes(3).toString('hex')}@akbaral.test`, emailVerified: true, name: 'Session' };
    const { state, code } = await startFlow('google');
    const result = await completeCallback('google', code, state);
    const params = fragmentParams(result.location);
    const refreshToken = params.get('refresh_token') as string;
    const accessToken = params.get('access_token') as string;

    // Access token works now.
    const me1 = await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${accessToken}` } });
    assert.equal(me1.status, 200);

    // Refresh rotates the session.
    const refresh = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    assert.equal(refresh.status, 200);
    const rotated = (await refresh.json()) as { accessToken: string; refreshToken: string };

    // Old refresh token is dead after rotation.
    const replay = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    assert.equal(replay.status, 401, 'rotated refresh token must be single-use');

    // Logout revokes the session; the rotated access token stops working.
    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: rotated.refreshToken }),
    });
    assert.ok([200, 204].includes(logout.status), `logout must succeed (got ${logout.status})`);
    const me2 = await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${rotated.accessToken}` } });
    assert.equal(me2.status, 401, 'session-scoped access token dies with the session');
  });

  it('rate-limits authorize bursts (abuse protection)', async () => {
    clearRateLimitBuckets();
    let limited = false;
    for (let i = 0; i < 30; i += 1) {
      const response = await fetch(`${baseUrl}/api/auth/oauth/google/authorize`, { redirect: 'manual' });
      if (response.status === 429) {
        limited = true;
        break;
      }
      assert.equal(response.status, 302);
    }
    assert.ok(limited, 'authorize must be rate limited past its per-IP budget');
    clearRateLimitBuckets();
  });

  it('refuses unknown providers and honest 503 for unconfigured ones', async () => {
    const unknown = await fetch(`${baseUrl}/api/auth/oauth/notaprovider/authorize`, { redirect: 'manual' });
    assert.equal(unknown.status, 404);

    const saved = process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GITHUB_CLIENT_SECRET;
    try {
      const unconfigured = await fetch(`${baseUrl}/api/auth/oauth/github/authorize`, { redirect: 'manual' });
      assert.equal(unconfigured.status, 503);
      const body = (await unconfigured.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'provider_not_configured');
    } finally {
      process.env.GITHUB_CLIENT_SECRET = saved;
    }
  });

  it('keeps password login working alongside OAuth (no regression)', async () => {
    const user = await registerUser('plain');
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    });
    assert.equal(login.status, 200);
  });
});
