/** Private receiving-only paid work. Never registers a spend adapter or automates Upwork UI. */
import { missionDb as db, missionId, sha256, nowIso, appendMissionAudit, type Row } from '../database';
import { assertMoneyOwner, MoneyError, cents, grant, cashAccount, ensureCashAccount, freezeCash, approveOpportunity, verifyBoundMoneyReceipt, type MoneyActor, type MoneyProvider } from '../money';
import { currentPolicy, checkActivity } from '../policy';
import type { UpworkProvider, UpworkUsdReceiver, UpworkProof, UpworkAuthority, UpworkContract, UpworkDelivery, UpworkRemittance, UpworkIdentity } from './upwork-contracts';
export const UPWORK_LEDGER_PROVIDER = 'upwork-settlement';
function deny(code: string): never { throw new MoneyError(`upwork_${code}`); }
function ref(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 240 || /[\x00-\x1f]/.test(value)) deny('invalid_reference');
  return value;
}
function hash(value: string) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) deny('invalid_hash'); return value; }
function fresh(proof: UpworkProof) {
  ref(proof.evidenceRef); const time = Date.parse(proof.verifiedAt);
  if (!Number.isFinite(time) || time > Date.now() + 1000 || time < Date.now() - 30000) deny('stale_proof');
}
/** No adapter exception/body/credential is exposed, and late resolutions cannot write. */
export async function readUpworkProof<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(async () => structuredClone(await read(controller.signal))), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 30000);
    })]);
  } catch { return deny('verification_unavailable'); }
  finally { clearTimeout(timer); controller.abort(); }
}
function event(subject: string, stage: string, evidence: unknown) {
  const evidenceHash = sha256(JSON.stringify(evidence));
  db.run('INSERT INTO mission_upwork_events (id,subject_id,stage,evidence_hash,created_at) VALUES (?,?,?,?,?)', [missionId('uwe'),subject,stage,evidenceHash,nowIso()]);
  appendMissionAudit({ actorType: 'system', actorId: null, action: `upwork.${stage}`, subjectType: 'upwork_work', subjectId: subject, detail: { evidenceHash } });
}
export class UpworkWorkflow {
  private readonly identity: UpworkIdentity | null;
  private readonly receiving: {rail: string; receivingAccount: string} | null;
  constructor(private readonly provider: UpworkProvider | null, private readonly receiver?: UpworkUsdReceiver) {
    this.identity = provider ? Object.freeze({accountId:ref(provider.accountId),tenantId:ref(provider.tenantId)}) : null;
    this.receiving = receiver ? Object.freeze({rail:ref(receiver.rail),receivingAccount:ref(receiver.receivingAccount)}) : null;
  }
  overview(actor: MoneyActor) {
    assertMoneyOwner(actor);
    return {provider:'upwork',configured:!!this.provider,cashBridgeEnabled:!!this.provider&&!!this.receiver,
      automaticDelivery:false,automaticBidding:false,autonomousWorkEngine:false,
      blocked:[!this.provider&&'approved_provider_verifier_not_configured',!this.receiver&&'independent_usd_receiver_not_configured'].filter(Boolean),
      lifecycle:['DISCOVER','ELIGIBILITY','AUTHORIZATION','REAL_WORK','DELIVERY','PROVIDER_CONFIRMATION','PAYOUT','SETTLEMENT_VERIFICATION','MISSION_WALLET'],
      scope:'owner-selected fixed-price USD contract; manual submission; one fully attributed milestone per payout',
      accounts:db.all<Row>('SELECT * FROM mission_upwork_accounts LIMIT 200'),
      work:db.all<Row>('SELECT id,contract_id,milestone_id,state,content_hash,version FROM mission_upwork_work LIMIT 200'),
      payouts:db.all<Row>('SELECT * FROM mission_upwork_payouts LIMIT 200')};
  }
  private source() { if (!this.provider || !this.identity) deny('approved_provider_verifier_not_configured'); return this.provider; }
  private sameIdentity(proof: UpworkIdentity) { if (proof.accountId !== this.identity?.accountId || proof.tenantId !== this.identity?.tenantId) deny('identity_mismatch'); }
  private permission(proof: UpworkAuthority) {
    fresh(proof); this.sameIdentity(proof);
    if (proof.ownerControlVerified !== true || proof.accountType !== 'individual' || proof.identityVerified !== true || proof.eligible !== true || proof.goodStanding !== true ||
        proof.internalApiUseApproved !== true || proof.contractReadApproved !== true || proof.deliveryReadApproved !== true || proof.paymentReadApproved !== true ||
        proof.durableRecordsApproved !== true || cents(proof.lifetimeUsdCents) < 2500000 || !Number.isFinite(proof.jobSuccessScore) || proof.jobSuccessScore < 90 || proof.jobSuccessScore > 100 ||
        !Number.isFinite(Date.parse(proof.permissionExpiresAt)) || Date.parse(proof.permissionExpiresAt) <= Date.now()) deny('provider_permission_required');
  }
  private async authority(actor: MoneyActor) {
    assertMoneyOwner(actor); const provider = this.source();
    const proof = await readUpworkProof(signal => provider.authority(signal));
    assertMoneyOwner(actor); this.permission(proof);
    if (proof.missionOwnerId !== actor.id) deny('owner_control_unverified');
    return proof;
  }
  private active(actor: MoneyActor, accountRequired = true) {
    assertMoneyOwner(actor); this.source(); const policy = currentPolicy();
    if (policy.killSwitch || policy.currency !== 'USD' || !checkActivity('software_development',policy).allowed ||
        Number(db.get<Row>("SELECT frozen FROM mission_cash_accounts WHERE id='treasury'")?.frozen) ||
        Number(db.get<Row>('SELECT COALESCE(SUM(remaining_cents),0) AS n FROM mission_cash_liabilities')?.n)) deny('policy_blocked');
    if (accountRequired) {
      const a = db.get<Row>('SELECT * FROM mission_upwork_accounts WHERE account_id=?',[this.identity!.accountId]);
      if (!a || a.tenant_id !== this.identity!.tenantId || a.state !== 'authorized' || !Number.isFinite(Date.parse(String(a.expires_at))) || Date.parse(String(a.expires_at)) <= Date.now()) deny('account_authorization_required');
      grant(String(a.agent_id)); if (Number(cashAccount(String(a.agent_id)).frozen)) deny('agent_frozen');
    }
  }
  private work(id: string) {
    ref(id); const w = db.get<Row>('SELECT * FROM mission_upwork_work WHERE id=?',[id]);
    if (!w || w.account_id !== this.identity?.accountId || w.tenant_id !== this.identity?.tenantId) deny('work_missing');
    return w;
  }
  private unchanged(w: Row) { const current = this.work(String(w.id)); if (Object.keys(w).some(key => current[key] !== w[key])) deny('work_changed'); return current; }
  private validateContract(c: UpworkContract, contractId: string, milestoneId: string, w?: Row) {
    fresh(c); this.sameIdentity(c); ref(c.clientId); hash(c.scopeHash);
    if (c.contractId !== contractId || c.milestoneId !== milestoneId || c.kind !== 'fixed' || c.currency !== 'USD' ||
        !['active','completed'].includes(c.state) || c.acceptedByBoth !== true || c.hasAgency !== false || c.suspended !== false || c.disputed !== false ||
        c.aiAssistanceAllowed !== true || c.clientDataUseAllowed !== true || cents(c.grossCents,true) !== cents(c.fundedCents,true) ||
        cents(c.releasedCents) > c.grossCents) deny('contract_unconfirmed');
    if (w && (w.client_id !== c.clientId || w.scope_hash !== c.scopeHash || Number(w.gross_cents) !== c.grossCents)) deny('contract_changed');
  }
  private async contract(contractId: string, milestoneId: string, w?: Row) {
    ref(contractId); ref(milestoneId);
    const c = await readUpworkProof(signal => this.source().contract(contractId,milestoneId,signal));
    this.validateContract(c,contractId,milestoneId,w); return c;
  }
  /** Owner-selected references only. No job scraper, broad catalog or executable lead. */
  async inspect(actor: MoneyActor, contractId: string, milestoneId: string) {
    this.active(actor,false); const a = await this.authority(actor), c = await this.contract(contractId,milestoneId);
    this.active(actor,false); this.permission(a); fresh(c);
    return {contractId:c.contractId,milestoneId:c.milestoneId,currency:c.currency,kind:c.kind,executable:false,cashCredited:false};
  }
  async authorizeAccount(actor: MoneyActor, input: {agentId:string;reviewRef:string;expiresAt:string}) {
    const data = structuredClone(input); ref(data.agentId); ref(data.reviewRef); this.active(actor,false); grant(data.agentId);
    const expires = Date.parse(data.expiresAt);
    if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now()+86400000) deny('invalid_expiry');
    const a = await this.authority(actor);
    return db.transaction(() => {
      this.active(actor,false); this.permission(a); grant(data.agentId);
      if (expires <= Date.now() || expires > Date.parse(a.permissionExpiresAt)) deny('invalid_expiry');
      const old = db.get<Row>('SELECT * FROM mission_upwork_accounts WHERE account_id=? OR agent_id=? OR approved_by=?',[a.accountId,data.agentId,actor.id]);
      if (old && (old.account_id !== a.accountId || old.tenant_id !== a.tenantId || old.agent_id !== data.agentId || old.state !== 'authorized')) deny('exclusive_account_conflict');
      const values = [data.expiresAt,data.reviewRef,actor.id,sha256(JSON.stringify(a))];
      if (old) db.run('UPDATE mission_upwork_accounts SET expires_at=?,review_ref=?,approved_by=?,authority_hash=? WHERE account_id=?',[...values,a.accountId]);
      else db.run("INSERT INTO mission_upwork_accounts (account_id,tenant_id,agent_id,state,expires_at,review_ref,approved_by,authority_hash) VALUES (?,?,?,'authorized',?,?,?,?)",[a.accountId,a.tenantId,data.agentId,...values]);
      event(a.accountId,'account_authorized',{agent:data.agentId,authorityHash:sha256(JSON.stringify(a)),expires:data.expiresAt});
      return db.get<Row>('SELECT * FROM mission_upwork_accounts WHERE account_id=?',[a.accountId])!;
    });
  }
  revokeAccount(actor: MoneyActor) {
    assertMoneyOwner(actor); this.source(); db.transaction(() => {
      db.run("UPDATE mission_upwork_accounts SET state='revoked' WHERE account_id=?",[this.identity!.accountId]);
      event(this.identity!.accountId,'revoked',{by:actor.id});
    });
  }
  async assign(actor: MoneyActor, contractId: string, milestoneId: string) {
    this.active(actor); const a = await this.authority(actor), c = await this.contract(contractId,milestoneId);
    return db.transaction(() => {
      this.active(actor); this.permission(a); fresh(c);
      if (c.state !== 'active' || c.releasedCents !== 0) deny('new_work_not_funded_active');
      if (db.get('SELECT id FROM mission_upwork_work WHERE contract_id=? OR milestone_id=?',[contractId,milestoneId])) deny('exclusive_contract_conflict');
      const id = missionId('uww'), opportunity = approveOpportunity(actor,{title:`Upwork approved work ${id}`,evidenceUrl:'https://www.upwork.com/',activity:'software_development',provider:UPWORK_LEDGER_PROVIDER});
      db.run("INSERT INTO mission_upwork_work (id,account_id,tenant_id,contract_id,milestone_id,client_id,scope_hash,gross_cents,opportunity_id,state) VALUES (?,?,?,?,?,?,?,?,?,'authorized')",[id,c.accountId,c.tenantId,contractId,milestoneId,c.clientId,c.scopeHash,c.grossCents,opportunity.id]);
      event(id,'authorized',c); return this.work(id);
    });
  }
  draft(actor: MoneyActor, id: string, content: string) {
    if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content)>262144) deny('invalid_artifact');
    return db.transaction(() => {this.active(actor); const w = this.work(id);
      if (!['authorized','draft'].includes(String(w.state))) deny('immutable_artifact');
      db.run("UPDATE mission_upwork_work SET content=?,content_hash=?,state='draft',version=version+1 WHERE id=?",[content,sha256(content),id]);
      event(id,'draft',{contentHash:sha256(content)}); return this.work(id);
    });
  }
  approve(actor: MoneyActor, id: string, contentHash: string, qualityRef: string) {
    hash(contentHash); ref(qualityRef);
    return db.transaction(() => {this.active(actor); const w = this.work(id);
      if (w.state !== 'draft' || w.content_hash !== contentHash || sha256(String(w.content)) !== contentHash) deny('approval_mismatch');
      db.run("UPDATE mission_upwork_work SET approved_hash=?,approved_by=?,quality_ref=?,state='approved',version=version+1 WHERE id=?",[contentHash,actor.id,qualityRef,id]);
      event(id,'owner_approved',{contentHash,qualityRef}); return this.work(id);
    });
  }
  async beginManualDelivery(actor: MoneyActor, id: string) {
    this.active(actor); const w = this.work(id);
    if (w.state !== 'approved' || w.approved_hash !== w.content_hash || sha256(String(w.content)) !== w.approved_hash) deny('approved_work_required');
    const a = await this.authority(actor), c = await this.contract(String(w.contract_id),String(w.milestone_id),w);
    return db.transaction(() => {this.active(actor); this.permission(a); fresh(c); this.unchanged(w);
      if (c.state !== 'active' || c.releasedCents !== 0) deny('delivery_not_permitted');
      db.run("UPDATE mission_upwork_work SET state='awaiting_manual_delivery',delivery_intent_at=?,version=version+1 WHERE id=?",[nowIso(),id]);
      event(id,'manual_delivery_intent',{contentHash:w.approved_hash});
      return {workId:id,content:String(w.content),contentHash:String(w.content_hash),instruction:'Owner submits through the legitimate Upwork UI once; reconcile evidence, never blindly resend.'};
    });
  }
  private validateDelivery(d: UpworkDelivery, w: Row, submissionId: string) {
    fresh(d); this.sameIdentity(d); const at = Date.parse(d.submittedAt);
    if (d.contractId !== w.contract_id || d.milestoneId !== w.milestone_id || d.clientId !== w.client_id || d.submissionId !== submissionId ||
        d.state !== 'submitted' || typeof d.content !== 'string' || Buffer.byteLength(d.content)>262144 || sha256(d.content) !== w.approved_hash ||
        w.approved_hash !== w.content_hash || sha256(String(w.content)) !== w.content_hash || !w.approved_by || !w.delivery_intent_at ||
        !Number.isFinite(at) || at < Date.parse(String(w.delivery_intent_at)) || at > Date.parse(d.verifiedAt)+1000) deny('delivery_unconfirmed');
  }
  private async delivery(w: Row, submissionId: string) {
    ref(submissionId); const d = await readUpworkProof(signal => this.source().delivery(String(w.contract_id),String(w.milestone_id),submissionId,signal));
    this.validateDelivery(d,w,submissionId); return d;
  }
  async confirmDelivery(actor: MoneyActor, id: string, submissionId: string) {
    assertMoneyOwner(actor); const w = this.work(id);
    if (!['awaiting_manual_delivery','delivered','provider_confirmed'].includes(String(w.state)) || (w.submission_id && w.submission_id !== submissionId)) deny('delivery_state_conflict');
    try {
      const a = await this.authority(actor), d = await this.delivery(w,submissionId);
      return db.transaction(() => {assertMoneyOwner(actor); this.permission(a); fresh(d); this.unchanged(w);
        if (w.state === 'awaiting_manual_delivery') db.run("UPDATE mission_upwork_work SET state='delivered',submission_id=?,version=version+1 WHERE id=?",[submissionId,id]);
        event(id,'delivery_verified',{submissionId,contentHash:w.approved_hash,proof:d.evidenceRef}); return this.work(id);
      });
    } catch {this.review(actor,id); return deny('delivery_unconfirmed');}
  }
  async observePayment(actor: MoneyActor, id: string) {
    assertMoneyOwner(actor); const w = this.work(id);
    try {
      if (!['delivered','provider_confirmed'].includes(String(w.state))) deny('delivered_work_required');
      const a = await this.authority(actor), c = await this.contract(String(w.contract_id),String(w.milestone_id),w);
      return db.transaction(() => {assertMoneyOwner(actor); this.permission(a); fresh(c); this.unchanged(w);
        if (c.releasedCents !== c.grossCents) deny('provider_payment_unconfirmed');
        if (w.state !== 'provider_confirmed') db.run("UPDATE mission_upwork_work SET state='provider_confirmed',version=version+1 WHERE id=?",[id]);
        event(id,'provider_payment_observed',c); return {workId:id,cashCredited:false};
      });
    } catch {this.review(actor,id); return deny('payment_unconfirmed');}
  }
  private review(actor: MoneyActor, id: string) {
    db.transaction(() => {assertMoneyOwner(actor); const p = db.get<Row>('SELECT * FROM mission_upwork_payouts WHERE work_id=?',[id]);
      if (!p?.net_cents) return;
      db.run("UPDATE mission_upwork_payouts SET state=CASE WHEN state='reversed' THEN state ELSE 'review' END WHERE work_id=?",[id]);
      ensureCashAccount(); freezeCash(actor,'treasury',true);
      const w = this.work(id), a = db.get<Row>('SELECT agent_id FROM mission_upwork_accounts WHERE account_id=?',[w.account_id]);
      if (a) freezeCash(actor,String(a.agent_id),true);
      event(id,'settlement_review',{debitAssumed:false});
    });
  }
  private validateRemittance(p: UpworkRemittance, w: Row, payoutId: string) {
    fresh(p); this.sameIdentity(p);
    if (p.payoutId !== payoutId || !['pending','paid'].includes(p.state) || p.complete !== true || p.currency !== 'USD' || !Array.isArray(p.lines) || p.lines.length !== 1) deny('remittance_incomplete');
    const l = p.lines[0];
    if (l.contractId !== w.contract_id || l.milestoneId !== w.milestone_id || l.currency !== 'USD' || cents(l.grossCents,true) !== Number(w.gross_cents) ||
        cents(l.feeCents)+cents(l.netCents,true) !== l.grossCents || cents(p.netCents,true) !== l.netCents) deny('remittance_mismatch');
    return sha256(JSON.stringify([p.accountId,p.tenantId,payoutId,l.contractId,l.milestoneId,l.currency,l.grossCents,l.feeCents,l.netCents]));
  }
  async observePayout(actor: MoneyActor, id: string, payoutId: string) {
    assertMoneyOwner(actor); ref(payoutId); const w = this.work(id);
    try {
      if (w.state !== 'provider_confirmed') deny('provider_confirmation_required');
      const a = await this.authority(actor), p = await readUpworkProof(signal => this.source().remittance(payoutId,signal));
      const fingerprint = this.validateRemittance(p,w,payoutId);
      return db.transaction(() => {assertMoneyOwner(actor); this.permission(a); fresh(p); this.unchanged(w);
        const old = db.get<Row>('SELECT * FROM mission_upwork_payouts WHERE payout_id=? OR work_id=?',[payoutId,id]);
        if (old && (old.work_id !== id || old.payout_id !== payoutId || old.remittance_hash !== fingerprint || (old.net_cents !== null && p.state !== 'paid'))) deny('payout_conflict');
        if (!old) db.run("INSERT INTO mission_upwork_payouts (payout_id,work_id,state,remittance_hash) VALUES (?,?,'observed',?)",[payoutId,id,fingerprint]);
        event(id,'payout_observed',{payoutId,fingerprint,state:p.state}); return {payoutId,state:p.state,cashCredited:false};
      });
    } catch {this.review(actor,id); return deny('payout_unconfirmed');}
  }
  private moneyProvider(verifyReceipt: MoneyProvider['verifyReceipt']): MoneyProvider {
    return {id:UPWORK_LEDGER_PROVIDER,supports:()=>false,verifyReceipt,pay:async()=>deny('outbound_forbidden'),lookup:async()=>deny('outbound_forbidden')};
  }
  async reconcile(actor: MoneyActor, id: string, payoutId: string, externalId: string) {
    assertMoneyOwner(actor); ref(payoutId); ref(externalId); const w = this.work(id);
    if (!this.receiver || !this.receiving) deny('independent_usd_receiver_not_configured');
    const receiver = this.receiver, receiving = this.receiving;
    try {
      if (w.state !== 'provider_confirmed' || !w.submission_id) deny('provider_confirmation_required');
      const a = await this.authority(actor), c = await this.contract(String(w.contract_id),String(w.milestone_id),w);
      if (c.releasedCents !== c.grossCents) deny('provider_payment_unconfirmed');
      const d = await this.delivery(w,String(w.submission_id));
      const p = await readUpworkProof(signal => this.source().remittance(payoutId,signal));
      const remittanceHash = this.validateRemittance(p,w,payoutId);
      if (p.state !== 'paid') deny('payout_not_paid');
      const r = await readUpworkProof(signal => receiver.verify({...this.identity!,payoutId,externalId},signal));
      fresh(r); this.sameIdentity(r);
      if (r.source !== 'upwork' || r.payoutId !== payoutId || r.externalId !== externalId || r.rail !== receiving.rail || r.receivingAccount !== receiving.receivingAccount ||
          r.state !== 'settled' || r.direction !== 'credit' || r.currency !== 'USD' || r.missionOwnershipVerified !== true ||
          cents(r.grossCents,true) !== p.netCents || cents(r.feeCents)+cents(r.netCents,true) !== r.grossCents) deny('settlement_unconfirmed');
      cents(r.availableBalanceCents);
      const receiptId = 'incoming:'+sha256(JSON.stringify([receiving.rail,receiving.receivingAccount,externalId]));
      const settlementHash = sha256(JSON.stringify([receiptId,payoutId,w.id,r.grossCents,r.feeCents,r.netCents]));
      const account = db.get<Row>('SELECT agent_id FROM mission_upwork_accounts WHERE account_id=?',[w.account_id]);
      if (!account) deny('account_missing');
      const finalAuthority = await this.authority(actor);
      const provider = this.moneyProvider(async()=>({externalId:receiptId,kind:'earning',amountCents:r.netCents,currency:'USD',agentId:String(account.agent_id),availableBalanceCents:r.availableBalanceCents}));
      return await verifyBoundMoneyReceipt(actor,provider,receiptId,() => {
        this.permission(a); this.permission(finalAuthority); fresh(c); fresh(d); fresh(p); fresh(r); this.unchanged(w);
        if (currentPolicy().currency !== 'USD') deny('usd_treasury_required');
        const old = db.get<Row>('SELECT * FROM mission_upwork_payouts WHERE payout_id=? OR work_id=?',[payoutId,id]);
        if (old && (old.work_id !== id || old.payout_id !== payoutId || old.remittance_hash !== remittanceHash || ['review','reversed'].includes(String(old.state)) || Number(old.reversed_cents) ||
            (old.receipt_id && (old.receipt_id !== receiptId || old.settlement_hash !== settlementHash)))) deny('settlement_conflict');
        const booked = Number(db.get<Row>("SELECT COALESCE(SUM(available_cents+held_cents),0) AS n FROM mission_cash_accounts WHERE currency='USD'")?.n);
        if (booked > r.availableBalanceCents) deny('receiving_balance_requires_review');
        if (!old) db.run("INSERT INTO mission_upwork_payouts (payout_id,work_id,state,remittance_hash) VALUES (?,?,'observed',?)",[payoutId,id,remittanceHash]);
        const jobId = 'uwcash_'+sha256(receiptId);
        if (!db.get('SELECT id FROM mission_earning_jobs WHERE id=?',[jobId])) db.run("INSERT INTO mission_earning_jobs (id,agent_id,opportunity_id,idempotency_key,state,provider_ref,created_at,updated_at) VALUES (?,?,?,?,'awaiting_payment',?,?,?)",[jobId,account.agent_id,w.opportunity_id,jobId,externalId,nowIso(),nowIso()]);
        db.run("UPDATE mission_upwork_payouts SET state='booked',receipt_id=?,rail=?,receiving_account=?,external_id=?,settlement_hash=?,net_cents=? WHERE payout_id=?",[receiptId,receiving.rail,receiving.receivingAccount,externalId,settlementHash,r.netCents,payoutId]);
        event(id,'independently_settled',{receiptId,settlementHash,remittanceHash});
        return db.get<Row>('SELECT * FROM mission_earning_jobs WHERE id=?',[jobId])!;
      });
    } catch {this.review(actor,id); return deny('settlement_blocked_or_uncertain');}
  }
  async reconcileReversal(actor: MoneyActor, id: string, reversalExternalId: string) {
    assertMoneyOwner(actor); ref(reversalExternalId); const w = this.work(id);
    const p = db.get<Row>('SELECT * FROM mission_upwork_payouts WHERE work_id=?',[id]);
    if (!p?.net_cents || !this.receiver || !this.receiving || p.external_id === reversalExternalId || p.rail !== this.receiving.rail || p.receiving_account !== this.receiving.receivingAccount) deny('original_settlement_required');
    const receiver = this.receiver;
    try {
      const r = await readUpworkProof(signal => receiver.reversal({...this.identity!,payoutId:String(p.payout_id),originalExternalId:String(p.external_id),reversalExternalId},signal));
      fresh(r); this.sameIdentity(r);
      if (r.source !== 'upwork' || r.payoutId !== p.payout_id || r.rail !== p.rail || r.receivingAccount !== p.receiving_account || r.originalExternalId !== p.external_id ||
          r.reversalExternalId !== reversalExternalId || r.state !== 'settled' || r.direction !== 'debit' || r.currency !== 'USD' || r.missionOwnershipVerified !== true) deny('reversal_unconfirmed');
      cents(r.amountCents,true);
      const receiptId = 'reversal:'+sha256(JSON.stringify([r.rail,r.receivingAccount,reversalExternalId]));
      const provider = this.moneyProvider(async()=>({externalId:receiptId,kind:'reversal',originalExternalId:String(p.receipt_id),amountCents:r.amountCents,currency:'USD'}));
      return await verifyBoundMoneyReceipt(actor,provider,receiptId,() => {
        fresh(r); this.unchanged(w); const current = db.get<Row>('SELECT * FROM mission_upwork_payouts WHERE work_id=?',[id])!;
        if (!db.get('SELECT external_id FROM mission_money_receipts WHERE provider=? AND external_id=?',[UPWORK_LEDGER_PROVIDER,receiptId])) {
          const reversed = cents(Number(current.reversed_cents)+r.amountCents,true);
          if (reversed > Number(current.net_cents) || current.receipt_id !== p.receipt_id) deny('reversal_exceeds_settlement');
          db.run('UPDATE mission_upwork_payouts SET state=?,reversed_cents=? WHERE work_id=?',[reversed===Number(current.net_cents)?'reversed':'review',reversed,id]);
          event(id,'independent_reversal',{receiptId,amountCents:r.amountCents});
        }
        return undefined;
      });
    } catch {this.review(actor,id); return deny('reversal_blocked_or_uncertain');}
  }
}
/** Deliberately no live proof adapters, credential flags, caller JSON or MoneyProvider registration. */
export function configuredUpworkWorkflow() { return new UpworkWorkflow(null); }
