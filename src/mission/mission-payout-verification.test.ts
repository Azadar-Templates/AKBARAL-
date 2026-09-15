import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Payout destination verification (ZA141251SA mission).
 *
 * The verification flow decides whether mission money may leave the treasury, so
 * these tests pin the invariants that make it trustworthy:
 *
 *   · a slot becomes payable only after every REQUIRED control check is
 *     confirmed and the owner signs the attestation;
 *   · a partial submission is refused, naming the missing checks;
 *   · the attestation must be real text, not a placeholder;
 *   · card numbers / IBANs / credential material are refused as destinations —
 *     the mission never stores instrument credentials;
 *   · verification EXPIRES (and a changed destination invalidates it), which
 *     pauses the slot so payouts stop instead of running on a stale assumption;
 *   · revocation pauses the slot immediately;
 *   · every step is audited, the audit chain verifies, and agents cannot
 *     complete a verification (owner-only, enforced in the library).
 */

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-verify-'));
const dbPath = path.join(tempRoot, 'verify.db');
const OWNER = 'own_verification_test';

describe('mission payout destination verification', () => {
  const saved = new Map<string, string | undefined>();
  let mission: typeof import('./database');
  let treasury: typeof import('./treasury');
  let verification: typeof import('./payout-verification');

  before(async () => {
    for (const key of ['ZA141251SA_DATABASE_URL', 'ZA141251SA_CREDENTIAL_KEY', 'ZA141251SA_SESSION_SECRET', 'ZA141251SA_PAYOUT_VERIFICATION_DAYS']) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.ZA141251SA_DATABASE_URL = `file:${dbPath}`;
    process.env.ZA141251SA_CREDENTIAL_KEY = 'mission-verification-test-key-32-characters';
    process.env.ZA141251SA_SESSION_SECRET = 'mission-verification-test-session-secret';
    mission = await import('./database');
    treasury = await import('./treasury');
    verification = await import('./payout-verification');
    mission.applyMissionMigrations();
    treasury.ensurePayoutSlots();
  });

  after(async () => {
    mission.missionDb.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    // Each test starts from a configured-but-unverified slot 1.
    treasury.configurePayoutSlot({
      slot: 1,
      label: 'Primary operations account',
      destinationType: 'bank',
      holderName: 'Mission Holder',
      maskedAccount: '**** **** 4821',
      currency: 'USD',
      minPayoutCents: 5_000,
      approvalRequired: true,
      actorId: OWNER,
    });
  });

  function confirmAll(slot = 1, extra: Record<string, unknown> = {}) {
    const status = verification.payoutSlotVerificationStatus(slot);
    const checks = Object.fromEntries(status.requiredChecks.map((check) => [check.key, true]));
    return verification.confirmPayoutVerification({
      slot,
      ownerId: OWNER,
      checks,
      attestation: 'I control this account, the masked details match my records, and the provider has verified my identity.',
      ...extra,
    });
  }

  it('refuses unsafe destination descriptions (card numbers, IBANs, credential material)', () => {
    // A Luhn-valid test card number is refused rather than masked and stored.
    assert.throws(
      () => treasury.configurePayoutSlot({ slot: 2, label: 'bad', maskedAccount: '4111 1111 1111 1111', actorId: OWNER }),
      (error: unknown) => (error as { code?: string }).code === 'unsafe_destination',
      'a full card number must never be stored as a payout destination',
    );
    // A real IBAN (valid mod-97 checksum) is refused too.
    assert.throws(
      () => treasury.configurePayoutSlot({ slot: 2, label: 'bad', maskedAccount: 'GB82WEST12345698765432', actorId: OWNER }),
      (error: unknown) => (error as { code?: string }).code === 'unsafe_destination',
    );
    assert.throws(
      () => treasury.configurePayoutSlot({ slot: 2, label: 'bad', maskedAccount: 'api_key=live_abcdef123456', actorId: OWNER }),
      (error: unknown) => (error as { code?: string }).code === 'unsafe_destination',
    );
    // A provider reference and a masked description are both fine.
    const ok = treasury.configurePayoutSlot({
      slot: 2,
      label: 'Provider payout account',
      destinationType: 'payment_provider',
      providerRef: 'acct_1QfixtureConnect',
      maskedAccount: '****4321',
      actorId: OWNER,
    });
    assert.equal(String(ok.status), 'pending_verification');
    assert.equal(verification.looksLikeInstrumentCredential('acct_1QfixtureConnect').unsafe, false);
    assert.equal(verification.looksLikeInstrumentCredential('****4821').unsafe, false);
  });

  it('requires every control check and a real attestation before a slot is payable', () => {
    const started = verification.startPayoutVerification({ slot: 1, ownerId: OWNER });
    assert.equal(started.status, 'pending');
    assert.ok(started.requiredChecks.includes('destination_controlled'));
    assert.ok(started.requiredChecks.includes('provider_identity_verified'));
    assert.equal(verification.payoutSlotVerificationStatus(1).payable, false, 'a started verification is not a verified destination');

    // Partial checks are refused, and the error names exactly what is missing.
    const status = verification.payoutSlotVerificationStatus(1);
    const partial = Object.fromEntries(status.requiredChecks.slice(0, 1).map((check) => [check.key, true]));
    assert.throws(
      () =>
        verification.confirmPayoutVerification({
          slot: 1,
          ownerId: OWNER,
          checks: partial,
          attestation: 'I control this destination and confirm the provider verified my identity there.',
        }),
      (error: unknown) => {
        const typed = error as { code?: string; message?: string };
        assert.equal(typed.code, 'verification_incomplete');
        assert.match(String(typed.message), /destination_controlled|details_match/);
        return true;
      },
    );

    // A placeholder attestation is not an attestation.
    assert.throws(
      () => confirmAll(1, { attestation: 'ok' }),
      (error: unknown) => (error as { code?: string }).code === 'validation_error',
    );

    // An agent can never complete a verification.
    const agentChecks = Object.fromEntries(status.requiredChecks.map((check) => [check.key, true]));
    assert.throws(
      () =>
        verification.confirmPayoutVerification({
          slot: 1,
          ownerId: 'agent-1',
          actorType: 'agent',
          checks: agentChecks,
          attestation: 'An agent is trying to verify a payout destination on the owner’s behalf.',
        }),
      (error: unknown) => (error as { code?: string }).code === 'forbidden',
      'an agent can never complete a payout destination verification',
    );
  });

  it('activates the slot only at confirmation and records the evidence', () => {
    verification.startPayoutVerification({ slot: 1, ownerId: OWNER, method: 'owner_attestation' });
    const result = confirmAll(1, { evidenceRef: 'provider statement 2026-09-15' });
    assert.equal(result.verification.status, 'verified');
    assert.equal(result.slot.status, 'active');
    assert.ok(result.verification.attestation && result.verification.attestation.length > 40);
    assert.ok(result.verification.expiresAt, 'a verified destination carries an expiry');
    assert.equal(result.verification.stale, false);

    const status = verification.payoutSlotVerificationStatus(1);
    assert.equal(status.payable, true, 'a fully verified slot is payable');
    assert.deepEqual(status.blockers, []);
    assert.ok(status.requiredChecks.every((check) => check.confirmed));

    // Every money-adjacent decision is in the audit chain.
    const actions = mission.missionDb
      .all<{ action: string }>(`SELECT action FROM mission_audit WHERE action LIKE 'payout_slot.%'`)
      .map((row) => row.action);
    assert.ok(actions.includes('payout_slot.verification_started'));
    assert.ok(actions.includes('payout_slot.verification_confirmed'));
    assert.ok(actions.includes('payout_slot.verified'));
    assert.ok(mission.verifyMissionAudit().ok);
  });

  it('expires a verification and pauses the slot so payouts stop', () => {
    confirmAll(1);
    assert.equal(String(treasury.listPayoutSlots().find((slot) => Number(slot.slot) === 1)?.status), 'active');

    // Age the verification past its expiry, then sweep.
    const record = mission.missionDb.get<{ id: string }>(`SELECT id FROM mission_payout_slot_verifications WHERE slot = 1 ORDER BY created_at DESC LIMIT 1`)!;
    mission.missionDb.run('UPDATE mission_payout_slot_verifications SET expires_at = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), record.id]);
    const swept = verification.sweepPayoutVerifications();
    assert.deepEqual(swept.expired, [1]);
    assert.deepEqual(swept.paused, [1]);

    const status = verification.payoutSlotVerificationStatus(1);
    assert.equal(status.payable, false);
    assert.equal(status.slotStatus, 'paused');
    assert.ok(status.blockers.some((blocker) => /expired/.test(blocker)));
    assert.equal(status.verification?.status, 'expired');

    // The honest consequence: a payout request against the slot is refused.
    assert.throws(
      () => treasury.requestPayout({ slot: 1, amountCents: 10_000, idempotencyKey: `expired-${Date.now()}`, requestedBy: OWNER }),
      (error: unknown) => (error as { code?: string }).code === 'slot_not_active',
    );
    assert.ok(mission.verifyMissionAudit().ok);

    // Second sweep is idempotent.
    const again = verification.sweepPayoutVerifications();
    assert.deepEqual(again.expired, []);
  });

  it('invalidates a verification when the destination changes under it', () => {
    confirmAll(1);
    // Repointing the destination is a change of payee: verification no longer applies.
    treasury.configurePayoutSlot({ slot: 1, maskedAccount: '**** 9999', actorId: OWNER });
    const swept = verification.sweepPayoutVerifications();
    assert.deepEqual(swept.expired, [1]);
    const status = verification.payoutSlotVerificationStatus(1);
    assert.equal(status.payable, false, 'a repointed destination is never payable');
    // Reconfiguring already moved the slot back to pending_verification; the
    // point is that it is NOT payable on the strength of the old verification.
    assert.ok(['paused', 'pending_verification'].includes(status.slotStatus), `unexpected slot status ${status.slotStatus}`);
    assert.equal(status.verification?.status, 'expired');
    assert.throws(
      () => treasury.requestPayout({ slot: 1, amountCents: 10_000, idempotencyKey: `repointed-${Date.now()}`, requestedBy: OWNER }),
      (error: unknown) => (error as { code?: string }).code === 'slot_not_active',
    );
    assert.ok(mission.verifyMissionAudit().ok);
  });

  it('revokes a verification and pauses the slot immediately', () => {
    confirmAll(1);
    const revoked = verification.revokePayoutVerification({ slot: 1, ownerId: OWNER, reason: 'provider account closed' });
    assert.equal(revoked.status, 'revoked');
    assert.equal(revoked.revokedReason, 'provider account closed');
    const status = verification.payoutSlotVerificationStatus(1);
    assert.equal(status.payable, false);
    assert.equal(status.slotStatus, 'paused');
    assert.throws(
      () => verification.revokePayoutVerification({ slot: 1, ownerId: OWNER, reason: 'again please' }),
      (error: unknown) => (error as { status?: number; statusCode?: number }).status === 404 || (error as { statusCode?: number }).statusCode === 404,
      'a verification can only be revoked once',
    );
    assert.ok(mission.verifyMissionAudit().ok);
  });

  it('requires a destination before verification can start, and reports all four slots', () => {
    assert.throws(
      () => verification.startPayoutVerification({ slot: 4, ownerId: OWNER }),
      (error: unknown) => (error as { code?: string }).code === 'conflict',
      'an unconfigured slot cannot be verified',
    );
    const statuses = verification.listPayoutSlotVerificationStatuses();
    assert.equal(statuses.length, 4);
    for (const status of statuses) {
      assert.equal(typeof status.payable, 'boolean');
      assert.ok(Array.isArray(status.blockers));
      if (!status.payable) assert.ok(status.blockers.length > 0, 'a non-payable slot states why');
    }
    assert.equal(statuses.find((status) => status.slot === 4)?.destinationConfigured, false);
  });
});
