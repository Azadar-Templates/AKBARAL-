import { missionDb, missionId, nowIso, type Row } from '../database';
import { assertInScope } from './bug-bounty-system';

export type PlatformCategory = 'web3_contest' | 'web3_bounty' | 'web_bugbounty' | 'github';
export type AdapterStatus = 'ok' | 'unavailable' | 'auth_required' | 'rate_limited' | 'not_implemented' | 'not_ready';
export interface AdapterResult<T> { status: AdapterStatus; data?: T; reason: string; credentialName?: string; observedAt: string }
export interface PlatformAdapter {
  readonly platformKey: string;
  discoverPrograms(context?: AdapterScope): Promise<AdapterResult<Array<Record<string, unknown>>>>;
  listOpenFindings(context?: AdapterScope): Promise<AdapterResult<Array<Record<string, unknown>>>>;
  getProgramRules(context?: AdapterScope): Promise<AdapterResult<Record<string, unknown>>>;
  buildSubmissionPayload(finding: Record<string, any>, context?: AdapterScope): AdapterResult<Record<string, unknown>>;
  validateForSubmission(finding: Record<string, any>, context?: AdapterScope): AdapterResult<Record<string, unknown>>;
}
export interface AdapterScope { programId: string; target: string }

const PLATFORM_SPECS: Array<{ key: string; displayName: string; category: PlatformCategory; style: string; auth: boolean }> = [
  ['immunefi','Immunefi','web3_bounty','immunefi',true], ['code4rena','Code4rena','web3_contest','code4rena_markdown',false], ['sherlock','Sherlock','web3_contest','sherlock_markdown',true], ['cantina','Cantina','web3_contest','cantina_markdown',true],
  ['openzeppelin','OpenZeppelin','web3_bounty','web3_markdown',false], ['paladin','Paladin','web3_bounty','web3_markdown',true], ['hatsfinance','Hats Finance','web3_bounty','web3_markdown',false], ['sparbit','Spearbit','web3_contest','spearbit_markdown',true],
  ['layer3','Layer3','web3_bounty','web3_markdown',false], ['dorahacks','DoraHacks','web3_contest','web3_markdown',false], ['hackerone','HackerOne','web_bugbounty','hackerone',true], ['bugcrowd','Bugcrowd','web_bugbounty','bugcrowd',true],
  ['yeswehack','YesWeHack','web_bugbounty','yeswehack',false], ['intigriti','Intigriti','web_bugbounty','intigriti',true], ['patchstack','Patchstack','web_bugbounty','patchstack',false], ['wordfence','Wordfence','web_bugbounty','wordfence',false], ['github','GitHub','github','github_pr',false],
].map(([key, displayName, category, style, auth]) => ({ key: String(key), displayName: String(displayName), category: category as PlatformCategory, style: String(style), auth: Boolean(auth) }));

function rowPublic(row: Row): Record<string, unknown> { return { id: String(row.id), platformKey: String(row.platform_key), displayName: String(row.display_name), category: String(row.category), publicApiBase: row.public_api_base ? String(row.public_api_base) : null, publicFeedUrl: row.public_feed_url ? String(row.public_feed_url) : null, authRequiredForReads: Number(row.auth_required_for_reads) === 1, rateLimitPerMin: Number(row.rate_limit_per_min), submissionStyle: String(row.submission_style), adapterStatus: String(row.adapter_status), lastSyncStatus: row.last_sync_status ? String(row.last_sync_status) : null, lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null, notes: String(row.notes) }; }
export function listPlatformAdapters(): Array<Record<string, unknown>> { return missionDb.all<Row>('SELECT * FROM platform_adapters ORDER BY platform_key').map(rowPublic); }
export function getPlatformAdapter(platformKey: string): Record<string, unknown> | null { const row = missionDb.get<Row>('SELECT * FROM platform_adapters WHERE platform_key=?', [platformKey]); return row ? rowPublic(row) : null; }

function unavailable<T>(reason: string, credentialName?: string): AdapterResult<T> { return { status: credentialName ? 'auth_required' : 'unavailable', reason, ...(credentialName ? { credentialName } : {}), observedAt: nowIso() }; }
function scopeOrBlocked(context: AdapterScope | undefined): AdapterResult<never> | null {
  if (!context) return { status: 'not_ready', reason: 'programId and target are required before any adapter operation', observedAt: nowIso() };
  try { assertInScope(context.programId, context.target, { agentType: 'platform_adapter' }); return null; } catch { return { status: 'not_ready', reason: 'scope gate blocked adapter operation', observedAt: nowIso() }; }
}

function submissionShape(style: string, finding: Record<string, any>): Record<string, unknown> {
  const title = String(finding.title ?? ''); const summary = String(finding.summary ?? ''); const evidence = String(finding.evidence ?? ''); const reproduction = String(finding.reproduction ?? ''); const impact = String(finding.impact ?? ''); const cvss = String(finding.cvssVector ?? '');
  if (style === 'hackerone') return { title, weakness: finding.weakness ?? finding.vulnerabilityClass ?? 'unverified', severity: { rating: finding.severity ?? 'unverified', score: finding.cvssScore ?? null }, structured: { summary, impact, stepsToReproduce: reproduction, supportingMaterial: evidence, timeline: finding.timeline ?? [] } };
  if (style === 'immunefi') return { title, severity: finding.severity ?? 'unverified', impact, poc: reproduction, evidence, cvssVector: cvss };
  if (style === 'github_pr') return { title, type: finding.patch ? 'pull_request_draft' : 'issue', body: `## Summary\n${summary}\n\n## Evidence\n${evidence}\n\n## Reproduction\n${reproduction}\n\n## Impact\n${impact}\n\nCVSS: ${cvss}`, submit: false };
  return { title, markdown: `# ${title}\n\n## Summary\n${summary}\n\n## Evidence\n${evidence}\n\n## Reproduction\n${reproduction}\n\n## Impact\n${impact}\n\nCVSS: ${cvss}`, submit: false };
}

class ReadOnlyPlatformAdapter implements PlatformAdapter {
  readonly platformKey: string;
  constructor(private readonly row: Row) { this.platformKey = String(row.platform_key); }
  async discoverPrograms(context?: AdapterScope): Promise<AdapterResult<Array<Record<string, unknown>>>> { const blocked = scopeOrBlocked(context); if (blocked) return blocked; return unavailable('unavailable_public_source: no verified public feed is configured; no request was attempted', Number(this.row.auth_required_for_reads) === 1 ? `platform.${this.platformKey}.read` : undefined); }
  async listOpenFindings(context?: AdapterScope): Promise<AdapterResult<Array<Record<string, unknown>>>> { const blocked = scopeOrBlocked(context); if (blocked) return blocked; return unavailable('unavailable_public_source: no verified public feed is configured; no request was attempted', Number(this.row.auth_required_for_reads) === 1 ? `platform.${this.platformKey}.read` : undefined); }
  async getProgramRules(context?: AdapterScope): Promise<AdapterResult<Record<string, unknown>>> { const blocked = scopeOrBlocked(context); if (blocked) return blocked; return unavailable('unavailable_public_source: rules were not invented and no request was attempted', Number(this.row.auth_required_for_reads) === 1 ? `platform.${this.platformKey}.read` : undefined); }
  buildSubmissionPayload(finding: Record<string, any>, context?: AdapterScope): AdapterResult<Record<string, unknown>> {
    const blocked = scopeOrBlocked(context); if (blocked) return blocked;
    if (!context || !missionDb.get('SELECT id FROM quality_policies WHERE program_id=?', [context.programId])) return { status: 'not_ready', reason: 'quality policy is required before any payload build', observedAt: nowIso() };
    const required = ['title','summary','evidence','reproduction','impact','cvssVector']; const missing = required.filter((key) => !String(finding[key] ?? '').trim()); if (missing.length) return { status: 'not_ready', reason: `required fields missing: ${missing.join(', ')}`, observedAt: nowIso() };
    return { status: 'ok', reason: 'payload built only; no submission capability exists', data: { platform: this.platformKey, submissionStyle: String(this.row.submission_style), payload: submissionShape(String(this.row.submission_style), finding), submitted: false }, observedAt: nowIso() };
  }
  validateForSubmission(finding: Record<string, any>, context?: AdapterScope): AdapterResult<Record<string, unknown>> {
    const blocked = scopeOrBlocked(context); if (blocked) return blocked;
    if (!context || !missionDb.get('SELECT id FROM quality_policies WHERE program_id=?', [context.programId])) return { status: 'not_ready', reason: 'quality policy is required before any payload build', observedAt: nowIso() };
    const required = ['title','summary','evidence','reproduction','impact','cvssVector']; const missing = required.filter((key) => !String(finding[key] ?? '').trim()); if (missing.length) return { status: 'not_ready', reason: `platform validation failed: missing ${missing.join(', ')}`, observedAt: nowIso() };
    if (String(finding.cvssVector).length > 300 || String(finding.summary).length > 10000 || String(finding.reproduction).length > 20000) return { status: 'not_ready', reason: 'platform formatting or word limit validation failed', observedAt: nowIso() };
    const fingerprint = finding.findingFingerprint ?? finding.finding_fingerprint;
    if (fingerprint && missionDb.get('SELECT id FROM bounty_findings WHERE finding_fingerprint=? AND id<>?', [fingerprint, finding.id ?? ''])) return { status: 'not_ready', reason: 'duplicate fingerprint is not submission-ready', observedAt: nowIso() };
    return { status: 'ok', reason: 'adapter-local shape validation passed; discipline gates still required', data: { submit: false, duplicateFingerprint: fingerprint ?? null }, observedAt: nowIso() };
  }
}

export function adapterFor(platformKey: string): PlatformAdapter {
  const row = missionDb.get<Row>('SELECT * FROM platform_adapters WHERE platform_key=?', [platformKey]); if (!row) throw new Error('platform adapter not found'); return new ReadOnlyPlatformAdapter(row);
}
export function adapterSpecs(): typeof PLATFORM_SPECS { return PLATFORM_SPECS; }

export async function syncPlatformAdapter(platformKey: string, context: AdapterScope): Promise<Record<string, unknown>> {
  const row = missionDb.get<Row>('SELECT * FROM platform_adapters WHERE platform_key=?', [platformKey]); if (!row) throw new Error('platform adapter not found');
  const adapter = new ReadOnlyPlatformAdapter(row); const result = await adapter.discoverPrograms(context); const at = nowIso();
  const eventId = missionId('pse'); missionDb.run('INSERT INTO platform_sync_events (id,adapter_id,program_id,target,status,detail,observed_count,created_at) VALUES (?,?,?,?,?,?,?,?)', [eventId, String(row.id), context.programId, context.target, result.status, result.reason, result.data?.length ?? null, at]);
  missionDb.run('UPDATE platform_adapters SET last_sync_status=?,last_sync_at=?,updated_at=? WHERE id=?', [result.status, at, at, String(row.id)]);
  return { platformKey, ...result, lastSyncAt: at, submissionCapability: 'none' };
}
export function platformSyncEvents(platformKey?: string): Array<Record<string, unknown>> { return platformKey ? missionDb.all<Row>('SELECT * FROM platform_sync_events WHERE adapter_id=(SELECT id FROM platform_adapters WHERE platform_key=?) ORDER BY created_at DESC LIMIT 200', [platformKey]) : missionDb.all<Row>('SELECT * FROM platform_sync_events ORDER BY created_at DESC LIMIT 200'); }
export function platformAdapterReadOnlyProof(): Record<string, unknown> { return { outboundMethods: ['GET'], forbiddenMethods: ['POST','PUT','PATCH','DELETE'], submitCapability: 'none', source: 'adapter implementation' }; }

export function platformAllocationRows(): Array<Record<string, unknown>> { return missionDb.all<Row>('SELECT * FROM bounty_platform_allocations ORDER BY platform_key,agent_type'); }
export function platformAgentAllocation(platformKey: string, agentType: string): Record<string, unknown> | null { return missionDb.get<Row>('SELECT * FROM bounty_platform_allocations WHERE platform_key=? AND agent_type=? AND active=1', [platformKey, agentType]) ?? null; }
export function savePlatformAllocation(input: { platformKey: string; agentType: string; concurrency: number; priority: 1|2; strategy: string; active?: boolean }, ownerId: string): Record<string, unknown> {
  if (!missionDb.get('SELECT id FROM platform_adapters WHERE platform_key=?', [input.platformKey])) throw new Error('platform adapter not found');
  const concurrency = Number(input.concurrency); if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error('allocation concurrency is invalid');
  const strategy = String(input.strategy ?? '').trim(); if (!strategy || strategy.length > 1000) throw new Error('allocation strategy is required');
  const existing = missionDb.get<Row>('SELECT id FROM bounty_platform_allocations WHERE platform_key=? AND agent_type=?', [input.platformKey, input.agentType]); const id = existing ? String(existing.id) : missionId('bpa'); const at = nowIso();
  if (existing) missionDb.run('UPDATE bounty_platform_allocations SET concurrency=?,priority=?,strategy=?,active=?,updated_by=?,updated_at=? WHERE id=?', [concurrency, input.priority, strategy, input.active === false ? 0 : 1, ownerId, at, id]); else missionDb.run('INSERT INTO bounty_platform_allocations (id,platform_key,agent_type,concurrency,priority,strategy,active,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, input.platformKey, input.agentType, concurrency, input.priority, strategy, input.active === false ? 0 : 1, ownerId, at]);
  return missionDb.get<Row>('SELECT * FROM bounty_platform_allocations WHERE id=?', [id])!;
}
export function defaultPlatformAllocation(platformKey: string): Record<string, unknown> {
  const row = missionDb.get<Row>('SELECT category FROM platform_adapters WHERE platform_key=?', [platformKey]); if (!row) throw new Error('platform adapter not found'); const category = String(row.category);
  const roles = category === 'web3_bounty' ? ['security_auditor','research_agent','code_reviewer'] : category === 'web3_contest' ? ['research_agent','code_analyst','test_engineer'] : category === 'github' ? ['code_analyst','patch_developer','git_agent'] : ['security_auditor','exploit_validator','browser_monitor'];
  return { platformKey, category, roles, concurrency: 1, priority: category === 'web3_bounty' || category === 'github' ? 1 : 2, strategy: category === 'web3_bounty' ? 'smart-contract + repo-intel engines' : category === 'web3_contest' ? 'contest discovery + codebase mapper' : category === 'github' ? 'repo-intel + patch engines' : 'web/API research + PoC engines', persisted: false, note: 'Default is derived from category and creates no allocation until the owner saves it.' };
}
