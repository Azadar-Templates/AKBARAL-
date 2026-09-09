import { Router } from 'express';
import { billingService } from '../billing/service';
import { getTrialStatus, recordBillingEvent, markInvoicePaid } from '../db';
import { verifyWebhookSignature } from '../security/webhooks';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';
import { getBody, optionalNumber } from '../server/middleware/validation';

export function createBillingRouter(): Router {
  const router = Router();

  router.get('/plans', (_req, res) => {
    res.status(200).json({ plans: billingService.listPlans() });
  });

  router.get('/account', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    res.status(200).json({
      subscription: billingService.subscription(userId),
      entitlements: billingService.entitlements(userId),
      trial: getTrialStatus(userId),
      invoices: billingService.invoices(userId),
      payments: billingService.payments(userId),
    });
  });

  router.post('/switch', requireAuth, (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const planKey = typeof body.plan_key === 'string' ? body.plan_key : '';
    if (!planKey) {
      throw new HttpError(400, 'plan_key is required', 'validation_error');
    }
    res.status(202).json(billingService.switchPlan(req.auth!.userId, planKey));
  });

  router.post('/credits', requireAuth, (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const credits = optionalNumber(body, 'credits') ?? 0;
    const amountCents = optionalNumber(body, 'amount_cents') ?? 0;
    const provider = typeof body.provider === 'string' ? body.provider : undefined;
    const order = billingService.purchaseCustomCredits({
      userId: req.auth!.userId,
      credits,
      amountCents,
      provider,
    });
    if (order.status === 'provider_not_configured') {
      res.status(402).json({ error: { code: 'provider_not_configured', message: 'payment provider requires a credential', requiredCredential: order.requiredCredential }, order });
      return;
    }
    res.status(201).json({ order });
  });

  router.post('/webhook', (req, res) => {
    const secret = process.env.BILLING_WEBHOOK_SECRET;
    if (!secret) {
      throw new HttpError(503, 'BILLING_WEBHOOK_SECRET is not configured', 'webhook_not_configured');
    }
    const body = getBody(req);
    const payload = JSON.stringify(body);
    const signature = req.header('x-akbaral-signature');
    if (!verifyWebhookSignature({ payload, signature, secret })) {
      throw new HttpError(401, 'invalid webhook signature', 'unauthorized');
    }
    const event = typeof body.event === 'string' ? body.event : 'unknown';
    recordBillingEvent({
      userId: typeof body.user_id === 'string' ? body.user_id : null,
      eventType: event,
      provider: typeof body.provider === 'string' ? body.provider : 'manual',
      payload: body,
    });
    if (event === 'invoice.paid' && typeof body.invoice_id === 'string') {
      markInvoicePaid(body.invoice_id, new Date().toISOString());
    }
    res.status(200).json({ received: true });
  });

  return router;
}
