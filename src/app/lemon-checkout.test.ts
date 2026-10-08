/**
 * Lemon Squeezy checkout UI contract.
 *
 * Verifies the public pricing CTAs route paid plans to Lemon Squeezy checkout
 * links from the single shared config, keep Free on the in-app trial, and show
 * an honest unavailable state (never a dead link) for unmapped plans. Renders
 * the REAL PublicPricingTable component — no hand-written fixture markup.
 *
 * This is UI-only: no API client, no webhook, and no secret name may appear
 * in any client-side file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

import {
  LEMON_STORE_URL,
  LEMON_VARIANT_IDS,
  buildLemonCheckoutUrl,
  lemonCheckoutUrl,
  resolveLemonStoreUrl,
} from './_lib/lemon-config';
import { AKBARAL_PLANS } from './_lib/pricing';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

// Register the audit-harness module hooks (CSS modules → class-name proxy,
// next/link → plain anchor) so the real .tsx component can be imported here.
register(pathToFileURL(path.join(root, 'scripts/responsive/module-hooks.mjs')).href);

const PAID_KEYS = AKBARAL_PLANS.filter((plan) => plan.key !== 'free').map((plan) => plan.key);

async function renderTable(checkoutUrl?: (planKey: string) => string | null): Promise<string> {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { PublicPricingTable } = await import('./_components/public-pricing');
  return renderToStaticMarkup(
    React.createElement(PublicPricingTable, checkoutUrl ? { checkoutUrl } : {}),
  );
}

/** Split rendered table markup into one segment per plan card. */
function planSegments(html: string): Record<string, string> {
  const segments: Record<string, string> = {};
  for (const chunk of html.split('<article').slice(1)) {
    const key = chunk.match(/data-plan="([^"]+)"/)?.[1];
    if (key) segments[key] = chunk;
  }
  return segments;
}

/* ------------------------------------------------------------------ */
/* 1. Config contract                                                  */
/* ------------------------------------------------------------------ */

test('lemon config exports a store URL and exactly the five paid plan variant entries', () => {
  assert.equal(typeof LEMON_STORE_URL, 'string');
  assert.deepEqual(
    Object.keys(LEMON_VARIANT_IDS).sort(),
    [...PAID_KEYS].sort(),
    'variant map covers exactly the paid plans from pricing.ts, keyed by plan key',
  );
  assert.equal(Object.keys(LEMON_VARIANT_IDS).length, 5);
  for (const [key, value] of Object.entries(LEMON_VARIANT_IDS)) {
    assert.ok(value === null || (typeof value === 'string' && value.trim().length > 0), `${key} is null or a non-empty variant id`);
  }
  assert.ok(!PAID_KEYS.includes('free') && !('free' in LEMON_VARIANT_IDS), 'Free is never a Lemon plan');
});

test('store URL reads optional NEXT_PUBLIC_LEMON_STORE_URL and falls back to the compiled value', () => {
  const original = process.env.NEXT_PUBLIC_LEMON_STORE_URL;
  try {
    process.env.NEXT_PUBLIC_LEMON_STORE_URL = '  https://store-from-env.test/  ';
    assert.equal(resolveLemonStoreUrl(), 'https://store-from-env.test/', 'env value wins, trimmed');
    delete process.env.NEXT_PUBLIC_LEMON_STORE_URL;
    assert.equal(resolveLemonStoreUrl(), (LEMON_STORE_URL ?? '').trim(), 'falls back to compiled value when env absent');
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_LEMON_STORE_URL;
    else process.env.NEXT_PUBLIC_LEMON_STORE_URL = original;
  }
});

/* ------------------------------------------------------------------ */
/* 2. URL builder                                                      */
/* ------------------------------------------------------------------ */

test('buildLemonCheckoutUrl returns the store checkout URL when mapped and null when not', () => {
  const config = {
    storeUrl: 'https://akbaral.lemonsqueezy.com/',
    variantIds: { starter: '111', pro: '222', business: null, scale: null, enterprise: null },
  };
  assert.equal(buildLemonCheckoutUrl('pro', config), 'https://akbaral.lemonsqueezy.com/buy/222');
  assert.equal(buildLemonCheckoutUrl('business', config), null, 'mapped key with null variant is null');
  assert.equal(buildLemonCheckoutUrl('free', config), null, 'free is never mapped');
  assert.equal(buildLemonCheckoutUrl('unknown-plan', config), null, 'unknown plan is null');
  assert.equal(
    buildLemonCheckoutUrl('pro', { storeUrl: '', variantIds: config.variantIds }),
    null,
    'no store URL means no checkout URL',
  );
});

test('lemonCheckoutUrl with live config never invents a URL for unmapped plans', () => {
  for (const key of ['free', ...PAID_KEYS]) {
    const url = lemonCheckoutUrl(key);
    if (LEMON_VARIANT_IDS[key] && LEMON_STORE_URL) {
      assert.equal(url, `${LEMON_STORE_URL.replace(/\/+$/, '')}/buy/${LEMON_VARIANT_IDS[key]}`);
    } else {
      assert.equal(url, null, `${key} is unmapped in the live config, so it must be null`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* 3–5. Rendered CTAs (real component, stubbed config)                 */
/* ------------------------------------------------------------------ */

test('landing #pricing and /pricing share the one table and its checkout config', async () => {
  // Source contract: both surfaces render the shared table with no override,
  // so the stubbed render below is exactly what both pages deliver.
  assert.match(read('src/app/_components/landing-reset.tsx'), /<PublicPricingTable \/>/);
  assert.match(read('src/app/pricing/page.tsx'), /<PublicPricingTable \/>/);
  assert.doesNotMatch(read('src/app/_components/landing-reset.tsx'), /PublicPricingTable[^/]*checkoutUrl=/);
  assert.doesNotMatch(read('src/app/pricing/page.tsx'), /PublicPricingTable[^/]*checkoutUrl=/);

  const stub = (key: string) => (key === 'pro' ? 'https://akbaral.lemonsqueezy.com/buy/stub-pro-variant' : null);
  const html = await renderTable(stub);
  const segments = planSegments(html);
  assert.equal(Object.keys(segments).length, 6, 'all six plans render');
  assert.match(segments.pro, /href="https:\/\/akbaral\.lemonsqueezy\.com\/buy\/stub-pro-variant"/);
  assert.match(segments.pro, /target="_blank"/);
  assert.match(segments.pro, /rel="noopener noreferrer"/);
  assert.match(segments.pro, /data-lemon-checkout="pro"/);
});

test('an unmapped paid plan renders an honest unavailable state, never a dead link', async () => {
  const html = await renderTable(() => null);
  const segments = planSegments(html);
  for (const key of PAID_KEYS) {
    assert.match(segments[key], /data-lemon-unavailable/, `${key} is marked unavailable`);
    assert.match(segments[key], /aria-disabled="true"/, `${key} exposes aria-disabled`);
    assert.match(segments[key], /disabled/, `${key} is genuinely non-interactive`);
    assert.match(segments[key], /Not yet available/, `${key} states the truth`);
    assert.doesNotMatch(segments[key], /<a\b/, `${key} renders no anchor at all`);
  }
  assert.doesNotMatch(html, /href="#"/, 'no hash dead links anywhere in the table');
  assert.doesNotMatch(html, /href=""/, 'no empty hrefs anywhere in the table');
  assert.doesNotMatch(html, /lemonsqueezy/, 'no fabricated checkout URLs when nothing is mapped');
});

test('the Free CTA keeps the in-app trial and never points to Lemon', async () => {
  const stub = (key: string) => (key === 'pro' ? 'https://akbaral.lemonsqueezy.com/buy/stub-pro-variant' : null);
  const html = await renderTable(stub);
  const segments = planSegments(html);
  assert.match(segments.free, /href="\/signup"/, 'Free keeps the in-app trial route');
  assert.match(segments.free, /Start Free Trial/);
  assert.doesNotMatch(segments.free, /lemonsqueezy/i, 'Free never routes to Lemon');
  assert.doesNotMatch(segments.free, /target="_blank"/, 'Free stays in-app');
});

test('default-config render keeps all six plans honest with nothing mapped yet', async () => {
  // Live config: store URL empty and every variant null → no paid plan may
  // link anywhere; Free still works.
  const html = await renderTable();
  assert.doesNotMatch(html, /lemonsqueezy/i);
  assert.doesNotMatch(html, /href="#"/);
  assert.doesNotMatch(html, /href=""/);
  const segments = planSegments(html);
  assert.match(segments.free, /href="\/signup"/);
  for (const key of PAID_KEYS) assert.match(segments[key], /data-lemon-unavailable/);
});

/* ------------------------------------------------------------------ */
/* 6. No secret names in client-side files                             */
/* ------------------------------------------------------------------ */

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

test('no Lemon secret name appears in any client-side file', () => {
  // Assembled so this test file never contains the literal names it forbids.
  const forbidden = ['API_KEY', 'SIGNING_SECRET'].map((suffix) => `LEMON_SQUEEZY_${suffix}`);
  const clientFiles = filesUnder(path.join(root, 'src/app')).filter((file) => /\.(ts|tsx|css|js|mjs)$/.test(file));
  assert.ok(clientFiles.length > 0, 'client tree was actually scanned');
  for (const file of clientFiles) {
    const source = readFileSync(file, 'utf8');
    for (const name of forbidden) {
      assert.ok(!source.includes(name), `${name} must never appear in ${path.relative(root, file)}`);
    }
  }
  // The checkout config stays client-safe: no server-only env module import.
  assert.doesNotMatch(read('src/app/_lib/lemon-config.ts'), /from '.*config\/env'/);
});
