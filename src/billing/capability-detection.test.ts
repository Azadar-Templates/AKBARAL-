import { it, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getPaymentCapabilities, canUpgrade, resolveCheckoutProvider } from '../billing/capability-detection';

describe('payment capability detection — no provider configured', () => {
  it('reports no provider configured when no env vars set', () => {
    // Save and clear any existing credentials
    const savedStripe = process.env.STRIPE_SECRET_KEY;
    const savedRazorpayKey = process.env.RAZORPAY_KEY_ID;
    const savedRazorpaySecret = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    try {
      const caps = getPaymentCapabilities();
      assert.equal(caps.paidCheckoutAvailable, false, 'No checkout when no provider configured');
      assert.equal(caps.creditPurchaseAvailable, false);
      assert.equal(caps.readyProviders.length, 0);
      assert.equal(caps.unavailableProviders.length, 2); // stripe + razorpay
      assert.equal(caps.freeTierAvailable, true);
      assert.equal(caps.invoiceGenerationAvailable, true);
      assert.match(caps.message, /no payment provider/i);

      // Verify no secrets are exposed
      const capsStr = JSON.stringify(caps);
      assert.ok(!capsStr.includes('sk_'), 'Should not expose Stripe secret key');
      assert.ok(!capsStr.includes('rzp_'), 'Should not expose Razorpay key');
    } finally {
      // Restore
      if (savedStripe) process.env.STRIPE_SECRET_KEY = savedStripe;
      if (savedRazorpayKey) process.env.RAZORPAY_KEY_ID = savedRazorpayKey;
      if (savedRazorpaySecret) process.env.RAZORPAY_KEY_SECRET = savedRazorpaySecret;
    }
  });

  it('canUpgrade returns false when no provider', () => {
    const savedStripe = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    try {
      const result = canUpgrade();
      assert.equal(result.canUpgrade, false);
      assert.equal(result.provider, null);
      assert.match(result.reason, /no payment provider/i);
    } finally {
      if (savedStripe) process.env.STRIPE_SECRET_KEY = savedStripe;
    }
  });

  it('resolveCheckoutProvider returns null when no provider', () => {
    const savedStripe = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    try {
      const provider = resolveCheckoutProvider();
      assert.equal(provider, null);
    } finally {
      if (savedStripe) process.env.STRIPE_SECRET_KEY = savedStripe;
    }
  });
});

describe('payment capability detection — Pakistan merchant', () => {
  it('Stripe is not available for Pakistan merchant even when configured', () => {
    const savedStripe = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_for_capability_check';
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    try {
      const caps = getPaymentCapabilities('PK');
      const stripeCap = caps.providers.find(p => p.provider === 'stripe');
      assert.ok(stripeCap, 'Should have stripe capability entry');
      assert.equal(stripeCap!.configured, true, 'Stripe should be configured');
      assert.equal(stripeCap!.countryEligible, false, 'Stripe should NOT be eligible for Pakistan');
      assert.equal(stripeCap!.checkoutReady, false, 'Stripe checkout should NOT be ready for Pakistan');
      assert.equal(caps.paidCheckoutAvailable, false, 'No checkout available for Pakistan merchant without US LLC');
    } finally {
      if (savedStripe) {
        process.env.STRIPE_SECRET_KEY = savedStripe;
      } else {
        delete process.env.STRIPE_SECRET_KEY;
      }
    }
  });
});

describe('payment capability detection — US merchant with Stripe', () => {
  it('Stripe checkout is ready for US merchant', () => {
    const savedStripe = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_for_capability_check';
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    try {
      const caps = getPaymentCapabilities('US');
      assert.equal(caps.paidCheckoutAvailable, true, 'Checkout should be available for US merchant');
      assert.ok(caps.readyProviders.includes('stripe'));

      const result = canUpgrade('US');
      assert.equal(result.canUpgrade, true);
      assert.equal(result.provider, 'stripe');

      const provider = resolveCheckoutProvider('US');
      assert.equal(provider, 'stripe');
    } finally {
      if (savedStripe) {
        process.env.STRIPE_SECRET_KEY = savedStripe;
      } else {
        delete process.env.STRIPE_SECRET_KEY;
      }
    }
  });
});

describe('payment capability detection — India merchant with Razorpay', () => {
  it('Razorpay is ready for India merchant', () => {
    const savedKey = process.env.RAZORPAY_KEY_ID;
    const savedSecret = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    process.env.RAZORPAY_KEY_ID = 'rzp_test_fake';
    process.env.RAZORPAY_KEY_SECRET = 'fake_secret';

    try {
      const caps = getPaymentCapabilities('IN');
      assert.equal(caps.paidCheckoutAvailable, true);
      assert.ok(caps.readyProviders.includes('razorpay'));

      const provider = resolveCheckoutProvider('IN');
      assert.equal(provider, 'razorpay');
    } finally {
      if (savedKey) {
        process.env.RAZORPAY_KEY_ID = savedKey;
      } else {
        delete process.env.RAZORPAY_KEY_ID;
      }
      if (savedSecret) {
        process.env.RAZORPAY_KEY_SECRET = savedSecret;
      } else {
        delete process.env.RAZORPAY_KEY_SECRET;
      }
    }
  });

  it('Razorpay is NOT eligible for US merchant', () => {
    const savedKey = process.env.RAZORPAY_KEY_ID;
    const savedSecret = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    process.env.RAZORPAY_KEY_ID = 'rzp_test_fake';
    process.env.RAZORPAY_KEY_SECRET = 'fake_secret';

    try {
      const caps = getPaymentCapabilities('US');
      const razorpayCap = caps.providers.find(p => p.provider === 'razorpay');
      assert.ok(razorpayCap);
      assert.equal(razorpayCap!.countryEligible, false, 'Razorpay should NOT be eligible for US merchant');
      assert.equal(caps.paidCheckoutAvailable, false, 'No checkout for US with only Razorpay');
    } finally {
      if (savedKey) {
        process.env.RAZORPAY_KEY_ID = savedKey;
      } else {
        delete process.env.RAZORPAY_KEY_ID;
      }
      if (savedSecret) {
        process.env.RAZORPAY_KEY_SECRET = savedSecret;
      } else {
        delete process.env.RAZORPAY_KEY_SECRET;
      }
    }
  });
});

describe('payment capability detection — security', () => {
  it('never exposes secret key values in capability response', () => {
    const savedStripe = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_ultra_secret_value_12345';
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    try {
      const caps = getPaymentCapabilities('US');
      const str = JSON.stringify(caps);
      assert.ok(!str.includes('sk_test_ultra_secret_value_12345'), 'Should never expose secret key');
      assert.ok(!str.includes('ultra_secret'), 'Should never expose partial secret');
    } finally {
      if (savedStripe) {
        process.env.STRIPE_SECRET_KEY = savedStripe;
      } else {
        delete process.env.STRIPE_SECRET_KEY;
      }
    }
  });
});
