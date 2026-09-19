import { db, type SqlValue } from '../db/database';
import { createId } from '../db/id';
import { sendWorkforceEmail } from './email';

/**
 * CENTRALIZED OWNER ALERTING (D11).
 *
 * The audit found 8 silent-stop conditions with zero push alerting. This
 * module is the single choke point: subsystems raise alerts here, and exactly
 * ONE open alert exists per dedupe key — repeats increment a counter instead
 * of spamming. Email delivery is best-effort via the existing honest SMTP
 * sender and is itself honestly recorded (stored / not_configured / sent /
 * failed). Delivery problems NEVER throw into callers: a broken mailbox must
 * not break executions, discovery, or settlement.
 *
 * Imports are deliberately narrow (db + email only) so economy, workforce,
 * and tool modules can all raise alerts without import cycles.
 */

export type AlertCondition =
  | 'discovery-unavailable'
  | 'source-blocked'
  | 'workflow-failed'
  | 'stale-executions'
  | 'settlement-awaiting-owner';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertRow {
  id: string;
  dedupe_key: string;
  condition: string;
  severity: string;
  title: string;
  detail: string;
  occurrences: number;
  status: string;
  delivery_status: string;
  delivery_ref: string | null;
  delivery_error: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
}

const NOW = (): string => new Date().toISOString();

function alertRecipient(): string | null {
  const to = (process.env.OWNER_ALERT_EMAIL ?? '').trim();
  return to.length > 0 ? to : null;
}

async function tryDeliver(alert: AlertRow): Promise<{ status: string; ref: string | null; error: string | null }> {
  const to = alertRecipient();
  if (!to) return { status: 'not_configured', ref: null, error: 'OWNER_ALERT_EMAIL is not set' };
  try {
    const ref = await sendWorkforceEmail({
      to,
      subject: `[AKBARAL ${alert.severity.toUpperCase()}] ${alert.title}`.slice(0, 200),
      text: `${alert.title}\n\nCondition: ${alert.condition}\nSeverity: ${alert.severity}\nAt: ${alert.created_at}\n\n${alert.detail}`.slice(0, 20_000),
    });
    return { status: 'sent', ref, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as Error & { code?: string }).code;
    if (code === 'provider_not_configured') {
      return { status: 'not_configured', ref: null, error: message.slice(0, 300) };
    }
    return { status: 'failed', ref: null, error: message.slice(0, 300) };
  }
}

function storeAlert(input: {
  condition: AlertCondition; severity: AlertSeverity; title: string; detail: string; dedupeKey: string;
}): { alert: AlertRow; isNew: boolean } {
  const open = db.get<AlertRow>('SELECT * FROM owner_alerts WHERE dedupe_key = ? AND status = ? ORDER BY rowid DESC LIMIT 1', [input.dedupeKey, 'open']);
  if (open) {
    db.run('UPDATE owner_alerts SET occurrences = occurrences + 1, detail = ?, updated_at = ? WHERE id = ?',
      [input.detail.slice(0, 4000), NOW(), open.id]);
    return { alert: db.get<AlertRow>('SELECT * FROM owner_alerts WHERE id = ?', [open.id])!, isNew: false };
  }
  const id = createId('eco_alr');
  db.run(
    `INSERT INTO owner_alerts (id, dedupe_key, condition, severity, title, detail)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.dedupeKey, input.condition, input.severity, input.title.slice(0, 300), input.detail.slice(0, 4000)],
  );
  return { alert: db.get<AlertRow>('SELECT * FROM owner_alerts WHERE id = ?', [id])!, isNew: true };
}

/**
 * Raise an alert. Delivery is attempted ONLY for newly opened alerts (repeats
 * just bump the counter) and delivery failure is recorded, never thrown.
 */
export async function raiseAlert(input: {
  condition: AlertCondition;
  severity?: AlertSeverity;
  title: string;
  detail?: string;
  dedupeKey: string;
}): Promise<AlertRow> {
  if (!input.dedupeKey || !input.title) throw new Error('raiseAlert requires dedupeKey and title');
  const { alert, isNew } = storeAlert({
    condition: input.condition,
    severity: input.severity ?? 'warning',
    title: input.title,
    detail: input.detail ?? '',
    dedupeKey: input.dedupeKey,
  });
  if (!isNew) return alert;
  let delivery: { status: string; ref: string | null; error: string | null };
  try {
    delivery = await tryDeliver(alert);
  } catch (error) {
    delivery = { status: 'failed', ref: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
  db.run('UPDATE owner_alerts SET delivery_status = ?, delivery_ref = ?, delivery_error = ?, updated_at = ? WHERE id = ?',
    [delivery.status, delivery.ref, delivery.error, NOW(), alert.id]);
  return db.get<AlertRow>('SELECT * FROM owner_alerts WHERE id = ?', [alert.id])!;
}

/**
 * Fire-and-forget variant for synchronous call sites (health recorders,
 * reconciliation). Storage itself is synchronous so the alert is durable
 * before this returns; only email delivery runs in the background.
 */
export function raiseAlertSync(input: {
  condition: AlertCondition;
  severity?: AlertSeverity;
  title: string;
  detail?: string;
  dedupeKey: string;
}): AlertRow {
  if (!input.dedupeKey || !input.title) throw new Error('raiseAlertSync requires dedupeKey and title');
  const { alert, isNew } = storeAlert({
    condition: input.condition,
    severity: input.severity ?? 'warning',
    title: input.title,
    detail: input.detail ?? '',
    dedupeKey: input.dedupeKey,
  });
  if (isNew) {
    void tryDeliver(alert)
      .then((delivery) => {
        db.run('UPDATE owner_alerts SET delivery_status = ?, delivery_ref = ?, delivery_error = ?, updated_at = ? WHERE id = ?',
          [delivery.status, delivery.ref, delivery.error, NOW(), alert.id]);
      })
      .catch(() => { /* delivery failure is recorded by tryDeliver; never throws */ });
  }
  return alert;
}

export function listAlerts(status?: string, limit = 100): AlertRow[] {
  const capped = Math.min(Math.max(limit, 1), 500);
  return status
    ? db.all<AlertRow>('SELECT * FROM owner_alerts WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, capped])
    : db.all<AlertRow>('SELECT * FROM owner_alerts ORDER BY created_at DESC LIMIT ?', [capped]);
}

export function getAlert(id: string): AlertRow | undefined {
  return db.get<AlertRow>('SELECT * FROM owner_alerts WHERE id = ?', [id]);
}

export function countOpenAlerts(): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM owner_alerts WHERE status = ?', ['open'])?.n ?? 0;
}

export function acknowledgeAlert(id: string, by: string): AlertRow {
  const alert = getAlert(id);
  if (!alert) throw new Error('alert not found');
  if (alert.status !== 'open') return alert;
  db.run('UPDATE owner_alerts SET status = ?, acknowledged_by = ?, acknowledged_at = ?, updated_at = ? WHERE id = ?',
    ['acknowledged', by.slice(0, 160), NOW(), NOW(), id]);
  return getAlert(id)!;
}

export function resolveAlert(id: string): AlertRow {
  const alert = getAlert(id);
  if (!alert) throw new Error('alert not found');
  db.run('UPDATE owner_alerts SET status = ?, updated_at = ? WHERE id = ?', ['resolved', NOW(), id] as SqlValue[]);
  return getAlert(id)!;
}

// ── Shared dedupe keys (one namespace, both schedulers) ─────────────────────

export function discoveryAlertKey(category: string): string {
  return `discovery-unavailable:${category}`;
}

export function sourceBlockedAlertKey(sourceKey: string): string {
  return `source-blocked:${sourceKey}`;
}

export function workflowFailedAlertKey(agentSlug: string, category: string, workflowKey: string): string {
  return `workflow-failed:${agentSlug}:${category}:${workflowKey}`;
}
