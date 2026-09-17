#!/usr/bin/env node
/**
 * ZA141251SA — real-money system verifier (wallet → ledger → governed spend →
 * verified earning → reinvestment → fixed daily target).
 *
 * Everything asserted here is read back from the mission API and, where it
 * matters, from the ledger itself: no figure is taken on trust and nothing is
 * simulated. In particular:
 *   · funding a wallet is owner capital, never revenue;
 *   · an expense above the approval threshold cannot execute until the owner
 *     approves it, and an expense above a policy cap is refused outright;
 *   · revenue is only recorded as received WITH a verifier, and when it is, the
 *     ledger shows the agent credit, the sweep to the treasury and the
 *     reinvestment transfer;
 *   · the fixed daily target counts verified revenue only.
 *
 * Usage: MISSION_BASE=http://127.0.0.1:4200 ZA141251SA_OWNER_EMAIL=... \
 *        ZA141251SA_OWNER_PASSWORD=... node scripts/verify-mission-money.mjs
 */
const BASE = (process.env.MISSION_BASE ?? 'http://127.0.0.1:4200').replace(/\/+$/, '');
const OWNER_EMAIL = (process.env.ZA141251SA_OWNER_EMAIL ?? '').trim().toLowerCase();
const OWNER_PASSWORD = process.env.ZA141251SA_OWNER_PASSWORD ?? '';

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

let token = null;
async function api(method, pathname, body) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* callers inspect text when a non-JSON body is meaningful */
  }
  return { status: response.status, json, text };
}

const money = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;

async function main() {
  if (!OWNER_EMAIL || !OWNER_PASSWORD) {
    console.error('ZA141251SA_OWNER_EMAIL and ZA141251SA_OWNER_PASSWORD must be set (never printed).');
    process.exit(2);
  }
  const login = await api('POST', '/api/session/login', { email: OWNER_EMAIL, password: OWNER_PASSWORD });
  if (login.status !== 200) {
    console.error(`owner sign-in failed (${login.status}) — is the mission server running at ${BASE}?`);
    process.exit(2);
  }
  token = login.json.token;
  console.log(`\nZA141251SA real-money system — verifying ${BASE}\n`);

  // ── 0. Policy baseline for the probe ──────────────────────────────────────
  const policyBefore = (await api('GET', '/api/policy')).json.policy;
  const patch = await api('PATCH', '/api/policy', {
    requireApprovalAboveCents: 2_500,
    maxExpenseCents: 5_000,
    maxDailySpendCents: 100_000,
    reinvestShareBps: 2500,
    dailyRevenueTargetCents: 10_000,
    autonomousEnabled: true,
  });
  check('the owner can configure the money policy (approval threshold, caps, reinvestment share, daily target)', patch.status === 200, `status=${patch.status}`);
  const policy = patch.json?.policy ?? {};
  check('the reinvestment share is persisted', Number(policy.reinvestShareBps) === 2500, `reinvestShareBps=${policy.reinvestShareBps}`);
  check('the daily revenue target is persisted', Number(policy.dailyRevenueTargetCents) === 10_000, `dailyRevenueTargetCents=${policy.dailyRevenueTargetCents}`);

  // ── 1. A real agent with a real wallet ────────────────────────────────────
  const agentName = `Money Probe ${Date.now()}`;
  const firstAllowedActivity = policyBefore.allowedActivities?.[0] ?? 'research_and_analysis';
  const created = await api('POST', '/api/agents', {
    name: agentName,
    specialization: 'treasury verification',
    activity: firstAllowedActivity,
    budgetCents: 10_000,
  });
  check('an agent can be created with a funded (but not yet funded-by-money) wallet', created.status === 201, `status=${created.status} body=${created.text.slice(0, 160)}`);
  const agentId = created.json?.agent?.id;
  check('the agent creation returned a real agent row', Boolean(agentId), `agentId=${agentId}`);

  const wallets = (await api('GET', '/api/wallets')).json.wallets ?? [];
  const wallet = wallets.find((entry) => entry.agentId === agentId);
  check('the agent owns a wallet', Boolean(wallet), `wallets=${wallets.length}`);
  if (!wallet) {
    summary();
    return;
  }
  const fund = await api('POST', `/api/wallets/${wallet.id}/fund`, {
    amountCents: 8_000,
    reference: `owner-capital:money-probe:${wallet.id}`,
    idempotencyKey: `fund-${wallet.id}-1`,
  });
  check('funding a wallet posts owner capital (never revenue)', fund.status === 201 && fund.json?.category === 'owner_capital', `status=${fund.status} category=${fund.json?.category}`);
  const fundReplay = await api('POST', `/api/wallets/${wallet.id}/fund`, {
    amountCents: 8_000,
    reference: `owner-capital:money-probe:${wallet.id}`,
    idempotencyKey: `fund-${wallet.id}-1`,
  });
  check('funding is idempotent (a replayed key does not double-credit)', fundReplay.status === 200 && fundReplay.json?.duplicated === true, `status=${fundReplay.status} duplicated=${fundReplay.json?.duplicated}`);
  const budget = await api('PATCH', `/api/wallets/${wallet.id}`, { budgetCents: 8_000, status: 'active' });
  check('the owner sets the wallet spend ceiling (authority, separate from balance)', budget.status === 200, `status=${budget.status}`);

  // ── 2. Governed spending ──────────────────────────────────────────────────
  const small = await api('POST', '/api/expenses', {
    agentId,
    walletId: wallet.id,
    category: 'api',
    provider: 'google-gemini',
    description: 'model calls under the auto-approval threshold',
    amountCents: 1_000,
    idempotencyKey: `exp-small-${Date.now()}`,
  });
  check('an expense under the auto-approval threshold executes immediately', small.status === 201 && !small.json?.approvalId, `status=${small.status} approvalId=${small.json?.approvalId}`);
  check('the executed expense carries the policy decision it passed', Array.isArray(small.json?.policy?.reasons) && small.json.policy.reasons.length === 0, `reasons=${JSON.stringify(small.json?.policy?.reasons)}`);

  const overCap = await api('POST', '/api/expenses', {
    agentId,
    walletId: wallet.id,
    category: 'api',
    provider: 'google-gemini',
    description: 'expense above the per-transaction cap',
    amountCents: 6_000,
    idempotencyKey: `exp-overcap-${Date.now()}`,
  });
  const overCapRefused =
    (overCap.status === 201 && (overCap.json?.policy?.reasons ?? []).some((reason) => reason.includes('expense_above_per_transaction_cap'))) ||
    (overCap.status === 409 && String(overCap.json?.error?.message ?? '').includes('expense_above_per_transaction_cap'));
  check('an expense above the per-transaction cap is refused with the exact reason', overCapRefused, `status=${overCap.status} body=${overCap.text.slice(0, 180)}`);
  check('the refused expense did not touch the balance', (await api('GET', '/api/wallets')).json.wallets.find((entry) => entry.id === wallet.id).balanceCents === 7_000, 'balance moved for a refused expense');

  const needsApproval = await api('POST', '/api/expenses', {
    agentId,
    walletId: wallet.id,
    category: 'api',
    provider: 'google-gemini',
    description: 'expense above the approval threshold',
    amountCents: 3_000,
    idempotencyKey: `exp-approval-${Date.now()}`,
  });
  check('an expense above the approval threshold is queued for the owner, not executed', needsApproval.status === 201 && Boolean(needsApproval.json?.approvalId), `status=${needsApproval.status} approvalId=${needsApproval.json?.approvalId}`);
  const balanceWhilePending = (await api('GET', '/api/wallets')).json.wallets.find((entry) => entry.id === wallet.id).balanceCents;
  check('the pending expense has not spent anything yet', balanceWhilePending === 7_000, `balance=${balanceWhilePending}`);

  const approvalId = needsApproval.json?.approvalId;
  const decided = await api('POST', `/api/approvals/${approvalId}/decide`, { decision: 'approved', note: 'verified by the owner during the money-system audit' });
  check('the owner can approve the queued expense from the approval queue', decided.status === 200, `status=${decided.status} body=${decided.text.slice(0, 160)}`);
  check(
    'approving in the queue PAYS the expense (no stranded request)',
    decided.json?.expense?.status === 'paid',
    `expense status=${decided.json?.expense?.status} body=${decided.text.slice(0, 200)}`,
  );
  const balanceAfterApproved = (await api('GET', '/api/wallets')).json.wallets.find((entry) => entry.id === wallet.id).balanceCents;
  check('the balance reflects exactly the two executed expenses', balanceAfterApproved === 4_000, `balance=${balanceAfterApproved} (expected 4000 = 8000 − 1000 − 3000)`);
  const doublePay = await api('POST', `/api/expenses/${needsApproval.json?.expense?.id}/decide`, { decision: 'approved', note: 'attempt to pay the same expense twice' });
  check('an already-paid expense cannot be paid twice (no double spend)', doublePay.status === 409, `status=${doublePay.status} body=${doublePay.text.slice(0, 160)}`);
  const balanceAfterDouble = (await api('GET', '/api/wallets')).json.wallets.find((entry) => entry.id === wallet.id).balanceCents;
  check('the double-payment attempt moved no money', balanceAfterDouble === 4_000, `balance=${balanceAfterDouble}`);

  // ── 3. Kill switch is a real brake ────────────────────────────────────────
  const engage = await api('POST', '/api/policy/kill-switch', { engage: true });
  check('the owner can engage the global kill switch', engage.status === 200 && engage.json?.killSwitch === true, `status=${engage.status} killSwitch=${engage.json?.killSwitch}`);
  const blocked = await api('POST', '/api/expenses', {
    agentId,
    walletId: wallet.id,
    category: 'api',
    provider: 'google-gemini',
    description: 'expense while the mission is stopped',
    amountCents: 500,
    idempotencyKey: `exp-kill-${Date.now()}`,
  });
  const killRefused =
    (blocked.status === 201 && blocked.json?.policy?.reasons?.includes('kill_switch_engaged')) ||
    (blocked.status === 409 && String(blocked.json?.error?.message ?? '').includes('kill_switch_engaged'));
  check('while the kill switch is engaged no spend is authorised', killRefused, `status=${blocked.status} body=${blocked.text.slice(0, 160)}`);
  await api('POST', '/api/policy/kill-switch', { engage: false });
  const afterResume = (await api('GET', '/api/policy')).json.policy;
  check('the kill switch can be disengaged and the mission resumes', afterResume.killSwitch === false, `killSwitch=${afterResume.killSwitch}`);

  // ── 4. Verified earning + the reinvestment transfer ───────────────────────
  const unverified = await api('POST', '/api/revenue', { amountCents: 2_000, source: 'client', status: 'received', idempotencyKey: `rev-unverified-${Date.now()}` });
  check('revenue cannot be recorded as received without a verifier', unverified.status === 400, `status=${unverified.status} body=${unverified.text.slice(0, 140)}`);

  const treasurySnapshot = (await api('GET', '/api/treasury')).json;
  const missionWalletBefore = (treasurySnapshot.wallets ?? []).find((entry) => entry.kind === 'mission')?.balanceCents ?? 0;
  const revenue = await api('POST', '/api/revenue', {
    agentId,
    amountCents: 4_001,
    source: 'client',
    status: 'received',
    verifier: 'stripe:pi_verified_by_the_owner_console',
    externalRef: 'pi_money_probe_1',
    idempotencyKey: `rev-verified-${Date.now()}`,
  });
  check('verified revenue is recorded and posted to the ledger', revenue.status === 201 && Boolean(revenue.json?.ledger), `status=${revenue.status} body=${revenue.text.slice(0, 160)}`);
  const expectedShare = Math.floor((4_001 * 2500) / 10_000);
  check(`the reinvestment transfer moved exactly 25 % (${money(expectedShare)})`, Number(revenue.json?.reinvestment?.amountCents) === expectedShare, `reinvestment=${JSON.stringify(revenue.json?.reinvestment?.amountCents)}`);
  const treasurySnapshotAfter = (await api('GET', '/api/treasury')).json;
  const missionWalletAfter = (treasurySnapshotAfter.wallets ?? []).find((entry) => entry.kind === 'mission').balanceCents;
  check(
    'the treasury keeps the revenue minus the reinvestment share (both are real ledger balances)',
    missionWalletAfter === missionWalletBefore + 4_001 - expectedShare,
    `mission wallet before=${missionWalletBefore} after=${missionWalletAfter} (expected ${missionWalletBefore + 4_001 - expectedShare})`,
  );

  const reinvestment = (await api('GET', '/api/reinvestment')).json.reinvestment;
  check('the reinvestment reserve holds real money, not a label', reinvestment.wallet?.balanceCents >= expectedShare && reinvestment.allocatedCents >= expectedShare, `balance=${reinvestment.wallet?.balanceCents} allocated=${reinvestment.allocatedCents}`);
  check('the reserve is funded only by ledger transfers', reinvestment.entries.every((entry) => entry.category === 'reinvestment'), 'a non-reinvestment entry appeared in the reserve');

  // ── 5. Fixed daily target ────────────────────────────────────────────────
  const daily = (await api('GET', '/api/targets')).json.daily;
  check('the daily target board reports the configured target', daily?.configured === true && daily?.targetCents === 10_000, `daily=${JSON.stringify(daily && { configured: daily.configured, target: daily.targetCents })}`);
  check('target progress counts verified revenue only', daily?.realizedCents >= 4_001, `realized=${daily?.realizedCents}`);
  check('a target is labelled as a target, never as an achievement', daily?.label_kind === 'target' && typeof daily?.note === 'string' && daily.note.includes('never presented as achieved'), `label_kind=${daily?.label_kind}`);

  const expected = await api('POST', '/api/revenue', { amountCents: 500_000, source: 'prospect', status: 'expected', verifier: 'owner-attestation:quote', idempotencyKey: `rev-expected-${Date.now()}` });
  check('pipeline revenue can be recorded for planning (expected)', expected.status === 201, `status=${expected.status}`);
  const dailyAfter = (await api('GET', '/api/targets')).json.daily;
  check('an expected pipeline amount does NOT inflate the target progress', dailyAfter.realizedCents === daily.realizedCents, `realized before=${daily.realizedCents} after=${dailyAfter.realizedCents}`);
  check('the expected amount is reported separately and labelled', dailyAfter.expectedCents >= 500_000, `expected=${dailyAfter.expectedCents}`);

  // ── 6. Integrity ─────────────────────────────────────────────────────────
  const treasury = (await api('GET', '/api/treasury')).json;
  check('the ledger hash chain verifies after every movement above', treasury.ledgerIntegrity?.ok === true, `ledgerIntegrity=${JSON.stringify(treasury.ledgerIntegrity)}`);
  const audit = (await api('GET', '/api/audit/verify')).json;
  check('the audit chain verifies after every movement above', audit?.ok === true, `audit=${JSON.stringify(audit)}`);
  const ledger = (await api('GET', '/api/ledger?limit=200')).json.entries ?? [];
  const categories = new Set(ledger.map((entry) => entry.category));
  for (const category of ['owner_capital', 'expense', 'revenue', 'reinvestment']) {
    check(`the ledger contains real \`${category}\` movements`, categories.has(category), `categories=${[...categories].join(', ')}`);
  }

  // Restore the pre-probe policy so the audit leaves the system as it found it.
  await api('PATCH', '/api/policy', {
    requireApprovalAboveCents: policyBefore.requireApprovalAboveCents,
    maxExpenseCents: policyBefore.maxExpenseCents,
    maxDailySpendCents: policyBefore.maxDailySpendCents,
    reinvestShareBps: policyBefore.reinvestShareBps,
    dailyRevenueTargetCents: policyBefore.dailyRevenueTargetCents,
  });

  summary();
}

function summary() {
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    console.log('  failures:');
    for (const failure of failures) console.log(`    · ${failure}`);
    console.log('');
    process.exit(1);
  }
}

await main();
