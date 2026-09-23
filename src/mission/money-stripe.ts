/** Dedicated mission Stripe account only. No public AKBARAL key or database imports. */
import { MoneyError, cents, type MoneyProvider, type CashReceipt, type PaymentResult } from './money';
import { missionDb as db, type Row } from './database';

export class MissionStripe implements MoneyProvider {
  readonly id = 'stripe-mission';
  constructor(private key:string, private accountId:string, private transport:typeof fetch=fetch) {
    if (!/^sk_live_/.test(key)||!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new MoneyError('mission_live_provider_not_configured');
  }
  supports(kind:string):boolean { return kind==='withdrawal'; }
  private async request(path:string,body?:URLSearchParams,idempotencyKey?:string):Promise<any> {
    const response=await this.transport(`https://api.stripe.com/v1/${path}`,{
      method:body?'POST':'GET', redirect:'error', signal:AbortSignal.timeout(20000),
      headers:{Authorization:`Bearer ${this.key}`,'Stripe-Version':'2024-06-20',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:body?.toString(),
    });
    if(!response.ok||!response.body)throw new MoneyError('provider_response_unverified');
    const reader=response.body.getReader();let size=0;const parts:Uint8Array[]=[];
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>262144){await reader.cancel();throw new MoneyError('provider_response_too_large');}parts.push(chunk.value);}}finally{reader.releaseLock();}
    try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new MoneyError('invalid_provider_response');}
  }
  private async account() {
    const account=await this.request('account');
    if(account.id!==this.accountId||!account.charges_enabled||!account.payouts_enabled||!account.details_submitted||account.settings?.payouts?.schedule?.interval!=='manual')throw new MoneyError('mission_account_not_activated');
  }
  private async transaction(id:string) {
    if(!/^txn_[A-Za-z0-9]+$/.test(id))throw new MoneyError('invalid_transaction_id');
    const txn=await this.request(`balance_transactions/${id}`);
    if(txn.id!==id||txn.status!=='available'||!Number.isSafeInteger(txn.net)||txn.net===0||typeof txn.currency!=='string')throw new MoneyError('funds_not_available');
    return txn;
  }
  async verifyReceipt(externalId:string):Promise<CashReceipt> {
    await this.account();const txn=await this.transaction(externalId);
    if(txn.type==='charge'&&txn.net>0&&/^ch_[A-Za-z0-9]+$/.test(txn.source)) {
      const charge=await this.request(`charges/${txn.source}`);
      if(charge.balance_transaction!==txn.id||!charge.livemode||!charge.paid||!charge.captured||charge.refunded||charge.disputed||charge.amount_refunded!==0||charge.metadata?.mission!=='ZA141251SA'||!charge.metadata?.mission_agent_id)throw new MoneyError('mission_receipt_mismatch');
      const balance=await this.request('balance');
      const available=balance.available?.find((b:any)=>b.currency===txn.currency);
      const booked=Number(db.get<Row>('SELECT COALESCE(SUM(available_cents+held_cents),0) AS n FROM mission_cash_accounts WHERE currency=?',[txn.currency.toUpperCase()])?.n??0);
      const replay=!!db.get('SELECT external_id FROM mission_money_receipts WHERE provider=? AND external_id=?',[this.id,externalId]);
      const liability=Number(db.get<Row>('SELECT COALESCE(SUM(remaining_cents),0) AS n FROM mission_cash_liabilities WHERE provider=?',[this.id])?.n??0);
      if(!balance.livemode||!available||!Number.isSafeInteger(available.amount)||available.amount<booked+(replay?0:Math.max(0,txn.net-liability)))throw new MoneyError('provider_balance_requires_reconciliation');
      return {externalId,amountCents:txn.net,currency:txn.currency.toUpperCase(),kind:'earning',agentId:charge.metadata.mission_agent_id,availableBalanceCents:available.amount};
    }
    if(txn.type==='refund'&&txn.net<0&&/^re_[A-Za-z0-9]+$/.test(txn.source)) {
      const refund=await this.request(`refunds/${txn.source}`);
      if(refund.balance_transaction!==txn.id||refund.status!=='succeeded'||!/^ch_[A-Za-z0-9]+$/.test(refund.charge))throw new MoneyError('refund_unverified');
      const charge=await this.request(`charges/${refund.charge}`);
      if(!charge.livemode||charge.metadata?.mission!=='ZA141251SA')throw new MoneyError('mission_receipt_mismatch');
      return {externalId,amountCents:-txn.net,currency:txn.currency.toUpperCase(),kind:'reversal',originalExternalId:charge.balance_transaction};
    }
    if(txn.type==='payout_failure'&&txn.net>0&&/^po_[A-Za-z0-9]+$/.test(txn.source)) {
      const payout=await this.request(`payouts/${txn.source}`);
      if(!payout.livemode||payout.failure_balance_transaction!==txn.id||payout.status!=='failed'||payout.metadata?.mission!=='ZA141251SA'||!payout.metadata?.mission_operation)throw new MoneyError('payout_return_unverified');
      const op=db.get<Row>('SELECT * FROM mission_money_operations WHERE id=?',[payout.metadata.mission_operation]);
      if(!op||op.state!=='completed'||op.provider!==this.id||op.provider_ref!==payout.id)throw new MoneyError('payout_return_unverified');
      await this.result(payout,op);
      return {externalId,amountCents:txn.net,currency:txn.currency.toUpperCase(),kind:'refund',operationId:payout.metadata.mission_operation};
    }
    throw new MoneyError('unsupported_receipt_requires_reconciliation');
  }
  private async result(payout:any,op:Row):Promise<PaymentResult> {
    if(!payout.livemode||payout.metadata?.mission_operation!==op.id||payout.metadata?.mission!=='ZA141251SA'||payout.amount!==Number(op.amount_cents)||payout.currency!==String(op.currency).toLowerCase()||payout.destination!==op.destination||!/^po_[A-Za-z0-9]+$/.test(payout.id))throw new MoneyError('payout_receipt_mismatch');
    if(['failed','canceled'].includes(payout.status)) {
      // Failure alone is not proof that the reserved balance was returned.
      const reverse=await this.transaction(payout.failure_balance_transaction);
      if(reverse.net!==Number(op.amount_cents)||reverse.currency!==payout.currency||reverse.source!==payout.id||reverse.type!=='payout_failure')throw new MoneyError('failure_return_unverified');
      return {state:'failed',providerRef:payout.id};
    }
    if(payout.status==='paid') {
      const txn=await this.transaction(payout.balance_transaction);
      if(txn.source!==payout.id||txn.currency!==payout.currency||txn.net>=0||txn.type!=='payout')throw new MoneyError('payout_cost_unverified');
      return {state:'completed',providerRef:payout.id,actualCents:cents(-txn.net,true)};
    }
    if(!['pending','in_transit'].includes(payout.status))throw new MoneyError('payout_state_unverified');
    return {state:'pending',providerRef:payout.id};
  }
  async pay(op:Row,authorizeSend:()=>void):Promise<PaymentResult> {
    await this.account();
    if(!this.supports(String(op.kind))||!/^ba_[A-Za-z0-9]+$/.test(String(op.destination)))throw new MoneyError('unsupported_payout_destination');
    const destination=await this.request(`accounts/${this.accountId}/external_accounts/${op.destination}`);
    if(destination.id!==op.destination||destination.object!=='bank_account'||!['validated','verified'].includes(destination.status)||destination.currency!==String(op.currency).toLowerCase())throw new MoneyError('destination_not_verified');
    const balance=await this.request('balance');
    const available=balance.available?.find((b:any)=>b.currency===String(op.currency).toLowerCase());
    if(!balance.livemode||!available||!Number.isSafeInteger(available.amount)||available.amount<Number(op.max_cost_cents))throw new MoneyError('provider_funds_unavailable');
    const body=new URLSearchParams({amount:String(op.amount_cents),currency:String(op.currency).toLowerCase(),destination:String(op.destination),'metadata[mission]':'ZA141251SA','metadata[mission_operation]':String(op.id)});
    authorizeSend();
    return this.result(await this.request('payouts',body,`za141251sa:${op.id}`),op);
  }
  async lookup(op:Row):Promise<PaymentResult> {
    await this.account();
    if(op.provider_ref&&/^po_[A-Za-z0-9]+$/.test(String(op.provider_ref)))return this.result(await this.request(`payouts/${op.provider_ref}`),op);
    // Never retry a POST after an uncertain send. Search is bounded; absence is NOT failure.
    let after='';
    for(let page=0;page<10;page++){
      const list=await this.request(`payouts?limit=100${after?`&starting_after=${encodeURIComponent(after)}`:''}`);
      if(!Array.isArray(list.data))throw new MoneyError('invalid_provider_response');
      const matches=list.data.filter((p:any)=>p.metadata?.mission_operation===op.id);
      if(matches.length>1)throw new MoneyError('duplicate_provider_payments');
      if(matches.length===1)return this.result(matches[0],op);
      if(!list.has_more||!list.data.length)break;after=list.data[list.data.length-1].id;
    }
    throw new MoneyError('payout_uncertain_requires_provider_support');
  }
}
export function configuredMoneyProvider():MoneyProvider {
  // Dedicated credentials; never fall back to STRIPE_SECRET_KEY used by AKBARAL.
  return new MissionStripe(process.env.ZA141251SA_STRIPE_SECRET_KEY??'',process.env.ZA141251SA_STRIPE_ACCOUNT_ID??'');
}
