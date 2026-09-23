/** Autonomous discovery infrastructure for highest-value PERMITTED classes.
 * Uses the opportunity registry + existing 94 integrations as infrastructure,
 * not as connectors. Discovery is via inbound + permitted_feed + public_opportunity
 * (SSRF-guarded) only; no scraping of prohibited sources, no fake accounts,
 * no automated bidding, no ToS violation. Every discovery retains evidence.
 *
 * Pipeline: DISCOVER (registry-filtered) → QUALIFY → ASSIGN ONE AGENT → EXECUTE REAL WORK
 * → MULTI-AGENT VERIFY → DELIVER → PROVIDER CONFIRMS PAYMENT → VERIFY SETTLEMENT → WALLET
 */

import {missionDb as db, type Row} from '../database';
import {MoneyError, type MoneyActor} from '../money';
import {currentPolicy, checkActivity} from '../policy';
import {OpportunityDiscovery} from './opportunity-discovery';
import {permittedAutonomousClasses, rankedOpportunities, OPPORTUNITY_REGISTRY, type OpportunityClass} from './opportunity-registry';
import {serviceOffer} from './service-offers';

function deny(code:string):never{ throw new MoneyError(`discovery_${code}` as any); }

/** Map registry key → service offer(s) that can fulfill it with existing verified-money chain.
 *  Only software_development/research/qa/writing/seo map to the 2 deterministic packs today;
 *  other classes are inventoried but require additional owner setup / payout integration.
 */
const CLASS_TO_SERVICE: Record<string, string[]> = {
  paid_research_data: ['json-validation'],
  software_development: ['json-validation','html-release-check'],
  qa_testing: ['html-release-check','json-validation'],
  writing_translation: ['json-validation'],
  seo_marketing: ['html-release-check'],
  freelance_client_work: ['json-validation','html-release-check'],
  bug_bounties: ['json-validation'], // report-shaped deliverable, but bounty lane requires researcher account
  contests_challenges: ['json-validation'],
};

export function servicesForClass(key: string): string[] {
  return CLASS_TO_SERVICE[key] ?? [];
}

export function permittedAutonomousClassesWithService(): OpportunityClass[] {
  return permittedAutonomousClasses().filter(c=> (CLASS_TO_SERVICE[c.key]?.length ?? 0)>0);
}

/** Ranking snapshot for dashboard / tests – factual, no income claim. */
export function discoveryRankingSnapshot(limit=10){
  const ranked = rankedOpportunities().slice(0, Math.min(20, Math.max(1, limit)));
  return ranked.map(o=> ({
    key: o.key,
    label: o.label,
    overallScore: o.overallScore,
    status: o.status,
    autonomousPermitted: o.autonomousPermitted,
    paymentVerifiable: o.paymentVerifiable,
    exclusivelyAssignable: o.exclusivelyAssignable,
    services: servicesForClass(o.key),
    integrations: o.integrations.slice(0,8),
    representativePlatforms: o.representativePlatforms.map(p=> ({name:p.name, officialUrl:p.officialUrl})),
  }));
}

/** Autonomous pursue: agent discovers eligible opportunities limited to permitted classes
 *  that have a verifiable service mapping. Delegates to OpportunityDiscovery.discover
 *  with eligibility filtering by serviceId + registry.
 */
export function autonomousDiscover(actor: MoneyActor, limit=20){
  const policy = currentPolicy();
  if(policy.killSwitch) deny('policy_blocked');
  if(actor.kind==='agent' && !policy.autonomousEnabled) deny('autonomy_disabled');
  // Only permitted autonomous classes with service are considered for autonomous pursuit
  const permittedKeys = new Set(permittedAutonomousClassesWithService().map(c=>c.key));
  const permittedServiceIds = new Set(Object.values(CLASS_TO_SERVICE).flat());
  const disc = new OpportunityDiscovery();
  const result: any = disc.discover(actor, limit*2);
  // For agent, filter to only serviceIds that map to permitted classes
  if(actor.kind==='agent'){
    const filtered = (result.opportunities as any[]).filter(o=> permittedServiceIds.has(String(o.serviceId)));
    // Also filter by activity: must be software_development/research (current policy allow-list)
    // Keep only where checkActivity passes – else owner must enable.
    const activityAllowed = filtered.filter(o=>{
      const offer = (()=>{ try{ return serviceOffer(String(o.serviceId)); }catch{ return null; } })();
      if(!offer) return false;
      return checkActivity(offer.activity, policy).allowed;
    });
    return {
      qualifyingCount: activityAllowed.length,
      totalScanned: result.totalScanned,
      opportunities: activityAllowed.slice(0, Math.min(50, Math.max(1, limit))),
      permitted: true,
      permittedKeys: [...permittedKeys],
      note: 'Autonomous pursuit limited to registry-verified, payment-verifiable, service-mapped classes. No revenue implied.',
    };
  }
  // owner sees all, plus ranking context
  return {
    ...result,
    ranking: discoveryRankingSnapshot(limit),
    permittedKeys: [...permittedKeys],
  };
}

/** One-agent exclusive assignment helper – thin wrapper around promote+CustomerWork flow
 *  that enforces single-agent rule via discovery.state and customer_request unique source_ref.
 *  Actual execution still via CustomerWork.produce → independent multi-agent verify → payout verification.
 */
export function canAssignExclusively(opportunityId: string): {ok:boolean; reason?:string}{
  const row = db.get<Row>('SELECT * FROM mission_discovery_opportunities WHERE id=?',[String(opportunityId)]);
  if(!row) return {ok:false, reason:'opportunity_missing'};
  if(String(row.state)!=='qualified') return {ok:false, reason:`state_${row.state}_not_qualified`};
  if(row.promoted_request_id) return {ok:false, reason:'already_promoted'};
  const cls = OPPORTUNITY_REGISTRY.find(c=> (CLASS_TO_SERVICE[c.key]||[]).includes(String(row.service_id)));
  if(!cls) return {ok:false, reason:'service_no_registry_mapping'};
  if(!cls.exclusivelyAssignable) return {ok:false, reason:'class_not_exclusively_assignable'};
  return {ok:true};
}

export function pursuitInfrastructureStatus(){
  return {
    totalClasses: OPPORTUNITY_REGISTRY.length,
    rankedTop: discoveryRankingSnapshot(5),
    permittedAutonomousCount: permittedAutonomousClassesWithService().length,
    permittedKeys: permittedAutonomousClassesWithService().map(c=>c.key),
    verifiedMoneyGate: 'USD settlement via payout-verification + receiving rail before treasury — unchanged',
    humanControlled: 'identity/account/contracts/sensitive/restricted/payouts remain owner-only',
    integrationsAsInfrastructure: '94+ integrations used as tools (search, code, hosting, comms) not as earning claims',
  };
}
