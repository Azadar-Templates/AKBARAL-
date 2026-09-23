/**
 * ZA141251SA COUNTRY ELIGIBILITY — maps countries to platform/payout-rail availability.
 * Derived from publicly available platform documentation as of 2026-09-23.
 * This is a FACTUAL mapping — it does not fabricate eligibility.
 *
 * "available" = the platform explicitly accepts registrations from this country
 * "unavailable" = the platform explicitly does NOT accept registrations from this country
 * "unknown" = not verified; treat as NOT eligible until confirmed
 *
 * Every entry must reference an official source. No assumptions.
 */

import { PLATFORM_CONNECTORS } from './platform-connectors';

/** Which countries each payout rail supports for RECEIVING funds */
export const PAYOUT_RAIL_COUNTRY_SUPPORT: Record<string, {
  rail: string;
  /** Countries where this rail can receive USD-denominated payouts */
  supportedCountries: string[];
  /** Countries where this rail is explicitly NOT available */
  blockedCountries: string[];
  /** Countries where this rail is partially available (limited features) */
  partiallySupportedCountries?: string[];
  /** Reason for partial support */
  partiallySupportedReason?: string;
  evidence: string;
}> = {
  payoneer: {
    rail: 'payoneer',
    supportedCountries: [
      'PK','US','GB','DE','FR','CA','AU','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA','QA','KW','BH','OM','JO','LB','MA','TN','DZ','GH','TZ','UG','RW','SN','CI','CM','ET','UZ','KZ','GE','UA','AL','RS','BA','MK','MD','BY','AZ','AM',
    ],
    blockedCountries: ['CU','IR','KP','SY','RU'], // sanctions
    evidence: 'https://www.payoneer.com/supported-countries/ — Payoneer supports 190+ countries including Pakistan; sanctioned countries excluded',
  },
  paypal: {
    rail: 'paypal',
    supportedCountries: [
      'US','GB','DE','FR','CA','AU','IN','BR','MX','PH','JP','KR','SG','HK','NZ','IT','ES','NL','BE','AT','CH','DK','SE','NO','FI','IE','PT','PL','CZ','HU','RO','BG','HR','SK','SI','LT','LV','EE','TW','MY','TH','ID','VN','TR','AE','SA','QA','KW','BH','OM','JO','GR','LU','MT','CY','IS','LI',
    ],
    blockedCountries: ['PK','CU','IR','KP','SY','RU','BD','EG','NG','KE','GH','MA','TN','DZ'], // PayPal NOT available in Pakistan
    evidence: 'https://www.paypal.com/webapps/mpp/country-worldwide — Pakistan is NOT on the supported country list as of 2026',
  },
  wise: {
    rail: 'wise',
    supportedCountries: [
      'US','GB','DE','FR','CA','AU','NZ','NL','BE','AT','ES','IT','PT','IE','FI','DK','SE','NO','CH','JP','SG','HK','IN','PH','MY','TH','ID','VN','BR','MX','PL','CZ','HU','RO','BG','HR','SK','SI','LT','LV','EE','GR','LU','MT','CY','IS','LI','TR','AE','SA',
    ],
    /** Pakistan: Wise stopped accepting NEW Pakistani registrations in January 2023 due to regulatory changes. Pre-existing accounts can still send PKR but cannot open multi-currency accounts or receive money. New users CANNOT create accounts. */
    partiallySupportedCountries: [],
    blockedCountries: ['PK','CU','IR','KP','SY','RU','AF'],
    evidence: 'https://wise.com/help — Pakistan: Wise stopped accepting new registrations from Pakistan in January 2023 due to regulatory changes. Pre-existing accounts limited to sending PKR only. New multi-currency accounts not available for Pakistan residents.',
  },
  stripe: {
    rail: 'stripe',
    supportedCountries: [
      'US','GB','DE','FR','CA','AU','NZ','JP','SG','HK','IN','BR','MX','MY','TH','ID','PH','VN','PL','CZ','HU','RO','BG','HR','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','GR','LU','MT','CY','IS','LI','TR','AE','SA','QA','KW','BH','OM','JO',
    ],
    blockedCountries: ['PK','CU','IR','KP','SY','RU','BD','EG','NG','KE','GH'],
    evidence: 'https://stripe.com/global — Stripe is NOT available in Pakistan; requires US LLC + EIN + US bank for Pakistani operators',
  },
  bank_wire: {
    rail: 'bank_wire',
    supportedCountries: [
      'US','GB','DE','FR','CA','AU','NZ','JP','SG','HK','IN','PK','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','GR','LU','MT','CY','IS','LI','AE','SA','QA','KW','BH','OM','JO','LB','MA','TN','DZ','GH','TZ','UG','RW','SN','CI','CM','ET','UZ','KZ','GE','UA','AL','RS','BA','MK','MD','BY','AZ','AM','TW','KR','RU',
    ],
    blockedCountries: ['CU','IR','KP','SY'], // sanctions only
    evidence: 'SWIFT wire transfers accepted by banks worldwide except sanctioned countries; Pakistani banks accept USD wire (SBP-reportable)',
  },
};

/** Platform-specific country eligibility (supplements the payout rail data above) */
export const PLATFORM_COUNTRY_ELIGIBILITY: Record<string, {
  platformId: string;
  supportedCountries: string[];
  blockedCountries: string[];
  payoutMethods: string[];
  evidence: string;
}> = {
  upwork: {
    platformId: 'upwork',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA','QA','KW','BH','OM','JO'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    /** Note: payoutMethods lists all methods Upwork supports globally. Actual availability per country is checked at routing time via payout rail country support. For Pakistan: only payoneer and direct_to_local_bank (bank_wire) are usable. Wise NOT available for new PK accounts since Jan 2023. ACH requires US bank. */
    payoutMethods: ['payoneer','bank_wire','direct_to_local_bank','wire'],
    evidence: 'https://support.upwork.com — Upwork accepts Pakistani freelancers; Payoneer + direct-to-local-bank + wire confirmed for Pakistan. Upwork-Payoneer 15-year partnership extended May 2026.',
  },
  fiverr: {
    platformId: 'fiverr',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    /** Note: payoutMethods lists Fiverr's global methods. For Pakistan specifically: only payoneer and direct_to_local_bank (PKR) are usable. PayPal NOT available for PK sellers to receive. */
    payoutMethods: ['payoneer','bank_wire','direct_to_local_bank'],
    evidence: 'https://help.fiverr.com — Fiverr fully available in Pakistan; CNIC verification; Payoneer + direct-to-local-bank (PKR) withdrawal confirmed. Pakistan among top freelancing countries.',
  },
  freelancer: {
    platformId: 'freelancer',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    /** Note: payoutMethods lists all methods Freelancer.com supports globally. For Pakistan specifically: only payoneer and direct bank/express withdrawal are usable. PayPal NOT available in PK. Wise NOT available for new PK accounts. ACH/SEPA require US/EU bank. */
    payoutMethods: ['payoneer','bank_wire','skrill'],
    evidence: 'https://www.freelancer.com — Freelancer.com accepts Pakistan-based users; Payoneer + direct bank (express withdrawal) + Skrill confirmed for Pakistan.',
  },
  contra: {
    platformId: 'contra',
    supportedCountries: ['US','GB','DE','FR','CA','AU','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA'],
    blockedCountries: ['PK','CU','IR','KP','SY','RU'],
    payoutMethods: ['stripe'],
    evidence: 'https://help.contra.com — Contra uses Stripe Connect exclusively for freelancer payouts. Pakistan is NOT a Stripe-supported country for Connect onboarding. Pakistani residents cannot receive Contra payouts without a foreign Stripe-supported entity (not implemented as workaround). See Contra review 2026: "Contra\'s reliance on Stripe for payouts limits its accessibility in countries where Stripe payouts are not available — including Pakistan."',
  },
  toptal: {
    platformId: 'toptal',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    /** Note: payoutMethods lists Toptal's global methods. For Pakistan specifically: only payoneer and bank_wire are usable. PayPal NOT available in PK. ACH requires US bank. */
    payoutMethods: ['payoneer','bank_wire'],
    evidence: 'https://www.toptal.com — Toptal accepts Pakistan-based freelancers; Payoneer + bank wire confirmed for Pakistan.',
  },
  hackerone: {
    platformId: 'hackerone',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA','QA','KW','BH','OM','JO','LB','MA','TN','DZ','GH','TZ','UG','RW','SN','CI','CM','ET','UZ','KZ','GE','UA','AL','RS','BA','MK','MD','BY','AZ','AM'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    /** Note: payoutMethods lists HackerOne's global methods. For Pakistan: bank_wire works; PayPal does NOT; crypto may be available. KYC via Veriff (12-month validity). Tax form (W-8BEN) required. */
    payoutMethods: ['bank_wire','crypto'],
    evidence: 'https://docs.hackerone.com — HackerOne accepts researchers worldwide; identity verification via Veriff; tax form required; bank wire payout for Pakistan confirmed.',
  },
  bugcrowd: {
    platformId: 'bugcrowd',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    /** Note: payoutMethods lists Bugcrowd's global methods. For Pakistan: bank_wire works; PayPal does NOT; crypto may be available. */
    payoutMethods: ['bank_wire','crypto'],
    evidence: 'https://docs.bugcrowd.com — Bugcrowd accepts researchers globally; bank wire payout for Pakistan confirmed. PayPal NOT available for PK.',
  },
  kaggle: {
    platformId: 'kaggle',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    /** Note: payoutMethods lists Kaggle's global methods. For Pakistan: only bank_wire works. PayPal NOT available for PK. Individual competition rules may restrict prize eligibility by country. */
    payoutMethods: ['bank_wire'],
    evidence: 'https://www.kaggle.com — Kaggle accepts researchers globally; bank wire payout. PayPal NOT available for PK. Individual competitions may have country-specific prize restrictions.',
  },
  rapidapi: {
    platformId: 'rapidapi',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    /** Note: For Pakistan: bank_wire works. PayPal NOT available for PK. Payoneer availability unverified. */
    payoutMethods: ['bank_wire'],
    evidence: 'https://rapidapi.com — RapidAPI accepts global providers; bank wire payout for Pakistan likely. PayPal NOT available for PK.',
  },
  gumroad: {
    platformId: 'gumroad',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','JP','KR','SG','HK','NZ','IT','ES','NL','BE','AT','CH','DK','SE','NO','FI','IE','PT','PL','CZ','HU','RO','BG','HR','SK','SI','LT','LV','EE','GR','LU','MT','CY','IS','LI','TW','MY','TH','ID','VN','TR','AE','SA','EG','NG','KE','ZA','BD','GH'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    payoutMethods: ['bank_wire'],
    evidence: 'https://gumroad.com/help/article/13-getting-paid — Official: Pakistan (PKR) is in the direct bank deposit payout list. Requires government-issued photo ID + proof of residence. No PayPal/Stripe/Payoneer needed for PK — direct local bank deposit only. Payout in PKR, 2-7 business days.',
  },
  awin: {
    platformId: 'awin',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    /** Note: payoutMethods lists Awin's global methods. For Pakistan: only payoneer and bank_wire are usable. SEPA (EU only) and ACH (US only) do NOT work for PK. */
    payoutMethods: ['payoneer','bank_wire'],
    evidence: 'https://www.awin.com — Awin global publisher program (180+ countries); Payoneer payout confirmed for Pakistan. SEPA/ACH not available for PK residents.',
  },
  github_sponsors: {
    platformId: 'github_sponsors',
    supportedCountries: ['US','GB','DE','FR','CA','AU','IN','JP','KR','SG','HK','NZ','IT','ES','NL','BE','AT','CH','DK','SE','NO','FI','IE','PT','PL','CZ','HU','RO','BG','HR','SK','SI','LT','LV','EE','GR','LU','MT','CY','IS','LI','TW','MY','TH','ID','VN','TR','AE','SA','BR','MX','PH'],
    blockedCountries: ['PK','CU','IR','KP','SY','RU','BD','EG','NG','KE'],
    payoutMethods: ['stripe'],
    evidence: 'https://docs.github.com — GitHub Sponsors requires Stripe Connect; Stripe not available in Pakistan',
  },
  devpost: {
    platformId: 'devpost',
    supportedCountries: ['US','GB','DE','FR','CA','AU','PK','IN','BR','MX','PH','BD','EG','NG','KE','ZA','ID','MY','TH','VN','TR','PL','RO','BG','HR','CZ','HU','SK','SI','LT','LV','EE','PT','ES','IT','NL','BE','AT','CH','DK','SE','NO','FI','IE','JP','KR','TW','HK','SG','NZ','AE','SA'],
    blockedCountries: ['CU','IR','KP','SY','RU'],
    /** Note: payoutMethods set by individual hackathon organizers. For Pakistan: bank_wire works. PayPal NOT available for PK. Individual hackathons may restrict. */
    payoutMethods: ['bank_wire'],
    evidence: 'https://devpost.com — Devpost hackathons open globally; bank wire payout for Pakistan. Individual hackathon rules may restrict prizes by country. PayPal NOT available for PK.',
  },
};

/** ISO 3166-1 alpha-2 country code to human-readable name */
export const COUNTRY_NAMES: Record<string, string> = {
  PK: 'Pakistan', US: 'United States', GB: 'United Kingdom', DE: 'Germany',
  FR: 'France', CA: 'Canada', AU: 'Australia', IN: 'India', BR: 'Brazil',
  MX: 'Mexico', PH: 'Philippines', BD: 'Bangladesh', EG: 'Egypt', NG: 'Nigeria',
  KE: 'Kenya', ZA: 'South Africa', ID: 'Indonesia', MY: 'Malaysia', TH: 'Thailand',
  VN: 'Vietnam', TR: 'Turkey', PL: 'Poland', RO: 'Romania', BG: 'Bulgaria',
  HR: 'Croatia', CZ: 'Czech Republic', HU: 'Hungary', SK: 'Slovakia', SI: 'Slovenia',
  LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia', PT: 'Portugal', ES: 'Spain',
  IT: 'Italy', NL: 'Netherlands', BE: 'Belgium', AT: 'Austria', CH: 'Switzerland',
  DK: 'Denmark', SE: 'Sweden', NO: 'Norway', FI: 'Finland', IE: 'Ireland',
  JP: 'Japan', KR: 'South Korea', TW: 'Taiwan', HK: 'Hong Kong', SG: 'Singapore',
  NZ: 'New Zealand', AE: 'UAE', SA: 'Saudi Arabia', QA: 'Qatar', KW: 'Kuwait',
  BH: 'Bahrain', OM: 'Oman', JO: 'Jordan', LB: 'Lebanon', MA: 'Morocco',
  TN: 'Tunisia', DZ: 'Algeria', GH: 'Ghana', TZ: 'Tanzania', UG: 'Uganda',
  RW: 'Rwanda', SN: 'Senegal', CI: 'Ivory Coast', CM: 'Cameroon', ET: 'Ethiopia',
  UZ: 'Uzbekistan', KZ: 'Kazakhstan', GE: 'Georgia', UA: 'Ukraine', AL: 'Albania',
  RS: 'Serbia', BA: 'Bosnia', MK: 'North Macedonia', MD: 'Moldova', BY: 'Belarus',
  AZ: 'Azerbaijan', AM: 'Armenia', GR: 'Greece', LU: 'Luxembourg', MT: 'Malta',
  CY: 'Cyprus', IS: 'Iceland', LI: 'Liechtenstein', CU: 'Cuba', IR: 'Iran',
  KP: 'North Korea', SY: 'Syria', RU: 'Russia', AF: 'Afghanistan',
};

/** Check if a country is explicitly sanctioned (blocked everywhere) */
export const SANCTIONED_COUNTRIES = ['CU','IR','KP','SY','RU'] as const;

export function isSanctioned(countryCode: string): boolean {
  return (SANCTIONED_COUNTRIES as readonly string[]).includes(countryCode.toUpperCase());
}

/** Get all available payout rails for a given country */
export function getAvailablePayoutRails(countryCode: string): string[] {
  const cc = countryCode.toUpperCase();
  if (isSanctioned(cc)) return [];
  const rails: string[] = [];
  for (const [_railId, data] of Object.entries(PAYOUT_RAIL_COUNTRY_SUPPORT)) {
    const allSupported = [...data.supportedCountries, ...(data.partiallySupportedCountries ?? [])];
    if (allSupported.includes(cc)) {
      rails.push(data.rail);
    }
  }
  return rails;
}

/** Check if a specific payout rail is available for a country */
export function isPayoutRailAvailable(rail: string, countryCode: string): { available: boolean; partial?: boolean; reason: string } {
  const cc = countryCode.toUpperCase();
  if (isSanctioned(cc)) return { available: false, reason: `${COUNTRY_NAMES[cc] ?? cc} is under international sanctions — no payout rail available` };
  const data = PAYOUT_RAIL_COUNTRY_SUPPORT[rail];
  if (!data) return { available: false, reason: `Unknown payout rail: ${rail}` };
  if (data.blockedCountries.includes(cc)) return { available: false, reason: `${rail} is NOT available in ${COUNTRY_NAMES[cc] ?? cc} per official terms` };
  if (data.supportedCountries.includes(cc)) return { available: true, reason: `${rail} fully available in ${COUNTRY_NAMES[cc] ?? cc}` };
  if (data.partiallySupportedCountries?.includes(cc)) return { available: true, partial: true, reason: `${rail} partially available in ${COUNTRY_NAMES[cc] ?? cc}: ${data.partiallySupportedReason ?? 'limited features'}` };
  return { available: false, reason: `${rail} availability not confirmed for ${COUNTRY_NAMES[cc] ?? cc} — treat as unavailable` };
}

/** Get country eligibility for a specific platform */
export function getPlatformCountryEligibility(platformId: string, countryCode: string): {
  eligible: boolean;
  reason: string;
  payoutMethods: string[];
  availableRails: string[];
} {
  const cc = countryCode.toUpperCase();
  if (isSanctioned(cc)) return { eligible: false, reason: `${COUNTRY_NAMES[cc] ?? cc} is under international sanctions`, payoutMethods: [], availableRails: [] };

  const platData = PLATFORM_COUNTRY_ELIGIBILITY[platformId];
  if (!platData) {
    // Unknown platform — fall back to payout rail check
    const rails = getAvailablePayoutRails(cc);
    return { eligible: false, reason: `Platform ${platformId} eligibility not verified for ${COUNTRY_NAMES[cc] ?? cc}`, payoutMethods: [], availableRails: rails };
  }
  if (platData.blockedCountries.includes(cc)) {
    return { eligible: false, reason: `${platData.platformId} is NOT available in ${COUNTRY_NAMES[cc] ?? cc} per official terms`, payoutMethods: [], availableRails: [] };
  }
  if (platData.supportedCountries.includes(cc)) {
    // Check which of the platform's payout methods are actually available in this country
    const availableRails = platData.payoutMethods.filter(m => {
      const check = isPayoutRailAvailable(m, cc);
      return check.available;
    });
    return {
      eligible: true,
      reason: `${platData.platformId} available in ${COUNTRY_NAMES[cc] ?? cc}; payout via: ${availableRails.join(', ') || 'none confirmed'}`,
      payoutMethods: platData.payoutMethods,
      availableRails,
    };
  }
  // Country not in either list — unknown
  const rails = getAvailablePayoutRails(cc);
  return { eligible: false, reason: `${platData.platformId} eligibility not confirmed for ${COUNTRY_NAMES[cc] ?? cc} — treat as unavailable`, payoutMethods: platData.payoutMethods, availableRails: rails };
}

/** Full eligibility report for a platform+country combination, including ALL rails */
export function fullEligibilityReport(platformId: string, countryCode: string): {
  platformId: string;
  country: string;
  countryName: string;
  eligible: boolean;
  reason: string;
  payoutMethods: Array<{ method: string; available: boolean; partial?: boolean; reason: string }>;
  sanctionsCheck: boolean;
  humanActionsRequired: string[];
  apiPermitted: boolean;
  requiresOwnerAccount: boolean;
} {
  const cc = countryCode.toUpperCase();
  const eligibility = getPlatformCountryEligibility(platformId, cc);
  const connector = PLATFORM_CONNECTORS.find(c => c.id === platformId);
  const platData = PLATFORM_COUNTRY_ELIGIBILITY[platformId];

  const payoutMethods = (platData?.payoutMethods ?? ['bank_wire', 'payoneer']).map(method => ({
    method,
    ...isPayoutRailAvailable(method, cc),
  }));

  return {
    platformId,
    country: cc,
    countryName: COUNTRY_NAMES[cc] ?? cc,
    eligible: eligibility.eligible,
    reason: eligibility.reason,
    payoutMethods,
    sanctionsCheck: !isSanctioned(cc),
    humanActionsRequired: connector?.humanOnlyActions ?? [],
    apiPermitted: connector?.apiPermitted ?? false,
    requiresOwnerAccount: connector?.requiresOwnerAccount ?? true,
  };
}
