/**
 * ZA141251SA — independent reconciliation of the verified-cash ledger.
 *
 * The hash chain in `mission_cash_entries` proves entries were appended in
 * order and never edited, but it cannot prove the mission agrees with itself:
 * an account column changed out of band, a reservation whose hold was released
 * early, or cash booked against a reference that does not exist all hash
 * "correctly". This module recomputes the ledger's agreement with every table
 * it must mirror and returns one operator-readable report:
 *
 *   · chain integrity — seq order, prev_hash linkage and the row hash itself;
 *   · account balances — available/held columns equal the entry sums;
 *   · hold coverage — every held cent is backed by an outstanding operation
 *     (reserved/dispatching/pending/unknown), and each operation reference —
 *     not merely each account total — still holds its exact reservation;
 *   · operation integrity — immutable request fields still match the stored
 *     operation fingerprint, so provider/destination/cost edits fail closed;
 *   · reference closure — every entry points at a real operation, receipt,
 *     owner allocation transfer or provider liability;
 *   · liability sanity — no provider debt is negative.
 *
 * The report never mutates state and never invents a repair: reconciliation
 * records reality. `money.ts` fails closed on it (see assertLedgerReconciled)
 * so a ledger that does not agree with itself cannot move cash, and the owner
 * reads this report through the mission server to diagnose why.
 */
import { missionDb as db, nowIso, sha256, type Row } from './database';

export type LedgerMismatchCode =
  | 'ledger_sequence_gap'
  | 'ledger_chain_break'
  | 'ledger_hash_mismatch'
  | 'ledger_balance_drift'
  | 'account_balance_mismatch'
  | 'held_without_operation'
  | 'operation_without_hold'
  | 'operation_hold_mismatch'
  | 'operation_fingerprint_mismatch'
  | 'orphan_ledger_reference'
  | 'negative_liability';

export interface LedgerMismatch {
  code: LedgerMismatchCode;
  seq?: number;
  accountId?: string;
  reference?: string;
  expectedCents?: number;
  actualCents?: number;
}

export interface LedgerReconciliationReport {
  ok: boolean;
  checkedAt: string;
  counts: { entries: number; accounts: number; liveOperations: number; receipts: number; transfers: number; liabilities: number };
  heldCents: { accounts: number; operations: number };
  mismatchCount: number;
  /** Capped for operator readability; `mismatchCount` is always the full total. */
  mismatches: LedgerMismatch[];
}

/** Operations whose reservation must still be held in cash. */
const LIVE_OPERATION_STATES = new Set(['reserved', 'dispatching', 'pending', 'unknown']);
const BUCKETS = ['available', 'held'] as const;

export interface MoneyOperationFingerprintInput {
  kind: string;
  agentId: string | null;
  provider: string;
  destination: string;
  category: string;
  amountCents: number;
  maxCostCents: number;
}

/**
 * Canonical fingerprint for immutable payment-request fields. Keeping creation
 * and reconciliation on this one serializer prevents either side from silently
 * changing the integrity contract.
 */
export function moneyOperationFingerprint(input: MoneyOperationFingerprintInput): string {
  return sha256(JSON.stringify([
    input.kind,
    input.agentId,
    input.provider,
    input.destination,
    input.category,
    input.amountCents,
    input.maxCostCents,
  ]));
}

function fingerprintForStoredOperation(operation: Row): string {
  return moneyOperationFingerprint({
    kind: String(operation.kind),
    agentId: operation.agent_id == null ? null : String(operation.agent_id),
    provider: String(operation.provider),
    destination: String(operation.destination),
    category: String(operation.category),
    amountCents: Number(operation.amount_cents),
    maxCostCents: Number(operation.max_cost_cents),
  });
}

export function reconcileLedger(maxMismatches = 25): LedgerReconciliationReport {
  const mismatches: LedgerMismatch[] = [];
  let mismatchCount = 0;
  const fail = (mismatch: LedgerMismatch): void => {
    mismatchCount += 1;
    if (mismatches.length < maxMismatches) mismatches.push(mismatch);
  };

  // 1) Chain integrity. The row object below must stay byte-identical to the
  //    one money.ts hashes on insert, or every entry would falsely mismatch.
  const entries = db.all<Row>('SELECT * FROM mission_cash_entries ORDER BY seq');
  const entrySums = new Map<string, number>();
  let prevHash = '';
  for (const [index, r] of entries.entries()) {
    const row = { seq: Number(r.seq), id: String(r.id), accountId: String(r.account_id), bucket: String(r.bucket), delta: Number(r.delta_cents), after: Number(r.balance_after), reference: String(r.reference), prev: String(r.prev_hash), at: String(r.created_at) };
    if (row.seq !== index + 1) fail({ code: 'ledger_sequence_gap', seq: row.seq, expectedCents: index + 1 });
    if (row.prev !== prevHash) fail({ code: 'ledger_chain_break', seq: row.seq });
    if (sha256(JSON.stringify(row)) !== r.hash) fail({ code: 'ledger_hash_mismatch', seq: row.seq });
    const key = `${row.accountId}:${row.bucket}`;
    const after = (entrySums.get(key) ?? 0) + row.delta;
    if (after !== row.after || !Number.isSafeInteger(after) || after < 0) fail({ code: 'ledger_balance_drift', seq: row.seq, accountId: row.accountId, expectedCents: after, actualCents: row.after });
    entrySums.set(key, after);
    prevHash = String(r.hash);
  }

  // 2) Account columns must equal the entries they claim to summarise.
  const accounts = db.all<Row>('SELECT * FROM mission_cash_accounts');
  const accountIds = new Set(accounts.map(account => String(account.id)));
  for (const account of accounts) {
    for (const bucket of BUCKETS) {
      const expected = entrySums.get(`${String(account.id)}:${bucket}`) ?? 0;
      const actual = Number(account[`${bucket}_cents`]);
      if (!Number.isSafeInteger(actual) || actual !== expected) fail({ code: 'account_balance_mismatch', accountId: String(account.id), expectedCents: expected, actualCents: Number.isSafeInteger(actual) ? actual : -1 });
    }
  }
  for (const [key, expected] of entrySums) {
    const accountId = key.slice(0, key.lastIndexOf(':'));
    if (!accountIds.has(accountId)) fail({ code: 'account_balance_mismatch', accountId, expectedCents: expected, actualCents: 0 });
  }

  // 3) Operation fingerprints and hold coverage. Account-level totals remain a
  //    useful cross-check, but they are not sufficient: two altered operations
  //    can trade reservation sizes while leaving the account total unchanged.
  //    The append-only cash entries are authoritative, so net held movement is
  //    recomputed independently for every operation reference and account.
  const operations = db.all<Row>('SELECT * FROM mission_money_operations');
  const operationIds = new Set(operations.map(operation => String(operation.id)));
  const liveOperations = operations.filter(operation => LIVE_OPERATION_STATES.has(String(operation.state)));
  const reservedByAccount = new Map<string, number>();
  const heldByOperation = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    if (String(entry.bucket) !== 'held' || !operationIds.has(String(entry.reference))) continue;
    const reference = String(entry.reference), accountId = String(entry.account_id);
    const byAccount = heldByOperation.get(reference) ?? new Map<string, number>();
    byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + Number(entry.delta_cents));
    heldByOperation.set(reference, byAccount);
  }
  for (const operation of operations) {
    const reference = String(operation.id), accountId = String(operation.account_id);
    if (fingerprintForStoredOperation(operation) !== String(operation.fingerprint)) {
      fail({ code: 'operation_fingerprint_mismatch', accountId, reference });
    }
    const expectedHold = LIVE_OPERATION_STATES.has(String(operation.state)) ? Number(operation.max_cost_cents) : 0;
    const byAccount = heldByOperation.get(reference) ?? new Map<string, number>();
    const actualHold = byAccount.get(accountId) ?? 0;
    if (!Number.isSafeInteger(expectedHold) || actualHold !== expectedHold) {
      fail({ code: 'operation_hold_mismatch', accountId, reference, expectedCents: expectedHold, actualCents: actualHold });
    }
    // A changed account_id must not hide a hold under the operation's original
    // account. Net-zero historical movements are valid and intentionally kept.
    for (const [entryAccountId, held] of byAccount) {
      if (entryAccountId !== accountId && held !== 0) {
        fail({ code: 'operation_hold_mismatch', accountId: entryAccountId, reference, expectedCents: 0, actualCents: held });
      }
    }
  }
  for (const op of liveOperations) {
    const accountId = String(op.account_id);
    reservedByAccount.set(accountId, (reservedByAccount.get(accountId) ?? 0) + Number(op.max_cost_cents));
  }
  let accountsHeld = 0, operationsHeld = 0;
  for (const account of accounts) {
    const held = Number(account.held_cents);
    const reserved = reservedByAccount.get(String(account.id)) ?? 0;
    accountsHeld += held;
    operationsHeld += reserved;
    if (held > reserved) fail({ code: 'held_without_operation', accountId: String(account.id), expectedCents: reserved, actualCents: held });
    else if (held < reserved) fail({ code: 'operation_without_hold', accountId: String(account.id), expectedCents: reserved, actualCents: held });
  }
  for (const [accountId, reserved] of reservedByAccount) {
    if (!accountIds.has(accountId)) fail({ code: 'operation_without_hold', accountId, expectedCents: reserved, actualCents: 0 });
  }

  // 4) Reference closure. Every entry must be explained by an operation, a
  //    provider receipt, an owner allocation transfer or a liability payment —
  //    a chain-valid entry with no explanation is exactly what this catches.
  const receiptIds = new Set(db.all<Row>('SELECT external_id FROM mission_money_receipts').map(r => String(r.external_id)));
  const transferKeys = new Set(db.all<Row>('SELECT idempotency_key FROM mission_money_transfers').map(r => String(r.idempotency_key)));
  const liabilityIds = new Set(db.all<Row>('SELECT external_id FROM mission_cash_liabilities').map(r => String(r.external_id)));
  for (const r of entries) {
    const reference = String(r.reference);
    if (operationIds.has(reference) || receiptIds.has(reference)) continue;
    if (reference.startsWith('allocation:') && transferKeys.has(reference.slice('allocation:'.length))) continue;
    if (reference.startsWith('liability:') && liabilityIds.has(reference.slice('liability:'.length))) continue;
    fail({ code: 'orphan_ledger_reference', seq: Number(r.seq), reference });
  }

  // 5) Provider debt is never negative (the schema CHECKs this; a reconciler
  //    must not trust the schema alone).
  const liabilities = db.all<Row>('SELECT * FROM mission_cash_liabilities');
  for (const liability of liabilities) {
    const remaining = Number(liability.remaining_cents);
    if (!Number.isSafeInteger(remaining) || remaining < 0) fail({ code: 'negative_liability', reference: `${String(liability.provider)}:${String(liability.external_id)}`, expectedCents: 0, actualCents: Number.isSafeInteger(remaining) ? remaining : -1 });
  }

  return {
    ok: mismatchCount === 0,
    checkedAt: nowIso(),
    counts: { entries: entries.length, accounts: accounts.length, liveOperations: liveOperations.length, receipts: receiptIds.size, transfers: transferKeys.size, liabilities: liabilities.length },
    heldCents: { accounts: accountsHeld, operations: operationsHeld },
    mismatchCount,
    mismatches,
  };
}
