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
}): LedgerEntry {
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

    const previous = missionDb.get<Row>('SELECT hash FROM mission_ledger ORDER BY rowid DESC LIMIT 1');
    const id = missionId('led');
    const createdAt = nowIso();
    const payload = [id, input.walletId, input.direction, amount, input.category, input.reference ?? '', balanceAfter, previous?.hash ?? '', createdAt].join('|');
    const hash = sha256(payload);
    missionDb.run(
      `INSERT INTO mission_ledger (id, wallet_id, direction, amount_cents, category, reference, memo, actor_type, actor_id, balance_after, prev_hash, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, input.walletId, input.direction, amount, input.category, input.reference ?? null, input.memo ?? null,
        input.actorType ?? 'system', input.actorId ?? null, balanceAfter, previous?.hash ?? null, hash, createdAt,
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
    ? missionDb.all<Row>('SELECT * FROM mission_ledger WHERE wallet_id = ? ORDER BY rowid DESC LIMIT ?', [input.walletId, limit])
    : missionDb.all<Row>('SELECT * FROM mission_ledger ORDER BY rowid DESC LIMIT ?', [limit]);
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
  const rows = missionDb.all<Row>('SELECT * FROM mission_ledger ORDER BY rowid ASC');
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
export function recordRevenue(input: RevenueInput): { revenue: Row; duplicated: boolean; ledger?: LedgerEntry } {
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
  }

  appendMissionAudit({
    actorType: input.actorId ? 'owner' : 'system',
    actorId: input.actorId ?? null,
    action: 'revenue.recorded',
    subjectType: 'revenue',
    subjectId: id,
    detail: { amountCents: amount, source: input.source, status: input.status, workId: input.workId ?? null, agentId: input.agentId ?? null },
  });
  return { revenue: missionDb.get<Row>('SELECT * FROM mission_revenue WHERE id = ?', [id])!, duplicated: false, ledger };
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
  if (expense.approval_id) {
    const decided = missionDb.get<Row>('SELECT status FROM mission_approvals WHERE id = ?', [String(expense.approval_id)]);
    if (decided && String(decided.status) !== 'pending') {
      throw new MissionTreasuryError(409, `approval already ${decided.status}`, 'conflict');
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
      `UPDATE mission_approvals SET status = ?, decided_by = ?, decided_at = ?, note = COALESCE(?, note) WHERE id = ?`,
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
