/**
 * ZA141251SA — STRIPE DIRECT EARNING PROVIDER
 *
 * This is a REAL EarningProvider implementation, not scaffolding. It closes the
 * last gap in the earning loop: mission-money-worker previously passed an empty
 * earning-provider array, so no job could ever progress past 'queued'.
 *
 * WHAT THIS DOES AND — CRITICALLY — WHAT IT REFUSES TO DO
 * ------------------------------------------------------
 * It NEVER creates money. It never issues a charge, never synthesizes a payment
 * reference, and never reports revenue that a customer did not actually pay.
 *
 * The only thing it does is DETECT a genuine, already-settled customer payment
 * that belongs to a specific mission earning job, and return that payment's
 * Stripe balance-transaction id as the payment reference. The existing
 * MissionStripe MoneyProvider then INDEPENDENTLY re-verifies that reference
 * (livemode, paid, captured, not refunded/disputed, mission metadata, and the
 * account's real available balance) before a single cent is posted to the
 * mission ledger. Two independent checks, both against the live Stripe API.
 *
 * Consequently: if the customer has not paid, execute() throws. The job is
 * parked in 'unknown' and retried read-only via lookup(). "No payment yet" is a
 * normal, safe outcome — never an error to be worked around, and never a reason
 * to invent a receipt.
 *
 * WHY STRIPE IS THE FIRST REAL ROUTE
 * ----------------------------------
 * A Stripe account is free to create, requires no card and no upfront money,
 * and its official API exposes exactly the settlement evidence this mission
 * requires. Payouts to a bank account require identity/bank verification, which
 * is an unavoidable human action and is correctly reported as such — it does
 * NOT block earning, only withdrawal.
 *
 * MATCHING RULE
 * -------------
 * runEarning() requires opportunity.provider === earning.id === payments.id, so
 * this provider deliberately shares the 'stripe-mission' id with MissionStripe.
 */

import { MoneyError, type EarningProvider } from '../../money';
import { appendMissionAudit, nowIso, type Row } from '../../database';

/** Stripe charge fields this provider is willing to trust. */
interface MissionCharge {
  id: string;
  balanceTransaction: string;
  amountCents: number;
  currency: string;
  jobId: string;
  agentId: string;
}

const MISSION_TAG = 'ZA141251SA';

/**
 * Stripe's search index is eventually consistent (documented: up to ~1 minute).
 * That is a correctness hazard only in one direction — a real payment may not
 * be visible yet — which is safe, because "not found" simply defers the job.
 */
export class StripeDirectEarning implements EarningProvider {
  readonly id = 'stripe-mission';

  constructor(
    private key: string,
    private accountId: string,
    private transport: typeof fetch = fetch,
  ) {
    // Live-mode only, exactly like MissionStripe: test keys must never be able
    // to produce mission revenue.
    if (!/^sk_live_/.test(key) || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
      throw new MoneyError('mission_live_provider_not_configured' as any);
    }
  }

  private async request(path: string, signal?: AbortSignal): Promise<any> {
    const response = await this.transport(`https://api.stripe.com/v1/${path}`, {
      method: 'GET',
      redirect: 'error',
      signal: signal ?? AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${this.key}`, 'Stripe-Version': '2024-06-20' },
    });
    if (!response.ok || !response.body) throw new MoneyError('provider_response_unverified' as any);
    // Bounded read: a hostile or malfunctioning endpoint must not exhaust memory.
    const reader = response.body.getReader();
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 262144) {
          await reader.cancel();
          throw new MoneyError('provider_response_too_large' as any);
        }
        parts.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch {
      throw new MoneyError('invalid_provider_response' as any);
    }
  }

  /**
   * Find the single settled customer charge that belongs to this job.
   *
   * Every condition below is a refusal to guess. In particular the charge must
   * carry mission metadata naming THIS job and THIS agent, so a payment for one
   * job can never be credited to another, and an unrelated charge on the same
   * Stripe account can never be harvested as mission revenue.
   */
  private async findMissionCharge(job: Row, signal?: AbortSignal): Promise<MissionCharge> {
    const jobId = String(job.id);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(jobId)) throw new MoneyError('invalid_job_reference' as any);

    // Confirm the account itself is the mission account and genuinely live.
    const account = await this.request('account', signal);
    if (
      account.id !== this.accountId ||
      !account.charges_enabled ||
      !account.details_submitted
    ) {
      throw new MoneyError('mission_account_not_activated' as any);
    }

    const query = encodeURIComponent(
      `metadata['mission']:'${MISSION_TAG}' AND metadata['mission_job_id']:'${jobId}'`,
    );
    const found = await this.request(`charges/search?limit=2&query=${query}`, signal);
    const data: any[] = Array.isArray(found?.data) ? found.data : [];
    if (data.length === 0) throw new MoneyError('earning_payment_not_received' as any);
    // Two charges for one job is an ambiguity we must never resolve by picking
    // one; a human has to look at it.
    if (data.length > 1) throw new MoneyError('earning_payment_ambiguous' as any);

    const charge = data[0];
    if (
      !charge?.livemode ||
      charge.paid !== true ||
      charge.captured !== true ||
      charge.refunded === true ||
      charge.disputed === true ||
      Number(charge.amount_refunded) !== 0 ||
      charge.status !== 'succeeded' ||
      charge.metadata?.mission !== MISSION_TAG ||
      charge.metadata?.mission_job_id !== jobId ||
      !charge.metadata?.mission_agent_id ||
      charge.metadata.mission_agent_id !== String(job.agent_id) ||
      !/^ch_[A-Za-z0-9]+$/.test(String(charge.id)) ||
      !/^txn_[A-Za-z0-9]+$/.test(String(charge.balance_transaction)) ||
      !Number.isSafeInteger(charge.amount) ||
      Number(charge.amount) <= 0 ||
      typeof charge.currency !== 'string'
    ) {
      throw new MoneyError('mission_receipt_mismatch' as any);
    }

    return {
      id: String(charge.id),
      balanceTransaction: String(charge.balance_transaction),
      amountCents: Number(charge.amount),
      currency: String(charge.currency).toUpperCase(),
      jobId,
      agentId: String(charge.metadata.mission_agent_id),
    };
  }

  /**
   * Read-only reconciliation. Safe to call repeatedly — it performs no state
   * change at Stripe and is the path the worker uses for jobs already
   * delivered, so a network failure can never cause double delivery.
   */
  async lookup(job: Row, _opportunity: Row): Promise<{ paymentReference: string }> {
    const charge = await this.findMissionCharge(job);
    return { paymentReference: charge.balanceTransaction };
  }

  /**
   * Delivery + detection.
   *
   * authorizeExecute() is invoked immediately before the irreversible step, as
   * the interface requires, so a revoked grant, frozen account, disabled
   * autonomy or engaged kill switch stops the work even if it was authorized
   * when the job was picked up.
   */
  async execute(
    job: Row,
    opportunity: Row,
    signal: AbortSignal,
    authorizeExecute: () => void,
  ): Promise<{ paymentReference: string }> {
    // Re-check authorization at the last possible moment.
    authorizeExecute();

    const charge = await this.findMissionCharge(job, signal);

    // Record the detection as audited evidence. This is evidence of an external
    // payment we observed — not a ledger posting. Posting happens only after
    // MissionStripe independently verifies the same reference.
    appendMissionAudit({
      actorType: 'system',
      action: 'earning.external_payment_detected',
      subjectType: 'earning_job',
      subjectId: String(job.id),
      detail: {
        provider: this.id,
        chargeId: charge.id,
        paymentReference: charge.balanceTransaction,
        amountCents: charge.amountCents,
        currency: charge.currency,
        opportunityId: String(opportunity.id),
        detectedAt: nowIso(),
        note: 'detected only; ledger posting requires independent MoneyProvider verification',
      },
    });

    return { paymentReference: charge.balanceTransaction };
  }
}

/**
 * Honest construction: returns the provider only when dedicated mission Stripe
 * credentials are actually present. Absent credentials yield null, which the
 * registry reports as 'credential required' rather than pretending readiness.
 */
export function configuredStripeDirectEarning(
  env: Readonly<Record<string, string | undefined>> = process.env,
): StripeDirectEarning | null {
  const key = env.ZA141251SA_STRIPE_SECRET_KEY ?? '';
  const accountId = env.ZA141251SA_STRIPE_ACCOUNT_ID ?? '';
  if (!/^sk_live_/.test(key) || !/^acct_[A-Za-z0-9]+$/.test(accountId)) return null;
  try {
    return new StripeDirectEarning(key, accountId);
  } catch {
    return null;
  }
}

/** Exposed for readiness reporting; never returns secret material. */
export function stripeDirectEarningReadiness(env: Readonly<Record<string, string | undefined>> = process.env): {
  providerId: string;
  configured: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  if (!/^sk_live_/.test(env.ZA141251SA_STRIPE_SECRET_KEY ?? '')) {
    blockers.push('ZA141251SA_STRIPE_SECRET_KEY missing or not a live secret key');
  }
  if (!/^acct_[A-Za-z0-9]+$/.test(env.ZA141251SA_STRIPE_ACCOUNT_ID ?? '')) {
    blockers.push('ZA141251SA_STRIPE_ACCOUNT_ID missing or malformed');
  }
  return { providerId: 'stripe-mission', configured: blockers.length === 0, blockers };
}
