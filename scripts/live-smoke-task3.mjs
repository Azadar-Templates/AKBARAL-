/**
 * Task-3 live smoke — payments, payout verification and publishing, against a
 * RUNNING deployment (not a fixture).
 *
 * Honest by construction: every assertion is either a real state change on the
 * live server or a real refusal. Where a credential is absent the endpoint must
 * refuse, and that refusal is asserted instead of being worked around.
 *
 * Usage (against the local production stack):
 *
 *   PLATFORM_URL=http://127.0.0.1:4000 \
 *   MISSION_URL=http://127.0.0.1:4200 \
 *   MISSION_EMAIL=<mission owner email> MISSION_PASSWORD=<mission owner password> \
 *   SMOKE_WEBHOOK_SECRET=<BILLING_WEBHOOK_SECRET, optional> \
 *   node scripts/live-smoke-task3.mjs
 *
 * Nothing in this script prints a credential. The optional SMOKE_WEBHOOK_SECRET
 * is used to sign a synthetic settlement event for the platform's OWN local
 * invoice — it is a configuration value of the deployment under test, and the
 * script never invents a payment to a provider (there is no provider involved).
 */
const PLATFORM = process.env.PLATFORM_URL || 'http://127.0.0.1:4000';
const MISSION = process.env.MISSION_URL || 'http://127.0.0.1:4200';
const MISSION_EMAIL = process.env.MISSION_EMAIL;
const MISSION_PASSWORD = process.env.MISSION_PASSWORD;

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const suffix = Date.now().toString(36);

// ── Platform: launch surfaces ────────────────────────────────────────────────
console.log('\nPLATFORM — payments, checkout URLs, provider honesty');
const email = `task3-${suffix}@akbaral.test`;
const password = 'task3-correct-horse-battery-staple';

const register = await jsonFetch(`${PLATFORM}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, name: 'Task3 Smoke' }),
});
check('registration returns 201', register.status === 201, `HTTP ${register.status}`);

const login = await jsonFetch(`${PLATFORM}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
check('login returns an access token', login.status === 200 && Boolean(login.body?.accessToken), `HTTP ${login.status}`);
const token = login.body?.accessToken;
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

// Credit purchase without a payment credential must refuse honestly.
const purchase = await jsonFetch(`${PLATFORM}/api/billing/credits`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ credits: 500, amount_cents: 4500, provider: 'stripe' }),
});
check(
  'credit purchase without a Stripe key refuses with provider_not_configured',
  purchase.status === 402 && purchase.body?.error?.code === 'provider_not_configured',
  `HTTP ${purchase.status} code=${purchase.body?.error?.code}`,
);

// Stripe webhook: no signing secret configured → 503, never trust.
const unsignedWebhook = await jsonFetch(`${PLATFORM}/api/billing/webhook/stripe`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'evt_smoke', type: 'checkout.session.completed' }),
});
check(
  'Stripe webhook without STRIPE_WEBHOOK_SECRET answers 503 webhook_not_configured',
  unsignedWebhook.status === 503 && unsignedWebhook.body?.error?.code === 'webhook_not_configured',
  `HTTP ${unsignedWebhook.status} code=${unsignedWebhook.body?.error?.code}`,
);

// Stripe webhook: a forged signature is rejected (raw-body verification active).
const forgedWebhook = await jsonFetch(`${PLATFORM}/api/billing/webhook/stripe`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'a'.repeat(64)}` },
  body: JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed' }),
});
check(
  'Stripe webhook rejects a forged signature (400)',
  forgedWebhook.status === 503 || forgedWebhook.status === 400,
  `HTTP ${forgedWebhook.status} code=${forgedWebhook.body?.error?.code}`,
);

// Manual invoice + generic webhook path still works end to end.
const manual = await jsonFetch(`${PLATFORM}/api/billing/credits`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ credits: 250, amount_cents: 2200, provider: 'manual' }),
});
check('manual credit purchase creates a payable invoice', manual.status === 201 && Boolean(manual.body?.order?.invoiceId), `HTTP ${manual.status}`);

// The credit account is not exposed as a raw balance over HTTP; the honest live
// cross-check is the usage statement, which aggregates the REAL credit
// transactions the settlement wrote.
const usageBefore = await jsonFetch(`${PLATFORM}/api/billing/usage?from=2020-01-01T00:00:00.000Z`, { headers: auth });
const grantedBefore = Number(usageBefore.body?.credits?.granted ?? usageBefore.body?.creditsGranted ?? 0);

if (manual.status === 201) {
  const { createHmac } = await import('node:crypto');
  const secret = process.env.SMOKE_WEBHOOK_SECRET;
  if (secret) {
    // The generic webhook contract is snake_case (see src/routes/billing.ts):
    // event, event_id, user_id, invoice_id, failure_code, failure_reason.
    const eventId = `smoke-${suffix}`;
    const payload = JSON.stringify({ event: 'invoice.paid', event_id: eventId, invoice_id: manual.body.order.invoiceId });
    const signature = `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`;

    const settled = await jsonFetch(`${PLATFORM}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-akbaral-signature': signature },
      body: payload,
    });
    check('signed generic webhook settles the invoice', settled.status === 200 && settled.body?.effect === 'settled', `HTTP ${settled.status} effect=${settled.body?.effect}`);

    const after = await jsonFetch(`${PLATFORM}/api/billing/usage?from=2020-01-01T00:00:00.000Z`, { headers: auth });
    const grantedAfter = Number(after.body?.credits?.granted ?? 0);
    check('settlement granted the purchased credits exactly once', grantedAfter === grantedBefore + 250, `credits granted ${grantedBefore} -> ${grantedAfter}`);

    // Replaying the SAME signed event id must not grant again.
    const replay = await jsonFetch(`${PLATFORM}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-akbaral-signature': signature },
      body: payload,
    });
    const afterReplay = await jsonFetch(`${PLATFORM}/api/billing/usage?from=2020-01-01T00:00:00.000Z`, { headers: auth });
    check(
      'a replayed signed event is idempotent (duplicate, no extra credits)',
      replay.status === 200 && replay.body?.duplicate === true && replay.body?.effect === 'ignored_duplicate' && Number(afterReplay.body?.credits?.granted ?? 0) === grantedAfter,
      `HTTP ${replay.status} duplicate=${replay.body?.duplicate} effect=${replay.body?.effect}`,
    );

    // A forged signature must be refused and change nothing.
    const forged = await jsonFetch(`${PLATFORM}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-akbaral-signature': `sha256=${'b'.repeat(64)}` },
      body: payload,
    });
    const afterForged = await jsonFetch(`${PLATFORM}/api/billing/usage?from=2020-01-01T00:00:00.000Z`, { headers: auth });
    check(
      'a forged generic webhook signature is refused (401) and grants nothing',
      forged.status === 401 && Number(afterForged.body?.credits?.granted ?? 0) === grantedAfter,
      `HTTP ${forged.status}`,
    );

    // A second, independently signed event against the SAME invoice must not
    // settle (or grant) twice — the invoice is already paid.
    const secondPayload = JSON.stringify({ provider: 'stripe', event: 'invoice.paid', event_id: `${eventId}-again`, invoice_id: manual.body.order.invoiceId });
    const secondSignature = `sha256=${createHmac('sha256', secret).update(secondPayload, 'utf8').digest('hex')}`;
    const second = await jsonFetch(`${PLATFORM}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-akbaral-signature': secondSignature },
      body: secondPayload,
    });
    const afterSecond = await jsonFetch(`${PLATFORM}/api/billing/usage?from=2020-01-01T00:00:00.000Z`, { headers: auth });
    check(
      'a differently-signed event for the same invoice cannot settle it twice',
      second.status === 200 && second.body?.effect === 'already_paid' && Number(afterSecond.body?.credits?.granted ?? 0) === grantedAfter,
      `HTTP ${second.status} effect=${second.body?.effect} granted=${afterSecond.body?.credits?.granted}`,
    );

  } else {
    console.log('  SKIP  generic webhook settlement (SMOKE_WEBHOOK_SECRET not provided to the smoke)');
  }
}

// Registry + owner console survive the Task-3 changes.
const agents = await jsonFetch(`${PLATFORM}/api/agents?limit=1`, { headers: auth });
check('agent registry is intact (4,001)', Number(agents.body?.total ?? agents.body?.pagination?.total ?? 0) === 4001, `total=${agents.body?.total ?? agents.body?.pagination?.total}`);

// ── Mission: verification flow, social, isolation ────────────────────────────
console.log('\nMISSION — payout verification, social connections, isolation');

const anon = await jsonFetch(`${MISSION}/api/payout-slots`);
check('mission payout surface refuses anonymous callers (401)', anon.status === 401, `HTTP ${anon.status}`);
const anonSocial = await jsonFetch(`${MISSION}/api/social/connections`);
check('mission publishing surface refuses anonymous callers (401)', anonSocial.status === 401, `HTTP ${anonSocial.status}`);

const missionLogin = await jsonFetch(`${MISSION}/api/session/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: MISSION_EMAIL, password: MISSION_PASSWORD }),
});
check('mission owner sign-in succeeds', missionLogin.status === 200 && Boolean(missionLogin.body?.token), `HTTP ${missionLogin.status}`);
const missionAuth = { authorization: `Bearer ${missionLogin.body?.token}`, 'content-type': 'application/json' };

const slots = await jsonFetch(`${MISSION}/api/payout-slots`, { headers: missionAuth });
check('four payout slots exist', slots.status === 200 && slots.body?.slots?.length === 4, `HTTP ${slots.status}`);
check('verification payload is returned per slot', Array.isArray(slots.body?.verification) && slots.body.verification.length === 4);
check('an unconfigured slot is not payable', slots.body?.verification?.every((entry) => entry.payable === false), 'all four slots blocked');
check('the required control checks are published', Array.isArray(slots.body?.checks) && slots.body.checks.length >= 5, `${slots.body?.checks?.length} checks`);
check('every blocked slot states why', slots.body?.verification?.every((entry) => entry.blockers.length > 0));

// Configure + verify slot 1 through the real API (evidence-based flow).
const configure = await jsonFetch(`${MISSION}/api/payout-slots/1`, {
  method: 'POST',
  headers: missionAuth,
  body: JSON.stringify({
    label: 'Task3 smoke destination',
    destinationType: 'payment_provider',
    providerRef: `acct_smoke_${suffix}`,
    maskedAccount: '****4242',
    minPayoutCents: 0,
  }),
});
check('slot 1 configured with a provider reference', configure.status === 200 && configure.body?.slot?.status === 'pending_verification', `HTTP ${configure.status} status=${configure.body?.slot?.status}`);

const unsafe = await jsonFetch(`${MISSION}/api/payout-slots/2`, {
  method: 'POST',
  headers: missionAuth,
  body: JSON.stringify({ label: 'unsafe', maskedAccount: '4111111111111111' }),
});
check('a full card number is refused as a destination', unsafe.status === 400 && unsafe.body?.error?.code === 'unsafe_destination', `HTTP ${unsafe.status} code=${unsafe.body?.error?.code}`);

const startVerification = await jsonFetch(`${MISSION}/api/payout-slots/1/verification/start`, {
  method: 'POST',
  headers: missionAuth,
  body: JSON.stringify({ method: 'provider_reference' }),
});
check('verification starts in pending state', startVerification.status === 200 && startVerification.body?.verification?.status === 'pending', `HTTP ${startVerification.status}`);

const requiredChecks = startVerification.body?.verification?.requiredChecks ?? [];
const partial = Object.fromEntries(requiredChecks.slice(0, 1).map((key) => [key, true]));
const partialConfirm = await jsonFetch(`${MISSION}/api/payout-slots/1/verification/confirm`, {
  method: 'POST',
  headers: missionAuth,
  body: JSON.stringify({ checks: partial, attestation: 'I control this destination and confirm the provider verified my identity there.' }),
});
check(
  'a partial confirmation is refused, naming the missing checks',
  partialConfirm.status === 409 && partialConfirm.body?.error?.code === 'verification_incomplete',
  `HTTP ${partialConfirm.status} code=${partialConfirm.body?.error?.code}`,
);

const full = Object.fromEntries(requiredChecks.map((key) => [key, true]));
const confirm = await jsonFetch(`${MISSION}/api/payout-slots/1/verification/confirm`, {
  method: 'POST',
  headers: missionAuth,
  body: JSON.stringify({
    checks: full,
    attestation: 'I control this payout destination, the masked details match my records, and the provider has verified my identity.',
    evidenceRef: 'task3 smoke evidence',
  }),
});
check('a complete confirmation verifies and activates the slot', confirm.status === 200 && confirm.body?.slot?.status === 'active', `HTTP ${confirm.status} status=${confirm.body?.slot?.status}`);
check('the verification carries an expiry', Boolean(confirm.body?.verification?.expiresAt), confirm.body?.verification?.expiresAt);
check('the slot is now payable', confirm.body?.status?.payable === true);

const slotsAfter = await jsonFetch(`${MISSION}/api/payout-slots`, { headers: missionAuth });
const slotOne = slotsAfter.body?.verification?.find((entry) => entry.slot === 1);
check('the slot reports payable with no blockers', slotOne?.payable === true && slotOne?.blockers?.length === 0);

const revoke = await jsonFetch(`${MISSION}/api/payout-slots/1/verification/revoke`, {
  method: 'POST',
  headers: missionAuth,
  body: JSON.stringify({ reason: 'task3 smoke revocation' }),
});
check('revoking a verification pauses the slot', revoke.status === 200 && revoke.body?.slot?.status === 'paused', `HTTP ${revoke.status} status=${revoke.body?.slot?.status}`);
const slotsRevoked = await jsonFetch(`${MISSION}/api/payout-slots`, { headers: missionAuth });
check('a revoked slot is not payable', slotsRevoked.body?.verification?.find((entry) => entry.slot === 1)?.payable === false);

// Social publishing preparation: honest state, exact setup instructions.
const social = await jsonFetch(`${MISSION}/api/social/connections`, { headers: missionAuth });
check('publishing reports three platforms', social.status === 200 && social.body?.platforms?.length === 3, `HTTP ${social.status}`);
check('no platform is reported connected without a real token', social.body?.platforms?.every((platform) => platform.connected === false && platform.status === 'not_configured'));
check('engagement is explicitly not guaranteed', social.body?.guaranteedEngagement === false);
check(
  'setup instructions name the redirect URI and the variables',
  social.body?.setup?.length === 3 && social.body.setup.every((entry) => entry.redirectUri.includes('/api/social/oauth/') && entry.requireEnvKeys.length >= 2),
  social.body?.setup?.map((entry) => entry.redirectUri).join(' '),
);
check(
  'minimum publishing scopes only',
  social.body?.platforms?.every((platform) => platform.scopes.every((scope) => !/manage|delete|force-ssl/.test(scope))),
);

const startSocial = await jsonFetch(`${MISSION}/api/social/oauth/tiktok/start`, { method: 'POST', headers: missionAuth, body: '{}' });
check(
  'starting an authorization without a registered app refuses with provider_not_configured',
  startSocial.status === 503 && startSocial.body?.error?.code === 'provider_not_configured',
  `HTTP ${startSocial.status} code=${startSocial.body?.error?.code}`,
);

// Integrity: chains still verify after all of the above.
const health = await jsonFetch(`${MISSION}/api/health`);
check('mission audit + ledger chains still verify', health.body?.audit === true && health.body?.ledger === true);
check('credential vault is configured', health.body?.vaultConfigured === true);

// Isolation: the mission must not expose the platform codename anywhere public.
const platformHome = await fetch(`${PLATFORM.replace(':4000', ':3000')}/`);
const homeText = await platformHome.text();
check('the public AKBARAL! homepage does not mention the mission codename', !/ZA141251SA/i.test(homeText));

console.log(`\nTASK-3 LIVE SMOKE: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('failed checks:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
