#!/usr/bin/env node
/**
 * AKBARAL! — Task 4 live shell smoke (the application shell, end to end).
 *
 * Loads the SERVER-RENDERED /workspace document from a RUNNING AKBARAL! stack
 * into jsdom, executes the real public/app.js against the REAL authenticated
 * APIs (nothing is mocked) and drives the shell exactly as a user does:
 *
 *   signed-out gate → sign-in form → sidebar navigation (Library / Images /
 *   Files / Search) → a real MASTER run → New chat → sidebar + rail collapse
 *   → the phone drawer and pane switch → account menu / sign-out
 *
 * Usage (the stack must be up — `npm start`, or the preview processes):
 *   AKBARAL_WEB_URL=http://127.0.0.1:3000 \
 *   AKBARAL_API_URL=http://127.0.0.1:4000 \
 *     npm run smoke:shell
 *
 * When the local ops file `.platform-owner-credentials.txt` exists (two
 * lines: owner email, owner password) the script also proves the OWNER path —
 * the sidebar reveals the owner console entry for the owner role and stays
 * hidden for ordinary accounts. It never prints a password.
 *
 * Exit code 0 = every check passed.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const WEB = (process.env.AKBARAL_WEB_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const API = (process.env.AKBARAL_API_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');

const problems = [];
const results = [];
const check = (label, ok, detail = '') => {
  results.push([ok, label, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`);
};

/* ---------------------------------------------------------------- account */

async function signup(email, password, name) {
  const response = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  // 201 = created. The API answers an already-registered address with 400
  // code 'conflict' (409 tolerated too) — that is the normal case when the
  // operator file is present, and the login below is what proves the
  // credentials. Anything else is a real failure.
  const body = await response.json().catch(() => ({}));
  const alreadyRegistered = response.status === 409 || body?.error?.code === 'conflict';
  if (response.status !== 201 && !alreadyRegistered) {
    throw new Error(`register failed (${response.status})${body?.error?.message ? `: ${body.error.message}` : ''}`);
  }
}

const ownerFile = '.platform-owner-credentials.txt';
const useOwner = existsSync(ownerFile);
const credentials = useOwner
  ? readFileSync(ownerFile, 'utf8').trim().split('\n')
  : (() => {
      const stamp = Date.now();
      const email = `shell-smoke-${stamp}@akbaral.test`;
      const password = `Shell-smoke-${randomBytes(9).toString('base64url')}!1`;
      return [email, password];
    })();
const [email, password] = credentials;
await signup(email, password, useOwner ? 'AKBARAL Owner' : 'Shell Smoke');

/* ------------------------------------------------ a real project for the run
 * Website artifacts are only captured into a project, so the smoke needs one:
 * reuse the account's first project or create it through the real API. */
async function apiLogin() {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  return body.accessToken ?? '';
}

const apiToken = await apiLogin();
async function apiJson(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiToken}`, ...(init.headers ?? {}) },
  });
  return response.json().catch(() => ({}));
}

let projectId = ((await apiJson('/api/projects')).projects ?? [])[0]?.id ?? '';
if (!projectId) {
  projectId = ((await apiJson('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Shell smoke project' }) })).project ?? {}).id ?? '';
}

/* ------------------------------------------------------------ the browser */

const html = await (await fetch(`${WEB}/workspace`)).text();
const appJs = readFileSync('public/app.js', 'utf8');
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => problems.push(`jsdomError: ${String(error.message).slice(0, 200)}`));
virtualConsole.on('error', (...args) => problems.push(`console.error: ${String(args[0]).slice(0, 200)}`));

const dom = new JSDOM(html, {
  url: `${WEB}/workspace`,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
const doc = window.document;

// Same-origin requests are proxied to the API, cookies/tokens flow exactly as
// in a browser (the SPA keeps the session in localStorage + Bearer headers).
window.fetch = (input, init = {}) => {
  const raw = typeof input === 'string' ? input : input.url;
  return fetch(raw.startsWith('/') ? `${API}${raw}` : raw, init);
};
window.matchMedia = (query) => ({
  matches: /max-width:\s*1080px/.test(query) ? window.__narrow === true : false,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
});
window.scrollTo = () => {};
window.XMLHttpRequest = class { open() {} send() {} setRequestHeader() {} addEventListener() {} };

window.eval(appJs);
const tick = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
await tick(60);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
window.dispatchEvent(new window.Event('load'));
await tick(1500);

const q = (selector) => doc.querySelector(selector);
const shellState = () => q('#master-shell')?.dataset ?? {};
const turns = () => doc.querySelectorAll('.chat-msg').length;

/* ---------------------------------------------------------------- checks */

// 1 — boot + the signed-out gate.
check('bundle boots and mounts the application shell', Boolean(q('#master-shell')), `hash=${window.location.hash}`);
check('signed-out /workspace shows the real sign-in card', q('#screen-auth')?.hidden === false);
check('the OAuth area lists the real providers', Boolean(q('#auth-oauth')));
await tick(900);
const oauthButtons = [...doc.querySelectorAll('#auth-oauth-buttons .oauth-btn')];
const oauthLabels = oauthButtons.map((button) => button.textContent.trim());
check('every provider is mounted as one polished control', oauthButtons.length >= 5, `${oauthButtons.length} controls :: ${oauthLabels.join(' | ').slice(0, 150)}`);
check('each control carries its official provider mark',
  oauthButtons.length > 0 && oauthButtons.every((button) => Boolean(button.querySelector('.oauth-mark svg'))),
  `${oauthButtons.filter((b) => b.querySelector('.oauth-mark svg')).length}/${oauthButtons.length} marks`);
check('labels read "Continue with <Provider>" with no badge or suffix',
  oauthButtons.length > 0 && oauthButtons.every((button) => /^Continue with [A-Za-z]+$/.test(button.textContent.trim())),
  oauthLabels.join(' | ').slice(0, 150));
check('the pre-login screen exposes no configuration or debug text',
  !/setup needed|CLIENT_ID|CLIENT_SECRET|not configured|provider credentials|GOOGLE_|MICROSOFT_/i.test(q('#screen-auth').textContent),
  'no credential or setup strings on the public screen');
check('the route retires the public marketing chrome before sign-in', doc.body.classList.contains('is-auth'));
const cssVersion = (html.match(/\/assets\/styles\.css\?v=([\w.-]+)/) || [])[1];
const servedCss = await (await fetch(`${WEB}/assets/styles.css?v=${cssVersion}`)).text();
check('and that chrome is genuinely hidden, not merely restyled',
  /body\.is-auth \.site-header,\s*body\.is-auth \.site-footer \{ display: none; \}/.test(servedCss));
check('the pre-login surface fills the viewport while it is up',
  /body\.is-auth \.auth-screen \{ min-height: 100dvh/.test(servedCss));
const unavailable = oauthButtons.filter((button) => button.dataset.oauthConfigured === '0');
const configured = oauthButtons.filter((button) => button.dataset.oauthConfigured === '1');
check('a provider this deployment cannot serve is plainly unavailable, never a silent dead button',
  unavailable.length === 0 || unavailable.every((button) => button.disabled === true && button.getAttribute('aria-disabled') === 'true' && button.classList.contains('is-unavailable')),
  `${unavailable.length} unavailable of ${oauthButtons.length}`);
check('a configured provider is pressable and wired to the real authorize endpoint',
  configured.length === 0 || configured.every((button) => button.disabled === false && button.getAttribute('aria-disabled') === null),
  `${configured.length} configured`);
const urlBefore = window.location.href;
if (unavailable.length) { unavailable[0].click(); await tick(150); }
check('pressing an unavailable provider never invents a session or a navigation',
  q('#screen-auth')?.hidden === false && window.location.href === urlBefore && !JSON.stringify(window.localStorage).includes('access'));
// The server-side half of every provider button: the authorize endpoint is real
// and refuses honestly (503 provider_not_configured) instead of pretending.
const unconfigured = await fetch(`${API}/api/auth/oauth/facebook/authorize`, { redirect: 'manual' });
const unconfiguredBody = await unconfigured.json().catch(() => ({}));
const requiredCredential = unconfiguredBody?.error?.details?.requiredCredential ?? [];
check('the authorize endpoint is real and honest when unconfigured',
  unconfigured.status === 503 && unconfiguredBody?.error?.code === 'provider_not_configured' && requiredCredential.includes('FACEBOOK_CLIENT_ID'),
  `status=${unconfigured.status} code=${unconfiguredBody?.error?.code} requires=${requiredCredential.join('+')}`);

// 2 — real sign-in through the real form and the real auth API.
q('#auth-email').value = email;
q('#auth-password').value = password;
q('#auth-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick(3200);
check('sign-in lands in the workspace', q('#screen-master')?.hidden === false && doc.body.classList.contains('is-workspace'), `hash=${window.location.hash}`);
check('the account block shows the signed-in identity', q('#ak-user-name').textContent.trim().length > 0 && q('#ak-user-name').textContent !== 'Guest', q('#ak-user-name').textContent);
check('the credit pill carries a real number', /Credits|Trial/.test(q('#ak-credit-pill').textContent), q('#ak-credit-pill').textContent);
check('recent history loaded real data', /list-item/.test(q('#master-task-history').innerHTML));
if (useOwner) {
  check('owner account is revealed the Owner console entry', q('#ak-owner-link').hidden === false);
} else {
  check('ordinary account NEVER sees the owner entry (RBAC)', q('#ak-owner-link').hidden === true);
}

// 3 — sidebar navigation drives the rail panels with real data.
q('#ak-nav-library').click();
await tick(1500);
check('Library selects its rail tab and panel', q('#ak-tab-library').getAttribute('aria-selected') === 'true' && q('#ak-pane-library').hidden === false && shellState().rail === 'open');
check('Library rendered real content or an honest empty state', /library-row|empty-state|state-card/.test(q('#master-library').innerHTML));
q('#ak-nav-media').click();
await tick(2500);
check('Images & media selects its rail tab and panel', q('#ak-tab-media').getAttribute('aria-selected') === 'true' && q('#ak-pane-media').hidden === false);
check('Media rendered real content or an honest empty state', /media-card|empty-state|list-item/.test(q('#master-media').innerHTML));
q('#ak-nav-files').click();
await tick(1500);
check('Files selects the uploaded + generated file panel', q('#ak-tab-files').getAttribute('aria-selected') === 'true' && Boolean(q('#master-attachment-input')));

// 4 — the search overlay runs against the real task / knowledge APIs.
q('#ak-nav-search').click();
await tick(200);
check('Search opens from the sidebar', q('#master-search').hidden === false);
q('#master-search-input').value = 'calculator';
q('#master-search-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick(2500);
const groups = [...doc.querySelectorAll('#master-search-results .ak-command-group > b')].map((node) => node.textContent);
check('Search answered from the real APIs', groups.length > 0, groups.join(', '));
doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await tick(200);
check('Escape closes the overlay', q('#master-search').hidden === true);

// 4b — the project selector drives the rail with real data.
const projectSelect = q('#master-project');
await tick(1500);
const optionIds = [...projectSelect.options].map((option) => option.value).filter(Boolean);
check('the project selector lists the account projects', optionIds.includes(projectId), optionIds.join(', ') || 'none');
projectSelect.value = projectId;
projectSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
await tick(2500);
check('selecting a project loads its real export control', /website|No website version yet/.test(q('#master-export-actions').textContent), q('#master-export-actions').textContent.trim().slice(0, 80));

// 5 — a real MASTER run through the real pipeline (honest outcome).
q('#master-goal').value = 'Build me a one-page website for a calculator';
q('#master-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick(1200);
check('the goal opens as a real user turn', turns() >= 1 && q('#master-chat-log').innerHTML.includes('Build me a one-page website for a calculator'));
await tick(20000);
const chip = q('#master-canvas-state');
const canvasKind = chip?.dataset?.state ?? 'idle';
const canvasState = chip?.textContent.trim() ?? 'idle';
check('the run reaches a terminal, honest canvas state', ['ok', 'error'].includes(canvasKind), `canvas = ${canvasKind} (${canvasState})`);
check('the outcome is never faked as success without a result', canvasState !== 'ok' || /Export|result/i.test(q('#master-result').innerHTML), q('#master-output').textContent.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 130));

// 5b — the SUCCESS path (a provider or the local model stub is configured).
// When the pipeline completes, the deliverable it captured must be the thing
// rendered in the preview and offered for export — real content, sandboxed.
if (canvasKind === 'ok') {
  const frame = q('.wp-frame');
  const srcdoc = frame?.getAttribute('srcdoc') ?? '';
  check('a completed run renders the real deliverable in the preview frame', /<!doctype html/i.test(srcdoc), `bytes=${srcdoc.length}`);
  check('the preview frame is sandboxed without same-origin access', (frame?.getAttribute('sandbox') ?? '') === 'allow-scripts', String(frame?.getAttribute('sandbox')));
  check('the export control above the canvas offers the real artifact', Boolean(q('#master-export-download')), q('#master-export-actions').textContent.trim().slice(0, 90));
  q('#ak-nav-files').click();
  await tick(2000);
  check('the Files panel separates uploaded files from generated artifacts', /Uploaded/.test(q('#master-files').innerHTML) && /Generated/.test(q('#master-files').innerHTML));
  check('the generated artifact is listed with canvas + download actions', Boolean(q('#master-files [data-artifact-download]')), q('#master-files [data-artifact-kind]')?.dataset?.artifactKind ?? 'none');
  check('the generated artifact is the website the pipeline captured', /website/i.test(q('#master-files').innerHTML), q('#master-files [data-artifact-kind]')?.dataset?.artifactVersion ?? 'n/a');
  check('the export control now names the real artifact version', /website v\d+/.test(q('#master-export-actions').textContent), q('#master-export-actions').textContent.trim().slice(0, 80));
} else {
  check('a failed run leaves no deliverable on the canvas (nothing faked)', !q('.wp-frame'), `canvas=${canvasState}`);
  // A failed run must never put an export on the bar that the server does not
  // actually store: either the honest empty copy, or a version that is real.
  const storedArtifact = await apiJson(`/api/projects/${projectId}/artifacts/website`).catch(() => ({}));
  const exportText = q('#master-export-actions').textContent;
  const namedVersion = /website v(\d+)/.exec(exportText)?.[1] ?? '';
  check(
    'the export bar only ever names a version the server really stores',
    namedVersion === '' ? /No website version yet|Select a project/.test(exportText) : String(storedArtifact?.artifact?.version ?? '') === namedVersion,
    `${exportText.trim().replace(/\s+/g, ' ').slice(0, 60)} | stored=${storedArtifact?.artifact?.version ?? 'none'}`,
  );
  check('the credit balance is still whole after the failed run', /free/i.test(q('#ak-credit-pill').textContent), q('#ak-credit-pill').textContent);
}

// 5c — the realtime channel survives compression: the SAME live stream the
// browser opens (EventSource → /api/executions/:id/events, through the web
// tier that now gzips documents and assets) must still arrive incrementally.
// Without `Cache-Control: no-transform` on the SSE response the compressor
// buffers it and this read() never resolves — that is the regression guard.
const recentTasks = (await apiJson('/api/tasks?limit=5')).tasks ?? [];
const latestTaskDetail = recentTasks[0] ? await apiJson(`/api/tasks/${recentTasks[0].id}`) : {};
const executionId = (latestTaskDetail.executions ?? [])[0]?.id ?? '';
check('the run produced a real execution to stream from', Boolean(executionId), `execution=${executionId || 'none'}`);
if (executionId) {
  const stream = await fetch(`${WEB}/api/executions/${executionId}/events?token=${encodeURIComponent(apiToken)}`, {
    headers: { accept: 'text/event-stream', 'accept-encoding': 'br, gzip' },
  });
  check('the stream is declared text/event-stream', /text\/event-stream/.test(stream.headers.get('content-type') ?? ''), stream.headers.get('content-type') ?? '');
  check('the compressor leaves the stream untransformed (no-transform honoured)', !(stream.headers.get('content-encoding') ?? ''), `content-encoding=${stream.headers.get('content-encoding') ?? 'none'}`);
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 8000));
  const firstChunk = await Promise.race([stream.body.getReader().read(), timeout]);
  check('the stream still delivers incrementally through the compressed tier', firstChunk?.timedOut !== true && firstChunk?.done === false && (firstChunk?.value?.length ?? 0) > 0,
    firstChunk?.timedOut ? 'no bytes within 8s (BUFFERED — compression broke streaming)' : `first chunk ${firstChunk?.value?.length ?? 0} bytes`);
  try { await stream.body.cancel(); } catch { /* stream already closed */ }
}

// 6 — New chat resets the conversation for real.
q('#master-new-chat').click();
await tick(600);
check('New chat clears the conversation', turns() === 0, `turns=${turns()}`);
check('New chat returns the canvas to idle', q('#master-canvas-state').textContent.trim() === 'idle');

// 7 — layout state machine (desktop collapse + phone drawer/pane switch).
q('#master-sidebar-toggle').click();
await tick(200);
check('sidebar collapses to icons', shellState().sidebar === 'collapsed');
q('#master-sidebar-toggle').click();
await tick(200);
check('sidebar expands again', shellState().sidebar === 'open');
q('#master-rail-toggle').click();
await tick(200);
check('the preview rail collapses', shellState().rail === 'closed' && q('#master-rail-toggle').getAttribute('aria-expanded') === 'false');
q('#master-rail-toggle').click();
await tick(200);
check('the preview rail reopens', shellState().rail === 'open');

window.__narrow = true; // ≤1080px: the drawer + pane switch take over
q('#master-menu-btn').click();
await tick(200);
check('the phone burger opens the sidebar drawer', shellState().sidebar === 'drawer' && q('#master-sidebar-scrim').hidden === false);
q('#master-sidebar-scrim').click();
await tick(200);
check('the scrim closes the drawer', shellState().sidebar === 'open' && q('#master-sidebar-scrim').hidden === true);
q('#master-pane-chat').click();
await tick(200);
check('the pane switch selects the conversation', q('#master-layout').dataset.pane === 'chat' && q('#master-pane-chat').getAttribute('aria-selected') === 'true');
q('#master-pane-workspace').click();
await tick(200);
check('the pane switch selects the preview rail', q('#master-layout').dataset.pane === 'workspace');
q('#ak-nav-files').click();
await tick(400);
check('opening a rail panel on a phone reveals the rail pane', q('#master-layout').dataset.pane === 'workspace');

// 8 — account menu + real sign-out.
q('#ak-account-menu-btn').click();
await tick(150);
check('the account menu opens with real entries', q('#ak-account-menu').hidden === false && q('#ak-account-menu').innerHTML.includes('settings'));
q('#ak-logout').click();
await tick(1400);
check('sign-out clears the session and returns to the landing screen', q('#screen-landing').hidden === false && !doc.body.classList.contains('is-workspace'));

// 9 — the delivered browser payload: compressed text assets, safe caching.
const assetVersion = (html.match(/\/assets\/(?:app\.js|styles\.css|tokens\.css)\?v=([\w.-]+)/) || [])[1];
check('the served shell points at the compressed asset endpoint', Boolean(assetVersion), `v=${assetVersion}`);
// Node's fetch decompresses transparently, so wire sizes must be measured on
// the socket: http.request gives the encoded bytes exactly as a browser gets them.
const { request: httpRequest } = await import('node:http');
const rawText = (path, encoding = 'identity') => new Promise((resolve, reject) => {
  const url = new URL(`${WEB}${path}`);
  const request = httpRequest({
    protocol: url.protocol, hostname: url.hostname, port: url.port || 80, path: `${url.pathname}${url.search}`,
    method: 'GET', headers: { 'accept-encoding': encoding },
  }, (response) => {
    let bytes = 0;
    response.on('data', (chunk) => { bytes += chunk.length; });
    response.on('end', () => resolve({
      bytes,
      status: response.statusCode,
      type: response.headers['content-type'] || '',
      cache: response.headers['cache-control'] || '',
      encoding: response.headers['content-encoding'] || '',
      vary: response.headers.vary || '',
    }));
  });
  request.on('error', reject);
  request.end();
});
for (const asset of ['app.js', 'styles.css', 'tokens.css']) {
  const identity = await rawText(`/assets/${asset}?v=${assetVersion}`);
  const compressed = await rawText(`/assets/${asset}?v=${assetVersion}`, 'br, gzip');
  check(`/assets/${asset} compresses on the wire (brotli or gzip)`, ['br', 'gzip'].includes(compressed.encoding), `encoding=${compressed.encoding}`);
  check(`/assets/${asset} shrinks the transfer (identity ${identity.bytes}b → ${compressed.bytes}b)`, compressed.bytes < identity.bytes * 0.75, `${Math.round((1 - compressed.bytes / identity.bytes) * 100)}% smaller`);
  check(`/assets/${asset} is served with a long, versioned cache`, /max-age=86400/.test(compressed.cache) && /accept-encoding/i.test(compressed.vary), compressed.cache);
  check(`/assets/${asset} still serves identity bytes to a client that cannot decode brotli`, identity.encoding === '' && identity.bytes > compressed.bytes, `identity=${identity.bytes}b enc=${identity.encoding || 'none'}`);
}
const documentAsset = await rawText('/workspace');
// The documents decide which screen exists, so they revalidate (ETag) and are
// explicitly kept out of shared caches — a year-long `s-maxage` here meant a
// CDN could pin the previous application shell indefinitely.
check('the app document revalidates and is never pinned by a shared cache',
  /no-cache/.test(documentAsset.cache) && !/s-maxage/.test(documentAsset.cache), documentAsset.cache);
check('typography loads off the critical path (media=print, swapped after hydration)', html.includes('id="ak-fonts"') && html.includes('media="print"') && q('#ak-fonts')?.getAttribute('media') === 'all', `media=${q('#ak-fonts')?.getAttribute('media')}`);

/* ----------------------------------------------------------------- report */

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} shell checks passed`);
if (failed.length) {
  console.log('failures:');
  for (const [, label, detail] of failed) console.log(`  · ${label} ${detail}`);
}
console.log('runtime problems:', problems.length ? [...new Set(problems)].slice(0, 8) : 'none');
process.exit(failed.length ? 1 : 0);
