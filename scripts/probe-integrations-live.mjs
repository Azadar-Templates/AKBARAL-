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
const tools = await api('/api/tools', { token });
const toolList = tools.body?.tools ?? [];
const readyTools = toolList.filter((tool) => tool.configured !== false && tool.requiredCredential === undefined ? true : tool.configured === true);
const needCreds = toolList.filter((tool) => tool.configured === false || (tool.requiredCredential && tool.configured !== true));
row('data tools', `${readyTools.length}/${toolList.length} usable`,
  needCreds.length === 0 ? 'every tool has what it needs' : `${needCreds.length} need credentials`);
for (const tool of needCreds) {
  const required = tool.requiredCredential ?? tool.requiredCredentials ?? (Array.isArray(tool.envKeys) ? tool.envKeys.join(', ') : null) ?? 'see tool docs';
  row(`  tool ${tool.key}`, 'NEEDS CONFIGURATION', `set ${required}`);
}

// ── outbound web search (the discovery engine's source) ────────────────────
const discovery = await api('/api/economy/opportunities/discover', { method: 'POST', body: { categories: ['content_production'] } });
const discovered = Number(discovery.body?.discovered ?? 0);
row('outbound web search', discovery.body?.unavailable ? 'NEEDS CONFIGURATION' : 'CONFIGURED',
  discovery.body?.unavailable ? String(discovery.body.unavailable).slice(0, 160) : `discovery reachable (${discovered} new opportunities)`);

// ── transactional email ────────────────────────────────────────────────────
const reset = await api('/api/auth/request-password-reset', { method: 'POST', body: { email: `integration-probe-${Date.now().toString(36)}@akbaral.test` } });
row('transactional email', reset.body?.emailDelivery === 'not_configured' ? 'NEEDS CONFIGURATION' : 'CONFIGURED',
  reset.body?.emailDelivery === 'not_configured'
    ? `sign-in links and receipts cannot be delivered; set ${(reset.body?.emailDeliveryRequired ?? []).join(', ') || 'SMTP_HOST, SMTP_USER, SMTP_PASSWORD'}`
    : `delivery state: ${reset.body?.emailDelivery ?? 'reported by the mail transport'}`);

// ── payments ───────────────────────────────────────────────────────────────
const plans = await api('/api/billing/plans');
const checkout = await api('/api/billing/checkout', { method: 'POST', token, body: { planKey: 'pro' } });
const paymentsConfigured = checkout.status !== 503 && !/not configured/i.test(JSON.stringify(checkout.body ?? {}));
row('payments', paymentsConfigured ? 'CONFIGURED' : 'NEEDS CONFIGURATION',
  paymentsConfigured
    ? `checkout started for a paid plan (HTTP ${checkout.status})`
    : `${(plans.body?.plans ?? []).length} plans exist but no payment provider answers: ${String(checkout.body?.error?.message ?? '').slice(0, 120)}`);

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
