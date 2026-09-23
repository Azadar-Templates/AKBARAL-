/** Human-assisted fixed-price USD work. No automatic bidding or cash-provider registration. */
import { missionDb as db, missionId, sha256, nowIso, appendMissionAudit, type Row } from '../database';
import { assertMoneyOwner, grant, cashAccount, approveOpportunity, MoneyError, type MoneyActor } from '../money';
import { FREELANCER_LEDGER_PROVIDER, reviewFreelancerWork, FreelancerSettlementWorkflow, readFreelancerProof } from './freelancer-settlement';
import type { FreelancerFileReader } from './freelancer-delivery-contracts';
import { currentPolicy, checkActivity } from '../policy';
import { FreelancerError, FreelancerClient, configuredFreelancerClient, type FreelancerContract } from './freelancer';
export const FREELANCER_COMPLIANCE_CHECKS = [
  'account_control_and_kyc', 'country_and_tax_eligibility', 'platform_api_and_automation_permission',
  'client_permission_and_confidentiality', 'rights_and_quality_review', 'fees_reviewed_no_new_spending',
] as const;
function deny(code: string): never { throw new MoneyError(`freelancer_${code}`); }
function required(s: string, max=500): string { if(typeof s!=='string'||!s.trim()||s.length>max)deny('invalid_input');return s; }
function work(id: string): Row { const r=db.get<Row>('SELECT * FROM mission_freelancer_work WHERE id=?',[id]);if(!r)deny('work_missing');return r; }
function evidence(id: string, state: string, value: unknown) {
  const snapshot=JSON.stringify(value),hash=sha256(snapshot);
  db.run('INSERT INTO mission_freelancer_events (id,work_id,state,evidence_hash,snapshot_json,created_at) VALUES (?,?,?,?,?,?)',[missionId('fle'),id,state,hash,snapshot,nowIso()]);
  appendMissionAudit({actorType:'system',actorId:null,action:`freelancer.${state}`,subjectType:'freelancer_work',subjectId:id,detail:{evidenceHash:hash}});
}
export class FreelancerWorkflow {
  constructor(private readonly provider: FreelancerClient | null, private readonly files?: FreelancerFileReader) {}
  private client() { if(!this.provider)deny('blocked_credentials');return this.provider; }
  private live(actor: MoneyActor, accountRequired=false) {
    assertMoneyOwner(actor); const policy=currentPolicy();
    if(policy.killSwitch||policy.currency!=='USD'||!checkActivity('software_development',policy).allowed)deny('policy_blocked');
    if(Number(db.get<Row>("SELECT frozen FROM mission_cash_accounts WHERE id='treasury'")?.frozen)||Number(db.get<Row>('SELECT COALESCE(SUM(remaining_cents),0) AS n FROM mission_cash_liabilities')?.n))deny('cash_frozen_or_liability');
    const userId=this.client().userId;
    if(accountRequired) {
      const a=db.get<Row>('SELECT * FROM mission_freelancer_accounts WHERE user_id=?',[userId]);
      if(!a||a.state!=='authorized'||!Number.isFinite(Date.parse(String(a.expires_at)))||Date.parse(String(a.expires_at))<=Date.now())deny('account_authorization_required');
      grant(String(a.agent_id));if(Number(cashAccount(String(a.agent_id)).frozen))deny('agent_frozen');
    }
  }
  private owns(id: string) { const w=work(id);if(w.user_id!==this.client().userId)deny('account_mismatch');return w; }
  overview(actor: MoneyActor) {
    assertMoneyOwner(actor);
    return {provider:'freelancer',configured:!!this.provider,earningCurrency:'USD',cashBridgeEnabled:false,deliveryReadbackConfigured:!!this.files,
      blocked:[...(!this.provider?['credentials']:[]),'payout_adapter_not_configured','independent_usd_settlement_not_configured'],
      lifecycle:[
        {stage:'DISCOVER',implementation:'USD fixed-price API discovery; leads are not executable contracts'},
        {stage:'ELIGIBILITY',implementation:'fresh self / project / accepted bid / funded milestone plus owner compliance review'},
        {stage:'AUTHORIZATION',implementation:'expiring owner account grant and exclusive account / agent / project binding'},
        {stage:'REAL_WORK',implementation:'owner-supplied real text deliverable; no autonomous job execution engine'},
        {stage:'DELIVERY',implementation:'owner hash approval, single-use upload; uncertain uploads cannot be retried'},
        {stage:'PROVIDER_CONFIRMATION',implementation:'provider milestone observation; cleared is not cash'},
        {stage:'PAYOUT',implementation:'Verified remittance reader contract implemented; BLOCKED without a concrete adapter'},
        {stage:'SETTLEMENT_VERIFICATION',implementation:'Independent USD verification and bounded reversal controls implemented; BLOCKED without a concrete receiving adapter'},
        {stage:'MISSION_WALLET',implementation:'Atomic receiving-only cash bridge implemented; BLOCKED without both verified remittance and receiving settlement'},
      ],complianceChecks:FREELANCER_COMPLIANCE_CHECKS,
      accounts:db.all<Row>('SELECT * FROM mission_freelancer_accounts ORDER BY user_id LIMIT 200'),
      projects:db.all<Row>('SELECT * FROM mission_freelancer_projects ORDER BY observed_at DESC LIMIT 200'),
      work:db.all<Row>('SELECT * FROM mission_freelancer_work ORDER BY updated_at DESC LIMIT 200')};
  }
  async discover(actor: MoneyActor, query: string, offset=0) {
    this.live(actor);const result=await this.client().discover(query,offset);
    return db.transaction(()=>{
      this.live(actor);
      for(const p of result.projects)db.run('INSERT INTO mission_freelancer_projects (project_id,snapshot_json,observed_at) VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,observed_at=excluded.observed_at',[p.projectId,JSON.stringify(p),p.observedAt]);
      return result;
    });
  }
  async authorizeAccount(actor: MoneyActor, input: {agentId:string;reference:string;expiresAt:string;checks:string[]}) {
    const data=structuredClone(input);this.live(actor);grant(data.agentId);required(data.reference);
    const expiry=Date.parse(data.expiresAt);
    if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+86400000)deny('invalid_authorization_expiry');
    if(!Array.isArray(data.checks)||data.checks.length!==FREELANCER_COMPLIANCE_CHECKS.length||!FREELANCER_COMPLIANCE_CHECKS.every(c=>data.checks.includes(c)))deny('owner_compliance_review_required');
    const userId=await this.client().verifyIdentity();
    return db.transaction(()=>{
      this.live(actor);grant(data.agentId);if(expiry<=Date.now())deny('authorization_expired');
      const old=db.get<Row>('SELECT * FROM mission_freelancer_accounts WHERE user_id=? OR agent_id=?',[userId,data.agentId]);
      if(old&&(old.user_id!==userId||old.agent_id!==data.agentId||old.state!=='authorized'))deny('exclusive_account_conflict');
      if(old)db.run('UPDATE mission_freelancer_accounts SET compliance_ref=?,compliance_checks=?,expires_at=?,approved_by=? WHERE user_id=?',[data.reference,JSON.stringify(data.checks),new Date(expiry).toISOString(),actor.id,userId]);
      else db.run("INSERT INTO mission_freelancer_accounts (user_id,agent_id,state,compliance_ref,compliance_checks,expires_at,approved_by,created_at) VALUES (?,?,'authorized',?,?,?,?,?)",[userId,data.agentId,data.reference,JSON.stringify(data.checks),new Date(expiry).toISOString(),actor.id,nowIso()]);
      evidence(userId,'owner_compliance_attestation',{...data,userId,approvedBy:actor.id,notProviderKycProof:true});
      return db.get<Row>('SELECT * FROM mission_freelancer_accounts WHERE user_id=?',[userId]);
    });
  }
  revokeAccount(actor: MoneyActor) {
    assertMoneyOwner(actor);const userId=this.client().userId;
    db.transaction(()=>{db.run("UPDATE mission_freelancer_accounts SET state='revoked' WHERE user_id=?",[userId]);evidence(userId,'revoked',{by:actor.id});});
  }
  async assign(actor: MoneyActor, projectId: string, bidId: string, milestoneId: string, scopeReference: string) {
    required(scopeReference);this.live(actor,true);const contract=await this.client().contract(projectId,bidId,milestoneId);
    return db.transaction(()=>{
      this.live(actor,true);
      if(db.get('SELECT id FROM mission_freelancer_work WHERE project_id=? OR bid_id=? OR milestone_id=?',[projectId,bidId,milestoneId]))deny('exclusive_work_conflict');
      const id=missionId('flw');
      const money=approveOpportunity(actor,{title:`Freelancer contract ${projectId}`,evidenceUrl:`https://www.freelancer.com/api/projects/0.1/projects/${projectId}/`,activity:'software_development',provider:FREELANCER_LEDGER_PROVIDER});
      db.run("INSERT INTO mission_freelancer_work (id,user_id,project_id,bid_id,milestone_id,contract_json,scope_ref,money_opportunity_id,state,updated_at) VALUES (?,?,?,?,?,?,?,?,'authorized',?)",[id,contract.userId,projectId,bidId,milestoneId,JSON.stringify(contract),scopeReference,money.id,nowIso()]);
      evidence(id,'authorized',contract);return work(id);
    });
  }
  draft(actor: MoneyActor,id: string,content: string) {
    required(content,262144);if(Buffer.byteLength(content)>262144)deny('artifact_too_large');
    return db.transaction(()=>{
      this.live(actor,true);const row=this.owns(id);if(!['authorized','draft'].includes(String(row.state)))deny('immutable_artifact');
      db.run("UPDATE mission_freelancer_work SET content=?,content_hash=?,approved_hash=NULL,approved_by=NULL,state='draft',updated_at=? WHERE id=?",[content,sha256(content),nowIso(),id]);
      evidence(id,'draft',{contentHash:sha256(content)});return work(id);
    });
  }
  approve(actor: MoneyActor,id: string,hash: string) {
    return db.transaction(()=>{
      this.live(actor,true);const row=this.owns(id);
      if(row.state!=='draft'||!hash||row.content_hash!==hash||sha256(String(row.content))!==hash)deny('artifact_hash_mismatch');
      db.run("UPDATE mission_freelancer_work SET approved_hash=?,approved_by=?,state='approved',updated_at=? WHERE id=?",[hash,actor.id,nowIso(),id]);
      evidence(id,'owner_delivery_approval',{hash,by:actor.id});return work(id);
    });
  }
  async deliver(actor: MoneyActor,id: string) {
    const row=db.transaction(()=>{
      this.live(actor,true);const r=this.owns(id);
      if(r.state!=='approved'||r.approved_hash!==r.content_hash||sha256(String(r.content))!==r.content_hash)deny('delivery_not_approved_or_already_claimed');
      db.run("UPDATE mission_freelancer_work SET state='dispatching',updated_at=? WHERE id=?",[nowIso(),id]);
      evidence(id,'dispatching',{hash:r.content_hash});return r;
    });
    let authorized=false,open=true;
    try {
      const receipt=await this.client().upload(JSON.parse(String(row.contract_json)) as FreelancerContract,String(row.content),()=>db.transaction(()=>{
        if(!open||authorized)deny('dispatch_closed');this.live(actor,true);const fresh=this.owns(id);
        if(fresh.state!=='dispatching'||fresh.content_hash!==row.content_hash||fresh.approved_hash!==row.content_hash||fresh.contract_json!==row.contract_json)deny('dispatch_closed');
        authorized=true;
      }));
      return db.transaction(()=>{
        if(!authorized)deny('dispatch_closed');
        db.run("UPDATE mission_freelancer_work SET state='delivered',delivery_json=?,updated_at=? WHERE id=?",[JSON.stringify(receipt),nowIso(),id]);
        evidence(id,'provider_upload_acknowledged',receipt);return work(id);
      });
    } catch {
      // Even pre-send failures remain manual review: never clear a durable claim on error.
      return db.transaction(()=>{db.run("UPDATE mission_freelancer_work SET state='delivery_review_required',updated_at=? WHERE id=? AND state='dispatching'",[nowIso(),id]);evidence(id,'delivery_review_required',{retryAllowed:false});return work(id);});
    } finally {open=false;}
  }
  /** Recovery is provider readback only. Absence is never permission to repeat POST. */
  async reconcileDelivery(actor: MoneyActor,id: string,fileId: string) {
    assertMoneyOwner(actor);required(fileId,240);if(!/^[1-9]\d*$/.test(fileId)||!Number.isSafeInteger(Number(fileId)))deny('invalid_file_id');const row=this.owns(id);
    if(!this.files)deny('file_readback_not_configured');
    if(this.files.userId!==row.user_id||!['dispatching','delivery_review_required','delivered'].includes(String(row.state)))deny('delivery_not_dispatched');
    const start=db.get<Row>("SELECT created_at FROM mission_freelancer_events WHERE work_id=? AND state='dispatching' ORDER BY created_at LIMIT 1",[id]);
    const end=db.get<Row>("SELECT created_at FROM mission_freelancer_events WHERE work_id=? AND state IN ('delivery_review_required','provider_upload_acknowledged') ORDER BY created_at LIMIT 1",[id]);
    if(!start)deny('dispatch_evidence_missing');
    await this.client().verifyIdentity();
    const proof=await readFreelancerProof(signal=>this.files!.verify({projectId:String(row.project_id),fileId},signal));
    const contract=JSON.parse(String(row.contract_json)) as FreelancerContract;
    if(!proof||proof.state!=='stored'||proof.userId!==row.user_id||proof.projectId!==row.project_id||proof.fileId!==fileId||proof.fromUserId!==row.user_id||proof.toUserId!==contract.employerId||proof.fileName!==`delivery-${row.content_hash}.txt`||proof.contentHash!==row.content_hash||proof.bytes!==Buffer.byteLength(String(row.content)))deny('file_readback_unconfirmed');
    const created=Date.parse(proof.createdAt),verified=Date.parse(proof.verifiedAt);
    if(!Number.isFinite(created)||created<Date.parse(String(start.created_at))-1000||created>(end?Date.parse(String(end.created_at)):Date.parse(String(start.created_at))+90000)+1000||created>Date.now()+1000)deny('file_outside_dispatch_window');
    return db.transaction(()=>{
      assertMoneyOwner(actor);const current=this.owns(id);
      if(!Number.isFinite(verified)||verified<Date.now()-30000||verified>Date.now()+1000)deny('stale_readback');
      if(current.state!==row.state||current.updated_at!==row.updated_at||current.approved_hash!==row.content_hash||current.content_hash!==row.content_hash||sha256(String(current.content))!==row.content_hash)deny('delivery_changed_during_readback');
      if(current.delivery_json&&JSON.parse(String(current.delivery_json)).fileId!==fileId)deny('delivery_identity_conflict');
      const receipt={fileId,projectId:proof.projectId,fromUserId:proof.fromUserId,toUserId:proof.toUserId,fileName:proof.fileName,bytes:proof.bytes,contentHash:proof.contentHash,state:'provider_upload_acknowledged',verification:'stored_content_readback',cashEligible:false};
      db.run("UPDATE mission_freelancer_work SET state='delivered',delivery_json=?,updated_at=? WHERE id=?",[JSON.stringify(receipt),nowIso(),id]);
      evidence(id,'provider_content_readback',{...receipt,createdAt:proof.createdAt,verifiedAt:proof.verifiedAt});return work(id);
    });
  }
  async syncMilestone(actor: MoneyActor,id: string) {
    assertMoneyOwner(actor);const row=this.owns(id);
    if(!['delivered','provider_cleared','provider_review_required'].includes(String(row.state)))deny('delivery_not_confirmed');
    const expected=JSON.parse(String(row.contract_json)) as FreelancerContract;
    const milestone=await (async()=>{try {await this.client().verifyIdentity();return await this.client().milestone(expected);}
      catch(error) {reviewFreelancerWork(actor,id);throw error;}})();
    return db.transaction(()=>{
      assertMoneyOwner(actor);const current=this.owns(id);
      if(current.state!==row.state||current.updated_at!==row.updated_at||current.milestone_json!==row.milestone_json)deny('stale_observation');
      const same=milestone.currency==='USD'&&milestone.amountDecimal===expected.amountDecimal&&milestone.disputeId===null;
      const state=same&&milestone.status==='cleared'?'provider_cleared':same&&['frozen','pending','requested_release'].includes(milestone.status)&&work(id).state==='delivered'?'delivered':'provider_review_required';
      db.run('UPDATE mission_freelancer_work SET state=?,milestone_json=?,updated_at=? WHERE id=?',[state,JSON.stringify(milestone),nowIso(),id]);evidence(id,state,milestone);if(state==='provider_review_required')reviewFreelancerWork(actor,id);return work(id);
    });
  }
}
/** Conservative local safety cap, NOT a claimed provider-wide quota. Shared across workers. */
export function reserveFreelancerRequest() {
  db.transaction(()=>{
    const now=nowIso(),cutoff=new Date(Date.now()-60000).toISOString();
    if(String(db.get<Row>("SELECT until_at FROM mission_freelancer_api_cooldown WHERE id='global'")?.until_at??'')>now)throw new FreelancerError('freelancer_rate_limited');
    db.run('DELETE FROM mission_freelancer_api_requests WHERE started_at<=?',[cutoff]);
    if(Number(db.get<Row>('SELECT COUNT(*) AS n FROM mission_freelancer_api_requests')?.n)>=20)throw new FreelancerError('freelancer_rate_limited');
    db.run('INSERT INTO mission_freelancer_api_requests (id,started_at) VALUES (?,?)',[missionId('flr'),now]);
  });
}
export function recordFreelancerCooldown(delayMs: number) {
  const until=new Date(Math.min(Date.now()+Math.max(60000,Number.isFinite(delayMs)?delayMs:60000),253402300799999)).toISOString();
  db.transaction(()=>{
    const old=db.get<Row>("SELECT until_at FROM mission_freelancer_api_cooldown WHERE id='global'");
    if(!old)db.run("INSERT INTO mission_freelancer_api_cooldown (id,until_at) VALUES ('global',?)",[until]);
    else if(String(old.until_at)<until)db.run("UPDATE mission_freelancer_api_cooldown SET until_at=? WHERE id='global'",[until]);
  });
}
export function configuredFreelancerWorkflow() {
  return new FreelancerWorkflow(configuredFreelancerClient({beforeRequest:reserveFreelancerRequest,onRateLimit:recordFreelancerCooldown}));
}

/** No production remittance or receiving adapter is selected. Credentials cannot
 * silently install fixtures or substitute a platform balance for cash. */
export function configuredFreelancerSettlementWorkflow() {
  return new FreelancerSettlementWorkflow(configuredFreelancerClient({beforeRequest:reserveFreelancerRequest,onRateLimit:recordFreelancerCooldown}));
}
