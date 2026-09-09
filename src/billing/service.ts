import { db } from '../db';
import {
  cancelActiveSubscriptions,
  claimBillingEvent,
  findInvoiceById,
  markInvoiceRefunded,
  markPaymentsRefundedForInvoice,
  markPaymentFailed,
  reverseCustomCredits,
  createInvoice,
  createPayment,
  ensureBootstrapPlans,
  getActiveSubscription,
  getPlanByKey,
  grantCustomCredits,
  listPlans,
  recordBillingEvent,
  createSubscription,
  ensureEntitlement,
  getEntitlements,
  markInvoicePaid,
  listInvoicesForUser,
  listPaymentsForUser,
} from '../db';
import { HttpError } from '../server/http';
import { env as appEnv } from '../config/env';
import {
  createRazorpayOrder,
  createStripeCheckout,
  razorpayConfigured,
  stripeConfigured,
} from './providers';

export interface PurchaseOrder {
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  credits: number;
  provider: string;
  status: 'pending' | 'requires_external_payment' | 'provider_not_configured';
  requiredCredential?: string;
  requiredCredentials?: string[];
  providerReference?: string | null;
  checkoutUrl?: string | null;
}

export class BillingService {
  listPlans() {
    ensureBootstrapPlans();
    return listPlans();
  }

  subscription(userId: string) {
    return getActiveSubscription(userId);
  }

  entitlements(userId: string) {
    return getEntitlements(userId);
  }

  invoices(userId: string) {
    return listInvoicesForUser(userId);
  }

  payments(userId: string) {
    return listPaymentsForUser(userId);
  }

  switchPlan(userId: string, planKey: string): { subscriptionId: string; planKey: string; status: string } {
    ensureBootstrapPlans();
    const plan = getPlanByKey(planKey);
    if (!plan) {
      throw new HttpError(404, `plan ${planKey} not found`, 'not_found');
    }
    // Keep exactly one live subscription per account. Cancelling the previous
    // live row prevents silent double-billing and keeps entitlements auditable.
    cancelActiveSubscriptions(userId);
    const status = planKey === 'free' ? 'trialing' : 'active';
    const subscription = createSubscription({ userId, planKey, status });
    return { subscriptionId: subscription.id, planKey, status };
  }

  async purchaseCustomCredits(input: {
    userId: string;
    credits: number;
    amountCents: number;
    provider?: string;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<PurchaseOrder> {
    if (!Number.isInteger(input.credits) || input.credits <= 0) {
      throw new HttpError(400, 'credits must be a positive integer', 'validation_error');
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new HttpError(400, 'amount_cents must be a positive integer', 'validation_error');
    }
    const provider = input.provider ?? 'manual';
    const credentialKeys = paymentCredentialKeys(provider);
    if (provider !== 'manual' && credentialKeys.some((key) => !process.env[key])) {
      return {
        invoiceId: '',
        invoiceNumber: '',
        amountCents: input.amountCents,
        currency: 'PKR',
        credits: input.credits,
        provider,
        status: 'provider_not_configured',
        requiredCredential: credentialKeys.join(', '),
        requiredCredentials: credentialKeys,
      };
    }

    const invoice = createInvoice({
      userId: input.userId,
      amountCents: input.amountCents,
      provider,
      lineItems: [{ description: `${input.credits} AKBARAL credits`, amountCents: input.amountCents }],
      status: provider === 'manual' ? 'due' : 'pending',
    });

    // Real provider checkout when credentials are configured. Failures are
    // honest (PaymentProviderError) — no fabricated checkout URLs.
    let providerReference: string | null = null;
    let checkoutUrl: string | null = null;
    if (provider === 'stripe' && stripeConfigured()) {
      const session = await createStripeCheckout({
        amountCents: input.amountCents,
        credits: input.credits,
        invoiceNumber: invoice.number,
        successUrl: input.successUrl ?? 'https://akbaral.local/billing/success',
        cancelUrl: input.cancelUrl ?? 'https://akbaral.local/billing/cancel',
      });
      providerReference = session.providerReference;
      checkoutUrl = session.checkoutUrl;
    } else if (provider === 'razorpay' && razorpayConfigured()) {
      const order = await createRazorpayOrder({
        amountCents: input.amountCents,
        invoiceNumber: invoice.number,
      });
      providerReference = order.providerReference;
      checkoutUrl = order.checkoutUrl;
    }

    createPayment({
      userId: input.userId,
      invoiceId: invoice.id,
      provider,
      amountCents: input.amountCents,
      status: 'pending',
      providerPaymentId: providerReference,
    });
    recordBillingEvent({
      userId: input.userId,
      eventType: 'credit_purchase.requested',
      provider,
      payload: { invoiceId: invoice.id, credits: input.credits, amountCents: input.amountCents, providerReference },
    });
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amountCents: input.amountCents,
      currency: 'PKR',
      credits: input.credits,
      provider,
      status: provider === 'manual' ? 'pending' : 'requires_external_payment',
      providerReference,
      checkoutUrl,
    };
  }

  /**
   * Settle an invoice paid through a provider webhook (Milestone 8).
   * Idempotent: a paid invoice is never re-settled, so credits cannot be
   * granted twice for the same invoice.
   */
  settleInvoicePayment(invoiceId: string): { settled: boolean; credits: number; effect: 'settled' | 'already_paid' | 'already_refunded' | 'not_payable' } {
    const invoice = db.get<{ id: string; user_id: string; status: string; line_items: string; total_cents: number }>(
      'SELECT id, user_id, status, line_items, total_cents FROM invoices WHERE id = ?',
      [invoiceId],
    );
    if (!invoice) {
      throw new HttpError(404, 'invoice not found', 'not_found');
    }
    if (invoice.status === 'paid') {
      return { settled: false, credits: 0, effect: 'already_paid' };
    }
    // A refunded invoice had its credits reversed; re-settling it would
    // re-grant them (double grant after refund). Cancelled/void invoices are
    // equally not payable. Only due/open invoices can transition to paid.
    if (invoice.status === 'refunded') {
      return { settled: false, credits: 0, effect: 'already_refunded' };
    }
    if (invoice.status !== 'due' && invoice.status !== 'open') {
      return { settled: false, credits: 0, effect: 'not_payable' };
    }
    markInvoicePaid(invoiceId, new Date().toISOString());
    db.run(`UPDATE payments SET status = 'succeeded', processed_at = ? WHERE invoice_id = ? AND status = 'pending'`, [
      new Date().toISOString(),
      invoiceId,
    ]);
    // The purchased credit amount lives in the line-item description.
    let credits = 0;
    try {
      const items = JSON.parse(String(invoice.line_items ?? '[]')) as Array<{ description?: string }>;
      const match = /(\d+) AKBARAL credits/.exec(String(items[0]?.description ?? ''));
      if (match) {
        credits = Number(match[1]);
      }
    } catch {
      credits = 0;
    }
    if (credits > 0) {
      grantCustomCredits({
        userId: String(invoice.user_id),
        amount: credits,
        reason: 'credit purchase settled via provider webhook',
        reference: invoiceId,
      });
      ensureEntitlement(String(invoice.user_id), 'custom_credits', 'true');
    }
    recordBillingEvent({
      userId: String(invoice.user_id),
      eventType: 'credit_purchase.settled',
      payload: { invoiceId, credits, amountCents: invoice.total_cents },
    });
    return { settled: true, credits, effect: 'settled' as const };
  }

  /**
   * Real usage statement (Milestone 8): aggregates the user's actual activity
   * for a period from tasks, credit transactions and model runs. No estimated
   * or fabricated numbers.
   */
  usageStatement(userId: string, from: string, to: string): Record<string, unknown> {
    const clamp = (value: string): string => value;
    const tasks = db.get<{ total: number; completed: number; failed: number; cancelled: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
       FROM tasks WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
      [userId, clamp(from), clamp(to)],
    );
    const credits = db.get<{ consumed: number; granted: number; refunded: number }>(
      `SELECT
         SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS consumed,
         SUM(CASE WHEN amount > 0 AND reason LIKE '%refund%' THEN amount ELSE 0 END) AS refunded,
         SUM(CASE WHEN amount > 0 AND reason NOT LIKE '%refund%' THEN amount ELSE 0 END) AS granted
       FROM credit_transactions WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
      [userId, from, to],
    );
    const runs = db.get<{ total: number; succeeded: number; failed: number; costCents: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN mr.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN mr.status = 'failed' THEN 1 ELSE 0 END) AS failed,
              COALESCE(SUM(mr.cost_cents), 0) AS costCents
       FROM model_runs mr
       JOIN tasks t ON t.id = mr.task_id
       WHERE t.user_id = ? AND mr.created_at >= ? AND mr.created_at <= ?`,
      [userId, from, to],
    );
    const invoices = db.get<{ total: number; paidCents: number }>(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents ELSE 0 END), 0) AS paidCents
       FROM invoices WHERE user_id = ? AND created_at >= ? AND created_at <= ?`,
      [userId, from, to],
    );
    return {
      period: { from, to },
      tasks: {
        total: tasks?.total ?? 0,
        completed: tasks?.completed ?? 0,
        failed: tasks?.failed ?? 0,
        cancelled: tasks?.cancelled ?? 0,
      },
      credits: {
        consumed: credits?.consumed ?? 0,
        refunded: credits?.refunded ?? 0,
        granted: credits?.granted ?? 0,
      },
      modelRuns: {
        total: runs?.total ?? 0,
        succeeded: runs?.succeeded ?? 0,
        failed: runs?.failed ?? 0,
        costCents: runs?.costCents ?? 0,
      },
      billing: {
        invoices: invoices?.total ?? 0,
        paidCents: invoices?.paidCents ?? 0,
      },
    };
  }

  /**
   * Central verified-webhook dispatcher (Milestone 8).
   *
   * Duplicate protection: when the payload carries a provider event id, the
   * first delivery claims it atomically and every replay is reported as a
   * duplicate BEFORE any side effect. Invoice-level settlement is
   * independently idempotent, so unsigned-id payloads cannot double-grant
   * either.
   */
  handleWebhookEvent(input: {
    provider: string;
    event: string;
    eventId?: string | null;
    userId?: string | null;
    invoiceId?: string | null;
    failureCode?: string | null;
    failureReason?: string | null;
    payload?: Record<string, unknown>;
  }): { received: true; duplicate: boolean; effect: string } {
    let duplicate = false;
    if (input.eventId) {
      duplicate = !claimBillingEvent(input.provider, input.eventId, input.event);
      if (duplicate) {
        return { received: true, duplicate: true, effect: 'ignored_duplicate' };
      }
    }

    recordBillingEvent({
      userId: input.userId ?? null,
      eventType: input.event,
      provider: input.provider,
      payload: input.payload ?? {},
    });

    if (input.event === 'invoice.paid' && input.invoiceId) {
      const invoice = findInvoiceById(input.invoiceId);
      if (!invoice) {
        return { received: true, duplicate: false, effect: 'invoice_not_found' };
      }
      const settled = this.settleInvoicePayment(input.invoiceId);
      return { received: true, duplicate: false, effect: settled.effect };
    }

    if (input.event === 'payment.failed') {
      let handled = false;
      if (input.invoiceId) {
        handled = markPaymentFailed({ invoiceId: input.invoiceId, failureCode: input.failureCode ?? null, failureReason: input.failureReason ?? null });
      }
      return { received: true, duplicate: false, effect: handled ? 'payment_marked_failed' : 'no_pending_payment' };
    }

    if ((input.event === 'invoice.refunded' || input.event === 'payment.refunded') && input.invoiceId) {
      const invoice = findInvoiceById(input.invoiceId) as { status?: string; user_id?: string; line_items?: string; total_cents?: number } | undefined;
      if (!invoice) {
        return { received: true, duplicate: false, effect: 'invoice_not_found' };
      }
      // Only a PAID invoice can be refunded; failed/due invoices never granted
      // credits, so replays and premature refunds are honest no-ops.
      const flipped = markInvoiceRefunded(input.invoiceId);
      if (!flipped) {
        return { received: true, duplicate: false, effect: invoice.status === 'refunded' ? 'already_refunded' : 'not_paid' };
      }
      markPaymentsRefundedForInvoice(input.invoiceId);
      let credits = 0;
      try {
        const items = JSON.parse(String(invoice.line_items ?? '[]')) as Array<{ description?: string }>;
        const match = /(\d+) AKBARAL credits/.exec(String(items[0]?.description ?? ''));
        if (match) {
          credits = Number(match[1]);
        }
      } catch {
        credits = 0;
      }
      if (credits > 0) {
        reverseCustomCredits({
          userId: String(invoice.user_id),
          amount: credits,
          reason: 'credit purchase refunded',
          reference: input.invoiceId,
        });
      }
      recordBillingEvent({
        userId: String(invoice.user_id),
        eventType: 'invoice.refunded.processed',
        provider: input.provider,
        payload: { invoiceId: input.invoiceId, creditsReversed: credits },
      });
      return { received: true, duplicate: false, effect: 'refunded' };
    }

    if (input.event === 'subscription.cancelled' && input.userId) {
      cancelActiveSubscriptions(input.userId);
      return { received: true, duplicate: false, effect: 'subscription_cancelled' };
    }

    return { received: true, duplicate: false, effect: 'recorded' };
  }

  /**
   * Admin billing overview (Milestone 8): revenue, provider costs, gross
   * margin, credit flows, subscription state, trial conversion and
   * marketplace commission — every number is aggregated from real records.
   */
  adminBillingOverview(): Record<string, unknown> {
    const revenue = db.get<{ paidCents: number; paidCount: number }>(
      `SELECT COALESCE(SUM(total_cents), 0) AS paidCents, COUNT(*) AS paidCount FROM invoices WHERE status = 'paid'`,
    );
    const refunded = db.get<{ refundedCents: number; refundedCount: number }>(
      `SELECT COALESCE(SUM(total_cents), 0) AS refundedCents, COUNT(*) AS refundedCount FROM invoices WHERE status = 'refunded'`,
    );
    const outstanding = db.get<{ cents: number; count: number }>(
      `SELECT COALESCE(SUM(total_cents), 0) AS cents, COUNT(*) AS count FROM invoices WHERE status IN ('due', 'pending')`,
    );
    const failedPayments = db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM payments WHERE status = 'failed'`);
    const providerCosts = db.get<{ cents: number }>(
      `SELECT COALESCE(SUM(cost_cents), 0) AS cents FROM model_runs WHERE status = 'succeeded'`,
    );
    const creditFlows = db.get<{ consumed: number; granted: number; refundedAmount: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN amount < 0 AND type != 'reversal' THEN -amount ELSE 0 END), 0) AS consumed,
         COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS granted,
         COALESCE(SUM(CASE WHEN amount < 0 AND type = 'reversal' THEN -amount ELSE 0 END), 0) AS refundedAmount
       FROM credit_transactions`,
    );
    const subscriptionsByPlan = db.all(
      `SELECT p.key AS plan_key, s.status, COUNT(*) AS count
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.status IN ('trialing', 'active')
       GROUP BY p.key, s.status`,
    );
    const activeSubs = db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'active'`);
    const trialUsers = db.get<{ count: number }>(
      `SELECT COUNT(DISTINCT user_id) AS count FROM subscriptions WHERE status = 'trialing'`,
    );
    const convertedUsers = db.get<{ count: number }>(
      `SELECT COUNT(DISTINCT s.user_id) AS count
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'active' AND p.key != 'free'`,
    );
    const paidInvoiceUsers = db.get<{ count: number }>(
      `SELECT COUNT(DISTINCT user_id) AS count FROM invoices WHERE status = 'paid' AND total_cents > 0`,
    );
    const monthlyRevenue = db.all(
      `SELECT substr(paid_at, 1, 7) AS month, COALESCE(SUM(total_cents), 0) AS cents
       FROM invoices WHERE status = 'paid' AND paid_at IS NOT NULL
       GROUP BY month ORDER BY month DESC LIMIT 12`,
    );
    const marketplace = db.get<{ orderCount: number; volumeCents: number }>(
      `SELECT COUNT(*) AS orderCount, COALESCE(SUM(amount_cents), 0) AS volumeCents FROM agent_orders`,
    );
    const commissionBps = envMarketplaceCommissionBps();
    const commissionCents = Math.floor(((marketplace?.volumeCents ?? 0) * commissionBps) / 10_000);

    return {
      revenue: {
        paidCents: revenue?.paidCents ?? 0,
        paidInvoices: revenue?.paidCount ?? 0,
        refundedCents: refunded?.refundedCents ?? 0,
        refundedInvoices: refunded?.refundedCount ?? 0,
        outstandingCents: outstanding?.cents ?? 0,
        outstandingInvoices: outstanding?.count ?? 0,
        monthly: monthlyRevenue,
      },
      costs: {
        providerModelCents: providerCosts?.cents ?? 0,
      },
      margin: {
        grossMarginCents: (revenue?.paidCents ?? 0) - (providerCosts?.cents ?? 0),
        grossMarginPercent:
          revenue && revenue.paidCents > 0
            ? Math.round((((revenue.paidCents - (providerCosts?.cents ?? 0)) / revenue.paidCents) * 100) * 10) / 10
            : null,
      },
      credits: {
        consumed: creditFlows?.consumed ?? 0,
        granted: creditFlows?.granted ?? 0,
        reversed: creditFlows?.refundedAmount ?? 0,
      },
      subscriptions: {
        active: activeSubs?.count ?? 0,
        byPlan: subscriptionsByPlan,
      },
      conversion: {
        trialUsers: trialUsers?.count ?? 0,
        convertedUsers: Math.max(convertedUsers?.count ?? 0, paidInvoiceUsers?.count ?? 0),
        conversionRate:
          trialUsers && trialUsers.count > 0
            ? Math.round(((Math.max(convertedUsers?.count ?? 0, paidInvoiceUsers?.count ?? 0) / trialUsers.count) * 100) * 10) / 10
            : null,
      },
      payments: {
        failed: failedPayments?.count ?? 0,
      },
      marketplace: {
        orders: marketplace?.orderCount ?? 0,
        volumeCents: marketplace?.volumeCents ?? 0,
        commissionBps,
        commissionCents,
      },
    };
  }

  /**
   * Admin-verified manual payment settlement. Grants custom credits, marks the
   * invoice paid and updates entitlements. Real payment providers would call a
   * verified webhook instead.
   */
  settleManualPayment(input: {
    userId: string;
    invoiceId: string;
    amountCents: number;
    credits: number;
    reference?: string;
  }): { invoiceId: string; credits: number } {
    const invoice = listInvoicesForUser(input.userId).find((row) => String(row.id) === input.invoiceId);
    if (!invoice) {
      throw new HttpError(403, 'invoice does not belong to the specified user', 'forbidden');
    }
    if (String(invoice.status) === 'paid') {
      throw new HttpError(409, 'invoice is already paid', 'conflict');
    }
    // Refunded invoices had their credits reversed and must never be
    // re-settled; cancelled/void invoices are not payable either.
    if (String(invoice.status) === 'refunded') {
      throw new HttpError(409, 'invoice has been refunded; credits were reversed and cannot be settled again', 'conflict');
    }
    if (String(invoice.status) !== 'due' && String(invoice.status) !== 'open') {
      throw new HttpError(409, `invoice is not settleable (status: ${String(invoice.status)})`, 'conflict');
    }
    if (Number(invoice.total_cents) !== input.amountCents) {
      throw new HttpError(400, 'settlement amount does not match the invoice total', 'validation_error');
    }
    markInvoicePaid(input.invoiceId, new Date().toISOString());
    const grant = grantCustomCredits({
      userId: input.userId,
      amount: input.credits,
      reason: 'custom credit purchase settled',
      reference: input.reference ?? input.invoiceId,
    });
    ensureEntitlement(input.userId, 'custom_credits', 'true');
    recordBillingEvent({
      userId: input.userId,
      eventType: 'credit_purchase.settled',
      payload: { invoiceId: input.invoiceId, credits: input.credits, amountCents: input.amountCents },
    });
    return { invoiceId: input.invoiceId, credits: grant.id ? input.credits : input.credits };
  }
}

export const billingService = new BillingService();

function paymentCredentialKeys(provider: string): string[] {
  if (provider.toLowerCase() === 'razorpay') {
    return ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];
  }
  return [`${provider.toUpperCase()}_SECRET_KEY`];
}

function envMarketplaceCommissionBps(): number {
  return appEnv.marketplaceCommissionBps;
}
