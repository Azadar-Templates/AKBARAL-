/**
 * ZA141251SA AGENT-OPPORTUNITY ROUTING
 *
 * Ensures opportunities are only routed to agents whose skills, country
 * eligibility, payout compatibility, and automation permissions match.
 *
 * Agents do NOT blindly act on every platform. Each opportunity is routed
 * only to agents that:
 * 1. Have matching capabilities/skills
 * 2. Have an active money grant (provisioned by owner)
 * 3. Are not revoked/suspended
 * 4. The opportunity's platform is eligible for the owner's country
 * 5. The opportunity's payout method is compatible with available rails
 * 6. The opportunity class permits the agent's depth/role
 */

import { missionDb as db, type Row } from '../database';
import { OPPORTUNITY_REGISTRY } from './opportunity-registry';
import { PLATFORM_CONNECTORS } from './platform-connectors';
import { getPlatformCountryEligibility, SANCTIONED_COUNTRIES } from './country-eligibility';
import { eligibilityDecision } from './opportunity-eligibility';

export interface RoutingDecision {
  agentId: string;
  opportunityId: string;
  eligible: boolean;
  score: number;
  blockers: string[];
  countryEligible: boolean;
  payoutCompatible: boolean;
  automationPermitted: boolean;
  skillsMatch: boolean;
}

export interface RoutingConfig {
  ownerCountry: string;
  limit?: number;
  minScore?: number;
}

/** Check if an agent's capabilities match the opportunity's required capabilities */
function agentSkillsMatch(agentCapabilities: string[], requiredCapabilities: string[], requiredTools: string[]): boolean {
  // Must have at least one matching capability
  const capMatch = requiredCapabilities.some(c => agentCapabilities.includes(c));
  // Or at least one matching tool/domain
  const toolMatch = requiredTools.some(t => agentCapabilities.some(ac =>
    ac.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(ac.toLowerCase())
  ));
  return capMatch || toolMatch;
}

/** Check if any of the opportunity's payout methods are available in the owner's country */
function payoutCompatible(platformId: string, ownerCountry: string): { compatible: boolean; availableMethods: string[]; reason: string } {
  const eligibility = getPlatformCountryEligibility(platformId, ownerCountry);
  if (eligibility.availableRails.length > 0) {
    return { compatible: true, availableMethods: eligibility.availableRails, reason: `Compatible via: ${eligibility.availableRails.join(', ')}` };
  }
  return { compatible: false, availableMethods: [], reason: `No compatible payout rail for ${platformId} in ${ownerCountry}` };
}

/** Full routing decision for a single agent + opportunity */
export function routeOpportunityToAgent(agentId: string, opportunityId: string, ownerCountry: string): RoutingDecision {
  const blockers: string[] = [];

  // 1. Load agent
  const agent = db.get<Row>('SELECT id, slug, capabilities, status, depth FROM mission_agents WHERE id=?', [agentId]);
  if (!agent) return { agentId, opportunityId, eligible: false, score: 0, blockers: ['agent not found'], countryEligible: false, payoutCompatible: false, automationPermitted: false, skillsMatch: false };
  if (String(agent.status) !== 'active') return { agentId, opportunityId, eligible: false, score: 0, blockers: [`agent status: ${agent.status}`], countryEligible: false, payoutCompatible: false, automationPermitted: false, skillsMatch: false };

  // 2. Check agent has active money grant (provisioned by owner)
  const grant = db.get<Row>('SELECT * FROM mission_money_grants WHERE agent_id=? AND status=?', [agentId, 'active']);
  if (!grant) return { agentId, opportunityId, eligible: false, score: 0, blockers: ['agent not provisioned — no active money grant'], countryEligible: false, payoutCompatible: false, automationPermitted: false, skillsMatch: false };

  // 3. Load opportunity
  const opp = db.get<Row>('SELECT * FROM mission_earning_engine_opportunities WHERE id=?', [opportunityId]);
  if (!opp) return { agentId, opportunityId, eligible: false, score: 0, blockers: ['opportunity not found'], countryEligible: false, payoutCompatible: false, automationPermitted: false, skillsMatch: false };

  const registryKey = String(opp.registry_key);
  const platformId = String(opp.platform ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);
  const cls = OPPORTUNITY_REGISTRY.find(c => c.key === registryKey);
  if (!cls) return { agentId, opportunityId, eligible: false, score: 0, blockers: [`unknown registry key: ${registryKey}`], countryEligible: false, payoutCompatible: false, automationPermitted: false, skillsMatch: false };

  // 4. Country eligibility check
  const isSanctioned = (SANCTIONED_COUNTRIES as readonly string[]).includes(ownerCountry.toUpperCase());
  let countryEligible = true;
  if (isSanctioned) {
    countryEligible = false;
    blockers.push(`Owner country ${ownerCountry} is sanctioned — no platform available`);
  } else {
    // Check platform-specific eligibility
    const connector = PLATFORM_CONNECTORS.find(c => c.id === platformId || c.label === String(opp.platform));
    if (connector) {
      const platElig = getPlatformCountryEligibility(connector.id, ownerCountry);
      if (!platElig.eligible) {
        countryEligible = false;
        blockers.push(`Platform ${connector.label} not available in ${ownerCountry}: ${platElig.reason}`);
      }
    }
    // For direct/own platforms, country eligibility is always true (location-agnostic)
    const normalizedPlatform = String(opp.platform ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);
    if (['direct_client_research', 'direct_ai_implementation', 'direct_automation', 'direct_consulting', 'seo_direct'].includes(registryKey) ||
        ['direct_client_research', 'direct_ai_implementation', 'direct_automation', 'direct_consulting', 'seo_direct'].includes(normalizedPlatform)) {
      countryEligible = true;
    }
  }

  // 5. Payout compatibility check
  const payout = payoutCompatible(platformId, ownerCountry);
  const payoutOk = payout.compatible;
  if (!payoutOk) {
    blockers.push(payout.reason);
  }

  // 6. Automation permission check
  const automationOk = cls.autonomousPermitted;
  if (!automationOk) {
    blockers.push(`Class ${cls.key} requires human-only actions: ${cls.humanControlled.slice(0, 120)}`);
  }

  // 7. Skills match check
  const agentCaps: string[] = JSON.parse(String(agent.capabilities ?? '[]'));
  const requiredCaps: string[] = JSON.parse(String(opp.required_capabilities_json ?? '[]'));
  const requiredTools: string[] = JSON.parse(String(opp.required_tools_json ?? '[]'));
  const skillsOk = agentSkillsMatch(agentCaps, requiredCaps, requiredTools);
  if (!skillsOk) {
    blockers.push(`Agent skills do not match opportunity requirements`);
  }

  // 8. Platform-level eligibility (via existing eligibility system)
  const eligDecision = eligibilityDecision(registryKey, platformId);
  if (!eligDecision.eligible) {
    blockers.push(...eligDecision.blockers);
  }

  // 9. Check if opportunity is already locked by another agent
  if (String(opp.exclusive_agent_id) && String(opp.exclusive_agent_id) !== agentId) {
    blockers.push(`Opportunity locked by agent ${opp.exclusive_agent_id}`);
  }

  // 10. Compute routing score (0-100)
  let score = 0;
  if (countryEligible) score += 25;
  if (payoutOk) score += 25;
  if (skillsOk) score += 25;
  if (automationOk) score += 15;
  // Bonus for higher opportunity score
  const oppScore = Number(opp.score ?? 0);
  score += Math.min(10, Math.round(oppScore));

  const eligible = blockers.length === 0;

  return {
    agentId,
    opportunityId,
    eligible,
    score,
    blockers,
    countryEligible,
    payoutCompatible: payoutOk,
    automationPermitted: automationOk,
    skillsMatch: skillsOk,
  };
}

/** Find the best agent(s) for an opportunity, filtered by owner country */
export function findBestAgentsForOpportunity(opportunityId: string, config: RoutingConfig): {
  candidates: RoutingDecision[];
  bestAgentId: string | null;
  totalEvaluated: number;
} {
  const opp = db.get<Row>('SELECT * FROM mission_earning_engine_opportunities WHERE id=?', [opportunityId]);
  if (!opp) return { candidates: [], bestAgentId: null, totalEvaluated: 0 };

  const limit = config.limit ?? 20;
  const minScore = config.minScore ?? 0;

  // Get all active agents with grants
  const agents = db.all<Row>(
    "SELECT a.id, a.slug, a.capabilities FROM mission_agents a WHERE a.status='active' AND EXISTS (SELECT 1 FROM mission_money_grants g WHERE g.agent_id=a.id AND g.status='active') LIMIT ?",
    [200]
  );

  const candidates: RoutingDecision[] = [];
  for (const agent of agents) {
    const decision = routeOpportunityToAgent(String(agent.id), opportunityId, config.ownerCountry);
    if (decision.score >= minScore) {
      candidates.push(decision);
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, limit);

  return {
    candidates: top,
    bestAgentId: top.length > 0 ? top[0].agentId : null,
    totalEvaluated: agents.length,
  };
}

/** Batch route: find the best agent for each opportunity in a list */
export function batchRouteOpportunities(opportunityIds: string[], config: RoutingConfig): Array<{
  opportunityId: string;
  bestAgentId: string | null;
  eligible: boolean;
  blockers: string[];
  candidates: number;
}> {
  return opportunityIds.map(oppId => {
    const result = findBestAgentsForOpportunity(oppId, config);
    const best = result.candidates[0];
    return {
      opportunityId: oppId,
      bestAgentId: result.bestAgentId,
      eligible: best?.eligible ?? false,
      blockers: best?.blockers ?? ['no eligible agents found'],
      candidates: result.totalEvaluated,
    };
  });
}
