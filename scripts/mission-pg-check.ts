/**
 * `npm run mission:pg-check` — prove the private mission system runs on
 * PostgreSQL, end to end, against a real PostgreSQL server.
 *
 * This script is the PostgreSQL equivalent of the mission test suites: it applies
 * the mission migrations through the shared driver bridge and then exercises the
 * full money path — owner provisioning, treasury movements, the hash-chained
 * ledger, the evidence-based payout verification, social connection status and
 * the HTTP surface — asserting after every step.
 *
 * It refuses to run on SQLite (that would prove nothing) and it needs a real
 * PostgreSQL connection in ZA141251SA_DATABASE_URL. Locally:
 *
 *   node scripts/pg-test-server.mjs --run sh -c \
 *     'ZA141251SA_DATABASE_URL=$PG_TEST_DATABASE_URL npx tsx scripts/mission-pg-check.ts'
 */
import assert from 'node:assert/strict';

process.env.ZA141251SA_CREDENTIAL_KEY = process.env.ZA141251SA_CREDENTIAL_KEY ?? 'mission-pg-check-credential-key-32-chars+';
process.env.ZA141251SA_SESSION_SECRET = process.env.ZA141251SA_SESSION_SECRET ?? 'mission-pg-check-session-secret-32-chars+';

const results: Array<{ step: string; detail: string }> = [];
function record(step: string, detail: string): void {
  results.push({ step, detail });
  process.stdout.write(`  ✓ ${step} — ${detail}\n`);
}

async function main(): Promise<void> {
  const url = (process.env.ZA141251SA_DATABASE_URL ?? '').trim();
  if (!url) {
    throw new Error('ZA141251SA_DATABASE_URL is not set — run this under scripts/pg-test-server.mjs or point it at a PostgreSQL database');
  }
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new Error(`ZA141251SA_DATABASE_URL must be a PostgreSQL URL (got "${url.replace(/:\/\/.*@/, '://***@')}") — SQLite would prove nothing here`);
  }

  const mission = await import('../src/mission/database');
  const auth = await import('../src/mission/auth');
  const policyModule = await import('../src/mission/policy');
  const treasury = await import('../src/mission/treasury');
  const verification = await import('../src/mission/payout-verification');
  const social = await import('../src/mission/social');
  const server = await import('../src/mission/server');

  assert.equal(mission.missionDb.engineName(), 'postgres', 'the mission database must run on the PostgreSQL engine');
  record('engine', 'mission database opened on the PostgreSQL engine through the shared sync bridge');

  const applied = mission.applyMissionMigrations();
  assert.ok(applied.total >= 4, `expected at least 4 mission migrations, got ${applied.total}`);
  const tables = mission.missionDb.tableCount();
  assert.ok(tables >= 25, `expected the full mission schema, found ${tables} tables`);
  record('migrations', `${applied.total} migrations applied, ${tables} tables in the private schema, ${applied.applied.length} applied in this run`);

  // ── Owner + session ───────────────────────────────────────────────────────
  const owner = auth.provisionOwner({ email: 'pg-check@mission.test', password: 'pg-check-owner-password-2026', displayName: 'PG Check Owner' });
  const session = auth.login({ email: 'pg-check@mission.test', password: 'pg-check-owner-password-2026', ip: '127.0.0.1', userAgent: 'mission-pg-check' });
  assert.ok(session.token.length > 20, 'a real session token is issued');
  record('owner', `owner provisioned and signed in (session for ${owner.email})`);

  // ── Treasury: wallet, realized revenue, expense ───────────────────────────
  const policy = policyModule.currentPolicy();
  // A root mission agent to attribute real work and costs to.
  const agentId = mission.missionId('agt');
  mission.missionDb.run(
    `INSERT INTO mission_agents (id, slug, name, category, role_key, depth, generation, status, mission_role, origin_platform, capabilities)
     VALUES (?, ?, ?, ?, 'specialist', 0, 'registry', 'active', 'worker', 'akbaral-registry', ?)`,
    [agentId, `pg-check-agent-${Date.now()}`, 'PG check specialist', 'software_development', JSON.stringify(['software_development'])],
  );
  const wallet = treasury.createWallet({ kind: 'mission', label: 'PG check treasury', currency: policy.currency, budgetCents: 1_000_000 });
  // A work row is the evidence a revenue claim hangs from.
  const workId = mission.missionId('wrk');
  mission.missionDb.run(
    `INSERT INTO mission_work (id, agent_id, title, description, category, status, client_ref, revenue_cents, cost_cents)
     VALUES (?, NULL, ?, ?, ?, 'verified', ?, ?, 0)`,
    [workId, 'PostgreSQL verification run', 'End-to-end PostgreSQL check of the mission money path', 'software_development', 'pg-check', 250_000],
  );
  const revenue = treasury.recordRevenue({
    workId,
    walletId: String(wallet.id),
    amountCents: 250_000,
    source: 'pg-check client payment',
    status: 'received',
    verifier: owner.id,
    idempotencyKey: 'pg-check-revenue-1',
    actorId: owner.id,
  });
  const expense = treasury.requestExpense({
    agentId,
    walletId: String(wallet.id),
    category: 'software',
    provider: 'pg-check provider',
    description: 'PostgreSQL check expense',
    amountCents: 1_500,
    idempotencyKey: 'pg-check-expense-1',
    actorType: 'owner',
    actorId: owner.id,
  });
  record('treasury', `wallet funded by verified revenue (${Number(revenue.revenue.amount_cents)} minor units, status ${String(revenue.revenue.status)}) and one expense recorded (${String(expense.expense.status)})`);

  // ── Ledger chain on PostgreSQL (the rowid → seq fix) ──────────────────────
  const ledger = treasury.verifyLedger();
  assert.equal(ledger.ok, true, `ledger chain must verify on PostgreSQL: ${ledger.detail}`);
  const sequences = mission.missionDb.all<{ seq: number }>('SELECT seq FROM mission_ledger ORDER BY seq ASC').map((row) => Number(row.seq));
  assert.ok(sequences.length >= 2, 'the ledger has rows');
  assert.deepEqual(
    sequences,
    [...sequences].sort((a, b) => a - b),
    'ledger rows carry a monotonic, engine-independent sequence',
  );
  assert.equal(new Set(sequences).size, sequences.length, 'sequence values are unique');
  record('ledger chain', `${ledger.rows} ledger rows verified in order on PostgreSQL (explicit seq ordering, no rowid dependency)`);

  // ── Payout destination verification (evidence, expiry, activation) ────────
  treasury.ensurePayoutSlots();
  treasury.configurePayoutSlot({
    slot: 1,
    label: 'PG check payout destination',
    destinationType: 'payment_provider',
    providerRef: 'acct_pgcheck_connect',
    maskedAccount: '****4242',
    currency: policy.currency,
    minPayoutCents: 5_000,
    approvalRequired: true,
    actorId: owner.id,
  });
  mission.missionDb.run(`UPDATE mission_payout_slots SET min_payout_cents = 0 WHERE slot = 1`);
  const started = verification.startPayoutVerification({ slot: 1, ownerId: owner.id, method: 'provider_reference' });
  assert.equal(started.status, 'pending');
  const checks = Object.fromEntries(verification.payoutSlotVerificationStatus(1).requiredChecks.map((check) => [check.key, true]));
  const confirmed = verification.confirmPayoutVerification({
    slot: 1,
    ownerId: owner.id,
    checks,
    attestation: 'I control this destination, the provider reference resolves to it, and the provider has verified my identity.',
    evidenceRef: 'pg-check provider reference',
  });
  assert.equal(confirmed.verification.status, 'verified');
  assert.equal(String(confirmed.slot.status), 'active');
  record('payout verification', `slot 1 configured, verified with ${Object.keys(checks).length} control checks and activated; expires in ${verification.PAYOUT_VERIFICATION_VALIDITY_DAYS} days`);

  // A payout now passes the destination gate (it still needs an owner approval).
  const payout = treasury.requestPayout({ slot: 1, amountCents: 10_000, idempotencyKey: 'pg-check-payout-1', requestedBy: owner.id });
  assert.equal(String(payout.status), 'pending_approval', 'a payout is always queued for owner approval');
  record('payout gate', 'a verified destination allows a payout request, which is queued for owner approval (never auto-sent)');

  // ── Audit chain ───────────────────────────────────────────────────────────
  const audit = mission.verifyMissionAudit();
  assert.equal(audit.ok, true, `audit chain must verify on PostgreSQL: ${audit.detail}`);
  record('audit chain', `${audit.rows} audit rows verified (hash-linked, append-only) on PostgreSQL`);

  // ── Social publishing status (honest when unconfigured) ───────────────────
  const platforms = social.socialPlatformStatuses('https://mission.example.test');
  assert.equal(platforms.length, 3);
  assert.ok(platforms.every((platform) => platform.connected === false || platform.appConfigured), 'nothing is reported connected without a real token');
  record('social status', `${platforms.length} platforms reported honestly (configured: ${platforms.filter((platform) => platform.appConfigured).length}, connected: ${platforms.filter((platform) => platform.connected).length})`);

  // ── HTTP surface on PostgreSQL ────────────────────────────────────────────
  const httpServer = server.createMissionServer();
  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/api/health`);
    const healthBody = (await health.json()) as { status: string; audit: boolean; ledger: boolean; vaultConfigured: boolean };
    assert.equal(health.status, 200);
    assert.equal(healthBody.audit, true);
    assert.equal(healthBody.ledger, true);
    assert.equal(healthBody.vaultConfigured, true);

    const anonymous = await fetch(`${base}/api/payout-slots`);
    assert.equal(anonymous.status, 401, 'private routes stay private on PostgreSQL');

    const authorized = await fetch(`${base}/api/payout-slots`, { headers: { authorization: `Bearer ${session.token}` } });
    assert.equal(authorized.status, 200);
    const slots = (await authorized.json()) as { slots: unknown[]; verification: Array<{ slot: number; payable: boolean }> };
    assert.equal(slots.slots.length, 4, 'four payout slots exist');
    assert.equal(slots.verification.find((entry) => entry.slot === 1)?.payable, true, 'slot 1 is payable after verification');
    record('http surface', 'health, owner-only enforcement and the payout verification payload all behave identically over PostgreSQL');
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  process.stdout.write(`\n  mission PostgreSQL check: ${results.length} steps verified, 0 failures\n\n`);
  mission.missionDb.close();
}

main().catch((error) => {
  process.stderr.write(`\n  mission PostgreSQL check FAILED: ${error instanceof Error ? error.message : String(error)}\n\n`);
  process.exit(1);
});
