import { createHash } from 'node:crypto';
import { db } from '../db/database';
import { createId } from '../db/id';
import { recordEconomyEvent } from '../db/economy-repositories';
import { categoriesForMechanism, platformKeyFor } from './platforms';

/**
 * SCALABLE INVENTORY IMPORT — the production-grade path from raw expansion
 * rows to the verified earning catalog.
 *
 * Design for ~1M rows:
 *   - Streaming-friendly: importBatch takes any array (file chunk, API page,
 *     crawler output) and reports exact counts; callers page through sources.
 *   - Dedupe at three levels: canonical platform_key, (source, external_id)
 *     UNIQUE index, and content_hash (same program from two sources merges).
 *   - Nothing invalid enters the catalog: bad rows land in
 *     economy_inventory_quarantine with the EXACT reason, plus the batch id
 *     that carried them. Rejected-status rows are counted, never stored.
 *   - Anti-fabrication core: a candidate/verified row WITHOUT payout evidence
 *     is quarantined, never imported. No evidence → no catalog row → no agent
 *     assignment → no revenue. The chain cannot start from nothing.
 */

export interface ImportRow {
  name?: string;
  official_url?: string;
  url?: string;
  earning_mechanism?: string;
  mechanism?: string;
  status?: string;
  payout_evidence?: string;
  fees?: string;
  payout_method?: string;
  minimum_payout?: string;
  account_kyc?: string;
  countries?: string;
  risk_level?: string;
  risk?: string;
  source_urls?: string[];
  sources?: string[];
  verification_date?: string;
  source?: string;
  external_id?: string;
}

export interface ImportReport {
  batchId: string;
  source: string;
  received: number;
  imported: number;
  duplicates: number;
  quarantined: number;
  rejected: number;
}

export function contentHashFor(row: { name: string; mechanism: string; payoutEvidence: string; source: string; externalId: string }): string {
  return createHash('sha256')
    .update([row.name.toLowerCase().trim(), row.mechanism, row.payoutEvidence.trim(), row.source, row.externalId].join('|'))
    .digest('hex');
}

function quarantine(batchId: string, row: ImportRow, source: string, reason: string): void {
  db.run(
    'INSERT INTO economy_inventory_quarantine (id, batch_id, source, external_id, name, reason, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [createId('eco_qrt'), batchId, source, String(row.external_id ?? ''), String(row.name ?? ''), reason, JSON.stringify(row).slice(0, 8000)],
  );
}

export function importBatch(source: string, rows: ImportRow[], notes = ''): ImportReport {
  const batchId = createId('eco_imb');
  db.run('INSERT INTO economy_inventory_batches (id, source, received, notes) VALUES (?, ?, ?, ?)', [batchId, source, rows.length, notes]);
  let imported = 0;
  let duplicates = 0;
  let quarantined = 0;
  let rejected = 0;
  for (const row of rows) {
    const name = (row.name ?? '').trim();
    if (!name) { quarantine(batchId, row, source, 'missing_name'); quarantined += 1; continue; }
    if (name.length > 300) { quarantine(batchId, row, source, 'name_too_long'); quarantined += 1; continue; }
    if (row.status === 'rejected') { rejected += 1; continue; }
    if (row.status !== 'verified' && row.status !== 'candidate') {
      quarantine(batchId, row, source, 'invalid_status'); quarantined += 1; continue;
    }
    const mechanism = (row.earning_mechanism || row.mechanism || '').trim();
    if (!mechanism) { quarantine(batchId, row, source, 'missing_mechanism'); quarantined += 1; continue; }
    const payoutEvidence = (row.payout_evidence ?? '').trim();
    if (payoutEvidence.length < 20) {
      quarantine(batchId, row, source, 'missing_payout_evidence');
      quarantined += 1;
      continue;
    }
    const key = platformKeyFor(name);
    const externalId = String(row.external_id ?? '').trim();
    const hash = contentHashFor({ name, mechanism, payoutEvidence, source, externalId });
    const dupe = db.get<{ platform_key: string }>(
      'SELECT platform_key FROM economy_platforms WHERE platform_key = ? OR content_hash = ? OR (external_id != \'\' AND source = ? AND external_id = ?)',
      [key, hash, source, externalId],
    );
    if (dupe || !key) { duplicates += 1; continue; }
    const sources = row.source_urls ?? row.sources ?? [];
    db.run(
      `INSERT OR IGNORE INTO economy_platforms
        (platform_key, name, official_url, mechanism, workforce_categories_json, status, payout_evidence, fees, payout_method, minimum_payout, account_kyc, countries, risk_level, source_urls_json, verification_date, source, external_id, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key, name, row.official_url ?? row.url ?? '', mechanism,
        JSON.stringify(categoriesForMechanism(mechanism)),
        row.status, payoutEvidence,
        row.fees ?? '', row.payout_method ?? '', row.minimum_payout ?? '',
        row.account_kyc ?? '', row.countries ?? '',
        row.risk_level ?? row.risk ?? 'unknown',
        JSON.stringify(sources), row.verification_date ?? '',
        source, externalId, hash,
      ],
    );
    imported += 1;
  }
  db.run('UPDATE economy_inventory_batches SET imported = ?, duplicates = ?, quarantined = ?, rejected = ? WHERE id = ?',
    [imported, duplicates, quarantined, rejected, batchId]);
  recordEconomyEvent({
    kind: 'platform', actor: 'inventory-import',
    summary: `inventory batch ${batchId} [${source}]: ${imported} imported, ${duplicates} duplicates, ${quarantined} quarantined, ${rejected} rejected (received ${rows.length})`,
    details: { batchId, source },
  });
  return { batchId, source, received: rows.length, imported, duplicates, quarantined, rejected };
}

export interface InventoryBatchRow {
  id: string; source: string; received: number; imported: number;
  duplicates: number; quarantined: number; rejected: number; notes: string; created_at: string;
}

export function listInventoryBatches(limit = 100): InventoryBatchRow[] {
  return db.all<InventoryBatchRow>('SELECT * FROM economy_inventory_batches ORDER BY created_at DESC LIMIT ?', [Math.min(500, Math.max(1, limit))]);
}

export interface QuarantineRow {
  id: string; batch_id: string; source: string; external_id: string;
  name: string; reason: string; payload_json: string; created_at: string;
}

export function listQuarantine(batchId?: string, limit = 100): QuarantineRow[] {
  if (batchId) {
    return db.all<QuarantineRow>('SELECT * FROM economy_inventory_quarantine WHERE batch_id = ? ORDER BY created_at DESC LIMIT ?', [batchId, Math.min(500, Math.max(1, limit))]);
  }
  return db.all<QuarantineRow>('SELECT * FROM economy_inventory_quarantine ORDER BY created_at DESC LIMIT ?', [Math.min(500, Math.max(1, limit))]);
}

export function inventoryMetrics(): {
  total: number; verified: number; candidate: number;
  bySource: Array<{ source: string; n: number }>;
  byMechanism: Array<{ mechanism: string; n: number }>;
  batches: number; quarantined: number;
} {
  const total = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_platforms')?.n ?? 0;
  const verified = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM economy_platforms WHERE status = 'verified'")?.n ?? 0;
  return {
    total,
    verified,
    candidate: total - verified,
    bySource: db.all<{ source: string; n: number }>('SELECT source, COUNT(*) AS n FROM economy_platforms GROUP BY source ORDER BY n DESC LIMIT 100'),
    byMechanism: db.all<{ mechanism: string; n: number }>('SELECT mechanism, COUNT(*) AS n FROM economy_platforms GROUP BY mechanism ORDER BY n DESC LIMIT 100'),
    batches: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_inventory_batches')?.n ?? 0,
    quarantined: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM economy_inventory_quarantine')?.n ?? 0,
  };
}
