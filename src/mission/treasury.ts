import { DESTINATION_SAFETY_RULE, looksLikeInstrumentCredential } from './destination-safety';
import { missionDb, missionId, nowIso, sha256, appendMissionAudit, type Row } from './database';
import { canAgentSpend, currentPolicy, dailySpendCents, requestApproval, type MissionPolicy } from './policy';

/**
 * MISSION TREASURY — wallet architecture and the payout path.
 *
 *   individual controlled wallets / budgets
 *        → agent + worker revenue
 *        → mission treasury
 *        → approved owner payout (one of four configured slots)
 *
 * Two invariants are enforced structurally:
 *   1. MONEY IS ONLY MOVED BY LEDGER ROWS. Every balance change writes an
 *      immutable, hash-chained `mission_ledger` entry carrying `balance_after`.
 *      Balances can never go negative (schema CHECK + the guard here).
 *   2. NOTHING LEAVES WITHOUT AN APPROVAL. A payout is created in
 *      `pending_approval`, requires an explicit owner decision, and only then
 *      can be marked sent/settled against a verified destination slot.
 *
 * Mission revenue is recorded here — in the mission database. No AKBARAL!
 * customer table is read or written by this module.
 */

/**
 * Decisions that release money or change an approved destination belong to the
 * mission owner alone. The HTTP layer already restricts these routes, but the
 * rule is enforced here too so a future caller cannot bypass it by mistake.
 */
export type DecisionActor = 'owner' | 'agent';

function assertOwnerDecision(actorType: DecisionActor | undefined, action: string): void {
  if (actorType === 'agent') {
    throw new MissionTreasuryError(403, `an agent cannot ${action} — this decision belongs to the mission owner`, 'forbidden');
  }
}

export class MissionTreasuryError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, message: string, code: string) {
    super(message);
    this.name = 'MissionTreasuryError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface Wallet {
  id: string;
  kind: string;
  agentId: string | null;
  label: string;
  currency: string;
  balanceCents: number;
  budgetCents: number;
  spentCents: number;
  status: string;
}

function toWallet(row: Row): Wallet {
  return {
    id: String(row.id),
    kind: String(row.kind),
    agentId: row.agent_id ? String(row.agent_id) : null,
    label: String(row.label),
    currency: String(row.currency),
    balanceCents: Number(row.balance_cents),
    budgetCents: Number(row.budget_cents),
    spentCents: Number(row.spent_cents),
    status: String(row.status),
  };
}

export function createWallet(input: {
  kind: 'agent' | 'worker' | 'mission' | 'reserve' | 'fee';
  label: string;
  agentId?: string | null;
  currency?: string;
  budgetCents?: number;
}): Wallet {
  const id = missionId('wal');
  missionDb.run(
    `INSERT INTO mission_wallets (id, kind, agent_id, label, currency, budget_cents) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.kind, input.agentId ?? null, input.label.slice(0, 160), input.currency ?? 'USD', Math.round(input.budgetCents ?? 0)],
  );
  appendMissionAudit({
    actorType: 'system',
    action: 'wallet.created',
    subjectType: 'wallet',
    subjectId: id,
    detail: { kind: input.kind, label: input.label, budgetCents: input.budgetCents ?? 0 },
  });
  return getWallet(id)!;
}

export function getWallet(id: string): Wallet | null {
  const row = missionDb.get<Row>('SELECT * FROM mission_wallets WHERE id = ?', [id]);
  return row ? toWallet(row) : null;
}

export function walletForAgent(agentId: string): Wallet | null {
  const row = missionDb.get<Row>(
    `SELECT * FROM mission_wallets WHERE agent_id = ? AND kind IN ('agent','worker') AND status != 'closed' ORDER BY created_at LIMIT 1`,
    [agentId],
  );
  return row ? toWallet(row) : null;
}

export function ensureAgentWallet(agentId: string, label: string, budgetCents = 0): Wallet {
  const existing = walletForAgent(agentId);
  if (existing) return existing;
  return createWallet({ kind: 'agent', label, agentId, budgetCents });
}

/**
 * Owner control over a wallet's authorised spend ceiling. A budget is an
 * authority limit, not a balance: funding a wallet adds money, raising its
 * budget allows that money to be spent. Both are owner-only and audited.
 */
export function setWalletBudget(input: {
  walletId: string;
  budgetCents: number;
  actorId: string;
  label?: string | null;
  status?: 'active' | 'frozen' | null;
}): Wallet {
  const wallet = getWallet(input.walletId);
  if (!wallet) throw new MissionTreasuryError(404, 'wallet not found', 'not_found');
  const budget = Math.round(Number(input.budgetCents));
  if (!Number.isFinite(budget) || budget < 0) {
    throw new MissionTreasuryError(400, 'budgetCents must be zero or a positive integer of minor units', 'validation_error');
  }
  const previous = wallet.budgetCents;
  missionDb.run(
    `UPDATE mission_wallets SET budget_cents = ?, label = COALESCE(?, label), status = COALESCE(?, status), updated_at = ? WHERE id = ?`,
    [budget, input.label?.slice(0, 160) ?? null, input.status ?? null, nowIso(), input.walletId],
  );
  appendMissionAudit({
    actorType: 'owner',
    actorId: input.actorId,
    action: 'wallet.budget_updated',
    subjectType: 'wallet',
    subjectId: input.walletId,
    detail: { previousBudgetCents: previous, budgetCents: budget, spentCents: wallet.spentCents, status: input.status ?? wallet.status },
  });
  return getWallet(input.walletId)!;
}

export function listWallets(kind?: string): Wallet[] {
  const rows = kind
    ? missionDb.all<Row>('SELECT * FROM mission_wallets WHERE kind = ? ORDER BY created_at DESC', [kind])
    : missionDb.all<Row>('SELECT * FROM mission_wallets ORDER BY created_at DESC');
  return rows.map(toWallet);
}

export interface LedgerEntry {
  id: string;
  walletId: string;
  direction: 'credit' | 'debit';
  amountCents: number;
  category: string;
  reference: string | null;
  memo: string | null;
  actorType: string;
  actorId: string | null;
  balanceAfter: number;
  prevHash: string | null;
  hash: string;
  createdAt: string;
}

/**
 * Append a ledger row AND move the balance in one transaction. The hash chain
 * makes the ledger tamper-evident: any edit breaks every later hash.
 */
function appendLedger(input: {
  walletId: string;
  direction: 'credit' | 'debit';
  amountCents: number;
  category: string;
  reference?: string | null;
  memo?: string | null;
  actorType?: 'owner' | 'agent' | 'system' | 'provider';
  actorId?: string | null;
  /** Caller-supplied key: a retried deposit cannot post twice. */
  idempotencyKey?: string | null;
}): LedgerEntry {
  // Checked before the hash is computed so a duplicate never perturbs the
  // chain; the unique index is the backstop for concurrent requests.
  if (input.idempotencyKey) {
    const existing = missionDb.get<Row>('SELECT * FROM mission_ledger WHERE idempotency_key = ?', [input.idempotencyKey]);
    if (existing) return existing as unknown as LedgerEntry;
  }
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MissionTreasuryError(400, 'ledger amount must be a positive integer of minor units', 'validation_error');
  }
  return missionDb.transaction(() => {
    const wallet = missionDb.get<Row>('SELECT * FROM mission_wallets WHERE id = ?', [input.walletId]);
    if (!wallet) throw new MissionTreasuryError(404, 'wallet not found', 'not_found');
    if (String(wallet.status) === 'closed') throw new MissionTreasuryError(409, 'wallet is closed', 'conflict');

    const balance = Number(wallet.balance_cents);
    const delta = input.direction === 'credit' ? amount : -amount;
    const balanceAfter = balance + delta;
    if (balanceAfter < 0) {
      throw new MissionTreasuryError(
        409,
        `insufficient wallet balance: ${balance} minor units available, ${amount} requested`,
        'insufficient_funds',
      );
    }

    // Ordering is explicit: `seq` (assigned below) rather than an engine-specific
    // rowid, so the hash chain behaves identically on SQLite and PostgreSQL.
    const previous = missionDb.get<Row>('SELECT hash, seq FROM mission_ledger ORDER BY seq DESC LIMIT 1');
    const nextSeq = Number(previous?.seq ?? 0) + 1;
    const id = missionId('led');
    const createdAt = nowIso();
    const payload = [id, input.walletId, input.direction, amount, input.category, input.reference ?? '', balanceAfter, previous?.hash ?? '', createdAt].join('|');
    const hash = sha256(payload);
    missionDb.run(
      `INSERT INTO mission_ledger (id, wallet_id, direction, amount_cents, category, reference, memo, actor_type, actor_id, balance_after, prev_hash, hash, created_at, seq, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, input.walletId, input.direction, amount, input.category, input.reference ?? null, input.memo ?? null,
        input.actorType ?? 'system', input.actorId ?? null, balanceAfter, previous?.hash ?? null, hash, createdAt, nextSeq,
        input.idempotencyKey ?? null,
      ],
    );
    // `spent_cents` tracks real operating expenditure (expenses, upgrades, fees)
    // so it stays comparable with budgets. Internal transfers between mission
    // wallets and owner payouts out of the treasury are movements, not spend:
    // counting them would inflate the figure and corrupt budget checks.
    const countsAsSpend = input.direction === 'debit' && !['transfer', 'payout'].includes(input.category);
    missionDb.run(
      `UPDATE mission_wallets
         SET balance_cents = ?,
             spent_cents = spent_cents + ?,
             updated_at = ?
       WHERE id = ?`,
      [balanceAfter, countsAsSpend ? amount : 0, createdAt, input.walletId],
    );
    return {
      id,
      walletId: input.walletId,
      direction: input.direction,
      amountCents: amount,
      category: input.category,
      reference: input.reference ?? null,
      memo: input.memo ?? null,
      actorType: input.actorType ?? 'system',
      actorId: input.actorId ?? null,
      balanceAfter,
      prevHash: previous?.hash ? String(previous.hash) : null,
      hash,
      createdAt,
    };
  });
}

export function credit(input: {
  walletId: string;
  amountCents: number;
  category: string;
  reference?: string | null;
  memo?: string | null;
  actorType?: 'owner' | 'agent' | 'system' | 'provider';
  actorId?: string | null;
  idempotencyKey?: string | null;
}): LedgerEntry {
  const entry = appendLedger({ ...input, direction: 'credit' });
  appendMissionAudit({
    actorType: input.actorType ?? 'system',
    actorId: input.actorId ?? null,
    action: 'ledger.credit',
    subjectType: 'wallet',
    subjectId: input.walletId,
    detail: { amountCents: input.amountCents, category: input.category, reference: input.reference ?? null },
  });
  return entry;
}

export function debit(input: {
  walletId: string;
  amountCents: number;
  category: string;
  reference?: string | null;
  memo?: string | null;
  actorType?: 'owner' | 'agent' | 'system' | 'provider';
  actorId?: string | null;
  idempotencyKey?: string | null;
}): LedgerEntry {
  const entry = appendLedger({ ...input, direction: 'debit' });
  appendMissionAudit({
    actorType: input.actorType ?? 'system',
    actorId: input.actorId ?? null,
    action: 'ledger.debit',
    subjectType: 'wallet',
    subjectId: input.walletId,
    detail: { amountCents: input.amountCents, category: input.category, reference: input.reference ?? null },
  });
  return entry;
}

export function listLedger(input: { walletId?: string; limit?: number } = {}): LedgerEntry[] {
  const limit = Math.min(1000, Math.max(1, input.limit ?? 100));
  const rows = input.walletId
    ? missionDb.all<Row>('SELECT * FROM mission_ledger WHERE wallet_id = ? ORDER BY seq DESC LIMIT ?', [input.walletId, limit])
    : missionDb.all<Row>('SELECT * FROM mission_ledger ORDER BY seq DESC LIMIT ?', [limit]);
  return rows.map((row) => ({
    id: String(row.id),
    walletId: String(row.wallet_id),
    direction: String(row.direction) as 'credit' | 'debit',
    amountCents: Number(row.amount_cents),
    category: String(row.category),
    reference: row.reference ? String(row.reference) : null,
    memo: row.memo ? String(row.memo) : null,
    actorType: String(row.actor_type),
    actorId: row.actor_id ? String(row.actor_id) : null,
    balanceAfter: Number(row.balance_after),
    prevHash: row.prev_hash ? String(row.prev_hash) : null,
    hash: String(row.hash),
    createdAt: String(row.created_at),
  }));
}

/** Verify the ledger hash chain (tamper evidence, same technique as audit). */
export function verifyLedger(): { ok: boolean; rows: number; brokenAtId: string | null; detail: string } {
  const rows = missionDb.all<Row>('SELECT * FROM mission_ledger ORDER BY seq ASC');
  let previousHash = '';
  for (const row of rows) {
    const payload = [
      String(row.id), String(row.wallet_id), String(row.direction), Number(row.amount_cents),
      String(row.category), row.reference ? String(row.reference) : '', Number(row.balance_after),
      previousHash, String(row.created_at),
    ].join('|');
    if (sha256(payload) !== String(row.hash)) {
      return { ok: false, rows: rows.length, brokenAtId: String(row.id), detail: 'hash mismatch — a ledger row was modified' };
    }
    previousHash = String(row.hash);
  }
  return { ok: true, rows: rows.length, brokenAtId: null, detail: `${rows.length} ledger rows verified` };
}

export interface TreasurySummary {
  currency: string;
  wallets: Wallet[];
  totals: {
    totalBalanceCents: number;
    missionBalanceCents: number;
    agentBalancesCents: number;
    reserveBalanceCents: number;
    totalBudgetCents: number;
    totalSpentCents: number;
    realizedRevenueCents: number;
    pendingRevenueCents: number;
    totalExpensesCents: number;
    approvedPayoutsCents: number;
    settledPayoutsCents: number;
  };
  daily: { spentTodayCents: number; policyDailyCapCents: number };
}

export function treasurySummary(): TreasurySummary {
  const wallets = listWallets();
  const policy = currentPolicy();
  const revenue = missionDb.get<Row>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'received' THEN amount_cents ELSE 0 END), 0) AS realized,
       COALESCE(SUM(CASE WHEN status IN ('expected','contracted') THEN amount_cents ELSE 0 END), 0) AS pending
     FROM mission_revenue`,
  );
  const expenses = missionDb.get<Row>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM mission_expenses WHERE status IN ('approved','paid')`,
  );
  const payouts = missionDb.get<Row>(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('approved','sent') THEN amount_cents ELSE 0 END), 0) AS approved,
       COALESCE(SUM(CASE WHEN status = 'settled' THEN amount_cents ELSE 0 END), 0) AS settled
     FROM mission_payouts`,
  );
  const sum = (kind: string) => wallets.filter((wallet) => wallet.kind === kind).reduce((total, wallet) => total + wallet.balanceCents, 0);
  return {
    currency: policy.currency,
    wallets,
    totals: {
      totalBalanceCents: wallets.reduce((total, wallet) => total + wallet.balanceCents, 0),
      missionBalanceCents: sum('mission'),
      agentBalancesCents: sum('agent') + sum('worker'),
      reserveBalanceCents: sum('reserve'),
      totalBudgetCents: wallets.reduce((total, wallet) => total + wallet.budgetCents, 0),
      totalSpentCents: wallets.reduce((total, wallet) => total + wallet.spentCents, 0),
      realizedRevenueCents: Number(revenue?.realized ?? 0),
      pendingRevenueCents: Number(revenue?.pending ?? 0),
      totalExpensesCents: Number(expenses?.total ?? 0),
      approvedPayoutsCents: Number(payouts?.approved ?? 0),
      settledPayoutsCents: Number(payouts?.settled ?? 0),
    },
    daily: { spentTodayCents: dailySpendCents(nowIso()), policyDailyCapCents: policy.maxDailySpendCents },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue recording (idempotent, verified sources only)
// ─────────────────────────────────────────────────────────────────────────────

export interface RevenueInput {
  workId?: string | null;
  agentId?: string | null;
  /** Wallet that earned the revenue; defaults to the agent's wallet. */
  walletId?: string | null;
  amountCents: number;
  source: string;
  status: 'expected' | 'contracted' | 'received' | 'disputed';
  externalRef?: string | null;
  idempotencyKey: string;
  verifier?: string | null;
  memo?: string | null;
  actorId?: string | null;
}

/**
 * Record revenue. `status: 'received'` REQUIRES a verifier (owner, provider
 * webhook or bank statement) — the mission never claims money arrived without
 * a documentary basis, and only 'received' counts as realized revenue.
 */
export function recordRevenue(input: RevenueInput): { revenue: Row; duplicated: boolean; ledger?: LedgerEntry; reinvestment?: LedgerEntry } {
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MissionTreasuryError(400, 'revenue amount must be positive', 'validation_error');
  }
  if (!input.idempotencyKey) {
    throw new MissionTreasuryError(400, 'an idempotency key is required for revenue', 'validation_error');
  }
  if (input.status === 'received' && !input.verifier) {
    throw new MissionTreasuryError(
      400,
      'received revenue requires a verifier (owner, provider webhook or bank statement) — unverifiable revenue is never counted',
      'verification_required',
    );
  }
  const existing = missionDb.get<Row>('SELECT * FROM mission_revenue WHERE idempotency_key = ?', [input.idempotencyKey]);
  if (existing) return { revenue: existing, duplicated: true };

  const id = missionId('rev');
  const receivedAt = input.status === 'received' ? nowIso() : null;
  missionDb.run(
    `INSERT INTO mission_revenue (id, work_id, agent_id, amount_cents, source, status, external_ref, idempotency_key, verifier, received_at, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.workId ?? null, input.agentId ?? null, amount, input.source, input.status, input.externalRef ?? null, input.idempotencyKey, input.verifier ?? null, receivedAt, input.memo ?? null],
  );

  let ledger: LedgerEntry | undefined;
  let reinvestment: LedgerEntry | undefined;
  let treasuryWalletId: string | null = null;
  if (input.status === 'received') {
    // Revenue flows: agent wallet (earned) → mission treasury (payout source).
    // Both legs are separate ledger entries, so the treasury statement shows
    // exactly where the money came from and where it now sits.
    const revenueMemo = `revenue received (${input.source})${input.verifier ? ` verified by ${input.verifier}` : ''}`;
    const treasury = listWallets('mission')[0] ?? createWallet({ kind: 'mission', label: 'Mission treasury' });
    const earningWallet = input.walletId
      ? getWallet(input.walletId)
      : input.agentId
        ? ensureAgentWallet(input.agentId, `Agent wallet ${input.agentId}`)
        : null;
    if (input.walletId && !earningWallet) {
      throw new MissionTreasuryError(404, 'revenue wallet not found', 'not_found');
    }
    if (earningWallet && earningWallet.kind !== 'mission') {
      credit({
        walletId: earningWallet.id,
        amountCents: amount,
        category: 'revenue',
        reference: id,
        memo: revenueMemo,
        actorType: 'owner',
        actorId: input.actorId ?? null,
      });
      // Sweep the earnings into the mission treasury: the treasury is the only
      // wallet that can fund payouts, so nothing sits unreachable in an agent
      // wallet.
      debit({
        walletId: earningWallet.id,
        amountCents: amount,
        category: 'transfer',
        reference: id,
        memo: 'swept to mission treasury',
        actorType: 'system',
        actorId: null,
      });
    }
    ledger = credit({
      walletId: earningWallet && earningWallet.kind === 'mission' ? earningWallet.id : treasury.id,
      amountCents: amount,
      category: 'revenue',
      reference: id,
      memo: earningWallet && earningWallet.kind !== 'mission' ? `${revenueMemo} — transferred from ${earningWallet.label}` : revenueMemo,
      actorType: 'owner',
      actorId: input.actorId ?? null,
    });
    treasuryWalletId = ledger.walletId;
    missionDb.run('UPDATE mission_revenue SET wallet_id = ? WHERE id = ?', [treasuryWalletId, id]);
    // Reinvestment: a configured share of verified revenue is moved OUT of the
    // treasury and INTO the reinvestment wallet as a real ledger transfer (the
    // same minor units, no rounding invented — the remainder stays liquid).
    const allocation = allocateReinvestment({ revenueId: id, amountCents: amount, treasuryWalletId, actorId: input.actorId ?? null });
    if (allocation) reinvestment = allocation;
  }

  appendMissionAudit({
    actorType: input.actorId ? 'owner' : 'system',
    actorId: input.actorId ?? null,
    action: 'revenue.recorded',
    subjectType: 'revenue',
    subjectId: id,
    detail: { amountCents: amount, source: input.source, status: input.status, workId: input.workId ?? null, agentId: input.agentId ?? null },
  });
  return { revenue: missionDb.get<Row>('SELECT * FROM mission_revenue WHERE id = ?', [id])!, duplicated: false, ledger, reinvestment };
}

export function listRevenue(limit = 100): Row[] {
  return missionDb.all<Row>('SELECT * FROM mission_revenue ORDER BY created_at DESC LIMIT ?', [limit]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Expenses (agent self-management within budgets)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpenseRequest {
  agentId: string;
  walletId: string;
  category: string;
  provider: string;
  description: string;
  amountCents: number;
  idempotencyKey: string;
  actorType?: 'owner' | 'agent';
  actorId?: string | null;
}

export function requestExpense(input: ExpenseRequest): { expense: Row; policy: ReturnType<typeof canAgentSpend>; approvalId?: string } {
  const policy: MissionPolicy = currentPolicy();
  const daily = dailySpendCents(nowIso());
  const decision = canAgentSpend(
    { walletId: input.walletId, amountCents: input.amountCents, category: input.category, agentId: input.agentId },
    policy,
    daily,
  );

  const existing = missionDb.get<Row>('SELECT * FROM mission_expenses WHERE idempotency_key = ?', [input.idempotencyKey]);
  if (existing) return { expense: existing, policy: decision };

  if (!decision.allowed && !decision.requiresApproval) {
    appendMissionAudit({
      actorType: input.actorType ?? 'agent',
      actorId: input.actorId ?? null,
      action: 'expense.denied',
      subjectType: 'expense',
      subjectId: input.idempotencyKey,
      detail: { reasons: decision.reasons, amountCents: input.amountCents, provider: input.provider },
    });
    throw new MissionTreasuryError(
      409,
      `expense refused by policy: ${decision.reasons.join('; ')}`,
      'policy_denied',
    );
  }

  const id = missionId('exp');
  const status = decision.requiresApproval ? 'requested' : 'approved';
  missionDb.run(
    `INSERT INTO mission_expenses (id, agent_id, wallet_id, category, provider, description, amount_cents, status, idempotency_key, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.agentId, input.walletId, input.category, input.provider.slice(0, 120), input.description.slice(0, 400), Math.round(input.amountCents), status, input.idempotencyKey, input.actorId ?? null],
  );

  let approvalId: string | undefined;
  if (decision.requiresApproval) {
    approvalId = requestApproval({
      subjectType: 'expense',
      subjectId: id,
      action: 'expense.approve',
      amountCents: input.amountCents,
      requestedBy: input.actorId ?? null,
      note: `${input.provider}: ${input.description}`,
    });
    missionDb.run('UPDATE mission_expenses SET approval_id = ? WHERE id = ?', [approvalId, id]);
  } else {
    // Under the approval threshold: execute immediately against the wallet.
    const entry = debit({
      walletId: input.walletId,
      amountCents: input.amountCents,
      category: 'expense',
      reference: id,
      memo: `${input.provider}: ${input.description}`,
      actorType: input.actorType ?? 'agent',
      actorId: input.actorId ?? null,
    });
    missionDb.run('UPDATE mission_expenses SET status = ?, paid_at = ? WHERE id = ?', ['paid', nowIso(), id]);
    void entry;
  }

  appendMissionAudit({
    actorType: input.actorType ?? 'agent',
    actorId: input.actorId ?? null,
    action: decision.requiresApproval ? 'expense.requested_for_approval' : 'expense.executed',
    subjectType: 'expense',
    subjectId: id,
    detail: { provider: input.provider, amountCents: input.amountCents, category: input.category, dailySpentCents: daily },
  });
  return { expense: missionDb.get<Row>('SELECT * FROM mission_expenses WHERE id = ?', [id])!, policy: decision, approvalId };
}

/** Owner decision on a requested expense: approve (pay it) or reject. */
export function decideExpense(input: { id: string; decision: 'approved' | 'rejected'; actorId: string; note?: string | null; actorType?: DecisionActor }): Row {
  assertOwnerDecision(input.actorType, 'approve an expense');
  const expense = missionDb.get<Row>('SELECT * FROM mission_expenses WHERE id = ?', [input.id]);
  if (!expense) throw new MissionTreasuryError(404, 'expense not found', 'not_found');
  if (String(expense.status) !== 'requested') {
    throw new MissionTreasuryError(409, `expense is already ${expense.status}`, 'conflict');
  }
  // The owner has TWO real entry points for the same decision — the approval
  // queue (`mission_approvals`) and this expense. They must agree: an approval
  // the owner already granted is honoured here (so approving in the queue pays
  // the expense instead of stranding it), an approval the owner rejected stops
  // the payment, and a second payment attempt on a paid expense is refused.
  if (expense.approval_id) {
    const decided = missionDb.get<Row>('SELECT status FROM mission_approvals WHERE id = ?', [String(expense.approval_id)]);
    const approvalStatus = decided ? String(decided.status) : 'pending';
    if (approvalStatus === 'rejected') {
      throw new MissionTreasuryError(409, 'the owner rejected this expense — it cannot be paid', 'conflict');
    }
  }
  if (input.decision === 'rejected') {
    missionDb.run('UPDATE mission_expenses SET status = ? WHERE id = ?', ['rejected', input.id]);
  } else {
    debit({
      walletId: String(expense.wallet_id),
      amountCents: Number(expense.amount_cents),
      category: 'expense',
      reference: input.id,
      memo: `${expense.provider}: ${expense.description}`,
      actorType: 'owner',
      actorId: input.actorId,
    });
    missionDb.run('UPDATE mission_expenses SET status = ?, paid_at = ? WHERE id = ?', ['paid', nowIso(), input.id]);
  }
  if (expense.approval_id) {
    missionDb.run(
      `UPDATE mission_approvals SET status = ?, decided_by = ?, decided_at = ?, note = COALESCE(?, note)
        WHERE id = ? AND status = 'pending'`,
      [input.decision === 'approved' ? 'approved' : 'rejected', input.actorId, nowIso(), input.note ?? null, String(expense.approval_id)],
    );
  }
  appendMissionAudit({
    actorType: 'owner',
    actorId: input.actorId,
    action: `expense.${input.decision}`,
    subjectType: 'expense',
    subjectId: input.id,
    detail: { amountCents: Number(expense.amount_cents), provider: String(expense.provider) },
  });
  return missionDb.get<Row>('SELECT * FROM mission_expenses WHERE id = ?', [input.id])!;
}

export function listExpenses(limit = 100): Row[] {
  return missionDb.all<Row>('SELECT * FROM mission_expenses ORDER BY created_at DESC LIMIT ?', [limit]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Four configurable payout destination slots
// ─────────────────────────────────────────────────────────────────────────────

export const PAYOUT_SLOT_COUNT = 4;

/** The four slots always exist, so the dashboard can render them immediately. */
export function ensurePayoutSlots(): Array<Row> {
  for (let slot = 1; slot <= PAYOUT_SLOT_COUNT; slot += 1) {
    const existing = missionDb.get<Row>('SELECT slot FROM mission_payout_slots WHERE slot = ?', [slot]);
    if (!existing) {
      missionDb.run(
        `INSERT INTO mission_payout_slots (slot, label, status) VALUES (?, ?, 'unconfigured')`,
        [slot, `Payout destination ${slot}`],
      );
    }
  }
  return listPayoutSlots();
}

export function listPayoutSlots(): Array<Row> {
  return missionDb.all<Row>('SELECT * FROM mission_payout_slots ORDER BY slot ASC');
}

/**
 * Configure a slot. Account details are OPTIONAL at configuration time: the
 * owner can register a label/holder now and complete the provider reference
 * later. Whatever is supplied is stored masked — the system never needs (and
 * never keeps) a full account number to operate.
 */
export function configurePayoutSlot(input: {
  slot: number;
  label?: string;
  destinationType?: string | null;
  holderName?: string | null;
  maskedAccount?: string | null;
  providerRef?: string | null;
  currency?: string;
  minPayoutCents?: number;
  maxPayoutCents?: number | null;
  approvalRequired?: boolean;
  notes?: string | null;
  actorId: string;
  actorType?: DecisionActor;
}): Row {
  assertOwnerDecision(input.actorType, 'configure a payout destination');
  if (!Number.isInteger(input.slot) || input.slot < 1 || input.slot > PAYOUT_SLOT_COUNT) {
    throw new MissionTreasuryError(400, `slot must be an integer between 1 and ${PAYOUT_SLOT_COUNT}`, 'validation_error');
  }
  ensurePayoutSlots();
  const before = missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [input.slot])!;
  // A destination is a REFERENCE to where money may be sent — never an
  // instrument credential. Full card numbers / IBANs / long digit runs are
  // refused here, at the only place a destination can be written.
  for (const [field, value] of [
    ['maskedAccount', input.maskedAccount],
    ['providerRef', input.providerRef],
  ] as const) {
    if (!value) continue;
    const verdict = looksLikeInstrumentCredential(value);
    if (verdict.unsafe) {
      throw new MissionTreasuryError(400, `${field}: ${verdict.reason} — ${DESTINATION_SAFETY_RULE}`, 'unsafe_destination');
    }
  }
  const hasDestination = Boolean(input.providerRef || input.maskedAccount);
  const status = hasDestination ? 'pending_verification' : 'unconfigured';

  missionDb.run(
    `UPDATE mission_payout_slots
       SET label = COALESCE(?, label),
           destination_type = COALESCE(?, destination_type),
           holder_name = COALESCE(?, holder_name),
           masked_account = COALESCE(?, masked_account),
           provider_ref = COALESCE(?, provider_ref),
           currency = COALESCE(?, currency),
           min_payout_cents = COALESCE(?, min_payout_cents),
           max_payout_cents = COALESCE(?, max_payout_cents),
           approval_required = COALESCE(?, approval_required),
           notes = COALESCE(?, notes),
           status = ?,
           configured_at = ?,
           updated_at = ?
     WHERE slot = ?`,
    [
      input.label ?? null,
      input.destinationType ?? null,
      input.holderName ?? null,
      input.maskedAccount ? maskAccount(input.maskedAccount) : null,
      input.providerRef ?? null,
      input.currency ?? null,
      input.minPayoutCents ?? null,
      input.maxPayoutCents ?? null,
      input.approvalRequired === undefined ? null : input.approvalRequired ? 1 : 0,
      input.notes ?? null,
      status,
      nowIso(),
      nowIso(),
      input.slot,
    ],
  );
  appendMissionAudit({
    actorType: 'owner',
    actorId: input.actorId,
    action: 'payout_slot.configured',
    subjectType: 'payout_slot',
    subjectId: String(input.slot),
    // Only the masked form is audited: never the raw destination.
    detail: { label: input.label ?? before.label, status, hasProviderRef: Boolean(input.providerRef) },
  });
  return missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [input.slot])!;
}

function maskAccount(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

/** A slot must be verified by the owner before it can receive funds. */
export function verifyPayoutSlot(slot: number, actorId: string, actorType?: DecisionActor): Row {
  assertOwnerDecision(actorType, 'verify a payout destination');
  const existing = missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [slot]);
  if (!existing) throw new MissionTreasuryError(404, 'payout slot not found', 'not_found');
  if (!existing.provider_ref && !existing.masked_account) {
    throw new MissionTreasuryError(409, 'the slot has no destination yet — configure it before verifying', 'conflict');
  }
  missionDb.run(
    `UPDATE mission_payout_slots SET status = 'active', verified_at = ?, verified_by = ?, updated_at = ? WHERE slot = ?`,
    [nowIso(), actorId, nowIso(), slot],
  );
  appendMissionAudit({
    actorType: 'owner',
    actorId,
    action: 'payout_slot.verified',
    subjectType: 'payout_slot',
    subjectId: String(slot),
  });
  return missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [slot])!;
}

export function setPayoutSlotStatus(slot: number, status: 'paused' | 'active' | 'unconfigured', actorId: string, actorType?: DecisionActor): Row {
  assertOwnerDecision(actorType, 'change a payout destination');
  missionDb.run('UPDATE mission_payout_slots SET status = ?, updated_at = ? WHERE slot = ?', [status, nowIso(), slot]);
  appendMissionAudit({ actorType: 'owner', actorId, action: `payout_slot.${status}`, subjectType: 'payout_slot', subjectId: String(slot) });
  const row = missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [slot]);
  if (!row) throw new MissionTreasuryError(404, 'payout slot not found', 'not_found');
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payouts: treasury → approved owner payout
// ─────────────────────────────────────────────────────────────────────────────

export interface PayoutRequest {
  slot: number;
  amountCents: number;
  idempotencyKey: string;
  requestedBy?: string | null;
  memo?: string | null;
}

/**
 * Request a payout. Always created in `pending_approval`: an agent (or a human
 * operator) can only ever REQUEST money to leave the treasury, and the funds
 * are reserved from the mission wallet on approval, never before.
 */
export function requestPayout(input: PayoutRequest): Row {
  const policy = currentPolicy();
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MissionTreasuryError(400, 'payout amount must be positive', 'validation_error');
  }
  if (!input.idempotencyKey) throw new MissionTreasuryError(400, 'an idempotency key is required', 'validation_error');
  const existing = missionDb.get<Row>('SELECT * FROM mission_payouts WHERE idempotency_key = ?', [input.idempotencyKey]);
  if (existing) return existing;

  ensurePayoutSlots();
  const slot = missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [input.slot]);
  if (!slot) throw new MissionTreasuryError(404, 'payout slot not found', 'not_found');
  if (String(slot.status) !== 'active') {
    throw new MissionTreasuryError(
      409,
      `payout slot ${input.slot} is ${slot.status} — configure and verify the destination first`,
      'slot_not_active',
    );
  }
  if (amount > policy.maxPayoutCents) {
    throw new MissionTreasuryError(409, `payout above the configured cap (${policy.maxPayoutCents})`, 'policy_denied');
  }
  if (slot.max_payout_cents !== null && amount > Number(slot.max_payout_cents)) {
    throw new MissionTreasuryError(409, `payout above this slot's cap (${slot.max_payout_cents})`, 'policy_denied');
  }
  if (amount < Number(slot.min_payout_cents ?? 0)) {
    throw new MissionTreasuryError(409, `payout below this slot's minimum (${slot.min_payout_cents})`, 'policy_denied');
  }
  const missionWallet = listWallets('mission')[0];
  if (!missionWallet || missionWallet.balanceCents < amount) {
    throw new MissionTreasuryError(
      409,
      `the mission treasury holds ${missionWallet?.balanceCents ?? 0} minor units — ${amount} requested`,
      'insufficient_funds',
    );
  }
  if (policy.killSwitch) throw new MissionTreasuryError(409, 'the mission kill switch is engaged', 'policy_denied');

  const id = missionId('pay');
  missionDb.run(
    `INSERT INTO mission_payouts (id, slot, amount_cents, currency, status, requested_by, idempotency_key)
     VALUES (?, ?, ?, ?, 'pending_approval', ?, ?)`,
    [id, input.slot, amount, String(slot.currency ?? policy.currency), input.requestedBy ?? null, input.idempotencyKey],
  );
  const approvalId = requestApproval({
    subjectType: 'payout',
    subjectId: id,
    action: 'payout.approve',
    amountCents: amount,
    requestedBy: input.requestedBy ?? null,
    note: input.memo ?? `payout to slot ${input.slot}`,
  });
  missionDb.run('UPDATE mission_payouts SET approval_id = ? WHERE id = ?', [approvalId, id]);
  appendMissionAudit({
    actorType: input.requestedBy ? 'agent' : 'owner',
    actorId: input.requestedBy ?? null,
    action: 'payout.requested',
    subjectType: 'payout',
    subjectId: id,
    detail: { slot: input.slot, amountCents: amount },
  });
  return missionDb.get<Row>('SELECT * FROM mission_payouts WHERE id = ?', [id])!;
}

export function decidePayout(input: { id: string; decision: 'approved' | 'rejected'; actorId: string; note?: string | null; actorType?: DecisionActor }): Row {
  assertOwnerDecision(input.actorType, 'approve a payout');
  const payout = missionDb.get<Row>('SELECT * FROM mission_payouts WHERE id = ?', [input.id]);
  if (!payout) throw new MissionTreasuryError(404, 'payout not found', 'not_found');
  if (String(payout.status) !== 'pending_approval') {
    throw new MissionTreasuryError(409, `payout is already ${payout.status}`, 'conflict');
  }
  if (input.decision === 'rejected') {
    missionDb.run('UPDATE mission_payouts SET status = ?, failure_reason = ? WHERE id = ?', ['rejected', input.note ?? 'rejected by owner', input.id]);
  } else {
    // Reserve the funds in the treasury: a debit row is the proof of movement.
    const missionWallet = listWallets('mission')[0];
    if (!missionWallet) throw new MissionTreasuryError(409, 'no mission treasury wallet exists', 'conflict');
    debit({
      walletId: missionWallet.id,
      amountCents: Number(payout.amount_cents),
      category: 'payout',
      reference: input.id,
      memo: `approved payout to slot ${payout.slot}`,
      actorType: 'owner',
      actorId: input.actorId,
    });
    missionDb.run('UPDATE mission_payouts SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?', ['approved', input.actorId, nowIso(), input.id]);
  }
  if (payout.approval_id) {
    missionDb.run(
      `UPDATE mission_approvals SET status = ?, decided_by = ?, decided_at = ?, note = COALESCE(?, note) WHERE id = ?`,
      [input.decision === 'approved' ? 'approved' : 'rejected', input.actorId, nowIso(), input.note ?? null, String(payout.approval_id)],
    );
  }
  appendMissionAudit({
    actorType: 'owner',
    actorId: input.actorId,
    action: `payout.${input.decision}`,
    subjectType: 'payout',
    subjectId: input.id,
    detail: { amountCents: Number(payout.amount_cents), slot: Number(payout.slot) },
  });
  return missionDb.get<Row>('SELECT * FROM mission_payouts WHERE id = ?', [input.id])!;
}

/**
 * Mark an approved payout as sent/settled with the PROVIDER reference. This is
 * the only place a payout can be reported as settled, and it requires a real
 * settlement reference — the system never invents a payment confirmation.
 */
export function settlePayout(input: {
  id: string;
  status: 'sent' | 'settled' | 'failed';
  settlementRef?: string | null;
  failureReason?: string | null;
  actorId: string;
  actorType?: DecisionActor;
}): Row {
  assertOwnerDecision(input.actorType, 'settle a payout');
  const payout = missionDb.get<Row>('SELECT * FROM mission_payouts WHERE id = ?', [input.id]);
  if (!payout) throw new MissionTreasuryError(404, 'payout not found', 'not_found');
  const current = String(payout.status);
  if (!['approved', 'sent'].includes(current)) {
    throw new MissionTreasuryError(409, `payout is ${current}; only approved or sent payouts can be settled`, 'conflict');
  }
  if ((input.status === 'sent' || input.status === 'settled') && !input.settlementRef) {
    throw new MissionTreasuryError(
      400,
      'a settlement reference from the payment provider is required — the system never marks a payout settled without one',
      'verification_required',
    );
  }
  if (input.status === 'failed') {
    // Reverse the reservation: the money stays in the treasury.
    const missionWallet = listWallets('mission')[0];
    if (missionWallet) {
      credit({
        walletId: missionWallet.id,
        amountCents: Number(payout.amount_cents),
        category: 'adjustment',
        reference: input.id,
        memo: 'payout failed — reserved funds returned to the treasury',
        actorType: 'system',
      });
    }
    missionDb.run('UPDATE mission_payouts SET status = ?, failure_reason = ? WHERE id = ?', ['failed', input.failureReason ?? 'provider reported failure', input.id]);
  } else {
    missionDb.run(
      'UPDATE mission_payouts SET status = ?, settlement_ref = ?, settled_at = ? WHERE id = ?',
      [input.status, input.settlementRef ?? null, input.status === 'settled' ? nowIso() : null, input.id],
    );
  }
  appendMissionAudit({
    actorType: input.actorId ? 'owner' : 'system',
    actorId: input.actorId ?? null,
    action: `payout.${input.status}`,
    subjectType: 'payout',
    subjectId: input.id,
    detail: { settlementRef: input.settlementRef ?? null, failureReason: input.failureReason ?? null },
  });
  return missionDb.get<Row>('SELECT * FROM mission_payouts WHERE id = ?', [input.id])!;
}

export function listPayouts(limit = 100): Row[] {
  return missionDb.all<Row>('SELECT * FROM mission_payouts ORDER BY created_at DESC LIMIT ?', [limit]);
}

export function listApprovals(status?: string): Row[] {
  return status
    ? missionDb.all<Row>('SELECT * FROM mission_approvals WHERE status = ? ORDER BY created_at DESC LIMIT 200', [status])
    : missionDb.all<Row>('SELECT * FROM mission_approvals ORDER BY created_at DESC LIMIT 200');
}

// ─────────────────────────────────────────────────────────────────────────────
// Reinvestment (verified earnings → real ledger transfer → reinvestment wallet)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The reinvestment wallet. Like the treasury it is a real ledger account — its
 * balance exists only because transfers were posted to it, so it can never
 * show a fabricated figure.
 */
export function ensureReinvestmentWallet(): Wallet {
  const existing = listWallets('reserve').find((wallet) => wallet.label === REINVESTMENT_LABEL);
  if (existing) return existing;
  return createWallet({ kind: 'reserve', label: REINVESTMENT_LABEL, currency: currentPolicy().currency });
}

export const REINVESTMENT_LABEL = 'Mission reinvestment reserve';

/**
 * Move the configured share of a verified revenue receipt into the
 * reinvestment reserve. Idempotent per revenue row (the ledger enforces a
 * unique idempotency key), and skipped entirely when the share is 0 — an
 * unconfigured policy allocates nothing.
 */
export function allocateReinvestment(input: {
  revenueId: string;
  amountCents: number;
  treasuryWalletId: string;
  actorId?: string | null;
}): LedgerEntry | null {
  const policy = currentPolicy();
  const bps = Math.max(0, Math.min(10_000, Math.round(policy.reinvestShareBps)));
  if (bps === 0) return null;
  const share = Math.floor((Math.round(input.amountCents) * bps) / 10_000);
  if (share <= 0) return null; // a share smaller than one minor unit is not invented
  const idempotencyKey = `reinvest:${input.revenueId}`;
  const existing = missionDb.get<Row>('SELECT id FROM mission_ledger WHERE idempotency_key = ?', [idempotencyKey]);
  if (existing) return null;
  const reserve = ensureReinvestmentWallet();
  const memo = `reinvestment allocation ${bps / 100}% of verified revenue ${input.revenueId}`;
  debit({
    walletId: input.treasuryWalletId,
    amountCents: share,
    category: 'reinvestment',
    reference: input.revenueId,
    memo: 'allocated to the reinvestment reserve',
    actorType: 'system',
    actorId: null,
    idempotencyKey: `${idempotencyKey}:out`,
  });
  const entry = credit({
    walletId: reserve.id,
    amountCents: share,
    category: 'reinvestment',
    reference: input.revenueId,
    memo,
    actorType: input.actorId ? 'owner' : 'system',
    actorId: input.actorId ?? null,
    idempotencyKey,
  });
  appendMissionAudit({
    actorType: 'system',
    action: 'reinvestment.allocated',
    subjectType: 'wallet',
    subjectId: reserve.id,
    detail: { revenueId: input.revenueId, amountCents: share, shareBps: bps },
  });
  return entry;
}

export interface ReinvestmentSummary {
  shareBps: number;
  sharePercent: number;
  wallet: Wallet | null;
  balanceCents: number;
  allocatedCents: number;
  entries: LedgerEntry[];
  note: string;
}

export function reinvestmentSummary(limit = 50): ReinvestmentSummary {
  const policy = currentPolicy();
  const wallet = listWallets('reserve').find((row) => row.label === REINVESTMENT_LABEL) ?? null;
  const allocated =
    missionDb.get<{ total: number }>(
      "SELECT COALESCE(SUM(amount_cents), 0) AS total FROM mission_ledger WHERE direction = 'credit' AND category = 'reinvestment'",
    )?.total ?? 0;
  return {
    shareBps: Math.max(0, Math.min(10_000, Math.round(policy.reinvestShareBps))),
    sharePercent: Math.round(policy.reinvestShareBps) / 100,
    wallet,
    balanceCents: wallet?.balanceCents ?? 0,
    allocatedCents: Number(allocated),
    entries: wallet ? listLedger({ walletId: wallet.id, limit }) : [],
    note: 'Allocations are real ledger transfers out of the treasury. A 0 bps share allocates nothing.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixed daily revenue target (progress counts VERIFIED revenue only)
// ─────────────────────────────────────────────────────────────────────────────

export const BILLIONAIRE_DAILY_TARGET_CENTS = 100_000_000_000; // $1B = 100B cents
export const BILLIONAIRE_DAILY_TARGET_CURRENCY = 'USD';
export const BILLIONAIRE_PERSISTENT_OBJECTIVE =
  'Maximize legitimate, verified real-world earnings toward $1,000,000,000 verified revenue per day aspirational target — lawful, sustainable, verifiable only, no guarantees, no fabrication. Pursue fastest lawful sustainable verifiable opportunities within capabilities, resources, provider ToS, and platform rules.';

export interface DailyTargetStatus {
  configured: boolean;
  targetCents: number;
  realizedCents: number;
  expectedCents: number;
  contractedCents: number;
  remainingCents: number;
  progressPct: number;
  met: boolean;
  metAt: string | null;
  day: string;
  currency: string;
  label_kind: 'target';
  note: string;
}

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Report the fixed daily realized-revenue target. Only revenue whose status is
 * 'received' AND that carries a verifier counts — expected/contracted amounts
 * are reported separately and never inflate progress.
 */
export function dailyTargetStatus(day = utcDay()): DailyTargetStatus {
  const policy = currentPolicy();
  const targetCents = Math.max(0, Math.round(policy.dailyRevenueTargetCents));
  const sum = (status: string) =>
    Number(
      missionDb.get<{ total: number }>(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM mission_revenue
          WHERE status = ? AND verifier IS NOT NULL AND substr(COALESCE(received_at, created_at), 1, 10) = ?`,
        [status, day],
      )?.total ?? 0,
    );
  const realizedCents = sum('received');
  const expectedCents = sum('expected');
  const contractedCents = sum('contracted');
  const record = missionDb.get<Row>('SELECT * FROM mission_daily_target_days WHERE day = ?', [day]);
  const met = targetCents > 0 && realizedCents >= targetCents;
  return {
    configured: targetCents > 0,
    targetCents,
    realizedCents,
    expectedCents,
    contractedCents,
    remainingCents: Math.max(0, targetCents - realizedCents),
    progressPct: targetCents > 0 ? Math.round((realizedCents / targetCents) * 10000) / 100 : 0,
    met,
    metAt: record?.met ? String(record.met_at) : null,
    day,
    currency: policy.currency,
    label_kind: 'target',
    note: 'Owner-defined aspirational daily target. Progress counts verified (received) revenue only; a target is never presented as achieved revenue, never a guarantee.',
  };
}

/**
 * Record the day's progress. The met event is written once per day and audited
 * — the system never re-announces the same achievement.
 */
export function sweepDailyTarget(actorId: string | null = null): DailyTargetStatus {
  const status = dailyTargetStatus();
  const existing = missionDb.get<Row>('SELECT * FROM mission_daily_target_days WHERE day = ?', [status.day]);
  const metNow = status.met && !(existing?.met === 1);
  missionDb.run(
    `INSERT INTO mission_daily_target_days (day, target_cents, realized_cents, met, met_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET target_cents = excluded.target_cents, realized_cents = excluded.realized_cents,
       met = excluded.met, met_at = COALESCE(mission_daily_target_days.met_at, excluded.met_at), updated_at = excluded.updated_at`,
    [status.day, status.targetCents, status.realizedCents, status.met ? 1 : 0, status.met ? (existing?.met_at ? String(existing.met_at) : nowIso()) : null, nowIso()],
  );
  if (metNow) {
    appendMissionAudit({
      actorType: actorId ? 'owner' : 'system',
      actorId,
      action: 'target.daily_met',
      subjectType: 'target',
      subjectId: status.day,
      detail: { targetCents: status.targetCents, realizedCents: status.realizedCents },
    });
  }
  return dailyTargetStatus(status.day);
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-agent billionaire daily target — $1B verified revenue per day per agent
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentDailyTargetStatus {
  agentId: string;
  slug?: string;
  name?: string;
  configured: boolean;
  targetCents: number;
  realizedCents: number;
  remainingCents: number;
  progressPct: number;
  met: boolean;
  metAt: string | null;
  day: string;
  currency: string;
  label_kind: 'agent_daily_target';
  persistentObjective: string;
  note: string;
}

function agentRowForDailyTarget(agentId: string): Row | undefined {
  try {
    return missionDb.get<Row>('SELECT id, slug, name, daily_target_cents, daily_target_currency, persistent_objective FROM mission_agents WHERE id = ?', [agentId]);
  } catch {
    // Column may not exist yet before migration 0008 — fall back to policy default
    return missionDb.get<Row>('SELECT id, slug, name FROM mission_agents WHERE id = ?', [agentId]);
  }
}

export function agentDailyTargetCents(agentId: string): number {
  const row = agentRowForDailyTarget(agentId);
  if (!row) return BILLIONAIRE_DAILY_TARGET_CENTS;
  const cents = Number(row.daily_target_cents ?? BILLIONAIRE_DAILY_TARGET_CENTS);
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : BILLIONAIRE_DAILY_TARGET_CENTS;
}

export function agentDailyTargetStatus(agentId: string, day = utcDay()): AgentDailyTargetStatus {
  const agentRow = agentRowForDailyTarget(agentId);
  const targetCents = agentDailyTargetCents(agentId);
  const currency = (agentRow?.daily_target_currency ? String(agentRow.daily_target_currency) : BILLIONAIRE_DAILY_TARGET_CURRENCY) as string;
  const persistentObjective = agentRow?.persistent_objective ? String(agentRow.persistent_objective) : BILLIONAIRE_PERSISTENT_OBJECTIVE;

  // Verified received revenue ONLY for this agent on this day
  const realizedRow = missionDb.get<{ total: number }>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM mission_revenue
     WHERE agent_id = ? AND status = 'received' AND verifier IS NOT NULL AND substr(COALESCE(received_at, created_at), 1, 10) = ?`,
    [agentId, day],
  );
  const realizedCents = Number(realizedRow?.total ?? 0);

  let record: Row | undefined;
  try {
    record = missionDb.get<Row>('SELECT * FROM mission_agent_daily_targets WHERE agent_id = ? AND day = ?', [agentId, day]);
  } catch {
    record = undefined;
  }

  const met = targetCents > 0 && realizedCents >= targetCents;
  const remainingCents = Math.max(0, targetCents - realizedCents);
  const progressPct = targetCents > 0 ? Math.round((realizedCents / targetCents) * 10000) / 100 : 0;

  return {
    agentId,
    slug: agentRow?.slug ? String(agentRow.slug) : undefined,
    name: agentRow?.name ? String(agentRow.name) : undefined,
    configured: targetCents > 0,
    targetCents,
    realizedCents,
    remainingCents,
    progressPct,
    met,
    metAt: record?.met ? String(record.met_at) : null,
    day,
    currency,
    label_kind: 'agent_daily_target',
    persistentObjective,
    note: 'Owner-defined aspirational $1B/day per agent. Progress counts ONLY verified received revenue (status=received + verifier). Target is performance objective, never guarantee, never fabricated.',
  };
}

export function sweepAgentDailyTarget(agentId: string, actorId: string | null = null): AgentDailyTargetStatus {
  const status = agentDailyTargetStatus(agentId);
  let existing: Row | undefined;
  try {
    existing = missionDb.get<Row>('SELECT * FROM mission_agent_daily_targets WHERE agent_id = ? AND day = ?', [agentId, status.day]);
  } catch {
    existing = undefined;
  }
  const metNow = status.met && !(existing?.met === 1);

  try {
    missionDb.run(
      `INSERT INTO mission_agent_daily_targets (agent_id, day, target_cents, realized_cents, remaining_cents, progress_pct, met, met_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id, day) DO UPDATE SET target_cents = excluded.target_cents, realized_cents = excluded.realized_cents,
         remaining_cents = excluded.remaining_cents, progress_pct = excluded.progress_pct, met = excluded.met,
         met_at = COALESCE(mission_agent_daily_targets.met_at, excluded.met_at), updated_at = excluded.updated_at`,
      [
        agentId,
        status.day,
        status.targetCents,
        status.realizedCents,
        status.remainingCents,
        status.progressPct,
        status.met ? 1 : 0,
        status.met ? (existing?.met_at ? String(existing.met_at) : nowIso()) : null,
        nowIso(),
      ],
    );
  } catch {
    // Table may not exist before migration — ignore, status still returned
  }

  if (metNow) {
    appendMissionAudit({
      actorType: actorId ? 'owner' : 'system',
      actorId,
      action: 'target.agent_daily_met',
      subjectType: 'agent',
      subjectId: agentId,
      detail: { day: status.day, targetCents: status.targetCents, realizedCents: status.realizedCents },
    });
  }
  return agentDailyTargetStatus(agentId, status.day);
}

export function sweepAllAgentDailyTargets(actorId: string | null = null): { day: string; swept: number; met: number } {
  const day = utcDay();
  const agents = missionDb.all<Row>('SELECT id FROM mission_agents WHERE status = ?', ['active']);
  let met = 0;
  for (const agent of agents) {
    const status = sweepAgentDailyTarget(String(agent.id), actorId);
    if (status.met) met += 1;
  }
  // Also sweep global daily target
  sweepDailyTarget(actorId);
  return { day, swept: agents.length, met };
}

export function listAgentDailyTargets(day = utcDay(), limit = 100): AgentDailyTargetStatus[] {
  let rows: Row[] = [];
  try {
    rows = missionDb.all<Row>('SELECT agent_id FROM mission_agent_daily_targets WHERE day = ? ORDER BY realized_cents DESC LIMIT ?', [day, limit]);
  } catch {
    // Fallback: compute from agents directly
    rows = missionDb.all<Row>('SELECT id AS agent_id FROM mission_agents WHERE status = ? LIMIT ?', ['active', limit]);
  }
  if (rows.length === 0) {
    // No progress rows yet today — show active agents with computed status
    const agents = missionDb.all<Row>('SELECT id FROM mission_agents WHERE status = ? ORDER BY created_at DESC LIMIT ?', ['active', limit]);
    return agents.map((a) => agentDailyTargetStatus(String(a.id), day));
  }
  return rows.map((r) => agentDailyTargetStatus(String(r.agent_id), day));
}

export function setAgentDailyTarget(input: { agentId: string; targetCents: number; currency?: string; actorId: string; persistentObjective?: string }): Row {
  const targetCents = Math.max(0, Math.round(input.targetCents));
  if (!Number.isFinite(targetCents) || targetCents <= 0) {
    throw new MissionTreasuryError(400, 'daily target must be positive', 'validation_error');
  }
  if (targetCents > 1_000_000_000_000_000) {
    throw new MissionTreasuryError(400, 'daily target exceeds maximum allowed', 'validation_error');
  }
  const currency = (input.currency ?? BILLIONAIRE_DAILY_TARGET_CURRENCY).slice(0, 8);
  const objective = (input.persistentObjective ?? BILLIONAIRE_PERSISTENT_OBJECTIVE).slice(0, 1000);

  try {
    missionDb.run(
      `UPDATE mission_agents SET daily_target_cents = ?, daily_target_currency = ?, persistent_objective = ?, updated_at = ? WHERE id = ?`,
      [targetCents, currency, objective, nowIso(), input.agentId],
    );
  } catch {
    // Column may not exist before migration — try update only target via policy fallback
    throw new MissionTreasuryError(500, 'agent daily target columns not migrated yet — apply migrations', 'migration_required');
  }

  appendMissionAudit({
    actorType: 'owner',
    actorId: input.actorId,
    action: 'agent.daily_target_updated',
    subjectType: 'agent',
    subjectId: input.agentId,
    detail: { targetCents, currency, persistentObjective: objective },
  });

  return missionDb.get<Row>('SELECT * FROM mission_agents WHERE id = ?', [input.agentId])!;
}
