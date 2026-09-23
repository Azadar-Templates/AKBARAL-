import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `country-elig-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'synthetic-country-elig-tests-not-live';
import { after, it, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAvailablePayoutRails,
  isPayoutRailAvailable,
  getPlatformCountryEligibility,
  fullEligibilityReport,
  isSanctioned,
  SANCTIONED_COUNTRIES,
  PAYOUT_RAIL_COUNTRY_SUPPORT,
  PLATFORM_COUNTRY_ELIGIBILITY,
} from './country-eligibility';

const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

describe('country eligibility — sanctions', () => {
  it('sanctioned countries are blocked everywhere', () => {
    for (const cc of SANCTIONED_COUNTRIES) {
      assert.equal(isSanctioned(cc), true, `${cc} should be sanctioned`);
      const rails = getAvailablePayoutRails(cc);
      assert.equal(rails.length, 0, `${cc} should have no payout rails`);
    }
  });

  it('non-sanctioned countries are not flagged', () => {
    assert.equal(isSanctioned('US'), false);
    assert.equal(isSanctioned('PK'), false);
    assert.equal(isSanctioned('GB'), false);
    assert.equal(isSanctioned('IN'), false);
  });
});

describe('country eligibility — payout rails', () => {
  it('Payoneer is available in Pakistan', () => {
    const result = isPayoutRailAvailable('payoneer', 'PK');
    assert.equal(result.available, true, 'Payoneer should be available in Pakistan');
  });

  it('PayPal is NOT available in Pakistan', () => {
    const result = isPayoutRailAvailable('paypal', 'PK');
    assert.equal(result.available, false, 'PayPal should NOT be available in Pakistan');
    assert.match(result.reason, /NOT available/i);
  });

  it('Stripe is NOT available in Pakistan', () => {
    const result = isPayoutRailAvailable('stripe', 'PK');
    assert.equal(result.available, false, 'Stripe should NOT be available in Pakistan');
    assert.match(result.reason, /NOT available/i);
  });

  it('Wise is partially available in Pakistan', () => {
    const result = isPayoutRailAvailable('wise', 'PK');
    assert.equal(result.available, true, 'Wise should be partially available in Pakistan');
    assert.equal(result.partial, true, 'Wise should be marked as partial in Pakistan');
  });

  it('bank_wire is available in Pakistan', () => {
    const result = isPayoutRailAvailable('bank_wire', 'PK');
    assert.equal(result.available, true, 'Bank wire should be available in Pakistan');
  });

  it('PayPal is available in US', () => {
    const result = isPayoutRailAvailable('paypal', 'US');
    assert.equal(result.available, true);
  });

  it('Stripe is available in US', () => {
    const result = isPayoutRailAvailable('stripe', 'US');
    assert.equal(result.available, true);
  });

  it('Stripe is available in India', () => {
    const result = isPayoutRailAvailable('stripe', 'IN');
    assert.equal(result.available, true);
  });

  it('unknown rail returns not available', () => {
    const result = isPayoutRailAvailable('nonexistent', 'US');
    assert.equal(result.available, false);
    assert.match(result.reason, /unknown/i);
  });

  it('unconfirmed country returns not available', () => {
    const result = isPayoutRailAvailable('stripe', 'XX');
    assert.equal(result.available, false);
  });
});

describe('country eligibility — platform-specific', () => {
  it('Upwork is available in Pakistan', () => {
    const result = getPlatformCountryEligibility('upwork', 'PK');
    assert.equal(result.eligible, true, 'Upwork should be available in Pakistan');
    assert.ok(result.availableRails.length > 0, 'Should have available payout rails');
  });

  it('Fiverr is available in Pakistan', () => {
    const result = getPlatformCountryEligibility('fiverr', 'PK');
    assert.equal(result.eligible, true, 'Fiverr should be available in Pakistan');
  });

  it('HackerOne is available in Pakistan', () => {
    const result = getPlatformCountryEligibility('hackerone', 'PK');
    assert.equal(result.eligible, true);
  });

  it('Gumroad is NOT available in Pakistan', () => {
    const result = getPlatformCountryEligibility('gumroad', 'PK');
    assert.equal(result.eligible, false, 'Gumroad should NOT be available in Pakistan');
  });

  it('GitHub Sponsors is NOT available in Pakistan (needs Stripe)', () => {
    const result = getPlatformCountryEligibility('github_sponsors', 'PK');
    assert.equal(result.eligible, false, 'GitHub Sponsors should NOT be available in Pakistan');
  });

  it('sanctioned country is blocked on all platforms', () => {
    const result = getPlatformCountryEligibility('upwork', 'IR');
    assert.equal(result.eligible, false);
    assert.match(result.reason, /sanction/i);
  });

  it('unknown platform falls back to payout rail check', () => {
    const result = getPlatformCountryEligibility('unknown_platform_xyz', 'US');
    assert.equal(result.eligible, false, 'Unknown platform should not be eligible by default');
    assert.match(result.reason, /not verified/i);
  });
});

describe('country eligibility — full report', () => {
  it('full report for Upwork + Pakistan shows Payoneer and bank_wire available', () => {
    const report = fullEligibilityReport('upwork', 'PK');
    assert.equal(report.platformId, 'upwork');
    assert.equal(report.country, 'PK');
    assert.equal(report.countryName, 'Pakistan');
    assert.equal(report.eligible, true);
    assert.equal(report.sanctionsCheck, true);

    // Check payout methods (Upwork supports: payoneer, bank_wire, wise, ach)
    const payoneer = report.payoutMethods.find(m => m.method === 'payoneer');
    assert.ok(payoneer, 'Should have payoneer method');
    assert.equal(payoneer!.available, true);

    const bankWire = report.payoutMethods.find(m => m.method === 'bank_wire');
    assert.ok(bankWire, 'Should have bank_wire method');
    assert.equal(bankWire!.available, true);

    const wise = report.payoutMethods.find(m => m.method === 'wise');
    assert.ok(wise, 'Should have wise method');
    assert.equal(wise!.available, true); // Wise partially available in PK

    // Upwork does NOT use stripe for payouts
    assert.equal(report.payoutMethods.length, 4, 'Upwork should have 4 payout methods');
  });

  it('full report for sanctioned country shows all blocked', () => {
    const report = fullEligibilityReport('upwork', 'CU');
    assert.equal(report.eligible, false);
    assert.equal(report.sanctionsCheck, false);
    assert.equal(report.payoutMethods.every(m => !m.available), true);
  });

  it('full report for Upwork + US shows all methods available', () => {
    const report = fullEligibilityReport('upwork', 'US');
    assert.equal(report.eligible, true);
    const available = report.payoutMethods.filter(m => m.available);
    assert.ok(available.length >= 3, `US should have at least 3 available payout methods, got ${available.length}`);
  });
});

describe('country eligibility — data integrity', () => {
  it('all payout rails have evidence strings', () => {
    for (const [rail, data] of Object.entries(PAYOUT_RAIL_COUNTRY_SUPPORT)) {
      assert.ok(data.evidence.length > 10, `${rail} should have evidence`);
      assert.ok(data.supportedCountries.length > 0, `${rail} should have supported countries`);
    }
  });

  it('all platform eligibility entries have evidence', () => {
    for (const [pid, data] of Object.entries(PLATFORM_COUNTRY_ELIGIBILITY)) {
      assert.ok(data.evidence.length > 10, `${pid} should have evidence`);
      assert.ok(data.supportedCountries.length > 0, `${pid} should have supported countries`);
      assert.ok(data.payoutMethods.length > 0, `${pid} should have payout methods`);
    }
  });

  it('all country codes in supported/blocked lists are valid ISO 3166-1 alpha-2', () => {
    for (const [rail, data] of Object.entries(PAYOUT_RAIL_COUNTRY_SUPPORT)) {
      for (const cc of [...data.supportedCountries, ...data.blockedCountries]) {
        assert.match(cc, /^[A-Z]{2}$/, `${rail}: ${cc} is not a valid alpha-2 country code`);
      }
    }
  });

  it('Pakistan is in Payoneer but not PayPal/Stripe', () => {
    assert.ok(PAYOUT_RAIL_COUNTRY_SUPPORT.payoneer.supportedCountries.includes('PK'));
    assert.ok(PAYOUT_RAIL_COUNTRY_SUPPORT.paypal.blockedCountries.includes('PK'));
    assert.ok(PAYOUT_RAIL_COUNTRY_SUPPORT.stripe.blockedCountries.includes('PK'));
  });
});
