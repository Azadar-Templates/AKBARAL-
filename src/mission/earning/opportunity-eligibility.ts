/**
 * ZA141251SA OPPORTUNITY ELIGIBILITY + ACTIVATION GATING
 * - Gates every discovery/assignment on platform readiness, class autonomy, account/KYC, payout rail.
 * - Does NOT fabricate eligibility: returns explicit blockers with human-action-required states.
 * - Provider capability: mission DB only.
 */

import { missionDb as db, type Row } from '../database';
import { MoneyError } from '../money';
import { currentPolicy } from '../policy';
import { OPPORTUNITY_REGISTRY } from './opportunity-registry';
import { PLATFORM_CONNECTORS } from './platform-connectors';

function deny(code: string): never { throw new MoneyError(`eligibility_${code}` as any); }

export interface EligibilityDecision {
  eligible: boolean;
  reason: string;
  blockers: string[]; // human-required steps
  requiresOwnerAccount: boolean;
  platformStatus: string | null;
  autonomousPermitted: boolean;
}

export function eligibilityDecision(registryKey: string, platformId?: string): EligibilityDecision {
  const cls = OPPORTUNITY_REGISTRY.find(c=> c.key===registryKey);
  if (!cls) return { eligible:false, reason:`unknown_registry_key:${registryKey}`, blockers:['unknown opportunity class'], requiresOwnerAccount:true, platformStatus:null, autonomousPermitted:false };
  const blockers: string[] = [];
  // Activity gate via mission policy (kill switch + allow-list)
  const policy = currentPolicy();
  if (policy.killSwitch) {
    return { eligible:false, reason:'kill_switch_engaged', blockers:['Kill switch engaged — owner must release'], requiresOwnerAccount:false, platformStatus:null, autonomousPermitted:false };
  }
  // Check platform readiness if platformId given
  let platformStatus: string|null = null;
  if (platformId) {
    const plat = db.get<Row>('SELECT status, kind, api_permitted, payout_verifiable, requires_owner_account, human_only_actions FROM mission_platforms WHERE id=?', [platformId]);
    if (!plat) {
      // Fallback to connector metadata if not yet seeded
      const conn = PLATFORM_CONNECTORS.find(c=> c.id===platformId);
      if (!conn) blockers.push(`unknown platform ${platformId}`);
      else {
        platformStatus = conn.status;
        if (conn.requiresOwnerAccount && !db.get('SELECT id FROM mission_credentials WHERE provider=? LIMIT 1', [platformId])) {
          blockers.push(`Owner must create ${conn.label} account via official flow and add credential`);
        }
        if (conn.status==='BLOCKED') blockers.push(`${conn.label} is BLOCKED per ToS`);
        if (conn.status==='RESTRICTED' || conn.kind==='RESTRICTED_HUMAN_ONLY') blockers.push(`${conn.label} is RESTRICTED — human-only actions required: ${conn.humanOnlyActions.slice(0,2).join('; ')}`);
      }
    } else {
      platformStatus = String(plat.status);
      if (String(plat.status)==='DISCOVERED' || String(plat.status)==='QUALIFIED' || String(plat.status)==='POLICY_REVIEW') blockers.push(`Platform ${platformId} not yet PERMITTED — owner must qualify/permit: ${String(plat.status)} → PERMITTED → ACTIVE`);
      if (String(plat.status)==='PAYMENT_VERIFICATION_READY') blockers.push(`Platform ${platformId} ready for permit — owner must permit before ACTIVE`);
      if (String(plat.status)==='BLOCKED') blockers.push(`Platform ${platformId} BLOCKED`);
      if (String(plat.status)==='RESTRICTED') blockers.push(`Platform ${platformId} RESTRICTED — human-only`);
      if (Number(plat.requires_owner_account)===1) {
        const cred = db.get<Row>('SELECT id FROM mission_credentials WHERE provider=? LIMIT 1', [platformId]);
        if (!cred && !['direct_client_research','direct_ai_implementation','direct_automation','direct_consulting','seo_direct'].includes(registryKey)) {
          blockers.push(`Owner account/credential for ${platformId} required`);
        }
      }
    }
  }
  // Class autonomy gate
  const auto = !!cls.autonomousPermitted;
  if (!auto) blockers.push(`Class ${cls.key} autonomousPermitted=false — human must publish/bid/submit; agents may only perform scoped work after owner assigns`);
  if (cls.status==='restricted') blockers.push(`Class ${cls.key} restricted: additional owner setup / payout integration required`);
  if (cls.status==='candidate') blockers.push(`Class ${cls.key} candidate: needs official re-check + owner enrollment before auto-assignment`);
  // Payout slot readiness
  const payoutSlots = db.get<Row>("SELECT COUNT(*) as c FROM mission_payout_slots WHERE status='active'")?.c ?? 0;
  if (!payoutSlots && cls.paymentVerifiable) blockers.push('No active payout slot verified — owner must verify at least one of four slots (180-day attestation)');
  // But eligibility for discovery should not be blocked solely by payout slot — only settlement will be.
  // For execution gating, we require payout slot only when transitioning to settlement; for assignment we allow without.
  const requiresOwnerAccount = cls.humanControlled.length>0 || blockers.some(b=> b.includes('Owner must create'));
  const eligible = blockers.length===0 || (blockers.length===1 && blockers[0].includes('No active payout slot'));
  // If only payout slot blocks, still eligible for assignment but not for settlement
  const finalEligible = (()=> {
    if (policy.killSwitch) return false;
    if (platformStatus && ['BLOCKED','RESTRICTED'].includes(platformStatus)) return false;
    if (!auto && platformStatus && ['DISCOVERED','QUALIFIED','POLICY_REVIEW'].includes(platformStatus)) return false;
    if (cls.status==='restricted' && !auto) return false;
    // Allow candidate with owner awareness — still assignable but flagged
    return eligible;
  })();
  return {
    eligible: finalEligible,
    reason: finalEligible ? 'eligible' : blockers[0] ?? 'blocked',
    blockers,
    requiresOwnerAccount,
    platformStatus,
    autonomousPermitted: auto,
  };
}

export function isOpportunityEligibleForAssignment(opportunity: Row): EligibilityDecision {
  const registryKey = String(opportunity.registry_key);
  const platform = String(opportunity.platform ?? '');
  // Resolve platform id via label or direct id
  const platRow = db.get<Row>('SELECT id FROM mission_platforms WHERE label=? OR id=? LIMIT 1', [platform, platform]);
  const pid = platRow ? String(platRow.id) : platform.toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,60);
  // Prefer direct platform field if it matches connector id
  const connectorMatch = PLATFORM_CONNECTORS.find(c=> c.label===platform || c.id===pid);
  const effectiveId = connectorMatch ? connectorMatch.id : pid;
  return eligibilityDecision(registryKey, effectiveId);
}

export function listEligibleOpportunities(limit=20): { eligible: Row[]; blocked: Array<{opportunity: Row; decision: EligibilityDecision}> } {
  const rows = db.all<Row>('SELECT * FROM mission_earning_engine_opportunities WHERE verification_state IN (\'discovered\',\'qualified\',\'legitimacy_verified\') ORDER BY score DESC LIMIT ?', [limit]);
  const eligible: Row[] = [];
  const blocked: Array<{opportunity: Row; decision: EligibilityDecision}> = [];
  for (const r of rows) {
    const d = isOpportunityEligibleForAssignment(r);
    if (d.eligible) eligible.push(r); else blocked.push({opportunity:r, decision:d});
  }
  return { eligible, blocked };
}

export function canAssignExclusivelyWithGate(opportunityId: string): { assignable: boolean; decision: EligibilityDecision; reason: string } {
  const opp = db.get<Row>('SELECT * FROM mission_earning_engine_opportunities WHERE id=?', [opportunityId]);
  if (!opp) deny('opportunity_missing');
  const dec = isOpportunityEligibleForAssignment(opp!);
  return { assignable: dec.eligible, decision: dec, reason: dec.reason };
}
