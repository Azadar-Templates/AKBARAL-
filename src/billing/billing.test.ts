import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import { createApiServer, type ApiServer } from '../app';
import { startModelFixture, type ModelFixtureServer } from '../test-support/model-provider-fixture';
import { db, getCreditAccount, findTaskById } from '../db';
import { syncAgentRegistry } from '../agents/registry';
import { executionQueue } from '../orchestrator/queue';

/**
 * Milestone 8 — trial/credits/billing integration tests.
 *
 * Trust policy invariants (MUST NOT CHANGE):
 *   - 30-day trial + 5 free tasks at registration
 *   - a free task is consumed ONLY after successful completion
 *   - any unsuccessful execution (failure/verification/timeout/cancellation/
 *     crash) refunds the free task
 *   - Pro-required responses never consume the free task
 *   - balances never go negative; accounting is atomic server-side
 *
 * Billing flows: manual purchases, signed webhook settlement (idempotent +
 * duplicate-event protection), forged-signature rejection, failed payments,
 * refunds with credit reversal, provider_not_configured honesty, real Stripe/
 * Razorpay checkout against local provider fixtures, invoice PDFs, usage
 * statements, subscription state, admin billing overview.
 */

const suffix = randomBytes(6).toString('hex');
const password = 'correct-horse-battery-staple';
const WEBHOOK_SECRET = 'm8-test-webhook-secret';

interface ProviderFixture {
  baseUrl: string;
  close(): Promise<void>;
}

/** Minimal Stripe/Razorpay-compatible fixture answering checkout/order calls. */
async function startPaymentFixture(): Promise<ProviderFixture> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      requests.push(`${req.method} ${req.url}`);
      if (req.url?.includes('/v1/checkout/sessions')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'cs_test_m8fixture', url: 'https://checkout.stripe.test/pay/cs_test_m8fixture' }));
        return;
      }
      if (req.url?.includes('/v1/orders')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ id: 'order_m8fixture', status: 'created', amount: 5000, currency: 'PKR' }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function sign(payload: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`;
}

describe('Milestone 8: trial/credits/billing', () => {
  let api: ApiServer;
  let baseUrl = '';
  let modelFixture: ModelFixtureServer;
  let paymentFixture: ProviderFixture;
  let token = '';
  let userId = '';
  let adminToken = '';
  let adminId = '';
  const savedEnv = new Map<string, string | undefined>();

  before(async () => {
    for (const key of [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'BILLING_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY',
      'STRIPE_BASE_URL',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_BASE_URL',
      'AKBARAL_MARKETPLACE_COMMISSION_BPS',
    ]) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.BILLING_WEBHOOK_SECRET = WEBHOOK_SECRET;

    syncAgentRegistry();
    modelFixture = await startModelFixture('ok');
    paymentFixture = await startPaymentFixture();

    api = createApiServer();
    const { port } = await api.listen(0);
    baseUrl = `http://127.0.0.1:${port}`;

    async function register(label: string): Promise<{ id: string; token: string }> {
      const email = `m8-${label}-${suffix}@akbaral.test`;
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: `M8 ${label}` }),
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { user: { id: string } };
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(login.status, 200);
      const loginBody = (await login.json()) as { accessToken: string };
      return { id: body.user.id, token: loginBody.accessToken };
    }

    const user = await register('user');
    userId = user.id;
    token = user.token;
    const admin = await register('admin');
    adminId = admin.id;
    db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', adminId]);
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `m8-admin-${suffix}@akbaral.test`, password }),
    });
    adminToken = ((await adminLogin.json()) as { accessToken: string }).accessToken;
  });

  after(async () => {
    try {
      executionQueue.stop();
    } catch {
      // already stopped
    }
    // Remove this run's users. The shared test.db is reused by later suites
    // (e.g. src/server/app.test.ts searches for web-research-001), and this
    // suite's successful-task path lazily creates that agent owned by its
    // test user. Deleting the users flips agents.owner_id to NULL (ON DELETE
    // SET NULL), keeping the registry agent visible to everyone — the same
    // state earlier suites leave behind.
    db.run('DELETE FROM users WHERE email LIKE ?', [`m8-%${suffix}@akbaral.test`]);
    for (const [key, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    db.close();
    await modelFixture.close();
    await paymentFixture.close();
    await api.close();
  });

  function authHeaders(userToken: string): Record<string, string> {
    return { authorization: `Bearer ${userToken}` };
  }

  async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`waitFor timed out waiting for ${label}`);
  }

  async function postWebhook(payload: Record<string, unknown>, options?: { secret?: string; razorpaySignature?: string }): Promise<Response> {
    const body = JSON.stringify(payload);
    return fetch(`${baseUrl}/api/billing/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-akbaral-signature': sign(body, options?.secret ?? WEBHOOK_SECRET),
        ...(options?.razorpaySignature ? { 'x-razorpay-signature': options.razorpaySignature } : {}),
      },
      body,
    });
  }

  function paidCredits(): number {
    return getCreditAccount(userId)?.paid_credits ?? -1;
  }

  function freeCredits(): number {
    return getCreditAccount(userId)?.free_credits ?? -1;
  }

  // ---------------------------------------------------------------- trust ---

  it('grants a 30-day trial with 5 free tasks at registration', async () => {
    const response = await fetch(`${baseUrl}/api/me`, { headers: authHeaders(token) });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      user: { freeCredits: number };
      trial: { active: boolean; trialEndsAt: string };
      subscription: { status: string; plan_key: string } | null;
    };
    assert.equal(body.user.freeCredits, 5);
    assert.equal(body.trial.active, true);
    const daysRemaining = (new Date(body.trial.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    assert.ok(daysRemaining > 28 && daysRemaining <= 30.01, `30-day trial window (${daysRemaining.toFixed(2)} days)`);
    assert.ok(body.subscription === null || ['trialing', 'active'].includes(body.subscription.status));
  });

  it('consumes a free task ONLY after successful completion (failure refunds)', async () => {
    const before = freeCredits();

    // Unsuccessful path: no provider configured -> honest failure + refund.
    const failed = await fetch(`${baseUrl}/api/tasks/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ goal: 'm8 trust policy failure path' }),
    });
    assert.equal(failed.status, 202);
    const failedBody = (await failed.json()) as { task: { id: string } };
    await waitFor(() => findTaskById(failedBody.task.id)?.status === 'failed', 20_000, 'honest failure');
    assert.equal(freeCredits(), before, 'failed task does not consume the free task');

    // Successful path: provider fixture configured -> completion consumes once.
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    process.env.OPENAI_BASE_URL = modelFixture.baseUrl;
    try {
      const ok = await fetch(`${baseUrl}/api/workflows/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ agent_slug: 'research-researcher-002', goal: 'm8 trust policy success path' }),
      });
      assert.equal(ok.status, 202);
      const okBody = (await ok.json()) as { task: { id: string } };
      await waitFor(() => findTaskById(okBody.task.id)?.status === 'completed', 60_000, 'successful completion');
      assert.equal(freeCredits(), before - 1, 'exactly one credit consumed on success');
    } finally {
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
    }
  });

  it('returns requires_pro without consuming when credits are exhausted', async () => {
    // Deterministic: set the dedicated user's balance to zero (admin-style
    // direct setup, as the UI would show after real exhaustion).
    db.run('UPDATE credit_accounts SET free_credits = 0, paid_credits = 0 WHERE user_id = ?', [userId]);
    const response = await fetch(`${baseUrl}/api/tasks/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ goal: 'exhausted balance attempt' }),
    });
    assert.equal(response.status, 402);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'requires_pro');
    assert.match(body.error.message, /Pro/i);
    assert.equal(freeCredits(), 0, 'no consumption on a Pro-required rejection');
    assert.ok(freeCredits() >= 0 && paidCredits() >= 0, 'balances never negative');
    // Restore the trial balance for later tests.
    db.run('UPDATE credit_accounts SET free_credits = 4 WHERE user_id = ?', [userId]);
  });

  // ------------------------------------------------- manual purchase flow ---

  it('creates a manual credit purchase with a due invoice', async () => {
    const response = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ credits: 10, amount_cents: 2500, provider: 'manual' }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { order: { invoiceId: string; invoiceNumber: string; status: string; credits: number } };
    assert.equal(body.order.status, 'pending');
    assert.equal(body.order.credits, 10);
    const invoice = db.get<{ status: string; total_cents: number }>('SELECT status, total_cents FROM invoices WHERE id = ?', [body.order.invoiceId]);
    assert.ok(invoice);
    assert.equal(invoice.status, 'due');
    assert.equal(invoice.total_cents, 2500);
  });

  it('rejects forged and unauthenticated webhooks', async () => {
    const payload = JSON.stringify({ event: 'invoice.paid', invoice_id: 'inv_does_not_exist' });
    const noSignature = await fetch(`${baseUrl}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    assert.equal(noSignature.status, 401);

    const wrongSecret = await fetch(`${baseUrl}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-akbaral-signature': sign(payload, 'wrong-secret') },
      body: payload,
    });
    assert.equal(wrongSecret.status, 401);
  });

  it('settles an invoice via signed webhook and grants credits exactly once', async () => {
    const purchase = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ credits: 20, amount_cents: 5000, provider: 'manual' }),
    });
    const purchaseBody = (await purchase.json()) as { order: { invoiceId: string } };
    const invoiceId = purchaseBody.order.invoiceId;
    const paidBefore = paidCredits();

    const first = await postWebhook({ event: 'invoice.paid', event_id: 'evt_m8_001', invoice_id: invoiceId, provider: 'manual' });
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { received: boolean; duplicate: boolean; effect: string };
    assert.equal(firstBody.duplicate, false);
    assert.equal(firstBody.effect, 'settled');
    assert.equal(paidCredits(), paidBefore + 20, 'credits granted exactly once');
    const invoice = db.get<{ status: string; paid_at: string }>('SELECT status, paid_at FROM invoices WHERE id = ?', [invoiceId]);
    assert.equal(invoice?.status, 'paid');
    assert.ok(invoice?.paid_at);
    const payment = db.get<{ status: string }>('SELECT status FROM payments WHERE invoice_id = ?', [invoiceId]);
    assert.equal(payment?.status, 'succeeded');
  });

  it('ignores duplicate webhook deliveries (same event id) with zero side effects', async () => {
    const paidBefore = paidCredits();
    const replay = await postWebhook({ event: 'invoice.paid', event_id: 'evt_m8_001', invoice_id: 'inv_any', provider: 'manual' });
    assert.equal(replay.status, 200);
    const body = (await replay.json()) as { duplicate: boolean; effect: string };
    assert.equal(body.duplicate, true);
    assert.equal(body.effect, 'ignored_duplicate');
    assert.equal(paidCredits(), paidBefore, 'no double grant on replay');
  });

  it('marks payments failed without ever granting credits', async () => {
    const purchase = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ credits: 5, amount_cents: 1250, provider: 'manual' }),
    });
    const purchaseBody = (await purchase.json()) as { order: { invoiceId: string } };
    const invoiceId = purchaseBody.order.invoiceId;
    const paidBefore = paidCredits();

    const failed = await postWebhook({
      event: 'payment.failed',
      event_id: 'evt_m8_002',
      invoice_id: invoiceId,
      provider: 'manual',
      failure_code: 'insufficient_funds',
      failure_reason: 'bank declined',
    });
    assert.equal(failed.status, 200);
    const body = (await failed.json()) as { effect: string };
    assert.equal(body.effect, 'payment_marked_failed');
    assert.equal(paidCredits(), paidBefore, 'failed payment never grants credits');
    const payment = db.get<{ status: string; failure_code: string }>('SELECT status, failure_code FROM payments WHERE invoice_id = ?', [invoiceId]);
    assert.equal(payment?.status, 'failed');
    assert.equal(payment?.failure_code, 'insufficient_funds');
    const invoice = db.get<{ status: string }>('SELECT status FROM invoices WHERE id = ?', [invoiceId]);
    assert.equal(invoice?.status, 'due', 'invoice stays due after a failed payment');
  });

  it('refunds a settled invoice: reverses credits atomically and replays are no-ops', async () => {
    const purchase = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ credits: 8, amount_cents: 2000, provider: 'manual' }),
    });
    const purchaseBody = (await purchase.json()) as { order: { invoiceId: string } };
    const invoiceId = purchaseBody.order.invoiceId;
    await postWebhook({ event: 'invoice.paid', event_id: 'evt_m8_003', invoice_id: invoiceId, provider: 'manual' });
    const paidAfterSettle = paidCredits();

    const refund = await postWebhook({ event: 'invoice.refunded', event_id: 'evt_m8_004', invoice_id: invoiceId, provider: 'manual' });
    assert.equal(refund.status, 200);
    const refundBody = (await refund.json()) as { effect: string };
    assert.equal(refundBody.effect, 'refunded');
    assert.equal(paidCredits(), paidAfterSettle - 8, 'credits reversed');
    const invoice = db.get<{ status: string }>('SELECT status FROM invoices WHERE id = ?', [invoiceId]);
    assert.equal(invoice?.status, 'refunded');
    const payment = db.get<{ status: string }>('SELECT status FROM payments WHERE invoice_id = ?', [invoiceId]);
    assert.equal(payment?.status, 'refunded');

    // Replaying the refund is an honest no-op (already refunded).
    const replay = await postWebhook({ event: 'invoice.refunded', event_id: 'evt_m8_005', invoice_id: invoiceId, provider: 'manual' });
    const replayBody = (await replay.json()) as { effect: string };
    assert.equal(replayBody.effect, 'already_refunded');
    assert.equal(paidCredits(), paidAfterSettle - 8, 'no double reversal');

    // Refunding a never-paid invoice is a no-op.
    const fresh = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ credits: 3, amount_cents: 750, provider: 'manual' }),
    });
    const freshBody = (await fresh.json()) as { order: { invoiceId: string } };
    const notPaid = await postWebhook({ event: 'invoice.refunded', event_id: 'evt_m8_006', invoice_id: freshBody.order.invoiceId, provider: 'manual' });
    const notPaidBody = (await notPaid.json()) as { effect: string };
    assert.equal(notPaidBody.effect, 'not_paid');

    // A late invoice.paid on the REFUNDED invoice must NOT re-settle it or
    // re-grant the reversed credits (double-grant-after-refund guard).
    const rePay = await postWebhook({ event: 'invoice.paid', event_id: 'evt_m8_007', invoice_id: invoiceId, provider: 'manual' });
    const rePayBody = (await rePay.json()) as { effect: string };
    assert.equal(rePayBody.effect, 'already_refunded');
    assert.equal(paidCredits(), paidAfterSettle - 8, 'no credits re-granted for a refunded invoice');
    const refundedInvoice = db.get<{ status: string }>('SELECT status FROM invoices WHERE id = ?', [invoiceId]);
    assert.equal(refundedInvoice?.status, 'refunded', 'invoice stays refunded');

    // Admin manual settlement of a refunded invoice is rejected outright.
    const adminSettle = await fetch(`${baseUrl}/api/admin/settle-payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(adminToken) },
      body: JSON.stringify({ user_id: userId, invoice_id: invoiceId, amount_cents: 2000, credits: 8 }),
    });
    assert.equal(adminSettle.status, 409);
    assert.equal(paidCredits(), paidAfterSettle - 8, 'admin path also cannot re-grant a refunded invoice');
  });

  // ------------------------------------------------ real provider checkout ---

  it('reports provider_not_configured honestly for unconfigured Stripe', async () => {
    const response = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ credits: 10, amount_cents: 2500, provider: 'stripe' }),
    });
    assert.equal(response.status, 402);
    const body = (await response.json()) as { error: { code: string; requiredCredential: string }; order: { status: string } };
    assert.equal(body.error.code, 'provider_not_configured');
    assert.match(body.error.requiredCredential, /STRIPE_SECRET_KEY/);
    assert.equal(body.order.status, 'provider_not_configured');
  });

  it('creates a real Stripe checkout session when configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_m8_fixture';
    process.env.STRIPE_BASE_URL = paymentFixture.baseUrl;
    try {
      const response = await fetch(`${baseUrl}/api/billing/credits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ credits: 12, amount_cents: 3000, provider: 'stripe' }),
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { order: { providerReference: string; checkoutUrl: string; status: string } };
      assert.equal(body.order.providerReference, 'cs_test_m8fixture', 'real provider session id stored');
      assert.equal(body.order.checkoutUrl, 'https://checkout.stripe.test/pay/cs_test_m8fixture');
      assert.equal(body.order.status, 'requires_external_payment');
    } finally {
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_BASE_URL;
    }
  });

  it('creates a real Razorpay order when configured and verifies its webhook signature', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_m8';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_m8';
    process.env.RAZORPAY_BASE_URL = paymentFixture.baseUrl;
    try {
      const response = await fetch(`${baseUrl}/api/billing/credits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ credits: 6, amount_cents: 1500, provider: 'razorpay' }),
      });
      assert.equal(response.status, 201);
      const body = (await response.json()) as { order: { providerReference: string; checkoutUrl: string | null } };
      assert.equal(body.order.providerReference, 'order_m8fixture', 'real provider order id stored');
      assert.equal(body.order.checkoutUrl, null, 'razorpay checkout opens client-side with the order id');

      // A webhook claiming razorpay must ALSO carry a valid x-razorpay-signature.
      const payload = JSON.stringify({ event: 'invoice.paid', provider: 'razorpay', event_id: 'evt_m8_rzp_bad', invoice_id: 'inv_x' });
      const forged = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-akbaral-signature': sign(payload) },
        body: payload,
      });
      assert.equal(forged.status, 401, 'missing razorpay signature rejected');

      const validRazorpay = createHmac('sha256', 'rzp_secret_m8').update(payload, 'utf8').digest('hex');
      const accepted = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-akbaral-signature': sign(payload), 'x-razorpay-signature': validRazorpay },
        body: payload,
      });
      assert.equal(accepted.status, 200);
      const acceptedBody = (await accepted.json()) as { effect: string };
      assert.equal(acceptedBody.effect, 'invoice_not_found', 'valid signature accepted; unknown invoice honest');
    } finally {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      delete process.env.RAZORPAY_BASE_URL;
    }
  });

  // ------------------------------------------------------------- invoices ---

  it('generates a real PDF invoice restricted to its owner', async () => {
    const purchase = await fetch(`${baseUrl}/api/billing/credits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ credits: 4, amount_cents: 1000, provider: 'manual' }),
    });
    const purchaseBody = (await purchase.json()) as { order: { invoiceId: string; invoiceNumber: string } };

    const pdf = await fetch(`${baseUrl}/api/billing/invoices/${purchaseBody.order.invoiceId}/pdf`, {
      headers: authHeaders(token),
    });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get('content-type') ?? '', /application\/pdf/);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    const text = bytes.toString('latin1');
    assert.ok(text.startsWith('%PDF-1.4'), 'valid PDF header');
    assert.ok(text.includes('/Type /Catalog'), 'PDF structure objects');
    assert.ok(text.includes('startxref'), 'xref table present');
    assert.ok(text.endsWith('%%EOF\n')), 'PDF trailer';
    assert.ok(text.includes(purchaseBody.order.invoiceNumber), 'invoice number rendered');
    assert.ok(text.includes('AKBARAL'), 'branded document');

    // Another user's invoice (or none at all) is a 404.
    const outsider = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `m8-outsider-${suffix}@akbaral.test`, password, name: 'Outsider' }),
    });
    assert.equal(outsider.status, 201);
    const outsiderLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `m8-outsider-${suffix}@akbaral.test`, password }),
    });
    const outsiderToken = ((await outsiderLogin.json()) as { accessToken: string }).accessToken;
    const foreign = await fetch(`${baseUrl}/api/billing/invoices/${purchaseBody.order.invoiceId}/pdf`, {
      headers: authHeaders(outsiderToken),
    });
    assert.equal(foreign.status, 404, 'no cross-user invoice access');
  });

  // ------------------------------------------------------- usage + admin ---

  it('returns a real usage statement for the period', async () => {
    const response = await fetch(`${baseUrl}/api/billing/usage?from=2020-01-01T00:00:00.000Z`, { headers: authHeaders(token) });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      period: { from: string; to: string };
      tasks: { total: number; completed: number; failed: number };
      credits: { consumed: number; refunded: number; granted: number };
      modelRuns: { total: number };
      billing: { invoices: number; paidCents: number };
    };
    assert.ok(body.period.from.startsWith('2020-01-01'));
    assert.ok(body.tasks.total >= 2, 'real task activity aggregated');
    assert.ok(body.tasks.completed >= 1);
    assert.ok(body.tasks.failed >= 1);
    assert.ok(body.credits.consumed >= 1, 'credit consumption tracked');
    assert.ok(body.credits.refunded >= 0);
    assert.ok(body.billing.invoices >= 5, 'invoices counted');
    assert.ok(body.billing.paidCents >= 5000, 'paid revenue tracked');
  });

  it('switches subscription plans and reports subscription state', async () => {
    const plans = await fetch(`${baseUrl}/api/billing/plans`);
    assert.equal(plans.status, 200);
    const plansBody = (await plans.json()) as { plans: Array<{ key: string }> };
    assert.ok(plansBody.plans.length >= 1);

    const target = plansBody.plans.find((plan) => plan.key !== 'free') ?? plansBody.plans[0];
    const switchResponse = await fetch(`${baseUrl}/api/billing/switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ plan_key: target.key }),
    });
    assert.equal(switchResponse.status, 202);
    const switchBody = (await switchResponse.json()) as { planKey: string; status: string };
    assert.equal(switchBody.planKey, target.key);

    const account = await fetch(`${baseUrl}/api/billing/account`, { headers: authHeaders(token) });
    assert.equal(account.status, 200);
    const accountBody = (await account.json()) as {
      subscription: { plan_key: string; status: string } | null;
      entitlements: unknown[];
      invoices: unknown[];
      payments: unknown[];
      trial: { active: boolean };
    };
    assert.ok(accountBody.subscription);
    assert.equal(accountBody.subscription?.plan_key, target.key);
    assert.ok(Array.isArray(accountBody.invoices) && accountBody.invoices.length >= 5);
    assert.ok(Array.isArray(accountBody.payments) && accountBody.payments.length >= 5);
    assert.ok(Array.isArray(accountBody.entitlements));
    assert.ok(typeof accountBody.trial?.active === 'boolean');
  });

  it('exposes an admin billing overview with real aggregates and denies non-admins', async () => {
    const denied = await fetch(`${baseUrl}/api/admin/billing/overview`, { headers: authHeaders(token) });
    assert.equal(denied.status, 403);

    const response = await fetch(`${baseUrl}/api/admin/billing/overview`, { headers: authHeaders(adminToken) });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      overview: {
        revenue: { paidCents: number; refundedCents: number; outstandingCents: number; monthly: Array<{ month: string; cents: number }> };
        costs: { providerModelCents: number };
        margin: { grossMarginCents: number; grossMarginPercent: number | null };
        credits: { consumed: number; granted: number; reversed: number };
        subscriptions: { active: number; byPlan: Array<{ plan_key: string; count: number }> };
        conversion: { trialUsers: number; convertedUsers: number };
        payments: { failed: number };
        marketplace: { orders: number; commissionBps: number; commissionCents: number };
      };
    };
    const overview = body.overview;
    assert.ok(overview.revenue.paidCents >= 5000, 'paid revenue aggregated from real invoices');
    assert.ok(overview.revenue.refundedCents >= 2000, 'refunds tracked');
    assert.ok(overview.revenue.outstandingCents > 0, 'outstanding invoices tracked');
    assert.ok(Array.isArray(overview.revenue.monthly));
    assert.ok(overview.costs.providerModelCents >= 0, 'provider model costs tracked');
    assert.ok(overview.margin.grossMarginCents === overview.revenue.paidCents - overview.costs.providerModelCents);
    assert.ok(overview.credits.consumed >= 1);
    // Settled purchases in this suite: 20 + 8 (+1 platform grant if seeded) —
    // failed/unpaid purchases (5, 3, 4) never grant credits.
    assert.ok(overview.credits.granted >= 28, 'granted credits include settled purchases');
    assert.ok(overview.credits.reversed >= 8, 'reversed credits from refunds tracked');
    assert.ok(overview.payments.failed >= 1, 'failed payments tracked');
    assert.ok(overview.subscriptions.active >= 1);
    assert.ok(overview.marketplace.commissionBps >= 0);
    assert.ok(overview.marketplace.commissionCents >= 0);
  });

  it('does not accept webhooks when the shared secret is not configured', async () => {
    const saved = process.env.BILLING_WEBHOOK_SECRET;
    delete process.env.BILLING_WEBHOOK_SECRET;
    try {
      const payload = JSON.stringify({ event: 'invoice.paid', invoice_id: 'inv_x' });
      const response = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-akbaral-signature': sign(payload) },
        body: payload,
      });
      assert.equal(response.status, 503);
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'webhook_not_configured');
    } finally {
      if (saved !== undefined) {
        process.env.BILLING_WEBHOOK_SECRET = saved;
      }
    }
  });
});
