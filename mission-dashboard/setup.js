/* ZA141251SA — one-time owner password setup + real browser verification.
 *
 * The password typed here is held in a local variable for exactly as long as it
 * takes to (a) send it once to /api/owner-setup/complete and (b) prove it works
 * via /api/session/login. It is never placed in storage, in the URL, in a log
 * line or in the verification report. The report carries booleans only.
 */
const STATE_KEY = 'za_setup_state';
const DASH_TOKEN_KEY = 'za_mission_token';

const $ = (selector) => document.querySelector(selector);

const CHECK_LABELS = {
  password_set: 'Owner password set (scrypt hash stored)',
  owner_login: 'Owner signs in with the new password',
  session_persists_across_reload: 'Session survives a full page reload',
  logout_clears_session: 'Sign-out invalidates the session',
  foreign_identity_denied: 'A different email is refused',
  wrong_password_denied: 'A wrong password is refused',
};

function readState() {
  try {
    return JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeState(state) {
  sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function clearState() {
  sessionStorage.removeItem(STATE_KEY);
}

function renderChecks(checks) {
  const list = $('#checklist');
  list.innerHTML = '';
  for (const key of Object.keys(CHECK_LABELS)) {
    const value = checks[key];
    const item = document.createElement('li');
    const mark = value === true ? 'PASS' : value === false ? 'FAIL' : '…';
    item.textContent = `${mark} — ${CHECK_LABELS[key]}`;
    item.className = value === true ? 'ok' : value === false ? 'error' : 'muted';
    list.appendChild(item);
  }
}

async function api(pathname, { method = 'GET', body, token } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`/api${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

function randomString() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function tokenFromHash() {
  const match = /(?:^|[#&])token=([^&]+)/.exec(window.location.hash || '');
  const token = match ? decodeURIComponent(match[1]) : '';
  // Strip the token from the address bar immediately: it must not survive in
  // history, screenshots or a shared link.
  if (token) window.history.replaceState({}, document.title, window.location.pathname);
  return token;
}

async function runPostReloadVerification(state) {
  $('#setup-panel').hidden = true;
  $('#progress-panel').hidden = false;
  const checks = state.checks || {};
  renderChecks(checks);

  // 1. The session minted before the reload must still be valid.
  const me = await api('/session/me', { token: state.token });
  checks.session_persists_across_reload = me.status === 200 && me.payload?.owner?.email === state.email;
  renderChecks(checks);

  // 2. Sign out, then prove the same token no longer reads mission data.
  await api('/session/logout', { method: 'POST', token: state.token });
  const afterLogout = await api('/overview', { token: state.token });
  checks.logout_clears_session = afterLogout.status === 401;
  renderChecks(checks);

  // 3. File the report (booleans only) while the just-revoked session still
  //    attests that this browser really authenticated.
  await api('/owner-setup/verification', { method: 'POST', token: state.token, body: { checks } });

  sessionStorage.removeItem(DASH_TOKEN_KEY);
  clearState();
  const allPassed = Object.keys(CHECK_LABELS).every((key) => checks[key] === true);
  $('#progress-note').textContent = allPassed
    ? 'All checks passed. Sign in at the mission dashboard with your new password.'
    : 'One or more checks failed. Request a new setup link and try again.';
  $('#open-dashboard').hidden = false;
}

async function runSetup(token, password) {
  $('#setup-panel').hidden = true;
  $('#progress-panel').hidden = false;
  const checks = {};
  renderChecks(checks);

  const set = await api('/owner-setup/complete', { method: 'POST', body: { token, password } });
  if (set.status !== 200) {
    checks.password_set = false;
    renderChecks(checks);
    $('#progress-note').textContent = set.payload?.error?.message || 'the password could not be set';
    return;
  }
  checks.password_set = true;
  const email = set.payload.email;
  renderChecks(checks);

  const signIn = await api('/session/login', { method: 'POST', body: { email, password } });
  checks.owner_login = signIn.status === 200 && Boolean(signIn.payload?.token);
  renderChecks(checks);
  const sessionToken = signIn.payload?.token || '';
  password = '';

  const foreign = await api('/session/login', {
    method: 'POST',
    body: { email: `not-the-owner-${randomString().slice(0, 8)}@example.invalid`, password: randomString() },
  });
  checks.foreign_identity_denied = foreign.status === 403;
  renderChecks(checks);

  const wrong = await api('/session/login', { method: 'POST', body: { email, password: randomString() } });
  checks.wrong_password_denied = wrong.status === 401;
  renderChecks(checks);

  if (!checks.owner_login) {
    $('#progress-note').textContent = 'sign-in with the new password failed — request a new setup link';
    return;
  }

  // Reload the page for real, carrying only the session token, and finish the
  // verification on the other side of the reload.
  writeState({ phase: 'verify-reload', token: sessionToken, email, checks });
  $('#progress-note').textContent = 'reloading to verify that the session survives a refresh…';
  setTimeout(() => window.location.reload(), 400);
}

async function boot() {
  const state = readState();
  if (state && state.phase === 'verify-reload') {
    await runPostReloadVerification(state);
    return;
  }

  const token = tokenFromHash();
  const status = await api('/owner-setup/status');
  if (!token || status.status !== 200 || !status.payload?.available) {
    $('#unavailable').hidden = false;
    return;
  }

  $('#masked-email').textContent = status.payload.maskedEmail || 'the configured mission owner';
  $('#expiry-note').textContent = `This one-time link expires at ${new Date(status.payload.expiresAt).toLocaleString()} and can only be used once.`;
  $('#setup-panel').hidden = false;

  $('#setup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#setup-error');
    error.hidden = true;
    const password = $('#new-password').value;
    const confirm = $('#confirm-password').value;
    if (password.length < 12) {
      error.textContent = 'the owner password must be at least 12 characters';
      error.hidden = false;
      return;
    }
    if (password !== confirm) {
      error.textContent = 'the two passwords do not match';
      error.hidden = false;
      return;
    }
    $('#setup-button').disabled = true;
    $('#new-password').value = '';
    $('#confirm-password').value = '';
    try {
      await runSetup(token, password);
    } catch (failure) {
      $('#progress-note').textContent = failure?.message || 'setup failed';
    }
  });
}

void boot();
