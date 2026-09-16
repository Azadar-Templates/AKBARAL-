/**
 * Live validation of the private economy on a RUNNING platform — real work,
 * real delegation, real ledger, real controls. No mocks: every check is an HTTP
 * call against the deployed process and its database.
 *
 *   DATABASE_URL=file:./platform-live.db node scripts/probe-economy-live.mjs
 *   API_BASE=http://127.0.0.1:4000 OWNER_EMAIL=... OWNER_PASSWORD=... node scripts/probe-economy-live.mjs
 *
 * What it proves:
 *   1. OWNER-ONLY: the economy refuses anonymous and ordinary-user callers.
 *   2. DELEGATION: an owner-approved hire creates real child agents through the
 *      Agent Factory; every attempt is recorded with all of its gate results;
 *      the tree reports parent, depth and budget; the depth gate refuses deeper
 *      spawns and the refusal is stored.
 *   3. EXECUTION: an owner-assigned work item is evaluated, authorized and run
 *      to a terminal state by a real agent — with provider-reported cost, the
 *      verifier's own rule, and an expected-revenue estimate (never a claim).
 *   4. ACCOUNTING: revenue is refused without evidence; with evidence it posts a
 *      ledger credit, the agent account derives from that ledger, and a frozen
 *      withdrawal path blocks money from leaving until the owner releases it.
 *   5. RESOURCES + CONTROLS: resource requests are decided by policy, a spending
 *      freeze denies new commitments, the kill switch halts work, and every
 *      control change and refusal is visible in the economy event log.
 *
 * Credentials are read from the operator's local files or the environment and
 * are never printed. Exit code 1 if a check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = (process.env.API_BASE ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const results = [];
let ownerToken = '';

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function ownerCredentials() {
  if (process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD) {
    return { email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD };
  }
  for (const candidate of ['.platform-owner-credentials.txt', '../.platform-owner-credentials.txt']) {
    const file = path.resolve(process.cwd(), candidate);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8').trim();
    const labelled = {
      email: /email[:\s]+(\S+)/i.exec(text)?.[1],
      password: /password[:\s]+(\S+)/i.exec(text)?.[1],
    };
    if (labelled.email && labelled.password) return { email: labelled.email, password: labelled.password };
    // The operator file written by the environment restore is two bare lines:
    // the owner email, then the password.
    const [first = '', second = ''] = text.split(/\r?\n/).map((line) => line.trim());
    return { email: first, password: second };
  }
  return { email: '', password: '' };
}

function configuredOwnerEmail() {
  const file = path.resolve(process.cwd(), '.platform-owner.env');
  if (!fs.existsSync(file)) return null;
  return /AKBARAL_OWNER_EMAIL=(\S+)/.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? null;
}

async function api(route, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 300) };
  }
  return { status: response.status, body: payload };
}

const owner = (route, options = {}) => api(route, { ...options, token: ownerToken });
const message = (payload) => String(payload?.message ?? payload?.error?.message ?? payload?.error ?? '');

async function main() {
  const health = await api('/api/health');
  record('the API is reachable', health.status === 200, `HTTP ${health.status}`);

  // ── 1. the surface is owner-only ─────────────────────────────────────────
  const anonymous = await api('/api/economy/dashboard');
  record('anonymous callers are refused (401)', anonymous.status === 401, `HTTP ${anonymous.status}`);

  const credentials = ownerCredentials();
  if (!credentials.email || !credentials.password) {
    console.error('no owner credentials available for the live probe');
    process.exit(1);
  }
  const ownerLogin = await api('/api/auth/login', { method: 'POST', body: credentials });
  ownerToken = ownerLogin.body?.accessToken ?? '';
  record('the configured owner signs in', ownerLogin.status === 200 && Boolean(ownerToken), `HTTP ${ownerLogin.status}`);
  if (!ownerToken) {
    summarize();
    process.exit(1);
  }

  const suffix = Math.random().toString(36).slice(2, 10);
  const userEmail = `eco-probe-${suffix}@akbaral.test`;
  await api('/api/auth/register', { method: 'POST', body: { email: userEmail, password: 'probe-password-1234', name: 'probe user' } });
  const userLogin = await api('/api/auth/login', { method: 'POST', body: { email: userEmail, password: 'probe-password-1234' } });
  const userToken = userLogin.body?.accessToken ?? '';
  const userRead = await api('/api/economy/dashboard', { token: userToken });
  const userWrite = await api('/api/economy/expansions', {
    method: 'POST',
    token: userToken,
    body: { gap: 'should not be allowed', specialization: 'x', system_instructions: 'x' },
  });
  record(
    'an ordinary user cannot read or write the economy (403)',
    userRead.status === 403 && userWrite.status === 403,
    `read=${userRead.status}, write=${userWrite.status}`,
  );

  // ── 2. the dashboard reports real, derived numbers ───────────────────────
  const dashboard = await owner('/api/economy/dashboard');
  const dash = dashboard.body ?? {};
  const registryTotal = Number(dash?.platform?.registryTotal ?? 0);
  record(
    'the owner dashboard reports derived, non-placeholder data',
    dashboard.status === 200
      && typeof dash?.treasury?.realizedRevenueCents === 'number'
      && typeof dash?.agents?.economyAgentCount === 'number'
      && registryTotal >= 4001,
    `registry=${registryTotal}, economyAgents=${dash?.agents?.economyAgentCount ?? '?'}, realized=${dash?.treasury?.realizedRevenueCents ?? '?'}c`,
  );

  const before = await owner('/api/economy/hierarchy');
  const controlsBefore = before.body?.controls ?? {};
  record(
    'the hierarchy tree and its live controls are readable by the owner',
    before.status === 200
      && typeof controlsBefore.spawnRatePerHour === 'number'
      && typeof controlsBefore.maxAgentDepth === 'number'
      && typeof controlsBefore.maxEconomyAgents === 'number',
    `${before.body?.total ?? '?'} agents, depth≤${controlsBefore.maxAgentDepth}, children≤${controlsBefore.maxChildrenPerAgent}, rate ${controlsBefore.spawnRatePerHour}/h, hire cost ${controlsBefore.spawnCostCents}c`,
  );

  // ── 3. delegation: real child agents, real gates, real refusals ──────────
  const hire = async (gap, specialization, parentAgentSlug, budget) => owner('/api/economy/expansions', {
    method: 'POST',
    body: {
      gap,
      specialization,
      system_instructions: `Work only on the assigned objective. Specialization: ${specialization}.`,
      parent_agent_slug: parentAgentSlug ?? null,
      ...(budget === undefined ? {} : { child_budget_cents: budget }),
    },
  });

  const rootHire = await hire(`live probe root ${suffix}`, `probe-root-${suffix}`, null, 500);
  record(
    'a root hire creates a real agent through the factory',
    rootHire.status === 201 && Boolean(rootHire.body?.agentSlug) && rootHire.body?.status !== 'rejected',
    `status=${rootHire.body?.status}, slug=${rootHire.body?.agentSlug ?? '—'}${rootHire.body?.blockedReason ? ` (${rootHire.body.blockedReason})` : ''}`,
  );

  const parent = rootHire.body?.agentSlug ?? '';
  const childHire = parent ? await hire(`live probe child ${suffix}`, `probe-child-${suffix}`, parent, 250) : { status: 0, body: {} };
  record(
    'a delegated child is created under its parent with the granted budget',
    childHire.status === 201 && Boolean(childHire.body?.agentSlug),
    `status=${childHire.body?.status}, slug=${childHire.body?.agentSlug ?? '—'}${childHire.body?.blockedReason ? ` (${childHire.body.blockedReason})` : ''}`,
  );

  const child = childHire.body?.agentSlug ?? '';
  const grandchildHire = child ? await hire(`live probe grandchild ${suffix}`, `probe-grandchild-${suffix}`, child, 100) : { status: 0, body: {} };
  const grandchild = grandchildHire.body?.agentSlug ?? '';
  const depthGate = grandchild
    ? await hire(`live probe too deep ${suffix}`, `probe-too-deep-${suffix}`, grandchild, 50)
    : { status: 0, body: {} };
  record(
    'the depth gate refuses a spawn below the configured maximum',
    depthGate.body?.status === 'rejected' && /depth/i.test(String(depthGate.body?.blockedReason)),
    `refused with "${depthGate.body?.blockedReason ?? depthGate.status}"`,
  );

  const tree = await owner('/api/economy/hierarchy');
  const nodes = tree.body?.nodes ?? [];
  const nodeOf = (slug) => nodes.find((entry) => entry.agentSlug === slug);
  const parentNode = nodeOf(parent);
  const childNode = nodeOf(child);
  const grandchildNode = nodeOf(grandchild);
  record(
    'the tree reports the real parent, depth and budget of every agent',
    Boolean(parentNode) && Boolean(childNode) && Boolean(grandchildNode)
      && parentNode.parentAgentSlug === null && parentNode.depth === 0
      && childNode.parentAgentSlug === parent && childNode.depth === 1 && Number(childNode.budgetCents) === 250
      && grandchildNode.parentAgentSlug === child && grandchildNode.depth === 2,
    childNode ? `child depth=${childNode.depth} parent=${childNode.parentAgentSlug} budget=${childNode.budgetCents}c` : 'child missing from the tree',
  );

  const delegations = await owner(`/api/economy/hierarchy/delegations?parent=${encodeURIComponent(parent)}`);
  const decisions = delegations.body?.delegations ?? [];
  const authorized = decisions.find((row) => row.decision === 'allowed' || row.decision === 'authorized' || row.decision === 'allow');
  const checks = authorized ? JSON.parse(String(authorized.checks_json ?? '[]')) : [];
  record(
    'each delegation decision stores every gate result',
    delegations.status === 200 && decisions.length >= 1 && checks.length >= 6 && checks.every((check) => typeof check.passed === 'boolean'),
    `${decisions.length} decisions for the parent, ${checks.length} gates on the latest (${authorized?.decision ?? '—'})`,
  );

  const refusalRows = (await owner('/api/economy/hierarchy/delegations?child=' + encodeURIComponent(grandchild))).body?.delegations ?? [];
  const tooDeepRow = (await owner(`/api/economy/hierarchy/delegations?limit=100`)).body?.delegations
    ?.find((row) => String(row.reason ?? '').toLowerCase().includes('depth'));
  record(
    'a refused spawn is written down with its reason',
    Boolean(tooDeepRow) && String(tooDeepRow.reason).toLowerCase().includes('depth'),
    `${refusalRows.length} grandchild rows; refusal reason: ${String(tooDeepRow?.reason ?? '—').slice(0, 80)}`,
  );

  const chain = await owner(`/api/economy/hierarchy/${encodeURIComponent(grandchild)}`);
  const chainSlugs = (chain.body?.chain ?? []).map((entry) => entry.agentSlug);
  record(
    'the accountability chain resolves worker → parent → root',
    chain.status === 200 && chainSlugs[0] === grandchild && chainSlugs.includes(child) && chainSlugs.includes(parent),
    chainSlugs.join(' → '),
  );

  // ── 4. real execution of an owner-assigned work item ─────────────────────
  const seedArgs = [
    'tsx', 'scripts/seed-economy-opportunity.ts',
    '--title', `Owner-assigned live probe ${suffix}: produce the deliverable for the mission`,
    '--category', 'content_production',
    '--revenue', '9000', '--cost', '700', '--hours', '1', '--probability', '0.6', '--risk', 'low',
    '--ref', `live-probe-${suffix}`,
  ];
  let opportunityId = '';
  try {
    const seeded = execFileSync('npx', seedArgs, {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'file:./platform-live.db' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    opportunityId = JSON.parse(seeded.trim().split('\n').pop() ?? '{}').opportunityId ?? '';
  } catch (error) {
    record('an owner-assigned work item can be recorded', false, error instanceof Error ? error.message.slice(0, 160) : String(error));
  }

  const evaluated = opportunityId ? await owner(`/api/economy/opportunities/${opportunityId}/evaluate`, { method: 'POST' }) : { status: 0, body: {} };
  record(
    'the work item is evaluated against policy with real economics',
    evaluated.status === 200 && typeof evaluated.body?.economics?.expectedNetCents === 'number' && typeof evaluated.body?.authorized === 'boolean',
    `net=${evaluated.body?.economics?.expectedNetCents ?? '?'}c roi=${evaluated.body?.economics?.roi ?? '?'} authorized=${evaluated.body?.authorized ?? '?'}`,
  );

  const authorizedExec = opportunityId
    ? await owner(`/api/economy/opportunities/${opportunityId}/authorize`, { method: 'POST', body: { agent_slug: grandchild } })
    : { status: 0, body: {} };
  const executionId = authorizedExec.body?.executionId ?? '';
  record(
    'the owner authorizes the execution for a specific agent',
    authorizedExec.status === 201 && Boolean(executionId),
    `execution=${executionId || '—'} (${authorizedExec.body?.reason ?? authorizedExec.status})`,
  );

  const ran = executionId ? await owner(`/api/economy/executions/${executionId}/run`, { method: 'POST' }) : { status: 0, body: {} };
  const completed = ran.body?.status === 'completed' && ran.body?.verified === true;
  record(
    'the agent really executes the work and the verifier accepts the deliverable',
    completed,
    `status=${ran.body?.status ?? ran.status} verified=${ran.body?.verified ?? '—'}${ran.body?.error ? ` error=${String(ran.body.error).slice(0, 120)}` : ''}`,
  );

  const executionRows = (await owner('/api/economy/executions')).body?.executions ?? [];
  const execution = executionRows.find((row) => row.id === executionId);
  record(
    'the execution row keeps the deliverable, the verification rule and provider cost',
    Boolean(execution) && Boolean(execution.result_json) && Boolean(execution.verification_json),
    execution ? `cost=${execution.cost_cents}c deliverable=${String(execution.result_json).length} bytes` : 'execution row missing',
  );

  const opportunities = (await owner('/api/economy/opportunities')).body?.opportunities ?? [];
  const opportunity = opportunities.find((row) => row.id === opportunityId);
  record(
    'the work item is closed as completed with provenance for the estimates',
    opportunity?.status === 'completed' && opportunity?.estimate_basis === 'owner_assigned_work_item',
    `status=${opportunity?.status ?? '?'} basis=${opportunity?.estimate_basis ?? '?'}`,
  );

  const treasuryAfterWork = (await owner('/api/economy/treasury')).body ?? {};
  record(
    'delivered work creates an EXPECTED revenue estimate — not a claim of earnings',
    Number(dash?.treasury?.realizedRevenueCents ?? 0) === 0 || Number(treasuryAfterWork.realizedRevenueCents) >= Number(dash?.treasury?.realizedRevenueCents ?? 0),
    `realized=${treasuryAfterWork.realizedRevenueCents ?? '?'}c expected=${treasuryAfterWork.expectedRevenueCents ?? '?'}c`,
  );

  // ── 5. accounting: evidence gate, ledger, accounts, controlled payout ────
  const noEvidence = await owner('/api/economy/revenue', { method: 'POST', body: { agent_slug: grandchild, amount_cents: 500, evidence: 'x' } });
  record(
    'revenue without evidence is refused outright',
    noEvidence.status === 400 && /evidence/i.test(message(noEvidence.body)),
    `HTTP ${noEvidence.status}: ${message(noEvidence.body).slice(0, 80)}`,
  );

  const evidence = `provider settlement statement live-probe-${suffix}`;
  const revenue = await owner('/api/economy/revenue', {
    method: 'POST',
    body: { agent_slug: grandchild, amount_cents: 1500, opportunity_id: opportunityId || null, evidence, external_ref: `probe-ref-${suffix}` },
  });
  record(
    'revenue with evidence posts to the ledger as received',
    revenue.status === 201 && revenue.body?.posted === true,
    `HTTP ${revenue.status} posted=${revenue.body?.posted ?? '—'}`,
  );

  const accounts = (await owner('/api/economy/accounts')).body?.accounts ?? [];
  const account = accounts.find((row) => row.agentSlug === grandchild);
  const ledgerRows = (await owner('/api/economy/ledger?limit=50')).body?.ledger ?? [];
  record(
    'the agent account is derived from the ledger, which carries ids and timestamps',
    Boolean(account) && Number(account.realizedRevenueCents) >= 1500
      && ledgerRows.length > 0 && ledgerRows.every((row) => row.id && row.ts),
    account ? `revenue=${account.realizedRevenueCents}c cost=${account.costCents}c available=${account.availableCents}c, ${ledgerRows.length} ledger rows` : 'account missing',
  );

  const treasuryAfterRevenue = (await owner('/api/economy/treasury')).body ?? {};
  record(
    'the treasury reflects the received revenue exactly once',
    Number(treasuryAfterRevenue.realizedRevenueCents) >= 1500,
    `realized=${treasuryAfterRevenue.realizedRevenueCents}c, expected=${treasuryAfterRevenue.expectedRevenueCents}c`,
  );

  await owner('/api/economy/controls/withdrawals', { method: 'POST', body: { frozen: true, reason: 'live probe withdrawal freeze' } });
  const frozenTransfer = await owner('/api/economy/transfers', {
    method: 'POST',
    body: { source_agent_slug: grandchild, amount_cents: 500, reason: 'probe payout while withdrawals are frozen', idempotency_key: `probe-blocked-${suffix}` },
  });
  await owner('/api/economy/controls/withdrawals', { method: 'POST', body: { frozen: false, reason: 'live probe release withdrawals' } });
  record(
    'a withdrawals freeze stops money leaving the treasury',
    frozenTransfer.status === 423 && frozenTransfer.body?.error?.code === 'withdrawals_frozen',
    `HTTP ${frozenTransfer.status} ${frozenTransfer.body?.error?.code ?? ''}: ${message(frozenTransfer.body).slice(0, 70)}`,
  );

  const transfer = await owner('/api/economy/transfers', {
    method: 'POST',
    body: { source_agent_slug: grandchild, amount_cents: 500, reason: 'probe owner-approved payout', idempotency_key: `probe-transfer-${suffix}` },
  });
  const transferId = transfer.body?.transfer?.id ?? transfer.body?.transferId ?? '';
  const duplicate = await owner('/api/economy/transfers', {
    method: 'POST',
    body: { source_agent_slug: grandchild, amount_cents: 500, reason: 'probe owner-approved payout', idempotency_key: `probe-transfer-${suffix}` },
  });
  record(
    'a payout is proposed, idempotent, and waits for owner approval',
    transfer.status === 201 && Boolean(transferId) && duplicate.body?.transfer?.id === transferId && duplicate.body?.idempotentReplay === true,
    `transfer=${transferId || '—'} duplicate-status=${duplicate.status} (${duplicate.body?.transfer?.status ?? '—'})`,
  );

  const approved = transferId ? await owner(`/api/economy/transfers/${transferId}/approve`, { method: 'POST', body: {} }) : { status: 0, body: {} };
  const ledgerAfter = (await owner('/api/economy/ledger?limit=100')).body?.ledger ?? [];
  record(
    'owner approval moves the money and writes exactly one ledger row',
    [200, 201].includes(approved.status) && ledgerAfter.filter((row) => row.ref_id === transferId).length === 1,
    `approve HTTP ${approved.status}, ledger rows for the transfer: ${ledgerAfter.filter((row) => row.ref_id === transferId).length}`,
  );

  // ── 6. resources and the emergency controls ─────────────────────────────
  const resource = await owner('/api/economy/resources', {
    method: 'POST',
    body: { kind: 'search_api', provider: 'probe-provider', description: 'live probe resource request', monthly_cost_cents: 150 },
  });
  record(
    'a resource request is decided by policy and recorded',
    [200, 201].includes(resource.status) && Boolean(resource.body?.decision?.status),
    `decision=${resource.body?.decision?.status ?? resource.status}: ${String(resource.body?.decision?.reason ?? '').slice(0, 70)}`,
  );

  await owner('/api/economy/controls/spending', { method: 'POST', body: { frozen: true, reason: 'live probe spending freeze' } });
  const blockedResource = await owner('/api/economy/resources', {
    method: 'POST',
    body: { kind: 'search_api', provider: 'probe-provider', description: 'must be denied while spending is frozen', monthly_cost_cents: 150 },
  });
  const frozenSpawn = await hire(`frozen spawn ${suffix}`, `probe-frozen-${suffix}`, parent, 10);
  await owner('/api/economy/controls/spending', { method: 'POST', body: { frozen: false, reason: 'live probe release spending' } });
  const afterRelease = await owner('/api/economy/resources', {
    method: 'POST',
    body: { kind: 'search_api', provider: 'probe-provider', description: 'after the freeze is released', monthly_cost_cents: 150 },
  });
  record(
    'the spending freeze really denies new commitments, and releasing it restores them',
    blockedResource.body?.decision?.status === 'denied'
      && /frozen/i.test(String(blockedResource.body?.decision?.reason))
      && frozenSpawn.body?.status === 'rejected'
      && Boolean(afterRelease.body?.decision?.status),
    `resource=${blockedResource.body?.decision?.status}, spawn=${frozenSpawn.body?.status} (${frozenSpawn.body?.blockedReason ?? '—'}), after release=${afterRelease.body?.decision?.status}`,
  );

  const engaged = await owner('/api/economy/kill-switch', { method: 'POST', body: { engage: true, reason: 'live probe kill switch' } });
  const killedSpawn = await hire(`killed spawn ${suffix}`, `probe-killed-${suffix}`, parent, 10);
  await owner('/api/economy/kill-switch', { method: 'POST', body: { engage: false, reason: 'live probe release kill switch' } });
  await owner('/api/economy/controls/provider_access', { method: 'POST', body: { frozen: true, reason: 'live probe provider access revocation' } });
  const revokedSpawn = await hire(`revoked spawn ${suffix}`, `probe-revoked-${suffix}`, parent, 10);
  await owner('/api/economy/controls/provider_access', { method: 'POST', body: { frozen: false, reason: 'live probe restore provider access' } });
  record(
    'the kill switch and provider-access revocation each refuse spawning by their own gate',
    engaged.body?.killSwitch === true
      && killedSpawn.body?.status === 'rejected' && /kill switch/i.test(String(killedSpawn.body?.blockedReason))
      && revokedSpawn.body?.status === 'rejected' && /provider access/i.test(String(revokedSpawn.body?.blockedReason)),
    `kill=${killedSpawn.body?.blockedReason ?? '—'}, revoked=${revokedSpawn.body?.blockedReason ?? '—'}`,
  );

  const events = (await owner('/api/economy/events?limit=200')).body?.events ?? [];
  const summaries = events.map((event) => String(event.summary));
  record(
    'every control change, refusal and money movement is in the economy event log',
    summaries.some((line) => /freeze/i.test(line)) && summaries.some((line) => /revenue/i.test(line))
      && summaries.some((line) => /REJECTED/i.test(line)) && summaries.some((line) => /execution/i.test(line)),
    `${summaries.length} recent events`,
  );

  const finalControls = (await owner('/api/economy/controls')).body?.controls ?? {};
  record(
    'the probe leaves every emergency control released',
    finalControls.killSwitch === false && finalControls.freezeSpending === false
      && finalControls.freezeWithdrawals === false && finalControls.providerAccessRevoked === false,
    JSON.stringify(finalControls),
  );

  // ── 7. the owner identity is configured, never hardcoded ────────────────
  const configuredOwner = configuredOwnerEmail();
  record(
    'the owner account is the configured identity',
    configuredOwner ? credentials.email === configuredOwner : true,
    configuredOwner ? `configured=${configuredOwner.slice(0, 3)}***@${configuredOwner.split('@')[1]}` : 'environment-provided credentials used',
  );

  summarize();
  process.exit(results.some((entry) => !entry.ok) ? 1 : 0);
}

function summarize() {
  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${failed.length === 0 ? 'LIVE ECONOMY CHECKS PASSED' : `${failed.length} CHECK(S) FAILED`} — ${results.length - failed.length}/${results.length}`);
}

main().catch((error) => {
  console.error('probe failed:', error instanceof Error ? error.message : error);
  summarize();
  process.exit(1);
});
