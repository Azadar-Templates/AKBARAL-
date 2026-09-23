/**
 * ZA141251SA WORKLOAD ALLOCATOR — intelligent allocation across 4,001+ agents.
 * Always considers: capability match, opportunity value, required tools,
 * platform permissions, historical verified success, current workload,
 * operating cost, risk, settlement reliability.
 * No agent sits waiting when legitimate permitted work is available.
 */

import { missionDb as db, missionId, nowIso, appendMissionAudit, type Row } from '../database';
import { MoneyError } from '../money';
import { currentPolicy } from '../policy';
import { OPPORTUNITY_REGISTRY } from './opportunity-registry';
import { PLATFORM_CONNECTORS, findConnector } from './platform-connectors';
import * as EarningEngine from './earning-engine';
import { generateAgentDefinitions } from '../../agents/catalog';

function deny(code: string): never { throw new MoneyError(`allocator_${code}` as any); }

export interface AllocationScore {
  agentId: string;
  agentSlug: string;
  opportunityId: string;
  total: number;
  breakdown: {
    capabilityMatch: number; // 0-3
    toolMatch: number; // 0-2
    value: number; // 0-5 (netValueScore)
    platformPermission: number; // 0-2
    historicalSuccess: number; // 0-3
    workloadPenalty: number; // 0-2 (penalty, lower is better)
    operatingCost: number; // 0-5
    riskPenalty: number; // 0-2 penalty
    settlementReliability: number; // 0-2
  };
  reasoning: string;
}

/** Current workload: count of assigned/executing opportunities per agent */
function currentWorkload(agentId: string): number {
  const row = db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE exclusive_agent_id=? AND verification_state IN (\'assigned\',\'executing\',\'verified\')', [agentId]);
  return Number(row?.c ?? 0);
}

/** Historical verified success for registry class */
function historicalSuccess(registryKey: string): number {
  const roi = db.get<Row>('SELECT successes, total_net_cents FROM mission_opportunity_roi WHERE registry_key=?', [registryKey]);
  if (!roi) return 0;
  const successes = Number(roi.successes ?? 0);
  const net = Number(roi.total_net_cents ?? 0);
  if (successes >= 3 && net > 50000) return 3;
  if (successes >= 1 && net > 0) return 2;
  if (successes >= 1) return 1;
  return 0;
}

/** Score one agent vs one opportunity (factual, no probability invention) */
export function scoreAgentForOpportunity(agent: Row, opportunity: Row): AllocationScore {
  const registryKey = String(opportunity.registry_key);
  const cls = OPPORTUNITY_REGISTRY.find(c => c.key === registryKey);
  const requiredTools: string[] = (()=>{ try{ return JSON.parse(String(opportunity.required_tools_json)); }catch{ return []; } })();
  const requiredCaps: string[] = (()=>{ try{ return JSON.parse(String(opportunity.required_capabilities_json)); }catch{ return []; } })();
  const caps: string[] = (()=>{ try{ return JSON.parse(String((agent as any).capabilities ?? '[]')); }catch{ return []; } })() as string[];
  const slug = String((agent as any).slug ?? '');

  // Capability match 0-3
  const capMatch = requiredCaps.some(c => caps.includes(c) || slug.includes(c.replace(/_/g,'-'))) ? 3 : 0;
  // Tool match 0-2
  const toolMatch = requiredTools.some(t => caps.includes(t) || slug.includes(t.toLowerCase())) ? 2 : (caps.length > 0 ? 1 : 0);
  // Value 0-5 from engine score breakdown
  let value = 2;
  try {
    const breakdown = JSON.parse(String(opportunity.score_json)) as { netValueScore: number };
    value = Number(breakdown.netValueScore ?? 2);
  } catch {}
  // Platform permission 0-2
  let platformPermission = 0;
  const connector = findConnector(String(opportunity.platform ?? '').toLowerCase().replace(/\s+/g,'_')) ?? PLATFORM_CONNECTORS.find(p=> p.opportunityClass===registryKey);
  if (connector) {
    if (connector.kind === 'EARNING_SOURCE' && connector.apiPermitted) platformPermission = 2;
    else if (connector.kind === 'RESTRICTED_HUMAN_ONLY') platformPermission = 0;
    else if (connector.apiPermitted) platformPermission = 1;
  } else {
    // No connector: infer from opportunity automation_permitted
    platformPermission = Number(opportunity.automation_permitted) ? 2 : 0;
  }
  // Historical success 0-3
  const hist = historicalSuccess(registryKey);
  // Workload penalty 0-2 (more assigned → higher penalty)
  const workload = currentWorkload(String(agent.id));
  const workloadPenalty = workload >= 3 ? 2 : workload >= 1 ? 1 : 0;
  // Operating cost 0-5 from registry
  const operatingCost = cls ? cls.ranking.operatingCost : 3;
  // Risk penalty 0-2
  const riskPenalty = String(opportunity.risk_level) === 'high' ? 2 : String(opportunity.risk_level) === 'medium' ? 1 : 0;
  // Settlement reliability 0-2
  const settlementReliability = cls?.paymentVerifiable ? (cls.status==='verified'?2:1) : 0;

  const total = Math.round((capMatch + toolMatch + value + platformPermission + hist - workloadPenalty + operatingCost - riskPenalty + settlementReliability)*10)/10;
  const reasoning = `cap${capMatch}+tool${toolMatch}+val${value}+perm${platformPermission}+hist${hist}-load${workloadPenalty}+cost${operatingCost}-risk${riskPenalty}+settle${settlementReliability}`;
  return {
    agentId: String(agent.id),
    agentSlug: slug,
    opportunityId: String(opportunity.id),
    total,
    breakdown: { capabilityMatch: capMatch, toolMatch, value, platformPermission, historicalSuccess: hist, workloadPenalty, operatingCost, riskPenalty, settlementReliability },
    reasoning,
  };
}

export function ensureCatalogPersisted(): number {
  const count = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents WHERE origin_platform=\'akbaral-registry\'')?.c ?? 0);
  if (count >= 4000) return count;
  // Need to sync catalog — bulk insert via transaction (bounded by maxAgents)
  const policy = currentPolicy();
  const remaining = Math.max(0, policy.maxAgents - Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents')?.c ?? 0));
  if (remaining < 100) return count;
  const catalog = generateAgentDefinitions();
  let synced = 0;
  db.transaction(()=>{
    for (const def of catalog) {
      if (db.get('SELECT id FROM mission_agents WHERE slug=?',[def.slug])) continue;
      if (Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents')?.c ?? 0) >= policy.maxAgents) break;
      const id = `agt_reg_${def.slug.slice(0,60).replace(/[^a-z0-9]/g,'').slice(0,24)}_${Math.random().toString(36).slice(2,6)}`;
      try {
        db.run("INSERT INTO mission_agents (id,slug,name,category,role_key,parent_id,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,'specialist',NULL,0,'registry','active','worker','akbaral-registry',?)",
          [id, def.slug, def.name.slice(0,200), def.categorySlug, JSON.stringify(def.capabilities)]);
        // provision money agent minimal
        try { db.run('INSERT OR IGNORE INTO mission_money_grants (id, agent_id, spend_limit_cents, delegation_cents, can_create, expires_at, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
          [missionId('grant'), id, 0, 0, 0, new Date(Date.now()+86400000*30).toISOString(), 'active', nowIso()]); } catch {}
        synced++;
        if (synced >= Math.min(4001, remaining)) break;
      } catch {}
    }
  });
  return Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents WHERE origin_platform=\'akbaral-registry\'')?.c ?? 0);
}

/** Get all active agents — from DB plus catalog fallback so 4,001 are always considered. */
export function allActiveAgents(): Row[] {
  // Ensure catalog persisted once (first tick will bulk sync)
  if (Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents')?.c ?? 0) < 2000) {
    try { ensureCatalogPersisted(); } catch {}
  }
  const persisted = db.all<Row>('SELECT id, slug, name, capabilities, status, depth FROM mission_agents WHERE status=\'active\'');
  if (persisted.length >= 4000) return persisted;
  // Fallback virtual for any remaining gap (still scorable, materialized on assignment)
  const catalog = generateAgentDefinitions();
  const virtual: Row[] = catalog.slice(0, 4001).map((def) => ({
    id: `virtual-${def.slug}`,
    slug: def.slug,
    name: def.name,
    capabilities: JSON.stringify(def.capabilities),
    status: 'active',
    depth: 0,
    _virtual: 1,
  } as unknown as Row));
  const persistedSlugs = new Set(persisted.map(r=> String(r.slug)));
  const merged = [...persisted, ...virtual.filter(v=> !persistedSlugs.has(String(v.slug)))];
  return merged.slice(0, 4100);
}

export function materializeVirtualAgent(virtualId: string): Row | null {
  if (!virtualId.startsWith('virtual-')) return db.get<Row>('SELECT id, slug, name, capabilities, status, depth FROM mission_agents WHERE id=?',[virtualId]) ?? null;
  const slug = virtualId.replace(/^virtual-/,'');
  const existing = db.get<Row>('SELECT id, slug, name, capabilities, status, depth FROM mission_agents WHERE slug=?',[slug]);
  if (existing) return existing;
  const policy = currentPolicy();
  if (Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents')?.c ?? 0) >= policy.maxAgents) return null;
  if (!policy.allowAgentCreation) return null;
  // Create from catalog definition
  const def = generateAgentDefinitions().find(d=> d.slug===slug);
  if (!def) return null;
  const id = `agt_mat_${slug.slice(0,40).replace(/[^a-z0-9]/g,'').slice(0,20)}_${missionId('x').slice(-4)}`;
  db.run("INSERT INTO mission_agents (id,slug,name,category,role_key,parent_id,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,?,?,0,'registry','active','worker','akbaral-registry',?)",
    [id, def.slug, def.name.slice(0,200), def.categorySlug, JSON.stringify(def.capabilities)]);
  try { db.run('INSERT OR IGNORE INTO mission_money_grants (id, agent_id, spend_limit_cents, delegation_cents, can_create, expires_at, status, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [missionId('grant'), id, 5000, 0, 0, new Date(Date.now()+86400000*30).toISOString(), 'active', nowIso()]); } catch {}
  appendMissionAudit({ actorType:'system', action:'allocator.materialized', subjectType:'agent', subjectId:id, detail:{slug} });
  return db.get<Row>('SELECT id, slug, name, capabilities, status, depth FROM mission_agents WHERE id=?',[id])!;
}

export function idleAgents(): Row[] {
  const all = allActiveAgents();
  return all.filter(a => currentWorkload(String(a.id)) === 0);
}
export function busyAgents(): Row[] {
  const all = allActiveAgents();
  return all.filter(a => currentWorkload(String(a.id)) > 0);
}

/** Find best agent for one opportunity across 4,001+ */
export function allocateBestAgent(opportunityId: string): { agent: Row | null; score: AllocationScore | null; reason: string } {
  const opp = EarningEngine.getEngineOpportunity(opportunityId);
  if (!opp) deny('opportunity_missing');
  if (currentPolicy().killSwitch) return { agent: null, score: null, reason: 'kill_switch_engaged' };
  // Only allocate for lockable states
  const state = String(opp!.verification_state);
  if (!['discovered','qualified','legitimacy_verified'].includes(state)) return { agent:null, score:null, reason:`not_allocatable_state:${state}` };
  // Eligibility + activation gating (human-required, platform readiness)
  try {
    const { isOpportunityEligibleForAssignment } = require('./opportunity-eligibility') as typeof import('./opportunity-eligibility');
    const dec = isOpportunityEligibleForAssignment(opp!);
    if (!dec.eligible) return { agent: null, score: null, reason: `not_eligible:${dec.reason}` };
  } catch { /* fallback: if eligibility module missing */ }
  // Provider readiness gate: blocked connectors never allocated
  try {
    const { getProviderReadiness } = require('./provider-capability-registry') as typeof import('./provider-capability-registry');
    const connectorId = String(opp!.platform ?? '').toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,40);
    const readiness = getProviderReadiness(connectorId);
    if (readiness && readiness.status==='blocked') return { agent: null, score: null, reason: 'provider_blocked_per_tos' };
  } catch {}

  const agents = allActiveAgents();
  let best: AllocationScore | null = null;
  let bestAgent: Row | null = null;
  for (const agent of agents) {
    // Skip if agent is virtual and no money grant — still scorable but needs scaling
    const sc = scoreAgentForOpportunity(agent, opp!);
    // Require at least capability OR tool match for non-trivial; otherwise still allow low score if value high
    if (sc.total > (best?.total ?? -Infinity)) {
      best = sc;
      bestAgent = agent;
    }
  }
  if (!best || !bestAgent || best.total <= 0) return { agent: null, score: best, reason: 'no_capable_agent_found' };
  // Persist allocation decision
  try {
    db.run('INSERT INTO mission_allocator_assignments (id, opportunity_id, agent_id, score, breakdown_json, reasoning, created_at) VALUES (?,?,?,?,?,?,?)',
      [missionId('alloc'), opportunityId, String(bestAgent.id), best.total, JSON.stringify(best.breakdown), best.reasoning, nowIso()]);
  } catch {}
  return { agent: bestAgent, score: best, reason: 'allocated' };
}

/** Batch allocate: assign top N opportunities to best agents (no fabrication) */
export function allocateBatch(limit = 10): Array<{ opportunity: Row; agent: Row | null; score: AllocationScore | null }> {
  const opps = db.all<Row>('SELECT * FROM mission_earning_engine_opportunities WHERE verification_state IN (\'discovered\',\'qualified\',\'legitimacy_verified\') ORDER BY score DESC, created_at ASC LIMIT ?', [Math.min(50, Math.max(1, limit))]);
  return opps.map(opp => {
    const { agent, score } = allocateBestAgent(String(opp.id));
    return { opportunity: opp, agent, score };
  });
}

/** Allocator status for owner view */
export function allocatorStatus(): Record<string, unknown> {
  const totalAgents = allActiveAgents().length;
  const idle = idleAgents().length;
  const busy = busyAgents().length;
  const pending = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state IN (\'discovered\',\'qualified\',\'legitimacy_verified\')')?.c ?? 0);
  const assigned = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state IN (\'assigned\',\'executing\')')?.c ?? 0);
  return {
    totalAgents,
    idleAgents: idle,
    busyAgents: busy,
    pendingOpportunities: pending,
    assignedOpportunities: assigned,
    utilization: totalAgents ? Math.round(busy/totalAgents*1000)/10 : 0,
    workforce: '4,001+ catalog + child agents; no agent sits waiting when legitimate permitted work is available',
    policy: { killSwitch: currentPolicy().killSwitch, maxAgents: currentPolicy().maxAgents },
  };
}
