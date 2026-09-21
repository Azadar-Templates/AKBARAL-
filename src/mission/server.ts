import { CustomerWork, type CustomerRequestInput } from './earning/customer-work';
import { OpportunityDiscovery, type InboundOpportunityInput, type PermittedFeedItem } from './earning/opportunity-discovery';
import { OPPORTUNITY_REGISTRY, rankedOpportunities, permittedAutonomousClasses } from './earning/opportunity-registry';
import { autonomousDiscover, discoveryRankingSnapshot, pursuitInfrastructureStatus, canAssignExclusively, servicesForClass } from './earning/autonomous-discovery';
import * as EarningEngine from './earning/earning-engine';
import * as PlatformConnectors from './earning/platform-connectors';
import * as PlatformDiscovery from './earning/platform-discovery';
import * as GlobalDiscovery from './earning/global-discovery';
import * as Allocator from './earning/workload-allocator';
import * as Scheduler from './earning/continuous-scheduler';
import * as CommandCenter from './earning/owner-command-center';
import * as ProviderReadiness from './earning/provider-capability-registry';
import * as Eligibility from './earning/opportunity-eligibility';
import * as ConnectorContracts from './earning/connector-execution-contracts';
import * as ExecutionPipeline from './earning/execution-pipeline';
import * as SettlementVerification from './earning/settlement-verification';
import { configuredToptalWorkflow } from './earning/toptal-workflow';
import { configuredContraWorkflow } from './earning/contra-workflow';
import { configuredFiverrWorkflow } from './earning/fiverr-workflow';
import { configuredUpworkWorkflow } from './earning/upwork-workflow';
import { FreelancerError } from './earning/freelancer';
import { configuredFreelancerWorkflow, configuredFreelancerSettlementWorkflow } from './earning/freelancer-workflow';
import { AwinError } from './earning/awin';
import { configuredAwinWorkflow } from './earning/awin-workflow';
import { revokeOpportunity, agentMoneyOverview, listMoneyOperations, listEarningJobs, reconcileEarningPayment, cashAccount } from './money';
import { MoneyError, cancelMoney, listCashEntries, assertMoneyOwner, moneyOverview, bootstrapMoneyAgents, approveOpportunity, setMoneyGrant, allocateCash, freezeCash, requestMoney, decideMoney, verifyMoneyReceipt, dispatchMoney, reconcileMoney, provisionMoneyAgent, queueEarning, type MoneyActor } from './money';
import { configuredMoneyProvider } from './money-stripe';
import { recordResourcePeriod, listResourcePeriods, type ResourcePeriodInput } from './resource-periods';
import { agentChatConfig, configureAgentChat, listAgentChatJobs, type AgentChatConfig } from './chat-state';
import { recordResourceCallCost } from './resource-budgets';
import { listOwnerResourceCalls, cancelOwnerResourceCall, reconcileOwnerResourceCall } from './resource-calls';
import { bindResourceCredential } from './self-management';
import { appendAgentMessage, listAgentMessages } from './messaging';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import {
  missionDb,
  missionEnv,
  applyMissionMigrations,
  appendMissionAudit,
  verifyMissionAudit,
  missionId,
  nowIso,
  type Row,
} from './database';
import {
  MissionAuthError,
  assertCanMutate,
  createAccessLink,
  listAccessLinks,
  login,
  logout,
  ownerCount,
  provisionOwner,
  resolveAccessLink,
  resolveSession,
  revokeAccessLink,
  vaultConfigured,
  type SessionContext,
} from './auth';
import { identityLockStatus } from './identity-lock';
import {
  PAYOUT_VERIFICATION_CHECKS,
  PAYOUT_VERIFICATION_VALIDITY_DAYS,
  confirmPayoutVerification,
  listPayoutSlotVerificationStatuses,
  payoutSlotVerificationStatus,
  revokePayoutVerification,
  startPayoutVerification,
  sweepPayoutVerifications,
} from './payout-verification';
import {
  beginSocialAuthorization,
  completeSocialAuthorization,
  disconnectSocial,
  recordSocialAuthorizationFailure,
  socialPlatformStatuses,
} from './social';
import {
  MissionTreasuryError,
  configurePayoutSlot,
  createWallet,
  decidePayout,
  ensurePayoutSlots,
  listApprovals,
  listExpenses,
  listLedger,
  listPayouts,
  listRevenue,
  listWallets,
  recordRevenue,
  requestExpense,
  requestPayout,
  decideExpense,
  setPayoutSlotStatus,
  settlePayout,
  treasurySummary,
  verifyLedger,
  type Wallet,
  getWallet,
  walletForAgent,
  credit,
  setWalletBudget,
  reinvestmentSummary,
  sweepDailyTarget,
} from './treasury';
import {
  MissionSelfServiceError,
  credentialRotations,
  decideResource,
  provisionResource,
  resourceReadiness,
  decideToolRequest,
  decideUpgrade,
  applyUpgrade,
  expiringCredentials,
  listCredentials,
  listResources,
  listServices,
  listTools,
  listUpgrades,
  recordResourceUsage,
  recordServiceHealth,
  requestResource,
  requestTool,
  requestUpgrade,
  retireResource,
  revokeCredential,
  rotateCredential,
  selfManagementSnapshot,
  createService,
  seedTools,
  setToolStatus,
  storeCredential,
  sweepCredentialStatus,
} from './self-management';
import {
  checkActivity,
  currentPolicy,
  decideApproval,
  ensurePolicy,
  setKillSwitch,
  updatePolicy,
} from './policy';
import {
  buildAgentReport,
  buildMissionOverview,
  createTarget,
  findAgentById,
  findAgentBySlug,
  listReports,
  listTargets,
  snapshotAgentReport,
  updateTarget,
  activityCatalog, type AgentRow} from './reporting';

/**
 * ZA141251SA MISSION SERVER — a SEPARATE private application.
 *
 * Isolation from AKBARAL! is structural, not conventional:
 *   · separate process and port (ZA141251SA_PORT, default 4200)
 *   · separate database file/schema (ZA141251SA_DATABASE_URL)
 *   · separate authentication (mission-local scrypt owner + hashed sessions)
 *   · separate secrets (ZA141251SA_SESSION_SECRET / _CREDENTIAL_KEY)
 *   · loopback bind by default: nothing is publicly reachable unless the
 *     operator deliberately configures a private network/tunnel
 *   · zero imports from the AKBARAL! app: this server cannot read customer data
 *
 * Authorization model:
 *   owner session  → full read + governed mutation (mutations audited)
 *   operator session → read-only
 *   access link    → scoped (dashboard:read | agent:self) with expiry + use cap
 *   agent:self link → may only act for its bound agent, and only within that
 *                    agent's wallet budget, tool catalog and approval rules
 */

interface RequestContext {
  session: SessionContext | null;
  link: ReturnType<typeof resolveAccessLink>;
}

class HttpProblem extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage, limitBytes = 512 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new HttpProblem(413, 'request body too large', 'payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
      } catch {
        reject(new HttpProblem(400, 'request body must be valid JSON', 'validation_error'));
      }
    });
    req.on('error', (error) => reject(error));
  });
}

function bearer(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

function linkToken(req: http.IncomingMessage): string | null {
  const header = req.headers['x-mission-link'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

function requireOwner(context: RequestContext, mutation = false): SessionContext {
  if (!context.session) {
    throw new HttpProblem(401, 'mission sign-in required', 'unauthorized');
  }
  if (mutation) assertCanMutate(context.session);
  return context.session;
}

/** Agent-scoped authorization for the self-management surface. */
function requireAgent(context: RequestContext, agentSlugOrId: string | null, readOnly=false): { agentId: string; actorId: string; actorType: 'agent' } {
  // One enforcement point for every agent-initiated mutation (work, tools,
  // resources, services, upgrades, expenses): an agent that is not 'active'
  // cannot act. Pausing is therefore a real brake, not a label.
  const assertActive = (agent: AgentRow): void => {
    if (!readOnly && String(agent.status) !== 'active') {
      throw new HttpProblem(409, `agent ${agent.slug} is ${agent.status} — an operator paused it, so it cannot act until it is resumed`, 'agent_not_active');
    }
  };
  if (context.session) {
    const agent = agentSlugOrId ? (findAgentBySlug(agentSlugOrId) ?? findAgentById(agentSlugOrId)) : undefined;
    if (!agent) throw new HttpProblem(404, 'agent not found', 'not_found');
    assertActive(agent);
    return { agentId: agent.id, actorId: context.session.owner.id, actorType: 'agent' };
  }
  if (context.link) {
    if (context.link.link.scope !== 'agent:self' || !context.link.agentId) {
      throw new HttpProblem(403, 'this link is not authorised for agent actions', 'forbidden');
    }
    if (agentSlugOrId) {
      const requested = findAgentBySlug(agentSlugOrId) ?? findAgentById(agentSlugOrId);
      if (!requested || requested.id !== context.link.agentId) {
        // A link may only ever act for the agent it is bound to.
        throw new HttpProblem(403, 'this link is bound to a different agent', 'forbidden');
      }
      assertActive(requested);
    } else {
      const bound = findAgentById(context.link.agentId);
      if (bound) assertActive(bound);
    }
    return { agentId: context.link.agentId, actorId: context.link.agentId, actorType: 'agent' };
  }
  throw new HttpProblem(401, 'a mission session or agent link is required', 'unauthorized');
}

/** Read access: owner, operator session, or a scoped link. */
/**
 * The public base URL of this mission deployment: used to build OAuth redirect
 * URIs, which must match byte-for-byte what is registered with the platform.
 * Explicit configuration wins; otherwise the request's own host is used so a
 * tunnel/proxy deployment still produces a correct redirect URI.
 */
function missionSiteUrl(req: http.IncomingMessage): string {
  const configured = (process.env.ZA141251SA_SITE_URL ?? process.env.AKBARAL_SITE_URL ?? '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const host = String(req.headers.host ?? '127.0.0.1:4200');
  const proto = forwardedProto || (host.startsWith('127.0.0.1') || host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function requireRead(context: RequestContext): void {
  if (context.session || context.link) return;
  throw new HttpProblem(401, 'mission sign-in or a valid access link is required', 'unauthorized');
}

// ─────────────────────────────────────────────────────────────────────────────
// Static dashboard (private assets, never served by the public AKBARAL! app)
// ─────────────────────────────────────────────────────────────────────────────

function dashboardDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'mission-dashboard'),
    path.resolve(__dirname, '../../../mission-dashboard'),
    path.resolve(__dirname, '../../../../mission-dashboard'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(res: http.ServerResponse, urlPath: string): boolean {
  const dir = dashboardDir();
  if (!dir) return false;
  const relative = urlPath === '/' || urlPath === '' ? 'index.html' : urlPath.replace(/^\/+/, '');
  // Path traversal is impossible: only the basename inside the dashboard dir.
  const safe = relative.split('/').filter((segment) => segment !== '..' && segment !== '.').join('/');
  const file = path.join(dir, safe);
  if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
  });
  res.end(fs.readFileSync(file));
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  context: RequestContext,
): Promise<boolean> {
  const method = (req.method ?? 'GET').toUpperCase();
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const [head, ...rest] = segments;
  const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await readBody(req) : {};
  const param = (key: string, fallback: string | null = null): string | null => {
    const value = body[key];
    if (value === undefined || value === null) return fallback;
    return String(value);
  };
  const num = (key: string, fallback = 0): number => {
    const value = Number(body[key]);
    return Number.isFinite(value) ? value : fallback;
  };

  if (head === 'customer-work') {
    const resolveActor = (): MoneyActor => {
      if (context.session) return {kind:'owner',id:requireOwner(context,method !== 'GET').owner.id};
      if (context.link && (context.link as any).link?.scope==='agent:self' && ((context.link as any).link?.agentId || (context.link as any).agentId)) return {kind:'agent',id:((context.link as any).link?.agentId || (context.link as any).agentId)};
      if (context.link && (context.link as any).scope==='agent:self' && (context.link as any).agentId) return {kind:'agent',id:(context.link as any).agentId};
      throw new HttpProblem(401,'mission sign-in or agent link required','unauthorized');
    };
    const work = new CustomerWork();
    if(method === 'GET' && rest.length === 0){
      // Overview remains owner-only per original isolation test; agents use POST /discover for autonomous discovery
      const actor: MoneyActor = {kind:'owner',id:requireOwner(context,false).owner.id};
      json(res,200,work.overview(actor));return true;
    }
    if(method === 'GET' && rest.length === 1){
      const actor: MoneyActor = {kind:'owner',id:requireOwner(context,false).owner.id};
      json(res,200,work.detail(actor,rest[0]));return true;
    }
    if(method !== 'POST') throw new HttpProblem(405,'use POST','method_not_allowed');
    if(rest.length !== 1) throw new HttpProblem(404,'unknown customer-work command','not_found');
    let result: unknown;
    const actor=resolveActor();
    switch(rest[0]){
      case 'listing': result=work.listing(actor,param('serviceId','')!,num('quoteCents'));break;
      case 'preview': result=work.preview(actor,param('serviceId','')!,param('input','')!,body.configuration??null,body.dataRightsReviewed===true,body.nonSensitiveDataOnly===true);break;
      case 'record': result=work.record(actor,body as unknown as CustomerRequestInput);break;
      case 'response': result=work.response(actor,param('requestId','')!);break;
      case 'stop': result=work.stop(actor,param('requestId','')!,param('reasonRef','')!);break;
      case 'bind': result=work.bind(actor,param('requestId','')!,param('connector','')!,param('workId','')!,param('identityReviewRef')??undefined);break;
      case 'produce': result=work.produce(actor,param('requestId','')!,param('input','')!);break;
      case 'verify': result=work.verify(actor,param('requestId','')!);break;
      case 'approve': result=work.approve(actor,param('requestId','')!,param('artifactHash','')!,param('qualityRef','')!);break;
      case 'discover': result=work.discover(actor,num('limit')||20);break;
      case 'qualify': result=work.qualify(actor,param('requestId','')!);break;
      default: throw new HttpProblem(404,'unknown customer-work command','not_found');
    }
    json(res,200,{result});return true;
  }

  if (head === 'discovery') {
    const discovery = new OpportunityDiscovery();
    // Inbound ingestion is public: real customer-initiated request with explicit consent.
    // No owner session required; validated and deduplicated, never counted as revenue.
    if (rest[0]==='ingest-inbound' && method==='POST') {
      const input = body as unknown as InboundOpportunityInput;
      const result = discovery.ingestInbound(input);
      json(res,201,{result, note:'Inbound opportunity retained with source/evidence/dedup; not revenue. Await qualification and owner promotion.'});return true;
    }
    if (rest[0]==='ingest-feed' && method==='POST') {
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      const items = Array.isArray(body.items) ? body.items as PermittedFeedItem[] : [];
      const result = discovery.ingestPermittedFeed(actor, items);
      json(res,200,{result});return true;
    }
    // discover / qualify allow agent autonomously when permitted
    if (rest[0]==='discover' && method==='POST') {
      const resolveActor = (): MoneyActor => {
        if (context.session) return {kind:'owner', id: requireOwner(context, method!=='GET').owner.id};
        if (context.link && (context.link as any).link?.scope==='agent:self' && ((context.link as any).link?.agentId || (context.link as any).agentId)) return {kind:'agent', id: ((context.link as any).link?.agentId || (context.link as any).agentId)};
        if (context.link && (context.link as any).scope==='agent:self' && (context.link as any).agentId) return {kind:'agent', id: (context.link as any).agentId};
        throw new HttpProblem(401,'mission sign-in or agent link required','unauthorized');
      };
      const actor = resolveActor();
      const result = discovery.discover(actor, Number(body.limit ?? 20));
      json(res,200,{result});return true;
    }
    if (rest[0]==='qualify' && method==='POST') {
      const resolveActor = (): MoneyActor => {
        if (context.session) return {kind:'owner', id: requireOwner(context,true).owner.id};
        if (context.link && (context.link as any).link?.scope==='agent:self' && ((context.link as any).link?.agentId || (context.link as any).agentId)) return {kind:'agent', id: ((context.link as any).link?.agentId || (context.link as any).agentId)};
        if (context.link && (context.link as any).scope==='agent:self' && (context.link as any).agentId) return {kind:'agent', id: (context.link as any).agentId};
        throw new HttpProblem(401,'mission sign-in or agent link required','unauthorized');
      };
      const actor = resolveActor();
      const result = discovery.qualify(actor, String(body.id ?? body.opportunityId ?? ''));
      json(res,200,{result});return true;
    }
    if (rest[0]==='promote' && method==='POST') {
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      const result = discovery.promote(actor, String(body.id ?? body.opportunityId ?? ''), body.identityReviewRef? String(body.identityReviewRef): undefined);
      json(res,201,{result});return true;
    }
    if (rest[0]==='dismiss' && method==='POST') {
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      const result = discovery.dismiss(actor, String(body.id ?? body.opportunityId ?? ''), String(body.reasonRef ?? 'owner_dismissed'));
      json(res,200,{result});return true;
    }
    if (method==='GET' && rest.length===0) {
      requireRead(context);
      const rows = discovery.list(Number(url.searchParams.get('limit') ?? 20));
      json(res,200,{opportunities: rows, count: rows.length, verifiedCustomerCount:0, note:'Discovered opportunities are not revenue; only verified USD settlement counts.'});return true;
    }
    // Inventory & autonomous infrastructure — factual, no income claim
    if (method==='GET' && rest[0]==='inventory' && rest.length===1) {
      requireRead(context);
      const ranked = rankedOpportunities();
      json(res,200,{totalClasses: ranked.length, inventory: ranked.map(o=> ({key:o.key,label:o.label,overallScore:o.overallScore,status:o.status,autonomousPermitted:o.autonomousPermitted,paymentVerifiable:o.paymentVerifiable,exclusivelyAssignable:o.exclusivelyAssignable,services:servicesForClass(o.key),integrations:o.integrations.slice(0,6),representativePlatforms:o.representativePlatforms})), note:'Integrations are infrastructure, not earning claims; no listing is a job; no estimate is revenue.'});return true;
    }
    if (method==='GET' && rest[0]==='ranking' && rest.length===1) {
      requireRead(context);
      json(res,200,{ranking: discoveryRankingSnapshot(Number(url.searchParams.get('limit') ?? 10))});return true;
    }
    if (method==='GET' && rest[0]==='permitted' && rest.length===1) {
      requireRead(context);
      const permitted = permittedAutonomousClasses();
      json(res,200,{permitted, count: permitted.length, note:'Only these classes may be autonomously pursued with existing verified-money chain; others require owner account + payout verification.'});return true;
    }
    if (method==='GET' && rest[0]==='infrastructure' && rest.length===1) {
      requireRead(context);
      json(res,200,pursuitInfrastructureStatus());return true;
    }
    if (rest[0]==='autonomous' && method==='POST') {
      const resolveActor = (): MoneyActor => {
        if (context.session) return {kind:'owner', id: requireOwner(context, method!=='GET').owner.id};
        if (context.link && (context.link as any).link?.scope==='agent:self' && ((context.link as any).link?.agentId || (context.link as any).agentId)) return {kind:'agent', id: ((context.link as any).link?.agentId || (context.link as any).agentId)};
        if (context.link && (context.link as any).scope==='agent:self' && (context.link as any).agentId) return {kind:'agent', id: (context.link as any).agentId};
        throw new HttpProblem(401,'mission sign-in or agent link required','unauthorized');
      };
      const actor = resolveActor();
      const result = autonomousDiscover(actor, Number(body.limit ?? 20));
      json(res,200,{result});return true;
    }
    if (rest[0]==='can-assign' && method==='GET' && rest.length===2) {
      requireRead(context);
      json(res,200,canAssignExclusively(String(rest[1])));return true;
    }
    if (method==='GET' && rest.length===1) {
      requireRead(context);
      const row = discovery.get(String(rest[0]));
      if(!row) throw new HttpProblem(404,'opportunity not found','not_found');
      json(res,200,{opportunity: row});return true;
    }
    throw new HttpProblem(404,'unknown discovery command','not_found');
  }

  if (head === 'platforms') {
    const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
    if(method==='GET' && rest.length===0){
      requireRead(context);
      json(res,200,{platforms: PlatformDiscovery.listPlatforms(Number(url.searchParams.get('limit')??100)), connectors: PlatformConnectors.listConnectors().slice(0,60)});
      return true;
    }
    if(method==='GET' && rest[0]==='connectors'){
      requireRead(context);
      json(res,200,{earningSources: PlatformConnectors.earningSources(), infrastructure: PlatformConnectors.infrastructureConnectors().slice(0,20), paymentRails: PlatformConnectors.paymentRails()});
      return true;
    }
    if(method==='GET' && rest[1]==='status'){
      requireRead(context);
      const p = PlatformDiscovery.getPlatform(rest[0]);
      if(!p) throw new HttpProblem(404,'platform not found','not_found');
      json(res,200,{platform: p, log: missionDb.all<Row>('SELECT * FROM mission_platform_discovery_log WHERE platform_id=? ORDER BY created_at DESC LIMIT 20',[rest[0]])});
      return true;
    }
    if(method!=='POST') throw new HttpProblem(405,'use POST','method_not_allowed');
    if(rest[0]==='discover'){
      json(res,201,{platform: PlatformDiscovery.discoverPlatform({id:String(body.id??''), label:String(body.label??''), kind: body.kind as any, opportunityClass: body.opportunityClass? String(body.opportunityClass): undefined, officialUrl:String(body.officialUrl??''), evidence:String(body.evidence??''), payoutVerifiable:Boolean(body.payoutVerifiable), apiPermitted:Boolean(body.apiPermitted), humanOnlyActions: Array.isArray(body.humanOnlyActions)? body.humanOnlyActions as string[]: []})});
      return true;
    }
    if(rest[0]==='qualify'){ json(res,200,{platform: PlatformDiscovery.qualifyPlatform(String(body.id??rest[1]??''), actor)}); return true; }
    if(rest[0]==='policy-review'){ json(res,200,{platform: PlatformDiscovery.submitForPolicyReview(String(body.id??rest[1]??''), actor)}); return true; }
    if(rest[0]==='payment-ready'){ json(res,200,{platform: PlatformDiscovery.markPaymentVerificationReady(String(body.id??rest[1]??''), actor)}); return true; }
    if(rest[0]==='permit'){ json(res,200,{platform: PlatformDiscovery.permitPlatform(String(body.id??rest[1]??''), actor)}); return true; }
    if(rest[0]==='activate'){ json(res,200,{platform: PlatformDiscovery.activatePlatform(String(body.id??rest[1]??''), actor)}); return true; }
    throw new HttpProblem(404,'unknown platform command','not_found');
  }

  if (head === 'global-discovery') {
    if(method==='GET' && rest.length===0){
      requireRead(context);
      json(res,200,{categories: GlobalDiscovery.GLOBAL_CATEGORIES, candidates: GlobalDiscovery.GENERIC_CANDIDATES.slice(0,20), runs: GlobalDiscovery.listGlobalDiscoveryRuns(5)});
      return true;
    }
    if(method==='POST' && rest[0]==='discover'){
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      const result = GlobalDiscovery.runGlobalDiscoveryCycle(actor, Number(body.limit ?? 6));
      json(res,201,{result, note:'Generic discovery beyond 57 connectors; each source independently classified before use'});
      return true;
    }
    if(method==='POST' && rest[0]==='ingest'){
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      const src = body as unknown as GlobalDiscovery.GenericSource;
      json(res,201,{platform: GlobalDiscovery.ingestGenericSource(actor, {id:String(src.id), label:String(src.label), category:String(src.category), opportunityClass: src.opportunityClass? String(src.opportunityClass): undefined, officialUrl:String(src.officialUrl), evidence:String(src.evidence), payoutVerifiable:Boolean(src.payoutVerifiable), apiPermitted:Boolean(src.apiPermitted), humanOnlyActions: Array.isArray(src.humanOnlyActions)? src.humanOnlyActions as string[]: []})});
      return true;
    }
    throw new HttpProblem(404,'unknown global-discovery command','not_found');
  }

  if (head === 'allocator') {
    if(method==='GET' && rest.length===0){
      requireRead(context);
      json(res,200, Allocator.allocatorStatus());
      return true;
    }
    if(method==='POST' && rest[0]==='allocate' && rest[1]){
      requireRead(context);
      const result = Allocator.allocateBestAgent(String(rest[1]));
      json(res,200,{result});
      return true;
    }
    if(method==='POST' && rest[0]==='batch'){
      requireRead(context);
      json(res,200,{assignments: Allocator.allocateBatch(Number(body.limit ?? 5))});
      return true;
    }
    if(method==='GET' && rest[0]==='idle'){
      requireRead(context);
      json(res,200,{idle: Allocator.idleAgents().slice(0,20), count: Allocator.idleAgents().length});
      return true;
    }
    throw new HttpProblem(404,'unknown allocator command','not_found');
  }

  if (head === 'scheduler') {
    if(method==='GET' && rest.length===0){
      requireRead(context);
      json(res,200,{state: Scheduler.schedulerStatus(), ticks: Scheduler.listSchedulerTicks(5)});
      return true;
    }
    if(method==='POST' && rest[0]==='tick'){
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      json(res,200,{result: Scheduler.tickScheduler(actor)});
      return true;
    }
    if(method==='POST' && rest[0]==='enable'){
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      json(res,200,{state: Scheduler.enableScheduler(actor)});
      return true;
    }
    if(method==='POST' && rest[0]==='disable'){
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      json(res,200,{state: Scheduler.disableScheduler(actor)});
      return true;
    }
    if(method==='POST' && rest[0]==='start-auto'){
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      Scheduler.startAutoScheduler(actor, Number(body.intervalMs ?? 60000));
      json(res,200,{state: Scheduler.schedulerStatus(), note:'Auto scheduler started; ticks every intervalMs'});
      return true;
    }
    if(method==='POST' && rest[0]==='stop-auto'){
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      Scheduler.stopAutoScheduler(actor);
      json(res,200,{state: Scheduler.schedulerStatus()});
      return true;
    }
    throw new HttpProblem(404,'unknown scheduler command','not_found');
  }

  if (head === 'command-center') {
    requireRead(context);
    json(res,200, CommandCenter.buildCommandCenter());
    return true;
  }

  if (head === 'provider-readiness') {
    requireRead(context);
    if (method==='GET' && rest.length===0) {
      const kind = url.searchParams.get('kind') ?? undefined;
      if (url.searchParams.get('summary')==='1') json(res,200, ProviderReadiness.providerReadinessSummary());
      else json(res,200, { readiness: kind ? ProviderReadiness.listProviderReadiness(kind) : ProviderReadiness.listProviderReadiness(), summary: ProviderReadiness.providerReadinessSummary() });
      return true;
    }
    if (method==='GET' && rest.length===1) {
      const r = ProviderReadiness.getProviderReadiness(rest[0]);
      if (!r) throw new HttpProblem(404,'provider not found','not_found');
      json(res,200,{readiness: r}); return true;
    }
    // Eligible: returns whether provider's connector is ready for assignment
    if (method==='GET' && rest.length===2 && rest[1]==='eligible') {
      const r = ProviderReadiness.getProviderReadiness(rest[0]);
      if (!r) throw new HttpProblem(404,'provider not found','not_found');
      const eligible = r.status==='ready';
      json(res,200,{providerId: rest[0], eligible, readiness: r, blockers: eligible?[]: r.ownerActions}); return true;
    }
    if (method==='POST' && rest[1]==='failure') {
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      void actor;
      const cat = String(body.category ?? 'transient') as any;
      const row = ProviderReadiness.recordProviderFailure(rest[0], {code: String(body.code ?? 'unknown'), category: cat, detail: body.detail? String(body.detail): undefined, retryAfterMs: body.retryAfterMs? Number(body.retryAfterMs): undefined});
      json(res,201,{failure: row}); return true;
    }
    if (method==='POST' && rest[1]==='recover') {
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      void actor;
      const n = ProviderReadiness.clearProviderFailures(rest[0]);
      json(res,200,{recovered: n}); return true;
    }
    throw new HttpProblem(404,'unknown provider-readiness command','not_found');
  }

  if (head === 'eligibility') {
    requireRead(context);
    if (method==='GET' && rest.length===0) {
      const registryKey = String(url.searchParams.get('registryKey') ?? body.registryKey ?? '');
      const platformId = String(url.searchParams.get('platformId') ?? body.platformId ?? '');
      if (!registryKey) throw new HttpProblem(400,'registryKey required','validation_error');
      json(res,200, Eligibility.eligibilityDecision(registryKey, platformId||undefined)); return true;
    }
    if (method==='GET' && rest[0]==='opportunities') {
      json(res,200, Eligibility.listEligibleOpportunities(Number(url.searchParams.get('limit')??20))); return true;
    }
    if (method==='GET' && rest.length===1) {
      const dec = Eligibility.canAssignExclusivelyWithGate(rest[0]);
      json(res,200, dec); return true;
    }
    throw new HttpProblem(404,'unknown eligibility command','not_found');
  }

  if (head === 'connector-contracts') {
    requireRead(context);
    if (method==='GET' && rest.length===0) {
      json(res,200,{contracts: ConnectorContracts.listConnectorContracts(), count: ConnectorContracts.listConnectorContracts().length}); return true;
    }
    if (method==='GET' && rest.length===1) {
      const c = ConnectorContracts.getConnectorContract(rest[0]);
      if (!c) throw new HttpProblem(404,'contract not found','not_found');
      json(res,200,{contract: c}); return true;
    }
    throw new HttpProblem(404,'unknown connector-contracts command','not_found');
  }

  if (head === 'executions') {
    requireRead(context);
    if (method==='GET' && rest.length===0) {
      const filter: Record<string,string> = {};
      const oppId = url.searchParams.get('opportunityId');
      const agentId = url.searchParams.get('agentId');
      const state = url.searchParams.get('state');
      if (oppId) filter.opportunityId = oppId;
      if (agentId) filter.agentId = agentId;
      if (state) filter.state = state;
      json(res,200,{executions: ExecutionPipeline.listExecutions(filter as any), health: ExecutionPipeline.executionPipelineHealth()}); return true;
    }
    if (method==='GET' && rest.length===1) {
      const row = missionDb.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [rest[0]]);
      if (!row) throw new HttpProblem(404,'execution not found','not_found');
      json(res,200,{execution: row}); return true;
    }
    if (method!=='POST') throw new HttpProblem(405,'use POST','method_not_allowed');
    if (rest[0]==='health') { json(res,200, ExecutionPipeline.executionPipelineHealth()); return true; }
    if (rest[0]==='retry-due') { json(res,200,{retried: ExecutionPipeline.retryDueExecutions(Number(body.limit ?? 10))}); return true; }
    if (rest[0]==='start') {
      const actor = context.session ? {kind:'owner', id: requireOwner(context,true).owner.id} as MoneyActor : (()=>{ const a=requireAgent(context, String(body.agentId ?? ''), false); return {kind:'agent', id:a.agentId} as MoneyActor })();
      void actor;
      const row = ExecutionPipeline.startExecution({opportunityId: String(body.opportunityId ?? ''), agentId: String(body.agentId ?? (actor.kind==='agent'? actor.id: '')), connectorId: body.connectorId ? String(body.connectorId): undefined, scopeHash: body.scopeHash ? String(body.scopeHash): undefined});
      json(res,201,{execution: row}); return true;
    }
    if (rest[0]==='complete') {
      const row = ExecutionPipeline.completeExecution(String(body.executionId ?? ''), {delivered: Boolean(body.delivered), evidenceHash: body.evidenceHash ? String(body.evidenceHash): undefined});
      json(res,200,{execution: row}); return true;
    }
    if (rest[0]==='verify') {
      const verifiers = Array.isArray(body.verifiers) ? body.verifiers as Array<{agentId:string; confidence:number; passed:boolean}> : [];
      const result = ExecutionPipeline.verifyExecution(String(body.executionId ?? ''), verifiers);
      json(res,200, result); return true;
    }
    if (rest[0]==='provider-confirm') {
      const row = ExecutionPipeline.confirmProviderPayment(String(body.executionId ?? ''), String(body.providerRef ?? ''), {grossCents: Number(body.grossCents), feesCents: Number(body.feesCents ?? 0), netCents: Number(body.netCents)});
      json(res,200,{execution: row}); return true;
    }
    if (rest[0]==='settle') {
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      const row = ExecutionPipeline.settleExecution({executionId: String(body.executionId ?? ''), actor, rail: String(body.rail ?? ''), externalId: String(body.externalId ?? ''), grossCents: Number(body.grossCents), feeCents: Number(body.feeCents ?? 0), netCents: Number(body.netCents), providerRef: body.providerRef ? String(body.providerRef): undefined});
      json(res,200,{execution: row}); return true;
    }
    if (rest[0]==='fail') {
      const row = ExecutionPipeline.failExecutionWithRetry(String(body.executionId ?? ''), String(body.code ?? 'unknown'), String(body.category ?? 'transient') as any);
      json(res,200,{execution: row}); return true;
    }
    throw new HttpProblem(404,'unknown executions command','not_found');
  }

  if (head === 'settlement-verifications') {
    requireRead(context);
    if (method==='GET' && rest.length===0) {
      const oppId = url.searchParams.get('opportunityId') ?? undefined;
      json(res,200,{verifications: SettlementVerification.listSettlementVerifications(oppId ?? undefined)}); return true;
    }
    if (method==='GET' && rest.length===1) {
      const rows = SettlementVerification.listSettlementVerifications(rest[0]);
      json(res,200,{verifications: rows}); return true;
    }
    if (method==='POST' && rest[0]==='verify') {
      const actor: MoneyActor = {kind:'owner', id: requireOwner(context,true).owner.id};
      const result = SettlementVerification.verifySettlementAgainstProvider({opportunityId: String(body.opportunityId ?? ''), rail: String(body.rail ?? ''), externalId: String(body.externalId ?? ''), providerRef: body.providerRef ? String(body.providerRef): null, grossCents: Number(body.grossCents), feeCents: Number(body.feeCents ?? 0), netCents: Number(body.netCents), executionId: body.executionId ? String(body.executionId): null, actor});
      json(res,201,result); return true;
    }
    throw new HttpProblem(404,'unknown settlement-verifications command','not_found');
  }

  if (head === 'earning-engine') {
    // 17-component HIGH-VALUE USD MODE — owner dashboard + verified payout
    const resolveMoneyActor = (): MoneyActor => {
      if(context.session) return {kind:'owner', id: requireOwner(context, method!=='GET').owner.id};
      if(context.link && (context.link as any).link?.scope==='agent:self' && ((context.link as any).link?.agentId || (context.link as any).agentId)) return {kind:'agent', id: ((context.link as any).link?.agentId || (context.link as any).agentId)};
      if(context.link && (context.link as any).scope==='agent:self' && (context.link as any).agentId) return {kind:'agent', id: (context.link as any).agentId};
      throw new HttpProblem(401,'mission sign-in or agent link required','unauthorized');
    };
    const ownerActor = (): MoneyActor => ({kind:'owner', id: requireOwner(context,true).owner.id});
    // GET /api/earning-engine/dashboard — owner ledger + opportunity states
    if(method==='GET' && rest[0]==='dashboard'){
      requireRead(context);
      json(res,200,EarningEngine.ownerDashboard()); return true;
    }
    if(method==='GET' && rest[0]==='analytics'){
      requireRead(context);
      json(res,200,EarningEngine.earningsAnalytics()); return true;
    }
    if(method==='GET' && rest[0]==='roi'){
      requireRead(context);
      json(res,200,{roi: EarningEngine.listROI()}); return true;
    }
    if(method==='GET' && rest[0]==='learnings'){
      requireRead(context);
      json(res,200,{learnings: EarningEngine.listLearnings(String(url.searchParams.get('registryKey')??'' ) || undefined)}); return true;
    }
    if(method==='GET' && rest[0]==='opportunities'){
      requireRead(context);
      json(res,200,{opportunities: EarningEngine.listEngineOpportunities(Number(url.searchParams.get('limit')??20))}); return true;
    }
    if(method==='GET' && rest[0]==='earnings' && rest[1]){
      requireRead(context);
      json(res,200,EarningEngine.getAgentEarnings(rest[1])); return true;
    }
    if(method==='GET' && rest.length===2){
      requireRead(context);
      const row = EarningEngine.getEngineOpportunity(rest[0]);
      if(!row) throw new HttpProblem(404,'opportunity not found','not_found');
      json(res,200,{opportunity: row, score: EarningEngine.scoreOpportunity(rest[0])}); return true;
    }
    if(method!=='POST') throw new HttpProblem(405,'use POST','method_not_allowed');
    // POST /api/earning-engine/discover
    if(rest[0]==='discover'){
      const actor = resolveMoneyActor();
      const expiry = String(body.opportunityExpiry ?? new Date(Date.now()+ 7*24*3600*1000).toISOString());
      const result = EarningEngine.discoverOpportunity({
        registryKey: String(body.registryKey??''),
        provider: String(body.provider??''),
        platform: String(body.platform??''),
        grossCents: Number(body.grossCents),
        expectedFeesCents: Number(body.expectedFeesCents ?? 0),
        expectedCostsCents: Number(body.expectedCostsCents ?? 0),
        paymentMethod: String(body.paymentMethod??''),
        settlementEvidence: String(body.settlementEvidence??''),
        opportunityExpiry: expiry,
        evidenceJson: body.evidenceJson as Record<string,unknown>|undefined,
        source: body.source as any,
        brief: body.brief? String(body.brief): undefined,
      });
      void actor;
      json(res,201,{result}); return true;
    }
    if(rest[0]==='match' && rest[1]){
      json(res,200,EarningEngine.matchBestAgent(rest[1], body.candidateAgentIds as string[]|undefined)); return true;
    }
    if(rest[0]==='lock' && rest[1]){
      const actor = resolveMoneyActor();
      // actor must be owner or the agent being locked
      const agentId = String(body.agentId ?? (actor.kind==='agent'? actor.id : ''));
      if(!agentId) throw new HttpProblem(400,'agentId required','validation_error');
      json(res,200,{result: EarningEngine.lockOpportunityExclusive(rest[1], agentId)}); return true;
    }
    if(rest[0]==='unlock' && rest[1]){
      const actor = ownerActor();
      EarningEngine.unlockOpportunity(rest[1], actor);
      json(res,200,{result:{unlocked:true}}); return true;
    }
    if(rest[0]==='schedule' && rest[1]){
      const actor = resolveMoneyActor();
      const agentId = String(body.agentId ?? (actor.kind==='agent'? actor.id : ''));
      json(res,200,{result: EarningEngine.scheduleWork(rest[1], agentId)}); return true;
    }
    if(rest[0]==='verify' && rest[1]){
      const verifiers = (Array.isArray(body.verifiers)? body.verifiers: []) as Array<{agentId:string; confidence:number; passed:boolean}>;
      json(res,200,{result: EarningEngine.verifyWorkMultiAgent(rest[1], verifiers)}); return true;
    }
    if(rest[0]==='provider-confirm' && rest[1]){
      json(res,200,{result: EarningEngine.verifyProviderPayment(rest[1], {
        providerRef: String(body.providerRef??''),
        grossCents: Number(body.grossCents),
        feesCents: Number(body.feesCents ?? 0),
        netCents: Number(body.netCents),
        evidenceUrl: body.evidenceUrl? String(body.evidenceUrl): undefined,
      })}); return true;
    }
    if(rest[0]==='reconcile' && rest[1]){
      const actor = ownerActor();
      json(res,200,{result: EarningEngine.reconcileSettlement(rest[1], actor, {
        externalId: String(body.externalId??''),
        rail: String(body.rail??''),
        grossCents: Number(body.grossCents),
        feeCents: Number(body.feeCents ?? 0),
        netCents: Number(body.netCents),
      })}); return true;
    }
    if(rest[0]==='fail' && rest[1]){
      json(res,200,{result: EarningEngine.recordFailure(rest[1], String(body.reason??'unspecified'))}); return true;
    }
    if(rest[0]==='scale'){
      const actor = ownerActor();
      void actor;
      const result = EarningEngine.scaleWinningClass(String(body.registryKey??''), String(body.sourceOpportunityId??''), String(body.parentAgentId??''), String(body.newAgentName??''));
      if((result as any).skipped) json(res,409,{result}); else json(res,201,{result});
      return true;
    }
    if(rest[0]==='register-class'){
      const actor = ownerActor();
      json(res,201,{result: EarningEngine.registerNewOpportunityClass(actor, body as any)}); return true;
    }
    throw new HttpProblem(404,'unknown earning-engine command','not_found');
  }

  if (head === 'toptal') {
    const actor: MoneyActor = { kind: 'owner', id: requireOwner(context, method !== 'GET').owner.id };
    const workflow = configuredToptalWorkflow();
    if (method === 'GET' && !rest.length) { json(res, 200, workflow.overview(actor)); return true; }
    if (method !== 'POST') throw new HttpProblem(405, 'use POST', 'method_not_allowed');
    if (rest.length !== 1) throw new HttpProblem(404, 'unknown Toptal command', 'not_found');
    let result: unknown;
    switch (rest[0]) {
      case 'inspect': result = await workflow.inspect(actor, param('periodId','')!); break;
      case 'authorize-account': result = await workflow.authorizeAccount(actor, {agentId:param('agentId','')!,reviewRef:param('reviewRef','')!,expiresAt:param('expiresAt','')!}); break;
      case 'revoke-account': result = workflow.revokeAccount(actor); break;
      case 'assign': result = await workflow.assign(actor, param('periodId','')!); break;
      case 'draft': result = workflow.draft(actor, param('workId','')!, param('content','')!); break;
      case 'approve-delivery': result = workflow.approve(actor, param('workId','')!, param('contentHash','')!, param('qualityRef','')!); break;
      case 'begin-manual-delivery': result = await workflow.beginManualDelivery(actor, param('workId','')!); break;
      case 'confirm-delivery': result = await workflow.confirmDelivery(actor, param('workId','')!, param('submissionId','')!); break;
      case 'observe-payment': result = await workflow.observePayment(actor, param('workId','')!); break;
      case 'observe-payout': result = await workflow.observePayout(actor, param('workId','')!, param('payoutId','')!); break;
      case 'reconcile-payout': result = await workflow.reconcile(actor, param('workId','')!, param('payoutId','')!, param('externalId','')!); break;
      case 'reconcile-reversal': result = await workflow.reconcileReversal(actor, param('workId','')!, param('reversalExternalId','')!); break;
      default: throw new HttpProblem(404, 'unknown Toptal command', 'not_found');
    }
    json(res, 200, {result:result??null}); return true;
  }

  if (head === 'contra') {
    const actor: MoneyActor = { kind: 'owner', id: requireOwner(context, method !== 'GET').owner.id };
    const workflow = configuredContraWorkflow();
    if (method === 'GET' && !rest.length) { json(res, 200, workflow.overview(actor)); return true; }
    if (method !== 'POST') throw new HttpProblem(405, 'use POST', 'method_not_allowed');
    if (rest.length !== 1) throw new HttpProblem(404, 'unknown Contra command', 'not_found');
    let result: unknown;
    switch (rest[0]) {
      case 'inspect': result = await workflow.inspect(actor, param('projectId','')!); break;
      case 'authorize-account': result = await workflow.authorizeAccount(actor, {agentId:param('agentId','')!,reviewRef:param('reviewRef','')!,expiresAt:param('expiresAt','')!}); break;
      case 'revoke-account': result = workflow.revokeAccount(actor); break;
      case 'assign': result = await workflow.assign(actor, param('projectId','')!); break;
      case 'draft': result = workflow.draft(actor, param('workId','')!, param('content','')!); break;
      case 'approve-delivery': result = workflow.approve(actor, param('workId','')!, param('contentHash','')!, param('qualityRef','')!); break;
      case 'begin-manual-delivery': result = await workflow.beginManualDelivery(actor, param('workId','')!); break;
      case 'confirm-delivery': result = await workflow.confirmDelivery(actor, param('workId','')!, param('submissionId','')!); break;
      case 'observe-payment': result = await workflow.observePayment(actor, param('workId','')!); break;
      case 'observe-payout': result = await workflow.observePayout(actor, param('workId','')!, param('payoutId','')!); break;
      case 'reconcile-payout': result = await workflow.reconcile(actor, param('workId','')!, param('payoutId','')!, param('externalId','')!); break;
      case 'reconcile-reversal': result = await workflow.reconcileReversal(actor, param('workId','')!, param('reversalExternalId','')!); break;
      default: throw new HttpProblem(404, 'unknown Contra command', 'not_found');
    }
    json(res, 200, {result:result??null}); return true;
  }

  if (head === 'fiverr') {
    const actor: MoneyActor = { kind: 'owner', id: requireOwner(context, method !== 'GET').owner.id };
    const workflow = configuredFiverrWorkflow();
    if (method === 'GET' && !rest.length) { json(res, 200, workflow.overview(actor)); return true; }
    if (method !== 'POST') throw new HttpProblem(405, 'use POST', 'method_not_allowed');
    if (rest.length !== 1) throw new HttpProblem(404, 'unknown Fiverr command', 'not_found');
    let result: unknown;
    switch (rest[0]) {
      case 'inspect': result = await workflow.inspect(actor, param('orderId','')!); break;
      case 'authorize-account': result = await workflow.authorizeAccount(actor, {agentId:param('agentId','')!,reviewRef:param('reviewRef','')!,expiresAt:param('expiresAt','')!}); break;
      case 'revoke-account': result = workflow.revokeAccount(actor); break;
      case 'assign': result = await workflow.assign(actor, param('orderId','')!); break;
      case 'draft': result = workflow.draft(actor, param('workId','')!, param('content','')!); break;
      case 'approve-delivery': result = workflow.approve(actor, param('workId','')!, param('contentHash','')!, param('qualityRef','')!); break;
      case 'begin-manual-delivery': result = await workflow.beginManualDelivery(actor, param('workId','')!); break;
      case 'confirm-delivery': result = await workflow.confirmDelivery(actor, param('workId','')!, param('submissionId','')!); break;
      case 'observe-payment': result = await workflow.observePayment(actor, param('workId','')!); break;
      case 'observe-payout': result = await workflow.observePayout(actor, param('workId','')!, param('payoutId','')!); break;
      case 'reconcile-payout': result = await workflow.reconcile(actor, param('workId','')!, param('payoutId','')!, param('externalId','')!); break;
      case 'reconcile-reversal': result = await workflow.reconcileReversal(actor, param('workId','')!, param('reversalExternalId','')!); break;
      default: throw new HttpProblem(404, 'unknown Fiverr command', 'not_found');
    }
    json(res, 200, {result:result??null}); return true;
  }

  if (head === 'upwork') {
    const actor: MoneyActor = { kind: 'owner', id: requireOwner(context, method !== 'GET').owner.id };
    const workflow = configuredUpworkWorkflow();
    if (method === 'GET' && !rest.length) { json(res, 200, workflow.overview(actor)); return true; }
    if (method !== 'POST') throw new HttpProblem(405, 'use POST', 'method_not_allowed');
    if (rest.length !== 1) throw new HttpProblem(404, 'unknown Upwork command', 'not_found');
    let result: unknown;
    switch (rest[0]) {
      case 'inspect': result = await workflow.inspect(actor, param('contractId','')!, param('milestoneId','')!); break;
      case 'authorize-account': result = await workflow.authorizeAccount(actor, {agentId:param('agentId','')!,reviewRef:param('reviewRef','')!,expiresAt:param('expiresAt','')!}); break;
      case 'revoke-account': result = workflow.revokeAccount(actor); break;
      case 'assign': result = await workflow.assign(actor, param('contractId','')!, param('milestoneId','')!); break;
      case 'draft': result = workflow.draft(actor, param('workId','')!, param('content','')!); break;
      case 'approve-delivery': result = workflow.approve(actor, param('workId','')!, param('contentHash','')!, param('qualityRef','')!); break;
      case 'begin-manual-delivery': result = await workflow.beginManualDelivery(actor, param('workId','')!); break;
      case 'confirm-delivery': result = await workflow.confirmDelivery(actor, param('workId','')!, param('submissionId','')!); break;
      case 'observe-payment': result = await workflow.observePayment(actor, param('workId','')!); break;
      case 'observe-payout': result = await workflow.observePayout(actor, param('workId','')!, param('payoutId','')!); break;
      case 'reconcile-payout': result = await workflow.reconcile(actor, param('workId','')!, param('payoutId','')!, param('externalId','')!); break;
      case 'reconcile-reversal': result = await workflow.reconcileReversal(actor, param('workId','')!, param('reversalExternalId','')!); break;
      default: throw new HttpProblem(404, 'unknown Upwork command', 'not_found');
    }
    json(res, 200, {result:result??null}); return true;
  }

  if (head === 'freelancer') {
    const actor: MoneyActor = { kind: 'owner', id: requireOwner(context, method !== 'GET').owner.id };
    assertMoneyOwner(actor);
    const workflow = configuredFreelancerWorkflow(), settlement = configuredFreelancerSettlementWorkflow();
    if (method === 'GET' && !rest.length) { json(res, 200, { ...workflow.overview(actor), settlement: settlement.status(actor) }); return true; }
    if (method !== 'POST') throw new HttpProblem(405, 'use POST', 'method_not_allowed');
    let result: unknown;
    switch (rest[0]) {
      case 'discover': result = await workflow.discover(actor, param('query','')!, num('offset')); break;
      case 'authorize-account': {
        if (!Array.isArray(body.checks) || !body.checks.every(c => typeof c === 'string')) throw new HttpProblem(400, 'compliance checks required', 'invalid_input');
        result = await workflow.authorizeAccount(actor, { agentId: param('agentId','')!, reference: param('reference','')!, expiresAt: param('expiresAt','')!, checks: body.checks as string[] }); break;
      }
      case 'revoke-account': result = workflow.revokeAccount(actor); break;
      case 'assign': result = await workflow.assign(actor, param('projectId','')!, param('bidId','')!, param('milestoneId','')!, param('scopeReference','')!); break;
      case 'draft': result = workflow.draft(actor, param('workId','')!, param('content','')!); break;
      case 'approve-delivery': result = workflow.approve(actor, param('workId','')!, param('contentHash','')!); break;
      case 'deliver': result = await workflow.deliver(actor, param('workId','')!); break;
      case 'reconcile-delivery': result = await workflow.reconcileDelivery(actor, param('workId','')!, param('fileId','')!); break;
      case 'sync-milestone': result = await workflow.syncMilestone(actor, param('workId','')!); break;
      case 'observe-payout': result = await settlement.observePayout(actor, param('payoutId','')!); break;
      case 'authorize-historical-settlement': result = settlement.authorizeHistoricalWork(actor, param('workId','')!); break;
      case 'reconcile-payout': result = await settlement.reconcilePayout(actor, param('payoutId','')!, param('externalId','')!); break;
      case 'reconcile-reversal': result = await settlement.reconcileReversal(actor, param('payoutId','')!, param('reversalExternalId','')!); break;
      default: throw new HttpProblem(404, 'unknown Freelancer command', 'not_found');
    }
    json(res, 200, { result: result ?? null }); return true;
  }

  if (head === 'awin') {
    const actor: MoneyActor = { kind: 'owner', id: requireOwner(context, method !== 'GET').owner.id };
    assertMoneyOwner(actor);
    const workflow = configuredAwinWorkflow();
    if (method === 'GET' && !rest.length) { json(res, 200, workflow.overview(actor)); return true; }
    if (method !== 'POST') throw new HttpProblem(405, 'use POST', 'method_not_allowed');
    let result: unknown;
    switch (rest[0]) {
      case 'discover': result = await workflow.discover(actor); break;
      case 'assign': result = await workflow.assign(actor, { agentId: param('agentId','')!, opportunityId: param('opportunityId','')!, destinationUrl: param('destinationUrl','')! }); break;
      case 'refresh-assignment': result = await workflow.refreshAssignment(actor, param('assignmentId','')!); break;
      case 'revoke': result = workflow.revoke(actor, param('assignmentId','')!); break;
      case 'draft': result = workflow.draft(actor, param('assignmentId','')!, { key: param('idempotencyKey','')!, title: param('title','')!, body: param('body','')! }); break;
      case 'prepare': result = await workflow.prepare(actor, param('publicationId','')!); break;
      case 'approve-publication': result = workflow.approvePublication(actor, param('publicationId','')!, param('contentHash','')!); break;
      case 'publish': result = await workflow.publish(actor, param('publicationId','')!); break;
      case 'reconcile-publication': result = await workflow.reconcilePublication(actor, param('publicationId','')!); break;
      case 'sync': {
        if (!Array.isArray(body.ids) || !body.ids.every(id => typeof id === 'string')) throw new HttpProblem(400, 'transaction IDs required', 'invalid_input');
        result = await workflow.sync(actor, param('publicationId','')!, body.ids as string[]); break;
      }
      case 'scan': result = await workflow.scan(actor, param('publicationId','')!, param('startDate','')!, param('endDate','')!); break;
      case 'reconcile-payout': result = await workflow.reconcilePayout(actor, param('paymentId','')!, param('externalId','')!); break;
      case 'reconcile-reversal': result = await workflow.reconcileReversal(actor, param('paymentId','')!, param('reversalExternalId','')!); break;
      default: throw new HttpProblem(404, 'unknown Awin command', 'not_found');
    }
    json(res, 200, { result: result ?? null }); return true;
  }

  if (head === 'money') {
    if (method === 'GET') {
      let agentId:string|undefined;
      if(context.session){const session=requireOwner(context);assertMoneyOwner({kind:'owner',id:session.owner.id});}
      else agentId=requireAgent(context,url.searchParams.get('agentId'),true).agentId;
      const action=rest[0];
      if(action&& !['ledger','operations','jobs'].includes(action))throw new HttpProblem(404,'unknown money view','not_found');
      const data=action==='ledger'?{entries:listCashEntries(Number(url.searchParams.get('after')??0),Number(url.searchParams.get('limit')??200),agentId)}:
        action==='operations'?{operations:listMoneyOperations(url.searchParams.get('after')??'',Number(url.searchParams.get('limit')??200),agentId)}:
        action==='jobs'?{jobs:listEarningJobs(url.searchParams.get('after')??'',Number(url.searchParams.get('limit')??200),agentId)}:
        agentId?agentMoneyOverview(agentId):moneyOverview();
      json(res,200,data);return true;
    }
    let actor: MoneyActor;
    if (context.session) actor={kind:'owner',id:requireOwner(context,true).owner.id};
    else { const bound=requireAgent(context,param('agentId')); actor={kind:'agent',id:bound.agentId}; }
    if(method!=='POST')throw new HttpProblem(405,'use POST for money mutations','method_not_allowed');
    const action=rest[0];
    let result: unknown;
    try {
    if(action==='bootstrap')result=bootstrapMoneyAgents(actor);
    else if(action==='opportunities')result=approveOpportunity(actor,{title:param('title','')!,evidenceUrl:param('evidenceUrl','')!,activity:param('activity','')!,provider:param('provider','')!});
    else if(action==='revoke-opportunity')result=revokeOpportunity(actor,param('id','')!);
    else if(action==='grants')result=setMoneyGrant(actor,param('agentId','')!,{spendLimitCents:num('spendLimitCents'),delegationCents:num('delegationCents'),canCreate:body.canCreate===true,expiresAt:param('expiresAt','')!,status:param('status')==='revoked'?'revoked':'active',opportunityId:param('opportunityId')??undefined,autoAllocateCents:num('autoAllocateCents')});
    else if(action==='allocate')result=allocateCash(actor,param('agentId','')!,num('amountCents'),param('idempotencyKey','')!);
    else if(action==='freeze')result=freezeCash(actor,param('accountId','')!,body.frozen!==false);
    else if(action==='request')result=requestMoney(actor,{kind:param('kind') as 'expense'|'withdrawal',agentId:param('agentId')??undefined,provider:param('provider','')!,destination:param('destination','')!,category:param('category','')!,amountCents:num('amountCents'),maxCostCents:num('maxCostCents'),idempotencyKey:param('idempotencyKey','')!});
    else if(action==='cancel')result=cancelMoney(actor,param('id','')!);
    else if(action==='decide')result=decideMoney(actor,param('id','')!,body.approve===true);
    else if(action==='receipt'){assertMoneyOwner(actor);result=await verifyMoneyReceipt(actor,configuredMoneyProvider(),param('externalId','')!);}
    else if(action==='dispatch')result=await dispatchMoney(actor,configuredMoneyProvider(),param('id','')!);
    else if(action==='reconcile'){assertMoneyOwner(actor);result=await reconcileMoney(actor,configuredMoneyProvider(),param('id','')!);}
    else if(action==='reconcile-earning'){assertMoneyOwner(actor);result=await reconcileEarningPayment(actor,configuredMoneyProvider(),param('id','')!);}
    else if(action==='earn')result=queueEarning(actor,param('agentId','')!,param('idempotencyKey','')!,param('costOperationId')??undefined);
    else throw new HttpProblem(404,'unknown money action','not_found');
    } catch(error) {
      appendMissionAudit({actorType:actor.kind,actorId:actor.id,action:'money.action_refused',subjectType:'verified_cash',subjectId:action,detail:{code:error instanceof MoneyError?error.code:'internal_error'}});
      throw error;
    }
    json(res,200,{result:result??null});return true;
  }
  // Legacy entries are owner-reported accounting, not verified external cash.
  // Refuse HTTP paths that previously accepted a note as payment confirmation.
  if (method !== 'GET' && ((head==='wallets' && rest[1]==='fund') ||
      (head==='revenue' && param('status')==='received') || head==='expenses' ||
      (head==='payouts' && ['settle','decide'].includes(rest[1])) ||
      (head==='work' && rest[1]==='status' && param('status')==='paid'))) {
    requireRead(context);
    throw new HttpProblem(409,'Use /api/money: provider-verified cash is required; legacy notes cannot fund or settle real payments.','provider_verification_required');
  }

  switch (head) {
    // ── Session ─────────────────────────────────────────────────────────────
    case 'session': {
      const action = rest[0] ?? 'me';
      if (method === 'POST' && action === 'login') {
        const email = param('email', '') ?? '';
        const password = param('password', '') ?? '';
        const session = login({
          email,
          password,
          ip: req.socket.remoteAddress ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        });
        json(res, 200, session);
        return true;
      }
      if (method === 'POST' && action === 'logout') {
        const token = bearer(req);
        json(res, 200, { loggedOut: token ? logout(token) : false });
        return true;
      }
      if (method === 'GET' && action === 'me') {
        const session = requireOwner(context);
        json(res, 200, {
          owner: session.owner,
          expiresAt: null,
          vaultConfigured: vaultConfigured(),
          identityLock: identityLockStatus(),
        });
        return true;
      }
      break;
    }

    // ── Overview / dashboard ────────────────────────────────────────────────
    case 'overview': {
      requireRead(context);
      json(res, 200, buildMissionOverview());
      return true;
    }
    case 'treasury': {
      requireRead(context);
      json(res, 200, { treasury: treasurySummary(), wallets: listWallets(), ledgerIntegrity: verifyLedger() });
      return true;
    }
    case 'ledger': {
      requireRead(context);
      json(res, 200, { entries: listLedger({ walletId: url.searchParams.get('walletId') ?? undefined, limit: Number(url.searchParams.get('limit') ?? 100) }) });
      return true;
    }
    case 'audit': {
      requireRead(context);
      if (rest[0] === 'verify') {
        json(res, 200, verifyMissionAudit());
        return true;
      }
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));
      json(res, 200, {
        verification: verifyMissionAudit(),
        entries: missionDb.all<Row>('SELECT * FROM mission_audit ORDER BY seq DESC LIMIT ?', [limit]),
      });
      return true;
    }
    case 'approvals': {
      requireRead(context);
      if (method === 'POST' && rest[0] && rest[1] === 'decide') {
        const session = requireOwner(context, true);
        const decision = param('decision', '') === 'approved' ? 'approved' : 'rejected';
        const result = missionDb.transaction(() => {
          const decisionResult = decideApproval({ id: rest[0], decision, decidedBy: session.owner.id, note: param('note') });
          if (!decisionResult.ok) throw new HttpProblem(decisionResult.status === 'not_found' ? 404 : 409, decisionResult.reason ?? 'approval not actionable', decisionResult.status === 'not_found' ? 'not_found' : 'conflict');
          const subject = decisionResult.approval;
          if(decision==='approved' && (['expense','payout'].includes(String(subject?.subject_type)) || (subject?.subject_type==='upgrade' && Number(missionDb.get<Row>('SELECT requested_cost_cents FROM mission_upgrades WHERE id=?',[String(subject.subject_id)])?.requested_cost_cents)>0))) throw new HttpProblem(409,'Legacy approvals cannot move verified cash; use /api/money.','provider_verification_required');
          if (subject?.subject_type === 'expense') {
            return { ...decisionResult, expense: decideExpense({ id: String(subject.subject_id), decision, actorId: session.owner.id, note: param('note'), actorType: 'owner' }) };
          }
          if (subject?.subject_type === 'payout') {
            return { ...decisionResult, payout: decidePayout({ id: String(subject.subject_id), decision, actorId: session.owner.id, note: param('note'), actorType: 'owner' }) };
          }
          if (subject?.subject_type === 'resource') return { ...decisionResult, resource: decideResource({ id: String(subject.subject_id), decision, actorId: session.owner.id }) };
          if (subject?.subject_type === 'upgrade') return { ...decisionResult, upgrade: decideUpgrade({ id: String(subject.subject_id), decision, actorId: session.owner.id }) };
          if (subject?.subject_type === 'tool') return { ...decisionResult, toolRequest: decideToolRequest({ id: String(subject.subject_id), decision, actorId: session.owner.id, actorType: 'owner' }) };
          return decisionResult;
        });
        json(res, 200, result);
        return true;
      }
      json(res, 200, { pending: listApprovals('pending'), all: listApprovals() });
      return true;
    }

    // ── Policy ──────────────────────────────────────────────────────────────
    case 'policy': {
      requireRead(context);
      // Order matters: the kill switch is a POST sub-route and must be handled
      // before the policy-update branch, otherwise it would silently update
      // policy instead of stopping the mission.
      if (method === 'POST' && rest[0] === 'kill-switch') {
        const session = requireOwner(context, true);
        json(res, 200, { killSwitch: setKillSwitch(Boolean(body.engage ?? true), session.owner.id) });
        return true;
      }
      if (method === 'PATCH' || method === 'POST') {
        const session = requireOwner(context, true);
        const patch: Record<string, unknown> = {};
        if (body.autonomousEnabled !== undefined) patch.autonomousEnabled = Boolean(body.autonomousEnabled);
        if (body.allowAgentCreation !== undefined) patch.allowAgentCreation = Boolean(body.allowAgentCreation);
        if (body.requireOwnerForPayout !== undefined) patch.requireOwnerForPayout = Boolean(body.requireOwnerForPayout);
        for (const key of ['maxDepth', 'maxChildrenPerAgent', 'maxAgents', 'maxDailySpendCents', 'maxExpenseCents', 'maxPayoutCents', 'requireApprovalAboveCents', 'reinvestShareBps', 'dailyRevenueTargetCents'] as const) {
          if (body[key] !== undefined) patch[key] = num(key);
        }
        if (Array.isArray(body.allowedActivities)) patch.allowedActivities = body.allowedActivities.map((entry) => String(entry));
        if (body.providerActivation !== undefined) patch.providerActivation = body.providerActivation as Array<Record<string, unknown>>;
        json(res, 200, { policy: updatePolicy(patch, session.owner.id), categories: activityCatalog() });
        return true;
      }
      json(res, 200, { policy: currentPolicy(), categories: activityCatalog() });
      return true;
    }
    case 'kill-switch': {
      const session = requireOwner(context, true);
      if (method !== 'POST') throw new HttpProblem(405, 'POST required', 'method_not_allowed');
      json(res, 200, { killSwitch: setKillSwitch(Boolean(body.engage ?? true), session.owner.id) });
      return true;
    }

    // ── Agents ──────────────────────────────────────────────────────────────
    case 'agents': {
      requireRead(context);
      if (rest.length === 0 && method === 'POST') {
        // Root-agent creation (owner only). Without this, a POST here used to
        // fall through to the LIST handler and answer 200 with a page of
        // agents — a silent fake success. Creation is real: policy gates,
        // contract, unfunded accounting subledger, audit entry.
        const session = requireOwner(context, true);
        const created = createRootAgent({
          name: param('name', '') ?? '',
          specialization: param('specialization', '') ?? '',
          activityKey: param('activity', 'general') ?? 'general',
          budgetCents: num('budgetCents'),
          missionRole: (param('missionRole', 'director') ?? 'director') as 'worker' | 'supervisor' | 'director',
          actorId: session.owner.id,
        });
        json(res, 201, created);
        return true;
      }
      if (rest.length === 0) {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
        const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
        const where = query ? 'WHERE lower(slug) LIKE ? OR lower(name) LIKE ?' : '';
        const params: Array<string | number> = query ? [`%${query}%`, `%${query}%`] : [];
        // Newest first: an agent the owner just created must be visible at the
        // top of the list, not buried behind thousands of synced registry rows.
        const rows = missionDb.all<Row>(
          `SELECT id, slug, name, category, mission_role, status, depth, parent_id, generation FROM mission_agents ${where} ORDER BY created_at DESC, slug LIMIT ? OFFSET ?`,
          [...params, limit, offset],
        );
        const total = missionDb.get<Row>(`SELECT COUNT(*) AS count FROM mission_agents ${where}`, params);
        json(res, 200, { total: Number(total?.count ?? 0), limit, offset, agents: rows });
        return true;
      }
      const slug = rest[0];
      if (rest[1] === 'chat-config' || rest[1] === 'chat-jobs') {
        const session = requireOwner(context, method !== 'GET');
        const agent = findAgentBySlug(slug) ?? findAgentById(slug);
        if (!agent) throw new HttpProblem(404, 'agent not found', 'not_found');
        if (rest.length !== 2) throw new HttpProblem(404, 'chat route not found', 'not_found');
        if (method === 'GET' && rest[1] === 'chat-jobs') {
          json(res, 200, listAgentChatJobs(agent.id, Number(url.searchParams.get('before') ?? Number.MAX_SAFE_INTEGER), Number(url.searchParams.get('limit') ?? 50)));
          return true;
        }
        if (method === 'GET') {
          json(res, 200, { agentId: agent.id, config: agentChatConfig(agent.id), workerLivenessVerified: false, providerActivated: false });
          return true;
        }
        if (method === 'POST' && rest[1] === 'chat-config') {
          json(res, 200, { config: configureAgentChat(agent.id, body as unknown as AgentChatConfig, { actorType: 'owner', actorId: session.owner.id }), providerActivated: false });
          return true;
        }
        throw new HttpProblem(405, 'unsupported chat operation', 'method_not_allowed');
      }
      if (rest[1] === 'messages') {
        const agent = findAgentBySlug(slug) ?? findAgentById(slug);
        if (!agent) throw new HttpProblem(404, 'agent not found', 'not_found');
        if (!context.session && (context.link?.link.scope !== 'agent:self' || context.link.agentId !== agent.id)) throw new HttpProblem(403, 'this conversation belongs to another agent', 'forbidden');
        if (method === 'GET') {
          json(res, 200, listAgentMessages(agent.id, Number(url.searchParams.get('after') ?? 0), Number(url.searchParams.get('limit') ?? 100)));
          return true;
        }
        if (method === 'POST') {
          const actor = context.session ? { actorType: 'owner' as const, actorId: requireOwner(context, true).owner.id } : requireAgent(context, slug);
          json(res, 201, appendAgentMessage({ agentId: agent.id, actorType: actor.actorType, actorId: actor.actorId, body: param('message', '')!, idempotencyKey: param('idempotencyKey', '')!, replyTo: param('replyTo') }));
          return true;
        }
      }
      if (rest[1] === undefined) {
        const agent = findAgentBySlug(slug);
        if (!agent) throw new HttpProblem(404, 'agent not found', 'not_found');
        json(res, 200, buildAgentReport(agent));
        return true;
      }
      if (rest[1] === 'report') {
        const agent = findAgentBySlug(slug);
        if (!agent) throw new HttpProblem(404, 'agent not found', 'not_found');
        json(res, 200, buildAgentReport(agent));
        return true;
      }
      if (rest[1] === 'snapshot') {
        const session = requireOwner(context, true);
        const created = snapshotAgentReport(slug, param('periodStart', new Date(Date.now() - 24 * 3600 * 1000).toISOString())!, param('periodEnd', nowIso())!);
        appendMissionAudit({ actorType: 'owner', actorId: session.owner.id, action: 'report.snapshot_requested', subjectType: 'agent', subjectId: slug });
        json(res, 201, { id: created.id, report: created.report });
        return true;
      }
      if (rest[1] === 'status' && method === 'POST') {
        // Operator brake on one agent (Section 9): owner-only, reasoned and
        // audited. 'paused' stops the agent acting; 'retired' retires it
        // permanently; 'active' restores work.
        const session = requireOwner(context, true);
        const agent = findAgentBySlug(slug);
        if (!agent) throw new HttpProblem(404, 'agent not found', 'not_found');
        const status = param('status', '') ?? '';
        if (!['active', 'paused', 'retired'].includes(status)) {
          throw new HttpProblem(400, "status must be one of active, paused, retired", 'validation_error');
        }
        const reason = (param('reason', '') ?? '').trim();
        if (status !== 'active' && reason.length < 3) {
          throw new HttpProblem(400, 'a reason is required to pause or retire an agent', 'validation_error');
        }
        missionDb.run('UPDATE mission_agents SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), agent.id]);
        appendMissionAudit({
          actorType: 'owner',
          actorId: session.owner.id,
          action: status === 'active' ? 'agent.resumed' : status === 'paused' ? 'agent.paused' : 'agent.retired',
          subjectType: 'agent',
          subjectId: agent.id,
          detail: { slug: agent.slug, from: agent.status, to: status, reason: reason || null },
        });
        json(res, 200, { agent: findAgentBySlug(slug) });
        return true;
      }
      if (rest[1] === 'children' && method === 'POST') {
        // Controlled sub-agent creation: contract + limits + audit, or refused.
        const actor=context.session?{actorId:requireOwner(context,true).owner.id,actorType:'owner' as const}:requireAgent(context,slug);
        const created = createSubAgent({
          parentSlug: slug,
          name: param('name', '') ?? '',
          specialization: param('specialization', '') ?? '',
          activityKey: param('activity', 'general') ?? 'general',
          budgetCents: num('budgetCents'),
          actorId: actor.actorId,
          actorType: actor.actorType,
        });
        json(res, 201, created);
        return true;
      }
      break;
    }

    // ── Tools (approved provider catalog) ───────────────────────────────────
    case 'tools': {
      requireRead(context);
      if (method === 'GET') {
        json(res, 200, { tools: listTools(), requests: missionDb.all<Row>('SELECT * FROM mission_tool_requests ORDER BY created_at DESC LIMIT 100') });
        return true;
      }
      if (rest[0] === 'request' && method === 'POST') {
        const agent = requireAgent(context, param('agentSlug') ?? param('agentId'));
        const request = requestTool({ agentId: agent.agentId, toolKey: param('toolKey', '') ?? '', justification: param('justification'), actorId: agent.actorId });
        json(res, 201, { request });
        return true;
      }
      if (rest[0] === 'requests' && rest[2] === 'decide' && method === 'POST') {
        const session = requireOwner(context, true);
        json(res, 200, { request: decideToolRequest({ id: rest[1], decision: param('decision') === 'approved' ? 'approved' : 'rejected', actorId: session.owner.id }) });
        return true;
      }
      if (rest[0] && method === 'POST') {
        const session = requireOwner(context, true);
        const status = param('status', 'restricted') as 'approved' | 'restricted' | 'blocked';
        json(res, 200, { tool: setToolStatus(rest[0], status, session.owner.id) });
        return true;
      }
      break;
    }

    // ── Credentials (encrypted vault; values never returned) ───────────────
    case 'credentials': {
      requireRead(context);
      if (method === 'GET') {
        if (rest[0] === 'expiring') {
          json(res, 200, { expiring: expiringCredentials(Number(url.searchParams.get('days') ?? 30)) });
          return true;
        }
        if (rest[0] && rest[1] === 'rotations') {
          json(res, 200, { rotations: credentialRotations(rest[0]) });
          return true;
        }
        json(res, 200, { credentials: listCredentials(), vaultConfigured: vaultConfigured() });
        return true;
      }
      if (method === 'POST' && rest.length === 0) {
        const session = requireOwner(context, true);
        const credential = storeCredential({
          provider: param('provider', '') ?? '',
          label: param('label', '') ?? '',
          kind: param('kind', 'api_key') ?? 'api_key',
          scope: Array.isArray(body.scope) ? body.scope.map((entry) => String(entry)) : [],
          envVar: param('envVar'),
          secret: param('secret', '') ?? '',
          expiresAt: param('expiresAt'),
          actorId: session.owner.id,
        });
        json(res, 201, { credential });
        return true;
      }
      if (method === 'POST' && rest[1] === 'rotate') {
        const session = requireOwner(context, true);
        const credential = rotateCredential({
          id: rest[0],
          secret: param('secret', '') ?? '',
          reason: param('reason'),
          actorType: 'owner',
          actorId: session.owner.id,
          verified: Boolean(body.verified),
        });
        json(res, 200, { credential });
        return true;
      }
      if (method === 'POST' && rest[1] === 'revoke') {
        const session = requireOwner(context, true);
        json(res, 200, { credential: revokeCredential(rest[0], session.owner.id, param('reason')) });
        return true;
      }
      if (method === 'POST' && rest[0] === 'sweep') {
        const session = requireOwner(context, true);
        const result = sweepCredentialStatus();
        appendMissionAudit({ actorType: 'owner', actorId: session.owner.id, action: 'credential.sweep', detail: result });
        json(res, 200, result);
        return true;
      }
      break;
    }

    // ── Resources ───────────────────────────────────────────────────────────
    case 'resources': {
      requireRead(context);
      if (rest[1] === 'periods') {
        const session = requireOwner(context, method !== 'GET');
        const actor = { actorType: 'owner' as const, actorId: session.owner.id };
        if (rest.length !== 2) throw new HttpProblem(404, 'resource period route not found', 'not_found');
        if (method === 'GET') json(res, 200, listResourcePeriods(rest[0], actor, { before: url.searchParams.get('before') ?? undefined, limit: Number(url.searchParams.get('limit') ?? 50) }));
        else if (method === 'POST') json(res, 200, recordResourcePeriod(rest[0], body as unknown as ResourcePeriodInput, actor));
        else throw new HttpProblem(405, 'unsupported resource period operation', 'method_not_allowed');
        return true;
      }
      if (rest[1] === 'calls') {
        const session = requireOwner(context, method !== 'GET');
        const actor = { actorType: 'owner' as const, actorId: session.owner.id };
        if (method === 'GET' && rest.length === 2) {
          json(res, 200, listOwnerResourceCalls(rest[0], actor, { before: url.searchParams.get('before') ?? undefined, limit: Number(url.searchParams.get('limit') ?? 50) }));
          return true;
        }
        if (method === 'POST' && rest.length === 4 && rest[3] === 'cancel') {
          json(res, 200, { call: cancelOwnerResourceCall(rest[0], rest[2], actor), moneyMoved: false, providerCalled: false });
          return true;
        }
        if (method === 'POST' && rest.length === 4 && rest[3] === 'record-cost') {
          json(res, 200, recordResourceCallCost(rest[0], rest[2], actor, { actualCostCents: body.actualCostCents as number, providerRef: param('providerRef', '')!, evidence: param('evidence', '')! }));
          return true;
        }
        if (method === 'POST' && rest.length === 4 && rest[3] === 'reconcile') {
          if (body.outcome !== 'succeeded' && body.outcome !== 'failed') throw new HttpProblem(400, 'choose the actual provider outcome', 'validation_error');
          json(res, 200, reconcileOwnerResourceCall(rest[0], rest[2], actor, { outcome: body.outcome, actualUsage: body.actualUsage as Record<string, number>, providerRef: param('providerRef', '')!, evidence: param('evidence', '')! }));
          return true;
        }
        throw new HttpProblem(404, 'resource call route not found', 'not_found');
      }
      if (method === 'GET') {
        const expiring = url.searchParams.get('expiring');
        json(res, 200, { resources: listResources(url.searchParams.get('agentId') ?? undefined).map(row => ({ ...row, readiness: resourceReadiness(String(row.id)) })), expiring: expiring === '1' });
        return true;
      }
      if (rest.length === 0 && method === 'POST') {
        const agent = requireAgent(context, param('agentSlug') ?? param('agentId'));
        const resource = requestResource({
          agentId: agent.agentId,
          kind: param('kind', 'api') ?? 'api',
          provider: param('provider', '') ?? '',
          plan: param('plan'),
          monthlyCostCents: num('monthlyCostCents'),
          autoRenew: Boolean(body.autoRenew),
          expiresAt: param('expiresAt'),
          limits: (body.limits as Record<string, unknown>) ?? null,
          credentialId: param('credentialId'),
          actorId: agent.actorType === 'agent' && !context.session ? null : agent.actorId,
        });
        json(res, 201, { resource });
        return true;
      }
      if (rest[1] === 'usage' && method === 'POST') {
        const agent = requireAgent(context, param('agentSlug'));
        json(res, 200, { resource: recordResourceUsage({ id: rest[0], usage: (body.usage as Record<string, unknown>) ?? {}, actorType: context.session ? 'owner' : 'agent', actorId: context.session?.owner.id ?? agent.agentId }) });
        return true;
      }
      if (rest[1] === 'decide' && method === 'POST') {
        const session = requireOwner(context, true);
        json(res, 200, { resource: decideResource({ id: rest[0], decision: param('decision') === 'approved' ? 'approved' : 'rejected', actorId: session.owner.id, note: param('note') }) });
        return true;
      }
      if (rest[1] === 'provision' && method === 'POST') {
        const session = requireOwner(context, true);
        json(res, 200, { resource: provisionResource({ id: rest[0], walletId: param('walletId') ?? undefined, actualCostCents: num('actualCostCents'), providerRef: param('providerRef', '')!, evidence: param('evidence', '')!, actorId: session.owner.id }), accounting:'legacy_owner_reported',providerVerified:false,externalPaymentExecuted:false });
        return true;
      }
      if (rest[1] === 'credential' && method === 'POST') {
        const session = requireOwner(context, true);
        const resource = bindResourceCredential({ id: rest[0], credentialId: param('credentialId', '')!, expectedCredentialId: param('expectedCredentialId') ?? null, reason: param('reason', '')!, actorId: session.owner.id, actorType: 'owner' });
        json(res, 200, { resource, readiness: resourceReadiness(String(resource.id)), providerVerified: false });
        return true;
      }
      if (rest[1] === 'retire' && method === 'POST') {
        const session = requireOwner(context, true);
        json(res, 200, { resource: retireResource(rest[0], session.owner.id, param('reason')) });
        return true;
      }
      break;
    }

    // ── Services ────────────────────────────────────────────────────────────
    case 'services': {
      requireRead(context);
      if (method === 'GET') {
        json(res, 200, { services: listServices(url.searchParams.get('agentId') ?? undefined) });
        return true;
      }
      if (rest.length === 0 && method === 'POST') {
        const agent = requireAgent(context, param('agentSlug') ?? param('agentId'));
        json(res, 201, { service: createService({ agentId: agent.agentId, name: param('name', '') ?? '', kind: param('kind', 'api') ?? 'api', provider: param('provider'), notes: param('notes'), actorId: context.session?.owner.id ?? null }) });
        return true;
      }
      if (rest[1] === 'health' && method === 'POST') {
        requireAgent(context, param('agentSlug'));
        const healthSource = (param('healthSource', 'agent-report') ?? 'agent-report') as 'provider-api' | 'owner-check' | 'agent-report';
        const status = (param('status', 'unknown') ?? 'unknown') as 'healthy' | 'degraded' | 'down' | 'maintenance' | 'unknown';
        json(res, 200, { service: recordServiceHealth({ id: rest[0], status, healthSource, notes: param('notes'), actorType: context.session ? 'owner' : 'agent', actorId: context.session?.owner.id ?? null }) });
        return true;
      }
      break;
    }

    // ── Upgrades ────────────────────────────────────────────────────────────
    case 'upgrades': {
      requireRead(context);
      if (method === 'GET') {
        json(res, 200, { upgrades: listUpgrades(url.searchParams.get('agentId') ?? undefined) });
        return true;
      }
      if (rest.length === 0 && method === 'POST') {
        const agent = requireAgent(context, param('agentSlug') ?? param('agentId'));
        const result = requestUpgrade({
          agentId: agent.agentId,
          capability: param('capability', '') ?? '',
          requestedCostCents: num('requestedCostCents'),
          justification: param('justification'),
          walletId: param('walletId'),
          actorType: context.session ? 'owner' : 'agent',
          actorId: context.session?.owner.id ?? null,
        });
        json(res, 201, result);
        return true;
      }
      if (rest[1] === 'decide' && method === 'POST') {
        const session = requireOwner(context, true);
        if(param('decision')!=='rejected' && Number(missionDb.get<Row>('SELECT requested_cost_cents FROM mission_upgrades WHERE id=?',[rest[0]])?.requested_cost_cents)>0)throw new HttpProblem(409,'Paid upgrades require provider-verified money operations.','provider_verification_required');
        json(res, 200, { upgrade: decideUpgrade({ id: rest[0], decision: param('decision') === 'approved' ? 'approved' : 'rejected', actorId: session.owner.id, note: param('note') }) });
        return true;
      }
      if (rest[1] === 'apply' && method === 'POST') {
        const session = requireOwner(context, true);
        if(Number(missionDb.get<Row>('SELECT requested_cost_cents FROM mission_upgrades WHERE id=?',[rest[0]])?.requested_cost_cents)>0)throw new HttpProblem(409,'Legacy approval is not verified payment.','provider_verification_required');
        json(res, 200, { upgrade: applyUpgrade(rest[0], session.owner.id) });
        return true;
      }
      break;
    }

    // ── Work + revenue + expenses ───────────────────────────────────────────
    case 'work': {
      requireRead(context);
      if (method === 'GET') {
        json(res, 200, { work: missionDb.all<Row>('SELECT * FROM mission_work ORDER BY created_at DESC LIMIT 200') });
        return true;
      }
      if (rest.length === 0 && method === 'POST') {
        const agent = requireAgent(context, param('agentSlug') ?? param('agentId'));
        const activity = param('activity', '') ?? '';
        const decision = checkActivity(activity, currentPolicy());
        if (!decision.allowed) {
          appendMissionAudit({ actorType: 'agent', actorId: agent.agentId, action: 'work.denied', detail: { activity, reasons: decision.reasons } });
          throw new HttpProblem(403, `activity refused by policy: ${decision.reasons.join('; ')}`, 'policy_denied');
        }
        const id = missionId('wrk');
        missionDb.run(
          `INSERT INTO mission_work (id, agent_id, title, description, category, status, client_ref, revenue_cents, cost_cents, approved_by, approved_at)
           VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)`,
          [id, agent.agentId, param('title', '') ?? '', param('description'), activity, param('clientRef'), num('revenueCents'), num('costCents'), context.session?.owner.id ?? null, nowIso()],
        );
        appendMissionAudit({ actorType: context.session ? 'owner' : 'agent', actorId: context.session?.owner.id ?? agent.agentId, action: 'work.created', subjectType: 'work', subjectId: id, detail: { activity, title: param('title') } });
        json(res, 201, { work: missionDb.get<Row>('SELECT * FROM mission_work WHERE id = ?', [id]) });
        return true;
      }
      if (rest[1] === 'status' && method === 'POST') {
        const session = requireOwner(context, true);
        const status = param('status', '') ?? '';
        const allowed = ['proposed', 'approved', 'in_progress', 'delivered', 'invoiced', 'paid', 'rejected'];
        if (!allowed.includes(status)) throw new HttpProblem(400, `status must be one of ${allowed.join(', ')}`, 'validation_error');
        missionDb.run(`UPDATE mission_work SET status = ?, updated_at = ? WHERE id = ?`, [status, nowIso(), rest[0]]);
        appendMissionAudit({ actorType: 'owner', actorId: session.owner.id, action: 'work.status_changed', subjectType: 'work', subjectId: rest[0], detail: { status } });
        json(res, 200, { work: missionDb.get<Row>('SELECT * FROM mission_work WHERE id = ?', [rest[0]]) });
        return true;
      }
      break;
    }
    case 'revenue': {
      requireRead(context);
      if (method === 'GET') {
        json(res, 200, { revenue: listRevenue(Number(url.searchParams.get('limit') ?? 100)) });
        return true;
      }
      if (method === 'POST') {
        const session = requireOwner(context, true);
        const result = recordRevenue({
          workId: param('workId'),
          agentId: param('agentId'),
          amountCents: num('amountCents'),
          source: param('source', 'client') ?? 'client',
          status: (param('status', 'expected') ?? 'expected') as 'expected' | 'contracted' | 'received' | 'disputed',
          externalRef: param('externalRef'),
          idempotencyKey: param('idempotencyKey', `rev-${Date.now()}`)!,
          verifier: param('verifier'),
          memo: param('memo'),
          actorId: session.owner.id,
        });
        json(res, result.duplicated ? 200 : 201, result);
        return true;
      }
      break;
    }
    case 'expenses': {
      requireRead(context);
      if (method === 'GET') {
        json(res, 200, { expenses: listExpenses(Number(url.searchParams.get('limit') ?? 100)), dailyBudget: treasurySummary().daily });
        return true;
      }
      if (rest.length === 0 && method === 'POST') {
        const agent = requireAgent(context, param('agentSlug') ?? param('agentId'));
        // An expense belongs to the agent's own wallet unless the caller names
        // another one; without this the request would be refused with
        // wallet_not_found and no agent could ever spend.
        const namedWallet = (param('walletId', '') ?? '').trim();
        const wallet = namedWallet ? getWallet(namedWallet) : walletForAgent(agent.agentId);
        if (!wallet) {
          throw new HttpProblem(409, 'this agent has no wallet yet — create or fund one before requesting an expense', 'wallet_required');
        }
        if (namedWallet && wallet.agentId && wallet.agentId !== agent.agentId) {
          throw new HttpProblem(403, 'that wallet belongs to a different agent', 'forbidden');
        }
        const result = requestExpense({
          agentId: agent.agentId,
          walletId: wallet.id,
          category: param('category', 'api') ?? 'api',
          provider: param('provider', '') ?? '',
          description: param('description', '') ?? '',
          amountCents: num('amountCents'),
          idempotencyKey: param('idempotencyKey', `exp-${Date.now()}`)!,
          actorType: context.session ? 'owner' : 'agent',
          actorId: context.session?.owner.id ?? agent.agentId,
        });
        json(res, 201, result);
        return true;
      }
      if (rest[1] === 'decide' && method === 'POST') {
        const session = requireOwner(context, true);
        json(res, 200, { expense: decideExpense({ id: rest[0], decision: param('decision') === 'approved' ? 'approved' : 'rejected', actorId: session.owner.id, note: param('note') }) });
        return true;
      }
      break;
    }

    // ── Wallets ─────────────────────────────────────────────────────────────
    case 'wallets': {
      requireRead(context);
      if (method === 'GET') {
        json(res, 200, { wallets: listWallets() });
        return true;
      }

      if (rest[1] === 'fund' && method === 'POST') {
        // Owner working capital: money the owner deliberately puts into a
        // wallet. It is a deposit in the ledger (category owner_capital), never
        // revenue — revenue is only ever recorded against a verified external
        // payment. Idempotent by key so a retried request cannot double-fund.
        const session = requireOwner(context, true);
        const wallet = getWallet(rest[0]);
        if (!wallet) throw new HttpProblem(404, 'wallet not found', 'not_found');
        if (currentPolicy().killSwitch) throw new HttpProblem(409, 'the mission kill switch is engaged', 'policy_denied');
        const amountCents = Math.round(num('amountCents'));
        if (!Number.isFinite(amountCents) || amountCents <= 0) throw new HttpProblem(400, 'amountCents must be positive', 'validation_error');
        const reference = (param('reference', '') ?? '').trim();
        if (reference.length < 3) throw new HttpProblem(400, 'a funding reference is required (bank transfer id, statement line, or owner note)', 'validation_error');
        const idempotencyKey = (param('idempotencyKey', '') ?? '').trim();
        if (idempotencyKey.length < 4) throw new HttpProblem(400, 'an idempotencyKey of at least 4 characters is required', 'validation_error');
        const existing = missionDb.get<Row>('SELECT id FROM mission_ledger WHERE idempotency_key = ?', [idempotencyKey]);
        if (existing) {
          json(res, 200, { duplicated: true, wallet: getWallet(wallet.id) });
          return true;
        }
        credit({
          walletId: wallet.id,
          amountCents,
          category: 'owner_capital',
          reference,
          memo: param('memo'),
          actorType: 'owner',
          actorId: session.owner.id,
          idempotencyKey,
        });
        appendMissionAudit({
          actorType: 'owner',
          actorId: session.owner.id,
          action: 'wallet.funded',
          subjectType: 'wallet',
          subjectId: wallet.id,
          detail: { amountCents, reference, idempotencyKey },
        });
        json(res, 201, { wallet: getWallet(wallet.id), amountCents, category: 'owner_capital' });
        return true;
      }
      if (method === 'PATCH' && rest[0]) {
        // Owner budget control (Section 9): raise/lower a wallet's authorised
        // spend ceiling, relabel it, or freeze it. Audited with the delta.
        const session = requireOwner(context, true);
        const wallet = getWallet(rest[0]);
        if (!wallet) throw new HttpProblem(404, 'wallet not found', 'not_found');
        const budgetCents = body.budgetCents === undefined ? wallet.budgetCents : num('budgetCents');
        const status = param('status');
        if (status !== null && !['active', 'frozen'].includes(status)) {
          throw new HttpProblem(400, "status must be 'active' or 'frozen'", 'validation_error');
        }
        json(res, 200, {
          wallet: setWalletBudget({
            walletId: wallet.id,
            budgetCents,
            actorId: session.owner.id,
            label: param('label'),
            status: status as 'active' | 'frozen' | null,
          }),
        });
        return true;
      }
      if (method === 'POST') {
        const session = requireOwner(context, true);
        json(res, 201, {
          wallet: createWallet({
            kind: (param('kind', 'agent') ?? 'agent') as 'agent' | 'worker' | 'mission' | 'reserve' | 'fee',
            label: param('label', '') ?? '',
            agentId: param('agentId'),
            currency: param('currency', currentPolicy().currency) ?? currentPolicy().currency,
            budgetCents: num('budgetCents'),
          }),
        });
        void session;
        return true;
      }
      break;
    }

    // ── Payout slots (exactly four) + payouts ──────────────────────────────
    case 'payout-slots': {
      requireRead(context);
      if (method === 'GET') {
        // Expiry is evaluated on read so a stale verification can never appear
        // payable just because a sweep has not run yet.
        const swept = sweepPayoutVerifications();
        json(res, 200, {
          slots: ensurePayoutSlots(),
          count: 4,
          note: 'Four configurable payout destinations. Slots can be labelled now and completed later; nothing needs to be provided up front.',
          verification: listPayoutSlotVerificationStatuses(),
          checks: PAYOUT_VERIFICATION_CHECKS,
          validityDays: PAYOUT_VERIFICATION_VALIDITY_DAYS,
          swept,
        });
        return true;
      }
      const session = requireOwner(context, true);
      const slotNumber = Number(rest[0] ?? body.slot ?? 0);
      if (rest[1] === 'verify' && method === 'POST') {
        // Evidence-based verification: the owner confirms every required control
        // check and signs the attestation. A partial confirmation is refused with
        // the exact missing checks, so a half-verified destination never becomes
        // payable. `POST` with `startOnly` opens the verification (step 1) and
        // returns the checks to confirm.
        if (param('startOnly') === 'true' || param('startOnly') === '1') {
          json(res, 200, {
            verification: startPayoutVerification({
              slot: slotNumber,
              ownerId: session.owner.id,
              method: param('method') ?? undefined,
              evidenceRef: param('evidenceRef'),
            }),
            checks: PAYOUT_VERIFICATION_CHECKS,
          });
          return true;
        }
        const checksInput = body.checks && typeof body.checks === 'object' && !Array.isArray(body.checks) ? (body.checks as Record<string, boolean>) : null;
        if (checksInput) {
          const confirmed = confirmPayoutVerification({
            slot: slotNumber,
            ownerId: session.owner.id,
            checks: checksInput,
            attestation: param('attestation', '') ?? '',
            evidenceRef: param('evidenceRef'),
            method: param('method') ?? undefined,
          });
          json(res, 200, { slot: confirmed.slot, verification: confirmed.verification, status: payoutSlotVerificationStatus(slotNumber) });
          return true;
        }
        throw new HttpProblem(400, 'destination verification requires control checks and a signed attestation', 'verification_required');
      }
      if (rest[1] === 'verification' && rest[2] === 'start' && method === 'POST') {
        json(res, 200, {
          verification: startPayoutVerification({
            slot: slotNumber,
            ownerId: session.owner.id,
            method: param('method') ?? undefined,
            evidenceRef: param('evidenceRef'),
          }),
          checks: PAYOUT_VERIFICATION_CHECKS,
        });
        return true;
      }
      if (rest[1] === 'verification' && rest[2] === 'confirm' && method === 'POST') {
        const checksInput = body.checks && typeof body.checks === 'object' && !Array.isArray(body.checks) ? (body.checks as Record<string, boolean>) : {};
        const confirmed = confirmPayoutVerification({
          slot: slotNumber,
          ownerId: session.owner.id,
          checks: checksInput,
          attestation: param('attestation', '') ?? '',
          evidenceRef: param('evidenceRef'),
          method: param('method') ?? undefined,
        });
        json(res, 200, { slot: confirmed.slot, verification: confirmed.verification, status: payoutSlotVerificationStatus(slotNumber) });
        return true;
      }
      if (rest[1] === 'verification' && rest[2] === 'revoke' && method === 'POST') {
        json(res, 200, {
          verification: revokePayoutVerification({ slot: slotNumber, ownerId: session.owner.id, reason: param('reason', '') ?? '' }),
          slot: missionDb.get<Row>('SELECT * FROM mission_payout_slots WHERE slot = ?', [slotNumber]),
        });
        return true;
      }
      if (rest[1] === 'verification' && method === 'GET') {
        json(res, 200, payoutSlotVerificationStatus(slotNumber));
        return true;
      }
      if (rest[1] === 'status' && method === 'POST') {
        const status = (param('status', 'paused') ?? 'paused') as 'paused' | 'active' | 'unconfigured';
        json(res, 200, { slot: setPayoutSlotStatus(slotNumber, status, session.owner.id) });
        return true;
      }
      if (method === 'POST') {
        json(res, 200, {
          slot: configurePayoutSlot({
            slot: slotNumber,
            label: param('label') ?? undefined,
            destinationType: param('destinationType'),
            holderName: param('holderName'),
            maskedAccount: param('maskedAccount'),
            providerRef: param('providerRef'),
            currency: param('currency') ?? undefined,
            minPayoutCents: body.minPayoutCents === undefined ? undefined : num('minPayoutCents'),
            maxPayoutCents: body.maxPayoutCents === undefined || body.maxPayoutCents === null ? null : num('maxPayoutCents'),
            approvalRequired: body.approvalRequired === undefined ? undefined : Boolean(body.approvalRequired),
            notes: param('notes'),
            actorId: session.owner.id,
          }),
        });
        return true;
      }
      break;
    }
    case 'payouts': {
      requireRead(context);
      if (method === 'GET') {
        json(res, 200, { payouts: listPayouts(Number(url.searchParams.get('limit') ?? 100)) });
        return true;
      }
      if (rest.length === 0 && method === 'POST') {
        const session = requireOwner(context, true);
        json(res, 201, {
          payout: requestPayout({
            slot: Number(body.slot ?? 0),
            amountCents: num('amountCents'),
            idempotencyKey: param('idempotencyKey', `pay-${Date.now()}`)!,
            requestedBy: session.owner.id,
            memo: param('memo'),
          }),
        });
        return true;
      }
      if (rest[1] === 'decide' && method === 'POST') {
        const session = requireOwner(context, true);
        json(res, 200, { payout: decidePayout({ id: rest[0], decision: param('decision') === 'approved' ? 'approved' : 'rejected', actorId: session.owner.id, note: param('note') }) });
        return true;
      }
      if (rest[1] === 'settle' && method === 'POST') {
        const session = requireOwner(context, true);
        const status = (param('status', 'settled') ?? 'settled') as 'sent' | 'settled' | 'failed';
        json(res, 200, {
          payout: settlePayout({
            id: rest[0],
            status,
            settlementRef: param('settlementRef'),
            failureReason: param('failureReason'),
            actorId: session.owner.id,
          }),
        });
        return true;
      }
      break;
    }

    // ── Reinvestment reserve (real ledger transfers, owner-configured share) ─
    case 'reinvestment': {
      requireRead(context);
      json(res, 200, { reinvestment: reinvestmentSummary() });
      return true;
    }

    // ── Targets (aggressive KPIs, labelled as targets) ─────────────────────
    case 'targets': {
      requireRead(context);
      if (method === 'GET') {
        // The daily sweep is idempotent and records the day's progress; it is
        // part of reading the target board so the owner always sees fresh
        // numbers and a met day is announced exactly once.
        json(res, 200, {
          targets: listTargets(),
          daily: sweepDailyTarget(context.session?.owner.id ?? null),
          note: 'Targets are KPIs. Progress counts verified realized revenue only and a target is never reported as an achievement.',
        });
        return true;
      }
      const session = requireOwner(context, true);
      if (rest.length === 0 && method === 'POST') {
        json(res, 201, {
          target: createTarget({
            label: param('label', '') ?? '',
            period: (param('period', 'day') ?? 'day') as 'day' | 'week' | 'month' | 'quarter',
            amountCents: num('amountCents'),
            metric: param('metric') ?? undefined,
            currency: param('currency') ?? undefined,
            actorId: session.owner.id,
          }),
        });
        return true;
      }
      if (method === 'PATCH' || method === 'POST') {
        json(res, 200, { target: updateTarget({ id: rest[0], status: (param('status') as 'active' | 'paused' | 'archived' | null) ?? undefined, amountCents: body.amountCents === undefined ? undefined : num('amountCents'), actorId: session.owner.id }) });
        return true;
      }
      break;
    }

    // ── Access links (private reachability for authorised agents) ──────────
    case 'access-links': {
      const session = requireOwner(context, method !== 'GET');
      if (method === 'GET') {
        json(res, 200, { links: listAccessLinks() });
        return true;
      }
      if (rest.length === 0 && method === 'POST') {
        const created = createAccessLink({
          label: param('label', '') ?? '',
          scope: (param('scope', 'dashboard:read') ?? 'dashboard:read') as 'dashboard:read' | 'agent:self' | 'owner:read',
          agentId: param('agentId'),
          expiresInHours: body.expiresInHours === undefined ? undefined : num('expiresInHours'),
          maxUses: body.maxUses === undefined ? null : num('maxUses'),
          createdBy: session.owner.id,
        });
        json(res, 201, {
          link: created.link,
          token: created.token,
          warning: 'This token is shown once and stored only as a hash. Share it over a private channel.',
        });
        return true;
      }
      if (rest[1] === 'revoke' && method === 'POST') {
        json(res, 200, { revoked: revokeAccessLink(rest[0], session.owner.id) });
        return true;
      }
      break;
    }

    // ── Social publishing connections (OAuth) ───────────────────────────────
    //
    // Publishing is a private capability: every route here is owner-only EXCEPT
    // the OAuth callback, which the platform's browser redirect reaches without
    // our bearer token. That callback is protected by the OAuth state instead —
    // unguessable, single-use, 10-minute TTL, bound to the owner who started the
    // flow and to the exact redirect URI — which is the standard contract for
    // authorization-code callbacks.
    case 'social': {
      const action = rest[0] ?? 'connections';
      const siteUrl = missionSiteUrl(req);

      if (action === 'connections' && method === 'GET') {
        requireRead(context);
        const platforms = socialPlatformStatuses(siteUrl);
        json(res, 200, {
          siteUrl,
          platforms,
          connected: platforms.filter((entry) => entry.connected).map((entry) => entry.id),
          pending: platforms.filter((entry) => !entry.connected).map((entry) => entry.id),
          // Honest statement of what is missing, in the exact words an owner
          // needs: the redirect URI to register plus the variables to set.
          setup: platforms
            .filter((entry) => !entry.appConfigured)
            .map((entry) => ({
              platform: entry.id,
              label: entry.label,
              redirectUri: entry.redirectUri,
              requireEnvKeys: entry.requiredEnvKeys,
              consoleUrl: entry.consoleUrl,
              docsUrl: entry.docsUrl,
              notes: entry.notes,
            })),
          // Publishing is never simulated: without a connection the platform's
          // tools refuse with provider_not_configured.
          guaranteedEngagement: false,
        });
        return true;
      }

      if (action === 'oauth' && rest[1] && rest[2] === 'start' && method === 'POST') {
        const session = requireOwner(context, true);
        const authorization = beginSocialAuthorization({ platform: rest[1], ownerId: session.owner.id, siteUrl });
        json(res, 200, {
          ...authorization,
          instructions:
            'Open the authorization URL in a browser where you are signed in to the platform, approve the listed scopes, and the callback will store the connection. No credential ever passes through the dashboard.',
        });
        return true;
      }

      if (action === 'oauth' && rest[1] && rest[2] === 'callback') {
        const platformId = rest[1];
        const error = url.searchParams.get('error');
        const code = url.searchParams.get('code') ?? '';
        const state = url.searchParams.get('state') ?? '';
        if (error) {
          recordSocialAuthorizationFailure({
            platform: platformId,
            ownerId: context.session?.owner.id ?? null,
            reason: `platform returned an error: ${error.slice(0, 80)}`,
          });
          json(res, 400, {
            platform: platformId,
            connected: false,
            error: { code: 'authorization_denied', message: `the platform reported: ${error.slice(0, 80)}` },
          });
          return true;
        }
        if (!code || !state) {
          json(res, 400, { platform: platformId, connected: false, error: { code: 'invalid_state', message: 'code and state are both required' } });
          return true;
        }
        try {
          const ownerId = context.session?.owner.id ?? 'owner:oauth-callback';
          const connection = await completeSocialAuthorization({ platform: platformId, code, state, ownerId, siteUrl });
          json(res, 200, { connected: true, connection });
        } catch (caught) {
          const problem = caught as { status?: number; message?: string; code?: string };
          recordSocialAuthorizationFailure({
            platform: platformId,
            ownerId: context.session?.owner.id ?? null,
            reason: (problem.message ?? 'authorization failed').slice(0, 200),
          });
          json(res, problem.status ?? 500, {
            platform: platformId,
            connected: false,
            error: { code: problem.code ?? 'authorization_failed', message: problem.message ?? 'authorization failed' },
          });
        }
        return true;
      }

      if (action === 'connections' && rest[1] && method === 'POST') {
        const session = requireOwner(context, true);
        const disconnect = await disconnectSocial({ platform: rest[1], ownerId: session.owner.id, reason: param('reason') });
        json(res, 200, disconnect);
        return true;
      }

      throw new HttpProblem(404, `no such social route: ${method} ${url.pathname}`, 'not_found');
    }

    // ── Self-management snapshot + reports ─────────────────────────────────
    case 'self-management': {
      requireRead(context);
      json(res, 200, selfManagementSnapshot(url.searchParams.get('agentId') ?? undefined));
      return true;
    }
    case 'reports': {
      requireRead(context);
      if (method === 'GET') {
        json(res, 200, { reports: listReports(url.searchParams.get('agentId') ?? undefined) });
        return true;
      }
      const session = requireOwner(context, true);
      const slug = param('agentSlug');
      if (!slug) throw new HttpProblem(400, 'agentSlug is required', 'validation_error');
      const created = snapshotAgentReport(slug, param('periodStart', new Date(Date.now() - 24 * 3600 * 1000).toISOString())!, param('periodEnd', nowIso())!);
      appendMissionAudit({ actorType: 'owner', actorId: session.owner.id, action: 'report.snapshot_requested', subjectType: 'agent', subjectId: slug });
      json(res, 201, { id: created.id });
      return true;
    }

    // ── Health ──────────────────────────────────────────────────────────────
    case 'health': {
      json(res, 200, {
        status: 'ok',
        service: 'mission',
        isolation: 'separate process, database and auth',
        database: missionDb.path(),
        ownerAccounts: ownerCount(),
        vaultConfigured: vaultConfigured(),
        audit: verifyMissionAudit().ok,
        ledger: verifyLedger().ok,
        requiresOwnerAuth: true,
      });
      return true;
    }
    default:
      break;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Root-agent creation — the mission's own workforce, seeded from the platform
// registry or created deliberately by the owner. Same policy gates as a
// sub-agent, but with no parent and depth 0.
// ─────────────────────────────────────────────────────────────────────────────

function createRootAgent(input: {
  name: string;
  specialization: string;
  activityKey: string;
  budgetCents: number;
  missionRole: 'worker' | 'supervisor' | 'director';
  actorId: string;
}): { agent: Row; contract: Row; wallet: Wallet; cashAccount:Row } {
  return missionDb.transaction(() => {
  const policy = currentPolicy();
  if (!policy.allowAgentCreation) throw new HttpProblem(403, 'agent creation is disabled by policy', 'policy_denied');
  if (policy.killSwitch) throw new HttpProblem(409, 'the mission kill switch is engaged', 'policy_denied');
  if (!input.name.trim()) throw new HttpProblem(400, 'a name is required', 'validation_error');
  const activity = checkActivity(input.activityKey, policy);
  if (!activity.allowed) throw new HttpProblem(403, `activity refused by policy: ${activity.reasons.join('; ')}`, 'policy_denied');
  const total = missionDb.get<Row>('SELECT COUNT(*) AS count FROM mission_agents');
  if (Number(total?.count ?? 0) >= policy.maxAgents) {
    throw new HttpProblem(409, `agent cap reached (max ${policy.maxAgents})`, 'policy_denied');
  }

  const slugBase = `${input.specialization || input.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'root-agent';
  let slug = `${slugBase}-${missionId('x').slice(-6)}`;
  if (findAgentBySlug(slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const agentId = missionId('agt');
  return missionDb.transaction(() => {
    missionDb.run(
      // Column/value order matters here: the root agent's mission role is its own
      // typed role, and its capability list is the activity it was created for.
      `INSERT INTO mission_agents (id, slug, name, category, role_key, parent_id, depth, generation, status, mission_role, origin_platform, capabilities)
       VALUES (?, ?, ?, ?, 'root', NULL, 0, 'custom', 'active', ?, 'mission', ?)`,
      [agentId, slug, input.name.slice(0, 160), input.activityKey, input.missionRole, JSON.stringify([input.activityKey])],
    );
    const contractId = missionId('ctr');
    missionDb.run(
      `INSERT INTO mission_agent_contracts (id, agent_id, parent_agent_id, purpose, permissions, resource_limits, budget_cents, status, approved_by, approved_at, expires_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [
        contractId, agentId, input.specialization || input.name,
        JSON.stringify([input.activityKey, 'tool.request', 'resource.request', 'expense.request', 'report.submit', 'agent.create']),
        JSON.stringify({ maxChildren: policy.maxChildrenPerAgent, maxSpendCents: input.budgetCents, maxDepth: policy.maxDepth }),
        Math.max(0, Math.round(input.budgetCents)), input.actorId, nowIso(),
        new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      ],
    );
    const wallet = createWallet({ kind: 'agent', label: `${input.name} wallet`, agentId, currency: policy.currency, budgetCents: input.budgetCents });
    provisionMoneyAgent(agentId,input.actorId);
    appendMissionAudit({
      actorType: 'owner',
      actorId: input.actorId,
      action: 'agent.created',
      subjectType: 'agent',
      subjectId: agentId,
      detail: { slug, parent: null, activity: input.activityKey, budgetCents: input.budgetCents, missionRole: input.missionRole, contractId },
    });
    return {
      agent: missionDb.get<Row>('SELECT * FROM mission_agents WHERE id = ?', [agentId])!,
      contract: missionDb.get<Row>('SELECT * FROM mission_agent_contracts WHERE id = ?', [contractId])!,
      wallet,
      cashAccount:cashAccount(agentId),
    };
  });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-agent creation under a controlled contract
// ─────────────────────────────────────────────────────────────────────────────

function createSubAgent(input: {
  parentSlug: string;
  name: string;
  specialization: string;
  activityKey: string;
  budgetCents: number;
  actorId: string;
  actorType: 'owner' | 'agent';
}): { agent: Row; contract: Row; wallet: Wallet; cashAccount:Row } {
  return missionDb.transaction(() => {
  const policy = currentPolicy();
  const parent = findAgentBySlug(input.parentSlug);
  if (!parent) throw new HttpProblem(404, 'parent agent not found', 'not_found');
  if (!policy.allowAgentCreation) throw new HttpProblem(403, 'agent creation is disabled by policy', 'policy_denied');
  if (policy.killSwitch) throw new HttpProblem(409, 'the mission kill switch is engaged', 'policy_denied');
  if (!input.name.trim()) throw new HttpProblem(400, 'a name is required', 'validation_error');
  const activity = checkActivity(input.activityKey, policy);
  if (!activity.allowed) throw new HttpProblem(403, `activity refused by policy: ${activity.reasons.join('; ')}`, 'policy_denied');

  const parentDepth = Number(parent.depth);
  if (parentDepth + 1 > policy.maxDepth) {
    throw new HttpProblem(409, `hierarchy depth limit reached (max ${policy.maxDepth})`, 'policy_denied');
  }
  const children = missionDb.get<Row>('SELECT COUNT(*) AS count FROM mission_agents WHERE parent_id = ?', [parent.id]);
  if (Number(children?.count ?? 0) >= policy.maxChildrenPerAgent) {
    throw new HttpProblem(409, `this agent already has the maximum of ${policy.maxChildrenPerAgent} sub-agents`, 'policy_denied');
  }
  const totalAgents = missionDb.get<Row>('SELECT COUNT(*) AS count FROM mission_agents');
  if (Number(totalAgents?.count ?? 0) >= policy.maxAgents) {
    throw new HttpProblem(409, `the mission agent cap of ${policy.maxAgents} is reached`, 'policy_denied');
  }

  const slugBase = `${input.specialization || input.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'sub-agent';
  let slug = `${slugBase}-${missionId('x').slice(-6)}`;
  if (findAgentBySlug(slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const agentId = missionId('agt');
  const depth = parentDepth + 1;
  return missionDb.transaction(() => {
    missionDb.run(
      `INSERT INTO mission_agents (id, slug, name, category, role_key, parent_id, depth, generation, status, mission_role, origin_platform, capabilities)
       VALUES (?, ?, ?, ?, 'sub-agent', ?, ?, 'custom', 'active', 'worker', 'mission', ?)`,
      [agentId, slug, input.name.slice(0, 160), parent.category ?? null, parent.id, depth, JSON.stringify([input.activityKey])],
    );
    const contractId = missionId('ctr');
    missionDb.run(
      `INSERT INTO mission_agent_contracts (id, agent_id, parent_agent_id, purpose, permissions, resource_limits, budget_cents, status, approved_by, approved_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [
        contractId, agentId, parent.id, input.specialization || input.name,
        JSON.stringify([input.activityKey, 'tool.request', 'resource.request', 'expense.request', 'report.submit']),
        JSON.stringify({ maxChildren: 0, maxSpendCents: input.budgetCents, maxDepth: policy.maxDepth - depth }),
        Math.max(0, Math.round(input.budgetCents)), input.actorId, nowIso(),
        new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(),
      ],
    );
    const wallet = createWallet({ kind: 'agent', label: `${input.name} wallet`, agentId, currency: policy.currency, budgetCents: input.budgetCents });
    provisionMoneyAgent(agentId,input.actorId,input.actorType==='agent'?String(parent.id):undefined,input.actorType==='agent'?input.budgetCents:0);
    appendMissionAudit({
      actorType: input.actorType,
      actorId: input.actorId,
      action: 'agent.created',
      subjectType: 'agent',
      subjectId: agentId,
      detail: { slug, parent: input.parentSlug, activity: input.activityKey, budgetCents: input.budgetCents, contractId },
    });
    return {
      agent: missionDb.get<Row>('SELECT * FROM mission_agents WHERE id = ?', [agentId])!,
      contract: missionDb.get<Row>('SELECT * FROM mission_agent_contracts WHERE id = ?', [contractId])!,
      wallet,
      cashAccount:cashAccount(agentId),
    };
  });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Server bootstrap
// ─────────────────────────────────────────────────────────────────────────────

export interface MissionServer {
  server: http.Server;
  port: number;
  host: string;
  close(): Promise<void>;
}

export function createMissionServer(): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (url.pathname.startsWith('/api/')) {
          const context: RequestContext = {
            session: resolveSession(bearer(req)),
            link: resolveAccessLink(linkToken(req)),
          };
          const handled = await handleApi(req, res, url, context);
          if (!handled) json(res, 404, { error: { code: 'not_found', message: `no such mission route: ${req.method} ${url.pathname}` } });
          return;
        }
        if (req.method === 'GET' && serveStatic(res, url.pathname)) return;
        json(res, 404, { error: { code: 'not_found', message: 'not found' } });
      } catch (error) {
        const status =
          error instanceof HttpProblem ? error.status
            : error instanceof MissionAuthError ? error.statusCode
              : error instanceof FreelancerError ? (error.code === 'freelancer_rate_limited' ? 429 : 409)
              : error instanceof AwinError ? (error.code === 'awin_rate_limited' ? 429 : 409)
              : error instanceof MoneyError ? error.statusCode
              : error instanceof MissionTreasuryError ? error.statusCode
                : error instanceof MissionSelfServiceError ? error.statusCode
                  : 500;
        const code =
          error instanceof HttpProblem ? error.code
            : error instanceof MissionAuthError ? error.code
              : error instanceof FreelancerError ? error.code
              : error instanceof AwinError ? error.code
              : error instanceof MoneyError ? error.code
              : error instanceof MissionTreasuryError ? error.code
                : error instanceof MissionSelfServiceError ? error.code
                  : 'internal_error';
        const message = error instanceof Error ? error.message : 'unexpected mission error';
        // Server-side logging only; the client never receives internals beyond
        // the typed code and an actionable message.
        if (status >= 500) console.error('[mission] request failed:', error);
        json(res, status, { error: { code, message } });
      }
    })();
  });
}

export async function startMissionServer(options: { port?: number; host?: string } = {}): Promise<MissionServer> {
  const env = missionEnv();
  applyMissionMigrations(missionDb);
  ensurePolicy(env.currency);
  seedTools();
  ensurePayoutSlots();
  try{ PlatformDiscovery.seedPlatforms(); }catch{}
  // Runtime foundation — fail-safe seeds (idempotent, no fake revenue, no credentials)
  try{ ProviderReadiness.seedProviderReadiness(); }catch{}
  try{ Allocator.ensureCatalogPersisted(); }catch{}
  try{ Scheduler.schedulerStatus(); }catch{} // ensures mission_scheduler_state row exists disabled=0
  const host = options.host ?? env.bindHost;
  const port = options.port ?? env.port;
  const server = createMissionServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    server,
    port: actualPort,
    host,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export { provisionOwner };
