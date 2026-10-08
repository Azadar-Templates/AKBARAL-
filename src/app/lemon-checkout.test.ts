import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();

// Register the module hooks (CSS modules proxy and Next.js link/navigation stubs)
register(pathToFileURL(path.join(root, 'scripts/responsive/module-hooks.mjs')));

test('1. Config exports the store URL + a five-entry variant map', async () => {
  const { LEMON_STORE_URL, LEMON_VARIANT_IDS } = await import('./_lib/lemon-config');

  assert.equal(typeof LEMON_STORE_URL, 'string');
  assert.ok(LEMON_VARIANT_IDS && typeof LEMON_VARIANT_IDS === 'object');

  const keys = Object.keys(LEMON_VARIANT_IDS).sort();
  assert.deepEqual(keys, ['business', 'enterprise', 'pro', 'scale', 'starter'], 'five paid plans');

  for (const key of keys) {
    assert.equal(LEMON_VARIANT_IDS[key], null, `plan ${key} defaults to null`);
  }
});

test('2. lemonCheckoutUrl returns a URL when mapped, null when not', async () => {
  const { lemonCheckoutUrl } = await import('./_lib/lemon-config');

  // Default unmapped state
  assert.equal(lemonCheckoutUrl('starter'), null);
  assert.equal(lemonCheckoutUrl('pro'), null);
  assert.equal(lemonCheckoutUrl('business'), null);
  assert.equal(lemonCheckoutUrl('scale'), null);
  assert.equal(lemonCheckoutUrl('enterprise'), null);
  assert.equal(lemonCheckoutUrl('free'), null);
  assert.equal(lemonCheckoutUrl('non-existent'), null);

  // Variant mapped but store URL empty
  assert.equal(
    lemonCheckoutUrl('pro', { storeUrl: '', variantIds: { pro: 'var_pro_123' } }),
    null,
    'returns null if store URL is empty',
  );

  // Mapped with store URL
  const testStore = 'https://akbaral.lemonsqueezy.com';
  assert.equal(
    lemonCheckoutUrl('pro', { storeUrl: testStore, variantIds: { pro: 'var_pro_123' } }),
    'https://akbaral.lemonsqueezy.com/buy/var_pro_123',
  );

  // Normalizes trailing slash
  assert.equal(
    lemonCheckoutUrl('pro', { storeUrl: `${testStore}/`, variantIds: { pro: 'var_pro_123' } }),
    'https://akbaral.lemonsqueezy.com/buy/var_pro_123',
  );

  // Handles store URLs ending with /buy
  assert.equal(
    lemonCheckoutUrl('starter', { storeUrl: `${testStore}/buy`, variantIds: { starter: 'var_starter_456' } }),
    'https://akbaral.lemonsqueezy.com/buy/var_starter_456',
  );

  // Direct checkout URL variant ID pass-through
  assert.equal(
    lemonCheckoutUrl('scale', { variantIds: { scale: 'https://checkout.lemonsqueezy.com/buy/custom_scale' } }),
    'https://checkout.lemonsqueezy.com/buy/custom_scale',
  );
});

test('3. Landing and /pricing both render the checkout URL for a mapped plan (stub config)', async () => {
  const React = (await import('react')).default;
  const { renderToString } = await import('react-dom/server');
  const { LEMON_VARIANT_IDS } = await import('./_lib/lemon-config');
  const { PublicPricingTable } = await import('./_components/public-pricing');
  const { LandingReset } = await import('./_components/landing-reset');
  const PricingPage = (await import('./pricing/page')).default;

  const stubStore = 'https://akbaral-test.lemonsqueezy.com';
  const prevEnv = process.env.NEXT_PUBLIC_LEMON_STORE_URL;
  const prevPro = LEMON_VARIANT_IDS.pro;

  try {
    process.env.NEXT_PUBLIC_LEMON_STORE_URL = stubStore;
    LEMON_VARIANT_IDS.pro = 'variant_pro_999';

    // 1. Direct PublicPricingTable rendering
    const tableHtml = renderToString(React.createElement(PublicPricingTable));
    assert.match(
      tableHtml,
      /href="https:\/\/akbaral-test\.lemonsqueezy\.com\/buy\/variant_pro_999"/,
      'PublicPricingTable renders mapped URL',
    );
    assert.match(tableHtml, /target="_blank"/);
    assert.match(tableHtml, /rel="noopener noreferrer"/);

    // 2. Landing page (#pricing section)
    const landingHtml = renderToString(React.createElement(LandingReset as React.ComponentType<{ heroVideo?: boolean }>, { heroVideo: false }));
    assert.match(landingHtml, /id="pricing"/);
    assert.match(
      landingHtml,
      /href="https:\/\/akbaral-test\.lemonsqueezy\.com\/buy\/variant_pro_999"/,
      'Landing renders mapped Lemon checkout URL',
    );

    // 3. /pricing page
    const pricingHtml = renderToString(React.createElement(PricingPage));
    assert.match(pricingHtml, /id="pricing"/);
    assert.match(
      pricingHtml,
      /href="https:\/\/akbaral-test\.lemonsqueezy\.com\/buy\/variant_pro_999"/,
      '/pricing renders mapped Lemon checkout URL',
    );
  } finally {
    if (prevEnv !== undefined) {
      process.env.NEXT_PUBLIC_LEMON_STORE_URL = prevEnv;
    } else {
      delete process.env.NEXT_PUBLIC_LEMON_STORE_URL;
    }
    LEMON_VARIANT_IDS.pro = prevPro;
  }
});

test('4. Unmapped plan → honest unavailable state, no dead link', async () => {
  const React = (await import('react')).default;
  const { renderToString } = await import('react-dom/server');
  const { PublicPricingTable } = await import('./_components/public-pricing');

  const html = renderToString(React.createElement(PublicPricingTable));

  // Starter is unmapped by default
  const starterMatch = html.match(/<article[^>]*data-plan="starter"[^>]*>([\s\S]*?)<\/article>/);
  assert.ok(starterMatch, 'starter plan card rendered');
  const starterCard = starterMatch[1];

  // Must have aria-disabled="true" and disabled attribute
  assert.match(starterCard, /aria-disabled="true"/);
  assert.match(starterCard, /disabled/);
  assert.match(starterCard, /Not yet available/);

  // Must NOT have href="#", empty href="", or mock URL
  assert.doesNotMatch(starterCard, /href="#"/);
  assert.doesNotMatch(starterCard, /href=""/);
  assert.doesNotMatch(starterCard, /href="javascript/);
  assert.doesNotMatch(starterCard, /href="https?:\/\/example/);
});

test('5. Free CTA does not point to Lemon', async () => {
  const React = (await import('react')).default;
  const { renderToString } = await import('react-dom/server');
  const { PublicPricingTable } = await import('./_components/public-pricing');
  const { lemonCheckoutUrl } = await import('./_lib/lemon-config');

  const html = renderToString(React.createElement(PublicPricingTable));

  const freeMatch = html.match(/<article[^>]*data-plan="free"[^>]*>([\s\S]*?)<\/article>/);
  assert.ok(freeMatch, 'free plan card rendered');
  const freeCard = freeMatch[1];

  // Free plan CTA points to internal signup/trial
  assert.match(freeCard, /href="\/signup"/);
  assert.match(freeCard, /Start Free Trial/);
  assert.doesNotMatch(freeCard, /lemonsqueezy/i);
  assert.doesNotMatch(freeCard, /target="_blank"/);
  assert.equal(lemonCheckoutUrl('free'), null);
});

test('6. No secret name appears in client-side files', () => {
  function walkFiles(dir: string, ext: string[]): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkFiles(fullPath, ext));
      } else if (ext.some((e) => entry.name.endsWith(e))) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const clientFiles = walkFiles(path.join(root, 'src', 'app'), ['.ts', '.tsx', '.js', '.jsx', '.css']);
  // Exclude test files from literal scan
  const nonTestFiles = clientFiles.filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));

  // Secret token fragments that must NEVER appear in client-side code
  const secretKeyPart = ['LEMON', 'SQUEEZY', 'API', 'KEY'].join('_');
  const secretSigningPart = ['LEMON', 'SQUEEZY', 'SIGNING', 'SECRET'].join('_');

  for (const file of nonTestFiles) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      content,
      new RegExp(`\\b${secretKeyPart}\\b`),
      `${path.relative(root, file)} must not reference ${secretKeyPart}`,
    );
    assert.doesNotMatch(
      content,
      new RegExp(`\\b${secretSigningPart}\\b`),
      `${path.relative(root, file)} must not reference ${secretSigningPart}`,
    );
    assert.doesNotMatch(
      content,
      /NEXT_PUBLIC_.*(?:SECRET|KEY|PASSWORD|TOKEN)/i,
      `${path.relative(root, file)} must not define public secrets`,
    );
  }
});

test('7. Regression: existing pricing contract tests (six plans, exact prices/quotas) still pass', async () => {
  const { AKBARAL_PLANS, PRICING_NOTE } = await import('./_lib/pricing');

  assert.equal(AKBARAL_PLANS.length, 6, 'exactly six plans');

  const expectedPlans = [
    { key: 'free', name: 'Free', price: '$0', tasks: '5 tasks', note: '30-day trial' },
    { key: 'starter', name: 'Starter', price: '$10', tasks: '25 tasks', note: 'Monthly capacity' },
    { key: 'pro', name: 'Pro', price: '$50', tasks: '100 tasks', note: 'Monthly capacity' },
    { key: 'business', name: 'Business', price: '$90', tasks: '250 tasks', note: 'Monthly capacity' },
    { key: 'scale', name: 'Scale', price: '$200', tasks: '750 tasks', note: 'Monthly capacity' },
    { key: 'enterprise', name: 'Enterprise', price: '$400', tasks: '2,000 tasks', note: 'Monthly capacity' },
  ];

  for (let i = 0; i < expectedPlans.length; i++) {
    const expected = expectedPlans[i];
    const actual = AKBARAL_PLANS[i];
    assert.equal(actual.key, expected.key, `plan ${i} key`);
    assert.equal(actual.name, expected.name, `plan ${i} name`);
    assert.equal(actual.price, expected.price, `plan ${i} price`);
    assert.equal(actual.tasks, expected.tasks, `plan ${i} tasks`);
    assert.equal(actual.note, expected.note, `plan ${i} note`);
  }

  assert.equal(
    PRICING_NOTE,
    'All prices are USD. Work task credits are consumed only when a task completes successfully.',
  );
});
