import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Social publishing connections (ZA141251SA mission).
 *
 * These tests exercise the COMPLETE OAuth contract against a local fixture that
 * speaks the same authorization-code protocol as the real platforms — and they
 * verify, just as importantly, the honest-failure paths:
 *
 *   · an unregistered app refuses with provider_not_configured and names the
 *     exact variables and redirect URI the owner must supply;
 *   · a state that is replayed, expired or belongs to another platform is
 *     rejected (single-use CSRF protection);
 *   · a provider that rejects the code produces no connection and no token;
 *   · a network failure is reported as unreachable, never as success;
 *   · on success the token is stored ENCRYPTED in the vault and is never
 *     returned by any read surface (only a masked hint plus expiry);
 *   · engagement is never synthesized: the API only reports what it knows.
 */

const VAULT_KEY = 'mission-social-test-credential-key-32+';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-social-'));
const dbPath = path.join(tempRoot, 'social.db');

interface Fixture {
  url: string;
  close(): Promise<void>;
  requests: Array<{ path: string; body: Record<string, string> }>;
  /** When set, the token endpoint answers with this status/body instead. */
  failWith: { status: number; body: Record<string, unknown> } | null;
  offline: boolean;
}

async function startPlatformFixture(): Promise<Fixture> {
  const state: Fixture = {
    url: '',
    requests: [],
    failWith: null,
    offline: false,
    close: () => Promise.resolve(),
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;
      state.requests.push({ path: req.url ?? '/', body });
      if (state.offline) {
        req.socket.destroy();
        return;
      }
      if (req.url === '/token') {
        if (state.failWith) {
          res.writeHead(state.failWith.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(state.failWith.body));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'fixture-access-token-value',
            refresh_token: 'fixture-refresh-token-value',
            expires_in: 3600,
            scope: 'video.publish video.list',
            open_id: 'fixture-account',
          }),
        );
        return;
      }
      if (req.url === '/revoke') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"revoked":true}');
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  state.url = `http://127.0.0.1:${port}`;
  state.close = () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return state;
}

describe('mission social publishing connections', () => {
  const saved = new Map<string, string | undefined>();
  let fixture: Fixture;
  let mission: typeof import('./database');
  let social: typeof import('./social');
  let auth: typeof import('./auth');
  let ownerId = '';

  before(async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SOCIAL_') || key.startsWith('ZA141251SA_') || key.startsWith('TIKTOK_') || key.startsWith('YOUTUBE_') || key.startsWith('INSTAGRAM_')) {
        saved.set(key, process.env[key]);
        delete process.env[key];
      }
    }
    process.env.ZA141251SA_DATABASE_URL = `file:${dbPath}`;
    process.env.ZA141251SA_CREDENTIAL_KEY = VAULT_KEY;
    process.env.ZA141251SA_SESSION_SECRET = 'mission-social-test-session-secret-32-chars';
    process.env.ZA141251SA_SITE_URL = 'https://mission.example.test';

    fixture = await startPlatformFixture();
    process.env.TIKTOK_CLIENT_KEY = 'fixture-client-key';
    process.env.TIKTOK_CLIENT_SECRET = 'fixture-client-secret';
    process.env.SOCIAL_TIKTOK_TOKEN_URL = `${fixture.url}/token`;
    process.env.SOCIAL_TIKTOK_AUTHORIZE_URL = `${fixture.url}/authorize`;
    process.env.SOCIAL_TIKTOK_REVOKE_URL = `${fixture.url}/revoke`;

    mission = await import('./database');
    auth = await import('./auth');
    social = await import('./social');
    mission.applyMissionMigrations();
    const owner = auth.provisionOwner({
      email: 'owner@mission.test',
      password: 'a-very-long-owner-password',
      displayName: 'Mission Owner',
    });
    ownerId = owner.id;
  });

  after(async () => {
    await fixture.close();
    mission.missionDb.close();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    fixture.failWith = null;
    fixture.offline = false;
    fixture.requests.length = 0;
  });

  it('reports every platform honestly before any app is registered', () => {
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
    const statuses = social.socialPlatformStatuses('https://mission.example.test');
    assert.equal(statuses.length, 3);
    for (const status of statuses) {
      assert.equal(status.appConfigured, false);
      assert.equal(status.connected, false, 'nothing is ever reported connected without a real token');
      assert.equal(status.status, 'not_configured');
      assert.ok(status.redirectUri.endsWith(`/api/social/oauth/${status.id}/callback`));
      assert.ok(status.requiredEnvKeys.length >= 2);
      assert.ok(status.consoleUrl.startsWith('https://'));
      assert.ok(status.scopes.length > 0, 'the minimum publishing scopes are declared');
    }
    process.env.TIKTOK_CLIENT_KEY = 'fixture-client-key';
    process.env.TIKTOK_CLIENT_SECRET = 'fixture-client-secret';
  });

  it('refuses to start an authorization for an unregistered platform, naming the variables', () => {
    delete process.env.TIKTOK_CLIENT_KEY;
    assert.throws(
      () => social.beginSocialAuthorization({ platform: 'tiktok', ownerId, siteUrl: 'https://mission.example.test' }),
      (error: unknown) => {
        const typed = error as { code?: string; message?: string; status?: number; statusCode?: number };
        assert.equal(typed.code, 'provider_not_configured');
        assert.equal(typed.statusCode ?? typed.status, 503);
        assert.match(String(typed.message), /TIKTOK_CLIENT_KEY/);
        assert.match(String(typed.message), /TIKTOK_CLIENT_SECRET/);
        return true;
      },
    );
    process.env.TIKTOK_CLIENT_KEY = 'fixture-client-key';
  });

  it('completes a real authorization-code exchange and stores the token encrypted', async () => {
    const authorization = social.beginSocialAuthorization({ platform: 'tiktok', ownerId, siteUrl: 'https://mission.example.test' });
    assert.ok(authorization.authorizeUrl.startsWith(`${fixture.url}/authorize`));
    const url = new URL(authorization.authorizeUrl);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), 'fixture-client-key');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://mission.example.test/api/social/oauth/tiktok/callback');
    assert.match(String(url.searchParams.get('scope')), /video\.publish/);
    assert.ok(url.searchParams.get('code_challenge'), 'PKCE challenge is sent for platforms that support it');
    const state = url.searchParams.get('state') as string;

    const connection = await social.completeSocialAuthorization({
      platform: 'tiktok',
      code: 'fixture-authorization-code',
      state,
      ownerId,
      siteUrl: 'https://mission.example.test',
    });
    assert.equal(connection.platform, 'tiktok');
    assert.equal(connection.accountLabel, 'fixture-account');
    assert.equal(connection.accessEnvVar, 'TIKTOK_ACCESS_TOKEN');
    assert.deepEqual(connection.scopes, ['video.publish', 'video.list']);
    assert.ok(!JSON.stringify(connection).includes('fixture-access-token-value'), 'the token is never returned');

    // The exchange really happened, with the right parameters.
    const tokenRequest = fixture.requests.find((entry) => entry.path === '/token');
    assert.ok(tokenRequest, 'the token endpoint was called');
    assert.equal(tokenRequest!.body.grant_type, 'authorization_code');
    assert.equal(tokenRequest!.body.code, 'fixture-authorization-code');
    assert.equal(tokenRequest!.body.client_key, 'fixture-client-key', 'TikTok receives client_key in the body');
    assert.ok(tokenRequest!.body.code_verifier, 'the PKCE verifier is sent back');

    // The plaintext lives encrypted in the vault; the public surface shows a hint only.
    const stored = mission.missionDb.get<{ ciphertext: string; masked_hint: string; env_var: string; status: string }>(
      'SELECT ciphertext, masked_hint, env_var, status FROM mission_credentials WHERE id = ?',
      [connection.credentialId],
    );
    assert.ok(stored);
    assert.equal(stored!.env_var, 'TIKTOK_ACCESS_TOKEN');
    assert.notEqual(stored!.ciphertext, 'fixture-access-token-value');
    assert.ok(!stored!.ciphertext.includes('fixture-access-token-value'));
    assert.equal(stored!.masked_hint, '…alue');
    const credentials = mission.missionDb.all<{ provider: string; env_var: string | null }>('SELECT provider, env_var FROM mission_credentials');
    assert.ok(credentials.some((row) => row.provider === 'tiktok:refresh'), 'the refresh token is stored separately');

    // Status now reports a genuine connection.
    const status = social.socialPlatformStatuses('https://mission.example.test').find((entry) => entry.id === 'tiktok')!;
    assert.equal(status.connected, true);
    assert.equal(status.status, 'connected');
    assert.ok(status.expiresAt, 'a real expiry is recorded');
    assert.equal(status.lastError, null);
    assert.ok(status.daysUntilExpiry !== null && status.daysUntilExpiry >= 0);

    // In-process access exists for provider calls; the audit trail records the connection.
    const token = social.socialAccessToken('tiktok');
    assert.equal(token?.token, 'fixture-access-token-value');
    const audit = mission.missionDb.all<{ action: string; detail: string }>(`SELECT action, detail FROM mission_audit WHERE action LIKE 'social.%'`);
    const connectedAudit = audit.find((row) => row.action === 'social.connected');
    assert.ok(connectedAudit, 'the connection is audited');
    assert.ok(!String(connectedAudit!.detail).includes('fixture-access-token-value'), 'the audit never contains the token');
    assert.ok(mission.verifyMissionAudit().ok, 'the audit chain still verifies');
  });

  it('rejects a replayed state (single-use) and a state bound to another platform', async () => {
    const authorization = social.beginSocialAuthorization({ platform: 'tiktok', ownerId, siteUrl: 'https://mission.example.test' });
    const state = new URL(authorization.authorizeUrl).searchParams.get('state') as string;
    await social.completeSocialAuthorization({ platform: 'tiktok', code: 'code-1', state, ownerId, siteUrl: 'https://mission.example.test' });
    await assert.rejects(
      social.completeSocialAuthorization({ platform: 'tiktok', code: 'code-2', state, ownerId, siteUrl: 'https://mission.example.test' }),
      (error: unknown) => (error as { code?: string }).code === 'invalid_state',
      'the same state can never be used twice',
    );

    const youtubeState = social.beginSocialAuthorization({ platform: 'tiktok', ownerId, siteUrl: 'https://mission.example.test' });
    const foreignState = new URL(youtubeState.authorizeUrl).searchParams.get('state') as string;
    await assert.rejects(
      social.completeSocialAuthorization({ platform: 'youtube', code: 'code-3', state: foreignState, ownerId, siteUrl: 'https://mission.example.test' }),
      (error: unknown) => (error as { code?: string }).code === 'invalid_state',
    );
  });

  it('rejects an expired state', async () => {
    const authorization = social.beginSocialAuthorization({ platform: 'tiktok', ownerId, siteUrl: 'https://mission.example.test' });
    const state = new URL(authorization.authorizeUrl).searchParams.get('state') as string;
    const hash = crypto.createHash('sha256').update(state).digest('hex');
    mission.missionDb.run('UPDATE social_oauth_states SET expires_at = ? WHERE state_hash = ?', [new Date(Date.now() - 60_000).toISOString(), hash]);
    await assert.rejects(
      social.completeSocialAuthorization({ platform: 'tiktok', code: 'code-late', state, ownerId, siteUrl: 'https://mission.example.test' }),
      (error: unknown) => (error as { code?: string }).code === 'invalid_state',
    );
  });

  it('creates no connection when the provider rejects the code or the network fails', async () => {
    const before = social.socialPlatformStatuses('https://mission.example.test').find((entry) => entry.id === 'tiktok')!;
    fixture.failWith = { status: 400, body: { error: 'invalid_grant', error_description: 'authorization code expired' } };
    const rejected = social.beginSocialAuthorization({ platform: 'tiktok', ownerId, siteUrl: 'https://mission.example.test' });
    await assert.rejects(
      social.completeSocialAuthorization({
        platform: 'tiktok',
        code: 'stale-code',
        state: new URL(rejected.authorizeUrl).searchParams.get('state') as string,
        ownerId,
        siteUrl: 'https://mission.example.test',
      }),
      (error: unknown) => {
        const typed = error as { code?: string; message?: string; status?: number; statusCode?: number };
        assert.equal(typed.code, 'provider_rejected');
        assert.equal(typed.statusCode ?? typed.status, 502);
        assert.match(String(typed.message), /invalid_grant/);
        return true;
      },
    );
    fixture.failWith = null;

    fixture.offline = true;
    const unreachable = social.beginSocialAuthorization({ platform: 'tiktok', ownerId, siteUrl: 'https://mission.example.test' });
    await assert.rejects(
      social.completeSocialAuthorization({
        platform: 'tiktok',
        code: 'code-x',
        state: new URL(unreachable.authorizeUrl).searchParams.get('state') as string,
        ownerId,
        siteUrl: 'https://mission.example.test',
      }),
      (error: unknown) => (error as { code?: string }).code === 'provider_unreachable',
    );
    fixture.offline = false;

    const after = social.socialPlatformStatuses('https://mission.example.test').find((entry) => entry.id === 'tiktok')!;
    assert.equal(after.credentialId, before.credentialId, 'a failed exchange never replaces a working connection');
    assert.equal(after.connected, true);
    assert.ok(mission.verifyMissionAudit().ok);
  });

  it('refuses to store a token when the vault is not configured', async () => {
    const savedKey = process.env.ZA141251SA_CREDENTIAL_KEY;
    delete process.env.ZA141251SA_CREDENTIAL_KEY;
    const authorization = social.beginSocialAuthorization({ platform: 'tiktok', ownerId, siteUrl: 'https://mission.example.test' });
    await assert.rejects(
      social.completeSocialAuthorization({
        platform: 'tiktok',
        code: 'code-vault',
        state: new URL(authorization.authorizeUrl).searchParams.get('state') as string,
        ownerId,
        siteUrl: 'https://mission.example.test',
      }),
      (error: unknown) => (error as { code?: string }).code === 'vault_not_configured',
      'a token is never stored unencrypted — the flow refuses instead',
    );
    process.env.ZA141251SA_CREDENTIAL_KEY = savedKey;
  });

  it('disconnects a platform: revokes the credential and asks the provider to revoke', async () => {
    const before = social.socialPlatformStatuses('https://mission.example.test').find((entry) => entry.id === 'tiktok')!;
    assert.equal(before.connected, true);
    const result = await social.disconnectSocial({ platform: 'tiktok', ownerId, reason: 'owner test disconnect' });
    assert.equal(result.status, 'disconnected');
    assert.equal(result.credentialRevoked, true);
    assert.equal(result.providerRevoked, true);
    assert.equal(result.providerRevokeResult, 'HTTP 200');
    assert.ok(fixture.requests.some((entry) => entry.path === '/revoke'), 'the provider was asked to invalidate remote access');

    const after = social.socialPlatformStatuses('https://mission.example.test').find((entry) => entry.id === 'tiktok')!;
    assert.equal(after.connected, false);
    assert.equal(after.status, 'disconnected');
    assert.equal(after.credentialId, null);
    assert.equal(social.socialAccessToken('tiktok'), null, 'no token is available after disconnection');
    const credential = mission.missionDb.get<{ status: string }>('SELECT status FROM mission_credentials WHERE id = ?', [before.credentialId!]);
    assert.equal(credential?.status, 'revoked');
    assert.ok(mission.verifyMissionAudit().ok);

    await assert.rejects(
      social.disconnectSocial({ platform: 'tiktok', ownerId }),
      (error: unknown) => {
        const typed = error as { status?: number; statusCode?: number };
        return (typed.status ?? typed.statusCode) === 404;
      },
      'disconnecting an unconnected platform is an honest 404',
    );
  });

  it('rotates the credential instead of accumulating rows when reconnecting', async () => {
    const first = social.beginSocialAuthorization({ platform: 'tiktok', ownerId, siteUrl: 'https://mission.example.test' });
    await social.completeSocialAuthorization({
      platform: 'tiktok',
      code: 'code-a',
      state: new URL(first.authorizeUrl).searchParams.get('state') as string,
      ownerId,
      siteUrl: 'https://mission.example.test',
    });
    const second = social.beginSocialAuthorization({ platform: 'tiktok', ownerId, siteUrl: 'https://mission.example.test' });
    const connection = await social.completeSocialAuthorization({
      platform: 'tiktok',
      code: 'code-b',
      state: new URL(second.authorizeUrl).searchParams.get('state') as string,
      ownerId,
      siteUrl: 'https://mission.example.test',
    });
    const rows = mission.missionDb.all<{ id: string; status: string }>(`SELECT id, status FROM mission_credentials WHERE provider = 'tiktok'`);
    const active = rows.filter((row) => row.status === 'active');
    assert.equal(active.length, 1, 'exactly one active publishing credential exists');
    assert.equal(active[0].id, connection.credentialId);
    assert.equal(mission.missionDb.all(`SELECT id FROM social_connections WHERE platform = 'tiktok'`).length, 1, 'one connection row per platform');
    assert.ok(mission.verifyMissionAudit().ok);
  });
});
