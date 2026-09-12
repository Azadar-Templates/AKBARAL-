import { getEconomyPolicy, type EconomyPolicyRow } from '../db/economy-repositories';

/**
 * ZA141251SA economy policy + evaluation engine (pure logic — no I/O).
 *
 * Two hard rules live here:
 *   1. POSITIVE ECONOMICS ONLY: work is authorized when the expected net
 *      profit and ROI clear the owner's thresholds. Never a "jobs per day"
 *      quota — if only 3 legitimate profitable opportunities exist, 3 run.
 *   2. EXTERNAL CONTENT IS DATA, NEVER INSTRUCTIONS: scanExternalContent()
 *      flags instruction-bearing text; flagged opportunities are BLOCKED and
 *      can never influence policy. No external website or agent output can
 *      override ZA141251SA policy.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'prohibited';

export interface PolicySnapshot {
  autonomousEnabled: boolean;
  killSwitch: boolean;
  discoveryEnabled: boolean;
  maxConcurrentExecutions: number;
  maxDailySpendCents: number;
  maxOpportunityCostCents: number;
  minExpectedNetCents: number;
  minRoi: number;
  settlementThresholdCents: number;
  settlementDestination: string;
  maxEconomyAgents: number;
  economyModelKey: string | null;
  discoveryCategories: string[];
}

export function snapshotPolicy(row: EconomyPolicyRow): PolicySnapshot {
  let categories: string[] = [];
  try {
    const parsed = JSON.parse(row.discovery_categories_json || '[]');
    if (Array.isArray(parsed)) categories = parsed.filter((c): c is string => typeof c === 'string');
  } catch {
    categories = [];
  }
  return {
    autonomousEnabled: row.autonomous_enabled === 1,
    killSwitch: row.kill_switch === 1,
    discoveryEnabled: row.discovery_enabled === 1,
    maxConcurrentExecutions: row.max_concurrent_executions,
    maxDailySpendCents: row.max_daily_spend_cents,
    maxOpportunityCostCents: row.max_opportunity_cost_cents,
    minExpectedNetCents: row.min_expected_net_cents,
    minRoi: row.min_roi,
    settlementThresholdCents: row.settlement_threshold_cents,
    settlementDestination: row.settlement_destination,
    maxEconomyAgents: row.max_economy_agents,
    economyModelKey: row.economy_model_key ?? null,
    discoveryCategories: categories,
  };
}

export function currentPolicy(): PolicySnapshot {
  return snapshotPolicy(getEconomyPolicy());
}

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity economics (B: the opportunity engine)
// ─────────────────────────────────────────────────────────────────────────────

export interface OpportunityEconomicsInput {
  expectedRevenueCents: number;
  expectedCostCents: number;
  timeHours: number;
  probability: number; // 0..1 — always an estimate, always labelled
}

export interface OpportunityEconomics {
  expectedGrossCents: number;
  expectedNetCents: number;
  roi: number | null; // null when there is no cost to divide by
  centsPerHour: number | null;
}

export function computeEconomics(input: OpportunityEconomicsInput): OpportunityEconomics {
  const probability = Math.min(1, Math.max(0, input.probability));
  const expectedGrossCents = Math.round(input.expectedRevenueCents * probability);
  const expectedNetCents = expectedGrossCents - input.expectedCostCents;
  const roi = input.expectedCostCents > 0 ? expectedNetCents / input.expectedCostCents : null;
  const centsPerHour = input.timeHours > 0 ? expectedNetCents / input.timeHours : null;
  return { expectedGrossCents, expectedNetCents, roi, centsPerHour };
}

export interface AuthorizationDecision {
  authorized: boolean;
  requiresOwnerApproval: boolean;
  reasons: string[];
}

/**
 * Policy gate for executing an opportunity. Pure: same inputs, same verdict,
 * no external input can sway it (evaluation reads only our own numeric
 * estimates and the owner's thresholds).
 */
export function decideAuthorization(input: {
  policy: PolicySnapshot;
  economics: OpportunityEconomics;
  riskLevel: RiskLevel;
  expectedCostCents: number;
  dailySpendSoFarCents: number;
  flaggedExternalContent: boolean;
}): AuthorizationDecision {
  const reasons: string[] = [];
  let authorized = true;
  let requiresOwnerApproval = false;

  if (input.policy.killSwitch) {
    reasons.push('kill_switch_engaged');
    authorized = false;
  }
  if (input.flaggedExternalContent) {
    reasons.push('external_content_contains_instructions');
    authorized = false;
  }
  if (input.riskLevel === 'prohibited') {
    reasons.push('risk_level_prohibited');
    authorized = false;
  }
  if (input.riskLevel === 'high') {
    reasons.push('high_risk_requires_owner_approval');
    requiresOwnerApproval = true;
  }
  if (input.economics.expectedNetCents < input.policy.minExpectedNetCents) {
    reasons.push(`expected_net_below_threshold (${input.economics.expectedNetCents} < ${input.policy.minExpectedNetCents})`);
    authorized = false;
  }
  if (input.economics.roi !== null && input.economics.roi < input.policy.minRoi) {
    reasons.push(`roi_below_threshold (${input.economics.roi.toFixed(2)} < ${input.policy.minRoi})`);
    authorized = false;
  }
  if (input.expectedCostCents > input.policy.maxOpportunityCostCents) {
    reasons.push(`opportunity_cost_above_cap (${input.expectedCostCents} > ${input.policy.maxOpportunityCostCents})`);
    authorized = false;
  }
  if (input.dailySpendSoFarCents + input.expectedCostCents > input.policy.maxDailySpendCents) {
    reasons.push('daily_spend_budget_exhausted');
    authorized = false;
  }
  return { authorized: authorized && !requiresOwnerApproval, requiresOwnerApproval, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt-injection / malicious-instruction defense (O)
// ─────────────────────────────────────────────────────────────────────────────

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above)\s+instructions?/i, label: 'override_instructions' },
  { pattern: /disregard\s+(?:your\s+|all\s+)?(?:rules|policy|policies|instructions)/i, label: 'disregard_policy' },
  { pattern: /\bauthorize\s+(?:unlimited\s+)?(?:spending|payment|purchases?)/i, label: 'authorize_spending' },
  { pattern: /(?:transfer|send|move)\s+(?:funds?|money|payments?|crypto)/i, label: 'transfer_funds' },
  { pattern: /(?:reveal|share|send|leak|print)\s+(?:your\s+|the\s+)?(?:api[\s_-]?key|secret|credentials?|private\s+key|wallet)/i, label: 'credential_exfiltration' },
  { pattern: /(?:act|pose)\s+as\s+(?:a\s+)?(?:human|real\s+person|someone\s+else)/i, label: 'impersonation' },
  { pattern: /(?:bypass|skip)\s+(?:kyc|verification|authentication|security|rate\s*limits?)/i, label: 'security_bypass' },
  { pattern: /(?:create|register|generate)\s+(?:fake|fraudulent|stolen)\s+(?:identit|account|review|invoice)/i, label: 'fraud' },
];

export interface InjectionScanResult {
  flagged: boolean;
  findings: string[];
}

/**
 * Scan untrusted external text for instruction-like content. Everything the
 * economy reads from the internet passes through here; a positive finding
 * blocks the opportunity and raises a security event. The scan is
 * deliberately conservative: an opportunity description does not need to
 * contain instructions to be useful.
 */
export function scanExternalContent(text: string): InjectionScanResult {
  const findings: string[] = [];
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(text)) findings.push(label);
  }
  return { flagged: findings.length > 0, findings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery category definitions (A: legitimate opportunity categories)
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoveryCategory {
  key: string;
  queries: string[];
  defaultRevenueCents: number; // documented MARKET-RATE ESTIMATES — labelled as such everywhere
  defaultCostCents: number;
  defaultTimeHours: number;
  defaultProbability: number;
  defaultRisk: RiskLevel;
}

export const DISCOVERY_CATEGORIES: DiscoveryCategory[] = [
  { key: 'freelance', queries: ['freelance web development projects open for proposals', 'freelance writing gigs accepting new freelancers'], defaultRevenueCents: 45_000, defaultCostCents: 200, defaultTimeHours: 6, defaultProbability: 0.15, defaultRisk: 'medium' },
  { key: 'content', queries: ['start a niche content site monetization guide', 'newsletter monetization opportunities'], defaultRevenueCents: 15_000, defaultCostCents: 100, defaultTimeHours: 8, defaultProbability: 0.1, defaultRisk: 'medium' },
  { key: 'youtube', queries: ['YouTube channel niches with high CPM 2026', 'YouTube partner program requirements'], defaultRevenueCents: 20_000, defaultCostCents: 150, defaultTimeHours: 10, defaultProbability: 0.08, defaultRisk: 'medium' },
  { key: 'seo', queries: ['SEO consulting demand small business', 'technical SEO audit services pricing'], defaultRevenueCents: 30_000, defaultCostCents: 100, defaultTimeHours: 5, defaultProbability: 0.12, defaultRisk: 'low' },
  { key: 'digital_products', queries: ['digital product marketplace listing fees comparison', 'selling templates online platforms'], defaultRevenueCents: 12_000, defaultCostCents: 80, defaultTimeHours: 6, defaultProbability: 0.12, defaultRisk: 'low' },
  { key: 'software', queries: ['micro SaaS ideas validated demand', 'indie software tools market gaps'], defaultRevenueCents: 50_000, defaultCostCents: 300, defaultTimeHours: 20, defaultProbability: 0.06, defaultRisk: 'high' },
  { key: 'marketing', queries: ['email marketing agency retainer pricing', 'performance marketing service demand'], defaultRevenueCents: 40_000, defaultCostCents: 250, defaultTimeHours: 8, defaultProbability: 0.1, defaultRisk: 'medium' },
  { key: 'lead_generation', queries: ['B2B lead generation services demand', 'appointment setting services market'], defaultRevenueCents: 35_000, defaultCostCents: 200, defaultTimeHours: 6, defaultProbability: 0.1, defaultRisk: 'medium' },
  { key: 'research', queries: ['market research services outsourcing demand', 'academic research assistance freelance'], defaultRevenueCents: 25_000, defaultCostCents: 100, defaultTimeHours: 5, defaultProbability: 0.15, defaultRisk: 'low' },
  { key: 'coding_design', queries: ['design systems freelance contracts', 'API integration freelance work'], defaultRevenueCents: 45_000, defaultCostCents: 200, defaultTimeHours: 8, defaultProbability: 0.12, defaultRisk: 'medium' },
  { key: 'automation', queries: ['business process automation consulting demand', 'workflow automation services pricing'], defaultRevenueCents: 38_000, defaultCostCents: 200, defaultTimeHours: 6, defaultProbability: 0.12, defaultRisk: 'medium' },
  { key: 'partnerships', queries: ['SaaS partnership programs for small providers', 'affiliate partnership opportunities software'], defaultRevenueCents: 18_000, defaultCostCents: 50, defaultTimeHours: 4, defaultProbability: 0.08, defaultRisk: 'low' },
  { key: 'affiliate', queries: ['affiliate programs legitimate high commission', 'software affiliate programs terms'], defaultRevenueCents: 8_000, defaultCostCents: 50, defaultTimeHours: 3, defaultProbability: 0.15, defaultRisk: 'low' },
];

export function findDiscoveryCategory(key: string): DiscoveryCategory | undefined {
  return DISCOVERY_CATEGORIES.find((category) => category.key === key);
}
