import { Router } from 'express';
import { billingService } from '../billing/service';
import { getTrialStatus } from '../db';
import { verifyWebhookSignature, verifyRazorpaySignature } from '../security/webhooks';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError, asyncRoute } from '../server/http';
import { getBody, optionalNumber, optionalString } from '../server/middleware/validation';
import { renderInvoicePdf } from '../billing/invoice-pdf';

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

  router.post(
    '/credits',
    requireAuth,
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const credits = optionalNumber(body, 'credits') ?? 0;
      const amountCents = optionalNumber(body, 'amount_cents') ?? 0;
      const provider = typeof body.provider === 'string' ? body.provider : undefined;
      const order = await billingService.purchaseCustomCredits({
        userId: req.auth!.userId,
        credits,
        amountCents,
        provider,
        successUrl: optionalString(body, 'success_url') ?? undefined,
        cancelUrl: optionalString(body, 'cancel_url') ?? undefined,
      });
      if (order.status === 'provider_not_configured') {
        res.status(402).json({ error: { code: 'provider_not_configured', message: 'payment provider requires a credential', requiredCredential: order.requiredCredential }, order });
        return;
      }
      res.status(201).json({ order });
    }),
  );

  // Usage statement: real aggregates for a period (default: last 30 days).
  router.get('/usage', requireAuth, (req: AuthenticatedRequest, res) => {
    const to = typeof req.query.to === 'string' ? req.query.to : new Date().toISOString();
    const from =
      typeof req.query.from === 'string'
        ? req.query.from
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    res.status(200).json(billingService.usageStatement(req.auth!.userId, from, to));
  });

  // Invoice PDF: a real, standards-compliant PDF document with the invoice's
  // actual data. Only the invoice owner may download it.
  router.get('/invoices/:id/pdf', requireAuth, (req: AuthenticatedRequest, res) => {
    const invoice = billingService
      .invoices(req.auth!.userId)
      .find((row) => String(row.id) === req.params.id) as
      | Parameters<typeof renderInvoicePdf>[0]
      | undefined;
    if (!invoice) {
      throw new HttpError(404, 'invoice not found', 'not_found');
    }
    const pdf = renderInvoicePdf(invoice);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="invoice-${String(invoice.number)}.pdf"`);
    res.status(200).send(Buffer.from(pdf, 'binary'));
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
    // Provider-specific verification: a webhook claiming to be Razorpay must
    // ALSO carry a valid x-razorpay-signature (payment/webhook forgery guard).
    const provider = typeof body.provider === 'string' && body.provider ? body.provider : 'manual';
    if (provider === 'razorpay') {
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      if (!keySecret) {
        throw new HttpError(503, 'RAZORPAY_KEY_SECRET is not configured', 'webhook_not_configured');
      }
      if (!verifyRazorpaySignature({ payload, signature: req.header('x-razorpay-signature'), keySecret })) {
        throw new HttpError(401, 'invalid razorpay webhook signature', 'unauthorized');
      }
    }
    const result = billingService.handleWebhookEvent({
      provider,
      event: typeof body.event === 'string' ? body.event : 'unknown',
      eventId: typeof body.event_id === 'string' && body.event_id ? body.event_id : null,
      userId: typeof body.user_id === 'string' ? body.user_id : null,
      invoiceId: typeof body.invoice_id === 'string' ? body.invoice_id : null,
      failureCode: typeof body.failure_code === 'string' ? body.failure_code : null,
      failureReason: typeof body.failure_reason === 'string' ? body.failure_reason : null,
      payload: body,
    });
    res.status(200).json(result);
  });

  return router;
}
