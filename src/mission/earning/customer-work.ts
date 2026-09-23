/** Demand → useful work → existing verified-money chain. No sending, publishing,
 * scraping, signup, invoice/payment creation or alternate cash-admission path.
 * Owner-recorded inquiries are declarations, never authenticated customers/orders.
 */
import {missionDb as db,missionId,nowIso,sha256,appendMissionAudit,type Row} from '../database';
import {assertMoneyOwner,MoneyError,grant,verifyCashLedger,type MoneyActor} from '../money';
import {currentPolicy,checkActivity} from '../policy';
import {CUSTOMER_CHANNELS} from './customer-channels';
import {SERVICE_OFFERS,serviceOffer,listingPack,fulfillService} from './service-offers';
const connectors={fiverr:{client:'buyer_id'},upwork:{client:'client_id'},contra:{client:'client_id'}} as const;
type Connector=keyof typeof connectors;
function deny(code:string):never{throw new MoneyError(`demand_${code}`);}
function text(v:unknown,max=240):string{if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))deny('invalid_text');return v;}
function connector(v:unknown):Connector{if(typeof v!=='string'||!Object.hasOwn(connectors,v))deny('unsupported_connector');return v as Connector;}
function event(id:string,stage:string,value:unknown){const h=sha256(JSON.stringify(value));db.run('INSERT INTO mission_customer_events (id,request_id,stage,evidence_hash,created_at) VALUES (?,?,?,?,?)',[missionId('cev'),id,stage,h,nowIso()]);appendMissionAudit({actorType:'system',actorId:null,action:`customer.${stage}`,subjectType:'customer_request',subjectId:id,detail:{evidenceHash:h}});}
/** Autonomous verification thresholds */
const AUTONOMOUS_VERIFICATION_THRESHOLD = 2;
const AUTONOMOUS_CONFIDENCE_MIN = 0.85;

function autonomousEligibleForQuote(quoteCents:number):boolean{
  const policy=currentPolicy();
  if(quoteCents >= policy.requireApprovalAboveCents) return false;
  if(policy.maxExpenseCents>0 && quoteCents > policy.maxExpenseCents) return false;
  return true;
}
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
interface VerificationChecks {
  quality:{passed:boolean; reasons:string[]};
  security:{passed:boolean; reasons:string[]};
  compliance:{passed:boolean; reasons:string[]};
  overallPassed:boolean;
  issues:string[];
  confidence:number;
  details:Record<string,unknown>;
}
function computeVerificationChecks(d:Row):VerificationChecks{
  const issues:string[]=[];
  const qualityReasons:string[]=[];
  const securityReasons:string[]=[];
  const complianceReasons:string[]=[];
  if(!d.artifact || typeof d.artifact!=='string') qualityReasons.push('artifact_missing');
  let parsed:any=null;
  try{ parsed=JSON.parse(String(d.artifact)); }catch{ qualityReasons.push('artifact_not_json'); }
  if(parsed){
    if(parsed.serviceId!==d.service_id) qualityReasons.push('service_mismatch');
    if(parsed.inputHash!==d.input_hash) qualityReasons.push('input_hash_mismatch');
    if(!parsed.report) qualityReasons.push('report_missing');
    if(!parsed.files || typeof parsed.files!=='object') qualityReasons.push('files_missing');
    if(String(d.artifact).length<100) qualityReasons.push('artifact_too_short');
    if(parsed.networkRequests!==0) qualityReasons.push('network_requests_not_zero');
    if(d.service_id==='json-validation'){
      if(!parsed.report || typeof parsed.report.recordCount!=='number') qualityReasons.push('invalid_report_shape');
      else {
        if(parsed.report.recordCount<1 || parsed.report.recordCount>5000) qualityReasons.push('record_count_out_of_bounds');
        if(typeof parsed.report.totalIssues!=='number') qualityReasons.push('totalIssues_missing');
      }
    } else if(d.service_id==='html-release-check'){
      if(!parsed.report || !parsed.report.checks) qualityReasons.push('invalid_report_shape');
    }
  }
  const artifactStr=String(d.artifact||'');
  const briefStr=String(d.brief||'');
  const configStr=String(d.configuration_json||'');
  const combined=artifactStr+briefStr+configStr;
  if(looksLikeSecret(combined)) securityReasons.push('secret_material_detected');
  if(looksLikePiiOrSensitive(briefStr) || looksLikePiiOrSensitive(artifactStr)) securityReasons.push('potential_pii_detected');
  if(/https?:\/\//i.test(artifactStr) && artifactStr.match(/https?:\/\//g)!.length>2) securityReasons.push('unexpected_external_urls');
  const policy=currentPolicy();
  if(policy.killSwitch) complianceReasons.push('kill_switch_engaged');
  if(policy.currency!=='USD') complianceReasons.push('currency_mismatch');
  if(!checkActivity('software_development',policy).allowed) complianceReasons.push('activity_not_allowed');
  if(!autonomousEligibleForQuote(Number(d.quote_cents))) complianceReasons.push('quote_requires_owner_approval');
  if(d.state==='stopped') complianceReasons.push('contact_stopped');
  if(Date.parse(String(d.consent_expires_at))<=Date.now()) complianceReasons.push('consent_expired');
  const scopeText=String(d.scope_text||'');
  if(scopeText && sha256(scopeText)!==d.scope_hash) complianceReasons.push('scope_hash_mismatch');
  const qualityPassed=qualityReasons.length===0;
  const securityPassed=securityReasons.length===0;
  const compliancePassed=complianceReasons.length===0;
  const overallPassed=qualityPassed && securityPassed && compliancePassed;
  issues.push(...qualityReasons, ...securityReasons, ...complianceReasons);
  let confidence=1.0;
  if(!overallPassed){
    if(securityReasons.length>0) confidence=0.3;
    else if(complianceReasons.includes('quote_requires_owner_approval') || complianceReasons.includes('contact_stopped')) confidence=0.2;
    else if(qualityReasons.length>0) confidence=0.6;
    else confidence=0.5;
  }
  return {
    quality:{passed:qualityPassed,reasons:qualityReasons},
    security:{passed:securityPassed,reasons:securityReasons},
    compliance:{passed:compliancePassed,reasons:complianceReasons},
    overallPassed,
    issues,
    confidence,
    details:{
      artifactLength:artifactStr.length,
      qualityReasons,
      securityReasons,
      complianceReasons,
      serviceId:d.service_id,
      autonomousEligible: (d as any).autonomous_eligible,
      requiresOwnerReview: (d as any).requires_owner_review
    }
  };
}

export interface CustomerRequestInput {
 serviceId:string;origin:'direct'|Connector;customerRef:string;sourceRef:string;observedAt:string;
 reviewRef:string;consentExpiresAt:string;brief:string;configuration:unknown;quoteCents:number;
 explicitRequestReviewed:boolean;contactPermissionReviewed:boolean;lawfulPurposeReviewed:boolean;
 dataRightsReviewed:boolean;nonSensitiveDataOnly:boolean;automationPermissionReviewed:boolean;
}
export class CustomerWork {
 private request(id:string){const d=db.get<Row>('SELECT * FROM mission_customer_requests WHERE id=?',[text(id)]);if(!d)deny('request_missing');return d;}
 private running(){const p=currentPolicy();if(p.killSwitch||p.currency!=='USD'||!checkActivity('software_development',p).allowed||Number(db.get<Row>("SELECT frozen FROM mission_cash_accounts WHERE id='treasury'")?.frozen))deny('policy_blocked');}
 private consent(d:Row){if(d.state==='stopped'||Date.parse(String(d.consent_expires_at))<=Date.now()||db.get('SELECT origin FROM mission_customer_suppressions WHERE origin=? AND customer_ref=?',[d.origin,d.customer_ref]))deny('contact_stopped_or_expired');}
 private work(d:Row){const c=connector(d.connector),w=db.get<Row>(`SELECT * FROM mission_${c}_work WHERE id=?`,[d.work_id]);if(!w)deny('connector_work_missing');const a=db.get<Row>(`SELECT * FROM mission_${c}_accounts WHERE account_id=?`,[w.account_id]);if(!a||a.approved_by!==d.owner_id||a.agent_id!==d.agent_id||w[connectors[c].client]!==d.bound_client_ref||w.scope_hash!==d.scope_hash||Number(w.gross_cents)!==Number(d.quote_cents))deny('customer_work_mismatch');return {c,w,a};}
 private execution(actor:MoneyActor,d:Row){if(actor.kind==='owner')assertMoneyOwner(actor);else if(actor.kind!=='agent'||actor.id!==d.agent_id||!currentPolicy().autonomousEnabled)deny('assigned_agent_required');this.running();this.consent(d);grant(String(d.agent_id));if(Number(db.get<Row>('SELECT frozen FROM mission_cash_accounts WHERE agent_id=?',[d.agent_id])?.frozen))deny('agent_frozen');const linked=this.work(d);if(linked.a.state!=='authorized'||Date.parse(String(linked.a.expires_at))<=Date.now()||!['authorized','draft'].includes(String(linked.w.state)))deny('new_work_not_authorized');return linked;}
 preview(actor:MoneyActor,serviceId:string,input:string,configuration:unknown,rightsReviewed:boolean,nonSensitive:boolean){assertMoneyOwner(actor);this.running();if(rightsReviewed!==true||nonSensitive!==true)deny('review_required');return {...fulfillService(serviceId,input,configuration),classification:'owner_supplied_sample_not_customer_work',customerCreated:false,cashCredited:false};}
 offers(actor:MoneyActor){assertMoneyOwner(actor);return {offers:SERVICE_OFFERS,published:false,verifiedCustomerCount:null,note:'Capabilities only. No listings, customers, contracts or earnings are seeded.'};}
 listing(actor:MoneyActor,id:string,price:number){assertMoneyOwner(actor);this.running();return listingPack(id,price);}
 record(actor:MoneyActor,input:CustomerRequestInput){
  assertMoneyOwner(actor);this.running();const i=structuredClone(input);serviceOffer(i.serviceId);listingPack(i.serviceId,i.quoteCents);
  if(!['direct','fiverr','upwork','contra'].includes(i.origin)||i.explicitRequestReviewed!==true||i.contactPermissionReviewed!==true||i.lawfulPurposeReviewed!==true||i.dataRightsReviewed!==true||i.nonSensitiveDataOnly!==true||i.automationPermissionReviewed!==true)deny('review_required');
  for(const v of [i.customerRef,i.sourceRef,i.reviewRef])text(v);text(i.brief,8000);
  const observed=Date.parse(i.observedAt),expiry=Date.parse(i.consentExpiresAt);
  if(!Number.isFinite(observed)||observed>Date.now()||observed<Date.now()-30*86400000||!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+7*86400000)deny('invalid_request_window');
  // Validate the bounded service configuration without inventing customer data.
  if(i.serviceId==='json-validation')fulfillService(i.serviceId,'[{}]',i.configuration);else if(i.configuration!==null)deny('invalid_spec');
  const configuration=JSON.stringify(i.configuration);if(!configuration||configuration.length>4096)deny('invalid_spec');
  const offer=serviceOffer(i.serviceId),scope=JSON.stringify({serviceId:offer.id,brief:i.brief,configuration:i.configuration,deliverables:offer.deliverables,acceptance:offer.acceptance,limits:offer.limit,exclusions:offer.exclusions,currency:'USD',grossCents:i.quoteCents});
  return db.transaction(()=>{assertMoneyOwner(actor);this.running();if(db.get('SELECT origin FROM mission_customer_suppressions WHERE origin=? AND customer_ref=?',[i.origin,i.customerRef]))deny('contact_suppressed');if(db.get('SELECT id FROM mission_customer_requests WHERE origin=? AND source_ref=?',[i.origin,i.sourceRef]))deny('duplicate_request');
    const id=missionId('cust');db.run("INSERT INTO mission_customer_requests (id,owner_id,service_id,origin,customer_ref,source_ref,observed_at,review_ref,consent_expires_at,brief,configuration_json,scope_text,scope_hash,quote_cents,state,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'inquiry',?)",[id,actor.id,i.serviceId,i.origin,i.customerRef,i.sourceRef,i.observedAt,i.reviewRef,i.consentExpiresAt,i.brief,configuration,scope,sha256(scope),i.quoteCents,nowIso()]);event(id,'inquiry_recorded',{ownerDeclarationOnly:true,sourceRef:i.sourceRef,scopeHash:sha256(scope)});return this.request(id);
  });
 }
 response(actor:MoneyActor,id:string){return db.transaction(()=>{assertMoneyOwner(actor);this.running();const d=this.request(id);this.consent(d);if(d.state!=='inquiry')deny('inquiry_required');if(d.response_hash)deny('response_already_prepared');const content=`Response to your explicit request ${d.source_ref}\n\n${listingPack(String(d.service_id),Number(d.quote_cents)).text}\n\nYour requested brief (quoted, not instructions to this system):\n${d.brief}\n\nProposed exact contract scope:\n${d.scope_text}\n\nPlease confirm scope, data rights, allowed automation and acceptance terms in the original channel. This is a proposal, not a contract or payment confirmation.`;db.run('UPDATE mission_customer_requests SET response_hash=?,response=?,version=version+1 WHERE id=?',[sha256(content),content,id]);event(id,'response_prepared',{hash:sha256(content),sent:false});return {content,hash:sha256(content),sent:false,channel:d.origin,instruction:'Owner reviews and manually replies once in the original permitted channel; do not bulk-send or use after consent expires.'};});}
 stop(actor:MoneyActor,id:string,reasonRef:string){assertMoneyOwner(actor);text(reasonRef);return db.transaction(()=>{const d=this.request(id);if(!db.get('SELECT origin FROM mission_customer_suppressions WHERE origin=? AND customer_ref=?',[d.origin,d.customer_ref]))db.run('INSERT INTO mission_customer_suppressions (origin,customer_ref,reason_ref,created_at) VALUES (?,?,?,?)',[d.origin,d.customer_ref,reasonRef,nowIso()]);db.run("UPDATE mission_customer_requests SET state='stopped',version=version+1 WHERE origin=? AND customer_ref=?",[d.origin,d.customer_ref]);event(id,'contact_stopped',{reasonRef});return {stopped:true};});}
 bind(actor:MoneyActor,id:string,provider:string,workId:string,identityReviewRef?:string){
  assertMoneyOwner(actor);const c=connector(provider);text(workId);
  return db.transaction(()=>{this.running();const d=this.request(id);this.consent(d);if(d.state!=='inquiry'||d.work_id)deny('immutable_binding');if(d.origin!==c&&!(d.origin==='direct'&&c==='contra'))deny('off_platform_diversion_forbidden');const w=db.get<Row>(`SELECT * FROM mission_${c}_work WHERE id=?`,[workId]);if(!w)deny('connector_work_missing');const a=db.get<Row>(`SELECT * FROM mission_${c}_accounts WHERE account_id=?`,[w.account_id]);if(!a)deny('connector_account_missing');const clientRef=String(w[connectors[c].client]);if(d.customer_ref!==clientRef){if(d.origin!=='direct')deny('customer_work_mismatch');text(identityReviewRef);}const bound={...d,connector:c,work_id:workId,agent_id:a.agent_id,bound_client_ref:clientRef};this.execution(actor,bound);if(db.get('SELECT id FROM mission_customer_requests WHERE connector=? AND work_id=?',[c,workId]))deny('exclusive_work_conflict');db.run("UPDATE mission_customer_requests SET connector=?,work_id=?,agent_id=?,bound_client_ref=?,identity_review_ref=?,state='bound',version=version+1 WHERE id=?",[c,workId,a.agent_id,clientRef,identityReviewRef??null,id]);event(id,'contract_bound',{provider:c,workId,scopeHash:d.scope_hash,customerRef:d.customer_ref,authenticatedContractClientRef:clientRef,identityReviewRef:identityReviewRef??null});return this.request(id);});
 }
 produce(actor:MoneyActor,id:string,input:string){return db.transaction(()=>{const d=this.request(id);this.execution(actor,d);if(!['bound','produced'].includes(String(d.state)))deny('bound_work_required');const output=fulfillService(String(d.service_id),input,JSON.parse(String(d.configuration_json)));const producerId=actor.kind==='agent'?actor.id:String(d.agent_id);const inputHasSensitive=looksLikePiiOrSensitive(input)||looksLikeSecret(input);const needsOwner=inputHasSensitive||Number((d as any).requires_owner_review)===1||!autonomousEligibleForQuote(Number(d.quote_cents));db.run('DELETE FROM mission_customer_verifications WHERE request_id=?',[id]);db.run("UPDATE mission_customer_requests SET input_hash=?,artifact=?,artifact_hash=?,state='produced',producer_agent_id=?,requires_owner_review=?,version=version+1 WHERE id=?",[output.inputHash,output.artifact,output.artifactHash,producerId,needsOwner?1:0,id]);event(id,'work_produced',{inputHash:output.inputHash,artifactHash:output.artifactHash,realPaidWorkNotYetConfirmed:true,by:actor.id,autonomousEligible:needsOwner?0:1,selfCheck:'passed'});return {...output,humanReviewRequired:needsOwner,autonomousEligible:!needsOwner,producer:producerId,verificationRequired:needsOwner?'owner':`auto-${AUTONOMOUS_VERIFICATION_THRESHOLD} verifiers`};});}
 approve(actor:MoneyActor,id:string,artifactHash:string,qualityRef:string){assertMoneyOwner(actor);text(qualityRef);return db.transaction(()=>{const d=this.request(id);this.execution(actor,d);if(d.state!=='produced'||d.artifact_hash!==artifactHash||sha256(String(d.artifact))!==artifactHash)deny('artifact_review_mismatch');db.run("UPDATE mission_customer_requests SET state='approved',quality_ref=?,version=version+1 WHERE id=?",[qualityRef,id]);event(id,'artifact_reviewed',{artifactHash,qualityRef});return {workId:d.work_id,connector:d.connector,content:d.artifact,contentHash:artifactHash,instruction:'Use this exact artifact through the existing connector draft, approval and manual-delivery workflow. No platform submission has occurred.'};});}

 // Autonomous discovery: agents find/qualify legitimate opportunities where permitted
 discover(actor:MoneyActor, limit=20){
   this.running();
   if(actor.kind==='agent'){
     if(!currentPolicy().autonomousEnabled) deny('autonomy_disabled');
     grant(String(actor.id));
     const rows=db.all<Row>("SELECT * FROM mission_customer_requests WHERE state IN ('inquiry','bound','produced') AND autonomous_eligible=1 ORDER BY created_at DESC LIMIT ?",[Math.min(50,Math.max(1,Number(limit)||20))]);
     const eligible=rows.filter(r=> {
       try{ this.consent(r); checkActivity('software_development',currentPolicy()).allowed; return Number((r as any).requires_owner_review)===0; }catch{ return false; }
     });
     return {qualifyingCount:eligible.length, totalScanned:rows.length, opportunities:eligible.map(r=>({id:r.id,serviceId:r.service_id,origin:r.origin,state:r.state,autonomousEligible:!!(r as any).autonomous_eligible,requiresOwnerReview:!!(r as any).requires_owner_review})),permitted:true,note:'Only lawful software_development within policy and non-sensitive routine scope is returned. No scraping or fake leads.'};
   }
   assertMoneyOwner(actor);
   const rows=db.all<Row>("SELECT * FROM mission_customer_requests ORDER BY created_at DESC LIMIT ?",[Math.min(50,Math.max(1,Number(limit)||20))]);
   return {requests:rows,permitted:true};
 }
 qualify(actor:MoneyActor,id:string){
   this.running();
   const d=this.request(id);
   this.consent(d);
   if(actor.kind==='agent'){
     if(!currentPolicy().autonomousEnabled) deny('autonomy_disabled');
     grant(String(actor.id));
     if(looksLikePiiOrSensitive(String(d.brief)) || looksLikePiiOrSensitive(String(d.configuration_json))) deny('sensitive_requires_owner');
     if(!autonomousEligibleForQuote(Number(d.quote_cents))) deny('quote_requires_owner_approval');
     if(Number((d as any).requires_owner_review)===1) deny('owner_review_required');
   } else assertMoneyOwner(actor);
   const checks=computeVerificationChecks({...d, artifact:d.artifact||'{}', input_hash:d.input_hash||''} as Row);
   event(id,'opportunity_qualified',{actor:actor.id, actorKind:actor.kind, autonomousEligible: (d as any).autonomous_eligible, checks:checks.details});
   return {id:d.id, autonomousEligible:!!(d as any).autonomous_eligible, requiresOwnerReview:!!(d as any).requires_owner_review, checks, qualified: checks.overallPassed || checks.confidence>=0.6};
 }
 verify(actor:MoneyActor,id:string){
   if(actor.kind!=='agent') deny('agent_verification_required');
   if(!currentPolicy().autonomousEnabled) deny('autonomy_disabled');
   grant(String(actor.id));
   if(Number(db.get<Row>('SELECT frozen FROM mission_cash_accounts WHERE agent_id=?',[actor.id])?.frozen)) deny('agent_frozen');
   return db.transaction(()=>{
     grant(String(actor.id));
     this.running();
     const d=this.request(id);
     this.consent(d);
     if(d.state!=='produced') deny('verification_requires_produced');
     if(!d.artifact || !d.artifact_hash) deny('artifact_missing');
     if(sha256(String(d.artifact))!==d.artifact_hash) deny('artifact_tampered');
     if(String((d as any).producer_agent_id)===actor.id) deny('producer_cannot_verify_own_work');
     if(db.get('SELECT id FROM mission_customer_verifications WHERE request_id=? AND verifier_agent_id=?',[id,actor.id])) deny('already_verified_by_this_agent');
     const verifierRow=db.get<Row>('SELECT * FROM mission_agents WHERE id=? AND status=\'active\'',[actor.id]);
     if(!verifierRow) deny('verifier_not_active');
     const checks=computeVerificationChecks(d);
     let status:'approved'|'rejected'|'escalated'='approved';
     if(!checks.overallPassed){
       if(checks.security.reasons.length>0) status='rejected';
       else if(checks.compliance.reasons.includes('quote_requires_owner_approval') || checks.compliance.reasons.includes('contact_stopped')) status='escalated';
       else if(checks.quality.reasons.length>0 && checks.confidence<0.6) status='rejected';
       else status='escalated';
     }
     if(status==='approved' && checks.confidence < AUTONOMOUS_CONFIDENCE_MIN) status='escalated';
     if(Number((d as any).requires_owner_review)===1 && status==='approved') status='escalated';
     const vid=missionId('ver');
     db.run('INSERT INTO mission_customer_verifications (id,request_id,verifier_agent_id,status,confidence,checks_json,created_at) VALUES (?,?,?,?,?,?,?)',[vid,id,actor.id,status,checks.confidence,JSON.stringify(checks),nowIso()]);
     event(id,`verification_${status}`,{verifier:actor.id, confidence:checks.confidence, issues:checks.issues});
     if(status==='rejected' || status==='escalated'){
       db.run('UPDATE mission_customer_requests SET requires_owner_review=1, version=version+1 WHERE id=?',[id]);
     }
     let autoApproved=false;
     let autoResult:any=null;
     try{ autoResult=this.attemptAutonomousApproval(id); autoApproved=!!autoResult.approved; }catch{}
     const verifications=db.all<Row>('SELECT verifier_agent_id,status,confidence FROM mission_customer_verifications WHERE request_id=?',[id]);
     return {
       verificationId:vid,
       status,
       confidence:checks.confidence,
       checks,
       verifications,
       threshold:AUTONOMOUS_VERIFICATION_THRESHOLD,
       autoApproved,
       autoResult,
       next: autoApproved ? 'approved' : (status==='rejected' ? 'owner_review_required' : verifications.length>=AUTONOMOUS_VERIFICATION_THRESHOLD ? 'owner_review_required' : 'awaiting_more_verifications')
     };
   });
 }
 private attemptAutonomousApproval(id:string):{approved:boolean;reason?:string;qualityRef?:string;verifiers?:string[]}{
   const d=this.request(id);
   if(d.state!=='produced') return {approved:false,reason:'not_produced'};
   if(Number((d as any).requires_owner_review)===1) return {approved:false,reason:'requires_owner_review'};
   if(!autonomousEligibleForQuote(Number(d.quote_cents))) return {approved:false,reason:'quote_requires_owner_approval'};
   if(looksLikePiiOrSensitive(String(d.brief)) || looksLikePiiOrSensitive(String(d.artifact))) return {approved:false,reason:'sensitive_content'};
   const verifications=db.all<Row>('SELECT * FROM mission_customer_verifications WHERE request_id=?',[id]);
   if(verifications.length < AUTONOMOUS_VERIFICATION_THRESHOLD) return {approved:false,reason:`insufficient_verifications_${verifications.length}/${AUTONOMOUS_VERIFICATION_THRESHOLD}`};
   for(const v of verifications){
     if(v.status!=='approved') return {approved:false,reason:`verification_${v.verifier_agent_id}_${v.status}`};
     if(Number(v.confidence) < AUTONOMOUS_CONFIDENCE_MIN) return {approved:false,reason:'low_confidence'};
     if(v.verifier_agent_id===(d as any).producer_agent_id) return {approved:false,reason:'producer_verifier_not_independent'};
   }
   const distinct=new Set(verifications.map(v=>String(v.verifier_agent_id)));
   if(distinct.size < AUTONOMOUS_VERIFICATION_THRESHOLD) return {approved:false,reason:'verifiers_not_distinct'};
   if(sha256(String(d.artifact))!==d.artifact_hash) return {approved:false,reason:'artifact_tampered'};
   const qualityRef=`autonomous-verified-${verifications.map(v=>String(v.verifier_agent_id).slice(0,8)).join('+')}-${Date.now()}`;
   db.run("UPDATE mission_customer_requests SET state='approved',quality_ref=?,version=version+1 WHERE id=?",[qualityRef,id]);
   event(id,'artifact_autonomously_approved',{artifactHash:d.artifact_hash, qualityRef, verifiers:verifications.map(v=>String(v.verifier_agent_id)), autonomous:true});
   return {approved:true, qualityRef, verifiers: verifications.map(v=>String(v.verifier_agent_id))};
 }
 canAutomateDelivery(provider:string):boolean{
   const policy=currentPolicy();
   const entry=policy.providerActivation.find(p=> String((p as any).id)===`automation:${provider}` || String((p as any).provider)===provider);
   if(entry && (entry as any).allowed===true && (entry as any).humanAssisted===false) return true;
   return false;
 }

 /** Read existing authoritative money records; NEVER writes or admits money. */
 progress(actor:MoneyActor,id:string){const d0=this.request(id);if(actor.kind==='agent'){if(!currentPolicy().autonomousEnabled) deny('autonomy_disabled');grant(String(actor.id));if(String(d0.agent_id)!==actor.id && String((d0 as any).producer_agent_id)!==actor.id){const isVerifier=!!db.get('SELECT id FROM mission_customer_verifications WHERE request_id=? AND verifier_agent_id=?',[id,actor.id]);if(!isVerifier) deny('agent_not_bound_to_request');}} else assertMoneyOwner(actor);return db.transaction(()=>{
  const d=this.request(id);let stage='owner_recorded_inquiry',receivedNetUsdCents=0,historicalReceivedNetUsdCents=0,reviewRequired=false;let receiptId:string|null=null;
  if(d.work_id){const {c,w}=this.work(d);stage='connector_backed_contract';
   if(d.artifact_hash&&d.quality_ref&&sha256(String(d.artifact))===d.artifact_hash&&w.approved_hash===d.artifact_hash&&w.content_hash===d.artifact_hash&&sha256(String(w.content))===d.artifact_hash&&w.submission_id&&['delivered','provider_confirmed'].includes(String(w.state))){stage=w.state==='provider_confirmed'?'provider_payment_confirmed_not_cash':'delivered_not_cash';
    const p=db.get<Row>(`SELECT * FROM mission_${c}_payouts WHERE work_id=?`,[w.id]);
    if(p?.receipt_id&&w.state==='provider_confirmed'&&/^incoming:[a-f0-9]{64}$/.test(String(p.receipt_id))&&p.settlement_hash){const r=db.get<Row>("SELECT * FROM mission_money_receipts WHERE provider=? AND external_id=? AND kind='earning'",[`${c}-settlement`,p.receipt_id]);const j=db.get<Row>("SELECT * FROM mission_earning_jobs WHERE opportunity_id=? AND agent_id=? AND provider_ref=? AND state='completed'",[w.opportunity_id,d.agent_id,p.receipt_id]);
     if(r&&j&&verifyCashLedger().ok&&db.get('SELECT id FROM mission_cash_entries WHERE account_id=? AND reference=? AND delta_cents=?',['treasury',p.receipt_id,r.amount_cents])&&r.agent_id===d.agent_id&&Number(r.amount_cents)===Number(p.net_cents)&&['booked','review','reversed'].includes(String(p.state))){const net=Number(p.net_cents)-Number(p.reversed_cents);if(!Number.isSafeInteger(net)||net<0)deny('invalid_settlement_history');historicalReceivedNetUsdCents=net;receivedNetUsdCents=p.state==='booked'?net:0;receiptId=String(r.external_id);stage=net===0?'reversed':p.state==='booked'?'verified_usd_received':'settlement_under_review';reviewRequired=p.state!=='booked';}
    }
   }
  }
  return {id:d.id,state:d.state,stage,origin:d.origin,serviceId:d.service_id,proposedUsdCents:Number(d.quote_cents),receivedNetUsdCents,historicalReceivedNetUsdCents,receiptId,reviewRequired,contactStopped:d.state==='stopped',cashCreditedByThisModule:false,inquiryAuthenticity:'owner_declared_not_independently_verified',note:'Received net is historical attributed settlement, not current spendable balance or profit. Use the verified mission wallet for allocations, costs and withdrawals.'};
 });}
 overview(actor:MoneyActor){assertMoneyOwner(actor);const requests=db.all<Row>('SELECT id FROM mission_customer_requests ORDER BY created_at DESC,id LIMIT 200');return {channelInventory:CUSTOMER_CHANNELS,offers:SERVICE_OFFERS,requests:requests.map(x=>{try{return this.progress(actor,String(x.id));}catch{return {id:x.id,stage:'binding_requires_review',receivedNetUsdCents:null,reviewRequired:true};}}),limit:200,totalRecords:Number(db.get<Row>('SELECT COUNT(*) AS n FROM mission_customer_requests')?.n),automaticOutreach:false,publishingEnabled:false,newPaymentAdapter:false,note:'No acquired customers are inferred from listing packs, inquiries or prepared responses. No aggregates over paginated results.'};}
 detail(actor:MoneyActor,id:string){if(actor.kind==='agent'){grant(String(actor.id));} else assertMoneyOwner(actor);return {request:this.request(id),progress:this.progress(actor,id),verifications:db.all<Row>('SELECT * FROM mission_customer_verifications WHERE request_id=?',[id])};}
}
