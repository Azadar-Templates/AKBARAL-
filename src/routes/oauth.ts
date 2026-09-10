import { Router } from 'express';
import { HttpError, asyncRoute } from '../server/http';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { rateLimit } from '../server/middleware/rate-limit';
import { appendAuditLog, appendSecurityLog, findUserById } from '../db';
import { deleteOAuthIdentity, listOAuthIdentitiesByUser, peekOAuthState } from '../db/oauth-repositories';
import { hashToken } from '../security';
import { completeOAuthLink, completeOAuthLogin, isProviderConfigured, issueAuthorization, listOAuthProviders, providerConfiguredOrThrow } from '../auth/oauth';
import type { OAuthProviderKey } from '../db/oauth-repositories';
import { env } from '../config/env';

/**
 * OAuth routes (mounted at /api/auth/oauth).
 *
 * Flow: SPA sends the user agent to /:provider/authorize (same-origin, so
 * the existing session cookie-less Bearer model still applies — for the
 * link flow the SPA passes its access token in the fragment-free query
 * `?link=1&token=` which is exchanged for the authenticated user BEFORE any
 * redirect; the token itself is never forwarded to the provider).
 *
 * The callback redirects back to the web app with credentials in the URL
 * FRAGMENT (never the query): fragments are not sent to servers and stay out
 * of server logs, matching this SPA's localStorage token model.
 *
 * Abuse protection: strict rate limits on authorize/callback (these routes
 * are reachable without a session) on top of the global API limiter.
 */

const CALLBACK_ERROR_CODES = new Set([
  'invalid_state',
  'oauth_exchange_failed',
  'oauth_profile_failed',
  'oauth_link_blocked',
  'link_conflict',
  'oauth_email_missing',
  'provider_not_configured',
]);

function webCallbackUrl(params: Record<string, string>): string {
  const base = env.publicWebUrl.replace(/\/$/, '');
  const fragment = new URLSearchParams(params).toString();
  return `${base}/#/oauth/callback?${fragment}`;
}

function requestOrigin(req: AuthenticatedRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol ?? 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? `localhost:${env.port}`;
  return `${proto}://${host}`;
}

function callbackUriFor(req: AuthenticatedRequest, providerKey: string): string {
  return `${requestOrigin(req)}/api/auth/oauth/${providerKey}/callback`;
}

export function createOAuthRouter(): Router {
  const router = Router();

  // Honest provider listing (public): configured + required env names.
  router.get('/providers', (_req, res) => {
    res.status(200).json({ providers: listOAuthProviders() });
  });

  // Start a SIGN-IN flow (public): 302 to the provider consent screen.
  router.get(
    '/:provider/authorize',
    rateLimit({ prefix: 'oauth-authorize', max: 20, windowMs: 60_000 }),
    (req: AuthenticatedRequest, res) => {
      const providerKey = req.params.provider;
      providerConfiguredOrThrow(providerKey); // 503 when unconfigured
      const redirectUri = callbackUriFor(req, providerKey);
      const { redirectUrl } = issueAuthorization({ providerKey, redirectUri, mode: 'login', userId: null, ip: req.ip ?? null });
      res.status(302).redirect(redirectUrl);
    },
  );

  // Start a LINK flow (authenticated): returns the provider consent URL as
  // JSON — the SPA navigates to it. The state row binds the link to this
  // user; the callback carries no authority of its own.
  router.post(
    '/:provider/link',
    requireAuth,
    rateLimit({ prefix: 'oauth-link', max: 10, windowMs: 60_000 }),
    (req: AuthenticatedRequest, res) => {
      const providerKey = req.params.provider;
      const provider = providerConfiguredOrThrow(providerKey);
      const redirectUri = callbackUriFor(req, providerKey);
      const { redirectUrl } = issueAuthorization({ providerKey, redirectUri, mode: 'link', userId: req.auth!.userId, ip: req.ip ?? null });
      appendSecurityLog({
        userId: req.auth!.userId,
        eventType: 'auth.oauth.link_started',
        severity: 'info',
        ipAddress: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
        description: `started linking ${provider.definition.label} to the account`,
        metadata: { provider: provider.definition.key },
      });
      res.status(200).json({ redirectUrl });
    },
  );

  // Provider callback (GET for google/github/microsoft; Apple posts form data).
  const callback = asyncRoute(async (req: AuthenticatedRequest, res) => {
    const providerKey = req.params.provider;
    const provider = providerConfiguredOrThrow(providerKey);
    const redirectUri = callbackUriFor(req, providerKey);

    // Provider-reported failure (user denied consent, provider error).
    const providerError = (req.query.error ?? req.body?.error) as string | undefined;
    if (providerError) {
      appendSecurityLog({
        eventType: 'auth.oauth.callback_error',
        severity: 'warning',
        ipAddress: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
        description: `OAuth callback received an error from the provider: ${String(providerError).slice(0, 120)}`,
        metadata: { provider: provider.definition.key },
      });
      res.status(302).redirect(webCallbackUrl({ status: 'error', error: 'provider_error', provider: provider.definition.key }));
      return;
    }

    const code = (req.query.code ?? req.body?.code) as string | undefined;
    const state = (req.query.state ?? req.body?.state) as string | undefined;
    if (!code || !state) {
      res.status(302).redirect(webCallbackUrl({ status: 'error', error: 'invalid_state', provider: provider.definition.key }));
      return;
    }

    try {
      // Peek at the state (read-only) to branch link vs login mode; the
      // authoritative single-use consumption happens inside the completers.
      const stateRow = peekOAuthState(hashToken(state));
      if (stateRow && stateRow.mode === 'link') {
        await completeOAuthLink({
          providerKey,
          code,
          state,
          redirectUri,
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        });
        res.status(302).redirect(webCallbackUrl({ status: 'ok', provider: provider.definition.key, mode: 'link' }));
        return;
      }

      const result = await completeOAuthLogin({
        providerKey,
        code,
        state,
        redirectUri,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      res
        .status(302)
        .redirect(
          webCallbackUrl({
            status: 'ok',
            provider: provider.definition.key,
            mode: 'login',
            outcome: result.outcome,
            access_token: result.accessToken,
            refresh_token: result.refreshToken,
          }),
        );
    } catch (error) {
      if (error instanceof HttpError && CALLBACK_ERROR_CODES.has(error.code)) {
        appendSecurityLog({
          eventType: 'auth.oauth.login_failed',
          severity: error.code === 'invalid_state' ? 'warning' : 'info',
          ipAddress: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
          description: `OAuth sign-in failed: ${error.message}`,
          metadata: { provider: provider.definition.key, code: error.code },
        });
        res.status(302).redirect(webCallbackUrl({ status: 'error', error: error.code, provider: provider.definition.key }));
        return;
      }
      throw error;
    }
  });

  router.get('/:provider/callback', rateLimit({ prefix: 'oauth-callback', max: 30, windowMs: 60_000 }), callback);
  router.post('/:provider/callback', rateLimit({ prefix: 'oauth-callback', max: 30, windowMs: 60_000 }), callback); // Apple form_post

  // ---- Authenticated account-linking management ----

  router.get('/identities', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = listOAuthIdentitiesByUser(req.auth!.userId);
    const user = findUserById(req.auth!.userId);
    res.status(200).json({
      identities: rows.map((row) => ({ provider: row.provider, linkedAt: row.created_at, emailAtLink: row.email_at_link })),
      providers: listOAuthProviders(),
      passwordSet: Boolean(user?.password_hash),
    });
  });

  router.delete(
    '/identities/:provider',
    requireAuth,
    rateLimit({ prefix: 'oauth-unlink', max: 10, windowMs: 60_000 }),
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const providerKey = req.params.provider as OAuthProviderKey;
      if (!isProviderConfigured(providerKey)) {
        // Unlinking is still allowed for identities of providers that were
        // configured in the past but are not anymore; only validate the key.
        if (!['google', 'github', 'microsoft', 'apple'].includes(providerKey)) {
          throw new HttpError(404, 'unknown OAuth provider', 'not_found');
        }
      }
      const user = findUserById(req.auth!.userId);
      if (!user) throw new HttpError(404, 'user not found', 'not_found');

      const identities = listOAuthIdentitiesByUser(req.auth!.userId);
      const target = identities.find((row) => row.provider === providerKey);
      if (!target) {
        throw new HttpError(404, 'that provider is not linked to your account', 'not_found');
      }
      // Lockout protection: the last sign-in method cannot be removed.
      if (!user.password_hash && identities.length === 1) {
        appendSecurityLog({
          userId: req.auth!.userId,
          eventType: 'auth.oauth.unlink_blocked',
          severity: 'warning',
          ipAddress: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
          description: 'unlink refused: it is the only sign-in method for this account',
          metadata: { provider: providerKey },
        });
        throw new HttpError(409, 'cannot unlink the only sign-in method — set a password first', 'unlink_blocked');
      }

      deleteOAuthIdentity(req.auth!.userId, providerKey);
      appendAuditLog({
        actorId: req.auth!.userId,
        action: 'auth.oauth.unlink',
        resourceType: 'user',
        resourceId: req.auth!.userId,
        description: `${providerKey} identity unlinked from account`,
        metadata: { provider: providerKey },
      });
      res.status(204).send();
    }),
  );

  return router;
}
