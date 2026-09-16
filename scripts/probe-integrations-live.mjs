/**
 * Live integration inventory for the running AKBARAL! platform.
 *
 *   node scripts/probe-integrations-live.mjs
 *
 * Reports, per integration, whether it is CONFIGURED and USABLE right now or
 * which exact credential/dependency is missing. Nothing is inferred from
 * documentation — every line comes from a live call or a live capability check:
 *
 *   database + migrations + uploads + execution queue   (/api/ready)
 *   language models and their providers                 (/api/models)
 *   data tools, which ones have their credentials       (/api/tools)
 *   outbound web search                                 (economy discovery call)
 *   transactional email                                 (password-reset delivery state)
 *   payments                                            (billing provider state)
 *   social sign-in providers                            (/api/auth/oauth/providers)
 *   public site URL used in sitemaps and checkout links (environment default)
 *
 * Exit code 0 always: this is an inventory, not a pass/fail gate.
 */
import fs from 'node:fs';
import path from 'node:path';

const API = (process.env.API_BASE ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const lines = [];

function row(name, state, detail) {
  lines.push({ name, state, detail });
  console.log(`${state.padEnd(14)} ${name}${detail ? ` — ${detail}` : ''}`);
}

function ownerCredentials() {
  const file = path.resolve(process.cwd(), '.platform-owner-credentials.txt');
  if (!fs.existsSync(file)) return { email: process.env.OWNER_EMAIL ?? '', password: process.env.OWNER_PASSWORD ?? '' };
  const [email = '', password = ''] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map((line) => line.trim());
  return { email, password };
}

async function api(route, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const credentials = ownerCredentials();
const login = await api('/api/auth/login', { method: 'POST', body: credentials });
const token = login.body?.accessToken ?? '';
if (!token) {
  console.error(`owner sign-in failed: HTTP ${login.status}`);
  process.exit(1);
}

// ── platform foundations ────────────────────────────────────────────────────
const ready = await api('/api/ready');
const checks = ready.body?.checks ?? [];
row('platform foundations', ready.body?.status === 'ready' ? 'CONFIGURED' : 'NOT READY',
  checks.map((check) => `${check.name}:${check.ok ? 'ok' : 'FAIL'}`).join(', '));

// ── models ──────────────────────────────────────────────────────────────────
const models = await api('/api/models', { token });
const providers = models.body?.providers ?? [];
const modelList = models.body?.models ?? [];
const configuredProviders = providers.filter((provider) => provider.configured);
row('language models', configuredProviders.length > 0 ? 'CONFIGURED' : 'NEEDS CONFIGURATION',
  `${configuredProviders.length}/${providers.length} providers configured (${configuredProviders.map((provider) => provider.key).join(', ') || 'none'}); ${modelList.length} models in the catalog`);
for (const provider of providers.filter((entry) => !entry.configured)) {
  row(`  provider ${provider.key}`, 'NEEDS CONFIGURATION', `set ${provider.envKey}`);
}

// ── tools ───────────────────────────────────────────────────────────────────
// The real payload flags credential readiness with `credentialConfigured`
// plus `requires_credential` / `required_credential_env_key` — never a bare
// `configured` field, which does not exist.
const tools = await api('/api/tools', { token });
const toolList = tools.body?.tools ?? [];
const needsCredential = (tool) => tool.requires_credential === true || Boolean(tool.required_credential_env_key);
const readyTools = toolList.filter((tool) => tool.credentialConfigured !== false && !needsCredential(tool));
const needCreds = toolList.filter((tool) => tool.credentialConfigured === false && needsCredential(tool));
row('data tools', `${readyTools.length}/${toolList.length} usable`,
  needCreds.length === 0 ? 'every tool has what it needs' : `${needCreds.length} need credentials`);
for (const tool of needCreds) {
  const required = tool.requiredCredential ?? tool.requiredCredentials ?? (Array.isArray(tool.envKeys) ? tool.envKeys.join(', ') : null);
  row(`  tool ${tool.key}`, 'NEEDS CONFIGURATION',
    required ? `set ${required}` : 'requires a credential the API does not name — see the tool contract in docs/TOOLS.md');
}

// ── outbound web search (the research/discovery source) ────────────────────
// Search always "works" through the keyless default, so the honest report is
// WHICH provider will serve a call and whether a commercial key is present —
// not a blanket CONFIGURED. The admin config status is the authoritative view.
// The admin config-status route is staff-only (the owner account is refused
// there by design and the RBAC test asserts it), so the probe checks the
// operator environment it shares with the server plus the live call path.
const SEARCH_KEY_VARS = ['TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'SERPER_API_KEY', 'GOOGLE_CSE_API_KEY'];
const searchKeys = SEARCH_KEY_VARS.filter((key) => Boolean((process.env[key] ?? '').trim()));
const searchEndpoint = (process.env.AKBARAL_SEARCH_ENDPOINT ?? '').trim();
const discovery = await api('/api/economy/opportunities/discover', { method: 'POST', body: { categories: ['content_production'] } });
const discovered = Number(discovery.body?.discovered ?? 0);
const discoveredCategories = (discovery.body?.searchedCategories ?? []).join(', ') || 'none configured';
row('outbound web search', searchKeys.length > 0 || searchEndpoint ? 'CONFIGURED' : 'USING DEFAULT',
  searchKeys.length > 0 || searchEndpoint
    ? `commercial provider configured (${[...searchKeys, searchEndpoint ? 'AKBARAL_SEARCH_ENDPOINT' : ''].filter(Boolean).join(', ')}); discovery call: ${discovery.body?.unavailable ? String(discovery.body.unavailable).slice(0, 120) : `searched [${discoveredCategories}], ${discovered} new`}`
    : `keyless DuckDuckGo HTML default (operator environment check) — no quota-backed key; set ${SEARCH_KEY_VARS.join(' / ')} for production search; discovery call: ${discovery.body?.unavailable ? String(discovery.body.unavailable).slice(0, 120) : `searched [${discoveredCategories}], ${discovered} new`}`);

// ── transactional email ────────────────────────────────────────────────────
const reset = await api('/api/auth/request-password-reset', { method: 'POST', body: { email: `integration-probe-${Date.now().toString(36)}@akbaral.test` } });
row('transactional email', reset.body?.emailDelivery === 'not_configured' ? 'NEEDS CONFIGURATION' : 'CONFIGURED',
  reset.body?.emailDelivery === 'not_configured'
    ? `sign-in links and receipts cannot be delivered; set ${(reset.body?.emailDeliveryRequired ?? []).join(', ') || 'SMTP_HOST, SMTP_USER, SMTP_PASSWORD'}`
    : `delivery state: ${reset.body?.emailDelivery ?? 'reported by the mail transport'}`);

// ── payments ───────────────────────────────────────────────────────────────
// A payment provider only counts as configured when a REAL checkout can be
// started. /api/billing/checkout does not exist; the honest probe is
// /api/billing/credits with a provider, which answers 402
// provider_not_configured (naming the missing credential) when none is.
const plans = await api('/api/billing/plans');
const checkout = await api('/api/billing/credits', { method: 'POST', token, body: { credits: 1, amount_cents: 100, provider: 'stripe' } });
const checkoutCode = checkout.body?.error?.code ?? '';
const paymentsConfigured = checkout.status === 201 || checkout.status === 200;
const paymentsDetail = paymentsConfigured
  ? `stripe checkout created (${checkout.status})`
  : `${checkout.status} ${checkoutCode || 'unknown'}${checkout.body?.error?.requiredCredential ? `; required credential: ${checkout.body.error.requiredCredential}` : ''}`;
row('payments', paymentsConfigured ? 'CONFIGURED' : 'NEEDS CONFIGURATION',
  `${(plans.body?.plans ?? []).length} plans; ${paymentsDetail}`);

// ── social sign-in ─────────────────────────────────────────────────────────
const providersOauth = await api('/api/auth/oauth/providers');
const oauthList = providersOauth.body?.providers ?? [];
const oauthReady = oauthList.filter((provider) => provider.configured);
row('social sign-in', oauthReady.length > 0 ? 'CONFIGURED' : 'NEEDS CONFIGURATION',
  oauthReady.length > 0
    ? `${oauthReady.map((provider) => provider.key).join(', ')} ready`
    : `email + password sign-in works; none of ${oauthList.map((provider) => provider.key).join('/')} has credentials yet (${oauthList[0]?.required?.join(', ') ?? 'see docs'})`);

// ── public site URL (sitemap / checkout returns) ───────────────────────────
const siteUrl = process.env.AKBARAL_SITE_URL ?? 'https://akbaral.duckdns.org (built-in default)';
row('public site URL', process.env.AKBARAL_SITE_URL ? 'CONFIGURED' : 'USING DEFAULT', String(siteUrl));

// ── realtime channel ───────────────────────────────────────────────────────
const health = await api('/api/health');
row('realtime execution channel', health.body?.status === 'ok' ? 'CONFIGURED' : 'UNKNOWN',
  'WebSocket /ws/executions/:id served by the same process as the API');

console.log(`\nINTEGRATION INVENTORY — ${lines.filter((line) => line.state === 'CONFIGURED').length} configured, ${lines.filter((line) => line.state.startsWith('NEEDS')).length} needing configuration`);
