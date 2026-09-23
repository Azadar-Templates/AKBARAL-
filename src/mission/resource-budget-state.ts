import { missionDb, type Row } from './database';

/** Held exposure survives midnight, crashes and quota-only reconciliation. */
export function heldResourceBudget(walletId?: string, excludeCallId?: string): number {
  const row = missionDb.get<Row>(`SELECT COALESCE(SUM(reserved_cents), 0) AS cents FROM mission_resource_call_budgets WHERE status = 'held'${walletId ? ' AND wallet_id = ?' : ''}${excludeCallId ? ' AND call_id <> ?' : ''}`, [...(walletId ? [walletId] : []), ...(excludeCallId ? [excludeCallId] : [])]);
  const amount = Number(row?.cents ?? 0);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('invalid held provider exposure');
  return amount;
}
