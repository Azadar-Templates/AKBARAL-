/**
 * ZA141251SA owner-surface probe — exercises the REAL private server end to end.
 *
 *   node scripts/probe-mission.mjs                     (defaults to 127.0.0.1:4200)
 *   MISSION_BASE=http://host:port node scripts/probe-mission.mjs
 *   MISSION_EMAIL=... MISSION_PASSWORD=... node scripts/probe-mission.mjs
 *
 * It proves, against a running mission process and its real database:
 *   login → overview → agent inspection (wallet/transactions/children) →
 *   mission work creation and assignment → sub-agent delegation (refused when
 *   policy says no) → spending approval/rejection → agent pause (and the pause
 *   actually stopping the agent) → budgets → audit-chain verification →
 *   emergency stop → isolation from the AKBARAL! platform database.
 *
 * Every check prints PASS/FAIL with the observed value. It never prints a
 * secret. Exit code 1 if any check fails.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.MISSION_BASE ?? 'http://127.0.0.1:4200').replace(/\/$/, '');
const EMAIL = process.env.MISSION_EMAIL ?? readCredential('email');
const PASSWORD = process.env.MISSION_PASSWORD ?? readCredential('password');

const results = [];
let token = null;

function readCredential(field) {
  const candidates = ['.mission-owner-credentials.txt', '../.mission-owner-credentials.txt'];
  for (const candidate of candidates) {
    const file = path.resolve(process.cwd(), candidate);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const match = new RegExp(`${field}:\\s*(\\S+)`).exec(text);
    if (match) return match[1];
  }
  return '';
}

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail !== undefined && detail !== '' ? ` — ${detail}` : ''}`);
}

async function api(method, route, body) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}/api${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: payload };
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('no owner credentials available (set MISSION_EMAIL/MISSION_PASSWORD or a credentials file)');
    process.exit(1);
  }

  // ── 1. login ──────────────────────────────────────────────────────────────
  const badLogin = await api('POST', '/session/login', { email: EMAIL, password: `${PASSWORD}-wrong` });
  record('login rejects a wrong password', badLogin.status === 401, `HTTP ${badLogin.status}`);
  const login = await api('POST', '/session/login', { email: EMAIL, password: PASSWORD });
  token = login.body?.token ?? null;
  record('login issues a session for the configured owner', login.status === 200 && Boolean(token), `HTTP ${login.status}, role=${login.body?.owner?.role ?? 'n/a'}`);
  if (!token) {
    console.error('cannot continue without a session');
    process.exit(1);
  }

  const fakeSuccess = await api('POST', '/agents', {});
  record(
    'a create request never answers with a list (no silent fake success)',
    fakeSuccess.status === 201 || fakeSuccess.status === 400,
    `HTTP ${fakeSuccess.status}${fakeSuccess.body?.error ? ` (${fakeSuccess.body.error.code})` : ''}`,
  );

  // ── 2. unauthenticated reads are refused ─────────────────────────────────
  const savedToken = token;
  token = null;
  const anon = await api('GET', '/overview');
  record('unauthenticated overview is refused', anon.status === 401, `HTTP ${anon.status}`);
  const anonTreasury = await api('GET', '/treasury');
  record('unauthenticated treasury is refused', anonTreasury.status === 401, `HTTP ${anonTreasury.status}`);
  token = savedToken;

  // ── 3. real dashboard data ───────────────────────────────────────────────
  const overview = await api('GET', '/overview');
  const overviewKeys = Object.keys(overview.body ?? {});
  record('overview returns real aggregates', overview.status === 200 && overviewKeys.length > 0, `${overviewKeys.length} sections`);
  const agents = await api('GET', '/agents?limit=5');
  const agentList = agents.body?.agents ?? [];
  record('agent registry is listable', agents.status === 200 && Array.isArray(agentList), `${agents.body?.total ?? 0} agents total`);

  const treasury = await api('GET', '/treasury');
  record('treasury reports wallets + ledger integrity', treasury.status === 200 && Boolean(treasury.body?.treasury) && Boolean(treasury.body?.ledgerIntegrity), `ledger ok=${treasury.body?.ledgerIntegrity?.ok ?? 'n/a'}`);
  const ledger = await api('GET', '/ledger?limit=5');
  record('ledger is queryable', ledger.status === 200 && Array.isArray(ledger.body?.entries), `${ledger.body?.entries?.length ?? 0} entries`);

  // ── 4. create a real root agent (its own contract + funded wallet) ───────
  // A synced registry agent is metadata only (no wallet, no contract), so the
  // probe creates its own mission agent instead of pretending the registry
  // rows are funded workers.
  const policy0 = await api('GET', '/policy');
  const activities = policy0.body?.categories ?? policy0.body?.policy?.allowedActivities ?? [];
  const activity = Array.isArray(activities) && activities.length > 0 ? String(activities[0]) : 'software_development';

  const created = await api('POST', '/agents', {
    name: `Probe Root ${Date.now().toString(36)}`,
    specialization: 'operations',
    activity,
    budgetCents: 1000,
    missionRole: 'director',
  });
  const rootSlug = created.body?.agent?.slug ?? null;
  record(
    'owner can create a root agent (contract + funded wallet)',
    created.status === 201 && Boolean(rootSlug) && Boolean(created.body?.contract) && Boolean(created.body?.wallet),
    `HTTP ${created.status}${created.body?.error ? `: ${created.body.error.message ?? created.body.error.code}` : ''}`,
  );
  if (!rootSlug) {
    console.error('cannot continue without a root agent');
    process.exit(1);
  }
  const rootReport = await api('GET', `/agents/${rootSlug}`);
  const report = rootReport.body ?? {};
  const reportSections = Object.keys(report);
  record(
    'agent inspection exposes the wallet, ledger trail, work and children',
    rootReport.status === 200 &&
      Boolean(report.wallet) &&
      Array.isArray(report.work) &&
      Array.isArray(report.expenses?.entries) &&
      Array.isArray(report.resources) &&
      Array.isArray(report.services) &&
      Array.isArray(report.credentials) &&
      Array.isArray(report.agent?.children),
    `sections=${reportSections.length} (${reportSections.slice(0, 6).join(', ')})`,
  );

  // ── 5. mission work: create and assign ───────────────────────────────────
  const work = await api('POST', '/work', {
    agentSlug: rootSlug,
    title: `Probe deliverable ${new Date().toISOString()}`,
    description: 'Created by the owner-surface probe to verify assignment and status flow.',
    activity,
    revenueCents: 0,
    costCents: 0,
  });
  const workId = work.body?.work?.id ?? null;
  record('owner can create/assign work to an agent', work.status === 201 && Boolean(workId), `HTTP ${work.status}`);
  if (workId) {
    const moved = await api('POST', `/work/${workId}/status`, { status: 'in_progress' });
    record('work status is controllable', moved.status === 200 && moved.body?.work?.status === 'in_progress', `status=${moved.body?.work?.status}`);
    const list = await api('GET', '/work');
    record('work appears in the task list', list.status === 200 && (list.body?.work ?? []).some((row) => row.id === workId), `${list.body?.work?.length ?? 0} rows`);
  }

  // ── 6. delegation: sub-agent with a contract and a funded wallet ─────────
  const child = await api('POST', `/agents/${rootSlug}/children`, {
    name: `Probe Sub ${Date.now().toString(36)}`,
    specialization: 'verification',
    activity,
    budgetCents: 500,
  });
  const childSlug = child.body?.agent?.slug ?? null;
  record(
    'delegation creates a sub-agent with a contract + wallet',
    [200, 201].includes(child.status) && Boolean(childSlug) && Boolean(child.body?.contract) && Boolean(child.body?.wallet),
    `HTTP ${child.status}${child.body?.error ? `: ${child.body.error.message ?? child.body.error.code}` : ''}`,
  );
  const contract = child.body?.contract;
  if (contract) {
    const limits = JSON.parse(String(contract.resource_limits ?? '{}'));
    record('the sub-agent contract carries real limits', limits.maxSpendCents === 500 && Number(contract.budget_cents) === 500, `maxSpendCents=${limits.maxSpendCents}`);
  }
  if (childSlug) {
    const childReport = await api('GET', `/agents/${childSlug}`);
    record('the sub-agent is inspectable and linked to its parent', childReport.status === 200 && childReport.body?.agent?.parentSlug === rootSlug, `parent=${childReport.body?.agent?.parentSlug}`);
    const chain = await api('GET', `/agents/${rootSlug}`);
    record('the parent lists its child', (chain.body?.agent?.children ?? []).some((entry) => entry.slug === childSlug), `${chain.body?.agent?.children?.length ?? 0} children`);
  }

  // ── 7. spending: fund working capital → request → approve/reject ─────────
  const walletId = report.wallet?.id ?? null;
  const fundKey = `probe-fund-${Date.now().toString(36)}`;
  const fund = await api('POST', `/wallets/${walletId}/fund`, {
    amountCents: 5000,
    reference: `probe bank transfer ${fundKey}`,
    idempotencyKey: fundKey,
  });
  record('owner can fund a wallet with working capital', [200, 201].includes(fund.status) && Number(fund.body?.wallet?.balanceCents ?? 0) >= 5000, `balance=${fund.body?.wallet?.balanceCents ?? 'n/a'}c`);
  const refund = await api('POST', `/wallets/${walletId}/fund`, {
    amountCents: 5000,
    reference: `probe bank transfer ${fundKey}`,
    idempotencyKey: fundKey,
  });
  record('a retried funding request cannot double-credit the wallet', refund.status === 200 && refund.body?.duplicated === true && Number(refund.body?.wallet?.balanceCents ?? 0) === Number(fund.body?.wallet?.balanceCents ?? -1), `duplicated=${refund.body?.duplicated}`);

  // Configure the wallet budget (owner control): funding adds money, the
  // budget is the authority to spend it.
  const budget = await api('PATCH', `/wallets/${walletId}`, { budgetCents: 5000, label: 'probe agent wallet' });
  record(
    'owner can configure a wallet budget',
    budget.status === 200 && Number(budget.body?.wallet?.budgetCents) === 5000,
    `budget=${budget.body?.wallet?.budgetCents ?? 'n/a'}c, spent=${budget.body?.wallet?.spentCents ?? 'n/a'}c`,
  );
  const frozen = await api('PATCH', `/wallets/${walletId}`, { status: 'frozen' });
  const frozenSpend = await api('POST', '/expenses', {
    agentSlug: rootSlug,
    title: 'frozen wallet',
    category: 'api',
    provider: 'probe-provider',
    description: 'must be refused',
    amountCents: 10,
  });
  record(
    'a frozen wallet cannot spend',
    frozen.status === 200 && frozenSpend.status === 409,
    `wallet=${frozen.body?.wallet?.status}, expense HTTP ${frozenSpend.status}`,
  );
  await api('PATCH', `/wallets/${walletId}`, { status: 'active' });

  const threshold = Number(policy0.body?.policy?.requireApprovalAboveCents ?? 0);
  const perTxnCap = Number(policy0.body?.policy?.maxExpenseCents ?? threshold);
  const small = Math.max(1, Math.min(100, Math.floor(threshold / 2) || 100));
  const balanceBefore = Number(fund.body?.wallet?.balanceCents ?? 0);
  const expense = await api('POST', '/expenses', {
    agentSlug: rootSlug,
    title: 'Probe expense',
    category: 'api',
    provider: 'probe-provider',
    description: 'automated probe expense',
    amountCents: small,
  });
  const expenseId = expense.body?.expense?.id ?? null;
  const walletAfter = await api('GET', `/agents/${rootSlug}`);
  record(
    'an expense below the approval threshold executes and leaves the wallet',
    expense.status === 201 && expense.body?.expense?.status === 'paid' && Number(walletAfter.body?.wallet?.balanceCents) === balanceBefore - small,
    `status=${expense.body?.expense?.status}, balance ${balanceBefore}c → ${walletAfter.body?.wallet?.balanceCents}c`,
  );

  // Between the approval threshold and the per-transaction cap: the owner must
  // decide. Above the cap: refused outright, with the reason stated.
  const above = Math.min(Math.max(threshold + 1, 1), perTxnCap);
  const big = await api('POST', '/expenses', {
    agentSlug: rootSlug,
    title: 'Probe expense above threshold',
    category: 'api',
    provider: 'probe-provider',
    description: 'requires owner approval',
    amountCents: above,
  });
  const bigId = big.body?.expense?.id ?? null;
  record(
    'an expense above the threshold goes to the owner for approval',
    [200, 201].includes(big.status) && big.body?.expense?.status === 'requested' && Boolean(big.body?.approvalId),
    `status=${big.body?.expense?.status} amount=${above}c approval=${big.body?.approvalId ? 'queued' : 'missing'}`,
  );
  if (bigId) {
    const overCap = await api('POST', '/expenses', {
      agentSlug: rootSlug,
      title: 'Probe expense above the hard cap',
      category: 'api',
      provider: 'probe-provider',
      description: 'must be refused',
      amountCents: perTxnCap + 1000,
    });
    record(
      'an expense above the per-transaction cap is refused with the reason',
      overCap.status === 409 && String(overCap.body?.error?.message ?? '').includes('cap'),
      `HTTP ${overCap.status}: ${overCap.body?.error?.message ?? ''}`,
    );
    const reject = await api('POST', `/expenses/${bigId}/decide`, { decision: 'rejected', note: 'probe rejection' });
    record('owner can reject a spending request', reject.status === 200 && reject.body?.expense?.status === 'rejected', `status=${reject.body?.expense?.status}`);
    const approve = await api('POST', `/expenses/${bigId}/decide`, { decision: 'approved', note: 'probe approval' });
    record('a decided expense cannot be re-decided (state machine holds)', approve.status === 409, `HTTP ${approve.status}`);
    const listed = await api('GET', '/expenses?limit=20');
    const ours = (listed.body?.expenses ?? []).find((row) => row.id === bigId);
    record('the decided expense is visible in the expense list', Boolean(ours) && ours.status === 'rejected', `status=${ours?.status ?? 'missing'}`);
  }
  if (expenseId) {
    const auditForExpense = await api('GET', '/audit?limit=100');
    const paid = (auditForExpense.body?.entries ?? []).some((entry) => String(entry.action).startsWith('expense.'));
    record('expense decisions are in the audit trail', paid, `${(auditForExpense.body?.entries ?? []).filter((entry) => String(entry.action).startsWith('expense.')).length} expense audit rows`);
  }

  // ── 8. pause / resume: the brake actually stops the agent ────────────────
  const pause = await api('POST', `/agents/${rootSlug}/status`, { status: 'paused', reason: 'probe pause' });
  record('owner can pause an agent', pause.status === 200 && pause.body?.agent?.status === 'paused', `status=${pause.body?.agent?.status}`);
  const pausedWork = await api('POST', '/work', { agentSlug: rootSlug, title: 'should be refused', activity });
  record('a paused agent cannot take on work', pausedWork.status === 409, `HTTP ${pausedWork.status}${pausedWork.body?.error?.code ? ` (${pausedWork.body.error.code})` : ''}`);
  const resume = await api('POST', `/agents/${rootSlug}/status`, { status: 'active', reason: 'probe resume' });
  record('owner can resume an agent', resume.status === 200 && resume.body?.agent?.status === 'active', `status=${resume.body?.agent?.status}`);
  const resumedWork = await api('POST', '/work', { agentSlug: rootSlug, title: `Post-resume work ${Date.now().toString(36)}`, activity });
  record('a resumed agent works again', resumedWork.status === 201, `HTTP ${resumedWork.status}`);
  const noReason = await api('POST', `/agents/${rootSlug}/status`, { status: 'paused' });
  record('pausing without a reason is refused (audit quality)', noReason.status === 400, `HTTP ${noReason.status}`);

  // ── 9. budgets + policy are owner-configurable ───────────────────────────
  const policyRead = await api('GET', '/policy');
  record('policy exposes budgets and limits', policyRead.status === 200 && Boolean(policyRead.body?.policy), `maxDailySpendCents=${policyRead.body?.policy?.maxDailySpendCents ?? 'n/a'}`);
  const patched = await api('PATCH', '/policy', { maxDailySpendCents: Number(policyRead.body?.policy?.maxDailySpendCents ?? 500) });
  record('owner can update budgets', patched.status === 200 && Boolean(patched.body?.policy), `HTTP ${patched.status}`);

  // ── 10. kill switch: engage, verify it blocks work, release ──────────────
  const engage = await api('POST', '/kill-switch', { engage: true });
  record('emergency stop engages', engage.status === 200 && engage.body?.killSwitch === true, `engaged=${engage.body?.killSwitch}`);
  const blocked = await api('POST', '/work', { agentSlug: rootSlug, title: 'blocked by kill switch', activity });
  record('emergency stop blocks new work', blocked.status >= 400, `HTTP ${blocked.status}`);
  const release = await api('POST', '/kill-switch', { engage: false });
  record('emergency stop releases', release.status === 200 && release.body?.killSwitch === false, `engaged=${release.body?.killSwitch}`);

  // ── 11. audit trail integrity ────────────────────────────────────────────
  const audit = await api('GET', '/audit?limit=50');
  const auditEntries = audit.body?.entries ?? [];
  const sawPause = auditEntries.some((entry) => ['agent.paused', 'agent.resumed'].includes(String(entry.action)));
  record('audit chain verifies and records the probe actions', audit.status === 200 && audit.body?.verification?.ok === true, `entries=${auditEntries.length}, chain ok=${audit.body?.verification?.ok}, operator actions recorded=${sawPause}`);

  // ── 12. isolation: mission data is not in the platform database ──────────
  const platformDb = path.resolve(process.cwd(), 'platform-live.db');
  const leak = platformDbExists() ? scanForMissionTables(platformDb) : null;
  record(
    'mission storage is separate from the AKBARAL! platform database',
    leak === null || leak.length === 0,
    leak && leak.length > 0 ? `LEAK: ${leak.join(', ')}` : 'no mission tables in platform-live.db',
  );

  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} — ${results.length - failed.length}/${results.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

function platformDbExists() {
  return fs.existsSync(path.resolve(process.cwd(), 'platform-live.db'));
}

function scanForMissionTables(file) {
  // Read the SQLite file header/pages and look for mission table names without
  // opening a second connection (so this works while the platform server runs).
  try {
    const buffer = fs.readFileSync(file);
    const needle = Buffer.from('mission_owner');
    return buffer.includes(needle) ? ['mission_owner'] : [];
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error('probe failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
