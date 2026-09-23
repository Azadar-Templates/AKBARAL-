/** Receiving-only bridge. No bids, fee-bearing actions, withdrawal requests or fake adapters. */
import { missionDb as db, missionId, sha256, nowIso, appendMissionAudit, type Row } from '../database';
import { assertMoneyOwner, approveOpportunity, freezeCash, ensureCashAccount, verifyBoundMoneyReceipt, MoneyError, cents, type MoneyActor, type MoneyProvider } from '../money';
import { currentPolicy } from '../policy';
import type { FreelancerClient, FreelancerContract } from './freelancer';
import type { FreelancerRemittance, FreelancerRemittanceReader, FreelancerUsdReceiver } from './freelancer-settlement-contracts';
export const FREELANCER_LEDGER_PROVIDER='freelancer-settlement';
function deny(code:string):never {throw new MoneyError(`freelancer_${code}`);}
function ref(value:string):string {if(typeof value!=='string'||!value.trim()||value.length>240||/[\x00-\x1f]/.test(value))deny('invalid_reference');return value;}
function fresh(value:string) {const time=Date.parse(value);if(!Number.isFinite(time)||time>Date.now()+1000||time<Date.now()-30000)deny('stale_verification');}
function minor(value:string):number {
  if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value))deny('unsupported_amount');
  const [whole,fraction='']=value.split('.');return cents(Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))),true);
}
function payout(userId:string,payoutId:string) {return db.get<Row>('SELECT * FROM mission_freelancer_payouts WHERE user_id=? AND payout_id=?',[userId,payoutId]);}
function evidence(userId:string,payoutId:string,stage:string,proof:unknown) {
  const json=JSON.stringify(proof),hash=sha256(json);
  db.run('INSERT INTO mission_freelancer_settlement_evidence (id,user_id,payout_id,stage,evidence_hash,snapshot_json,observed_at) VALUES (?,?,?,?,?,?,?)',[missionId('fls'),userId,payoutId,stage,hash,json,nowIso()]);
  appendMissionAudit({actorType:'system',actorId:null,action:`freelancer.${stage}`,subjectType:'freelancer_payout',subjectId:payoutId,detail:{userId,evidenceHash:hash}});
}
export async function readFreelancerProof<T>(read:(signal:AbortSignal)=>Promise<T>):Promise<T> {
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try {return await Promise.race([Promise.resolve().then(async()=>structuredClone(await read(controller.signal))),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new MoneyError('freelancer_verification_timeout'));},30000);
  })]);} catch {deny('external_verification_unavailable');} finally {clearTimeout(timer);controller.abort();}
}
function uncertain(actor:MoneyActor,userId:string,payoutId:string) {
  db.transaction(()=>{
    assertMoneyOwner(actor);const p=payout(userId,payoutId);if(!p)return;
    const booked=p.net_cents!==null;
    if(p.state!=='reversed')db.run('UPDATE mission_freelancer_payouts SET state=?,updated_at=? WHERE user_id=? AND payout_id=?',[booked?'review':'unknown',nowIso(),userId,payoutId]);
    if(booked) {ensureCashAccount();freezeCash(actor,'treasury',true);const a=db.get<Row>('SELECT agent_id FROM mission_freelancer_accounts WHERE user_id=?',[userId]);if(a)freezeCash(actor,String(a.agent_id),true);}
    evidence(userId,payoutId,booked?'settlement_review':'settlement_unknown',{cashReversalAssumed:false});
  });
}
/** Missing/changed milestone evidence after booking freezes access, never fabricates a debit. */
export function reviewFreelancerWork(actor:MoneyActor,workId:string) {
  const p=db.get<Row>('SELECT user_id,payout_id FROM mission_freelancer_payout_items WHERE work_id=?',[workId]);
  if(p)uncertain(actor,String(p.user_id),String(p.payout_id));
}
export class FreelancerSettlementWorkflow {
  constructor(private readonly client:FreelancerClient|null,private readonly remittances?:FreelancerRemittanceReader,private readonly receiver?:FreelancerUsdReceiver) {}
  status(actor:MoneyActor) {
    assertMoneyOwner(actor);return {cashBridgeEnabled:!!this.client&&!!this.remittances&&!!this.receiver,
      blocked:[!this.client&&'credentials',!this.remittances&&'payout_adapter_not_configured',!this.receiver&&'independent_usd_settlement_not_configured'].filter(Boolean),
      payouts:db.all<Row>('SELECT * FROM mission_freelancer_payouts ORDER BY updated_at DESC LIMIT 200')};
  }
  private account(actor:MoneyActor) {assertMoneyOwner(actor);if(!this.remittances)deny('payout_adapter_not_configured');if(!this.client)deny('blocked_credentials');if(this.remittances.userId!==this.client.userId)deny('account_mismatch');return this.client.userId;}
  private normalize(proof:FreelancerRemittance,userId:string,payoutId:string) {
    if(proof.userId!==userId||proof.payoutId!==payoutId||!['pending','paid'].includes(proof.state)||proof.currency!=='USD'||proof.complete!==true)deny('remittance_unconfirmed');
    ref(proof.evidenceRef);fresh(proof.verifiedAt);
    if(!Array.isArray(proof.lines)||!proof.lines.length||proof.lines.length>10)deny('remittance_incomplete_or_over_limit');
    let total=0;const seen=new Set<string>();
    const lines=proof.lines.map(l=>{
      ref(l.projectId);ref(l.bidId);ref(l.milestoneId);
      if(seen.has(l.milestoneId)||l.currency!=='USD'||cents(l.grossCents,true)!==cents(l.feeCents)+cents(l.netCents))deny('remittance_item_mismatch');
      seen.add(l.milestoneId);total=cents(total+l.netCents);
      return {projectId:l.projectId,bidId:l.bidId,milestoneId:l.milestoneId,currency:l.currency,grossCents:l.grossCents,feeCents:l.feeCents,netCents:l.netCents};
    }).sort((a,b)=>a.milestoneId.localeCompare(b.milestoneId));
    if(cents(proof.netCents,true)!==total)deny('remittance_total_mismatch');
    return {userId,payoutId,currency:'USD',netCents:total,lines};
  }
  async observePayout(actor:MoneyActor,payoutId:string) {
    const userId=this.account(actor);ref(payoutId);
    try {
      await this.client!.verifyIdentity();
      const proof=await readFreelancerProof(signal=>this.remittances!.verify({userId,payoutId},signal));
      const normalized=this.normalize(proof,userId,payoutId),hash=sha256(JSON.stringify(normalized));
      return db.transaction(()=>{
        assertMoneyOwner(actor);fresh(proof.verifiedAt);const old=payout(userId,payoutId);
        if(old&&(old.remittance_hash!==hash||(old.net_cents!==null&&proof.state!=='paid')))deny('remittance_changed');
        const snapshot=JSON.stringify({...normalized,state:proof.state,complete:true,evidenceRef:proof.evidenceRef,verifiedAt:proof.verifiedAt});
        if(!old)db.run("INSERT INTO mission_freelancer_payouts (user_id,payout_id,state,remittance_json,remittance_hash,updated_at) VALUES (?,?,'observed',?,?,?)",[userId,payoutId,snapshot,hash,nowIso()]);
        else db.run('UPDATE mission_freelancer_payouts SET remittance_json=?,updated_at=? WHERE user_id=? AND payout_id=?',[snapshot,nowIso(),userId,payoutId]);
        evidence(userId,payoutId,'provider_remittance_observed',JSON.parse(snapshot));return payout(userId,payoutId)!;
      });
    } catch {uncertain(actor,userId,payoutId);deny('payout_verification_blocked');}
  }
  /** Explicit owner backfill for previously authorized phase-1 work; never a cash credit. */
  authorizeHistoricalWork(actor:MoneyActor,workId:string) {
    assertMoneyOwner(actor);if(!this.client)deny('blocked_credentials');
    return db.transaction(()=>{
      const w=db.get<Row>('SELECT * FROM mission_freelancer_work WHERE id=? AND user_id=?',[workId,this.client!.userId]);
      if(!w||w.state!=='provider_cleared'||!w.delivery_json||!w.approved_by)deny('work_unconfirmed');
      if(!w.money_opportunity_id) {
        const op=approveOpportunity(actor,{title:`Freelancer contract ${w.project_id}`,evidenceUrl:`https://www.freelancer.com/api/projects/0.1/projects/${w.project_id}/`,activity:'software_development',provider:FREELANCER_LEDGER_PROVIDER});
        db.run('UPDATE mission_freelancer_work SET money_opportunity_id=? WHERE id=?',[op.id,workId]);
        evidence(this.client!.userId,workId,'historical_work_owner_authorized',{workId,approvedBy:actor.id});
      }
      return db.get<Row>('SELECT * FROM mission_freelancer_work WHERE id=?',[workId])!;
    });
  }
  async reconcilePayout(actor:MoneyActor,payoutId:string,externalId:string) {
    const userId=this.account(actor);ref(payoutId);ref(externalId);if(!this.receiver)deny('independent_usd_settlement_not_configured');
    const receiver=this.receiver,rail=ref(receiver.rail),receivingAccount=ref(receiver.receivingAccount);
    const receiptId='incoming:'+sha256(JSON.stringify([rail,receivingAccount,externalId]));
    try {
      const observed=await this.observePayout(actor,payoutId),remittance=JSON.parse(String(observed.remittance_json)) as FreelancerRemittance;
      if(remittance.state!=='paid')deny('payout_not_paid');
      const rows:Row[]=[];
      for(const line of remittance.lines) {
        const w=db.get<Row>('SELECT * FROM mission_freelancer_work WHERE user_id=? AND project_id=? AND bid_id=? AND milestone_id=?',[userId,line.projectId,line.bidId,line.milestoneId]);
        if(!w||w.state!=='provider_cleared'||!w.delivery_json||!w.money_opportunity_id||!w.approved_by||w.approved_hash!==w.content_hash||sha256(String(w.content))!==w.content_hash)deny('work_unconfirmed');
        const contract=JSON.parse(String(w.contract_json)) as FreelancerContract;
        const milestone=await this.client!.milestone(contract);
        if(milestone.status!=='cleared'||milestone.currency!=='USD'||milestone.disputeId!==null||minor(milestone.amountDecimal)!==line.grossCents||minor(contract.amountDecimal)!==line.grossCents)deny('milestone_unconfirmed');
        rows.push(w);
      }
      db.transaction(()=>{
        assertMoneyOwner(actor);const p=payout(userId,payoutId)!;
        if(p.remittance_hash!==observed.remittance_hash||['review','reversed'].includes(String(p.state)))deny('payout_review_required');
        if(p.receipt_id&&(p.receipt_id!==receiptId||p.rail!==rail||p.receiving_account!==receivingAccount))deny('settlement_binding_conflict');
        if(db.get('SELECT payout_id FROM mission_freelancer_payouts WHERE rail=? AND receiving_account=? AND external_id=? AND (user_id<>? OR payout_id<>?)',[rail,receivingAccount,externalId,userId,payoutId]))deny('transfer_already_bound');
        db.run("UPDATE mission_freelancer_payouts SET rail=?,receiving_account=?,external_id=?,receipt_id=?,state=CASE WHEN net_cents IS NULL THEN 'pending' ELSE state END,updated_at=? WHERE user_id=? AND payout_id=?",[rail,receivingAccount,externalId,receiptId,nowIso(),userId,payoutId]);
      });
      const proof=await readFreelancerProof(signal=>receiver.verify({userId,payoutId,externalId},signal));
      if(proof.state!=='settled'||proof.direction!=='credit'||proof.source!=='freelancer'||proof.userId!==userId||proof.payoutId!==payoutId||proof.rail!==rail||proof.receivingAccount!==receivingAccount||proof.externalId!==externalId||proof.missionOwnershipVerified!==true||proof.currency!=='USD')deny('settlement_unconfirmed');
      fresh(proof.verifiedAt);ref(proof.evidenceRef);
      if(cents(proof.grossCents,true)!==remittance.netCents||cents(proof.feeCents)+cents(proof.netCents,true)!==proof.grossCents)deny('receiving_amount_mismatch');
      cents(proof.availableBalanceCents);
      const normalized={rail,receivingAccount,externalId,userId,payoutId,currency:'USD',grossCents:proof.grossCents,feeCents:proof.feeCents,netCents:proof.netCents};
      const hash=sha256(JSON.stringify(normalized));
      const account=db.get<Row>('SELECT agent_id FROM mission_freelancer_accounts WHERE user_id=?',[userId]);if(!account)deny('account_missing');
      const provider=this.moneyProvider(async()=>({externalId:receiptId,kind:'earning',amountCents:proof.netCents,currency:'USD',agentId:String(account.agent_id),availableBalanceCents:proof.availableBalanceCents}));
      return await verifyBoundMoneyReceipt(actor,provider,receiptId,()=>{
        fresh(proof.verifiedAt);fresh(remittance.verifiedAt);if(currentPolicy().currency!=='USD')deny('usd_treasury_required');
        const p=payout(userId,payoutId)!;
        if(p.receipt_id!==receiptId||p.remittance_hash!==observed.remittance_hash||['review','reversed'].includes(String(p.state))||Number(p.reversed_cents))deny('payout_review_required');
        if(p.settlement_hash&&p.settlement_hash!==hash)deny('settlement_changed');
        const booked=Number(db.get<Row>("SELECT COALESCE(SUM(available_cents+held_cents),0) AS n FROM mission_cash_accounts WHERE currency='USD'")?.n);
        if(booked>proof.availableBalanceCents)deny('receiving_balance_requires_review');
        for(const row of rows) {
          const w=db.get<Row>('SELECT * FROM mission_freelancer_work WHERE id=?',[row.id])!;
          if(w.state!=='provider_cleared'||w.updated_at!==row.updated_at||w.contract_json!==row.contract_json||w.delivery_json!==row.delivery_json||w.money_opportunity_id!==row.money_opportunity_id||w.content_hash!==row.content_hash||w.approved_hash!==row.approved_hash)deny('work_changed_during_verification');
          const prior=db.get<Row>('SELECT * FROM mission_freelancer_payout_items WHERE work_id=?',[w.id]);
          if(prior&&(prior.user_id!==userId||prior.payout_id!==payoutId))deny('work_already_paid');
          if(!prior)db.run('INSERT INTO mission_freelancer_payout_items (work_id,user_id,payout_id) VALUES (?,?,?)',[w.id,userId,payoutId]);
        }
        const jobId='flcash_'+sha256(receiptId);
        if(!db.get('SELECT id FROM mission_earning_jobs WHERE id=?',[jobId]))db.run("INSERT INTO mission_earning_jobs (id,agent_id,opportunity_id,idempotency_key,state,provider_ref,created_at,updated_at) VALUES (?,?,?,?,'awaiting_payment',?,?,?)",[jobId,account.agent_id,rows[0].money_opportunity_id,jobId,externalId,nowIso(),nowIso()]);
        if(p.state!=='booked') {
          db.run("UPDATE mission_freelancer_payouts SET state='booked',settlement_json=?,settlement_hash=?,net_cents=?,updated_at=? WHERE user_id=? AND payout_id=?",[JSON.stringify({...normalized,evidenceRef:proof.evidenceRef,verifiedAt:proof.verifiedAt}),hash,proof.netCents,nowIso(),userId,payoutId]);
          evidence(userId,payoutId,'independently_verified_usd_settlement',{...normalized,remittanceHash:observed.remittance_hash,evidenceRef:proof.evidenceRef});
        }
        return db.get<Row>('SELECT * FROM mission_earning_jobs WHERE id=?',[jobId])!;
      });
    } catch {uncertain(actor,userId,payoutId);deny('settlement_blocked_or_uncertain');}
  }
  async reconcileReversal(actor:MoneyActor,payoutId:string,reversalExternalId:string) {
    const userId=this.account(actor);ref(payoutId);ref(reversalExternalId);if(!this.receiver)deny('independent_usd_settlement_not_configured');
    const receiver=this.receiver,p=payout(userId,payoutId);
    if(reversalExternalId===p?.external_id)deny('distinct_reversal_movement_required');
    if(!p?.net_cents||p.rail!==receiver.rail||p.receiving_account!==receiver.receivingAccount)deny('original_settlement_missing');
    const receiptId='reversal:'+sha256(JSON.stringify([p.rail,p.receiving_account,reversalExternalId]));
    try {
      const proof=await readFreelancerProof(signal=>receiver.verifyReversal({userId,payoutId,originalExternalId:String(p.external_id),reversalExternalId},signal));
      if(proof.state!=='settled'||proof.direction!=='debit'||proof.source!=='freelancer'||proof.userId!==userId||proof.payoutId!==payoutId||proof.rail!==p.rail||proof.receivingAccount!==p.receiving_account||proof.originalExternalId!==p.external_id||proof.reversalExternalId!==reversalExternalId||proof.missionOwnershipVerified!==true||proof.currency!=='USD')deny('reversal_unconfirmed');
      fresh(proof.verifiedAt);ref(proof.evidenceRef);cents(proof.amountCents,true);
      const provider=this.moneyProvider(async()=>({externalId:receiptId,kind:'reversal',originalExternalId:String(p.receipt_id),amountCents:proof.amountCents,currency:'USD'}));
      return await verifyBoundMoneyReceipt(actor,provider,receiptId,()=>{
        fresh(proof.verifiedAt);const current=payout(userId,payoutId)!;
        if(!db.get('SELECT external_id FROM mission_money_receipts WHERE provider=? AND external_id=?',[FREELANCER_LEDGER_PROVIDER,receiptId])) {
          const reversed=cents(Number(current.reversed_cents)+proof.amountCents,true);if(reversed>Number(current.net_cents))deny('reversal_exceeds_settlement');
          db.run('UPDATE mission_freelancer_payouts SET reversed_cents=?,state=?,updated_at=? WHERE user_id=? AND payout_id=?',[reversed,reversed===Number(current.net_cents)?'reversed':'review',nowIso(),userId,payoutId]);
          evidence(userId,payoutId,'independently_verified_reversal',{receiptId,originalExternalId:proof.originalExternalId,amountCents:proof.amountCents,evidenceRef:proof.evidenceRef});
        }
        return undefined;
      });
    } catch {uncertain(actor,userId,payoutId);deny('reversal_blocked_or_uncertain');}
  }
  private moneyProvider(verifyReceipt:MoneyProvider['verifyReceipt']):MoneyProvider {
    return {id:FREELANCER_LEDGER_PROVIDER,supports:()=>false,verifyReceipt,pay:async()=>deny('outbound_payment_forbidden'),lookup:async()=>deny('outbound_payment_forbidden')};
  }
}
