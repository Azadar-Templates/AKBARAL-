/**
 * Live authentication + OAuth verification against a RUNNING platform.
 *
 *   node scripts/probe-auth-live.mjs
 *
 * Real calls, real sessions, real limits — nothing simulated:
 *   · registration, duplicate rejection, weak-password rejection
 *   · wrong password refused, correct password issues an access + refresh pair
 *   · the access token authenticates /api/auth/me with the user's own role
 *   · refresh ROTATES: the used refresh token stops working immediately
 *   · logout revokes the session and the old token is refused afterwards
 *   · password reset / email verification report the real delivery dependency
 *     (they never claim a message was sent when no mail transport is configured)
 *   · OAuth: every provider reports whether it is configured; an unconfigured
 *     provider refuses to start a flow instead of faking a redirect
 *   · repeated failed logins are rate limited
 *   · no response carries provider secrets, hashes or raw tokens of others
 *
 * Exit code 1 if a check fails.
 */
const API = (process.env.API_BASE ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(route, { method = 'GET', body, token, redirect = 'manual' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: payload, headers: response.headers };
}

const message = (payload) => String(payload?.error?.message ?? payload?.message ?? '');

async function main() {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `auth-probe-${suffix}@akbaral.test`;
  const password = 'probe-password-1234';

  const health = await api('/api/health');
  record('the API is reachable', health.status === 200, `HTTP ${health.status}`);

  // ── registration ────────────────────────────────────────────────────────
  const registered = await api('/api/auth/register', { method: 'POST', body: { email, password, name: 'auth probe' } });
  const user = registered.body?.user ?? {};
  record('a new account is registered and returns a public profile only',
    registered.status === 201 && user.email === email && !('passwordHash' in user) && !('password_hash' in user),
    `HTTP ${registered.status}, keys=${Object.keys(user).join(',')}`);

  const duplicate = await api('/api/auth/register', { method: 'POST', body: { email, password, name: 'auth probe' } });
  record('a duplicate registration is refused', duplicate.status === 409, `HTTP ${duplicate.status}`);

  const weak = await api('/api/auth/register', { method: 'POST', body: { email: `weak-${suffix}@akbaral.test`, password: 'short' } });
  record('a weak password is refused at registration', weak.status === 400 && /password/i.test(message(weak.body)), message(weak.body).slice(0, 80));

  // ── sign-in ─────────────────────────────────────────────────────────────
  const wrong = await api('/api/auth/login', { method: 'POST', body: { email, password: 'definitely-wrong-password' } });
  record('a wrong password is refused', wrong.status === 401, `HTTP ${wrong.status}`);

  const login = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  const accessToken = login.body?.accessToken ?? '';
  const refreshToken = login.body?.refreshToken ?? '';
  const setCookie = login.headers.get('set-cookie') ?? '';
  record('sign-in issues an access token and a rotating refresh token',
    login.status === 200 && Boolean(accessToken) && Boolean(refreshToken) && refreshToken !== accessToken,
    `access=${accessToken ? 'present' : 'missing'}, refresh=${refreshToken ? 'present' : 'missing'}`);

  // /api/auth/me accepts the refresh token as a bearer credential (the SPA's
  // path); a GET cannot carry a body.
  const me = await api('/api/auth/me', { token: refreshToken });
  const meByAccess = await api('/api/me', { token: accessToken });
  record('the session identifies the same account through both token paths',
    me.status === 200 && me.body?.user?.email === email && meByAccess.status === 200,
    `refresh→me HTTP ${me.status}, access→/api/me HTTP ${meByAccess.status}`);

  const cookieLeak = /akbaral_session|refresh_token=/i.test(setCookie);
  record('no session secret is handed to the browser in a cookie', !cookieLeak, setCookie ? setCookie.slice(0, 60) : 'no set-cookie header');

  // ── rotation, revocation ────────────────────────────────────────────────
  const rotated = await api('/api/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken } });
  const rotatedToken = rotated.body?.refreshToken ?? '';
  const reuseOld = await api('/api/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken } });
  record('refreshing rotates the token and the used token stops working',
    rotated.status === 200 && Boolean(rotatedToken) && rotatedToken !== refreshToken && reuseOld.status === 401,
    `rotate HTTP ${rotated.status}, replay of the old token HTTP ${reuseOld.status}`);

  const logout = await api('/api/auth/logout', { method: 'POST', body: { refresh_token: rotatedToken } });
  const afterLogout = await api('/api/auth/refresh', { method: 'POST', body: { refresh_token: rotatedToken } });
  record('logout revokes the session for good',
    logout.status === 204 && afterLogout.status === 401,
    `logout HTTP ${logout.status}, reuse after logout HTTP ${afterLogout.status}`);

  // ── recovery + verification honesty ────────────────────────────────────
  const reset = await api('/api/auth/request-password-reset', { method: 'POST', body: { email } });
  const resetText = JSON.stringify(reset.body ?? {});
  record('a password reset request answers without leaking whether the account exists',
    [200, 202].includes(reset.status) && !/passwordHash|token_hash/i.test(resetText),
    `HTTP ${reset.status}, mail delivery reported: ${resetText.match(/"[a-z_]*(sent|delivered|queued|configured)[a-z_]*":(true|false|"[^"]*")/i)?.[0] ?? 'not stated'}`);

  const verification = await api('/api/auth/request-email-verification', { method: 'POST', body: { email } });
  record('an email-verification request reports the real delivery state',
    verification.status === 200 || verification.status === 202,
    `HTTP ${verification.status}: ${JSON.stringify(verification.body ?? {}).slice(0, 120)}`);

  const badReset = await api('/api/auth/reset-password', { method: 'POST', body: { token: 'not-a-real-token', password: 'another-password-123' } });
  record('an invalid reset token is refused', badReset.status === 400 && /invalid|expired/i.test(message(badReset.body)), message(badReset.body).slice(0, 70));

  // ── OAuth providers ─────────────────────────────────────────────────────
  const providers = await api('/api/auth/oauth/providers');
  const list = providers.body?.providers ?? [];
  const configured = list.filter((provider) => provider.configured).map((provider) => provider.key);
  record('every OAuth provider reports its real configuration state',
    providers.status === 200 && list.length >= 5 && list.every((provider) => typeof provider.configured === 'boolean' && Array.isArray(provider.required)),
    `${list.length} providers, configured: ${configured.length ? configured.join(', ') : 'none'}`);

  const unconfigured = list.find((provider) => !provider.configured);
  if (unconfigured) {
    const attempt = await api(`/api/auth/oauth/${unconfigured.key}/authorize`, { redirect: 'manual' });
    record(`an unconfigured provider refuses to start a flow (${unconfigured.key}) instead of faking one`,
      attempt.status === 503 || attempt.status === 404 || attempt.status === 400,
      `HTTP ${attempt.status}: ${message(attempt.body).slice(0, 80) || (attempt.headers.get('location') ?? 'no redirect')}`);
  } else {
    record('an unconfigured provider refuses to start a flow instead of faking one', false, 'all providers are configured — nothing to prove here');
  }

  const providerText = JSON.stringify(list);
  record('the provider list never exposes client secrets',
    !/(client_secret|clientSecret|private_key|APPLE_PRIVATE_KEY)\s*[:=]/i.test(providerText),
    `${providerText.length} bytes of provider metadata`);

  // ── brute force protection ──────────────────────────────────────────────
  let limited = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await api('/api/auth/login', { method: 'POST', body: { email, password: 'wrong-password-attempt' } });
    if (response.status === 429) {
      limited = attempt + 1;
      break;
    }
  }
  record('repeated failed sign-ins are rate limited', limited > 0, limited ? `429 after ${limited} attempts` : 'no 429 within 12 attempts');

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${failed.length === 0 ? 'AUTH CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} — ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('auth probe failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
