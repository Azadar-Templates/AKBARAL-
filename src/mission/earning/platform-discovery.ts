/** DURABLE PLATFORM DISCOVERY — beyond the current registry
 * New platforms enter DISCOVERED → QUALIFIED → POLICY_REVIEW → PAYMENT_VERIFICATION_READY → PERMITTED → ACTIVE
 * Never auto-enable unsafe/restricted source. Owner must approve before PERMITTED.
 */

import {missionDb as db, missionId, nowIso, appendMissionAudit, type Row} from '../database';
import {MoneyError, type MoneyActor, assertMoneyOwner} from '../money';
import {PLATFORM_CONNECTORS, type PlatformConnector} from './platform-connectors';
import {registerNewOpportunityClass} from './earning-engine';

function deny(code:string):never{ throw new MoneyError(`discovery_${code}` as any); }

export function seedPlatforms(): number {
  let seeded=0;
  for(const p of PLATFORM_CONNECTORS){
    if(db.get('SELECT id FROM mission_platforms WHERE id=?',[p.id])) continue;
    db.run('INSERT INTO mission_platforms (id, label, kind, opportunity_class, api_permitted, status, evidence, official_url, payout_verifiable, requires_owner_account, human_only_actions, discovered_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [p.id, p.label, p.kind, p.opportunityClass??null, p.apiPermitted?1:0, p.status, JSON.stringify({evidence:p.evidence, earningMechanism: p.earningMechanism}), p.officialUrl, p.payoutVerifiable?1:0, p.requiresOwnerAccount?1:0, JSON.stringify(p.humanOnlyActions), nowIso(), nowIso()]);
    seeded++;
  }
  return seeded;
}

export function listPlatforms(limit=100): Row[] {
  return db.all<Row>('SELECT * FROM mission_platforms ORDER BY kind, label LIMIT ?',[limit]);
}
export function getPlatform(id:string): Row|undefined { return db.get<Row>('SELECT * FROM mission_platforms WHERE id=?',[id]); }

export function discoverPlatform(input:{id:string; label:string; kind: PlatformConnector['kind']; opportunityClass?:string; officialUrl:string; evidence:string; payoutVerifiable:boolean; apiPermitted:boolean; humanOnlyActions?:string[]}): Row {
  if(db.get('SELECT id FROM mission_platforms WHERE id=?',[input.id])) deny('duplicate_platform');
  const rowId = input.id.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  db.run('INSERT INTO mission_platforms (id, label, kind, opportunity_class, api_permitted, status, evidence, official_url, payout_verifiable, requires_owner_account, human_only_actions, discovered_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [rowId, input.label.slice(0,160), input.kind, input.opportunityClass??null, input.apiPermitted?1:0, 'DISCOVERED', JSON.stringify({evidence:input.evidence}), input.officialUrl, input.payoutVerifiable?1:0, 1, JSON.stringify(input.humanOnlyActions??[]), nowIso(), nowIso()]);
  db.run('INSERT INTO mission_platform_discovery_log (id, platform_id, from_status, to_status, actor_type, actor_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [missionId('pdisc'), rowId, null, 'DISCOVERED', 'system', null, JSON.stringify({label:input.label}), nowIso()]);
  appendMissionAudit({actorType:'system', action:'platform.discovered', subjectType:'platform', subjectId:rowId, detail:{label:input.label, kind:input.kind}});
  return getPlatform(rowId)!;
}

export function qualifyPlatform(id:string, actor: MoneyActor): Row {
  const p = getPlatform(id);
  if(!p) deny('platform_missing');
  if(String(p!.status)!=='DISCOVERED') deny('not_discovered');
  // Qualification checks: official URL must be https, evidence must mention payout/ToS, kind must not be NOT_AN_EARNING_SOURCE
  const evidence = String(p!.evidence);
  if(!String(p!.official_url).startsWith('https://')) deny('invalid_official_url');
  if(String(p!.kind)==='NOT_AN_EARNING_SOURCE') deny('not_earning_source');
  if(!evidence.includes('payout') && !evidence.includes('Official')) deny('insufficient_evidence');
  db.run("UPDATE mission_platforms SET status='QUALIFIED', updated_at=? WHERE id=?", [nowIso(), id]);
  db.run('INSERT INTO mission_platform_discovery_log (id, platform_id, from_status, to_status, actor_type, actor_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [missionId('pdisc'), id, 'DISCOVERED', 'QUALIFIED', actor.kind, actor.id, null, nowIso()]);
  return getPlatform(id)!;
}

export function submitForPolicyReview(id:string, actor: MoneyActor): Row {
  const p = getPlatform(id);
  if(!p) deny('platform_missing');
  if(String(p!.status)!=='QUALIFIED') deny('not_qualified');
  db.run("UPDATE mission_platforms SET status='POLICY_REVIEW', updated_at=? WHERE id=?", [nowIso(), id]);
  db.run('INSERT INTO mission_platform_discovery_log (id, platform_id, from_status, to_status, actor_type, actor_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [missionId('pdisc'), id, 'QUALIFIED', 'POLICY_REVIEW', actor.kind, actor.id, null, nowIso()]);
  return getPlatform(id)!;
}

export function markPaymentVerificationReady(id:string, actor: MoneyActor): Row {
  assertMoneyOwner(actor);
  const p = getPlatform(id);
  if(!p) deny('platform_missing');
  if(String(p!.status)!=='POLICY_REVIEW') deny('not_policy_review');
  if(Number(p!.payout_verifiable)!==1) deny('payout_not_verifiable');
  db.run("UPDATE mission_platforms SET status='PAYMENT_VERIFICATION_READY', updated_at=? WHERE id=?", [nowIso(), id]);
  db.run('INSERT INTO mission_platform_discovery_log (id, platform_id, from_status, to_status, actor_type, actor_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [missionId('pdisc'), id, 'POLICY_REVIEW', 'PAYMENT_VERIFICATION_READY', 'owner', actor.id, null, nowIso()]);
  return getPlatform(id)!;
}

export function permitPlatform(id:string, actor: MoneyActor): Row {
  assertMoneyOwner(actor);
  const p = getPlatform(id);
  if(!p) deny('platform_missing');
  if(String(p!.status)!=='PAYMENT_VERIFICATION_READY') deny('not_ready');
  db.run("UPDATE mission_platforms SET status='PERMITTED', updated_at=? WHERE id=?", [nowIso(), id]);
  db.run('INSERT INTO mission_platform_discovery_log (id, platform_id, from_status, to_status, actor_type, actor_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [missionId('pdisc'), id, 'PAYMENT_VERIFICATION_READY', 'PERMITTED', 'owner', actor.id, null, nowIso()]);
  appendMissionAudit({actorType:'owner', actorId:actor.id, action:'platform.permitted', subjectType:'platform', subjectId:id});
  return getPlatform(id)!;
}

export function activatePlatform(id:string, actor: MoneyActor): Row {
  assertMoneyOwner(actor);
  const p = getPlatform(id);
  if(!p) deny('platform_missing');
  if(String(p!.status)!=='PERMITTED') deny('not_permitted');
  db.run("UPDATE mission_platforms SET status='ACTIVE', updated_at=? WHERE id=?", [nowIso(), id]);
  db.run('INSERT INTO mission_platform_discovery_log (id, platform_id, from_status, to_status, actor_type, actor_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [missionId('pdisc'), id, 'PERMITTED', 'ACTIVE', 'owner', actor.id, null, nowIso()]);
  // If this platform introduces a new earning class not in registry, auto-create candidate class (owner must have permitted)
  if(p!.opportunity_class && !db.get('SELECT 1 FROM mission_platforms WHERE opportunity_class=? AND status=\'ACTIVE\' LIMIT 1', [p!.opportunity_class])){
    // Check if registry already has class; if not, create candidate via earning-engine helper (requires owner actor)
    try{
      const clsKey = String(p!.opportunity_class);
      // Dynamic import to avoid circular
      const {OPPORTUNITY_REGISTRY} = require('./opportunity-registry');
      if(!OPPORTUNITY_REGISTRY.some((c:any)=>c.key===clsKey)){
        registerNewOpportunityClass(actor, {
          key: clsKey,
          label: String(p!.label),
          earningMechanism: `Platform ${p!.label} pays for ${p!.opportunity_class}`,
          agentWork: `Agent performs ${p!.opportunity_class} work via permitted APIs`,
          customerSource: `Platform ${p!.label} buyer`,
          usdPaymentMechanism: 'Platform payout via verified rail',
          payoutMethodAndSettlementEvidence: String(p!.evidence).slice(0,500),
          humanControlled: (JSON.parse(String(p!.human_only_actions)) as string[]).join('; ') || 'Owner handles account/KYC/payout',
          countryRestrictions: 'Platform-dependent; 18+, payout country per official docs',
          apiAutomationAvailability: p!.api_permitted ? 'API permitted where ToS allows' : 'Human-only per ToS',
          accountRequirements: 'Owner-created account via official flow',
          expectedCosts: 'Platform fees per official docs',
          fraudRisks: 'Fake accounts/reviews/ToS violations blocked',
          integrations: ['GitHub'],
          representativePlatforms: [{name: String(p!.label), officialUrl: String(p!.official_url), evidence: String(p!.evidence).slice(0,500)}],
        } as any);
      }
    }catch{}
  }
  return getPlatform(id)!;
}

export function restrictPlatform(id:string, actor: MoneyActor, reason:string): Row {
  assertMoneyOwner(actor);
  db.run("UPDATE mission_platforms SET status='RESTRICTED', updated_at=? WHERE id=?", [nowIso(), id]);
  db.run('INSERT INTO mission_platform_discovery_log (id, platform_id, from_status, to_status, actor_type, actor_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [missionId('pdisc'), id, null, 'RESTRICTED', 'owner', actor.id, reason.slice(0,500), nowIso()]);
  return getPlatform(id)!;
}

export function listDiscoverableBeyondRegistry(): Row[] {
  // Platforms that are EARNING_SOURCE but not yet ACTIVE — owner action required
  return db.all<Row>("SELECT * FROM mission_platforms WHERE kind='EARNING_SOURCE' AND status!='ACTIVE' ORDER BY discovered_at DESC LIMIT 50");
}
