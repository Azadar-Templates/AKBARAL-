/** Real Chromium + real private HTTP API; synthetic isolated data, no providers. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { chromium, expect, type Browser, type Page } from '@playwright/test';

const evidenceDir = path.resolve(process.env.MISSION_BROWSER_EVIDENCE_DIR || `logs/browser/${Date.now()}`);
fs.mkdirSync(evidenceDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-browser-fixture-'));
process.env.DATABASE_URL = ':memory:';
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(fixtureDir, 'mission.db')}`;
process.env.ZA141251SA_CREDENTIAL_KEY = randomBytes(32).toString('hex');
process.env.ZA141251SA_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.ZA141251SA_OWNER_EMAIL = 'synthetic-browser@mission.test';
process.env.ZA141251SA_OWNER_PASSWORD = randomBytes(24).toString('hex');
process.env.ZA141251SA_CHAT_WORKER_ENABLED = 'false';
const { applyMissionMigrations, missionDb } = require('../src/mission/database') as typeof import('../src/mission/database');
const { provisionOwner, createAccessLink } = require('../src/mission/auth') as typeof import('../src/mission/auth');
const { updatePolicy } = require('../src/mission/policy') as typeof import('../src/mission/policy');
const { createWallet, credit, getWallet } = require('../src/mission/treasury') as typeof import('../src/mission/treasury');
const { storeCredential, requestResource, provisionResource, recordResourceUsage, seedTools } = require('../src/mission/self-management') as typeof import('../src/mission/self-management');
const { reserveResourceCall, claimResourceCall, markResourceCallUncertain } = require('../src/mission/resource-calls') as typeof import('../src/mission/resource-calls');
const { createMissionServer } = require('../src/mission/server') as typeof import('../src/mission/server');
const fingerprint = createHash('sha256');
const sourceFiles = ['scripts/mission-browser-check.ts', 'package-lock.json', ...['src/mission', 'src/db', 'db/migrations-mission', 'mission-dashboard'].flatMap(directory => fs.readdirSync(directory).filter(file => /\.(ts|mjs|js|sql|html|css)$/.test(file) && !file.endsWith('.test.ts')).map(file => `${directory}/${file}`))].sort();
for (const file of sourceFiles) fingerprint.update(file).update('\0').update(fs.readFileSync(file)).update('\0');
const evidence: { sha: string; sourceFingerprint: string; workingTreeDirty: boolean; synthetic: boolean; externalRequests: string[]; browser?: string; checks: Array<{ viewport: string; check: string }>; error?: string } = { sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceFingerprint: fingerprint.digest('hex'), workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), synthetic: true, externalRequests: [], checks: [] };
function checkpoint(viewport: string, check: string) {
  evidence.checks.push({ viewport, check });
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(evidence, null, 2));
  process.stdout.write(`PASS ${viewport}: ${check}\n`);
}
function fixture(label: string, ownerId: string) {
  const agentId = `browser-${label}-${randomUUID()}`;
  missionDb.run("INSERT INTO mission_agents (id, slug, name, role_key, depth, generation, status, mission_role, origin_platform) VALUES (?, ?, ?, 'specialist', 0, 'custom', 'active', 'worker', 'mission')", [agentId, agentId, `Synthetic ${label} browser agent`]);
  const credential = storeCredential({ provider: 'google', label: 'Synthetic browser credential, not usable', secret: `synthetic-${randomUUID()}`, scope: ['model.call'], actorId: ownerId });
  const resource = requestResource({ agentId, provider: 'google', kind: 'api', credentialId: credential.id, expiresAt: new Date(Date.now() + 86400000).toISOString(), limits: { requests: 5, tokens: 100000 } });
  const resourceId = String(resource.id);
  provisionResource({ id: resourceId, actualCostCents: 0, providerRef: `synthetic-${label}-provisioning`, evidence: 'Synthetic browser fixture only; no real resource activation.', actorId: ownerId });
  recordResourceUsage({ id: resourceId, usage: { requests: 0, tokens: 0 }, actorType: 'owner', actorId: ownerId });
  const wallet = createWallet({ kind: 'agent', agentId, label: `Synthetic ${label} wallet`, budgetCents: 100 });
  credit({ walletId: wallet.id, amountCents: 100, category: 'transfer', memo: 'Synthetic test funds, not revenue' });
  const actor = { actorType: 'agent' as const, actorId: agentId };
  const input = { resourceId, agentId, ...actor, operationFingerprint: 'e'.repeat(64), units: { requests: 1, tokens: 100 } };
  const held = reserveResourceCall({ ...input, idempotencyKey: randomUUID() });
  const uncertain = reserveResourceCall({ ...input, idempotencyKey: randomUUID(), budget: { walletId: wallet.id, maxCostCents: 40 } });
  claimResourceCall(String(uncertain.id), actor); markResourceCallUncertain(String(uncertain.id), actor);
  // Synthetic time-lapse: outstanding calls must be reconciled before renewal.
  missionDb.run('UPDATE mission_resources SET expires_at = ? WHERE id = ?', [new Date(Date.now() - 3600000).toISOString(), resourceId]);
  return { agentId, resourceId, walletId: wallet.id, held: String(held.id), uncertain: String(uncertain.id) };
}
async function launch(): Promise<Browser> {
  if (process.env.MISSION_BROWSER_NPM_RUNTIME === 'true') {
    // Linux fallback when browser CDNs / apt mirrors are unavailable. The pinned
    // npm package supplies Chromium and NSS; do not disable browser web security.
    if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('npm browser fallback requires Linux x64; use a locally installed Playwright browser instead');
    const runtime = (await import('@sparticuz/chromium')).default;
    const packageRoot = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
    const libs = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-browser-libs-'));
    execFileSync('tar', ['-xf', '-', '-C', libs], { input: brotliDecompressSync(fs.readFileSync(path.join(packageRoot, 'bin/al2023.tar.br'))) });
    return chromium.launch({ executablePath: await runtime.executablePath(), headless: true, env: { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), FONTCONFIG_PATH: process.env.FONTCONFIG_PATH ?? '', LD_LIBRARY_PATH: path.join(libs, 'lib') } });
  }
  return chromium.launch({ headless: true, ...(process.env.MISSION_BROWSER_EXECUTABLE ? { executablePath: process.env.MISSION_BROWSER_EXECUTABLE } : {}) });
}
async function viewportCheck(browser: Browser, base: string, name: string, ownerId: string) {
  const f = fixture(name, ownerId);
  const context = await browser.newContext({ viewport: name === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: name === 'mobile', hasTouch: name === 'mobile' });
  await context.route('**/*', route => {
    if (route.request().url().startsWith(`${base}/`)) return route.continue();
    evidence.externalRequests.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const receiptPosts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/reconcile')) receiptPosts.push(request.url()); });
  try {
    await page.goto(base);
    await expect(page.locator('#login-panel')).toBeVisible();
    await page.locator('#email').fill(process.env.ZA141251SA_OWNER_EMAIL!);
    await page.locator('#password').fill(process.env.ZA141251SA_OWNER_PASSWORD!);
    await page.locator('#login-button').click();
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('#identity')).toContainText('signed in as');
    checkpoint(name, 'real owner sign-in');
    await page.locator('[data-tab="tools"]').click();
    const credentialForm = page.locator('#credential-form');
    await expect(credentialForm.locator('[name="scope"]')).toHaveValue('');
    const credentialLabel = `Synthetic ${name} scoped UI credential`;
    await credentialForm.locator('[name="provider"]').fill('google');
    await credentialForm.locator('[name="label"]').fill(credentialLabel);
    await credentialForm.locator('[name="secret"]').fill(`synthetic-ui-${randomUUID()}`);
    await credentialForm.locator('[name="scope"]').selectOption('model.call');
    await credentialForm.getByRole('button', { name: 'Store encrypted' }).click();
    await expect(page.locator('#banner')).toContainText('Local permission does not activate or verify a provider');
    await expect(credentialForm.locator('[name="secret"]')).toHaveValue('');
    const stored = missionDb.get<{ id: string; scope: string }>('SELECT id, scope FROM mission_credentials WHERE label = ?', [credentialLabel])!;
    assert.equal(stored.scope, '["model.call"]');
    await page.locator(`[data-bind-credential="${f.resourceId}"]`).click();
    const binding = page.locator('#resource-credential');
    await binding.getByLabel('Stored provider credential').selectOption(stored.id);
    await binding.getByLabel('Binding reason without secrets').fill('Synthetic owner-approved locally scoped credential binding.');
    await binding.getByRole('button', { name: 'Record credential binding' }).click();
    await expect(binding).toContainText('not provider verification or a purchase');
    checkpoint(name, 'explicit scoped credential creation and owner binding; secret cleared');
    await page.locator(`[data-resource-calls="${f.resourceId}"]`).click();
    const calls = page.locator('#resource-calls');
    await calls.locator(`[data-reconcile-call="${f.uncertain}"]`).click();
    const usageForm = calls.locator('form');
    await expect(usageForm.getByLabel('Actual requests')).toHaveValue('');
    await usageForm.getByRole('button', { name: 'Record actual usage evidence' }).click();
    assert.equal(receiptPosts.length, 0, 'native required fields prevent a guessed-zero receipt');
    await usageForm.getByLabel('Actual provider outcome').selectOption('succeeded');
    await usageForm.getByLabel('Actual requests').fill('1');
    await usageForm.getByLabel('Actual tokens').fill('5');
    await usageForm.getByLabel('Provider usage reference').fill(`synthetic-${name}-usage`);
    await usageForm.getByLabel('Usage evidence without secrets').fill('Synthetic local evidence <img src=x onerror=alert(1)>; not a real provider receipt.');
    await usageForm.getByRole('button', { name: 'Record actual usage evidence' }).click();
    await expect(calls).toContainText('No provider verification, payment or refund');
    assert.equal(receiptPosts.length, 1);
    checkpoint(name, 'native usage validation and actual-usage reconciliation');
    await calls.locator(`[data-record-call-cost="${f.uncertain}"]`).click();
    await expect(calls).toContainText('<img src=x onerror=alert(1)>');
    await expect(calls.locator('img')).toHaveCount(0);
    const costForm = calls.locator('form');
    await expect(costForm.getByLabel('Actual charge in minor units')).toHaveValue('');
    await costForm.getByLabel('Actual charge in minor units').fill('25');
    await costForm.getByLabel('Provider charge reference').fill(`synthetic-${name}-cost`);
    await costForm.getByLabel('Financial evidence without secrets').fill('Synthetic test accounting evidence; no external payment.');
    await costForm.getByRole('button', { name: 'Record evidenced charge — no external payment' }).click();
    await expect(calls).toContainText('No external payment executed');
    assert.equal(getWallet(f.walletId)!.balanceCents, 75);
    await calls.locator(`[data-cancel-call="${f.held}"]`).click();
    await expect(page.locator('#banner')).toContainText('Unstarted quota hold cancelled');
    await expect(calls.locator(`[data-cancel-call="${f.held}"]`)).toHaveCount(0);
    checkpoint(name, 'separate charge accounting and unstarted cancellation');
    await page.locator(`[data-resource-periods="${f.resourceId}"]`).click();
    const periods = page.locator('#resource-periods');
    await expect(periods.getByLabel('Actual renewal charge in minor units')).toHaveValue('');
    await expect(periods.getByLabel('Starting requests usage')).toHaveValue('');
    const start = new Date(Date.now() - 60000).toISOString().slice(0, 16);
    const end = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
    await periods.getByLabel('Provider period start', { exact: true }).fill(start);
    await periods.getByLabel('Provider period end', { exact: true }).fill(end);
    await periods.getByLabel('Actual renewal charge in minor units').fill('0');
    await periods.getByLabel('Starting requests usage').fill('0');
    await periods.getByLabel('Starting tokens usage').fill('0');
    await periods.getByLabel('Renewal charge reference').fill(`synthetic-${name}-renewal`);
    await periods.getByLabel('Provider period evidence without secrets').fill('Synthetic free renewed period; no provider or payment was contacted.');
    await periods.getByRole('button', { name: 'Record evidenced renewal — no purchase' }).click();
    await expect(periods).toContainText('No purchase or external payment executed');
    await expect(periods).toContainText('{"requests":1,"tokens":5}');
    assert.equal(missionDb.get<{ usage: string }>('SELECT usage FROM mission_resources WHERE id = ?', [f.resourceId])!.usage, '{"requests":0,"tokens":0}');
    assert.equal(getWallet(f.walletId)!.balanceCents, 75, 'explicit free period creates no additional charge');
    checkpoint(name, 'evidenced renewal preserves prior usage and starts explicit new counters');
    await page.screenshot({ path: path.join(evidenceDir, `${name}-resource-calls.png`), fullPage: true });
    await page.locator('[data-tab="agents"]').click();
    await page.locator('#agent-list tr').filter({ hasText: f.agentId }).getByRole('button', { name: 'Open report' }).click();
    await page.locator(`[data-chat-config="${f.agentId}"]`).click();
    const settings = page.getByRole('region', { name: 'Automatic reply configuration' });
    await expect(settings.getByLabel('Automatic replies enabled')).toHaveValue('false');
    await expect(settings.getByLabel('Maximum reserved cost in minor units')).toHaveValue('');
    await settings.getByLabel('Assigned Google resource').selectOption(f.resourceId);
    await settings.getByLabel('Assigned funded wallet').selectOption(f.walletId);
    await settings.getByLabel('Maximum reserved cost in minor units').fill('20');
    await settings.getByLabel('Owner-reviewed cost basis').fill('Synthetic test pricing assumption, not a real provider rate.');
    await settings.getByLabel('Automatic replies enabled').selectOption('true');
    page.once('dialog', dialog => dialog.accept());
    await settings.getByRole('button', { name: 'Save reply configuration' }).click();
    await expect(page.locator('#banner')).toContainText('does not activate a provider or prove a live worker');
    const conversation = page.getByRole('region', { name: 'Private agent messages' });
    await conversation.getByLabel('Message to this agent').fill('Synthetic browser test message; no worker or provider is running.');
    await conversation.getByRole('button', { name: 'Send owner message' }).click();
    await expect(conversation).toContainText('Synthetic browser test message; no worker or provider is running.');
    await settings.getByRole('button', { name: 'Refresh reply jobs' }).click();
    await expect(settings).toContainText('queued');
    checkpoint(name, 'explicit chat opt-in and durable message/job display');
    const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.content <= dimensions.viewport + 1, `page overflows viewport: ${JSON.stringify(dimensions)}`);
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.screenshot({ path: path.join(evidenceDir, `${name}-chat-controls.png`), fullPage: true });
    checkpoint(name, 'responsive document and no JavaScript page errors');
    // Separate browser tab/session storage: owner state must not leak into a link.
    const link = createAccessLink({ label: `Synthetic ${name} read-only link`, scope: 'dashboard:read', expiresInHours: 1, createdBy: ownerId });
    const readPage: Page = await context.newPage();
    readPage.on('pageerror', error => errors.push(error.message));
    await readPage.goto(`${base}/#link=${encodeURIComponent(link.token)}`);
    await expect(readPage.locator('#identity')).toContainText('read-only access link');
    assert.equal(new URL(readPage.url()).hash, '');
    await readPage.locator('[data-tab="tools"]').click();
    await expect(readPage.locator('[data-resource-calls], [data-bind-credential], [data-resource-periods]')).toHaveCount(0);
    await expect(readPage.locator('#credential-form')).toBeHidden();
    assert.equal(await readPage.evaluate(async resourceId => (await fetch(`/api/resources/${resourceId}/calls`)).status, f.resourceId), 401);
    assert.equal(await readPage.evaluate(async ({ resourceId, token }) => (await fetch(`/api/resources/${resourceId}/calls`, { headers: { 'x-mission-link': token } })).status, { resourceId: f.resourceId, token: link.token }), 401);
    assert.equal(errors.length, 0, errors.join('\n'));
    checkpoint(name, 'read-only controls hidden; private call API denies anonymous and link access');
  } catch (error) {
    await page.screenshot({ path: path.join(evidenceDir, `${name}-failure.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
async function main() {
  applyMissionMigrations(); seedTools();
  const owner = provisionOwner({ email: process.env.ZA141251SA_OWNER_EMAIL!, password: process.env.ZA141251SA_OWNER_PASSWORD! });
  updatePolicy({ autonomousEnabled: false, killSwitch: false, maxDailySpendCents: 1000000, maxExpenseCents: 10000, requireApprovalAboveCents: 5000 }, owner.id);
  const server = createMissionServer();
  await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  let browser: Browser | undefined;
  try {
    browser = await launch(); evidence.browser = browser.version();
    const selected = process.env.MISSION_BROWSER_VIEWPORT;
    if (selected && !['desktop', 'mobile'].includes(selected)) throw new Error('MISSION_BROWSER_VIEWPORT must be desktop or mobile');
    for (const viewport of selected ? [selected] : ['desktop', 'mobile']) await viewportCheck(browser, `http://127.0.0.1:${address.port}`, viewport, owner.id);
    assert.deepEqual(evidence.externalRequests, [], 'no browser requests may leave the isolated fixture');
    checkpoint('all', 'no external requests; fixture-only verification complete');
  } finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); missionDb.close(); }
}
main().catch(error => {
  evidence.error = error instanceof Error ? error.message : String(error);
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(evidence, null, 2));
  console.error(evidence.error); process.exitCode = 1;
});
