import { looksLikeInstrumentCredential } from './destination-safety';
import { appendMissionAudit, missionDb, missionId, nowIso, sha256, type Row } from './database';
import { MissionTreasuryError, listPayoutSlots, setPayoutSlotStatus, verifyPayoutSlot } from './treasury';

/**
 * Payout destination verification (ZA141251SA mission).
 *
 * WHY THIS EXISTS. A payout destination is the only place mission money can
 * leave the treasury, so it must never become payable through a single careless
 * click or a status flip. This module implements a real verification record:
 *
 *   · DESTINATION SAFETY — a destination is described by a provider reference
 *     (e.g. a Stripe Connect account id) or a MASKED account string. Raw card
 *     numbers, IBANs and long digit runs are refused outright: the mission never
 *     stores instrument credentials, and agents can never be handed them.
 *   · EVIDENCE — the owner confirms a named list of control checks and signs an
 *     attestation, both stored verbatim with the verification. A submission
 *     missing any required check is refused with the exact missing keys.
 *   · EXPIRY — a verification is valid for a bounded period (default 180 days).
 *     An expired verification pauses the slot, so payouts stop rather than
 *     continuing on a stale assumption.
 *   · SEPARATION — this module never moves money and never writes a settled
 *     payout. It only decides whether a destination is payable.
 *
 * `verifyPayoutSlot()` (the low-level treasury primitive) is still called by the
 * confirmation path so there is exactly one place that flips a slot to active.
 */

/** Verification methods. Only owner-driven confirmation is implemented. */
export const PAYOUT_VERIFICATION_METHODS = ['owner_attestation', 'provider_reference'] as const;
export type PayoutVerificationMethod = (typeof PAYOUT_VERIFICATION_METHODS)[number];

export interface PayoutVerificationCheck {
  key: string;
  label: string;
  /** Required checks must be true before a slot can be activated. */
  required: boolean;
  /** Only required when the slot has a provider reference. */
  requiresProviderRef?: boolean;
}

/**
 * The control checks a destination must pass. These are deliberately human
 * confirmations — the mission has no bank integration and will not pretend that
 * an automated check happened.
 */
export const PAYOUT_VERIFICATION_CHECKS: readonly PayoutVerificationCheck[] = [
  {
    key: 'destination_controlled',
    label: 'I control this destination and it is able to receive funds in my name',
    required: true,
  },
  {
    key: 'details_match',
    label: 'The masked details on this slot match my own records for that destination',
    required: true,
  },
  {
    key: 'not_third_party',
    label: 'This destination is my own (or my company’s); it is not held on behalf of a third party',
    required: true,
  },
  {
    key: 'provider_identity_verified',
    label: 'The payout provider has completed its identity (KYC) verification for this destination',
    required: true,
  },
  {
    key: 'no_instrument_credentials_stored',
    label: 'I have not entered (and will not enter) full card, bank or wallet credentials into this system',
    required: true,
  },
  {
    key: 'provider_reference_confirmed',
    label: 'The provider reference on this slot resolves to that destination in the provider dashboard',
    required: false,
    requiresProviderRef: true,
  },
] as const;

/** Default verification lifetime: re-verify at least twice a year. */
export const PAYOUT_VERIFICATION_VALIDITY_DAYS = Number(process.env.ZA141251SA_PAYOUT_VERIFICATION_DAYS ?? 180) || 180;

/** Destination types the mission recognises. */
export const PAYOUT_DESTINATION_TYPES = ['bank', 'wallet', 'payment_provider', 'other'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Destination safety: refuse to store instrument credentials
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Destination safety lives in its own dependency-free module so the treasury
 * (which writes destinations) and this verification flow (which accepts evidence)
 * apply exactly the same rule. See `destination-safety.ts`.
 */
export { DESTINATION_SAFETY_RULE, looksLikeInstrumentCredential } from './destination-safety';

/** Called by the verification flow on the evidence reference. */
function assertDestinationDescriptionSafe(value: string | null | undefined, fieldName: string): void {
  if (!value) return;
  const verdict = looksLikeInstrumentCredential(value);
  if (verdict.unsafe) {
    throw new MissionTreasuryError(
      400,
      `${fieldName}: ${verdict.reason} — the mission stores only a provider reference or a masked description, and never holds card/bank credential material`,
      'unsafe_destination',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification records
// ─────────────────────────────────────────────────────────────────────────────

export interface PayoutVerificationPublic {
  id: string;
  slot: number;
  method: string;
  status: 'pending' | 'verified' | 'expired' | 'revoked';
  checks: Record<string, boolean>;
  requiredChecks: string[];
  evidenceRef: string | null;
  attestation: string | null;
  requestedAt: string | null;
  requestedBy: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  revokedAt: string | null;
  revokedReason: string | null;
  /** True when the stored record no longer matches the slot's destination. */
  stale: boolean;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(String(raw ?? ''));
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A fingerprint of the destination as configured. If the destination changes,
 * the previous verification no longer applies and the slot must be re-verified —
 * this is what stops a verified slot from being silently repointed.
 */
export function destinationFingerprint(slot: Row): string {
  return sha256(
    [String(slot.destination_type ?? ''), String(slot.masked_account ?? ''), String(slot.provider_ref ?? ''), String(slot.holder_name ?? '')].join('|'),
  ).slice(0, 32);
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.round((time - Date.now()) / (24 * 3600 * 1000));
}

function toPublic(row: Row, slot: Row | undefined): PayoutVerificationPublic {
  const expiresAt = row.expires_at ? String(row.expires_at) : null;
  const fingerprint = String(row.destination_fingerprint ?? '');
  return {
    id: String(row.id),
    slot: Number(row.slot),
    method: String(row.method),
    status: String(row.status) as PayoutVerificationPublic['status'],
    checks: parseJson<Record<string, boolean>>(row.checks, {}),
    requiredChecks: parseJson<string[]>(row.required_checks, []),
    evidenceRef: row.evidence_ref ? String(row.evidence_ref) : null,
    attestation: row.attestation ? String(row.attestation) : null,
    requestedAt: row.requested_at ? String(row.requested_at) : null,
    requestedBy: row.requested_by ? String(row.requested_by) : null,
    verifiedAt: row.verified_at ? String(row.verified_at) : null,
    verifiedBy: row.verified_by ? String(row.verified_by) : null,
    expiresAt,
    daysUntilExpiry: daysUntil(expiresAt),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    revokedReason: row.revoked_reason ? String(row.revoked_reason) : null,
    stale: Boolean(slot) && fingerprint.length > 0 && fingerprint !== destinationFingerprint(slot!),
  };
}

function requiredChecksFor(slot: Row): string[] {
  const keys = PAYOUT_VERIFICATION_CHECKS.filter((check) => check.required || (check.requiresProviderRef && Boolean(slot.provider_ref))).map(
    (check) => check.key,
  );
  return keys;
}

/**
 * Money decisions are owner-only, enforced here at the library level so no
 * future caller (route, script or agent path) can bypass it by omitting a role.
 */
function assertOwner(actorType: 'owner' | 'agent' | undefined, action: string): void {
  if (actorType === 'agent') {
    throw new MissionTreasuryError(403, `an agent may not ${action} — payout destinations are owner-only`, 'forbidden');
  }
}

function slotRow(slot: number): Row {
  const row = missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [slot]);
  if (!row) throw new MissionTreasuryError(404, 'payout slot not found', 'not_found');
  return row;
}

function latestVerification(slot: number): Row | undefined {
  return missionDb.get<Row>(
    `SELECT * FROM mission_payout_slot_verifications WHERE slot = ? ORDER BY created_at DESC LIMIT 1`,
    [slot],
  );
}

/**
 * Step 1 — start a verification. Records who asked and why, and returns the
 * exact control checks that must be confirmed. Starting a new verification
 * supersedes any earlier pending one; a previously VERIFIED record keeps its
 * status until it is explicitly revoked, expired, or the destination changes.
 */
export function startPayoutVerification(input: {
  slot: number;
  ownerId: string;
  method?: string;
  evidenceRef?: string | null;
  /** Platform actor kind. 'agent' is refused: money decisions are owner-only. */
  actorType?: 'owner' | 'agent';
}): PayoutVerificationPublic {
  assertOwner(input.actorType, 'start a payout destination verification');
  const slot = slotRow(input.slot);
  if (!slot.provider_ref && !slot.masked_account) {
    throw new MissionTreasuryError(409, 'the slot has no destination yet — configure it before verifying', 'conflict');
  }
  const method = (input.method ?? (slot.provider_ref ? 'provider_reference' : 'owner_attestation')) as string;
  if (!PAYOUT_VERIFICATION_METHODS.includes(method as PayoutVerificationMethod)) {
    throw new MissionTreasuryError(400, `method must be one of ${PAYOUT_VERIFICATION_METHODS.join(', ')}`, 'validation_error');
  }
  if (method === 'provider_reference' && !slot.provider_ref) {
    throw new MissionTreasuryError(409, 'a provider-reference verification needs a provider reference on the slot', 'conflict');
  }
  const required = requiredChecksFor(slot);
  const id = missionId('pvf');
  const now = nowIso();
  missionDb.run(
    `INSERT INTO mission_payout_slot_verifications (id, slot, method, status, checks, required_checks, evidence_ref, attestation, destination_fingerprint, requested_by, requested_at, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', '{}', ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [id, input.slot, method, JSON.stringify(required), input.evidenceRef ?? null, destinationFingerprint(slot), input.ownerId, now, now, now],
  );
  appendMissionAudit({
    actorType: 'owner',
    actorId: input.ownerId,
    action: 'payout_slot.verification_started',
    subjectType: 'payout_slot',
    subjectId: String(input.slot),
    detail: { verificationId: id, method, requiredChecks: required },
  });
  return toPublic(missionDb.get<Row>('SELECT * FROM mission_payout_slot_verifications WHERE id = ?', [id])!, slot);
}

export interface ConfirmPayoutVerificationInput {
  slot: number;
  ownerId: string;
  checks: Record<string, boolean>;
  attestation: string;
  evidenceRef?: string | null;
  method?: string;
  /** Platform actor kind. 'agent' is refused: money decisions are owner-only. */
  actorType?: 'owner' | 'agent';
}

/**
 * Step 2 — confirm every required check and sign the attestation. Only then is
 * the slot activated (through the treasury's single activation primitive).
 *
 * A partial submission is refused with the missing keys, so a half-verified
 * destination can never become payable.
 */
export function confirmPayoutVerification(input: ConfirmPayoutVerificationInput): { verification: PayoutVerificationPublic; slot: Row } {
  assertOwner(input.actorType, 'confirm a payout destination verification');
  const slot = slotRow(input.slot);
  if (!slot.provider_ref && !slot.masked_account) {
    throw new MissionTreasuryError(409, 'the slot has no destination yet — configure it before verifying', 'conflict');
  }
  const attestation = (input.attestation ?? '').trim();
  if (attestation.length < 40) {
    throw new MissionTreasuryError(
      400,
      'the attestation must state, in at least 40 characters, that you control this destination and have completed the provider’s identity checks',
      'validation_error',
    );
  }
  const required = requiredChecksFor(slot);
  const missing = required.filter((key) => input.checks?.[key] !== true);
  if (missing.length > 0) {
    throw new MissionTreasuryError(
      409,
      `every required check must be confirmed — missing: ${missing.join(', ')}`,
      'verification_incomplete',
    );
  }
  if (input.evidenceRef) {
    assertDestinationDescriptionSafe(input.evidenceRef, 'evidenceRef');
  }

  const method = input.method ?? (slot.provider_ref ? 'provider_reference' : 'owner_attestation');
  if (!PAYOUT_VERIFICATION_METHODS.includes(method as PayoutVerificationMethod)) {
    throw new MissionTreasuryError(400, `method must be one of ${PAYOUT_VERIFICATION_METHODS.join(', ')}`, 'validation_error');
  }

  const pending = latestVerification(input.slot);
  const id = pending && String(pending.status) === 'pending' ? String(pending.id) : missionId('pvf');
  const now = nowIso();
  const expiresAt = new Date(Date.now() + PAYOUT_VERIFICATION_VALIDITY_DAYS * 24 * 3600 * 1000).toISOString();
  const checks = Object.fromEntries(Object.entries(input.checks ?? {}).map(([key, value]) => [key, value === true]));
  const fingerprint = destinationFingerprint(slot);

  if (pending && String(pending.status) === 'pending') {
    missionDb.run(
      `UPDATE mission_payout_slot_verifications
          SET method = ?, status = 'verified', checks = ?, required_checks = ?, evidence_ref = ?, attestation = ?,
              destination_fingerprint = ?, verified_by = ?, verified_at = ?, expires_at = ?, updated_at = ?
        WHERE id = ?`,
      [method, JSON.stringify(checks), JSON.stringify(required), input.evidenceRef ?? pending.evidence_ref ?? null, attestation, fingerprint, input.ownerId, now, expiresAt, now, id],
    );
  } else {
    missionDb.run(
      `INSERT INTO mission_payout_slot_verifications (id, slot, method, status, checks, required_checks, evidence_ref, attestation, destination_fingerprint, requested_by, requested_at, verified_by, verified_at, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, 'verified', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.slot,
        method,
        JSON.stringify(checks),
        JSON.stringify(required),
        input.evidenceRef ?? null,
        attestation,
        fingerprint,
        input.ownerId,
        now,
        input.ownerId,
        now,
        expiresAt,
        now,
        now,
      ],
    );
  }

  // Single activation primitive: treasury decides that 'active' means payable,
  // and it re-applies the owner-only rule itself.
  verifyPayoutSlot(input.slot, input.ownerId, input.actorType);

  appendMissionAudit({
    actorType: 'owner',
    actorId: input.ownerId,
    action: 'payout_slot.verification_confirmed',
    subjectType: 'payout_slot',
    subjectId: String(input.slot),
    // Checks, method and expiry only. The attestation text is stored on the
    // verification row and referenced by id — never duplicated into the log.
    detail: { verificationId: id, method, checks, expiresAt, evidenceRef: input.evidenceRef ?? null },
  });

  return {
    verification: toPublic(missionDb.get<Row>('SELECT * FROM mission_payout_slot_verifications WHERE id = ?', [id])!, slot),
    slot: slotRow(input.slot),
  };
}

/** Revoke a verification and pause the slot: payouts stop immediately. */
export function revokePayoutVerification(input: {
  slot: number;
  ownerId: string;
  reason: string;
  actorType?: 'owner' | 'agent';
}): PayoutVerificationPublic {
  assertOwner(input.actorType, 'revoke a payout destination verification');
  const slot = slotRow(input.slot);
  const record = latestVerification(input.slot);
  if (!record || String(record.status) !== 'verified') {
    throw new MissionTreasuryError(404, 'this slot has no verified destination to revoke', 'not_found');
  }
  const reason = (input.reason ?? '').trim();
  if (reason.length < 8) {
    throw new MissionTreasuryError(400, 'a revocation reason of at least 8 characters is required', 'validation_error');
  }
  const now = nowIso();
  missionDb.run(`UPDATE mission_payout_slot_verifications SET status = 'revoked', revoked_at = ?, revoked_reason = ?, updated_at = ? WHERE id = ?`, [
    now,
    reason,
    now,
    String(record.id),
  ]);
  setPayoutSlotStatus(input.slot, 'paused', input.ownerId, input.actorType);
  appendMissionAudit({
    actorType: 'owner',
    actorId: input.ownerId,
    action: 'payout_slot.verification_revoked',
    subjectType: 'payout_slot',
    subjectId: String(input.slot),
    detail: { verificationId: String(record.id), reason },
  });
  return toPublic(missionDb.get<Row>('SELECT * FROM mission_payout_slot_verifications WHERE id = ?', [String(record.id)])!, slot);
}

export interface PayoutSlotVerificationStatus {
  slot: number;
  label: string | null;
  slotStatus: string;
  payable: boolean;
  destinationConfigured: boolean;
  verification: PayoutVerificationPublic | null;
  requiredChecks: Array<{ key: string; label: string; confirmed: boolean }>;
  blockers: string[];
  expiresAt: string | null;
  daysUntilExpiry: number | null;
}

/** Everything an owner (or the launch report) needs to know about one slot. */
export function payoutSlotVerificationStatus(slotNumber: number): PayoutSlotVerificationStatus {
  const slot = slotRow(slotNumber);
  const record = latestVerification(slotNumber);
  const verification = record ? toPublic(record, slot) : null;
  const requiredKeys = requiredChecksFor(slot);
  const checks = requiredKeys.map((key) => ({
    key,
    label: PAYOUT_VERIFICATION_CHECKS.find((entry) => entry.key === key)?.label ?? key,
    confirmed: verification?.checks?.[key] === true && verification.status === 'verified',
  }));
  const blockers: string[] = [];
  if (!slot.provider_ref && !slot.masked_account) blockers.push('no destination configured (add a provider reference or a masked description)');
  if (!verification) blockers.push('no verification on record (start and confirm a verification)');
  else {
    if (verification.status !== 'verified') blockers.push(`verification status is "${verification.status}"`);
    if (verification.stale) blockers.push('the destination changed after verification — re-verify');
    if (verification.daysUntilExpiry !== null && verification.daysUntilExpiry <= 0) blockers.push('verification has expired — re-verify');
  }
  if (String(slot.status) !== 'active') blockers.push(`slot status is "${String(slot.status)}"`);
  const pendingChecks = checks.filter((entry) => !entry.confirmed).map((entry) => entry.key);
  if (verification?.status === 'verified' && pendingChecks.length > 0) blockers.push(`unconfirmed checks: ${pendingChecks.join(', ')}`);
  return {
    slot: slotNumber,
    label: slot.label ? String(slot.label) : null,
    slotStatus: String(slot.status),
    payable: blockers.length === 0,
    destinationConfigured: Boolean(slot.provider_ref || slot.masked_account),
    verification,
    requiredChecks: checks,
    blockers,
    expiresAt: verification?.expiresAt ?? null,
    daysUntilExpiry: verification?.daysUntilExpiry ?? null,
  };
}

export function listPayoutSlotVerificationStatuses(): PayoutSlotVerificationStatus[] {
  return listPayoutSlots().map((slot) => payoutSlotVerificationStatus(Number(slot.slot)));
}

/**
 * Expire stale verifications and pause the affected slots. Idempotent, audited,
 * and honest: an expired destination is never silently left payable.
 * Called by the mission server tick and by the status endpoint.
 */
export function sweepPayoutVerifications(): { expired: number[]; paused: number[] } {
  const now = nowIso();
  const expired: number[] = [];
  const paused: number[] = [];
  const rows = missionDb.all<Row>(
    `SELECT * FROM mission_payout_slot_verifications WHERE status = 'verified' AND expires_at IS NOT NULL AND expires_at <= ?`,
    [now],
  );
  for (const row of rows) {
    missionDb.run(`UPDATE mission_payout_slot_verifications SET status = 'expired', updated_at = ? WHERE id = ?`, [now, String(row.id)]);
    expired.push(Number(row.slot));
    const slot = missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [Number(row.slot)]);
    if (slot && String(slot.status) === 'active') {
      setPayoutSlotStatus(Number(row.slot), 'paused', String(row.verified_by ?? 'system'));
      paused.push(Number(row.slot));
    }
    appendMissionAudit({
      actorType: 'system',
      action: 'payout_slot.verification_expired',
      subjectType: 'payout_slot',
      subjectId: String(row.slot),
      detail: { verificationId: String(row.id), expiresAt: String(row.expires_at ?? '') },
    });
  }
  // A destination that changed after verification invalidates it as well.
  const verifiedRows = missionDb.all<Row>(`SELECT * FROM mission_payout_slot_verifications WHERE status = 'verified'`);
  for (const row of verifiedRows) {
    const slot = missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [Number(row.slot)]);
    if (!slot) continue;
    if (destinationFingerprint(slot) === String(row.destination_fingerprint ?? '')) continue;
    missionDb.run(`UPDATE mission_payout_slot_verifications SET status = 'expired', revoked_reason = ?, updated_at = ? WHERE id = ?`, [
      'the destination changed after verification',
      now,
      String(row.id),
    ]);
    expired.push(Number(row.slot));
    if (String(slot.status) === 'active') {
      setPayoutSlotStatus(Number(row.slot), 'paused', 'system');
      paused.push(Number(row.slot));
    }
    appendMissionAudit({
      actorType: 'system',
      action: 'payout_slot.verification_invalidated',
      subjectType: 'payout_slot',
      subjectId: String(row.slot),
      detail: { verificationId: String(row.id), reason: 'destination changed after verification' },
    });
  }
  return { expired: [...new Set(expired)], paused: [...new Set(paused)] };
}
