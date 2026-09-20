/**
 * ZA141251SA OWNER COMMAND CENTER — one view for the entire global earning network.
 * Shows: workforce, active/idle, opportunities, work in progress, completed, verified payments,
 * treasury, operating costs, ROI, agent performance, child-agent expansion, blocked/human-only,
 * owner actions required, payout status, system health.
 */

import { missionDb as db, verifyMissionAudit, type Row } from '../database';
import { currentPolicy } from '../policy';
import { OPPORTUNITY_REGISTRY } from './opportunity-registry';
import * as EarningEngine from './earning-engine';
import * as PlatformDiscovery from './platform-discovery';
import * as PlatformConnectors from './platform-connectors';
import * as GlobalDiscovery from './global-discovery';
import * as Allocator from './workload-allocator';
import * as Scheduler from './continuous-scheduler';
import { treasurySummary, verifyLedger, listWallets, listLedger } from '../treasury';
import { verifyLedger as verifyMoneyLedger } from '../treasury'; // alias
import { generateAgentDefinitions } from '../../agents/catalog';

export interface CommandCenterView {
  generatedAt: string;
  workforce: {
    catalogTotal: number; // 4001
    persistedAgents: number;
    activeAgents: number;
    idleAgents: number;
    busyAgents: number;
    childAgents: number;
    maxAgents: number;
    utilization: number;
  };
  opportunities: {
    total: number;
    byState: Record<string, number>;
    top: Array<{ id:string; registryKey:string; net:number; score:number; state:string }>;
    pending: number;
    assigned: number;
    executing: number;
    blockedHumanOnly: number;
  };
  workInProgress: {
    executing: number;
    verifying: number;
    providerConfirmPending: number;
  };
  completedWork: {
    verified: number;
    settled: number;
    failed: number;
  };
  verifiedPayments: {
    totalVerifiedNetCents: number;
    totalVerifiedUSD: string;
    realVerifiedUSD: string;
    byAgent: Array<{ agentId:string; verifiedNet:number }>;
  };
  treasury: ReturnType<typeof treasurySummary> & { wallets:number; ledgerOk:boolean };
  operatingCosts: {
    totalCostsCents: number;
    avgCostPerOpportunity: number;
  };
  roi: Array<{ key:string; attempts:number; successes:number; failures:number; net:number; successRate:number }>;
  agentPerformance: Array<{ agentId:string; slug:string; activeAssignments:number; verifiedNet:number }>;
  childExpansion: {
    totalScaled: number;
    recent: Array<{ registryKey:string; newAgentId:string; reason:string }>;
    policy: { allowAgentCreation:boolean; maxDepth:number; maxChildrenPerAgent:number };
  };
  discovery: {
    registryClasses: number;
    permittedAutonomous: number;
    totalPlatforms: number;
    earningSources: number;
    permittedSources: number;
    activeSources: number;
    humanOnlyRestricted: number;
    blocked: number;
    notEarning: number;
    recentRuns: Row[];
  };
  scheduler: Row & { tickRunning:boolean };
  allocator: ReturnType<typeof Allocator.allocatorStatus>;
  ownerActionsRequired: string[];
  payoutStatus: {
    verification: unknown;
    wallets: number;
    ledgerEntries: number;
  };
  systemHealth: {
    auditOk:boolean;
    ledgerOk:boolean;
    killSwitch:boolean;
    policy: ReturnType<typeof currentPolicy>;
  };
}

export function buildCommandCenter(): CommandCenterView {
  const policy = currentPolicy();
  const totalOpps = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities')?.c ?? 0);
  const byStateRows = db.all<Row>('SELECT verification_state as s, COUNT(*) as c FROM mission_earning_engine_opportunities GROUP BY verification_state');
  const byState: Record<string, number> = Object.fromEntries(byStateRows.map(r=>[String((r as any).s), Number((r as any).c)]));
  const top = EarningEngine.listEngineOpportunities(5).map(o=> ({ id:String(o.id), registryKey:String(o.registry_key), net:Number(o.net_cents), score:Number(o.score), state:String(o.verification_state) }));
  const pending = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state IN (\'discovered\',\'qualified\',\'legitimacy_verified\')')?.c ?? 0);
  const assigned = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state=\'assigned\'')?.c ?? 0);
  const executing = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state=\'executing\'')?.c ?? 0);
  const verified = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state=\'verified\'')?.c ?? 0);
  const settled = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state=\'settlement_verified\'')?.c ?? 0);
  const failed = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state=\'failed\'')?.c ?? 0);

  // Workforce
  const catalogTotal = generateAgentDefinitions().length; // 4001
  const persistedAgents = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents')?.c ?? 0);
  const activeAgents = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents WHERE status=\'active\'')?.c ?? 0);
  const childAgents = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_agents WHERE parent_id IS NOT NULL')?.c ?? 0);
  const allocStatus: any = Allocator.allocatorStatus();
  const idleAgents = allocStatus.idleAgents;
  const busyAgents = allocStatus.busyAgents;

  // Verified payments
  const totalVerified = EarningEngine.totalVerifiedEarnings();
  const byAgent = db.all<Row>('SELECT agent_id, SUM(net_cents) as n FROM mission_agent_earnings_ledger WHERE verified=1 GROUP BY agent_id ORDER BY n DESC LIMIT 5').map(r=> ({ agentId:String(r.agent_id), verifiedNet:Number(r.n) }));

  // Treasury
  const treasury = treasurySummary();
  const wallets = listWallets().length;
  const ledgerOk = verifyLedger().ok && verifyMoneyLedger().ok;

  // Operating costs
  const totalCosts = Number(db.get<Row>('SELECT COALESCE(SUM(expected_costs_cents),0) as s FROM mission_earning_engine_opportunities')?.s ?? 0);
  const avgCost = totalOpps ? Math.round(totalCosts/totalOpps) : 0;

  // ROI
  const roi = EarningEngine.listROI().map(r=> ({
    key:String(r.registry_key),
    attempts:Number(r.attempts),
    successes:Number(r.successes),
    failures:Number(r.failures),
    net:Number(r.total_net_cents),
    successRate: Number(r.attempts) ? Math.round(Number(r.successes)/Number(r.attempts)*1000)/10 : 0,
  }));

  // Agent performance (active assignments + verified net)
  const agentPerf = db.all<Row>('SELECT a.id, a.slug, (SELECT COUNT(*) FROM mission_earning_engine_opportunities o WHERE o.exclusive_agent_id=a.id AND o.verification_state IN (\'assigned\',\'executing\',\'verified\')) as activeAssignments, COALESCE((SELECT SUM(net_cents) FROM mission_agent_earnings_ledger l WHERE l.agent_id=a.id AND l.verified=1),0) as verifiedNet FROM mission_agents a WHERE a.status=\'active\' ORDER BY verifiedNet DESC, activeAssignments DESC LIMIT 10').map(r=> ({ agentId:String(r.id), slug:String(r.slug), activeAssignments:Number(r.activeAssignments), verifiedNet:Number(r.verifiedNet) }));

  // Child expansion
  const totalScaled = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_scaling_log')?.c ?? 0);
  const recentScaled = db.all<Row>('SELECT * FROM mission_earning_scaling_log ORDER BY created_at DESC LIMIT 5').map(s=> ({ registryKey:String(s.registry_key), newAgentId:String(s.new_agent_id), reason:String(s.scaling_reason) }));

  // Discovery stats
  const totalPlatforms = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_platforms')?.c ?? 0);
  const earningSources = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_platforms WHERE kind=\'EARNING_SOURCE\'')?.c ?? 0);
  const permittedSources = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_platforms WHERE status IN (\'PERMITTED\',\'ACTIVE\') AND kind=\'EARNING_SOURCE\'')?.c ?? 0);
  const activeSources = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_platforms WHERE status=\'ACTIVE\'')?.c ?? 0);
  const humanOnlyRestricted = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_platforms WHERE kind=\'RESTRICTED_HUMAN_ONLY\' OR status IN (\'RESTRICTED\',\'BLOCKED\')')?.c ?? 0);
  const blocked = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_platforms WHERE status=\'BLOCKED\'')?.c ?? 0);
  const notEarning = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_platforms WHERE kind IN (\'INFRASTRUCTURE\',\'PAYMENT_RAIL\',\'TOOL\',\'NOT_AN_EARNING_SOURCE\')')?.c ?? 0);
  const recentRuns = GlobalDiscovery.listGlobalDiscoveryRuns(5);

  const scheduler: any = Scheduler.schedulerStatus();
  const allocator = Allocator.allocatorStatus() as any;

  // Owner actions required
  const ownerActions: string[] = [];
  if (policy.killSwitch) ownerActions.push('Kill switch engaged — all earning paused (owner must clear)');
  if (db.get<Row>('SELECT 1 FROM mission_platforms WHERE status=\'PAYMENT_VERIFICATION_READY\' LIMIT 1')) ownerActions.push('Platforms ready for permit — owner must permit before ACTIVE');
  if (db.get<Row>('SELECT 1 FROM mission_earning_engine_opportunities WHERE verification_state=\'verified\' LIMIT 1')) ownerActions.push('Work verified — provider payment confirmation required');
  if (db.get<Row>('SELECT 1 FROM mission_earning_engine_opportunities WHERE verification_state=\'payment_confirmed\' LIMIT 1')) ownerActions.push('Provider confirmed — owner must reconcile USD settlement');
  const humanOnlyCount = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state IN (\'discovered\',\'qualified\') AND automation_permitted=0')?.c ?? 0);
  if (humanOnlyCount) ownerActions.push(`${humanOnlyCount} human-only opportunities require owner account/listing/payout tasks`);
  if (db.get<Row>('SELECT 1 FROM mission_platforms WHERE kind=\'EARNING_SOURCE\' AND status!=\'ACTIVE\' LIMIT 1')) ownerActions.push('New earning sources discovered — qualify/policy-review/permit steps pending');

  const payoutStatus = {
    verification: '4-slot payout verification required before any payout',
    wallets,
    ledgerEntries: Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_ledger')?.c ?? 0),
  };

  return {
    generatedAt: new Date().toISOString(),
    workforce: { catalogTotal, persistedAgents, activeAgents, idleAgents, busyAgents, childAgents, maxAgents: policy.maxAgents, utilization: allocStatus.utilization },
    opportunities: { total: totalOpps, byState, top, pending, assigned, executing, blockedHumanOnly: humanOnlyCount },
    workInProgress: { executing, verifying: verified, providerConfirmPending: Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_engine_opportunities WHERE verification_state=\'verified\'')?.c ?? 0) },
    completedWork: { verified, settled, failed },
    verifiedPayments: { totalVerifiedNetCents: totalVerified, totalVerifiedUSD: `$${(totalVerified/100).toFixed(2)}`, realVerifiedUSD: totalVerified===0 ? '$0.00 no genuine settlement yet' : `$${(totalVerified/100).toFixed(2)}`, byAgent },
    treasury: { ...treasury, wallets, ledgerOk } as any,
    operatingCosts: { totalCostsCents: totalCosts, avgCostPerOpportunity: avgCost },
    roi,
    agentPerformance: agentPerf,
    childExpansion: { totalScaled, recent: recentScaled, policy: { allowAgentCreation: policy.allowAgentCreation, maxDepth: policy.maxDepth, maxChildrenPerAgent: policy.maxChildrenPerAgent } },
    discovery: { registryClasses: OPPORTUNITY_REGISTRY.length, permittedAutonomous: PlatformConnectors.earningSources().filter(c=> c.apiPermitted && c.kind==='EARNING_SOURCE').length, totalPlatforms, earningSources, permittedSources, activeSources, humanOnlyRestricted, blocked, notEarning, recentRuns },
    scheduler,
    allocator,
    ownerActionsRequired: ownerActions.length ? ownerActions : ['All clear — scheduler continues discovery; no owner action required right now'],
    payoutStatus,
    systemHealth: { auditOk: verifyMissionAudit().ok, ledgerOk, killSwitch: policy.killSwitch, policy },
  };
}
