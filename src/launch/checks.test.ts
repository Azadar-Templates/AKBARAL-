import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runLaunchChecks, readinessPercent, type Probe, type ProbeRequest } from './checks';
import { resolveCheckoutUrls } from '../billing/checkout-urls';
import { computeStripeSignature, normalizeStripeEvent } from '../billing/stripe';
import { SOCIAL_PLATFORMS, buildSocialAuthorizeUrl, socialRedirectUri } from '../social/platforms';

/**
 * Launch verification tests.
 *
 * The launch check is the instrument that reports whether AKBARAL! is ready to
 * serve customers, so it must be honest in both directions:
 *   · it must NOT report ready for anything that is unconfigured or broken;
 *   · it must NOT invent provider success, and it must never print a secret;
 *   · it must distinguish "not configured" from "unreachable" from "rejected",
 *     because the owner's next action is different in each case.
 *
 * Every provider probe below is a local fake — no network, no credentials.
 */

const FAKE_KEY = ['AIza', 'SyD', 'FAKE', 'KEY', 'FOR', 'TESTS', 'ONLY', 'xyz'].join('_');
// Secret-shaped fixtures are assembled at runtime so the repository's own secret
// scanner never has to whitelist a literal (the same rule the mission tests use).
const TAVILY_PREFIX = ['tvly', 'super', 'secret'].join('-');
const TAVILY_FIXTURE = `${TAVILY_PREFIX}-value-should-never-appear`;
const STRIPE_FIXTURE = ['sk_live', 'should', 'never', 'appear', 'anywhere'].join('_');
const STRIPE_WEBHOOK_FIXTURE = ['whsec', 'should', 'never', 'appear', 'either'].join('_');

function probeThat(handler: (request: ProbeRequest) => { status: number } | 'unreachable'): { probe: Probe; calls: ProbeRequest[] } {
  const calls: ProbeRequest[] = [];
  const probe: Probe = async (request) => {
    calls.push(request);
    const outcome = handler(request);
    if (outcome === 'unreachable') throw new Error('ECONNREFUSED');
    return { status: outcome.status, json: {}, text: '' };
  };
  return { probe, calls };
}

const BASE_ENV: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'a-production-grade-session-secret-value-0123456789',
  AKBARAL_SITE_URL: 'https://akbaral.duckdns.org',
};

describe('launch checks — honesty and classification', () => {
  it('reports every missing credential as not_configured with the exact variable names', async () => {
    const { probe } = probeThat(() => ({ status: 200 }));
    const report = await runLaunchChecks({ env: { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40) }, probe, only: ['provider'] });
    const byId = new Map(report.checks.map((check) => [check.id, check]));

    const gemini = byId.get('provider.gemini')!;
    assert.equal(gemini.status, 'not_configured');
    assert.deepEqual(gemini.envKeys, ['GOOGLE_API_KEY', 'GEMINI_API_KEY']);
    assert.match(gemini.ownerAction ?? '', /AI Studio/);

    const search = byId.get('provider.search')!;
    assert.equal(search.status, 'not_configured');
    assert.ok(search.envKeys.includes('TAVILY_API_KEY'));

    const payments = byId.get('provider.payments')!;
    assert.equal(payments.status, 'not_configured');
    assert.ok(payments.envKeys.includes('STRIPE_SECRET_KEY'));

    assert.equal(report.summary.requiredNotReady, report.blockers.length);
    assert.ok(report.blockers.length >= 3);
  });

  it('verifies a present Gemini key with a live call and reports the provider verdict', async () => {
    const ok = probeThat(() => ({ status: 200 }));
    const readyReport = await runLaunchChecks({
      env: { ...BASE_ENV, GOOGLE_API_KEY: FAKE_KEY },
      probe: ok.probe,
      deep: true,
      only: ['provider.gemini'],
    });
    const ready = readyReport.checks[0];
    assert.equal(ready.status, 'ready');
    assert.match(ready.evidence, /live provider call succeeded/);
    assert.match(ready.evidence, /generateContent succeeded/, 'the deep probe proves a real generation call');
    // The request really was keyed and really hit the documented endpoint.
    assert.equal(ok.calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models');
    assert.equal(ok.calls[0].headers?.['x-goog-api-key'], FAKE_KEY);
    assert.ok(ok.calls.some((call) => call.url.includes(':generateContent')));

    const rejected = probeThat(() => ({ status: 403 }));
    const rejectedReport = await runLaunchChecks({ env: { ...BASE_ENV, GOOGLE_API_KEY: FAKE_KEY }, probe: rejected.probe, only: ['provider.gemini'] });
    assert.equal(rejectedReport.checks[0].status, 'failed');
    assert.match(rejectedReport.checks[0].evidence, /rejected the credential \(HTTP 403\)/);
    assert.equal(rejectedReport.blockers.length, 1);

    const unreachable = probeThat(() => 'unreachable');
    const unreachableReport = await runLaunchChecks({ env: { ...BASE_ENV, GOOGLE_API_KEY: FAKE_KEY }, probe: unreachable.probe, only: ['provider.gemini'] });
    assert.equal(unreachableReport.checks[0].status, 'unreachable', 'a network failure is not the same fact as a bad key');
  });

  it('never prints a secret: only names, lengths and status codes appear in a report', async () => {
    const { probe } = probeThat(() => ({ status: 200 }));
    const report = await runLaunchChecks({
      env: {
        ...BASE_ENV,
        GOOGLE_API_KEY: FAKE_KEY,
        TAVILY_API_KEY: TAVILY_FIXTURE,
        STRIPE_SECRET_KEY: STRIPE_FIXTURE,
        STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_FIXTURE,
      },
      probe,
      only: ['provider'],
    });
    const serialized = JSON.stringify(report);
    for (const secret of [FAKE_KEY, TAVILY_FIXTURE, STRIPE_FIXTURE, STRIPE_WEBHOOK_FIXTURE]) {
      assert.ok(!serialized.includes(secret), `a report must never contain ${secret.slice(0, 8)}…`);
    }
    assert.ok(serialized.includes('GOOGLE_API_KEY'), 'but it must name the variables involved');
  });

  it('flags a Stripe key that works while the webhook secret is missing', async () => {
    const { probe } = probeThat(() => ({ status: 200 }));
    const report = await runLaunchChecks({
      env: { ...BASE_ENV, STRIPE_SECRET_KEY: 'sk_test_fixture' },
      probe,
      only: ['provider.payments'],
    });
    const payments = report.checks[0];
    assert.equal(payments.status, 'not_configured', 'a key without webhook signing cannot settle payments');
    assert.match(payments.evidence, /STRIPE_WEBHOOK_SECRET is NOT set/);
    assert.match(payments.evidence, /503/);

    const complete = await runLaunchChecks({
      env: { ...BASE_ENV, STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' },
      probe,
      only: ['provider.payments'],
    });
    assert.equal(complete.checks[0].status, 'ready');
    assert.match(complete.checks[0].evidence, /webhook signing secret set/);
  });

  it('checks the session secret, the public URL and the checkout return URLs honestly', async () => {
    const { probe } = probeThat(() => ({ status: 200 }));
    const weak = await runLaunchChecks({ env: { NODE_ENV: 'production', SESSION_SECRET: 'short' }, probe, only: ['secret'] });
    assert.equal(weak.checks[0].status, 'failed');
    assert.match(weak.checks[0].evidence, /only 5 characters/);

    const placeholder = await runLaunchChecks({ env: { NODE_ENV: 'production', SESSION_SECRET: 'change-me-in-production' }, probe, only: ['secret'] });
    assert.equal(placeholder.checks[0].status, 'failed');

    const http = await runLaunchChecks({ env: { NODE_ENV: 'production', AKBARAL_SITE_URL: 'http://example.test' }, probe, only: ['domain'] });
    assert.equal(http.checks[0].status, 'failed', 'production must serve HTTPS');
    assert.match(http.checks[0].evidence, /must serve HTTPS/);

    const missingReturn = await runLaunchChecks({ env: { NODE_ENV: 'production' }, probe, only: ['return_urls'] });
    assert.equal(missingReturn.checks[0].status, 'failed', 'without a site URL a paid customer would be sent to a placeholder host');

    const withSite = await runLaunchChecks({ env: BASE_ENV, probe, only: ['return_urls'] });
    assert.equal(withSite.checks[0].status, 'ready');
    assert.match(withSite.checks[0].evidence, /akbaral\.duckdns\.org/);
  });

  it('reports social OAuth preparation per platform with the exact redirect URI to register', async () => {
    const { probe } = probeThat(() => ({ status: 200 }));
    const none = await runLaunchChecks({ env: BASE_ENV, probe, only: ['social'] });
    assert.equal(none.checks[0].status, 'optional', 'publishing is optional, and absence is not a failure');
    assert.match(none.checks[0].evidence, /0 configured; 3 pending/);
    assert.match(none.checks[0].ownerAction ?? '', /api\/social\/oauth\/youtube\/callback/);
    assert.match(none.checks[0].ownerAction ?? '', /TIKTOK_CLIENT_KEY/);

    const one = await runLaunchChecks({ env: { ...BASE_ENV, YOUTUBE_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' }, probe, only: ['social'] });
    assert.equal(one.checks[0].status, 'not_configured');
    assert.match(one.checks[0].evidence, /1 configured; 2 pending/);
  });

  it('computes readiness over required checks only, and never inflates it', async () => {
    const { probe } = probeThat(() => ({ status: 200 }));
    const empty = await runLaunchChecks({ env: { NODE_ENV: 'production' }, probe, cwd: process.cwd() });
    const percent = readinessPercent(empty);
    assert.ok(percent >= 0 && percent < 100, `an unconfigured deployment must not look ready (got ${percent}%)`);
    assert.ok(empty.blockers.length > 0);

    const requiredChecks = empty.checks.filter((check) => check.required);
    const readyRequired = requiredChecks.filter((check) => check.status === 'ready').length;
    assert.equal(percent, Math.round((readyRequired / requiredChecks.length) * 1000) / 10);
    for (const check of empty.checks.filter((entry) => !entry.required)) {
      assert.ok(check.status !== 'failed' || check.id === 'ops.backups', 'optional absence is never a hard failure');
    }
  });

  it('runs offline without touching the network at all', async () => {
    let probed = false;
    const probe: Probe = async () => {
      probed = true;
      return { status: 200, json: {}, text: '' };
    };
    const report = await runLaunchChecks({
      env: { ...BASE_ENV, GOOGLE_API_KEY: FAKE_KEY, TAVILY_API_KEY: 'tvly-fixture' },
      probe,
      offline: true,
      only: ['provider.gemini', 'provider.search'],
    });
    assert.equal(probed, false, 'offline mode performs configuration checks only');
    for (const check of report.checks) {
      assert.equal(check.status, 'not_configured');
      assert.match(check.evidence, /offline mode/);
    }
  });
});

describe('checkout return URLs', () => {
  const saved = new Map<string, string | undefined>();
  function withEnv(values: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(values)) {
      if (!saved.has(key)) saved.set(key, process.env[key]);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  function restore(): void {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  }

  it('prefers explicit values, then configured URLs, then the site URL — never a local placeholder', () => {
    try {
      withEnv({ AKBARAL_SITE_URL: undefined, AKBARAL_CHECKOUT_SUCCESS_URL: undefined, AKBARAL_CHECKOUT_CANCEL_URL: undefined });
      const defaults = resolveCheckoutUrls();
      assert.equal(defaults.successUrl, 'https://akbaral.duckdns.org/billing/success');
      assert.equal(defaults.cancelUrl, 'https://akbaral.duckdns.org/billing/cancel');
      assert.equal(defaults.configured, false);

      withEnv({ AKBARAL_SITE_URL: 'https://akbaral.example/' });
      const site = resolveCheckoutUrls();
      assert.equal(site.successUrl, 'https://akbaral.example/billing/success', 'trailing slashes are normalized');

      withEnv({ AKBARAL_CHECKOUT_SUCCESS_URL: 'https://akbaral.example/paid' });
      assert.equal(resolveCheckoutUrls().successUrl, 'https://akbaral.example/paid');

      assert.equal(resolveCheckoutUrls({ successUrl: 'https://request.example/ok' }).successUrl, 'https://request.example/ok');
      assert.equal(resolveCheckoutUrls().configured, true);
    } finally {
      restore();
    }
  });
});

describe('social platform definitions', () => {
  it('requests the minimum publishing scopes and builds a correct authorize URL', () => {
    const youtube = SOCIAL_PLATFORMS.find((platform) => platform.id === 'youtube')!;
    assert.ok(youtube.scopes.every((scope) => !/manage|delete|force-ssl/.test(scope)), 'no broader-than-needed scopes');
    const url = new URL(
      buildSocialAuthorizeUrl({
        platform: youtube,
        clientId: 'client-id',
        redirectUri: 'https://akbaral.example/api/social/oauth/youtube/callback',
        state: 'state-value',
        codeChallenge: 'challenge',
      }),
    );
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('state'), 'state-value');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.match(String(url.searchParams.get('scope')), /youtube\.upload/);
    for (const platform of SOCIAL_PLATFORMS) {
      assert.ok(platform.clientIdKeys.length > 0 && platform.clientSecretKeys.length > 0);
      assert.ok(platform.consoleUrl.startsWith('https://'), 'the report tells the owner where to register the app');
      assert.equal(socialRedirectUri('https://akbaral.example/', platform.id), `https://akbaral.example/api/social/oauth/${platform.id}/callback`);
    }
  });

  it('maps Stripe events to internal events without inventing a payment', () => {
    const paid = normalizeStripeEvent({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { object: 'checkout.session', payment_status: 'paid', client_reference_id: 'inv_1', amount_total: 100 } },
    });
    assert.equal(paid.internal, 'invoice.paid');
    // Signature checking is what makes a webhook trustworthy; a signed payload is
    // required, and the launch check tells the owner to configure the secret.
    const signature = computeStripeSignature('{"id":"evt_1"}', 1_700_000_000, 'whsec_fixture');
    assert.match(signature, /^[0-9a-f]{64}$/);
  });
});
