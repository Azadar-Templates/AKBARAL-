// ─────────────────────────────────────────────────────────────────────────────
// ZA141251SA — compact owner summary
//
// The full mission surface (ledger, policy, approvals, credentials, publishing,
// accounting, customer work…) is unchanged and still served by its own routes.
// This module answers the four questions the owner actually opens the mission
// for:
//
//   · what are my agents doing?
//   · how much verified money is available?
//   · can I talk to my agents?
//   · can I withdraw?
//
// Every figure below is read from the mission database. Verified money is only
// revenue with status 'received' AND a verifier; anything expected or
// contracted is reported separately and never added to a balance.
// ─────────────────────────────────────────────────────────────────────────────

import { missionDb, nowIso, type Row } from './database';
import { currentPolicy } from './policy';
import { verifyMissionAudit } from './database';
import { ensureMissionTreasury, ensurePayoutSlots, verifyLedger } from './treasury';
import { identityLockStatus } from './identity-lock';

const num = (value: unknown): number => Number(value ?? 0) || 0;

export interface OwnerSummaryAlert {
  level: 'info' | 'warn' | 'danger';
  message: string;
}

/** Audit actions rendered in plain language; anything else is shown as-is. */
const ACTIVITY_LABELS: Record<string, string> = {
  'auth.login': 'Owner signed in',
  'auth.logout': 'Owner signed out',
  'auth.login_failed': 'A sign-in was refused (wrong password)',
  'auth.login_refused_identity_lock': 'A sign-in from another identity was blocked',
  'owner.password_reset': 'Owner password changed',
  'owner.password_set_via_setup_link': 'Owner password set from the setup link',
  'owner.setup_link_issued': 'A one-time password setup link was issued',
  'identity_lock.enforced': 'Identity lock enforced',
  'agent.paused': 'An agent was paused',
  'agent.resumed': 'An agent was resumed',
  'agent.retired': 'An agent was retired',
  'agent.created': 'An agent was created',
  'work.created': 'New work was recorded',
  'work.status_changed': 'Work status changed',
  'revenue.recorded': 'Revenue was recorded',
  'revenue.verified': 'Revenue was verified',
  'payout.requested': 'A withdrawal was requested',
  'payout.decided': 'A withdrawal was decided',
  'payout.settled': 'A withdrawal settled',
  'expense.requested': 'An expense was requested',
  'expense.decided': 'An expense was decided',
  'policy.updated': 'Policy updated',
  'kill_switch.engaged': 'Kill switch engaged',
  'kill_switch.released': 'Kill switch released',
  'message.appended': 'A message was exchanged with an agent',
};

function friendlyActivity(action: string): string {
  if (ACTIVITY_LABELS[action]) return ACTIVITY_LABELS[action];
  return action.replace(/[._]/g, ' ').replace(/^\w/, (character) => character.toUpperCase());
}

export function buildOwnerSummary(): Record<string, unknown> {
  const policy = currentPolicy();
  const currency = policy.currency;

  // ── money: verified only ──────────────────────────────────────────────────
  const treasury = ensureMissionTreasury();
  const revenue = missionDb.get<Row>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'received' AND verifier IS NOT NULL AND verifier != '' THEN amount_cents ELSE 0 END), 0) AS verified,
       COALESCE(SUM(CASE WHEN status IN ('expected','contracted') THEN amount_cents ELSE 0 END), 0) AS expected,
       MAX(CASE WHEN status = 'received' AND verifier IS NOT NULL AND verifier != '' THEN received_at END) AS last_verified_at
     FROM mission_revenue`,
  );
  const verifiedToday = missionDb.get<Row>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM mission_revenue
      WHERE status = 'received' AND verifier IS NOT NULL AND verifier != ''
        AND substr(COALESCE(received_at, created_at), 1, 10) = substr(?, 1, 10)`,
    [nowIso()],
  );
  const verified30d = missionDb.get<Row>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM mission_revenue
      WHERE status = 'received' AND verifier IS NOT NULL AND verifier != ''
        AND COALESCE(received_at, created_at) >= datetime('now', '-30 days')`,
  );
  const pendingWithdrawals = missionDb.get<Row>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS count
       FROM mission_payouts WHERE status IN ('pending_approval','approved','sent')`,
  );
  const settledWithdrawals = missionDb.get<Row>(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS count
       FROM mission_payouts WHERE status = 'settled'`,
  );

  // ── agents ────────────────────────────────────────────────────────────────
  const agentCounts = missionDb.get<Row>(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
       COALESCE(SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END), 0) AS paused,
       COALESCE(SUM(CASE WHEN status = 'retired' THEN 1 ELSE 0 END), 0) AS retired
     FROM mission_agents`,
  );
  const workingAgents = missionDb.get<Row>(
    `SELECT COUNT(DISTINCT agent_id) AS count FROM mission_work WHERE status IN ('approved','in_progress')`,
  );

  // ── work ──────────────────────────────────────────────────────────────────
  const workCounts = missionDb.get<Row>(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress,
       COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered
     FROM mission_work`,
  );
  const recentWork = missionDb.all<Row>(
    `SELECT w.id, w.title, w.status, w.updated_at, w.revenue_cents, a.slug AS agent_slug, a.name AS agent_name
       FROM mission_work w LEFT JOIN mission_agents a ON a.id = w.agent_id
      ORDER BY w.updated_at DESC LIMIT 6`,
  );

  // ── recent activity (plain language, no secrets) ──────────────────────────
  const activity = missionDb
    .all<Row>(`SELECT created_at, action, actor_type FROM mission_audit ORDER BY seq DESC LIMIT 8`)
    .map((row) => ({
      at: String(row.created_at),
      action: String(row.action),
      actor: String(row.actor_type),
      summary: friendlyActivity(String(row.action)),
    }));

  // ── withdrawal surface ────────────────────────────────────────────────────
  const slots = ensurePayoutSlots().map((slot) => ({
    slot: num(slot.slot),
    label: String(slot.label ?? ''),
    destinationType: slot.destination_type ? String(slot.destination_type) : null,
    masked: slot.masked_account ? String(slot.masked_account) : slot.provider_ref ? String(slot.provider_ref) : null,
    status: String(slot.status ?? 'unconfigured'),
    verifiedAt: slot.verified_at ? String(slot.verified_at) : null,
    minPayoutCents: num(slot.min_payout_cents),
  }));
  const payouts = missionDb
    .all<Row>(
      `SELECT p.id, p.slot, p.amount_cents, p.currency, p.status, p.created_at, p.settled_at, p.settlement_ref, s.label
         FROM mission_payouts p LEFT JOIN mission_payout_slots s ON s.slot = p.slot
        ORDER BY p.created_at DESC LIMIT 10`,
    )
    .map((row) => ({
      id: String(row.id),
      slot: num(row.slot),
      label: row.label ? String(row.label) : `Slot ${num(row.slot)}`,
      amountCents: num(row.amount_cents),
      currency: String(row.currency ?? currency),
      status: String(row.status),
      createdAt: String(row.created_at),
      settledAt: row.settled_at ? String(row.settled_at) : null,
      settlementRef: row.settlement_ref ? String(row.settlement_ref) : null,
    }));

  // ── alerts: only things the owner must act on ────────────────────────────
  const alerts: OwnerSummaryAlert[] = [];
  const pendingApprovals = num(missionDb.get<Row>(`SELECT COUNT(*) AS count FROM mission_approvals WHERE status = 'pending'`)?.count);
  const frozenWallets = num(missionDb.get<Row>(`SELECT COUNT(*) AS count FROM mission_wallets WHERE status = 'frozen'`)?.count);
  const audit = verifyMissionAudit();
  const ledger = verifyLedger();
  const lock = identityLockStatus();

  if (policy.killSwitch) alerts.push({ level: 'danger', message: 'Kill switch is engaged — all mission activity is suspended.' });
  if (!audit.ok) alerts.push({ level: 'danger', message: 'Audit chain verification failed.' });
  if (!ledger.ok) alerts.push({ level: 'danger', message: 'Ledger chain verification failed.' });
  if (!lock.enabled) alerts.push({ level: 'danger', message: 'Owner identity lock is not configured.' });
  if (frozenWallets > 0) alerts.push({ level: 'warn', message: `${frozenWallets} wallet${frozenWallets === 1 ? '' : 's'} frozen.` });
  if (pendingApprovals > 0) alerts.push({ level: 'warn', message: `${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} waiting for your decision.` });
  if (num(pendingWithdrawals?.count) > 0) {
    alerts.push({ level: 'info', message: `${num(pendingWithdrawals?.count)} withdrawal${num(pendingWithdrawals?.count) === 1 ? '' : 's'} in progress.` });
  }

  const verifiedAvailableCents = num(treasury?.balanceCents);
  const payableSlots = slots.filter((slot) => slot.status === 'active' && slot.verifiedAt);

  return {
    generatedAt: nowIso(),
    currency,
    money: {
      verifiedAvailableCents,
      verifiedEarnedTotalCents: num(revenue?.verified),
      verifiedEarnedTodayCents: num(verifiedToday?.total),
      verifiedEarned30dCents: num(verified30d?.total),
      expectedNotEarnedCents: num(revenue?.expected),
      pendingWithdrawalCents: num(pendingWithdrawals?.total),
      settledWithdrawalCents: num(settledWithdrawals?.total),
      lastVerifiedAt: revenue?.last_verified_at ? String(revenue.last_verified_at) : null,
      note: 'Verified money is revenue that was received AND independently verified. Expected or contracted amounts are never counted as balance.',
    },
    agents: {
      total: num(agentCounts?.total),
      active: num(agentCounts?.active),
      paused: num(agentCounts?.paused),
      retired: num(agentCounts?.retired),
      working: num(workingAgents?.count),
    },
    work: {
      total: num(workCounts?.total),
      inProgress: num(workCounts?.in_progress),
      delivered: num(workCounts?.delivered),
      recent: recentWork.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        status: String(row.status),
        agentSlug: row.agent_slug ? String(row.agent_slug) : null,
        agentName: row.agent_name ? String(row.agent_name) : null,
        updatedAt: String(row.updated_at),
        revenueCents: num(row.revenue_cents),
      })),
    },
    activity,
    alerts,
    withdraw: {
      availableCents: verifiedAvailableCents,
      pendingCents: num(pendingWithdrawals?.total),
      pendingCount: num(pendingWithdrawals?.count),
      settledCents: num(settledWithdrawals?.total),
      settledCount: num(settledWithdrawals?.count),
      maxPayoutCents: policy.maxPayoutCents,
      destinations: slots,
      payableSlots: payableSlots.map((slot) => slot.slot),
      payouts,
    },
    card: {
      // There is no issued mission card: no card programme is connected and no
      // card credential exists. This is reported as-is — never as a balance on
      // a card that does not exist.
      status: 'NOT ISSUED',
      availableCents: verifiedAvailableCents,
      providerConnected: Boolean((process.env.ZA141251SA_STRIPE_SECRET_KEY ?? '').trim()),
      providerName: 'Stripe (mission-dedicated keys)',
      requirements: [
        'A mission-dedicated payment provider account (ZA141251SA_STRIPE_SECRET_KEY / ZA141251SA_STRIPE_ACCOUNT_ID).',
        'A verified payout destination in the Withdraw section.',
        'Verified balance to fund the card — cards are never funded from expected revenue.',
      ],
      note: 'Agents never hold card or bank credentials; unrestricted card APIs are blocked by policy.',
    },
    integrity: {
      auditOk: audit.ok,
      auditRows: audit.rows,
      ledgerOk: ledger.ok,
      identityLocked: lock.enabled,
      killSwitch: policy.killSwitch,
    },
  };
}
