/**
 * ZA141251SA PROVIDER CAPABILITY / READINESS REGISTRY
 * Unified readiness over platform-connectors + credentials + tool catalog + health + payout rail.
 * - Does NOT fabricate readiness: status is derived honestly from configured credentials / health / ToS.
 * - Does NOT count infra/payment rails as earning sources.
 * - Strict financial isolation: imports only missionDb, never platform DB.
 */

import { missionDb as db, missionId, nowIso, appendMissionAudit, type Row } from '../database';
import { MoneyError, type MoneyActor } from '../money';
import { currentPolicy } from '../policy';
import { PLATFORM_CONNECTORS, type PlatformConnector } from './platform-connectors';

function deny(code: string): never { throw new MoneyError(`provider_readiness_${code}` as any); }

/** Map connector id -> credential env var (honest, no secret values exposed) */
const CREDENTIAL_ENV: Record<string, string> = {
  freelancer: 'FREELANCER_OAUTH_TOKEN',
  upwork: 'UPWORK_PAT',
  fiverr: 'FIVERR_API_KEY',
  toptal: 'TOPTAL_API_KEY',
  contra: 'CONTRA_API_KEY',
  hackerone: 'HACKERONE_API_KEY',
  bugcrowd: 'BUGCROWD_API_KEY',
  kaggle: 'KAGGLE_API_KEY',
  rapidapi: 'RAPIDAPI_KEY',
  aws_data_exchange: 'AWS_DATA_EXCHANGE_TOKEN',
  gumroad: 'GUMROAD_API_KEY',
  lemon_squeezy: 'LEMON_SQUEEZY_API_KEY',
  github_sponsors: 'GITHUB_TOKEN',
  open_collective: 'OPENCOLLECTIVE_API_KEY',
  amazon_associates: 'AMAZON_ASSOCIATE_TAG',
  awin: 'AWIN_API_KEY',
  shareasale: 'SHAREASALE_API_KEY',
  direct_client_research: '',
  direct_ai_implementation: '',
  direct_automation: '',
  direct_consulting: '',
  seo_direct: '',
};

export interface ProviderReadiness {
  providerId: string;
  label: string;
  kind: string;
  credentialEnv: string | null;
  requiresOwnerAccount: boolean;
  payoutVerifiable: boolean;
  apiPermitted: boolean;
  status: 'not_configured'|'configured'|'ready'|'blocked'|'restricted'|'degraded';
  health: { lastCheck: string | null; ok: boolean | null; detail: string };
  ownerActions: string[];
  earningSource: boolean;
}

function connectorToReadiness(conn: PlatformConnector): ProviderReadiness {
  const env = CREDENTIAL_ENV[conn.id] ?? '';
  const credentialEnv = env || null;
  const hasCredential = credentialEnv ? !!process.env[credentialEnv] : false;
  // Check stored credential in mission vault
  const vaultCred = credentialEnv ? db.get<Row>('SELECT id FROM mission_credentials WHERE provider=? AND status=? LIMIT 1', [conn.id, 'active']) : null;
  const configured = hasCredential || !!vaultCred;
  // Health: check last failure or service health
  const failure = db.get<Row>('SELECT category, detail FROM mission_provider_failures WHERE provider_id=? ORDER BY created_at DESC LIMIT 1', [conn.id]);
  const healthOk = failure ? false : null;
  let status: ProviderReadiness['status'] = 'not_configured';
  if (conn.status === 'BLOCKED') status = 'blocked';
  else if (conn.status === 'RESTRICTED' || conn.kind === 'RESTRICTED_HUMAN_ONLY') status = 'restricted';
  else if (failure && String(failure.category)==='rate_limit') status = 'degraded';
  else if (failure) status = 'degraded';
  else if (!configured && conn.requiresOwnerAccount) status = 'not_configured';
  else if (configured || !conn.requiresOwnerAccount) status = conn.apiPermitted ? 'ready' : 'configured';
  else status = 'not_configured';

  const ownerActions: string[] = [];
  if (conn.requiresOwnerAccount && !configured) ownerActions.push(`Create ${conn.label} account via official flow and add credential ${credentialEnv ?? 'via vault'}`);
  if (!conn.payoutVerifiable) ownerActions.push('Payout not independently verifiable — cannot enter mission cash');
  if (!conn.apiPermitted) ownerActions.push('API not permitted per ToS — human-only actions required');
  if (failure) ownerActions.push(`Provider degraded (${String(failure.category)}): ${String(failure.detail ?? '').slice(0,120)}`);
  ownerActions.push(...conn.humanOnlyActions.slice(0,3));

  return {
    providerId: conn.id,
    label: conn.label,
    kind: conn.kind,
    credentialEnv,
    requiresOwnerAccount: conn.requiresOwnerAccount,
    payoutVerifiable: conn.payoutVerifiable,
    apiPermitted: conn.apiPermitted,
    status,
    health: { lastCheck: null, ok: healthOk, detail: failure ? String(failure.detail ?? failure.category) : configured ? 'credential present' : 'no credential' },
    ownerActions,
    earningSource: conn.kind === 'EARNING_SOURCE',
  };
}

export function seedProviderReadiness(): number {
  let seeded = 0;
  for (const conn of PLATFORM_CONNECTORS) {
    const r = connectorToReadiness(conn);
    if (db.get('SELECT provider_id FROM mission_provider_readiness WHERE provider_id=?', [conn.id])) {
      db.run('UPDATE mission_provider_readiness SET label=?, kind=?, credential_env=?, requires_owner_account=?, payout_verifiable=?, api_permitted=?, status=?, health_json=?, owner_actions_json=?, updated_at=? WHERE provider_id=?',
        [r.label, r.kind, r.credentialEnv, r.requiresOwnerAccount?1:0, r.payoutVerifiable?1:0, r.apiPermitted?1:0, r.status, JSON.stringify(r.health), JSON.stringify(r.ownerActions), nowIso(), conn.id]);
    } else {
      db.run('INSERT INTO mission_provider_readiness (id, provider_id, label, kind, credential_env, requires_owner_account, payout_verifiable, api_permitted, status, health_json, owner_actions_json, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [missionId('pread'), conn.id, r.label, r.kind, r.credentialEnv, r.requiresOwnerAccount?1:0, r.payoutVerifiable?1:0, r.apiPermitted?1:0, r.status, JSON.stringify(r.health), JSON.stringify(r.ownerActions), nowIso()]);
      seeded++;
    }
  }
  return seeded;
}

export function getProviderReadiness(providerId: string): ProviderReadiness | undefined {
  seedProviderReadiness();
  const row = db.get<Row>('SELECT * FROM mission_provider_readiness WHERE provider_id=?', [providerId]);
  if (!row) return undefined;
  const conn = PLATFORM_CONNECTORS.find(c=> c.id===providerId);
  if (conn) return connectorToReadiness(conn);
  return {
    providerId: String(row.provider_id),
    label: String(row.label),
    kind: String(row.kind),
    credentialEnv: row.credential_env ? String(row.credential_env) : null,
    requiresOwnerAccount: !!row.requires_owner_account,
    payoutVerifiable: !!row.payout_verifiable,
    apiPermitted: !!row.api_permitted,
    status: String(row.status) as any,
    health: (()=>{ try{ return JSON.parse(String(row.health_json)); }catch{ return {lastCheck:null, ok:null, detail:''}; }})(),
    ownerActions: (()=>{ try{ return JSON.parse(String(row.owner_actions_json)); }catch{ return []; }})(),
    earningSource: String(row.kind)==='EARNING_SOURCE',
  };
}

export function listProviderReadiness(kindFilter?: string): ProviderReadiness[] {
  seedProviderReadiness();
  const rows = PLATFORM_CONNECTORS.map(connectorToReadiness);
  if (kindFilter) return rows.filter(r=> r.kind===kindFilter);
  return rows;
}

export function listEarningReadiness(): { total: number; ready: number; notConfigured: number; blocked: number; restricted: number; degraded: number; details: ProviderReadiness[] } {
  const all = listProviderReadiness('EARNING_SOURCE');
  const earning = all.filter(r=> r.earningSource);
  return {
    total: earning.length,
    ready: earning.filter(r=> r.status==='ready').length,
    notConfigured: earning.filter(r=> r.status==='not_configured').length,
    blocked: earning.filter(r=> r.status==='blocked').length,
    restricted: earning.filter(r=> r.status==='restricted').length,
    degraded: earning.filter(r=> r.status==='degraded').length,
    details: earning,
  };
}

export function recordProviderFailure(providerId: string, failure: { code: string; category: 'rate_limit'|'transient'|'auth'|'payment'|'toS_block'|'unreachable'|'validation'; detail?: string; retryAfterMs?: number }): Row {
  const id = missionId('provfail');
  const backoff = failure.retryAfterMs ?? (failure.category==='rate_limit'? 60000 : failure.category==='transient'? 30000 : 0);
  const retryAfter = failure.retryAfterMs ? new Date(Date.now()+ failure.retryAfterMs).toISOString() : null;
  db.run('INSERT INTO mission_provider_failures (id, provider_id, failure_code, category, detail, retry_after, backoff_ms, attempts, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, providerId, failure.code.slice(0,120), failure.category, (failure.detail ?? '').slice(0,500), retryAfter, backoff, 1, nowIso()]);
  // Update readiness to degraded
  const existing = db.get<Row>('SELECT * FROM mission_provider_readiness WHERE provider_id=?', [providerId]);
  if (existing) {
    db.run('UPDATE mission_provider_readiness SET status=?, health_json=?, updated_at=? WHERE provider_id=?',
      ['degraded', JSON.stringify({lastCheck: nowIso(), ok:false, detail: failure.detail ?? failure.code}), nowIso(), providerId]);
  }
  appendMissionAudit({ actorType:'system', action:'provider.failure_recorded', subjectType:'provider', subjectId:providerId, detail:{code:failure.code, category:failure.category}});
  return db.get<Row>('SELECT * FROM mission_provider_failures WHERE id=?', [id])!;
}

export function clearProviderFailures(providerId: string): number {
  const before = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_provider_failures WHERE provider_id=?', [providerId])?.c ?? 0);
  db.run('DELETE FROM mission_provider_failures WHERE provider_id=?', [providerId]);
  db.run('UPDATE mission_provider_readiness SET status=?, health_json=?, updated_at=? WHERE provider_id=?',
    ['ready', JSON.stringify({lastCheck: nowIso(), ok:true, detail:'recovered'}), nowIso(), providerId]);
  return before;
}

export function providerReadinessSummary(): Record<string, unknown> {
  const earning = listEarningReadiness();
  const infra = listProviderReadiness('INFRASTRUCTURE').length;
  const rails = listProviderReadiness('PAYMENT_RAIL').length;
  const tools = listProviderReadiness('TOOL').length;
  return {
    earningSources: { total: earning.total, ready: earning.ready, notConfigured: earning.notConfigured, blocked: earning.blocked, restricted: earning.restricted, degraded: earning.degraded },
    infrastructure: infra,
    paymentRails: rails,
    tools,
    note: 'Infrastructure/payment rails/tools are not earning sources; readiness derived honestly from credentials/health/ToS.',
  };
}
