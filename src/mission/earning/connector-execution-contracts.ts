/**
 * ZA141251SA CONNECTOR EXECUTION CONTRACTS
 * Unified contract per connector: input schema, idempotency, rate-limit, retries, backoff, provider error map, audit events.
 * 34 permitted earning sources each get a contract; infra/payment rails/tools have no execution contract.
 * Never fabricates: contracts describe honest provider behavior + ToS limits.
 */

import { missionDb as db, missionId, nowIso, type Row } from '../database';
import { PLATFORM_CONNECTORS } from './platform-connectors';

export interface ConnectorExecutionContract {
  connectorId: string;
  label: string;
  executionInputSchema: Record<string, unknown>; // JSON schema fragment
  executionOutputSchema: Record<string, unknown>;
  idempotencyKeyTemplate: string;
  rateLimitPerMin: number;
  maxRetries: number;
  backoffBaseMs: number;
  providerErrorMap: Record<string, 'rate_limit'|'transient'|'auth'|'payment'|'toS_block'|'unreachable'|'validation'>;
  auditEvents: string[];
  humanOnly: boolean;
  requiresOwnerCredential: boolean;
}

const COMMON_INPUT: Record<string, unknown> = {
  type: 'object',
  required: ['opportunityId','agentId','scopeHash'],
  properties: {
    opportunityId: {type:'string'},
    agentId: {type:'string'},
    scopeHash: {type:'string'},
    deliverableRef: {type:'string'},
    idempotencyKey: {type:'string'},
  }
};

const COMMON_OUTPUT: Record<string, unknown> = {
  type: 'object',
  required: ['status','evidenceHash'],
  properties: {
    status: {enum:['acknowledged','delivered','provider_confirmed']},
    evidenceHash: {type:'string'},
    providerRef: {type:'string'},
  }
};

const DEFAULT_ERROR_MAP: Record<string, string> = {
  rate_limited: 'rate_limit',
  '429': 'rate_limit',
  freelancer_rate_limited: 'rate_limit',
  freelancer_http_failure: 'transient',
  freelancer_access_denied: 'auth',
  freelancer_transport_or_parse_failure: 'unreachable',
  invalid_response: 'validation',
  provider_rejected: 'validation',
  provider_unreachable: 'unreachable',
  account_authorization_required: 'auth',
};

function contractFor(id: string, label: string, overrides: Partial<ConnectorExecutionContract> = {}): ConnectorExecutionContract {
  return {
    connectorId: id,
    label,
    executionInputSchema: COMMON_INPUT,
    executionOutputSchema: COMMON_OUTPUT,
    idempotencyKeyTemplate: 'exec:{opportunityId}:{agentId}:{scopeHash}',
    rateLimitPerMin: overrides.rateLimitPerMin ?? 10,
    maxRetries: overrides.maxRetries ?? 3,
    backoffBaseMs: overrides.backoffBaseMs ?? 60000,
    providerErrorMap: { ...DEFAULT_ERROR_MAP, ...(overrides.providerErrorMap ?? {}) } as any,
    auditEvents: overrides.auditEvents ?? ['connector.execution_started','connector.execution_delivered','connector.execution_verified','connector.provider_confirmed'],
    humanOnly: overrides.humanOnly ?? false,
    requiresOwnerCredential: overrides.requiresOwnerCredential ?? true,
  };
}

/** Seeded contracts for 34 permitted earning sources */
const CONTRACTS: ConnectorExecutionContract[] = [
  contractFor('freelancer','Freelancer.com', {rateLimitPerMin: 5, maxRetries: 2}),
  contractFor('upwork','Upwork', {rateLimitPerMin: 5}),
  contractFor('fiverr','Fiverr', {rateLimitPerMin: 10}),
  contractFor('contra','Contra', {rateLimitPerMin: 10}),
  contractFor('toptal','Toptal', {humanOnly:true, rateLimitPerMin: 2}),
  contractFor('peopleperhour','PeoplePerHour', {humanOnly:true}),
  contractFor('guru','Guru', {humanOnly:true}),
  contractFor('hackerone','HackerOne', {rateLimitPerMin: 3, providerErrorMap:{out_of_scope:'toS_block'}}),
  contractFor('bugcrowd','Bugcrowd', {rateLimitPerMin: 3}),
  contractFor('yeswehack','YesWeHack'),
  contractFor('intigriti','Intigriti'),
  contractFor('kaggle','Kaggle Competitions', {maxRetries: 1}),
  contractFor('topcoder','Topcoder'),
  contractFor('devpost','Devpost', {humanOnly:true}),
  contractFor('rapidapi','RapidAPI', {rateLimitPerMin: 20}),
  contractFor('aws_data_exchange','AWS Data Exchange'),
  contractFor('gumroad','Gumroad', {humanOnly:true}),
  contractFor('lemon_squeezy','Lemon Squeezy', {humanOnly:true}),
  contractFor('etsy_digital','Etsy (digital)', {humanOnly:true}),
  contractFor('shopify_app_store','Shopify App Store', {humanOnly:true}),
  contractFor('atlassian_marketplace','Atlassian Marketplace', {humanOnly:true}),
  contractFor('wordpress_plugin','WordPress Plugin Directory', {humanOnly:true}),
  contractFor('github_sponsors','GitHub Sponsors', {humanOnly:true}),
  contractFor('open_collective','Open Collective', {humanOnly:true}),
  contractFor('amazon_associates','Amazon Associates', {rateLimitPerMin: 20}),
  contractFor('awin','Awin', {rateLimitPerMin: 10, providerErrorMap:{awin_http_failure:'transient', awin_access_denied:'auth'}}),
  contractFor('shareasale','ShareASale'),
  contractFor('testio','Test.io', {rateLimitPerMin: 5}),
  contractFor('gengo','Gengo', {humanOnly:true}),
  contractFor('direct_client_research','Direct Client Research', {requiresOwnerCredential:false, rateLimitPerMin: 30, maxRetries: 5, backoffBaseMs: 30000}),
  contractFor('direct_ai_implementation','Direct AI Implementation', {requiresOwnerCredential:false, rateLimitPerMin: 20}),
  contractFor('direct_automation','Direct Automation', {requiresOwnerCredential:false}),
  contractFor('direct_consulting','Direct Consulting', {requiresOwnerCredential:false, humanOnly:true}),
  contractFor('seo_direct','Direct SEO/Marketing Audit', {requiresOwnerCredential:false}),
];

export function seedConnectorContracts(): number {
  let seeded=0;
  for (const c of CONTRACTS) {
    if (db.get('SELECT connector_id FROM mission_connector_contracts WHERE connector_id=?', [c.connectorId])) {
      db.run('UPDATE mission_connector_contracts SET execution_input_schema=?, execution_output_schema=?, idempotency_key_template=?, rate_limit_per_min=?, max_retries=?, backoff_base_ms=?, provider_error_map=?, audit_events=?, updated_at=? WHERE connector_id=?',
        [JSON.stringify(c.executionInputSchema), JSON.stringify(c.executionOutputSchema), c.idempotencyKeyTemplate, c.rateLimitPerMin, c.maxRetries, c.backoffBaseMs, JSON.stringify(c.providerErrorMap), JSON.stringify(c.auditEvents), nowIso(), c.connectorId]);
    } else {
      db.run('INSERT INTO mission_connector_contracts (id, connector_id, execution_input_schema, execution_output_schema, idempotency_key_template, rate_limit_per_min, max_retries, backoff_base_ms, provider_error_map, audit_events, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [missionId('ccon'), c.connectorId, JSON.stringify(c.executionInputSchema), JSON.stringify(c.executionOutputSchema), c.idempotencyKeyTemplate, c.rateLimitPerMin, c.maxRetries, c.backoffBaseMs, JSON.stringify(c.providerErrorMap), JSON.stringify(c.auditEvents), nowIso(), nowIso()]);
      seeded++;
    }
  }
  return seeded;
}

export function getConnectorContract(connectorId: string): ConnectorExecutionContract | undefined {
  seedConnectorContracts();
  const row = db.get<Row>('SELECT * FROM mission_connector_contracts WHERE connector_id=?', [connectorId]);
  if (!row) return undefined;
  return {
    connectorId: String(row.connector_id),
    label: CONTRACTS.find(c=>c.connectorId===connectorId)?.label ?? String(row.connector_id),
    executionInputSchema: (()=>{ try{ return JSON.parse(String(row.execution_input_schema)); }catch{ return COMMON_INPUT; }})(),
    executionOutputSchema: (()=>{ try{ return JSON.parse(String(row.execution_output_schema)); }catch{ return COMMON_OUTPUT; }})(),
    idempotencyKeyTemplate: String(row.idempotency_key_template),
    rateLimitPerMin: Number(row.rate_limit_per_min),
    maxRetries: Number(row.max_retries),
    backoffBaseMs: Number(row.backoff_base_ms),
    providerErrorMap: (()=>{ try{ return JSON.parse(String(row.provider_error_map)); }catch{ return DEFAULT_ERROR_MAP; }})(),
    auditEvents: (()=>{ try{ return JSON.parse(String(row.audit_events)); }catch{ return []; }})(),
    humanOnly: !!CONTRACTS.find(c=>c.connectorId===connectorId)?.humanOnly,
    requiresOwnerCredential: !!CONTRACTS.find(c=>c.connectorId===connectorId)?.requiresOwnerCredential,
  };
}

export function listConnectorContracts(): ConnectorExecutionContract[] {
  seedConnectorContracts();
  return CONTRACTS.map(c=> getConnectorContract(c.connectorId)!).filter(Boolean);
}

export function classifyProviderError(connectorId: string, code: string): 'rate_limit'|'transient'|'auth'|'payment'|'toS_block'|'unreachable'|'validation' {
  const contract = getConnectorContract(connectorId);
  const map = contract?.providerErrorMap ?? DEFAULT_ERROR_MAP as any;
  return (map[code] ?? map[String(code).toLowerCase()] ?? 'transient') as any;
}

export function idempotencyKeyFor(contract: ConnectorExecutionContract, vars: Record<string,string>): string {
  let key = contract.idempotencyKeyTemplate;
  for (const [k,v] of Object.entries(vars)) key = key.replace(`{${k}}`, v);
  return key.slice(0,240);
}
