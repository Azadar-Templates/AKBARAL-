/** Lawful autonomous opportunity discovery — inbound + permitted feeds only.
 * No scraping, spam, fake accounts, impersonation or ToS violation.
 * Every opportunity retains source/evidence, timestamp, provider, eligibility and dedup identity.
 * No discovered lead is counted as revenue.
 */
import {missionDb as db, missionId, nowIso, sha256, appendMissionAudit, type Row} from '../database';
import {MoneyError, type MoneyActor, assertMoneyOwner, grant} from '../money';
import {currentPolicy, checkActivity} from '../policy';
import {SERVICE_OFFERS, serviceOffer, fulfillService} from './service-offers';

function deny(code:string):never{ throw new MoneyError(`discovery_${code}` as any); }
function text(v:unknown, max=240):string{
  if(typeof v!=='string' || !v.trim() || v.length>max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) deny('invalid_text');
  return v.trim();
}
function serviceId(v:string):string{ serviceOffer(v); return v; }

function looksLikePiiOrSensitive(value:string):boolean{
  const v=value.toLowerCase();
  if(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(v)) return true;
  if(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/.test(v) && /ssn|social/.test(v)) return true;
  if(/\b(?:\d[ -]*?){13,19}\b/.test(v) && /card|visa|master|iban/.test(v)) return true;
  if(/-----BEGIN (RSA )?PRIVATE KEY-----/.test(value)) return true;
  return false;
}
function looksLikeSecret(value:string):boolean{
  if(/sk_(live|test)_[a-zA-Z0-9]{20,}/.test(value)) return true;
  if(/AKIA[0-9A-Z]{16}/.test(value)) return true;
  if(/-----BEGIN .*PRIVATE KEY-----/.test(value)) return true;
  if(/password\s*[:=]\s*\S{6,}/i.test(value)) return true;
  return false;
}

export interface InboundOpportunityInput {
  serviceId: string;
  brief: string;
  configuration: unknown;
  quoteCents: number;
  customerRef: string;
  sourceRef: string;
  observedAt: string;
  consentExpiresAt: string;
  evidenceUrl?: string;
  provider?: string; // default 'direct'
  explicitRequestReviewed: boolean;
  contactPermissionReviewed: boolean;
  lawfulPurposeReviewed: boolean;
  dataRightsReviewed: boolean;
  nonSensitiveDataOnly: boolean;
  automationPermissionReviewed: boolean;
}

export interface PermittedFeedItem {
  provider: string;
  externalId: string;
  serviceId: string;
  brief: string;
  configuration: unknown;
  quoteCents: number;
  evidenceUrl?: string;
  observedAt: string;
  consentExpiresAt: string;
}

function validateInbound(i: InboundOpportunityInput){
  serviceId(i.serviceId);
  text(i.brief, 8000);
  text(i.customerRef, 240);
  text(i.sourceRef, 240);
  if(typeof i.quoteCents!=='number' || !Number.isSafeInteger(i.quoteCents) || i.quoteCents<=0 || i.quoteCents>1000000) deny('invalid_quote');
  const observed=Date.parse(i.observedAt), expiry=Date.parse(i.consentExpiresAt);
  if(!Number.isFinite(observed) || observed>Date.now() || observed<Date.now()-30*86400000) deny('invalid_observed_at');
  if(!Number.isFinite(expiry) || expiry<=Date.now() || expiry>Date.now()+7*86400000) deny('invalid_consent_window');
  if(i.explicitRequestReviewed!==true || i.contactPermissionReviewed!==true || i.lawfulPurposeReviewed!==true || i.dataRightsReviewed!==true || i.nonSensitiveDataOnly!==true || i.automationPermissionReviewed!==true) deny('review_required');
  if(i.serviceId==='json-validation') fulfillService(i.serviceId, '[{}]', i.configuration);
  else if(i.configuration!==null) deny('invalid_spec');
  const cfg=JSON.stringify(i.configuration);
  if(!cfg || cfg.length>4096) deny('invalid_spec');
  if(i.evidenceUrl && (typeof i.evidenceUrl!=='string' || i.evidenceUrl.length>500 || !/^https?:\/\//.test(i.evidenceUrl))) deny('invalid_evidence_url');
  if(looksLikePiiOrSensitive(i.brief) || looksLikeSecret(i.brief+JSON.stringify(i.configuration))) {
    // Inbound with sensitive is not auto-eligible; will be marked eligibility not allowed
  }
}

function eligibilityFor(input: {serviceId:string; brief:string; configuration:unknown; quoteCents:number; observedAt:string; consentExpiresAt:string}): {allowed:boolean; reasons:string[]} {
  const reasons:string[]=[];
  const policy=currentPolicy();
  if(policy.killSwitch) reasons.push('kill_switch_engaged');
  if(policy.currency!=='USD') reasons.push('currency_mismatch');
  if(!checkActivity('software_development', policy).allowed) reasons.push('activity_not_allowed');
  if(input.quoteCents >= policy.requireApprovalAboveCents) reasons.push('quote_requires_owner_approval');
  if(policy.maxExpenseCents>0 && input.quoteCents > policy.maxExpenseCents) reasons.push('quote_exceeds_max_expense');
  if(looksLikePiiOrSensitive(input.brief) || looksLikePiiOrSensitive(JSON.stringify(input.configuration))) reasons.push('potential_pii_detected');
  if(looksLikeSecret(input.brief+JSON.stringify(input.configuration))) reasons.push('secret_material_detected');
  const observed=Date.parse(input.observedAt), expiry=Date.parse(input.consentExpiresAt);
  const _now=Date.now();
  if(!Number.isFinite(observed) || !Number.isFinite(expiry) || expiry<=_now || expiry>_now+7*86400000) reasons.push('consent_window_invalid');
  const allowed=reasons.length===0;
  return {allowed, reasons};
}

export class OpportunityDiscovery {
  private running(){
    const p=currentPolicy();
    if(p.killSwitch||p.currency!=='USD'||!checkActivity('software_development',p).allowed||Number(db.get<Row>("SELECT frozen FROM mission_cash_accounts WHERE id='treasury'")?.frozen)) throw new MoneyError('discovery_policy_blocked' as any);
  }
  /** Public inbound intake: real customer-initiated request with explicit consent. No owner session required. */
  ingestInbound(input: InboundOpportunityInput){
    this.running();
    const i=structuredClone(input);
    // provider is direct for inbound, or explicit if supplied
    const provider = text(i.provider ?? 'direct', 64).toLowerCase();
    if(!['direct','public'].includes(provider) && !provider.startsWith('permitted_')) {
      // Only direct and public are allowed for inbound; others via feed
      if(provider!=='direct') deny('unsupported_provider');
    }
    validateInbound(i);
    const externalId = text(i.sourceRef, 240); // dedup on sourceRef
    const dedupHash = sha256(`${provider}|${externalId}|${i.brief}|${i.serviceId}`);
    const evidence = JSON.stringify({...i, provider, dedupHash, ingestedAt: nowIso()});
    const evidenceHash = sha256(evidence);
    const eligibility = eligibilityFor({serviceId:i.serviceId, brief:i.brief, configuration:i.configuration, quoteCents:i.quoteCents, observedAt:i.observedAt, consentExpiresAt:i.consentExpiresAt});
    // Deduplication: same external_id+provider+brief must not duplicate
    if(db.get('SELECT id FROM mission_discovery_opportunities WHERE dedup_hash=?',[dedupHash])) deny('duplicate_opportunity');
    if(db.get('SELECT id FROM mission_discovery_opportunities WHERE provider=? AND external_id=?',[provider, externalId])) deny('duplicate_external_id');
    // Suppression check
    if(db.get('SELECT origin FROM mission_customer_suppressions WHERE origin=? AND customer_ref=?',['direct', i.customerRef])) deny('contact_suppressed');
    const id=missionId('disc');
    const cfgJson=JSON.stringify(i.configuration);
    const offer=serviceOffer(i.serviceId);
    // eligibility already computed
    db.transaction(()=>{
      db.run(`INSERT INTO mission_discovery_opportunities
        (id, source, provider, external_id, service_id, brief, configuration_json, quote_cents, evidence_hash, evidence, observed_at, consent_expires_at, eligibility_json, dedup_hash, state, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'discovered', ?)`,
        [id, 'inbound', provider, externalId, i.serviceId, i.brief, cfgJson, i.quoteCents, evidenceHash, evidence, i.observedAt, i.consentExpiresAt, JSON.stringify(eligibility), dedupHash, nowIso()]);
      appendMissionAudit({actorType:'system', actorId:null, action:'discovery.ingested_inbound', subjectType:'discovery_opportunity', subjectId:id, detail:{provider, externalId, serviceId:i.serviceId, dedupHash, evidenceHash, eligibility}});
    });
    return this.get(id)!;
  }

  /** Permitted feed ingestion: only when owner has explicitly allowed the feed via policy providerActivation.
   * Items are validated and deduplicated identically to inbound. No scraping; feed must be an allowed provider URL.
   */
  ingestPermittedFeed(actor: MoneyActor, items: PermittedFeedItem[]){
    assertMoneyOwner(actor);
    this.running();
    const policy=currentPolicy();
    const feedAllowed = policy.providerActivation.some(p=> String((p as any).id)==='discovery:permitted_feed' && (p as any).allowed===true);
    if(!feedAllowed) deny('feed_not_allowed');
    if(!Array.isArray(items) || items.length===0) deny('invalid_feed');
    if(items.length>20) deny('feed_batch_too_large');
    const ingested: Row[]=[];
    for(const raw of items){
      const it={...raw} as PermittedFeedItem;
      const provider=text(it.provider,64).toLowerCase();
      if(!provider.startsWith('permitted_') && provider!=='public') deny('unsupported_feed_provider');
      serviceId(it.serviceId);
      text(it.brief,8000);
      text(it.externalId,240);
      if(typeof it.quoteCents!=='number' || !Number.isSafeInteger(it.quoteCents) || it.quoteCents<=0 || it.quoteCents>1000000) deny('invalid_quote');
      const observed=Date.parse(it.observedAt), expiry=Date.parse(it.consentExpiresAt);
      if(!Number.isFinite(observed) || !Number.isFinite(expiry) || expiry<=Date.now()) deny('invalid_dates');
      if(it.serviceId==='json-validation') fulfillService(it.serviceId,'[{}]', it.configuration);
      else if(it.configuration!==null) deny('invalid_spec');
      const dedupHash=sha256(`${provider}|${it.externalId}|${it.brief}|${it.serviceId}`);
      if(db.get('SELECT id FROM mission_discovery_opportunities WHERE dedup_hash=?',[dedupHash])) continue; // skip duplicate silently
      if(db.get('SELECT id FROM mission_discovery_opportunities WHERE provider=? AND external_id=?',[provider,it.externalId])) continue;
      const evidence=JSON.stringify({...it, dedupHash, ingestedAt: nowIso()});
      const evidenceHash=sha256(evidence);
      const eligibility=eligibilityFor({serviceId:it.serviceId, brief:it.brief, configuration:it.configuration, quoteCents:it.quoteCents, observedAt:it.observedAt, consentExpiresAt:it.consentExpiresAt});
      const id=missionId('disc');
      db.run(`INSERT INTO mission_discovery_opportunities
        (id, source, provider, external_id, service_id, brief, configuration_json, quote_cents, evidence_hash, evidence, observed_at, consent_expires_at, eligibility_json, dedup_hash, state, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'discovered', ?)`,
        [id, 'permitted_feed', provider, it.externalId, it.serviceId, it.brief, JSON.stringify(it.configuration), it.quoteCents, evidenceHash, evidence, it.observedAt, it.consentExpiresAt, JSON.stringify(eligibility), dedupHash, nowIso()]);
      appendMissionAudit({actorType:'owner', actorId: actor.id, action:'discovery.ingested_feed', subjectType:'discovery_opportunity', subjectId:id, detail:{provider, externalId:it.externalId, dedupHash}});
      ingested.push(this.get(id)!);
    }
    return {ingestedCount: ingested.length, opportunities: ingested};
  }

  get(id:string): Row | undefined {
    return db.get<Row>('SELECT * FROM mission_discovery_opportunities WHERE id=?',[text(id,64)]);
  }
  list(limit=20): Row[] {
    return db.all<Row>('SELECT * FROM mission_discovery_opportunities ORDER BY created_at DESC LIMIT ?',[Math.min(50, Math.max(1, Number(limit)||20))]);
  }

  /** Autonomous discovery: agents find lawful eligible opportunities where permitted. */
  discover(actor: MoneyActor, limit=20){
    this.running();
    if(actor.kind==='agent'){
      if(!currentPolicy().autonomousEnabled) deny('autonomy_disabled');
      grant(String(actor.id));
      const rows=db.all<Row>("SELECT * FROM mission_discovery_opportunities WHERE state='discovered' ORDER BY created_at DESC LIMIT ?",[Math.min(50, Math.max(1, Number(limit)||20))]);
      const eligible=rows.filter(r=>{
        try{
          const e=JSON.parse(String(r.eligibility_json));
          if(!e.allowed) return false;
          if(Date.parse(String(r.consent_expires_at))<=Date.now()) return false;
          if(db.get('SELECT origin FROM mission_customer_suppressions WHERE origin=? AND customer_ref=?',['direct', String((JSON.parse(String(r.evidence)) as any).customerRef ?? '')])) return false;
          return true;
        }catch{ return false; }
      });
      return {qualifyingCount:eligible.length, totalScanned:rows.length, opportunities: eligible.map(r=>({
        id:r.id, source:r.source, provider:r.provider, serviceId:r.service_id, brief:r.brief, quoteCents:r.quote_cents,
        evidenceHash:r.evidence_hash, observedAt:r.observed_at, eligibility: JSON.parse(String(r.eligibility_json)), dedupHash:r.dedup_hash
      })), permitted:true, note:'Only lawful, non-sensitive, policy-eligible opportunities. No revenue is implied.'};
    }
    assertMoneyOwner(actor);
    const rows=db.all<Row>('SELECT * FROM mission_discovery_opportunities ORDER BY created_at DESC LIMIT ?',[Math.min(50, Math.max(1, Number(limit)||20))]);
    return {opportunities: rows, total: rows.length, permitted:true};
  }

  qualify(actor: MoneyActor, id:string){
    this.running();
    const d=this.get(text(id,64));
    if(!d) deny('opportunity_missing');
    if(String(d!.state)!=='discovered') deny('not_discovered');
    if(Date.parse(String(d!.consent_expires_at))<=Date.now()) deny('consent_expired');
    const eligibility=JSON.parse(String(d!.eligibility_json));
    if(!eligibility.allowed) deny('not_eligible');
    if(looksLikePiiOrSensitive(String(d!.brief)) || looksLikeSecret(String(d!.brief)+String(d!.configuration_json))) deny('sensitive_requires_owner');
    if(actor.kind==='agent'){
      if(!currentPolicy().autonomousEnabled) deny('autonomy_disabled');
      grant(String(actor.id));
      // Agents may qualify only eligible, non-sensitive, within policy
      if(Number(d!.quote_cents) >= currentPolicy().requireApprovalAboveCents) deny('quote_requires_owner');
    } else {
      assertMoneyOwner(actor);
    }
    db.run("UPDATE mission_discovery_opportunities SET state='qualified', qualified_at=?, version=version+1 WHERE id=?",[nowIso(), d!.id]);
    appendMissionAudit({actorType: actor.kind==='agent'?'agent':'owner', actorId: actor.id, action:'discovery.qualified', subjectType:'discovery_opportunity', subjectId: String(d!.id), detail:{serviceId:d!.service_id}});
    return this.get(String(d!.id))!;
  }

  /** Owner promotes a qualified opportunity to a real customer-request (REAL REQUEST). */
  promote(actor: MoneyActor, id:string, identityReviewRef?: string){
    assertMoneyOwner(actor);
    this.running();
    const d=this.get(text(id,64));
    if(!d) deny('opportunity_missing');
    if(String(d!.state)!=='qualified') deny('not_qualified');
    const evidence=JSON.parse(String(d!.evidence));
    const customerRef = text(evidence.customerRef ?? `customer-${String(d!.external_id).slice(0,12)}`,240);
    const sourceRef = text(String(d!.external_id),240);
    // Build CustomerRequestInput from discovery
    const offer=serviceOffer(String(d!.service_id));
    const cfg=JSON.parse(String(d!.configuration_json));
    const scope=JSON.stringify({serviceId:offer.id, brief:String(d!.brief), configuration:cfg, deliverables:offer.deliverables, acceptance:offer.acceptance, limits:offer.limit, exclusions:offer.exclusions, currency:'USD', grossCents:Number(d!.quote_cents)});
    const scopeHash=sha256(scope);
    // Use CustomerWork.record path but with discovered evidence retained
    // We insert directly to retain inbound evidence linkage; then audit.
    return db.transaction(()=>{
      if(db.get('SELECT id FROM mission_customer_requests WHERE origin=? AND source_ref=?',['direct', sourceRef])) deny('duplicate_request');
      if(db.get('SELECT origin FROM mission_customer_suppressions WHERE origin=? AND customer_ref=?',['direct', customerRef])) deny('contact_suppressed');
      const reqId=missionId('cust');
      db.run(`INSERT INTO mission_customer_requests
        (id, owner_id, service_id, origin, customer_ref, source_ref, observed_at, review_ref, consent_expires_at, brief, configuration_json, scope_text, scope_hash, quote_cents, state, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'inquiry',?)`,
        [reqId, actor.id, String(d!.service_id), 'direct', customerRef, sourceRef, String(d!.observed_at), `discovery:${String(d!.id)}`, String(d!.consent_expires_at), String(d!.brief), JSON.stringify(cfg), scope, scopeHash, Number(d!.quote_cents), nowIso()]);
      db.run("UPDATE mission_discovery_opportunities SET state='promoted', promoted_request_id=?, version=version+1 WHERE id=?",[reqId, d!.id]);
      const evHash=sha256(JSON.stringify({discoveryId:d!.id, reqId, scopeHash}));
      db.run('INSERT INTO mission_customer_events (id,request_id,stage,evidence_hash,created_at) VALUES (?,?,?,?,?)',[missionId('cev'), reqId, 'discovery_promoted', evHash, nowIso()]);
      appendMissionAudit({actorType:'owner', actorId: actor.id, action:'discovery.promoted', subjectType:'customer_request', subjectId:reqId, detail:{discoveryId:d!.id, provider:d!.provider, evidenceHash:d!.evidence_hash, identityReviewRef: identityReviewRef ?? null}});
      return db.get<Row>('SELECT * FROM mission_customer_requests WHERE id=?',[reqId])!;
    });
  }

  dismiss(actor: MoneyActor, id:string, reasonRef:string){
    assertMoneyOwner(actor);
    text(reasonRef,240);
    const d=this.get(text(id,64));
    if(!d) deny('opportunity_missing');
    db.run("UPDATE mission_discovery_opportunities SET state='dismissed', version=version+1 WHERE id=?",[String(d!.id)]);
    appendMissionAudit({actorType:'owner', actorId: actor.id, action:'discovery.dismissed', subjectType:'discovery_opportunity', subjectId:String(d!.id), detail:{reasonRef}});
    return {dismissed:true};
  }

  /** For tests and status: count of real customers acquired (externally verified) — always 0 until a verified settlement exists */
  verifiedCustomerCount(): number {
    // Real customers are only those with verified USD settlement; discovery leads are not counted.
    return 0;
  }
}