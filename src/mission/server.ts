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
  verifyPayoutSlot,
  verifyLedger,
  type Wallet,
} from './treasury';
import {
  MissionSelfServiceError,
  credentialRotations,
  decideResource,
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
  activityCatalog,
} from './reporting';

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
function requireAgent(context: RequestContext, agentSlugOrId: string | null): { agentId: string; actorId: string; actorType: 'agent' } {
  if (context.session) {
    const agent = agentSlugOrId ? (findAgentBySlug(agentSlugOrId) ?? findAgentById(agentSlugOrId)) : undefined;
    if (!agent) throw new HttpProblem(404, 'agent not found', 'not_found');
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
        json(res, 200, { owner: session.owner, expiresAt: null, vaultConfigured: vaultConfigured() });
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
        const result = decideApproval({ id: rest[0], decision, decidedBy: session.owner.id, note: param('note') });
        if (!result.ok) throw new HttpProblem(result.status === 'not_found' ? 404 : 409, result.reason ?? 'approval not actionable', result.status === 'not_found' ? 'not_found' : 'conflict');
        json(res, 200, result);
        return true;
      }
      json(res, 200, { pending: listApprovals('pending'), all: listApprovals() });
      return true;
    }

    // ── Policy ──────────────────────────────────────────────────────────────
    case 'policy': {
      requireRead(context);
      if (method === 'PATCH' || method === 'POST') {
        const session = requireOwner(context, true);
        const patch: Record<string, unknown> = {};
        if (body.autonomousEnabled !== undefined) patch.autonomousEnabled = Boolean(body.autonomousEnabled);
        if (body.allowAgentCreation !== undefined) patch.allowAgentCreation = Boolean(body.allowAgentCreation);
        if (body.requireOwnerForPayout !== undefined) patch.requireOwnerForPayout = Boolean(body.requireOwnerForPayout);
        for (const key of ['maxDepth', 'maxChildrenPerAgent', 'maxAgents', 'maxDailySpendCents', 'maxExpenseCents', 'maxPayoutCents', 'requireApprovalAboveCents'] as const) {
          if (body[key] !== undefined) patch[key] = num(key);
        }
        if (Array.isArray(body.allowedActivities)) patch.allowedActivities = body.allowedActivities.map((entry) => String(entry));
        if (body.providerActivation !== undefined) patch.providerActivation = body.providerActivation as Array<Record<string, unknown>>;
        json(res, 200, { policy: updatePolicy(patch, session.owner.id), categories: activityCatalog() });
        return true;
      }
      if (method === 'POST' && rest[0] === 'kill-switch') {
        const session = requireOwner(context, true);
        json(res, 200, { killSwitch: setKillSwitch(Boolean(body.engage ?? true), session.owner.id) });
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
      if (rest.length === 0) {
        const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
        const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
        const where = query ? 'WHERE lower(slug) LIKE ? OR lower(name) LIKE ?' : '';
        const params: Array<string | number> = query ? [`%${query}%`, `%${query}%`] : [];
        const rows = missionDb.all<Row>(
          `SELECT id, slug, name, category, mission_role, status, depth, parent_id, generation FROM mission_agents ${where} ORDER BY slug LIMIT ? OFFSET ?`,
          [...params, limit, offset],
        );
        const total = missionDb.get<Row>(`SELECT COUNT(*) AS count FROM mission_agents ${where}`, params);
        json(res, 200, { total: Number(total?.count ?? 0), limit, offset, agents: rows });
        return true;
      }
      const slug = rest[0];
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
      if (rest[1] === 'children' && method === 'POST') {
        // Controlled sub-agent creation: contract + limits + audit, or refused.
        const session = requireOwner(context, true);
        const created = createSubAgent({
          parentSlug: slug,
          name: param('name', '') ?? '',
          specialization: param('specialization', '') ?? '',
          activityKey: param('activity', 'general') ?? 'general',
          budgetCents: num('budgetCents'),
          actorId: session.owner.id,
          actorType: 'owner',
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
      if (method === 'GET') {
        const expiring = url.searchParams.get('expiring');
        json(res, 200, { resources: listResources(url.searchParams.get('agentId') ?? undefined), expiring: expiring === '1' });
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
        requireAgent(context, param('agentSlug'));
        json(res, 200, { resource: recordResourceUsage({ id: rest[0], usage: (body.usage as Record<string, unknown>) ?? {}, actorId: context.session?.owner.id ?? null }) });
        return true;
      }
      if (rest[1] === 'decide' && method === 'POST') {
        const session = requireOwner(context, true);
        json(res, 200, { resource: decideResource({ id: rest[0], decision: param('decision') === 'approved' ? 'approved' : 'rejected', actorId: session.owner.id, note: param('note') }) });
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
        json(res, 200, { upgrade: decideUpgrade({ id: rest[0], decision: param('decision') === 'approved' ? 'approved' : 'rejected', actorId: session.owner.id, note: param('note') }) });
        return true;
      }
      if (rest[1] === 'apply' && method === 'POST') {
        const session = requireOwner(context, true);
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
        const result = requestExpense({
          agentId: agent.agentId,
          walletId: param('walletId', '') ?? '',
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
        json(res, 200, { slot: verifyPayoutSlot(slotNumber, session.owner.id), warning: 'this activation path records no evidence — use the verification flow to confirm the control checks and attestation' });
        return true;
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

    // ── Targets (aggressive KPIs, labelled as targets) ─────────────────────
    case 'targets': {
      requireRead(context);
      if (method === 'GET') {
        json(res, 200, { targets: listTargets(), note: 'Targets are KPIs. Progress counts verified realized revenue only and a target is never reported as an achievement.' });
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
}): { agent: Row; contract: Row; wallet: Wallet } {
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
    };
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
              : error instanceof MissionTreasuryError ? error.statusCode
                : error instanceof MissionSelfServiceError ? error.statusCode
                  : 500;
        const code =
          error instanceof HttpProblem ? error.code
            : error instanceof MissionAuthError ? error.code
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
  applyMissionMigrations();
  ensurePolicy(env.currency);
  seedTools();
  ensurePayoutSlots();
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
