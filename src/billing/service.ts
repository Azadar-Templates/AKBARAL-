import {
  cancelActiveSubscriptions,
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

  purchaseCustomCredits(input: {
    userId: string;
    credits: number;
    amountCents: number;
    provider?: string;
  }): PurchaseOrder {
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
    createPayment({
      userId: input.userId,
      invoiceId: invoice.id,
      provider,
      amountCents: input.amountCents,
      status: provider === 'manual' ? 'pending' : 'pending',
    });
    recordBillingEvent({
      userId: input.userId,
      eventType: 'credit_purchase.requested',
      provider,
      payload: { invoiceId: invoice.id, credits: input.credits, amountCents: input.amountCents },
    });
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      amountCents: input.amountCents,
      currency: 'PKR',
      credits: input.credits,
      provider,
      status: provider === 'manual' ? 'pending' : 'requires_external_payment',
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
