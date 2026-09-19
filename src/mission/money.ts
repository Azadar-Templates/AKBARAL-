/** Verified mission cash only. Never imports platform DB or trusts legacy balances. */
import { missionDb as db, missionId, nowIso, sha256, appendMissionAudit, type Row } from './database';
import { currentPolicy, checkActivity, setKillSwitch } from './policy';
import { destinationFingerprint, payoutSlotVerificationStatus } from './payout-verification';
import { isIdentityPermitted } from './identity-lock';

export type MoneyActor = { kind: 'owner' | 'agent'; id: string };
export class MoneyError extends Error {
  constructor(public code: string, message = code, public statusCode = 409) { super(message); }
}
function deny(code: string): never { throw new MoneyError(code); }
export function cents(n: number, positive = false): number {
  if (!Number.isSafeInteger(n) || n < (positive ? 1 : 0)) deny('invalid_minor_units');
  return n;
}
function text(s: string): string {
  if (typeof s !== 'string' || !s.trim() || s.length > 240) deny('invalid_identifier');
  return s;
}
function audit(action: string, actor: MoneyActor | null, id: string, detail: Record<string, unknown> = {}) {
  appendMissionAudit({ actorType: actor?.kind ?? 'provider', actorId: actor?.id ?? null, action: `money.${action}`, subjectType: 'verified_cash', subjectId: id, detail });
}
export function assertMoneyOwner(actor: MoneyActor): void {
  const owner = actor.kind === 'owner' && db.get<Row>("SELECT * FROM mission_owner WHERE id = ? AND role = 'owner' AND status = 'active'", [actor.id]);
  if (!owner || !isIdentityPermitted(String(owner.email))) deny('owner_required');
}
function running() { if (currentPolicy().killSwitch) deny('kill_switch_engaged'); }
export function cashAccount(id: string): Row {
  const account = db.get<Row>('SELECT * FROM mission_cash_accounts WHERE id = ?', [id]);
  if (!account) deny('cash_account_missing');
  return account;
}
export function ensureCashAccount(agentId?: string): Row {
  return db.transaction(() => {
    const id = agentId ?? 'treasury';
    if (agentId && !db.get('SELECT id FROM mission_agents WHERE id = ?', [agentId])) deny('agent_missing');
    const existing = db.get<Row>('SELECT * FROM mission_cash_accounts WHERE id = ?', [id]);
    if (existing) return existing;
    db.run('INSERT INTO mission_cash_accounts (id, agent_id, currency) VALUES (?, ?, ?)', [id, agentId ?? null, currentPolicy().currency]);
    audit('account_created', null, id);
    return cashAccount(id);
  });
}
function entry(accountId: string, bucket: 'available' | 'held', delta: number, reference: string) {
  if (!Number.isSafeInteger(delta) || delta === 0) deny('invalid_cash_delta');
  const account = cashAccount(accountId);
  const after = Number(account[`${bucket}_cents`]) + delta;
  cents(after);
  const last = db.get<Row>('SELECT seq, hash FROM mission_cash_entries ORDER BY seq DESC LIMIT 1');
  const row = { seq: Number(last?.seq ?? 0) + 1, id: missionId('cash'), accountId, bucket, delta, after, reference, prev: String(last?.hash ?? ''), at: nowIso() };
  const hash = sha256(JSON.stringify(row));
  db.run('INSERT INTO mission_cash_entries (seq,id,account_id,bucket,delta_cents,balance_after,reference,prev_hash,hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [row.seq,row.id,accountId,bucket,delta,after,reference,row.prev,hash,row.at]);
  db.run(`UPDATE mission_cash_accounts SET ${bucket}_cents = ? WHERE id = ?`, [after,accountId]);
}
function move(id: string, amount: number, reserve: boolean, ref: string) {
  if (!amount) return;
  entry(id, reserve ? 'available' : 'held', -amount, ref);
  entry(id, reserve ? 'held' : 'available', amount, ref);
}
export function verifyCashLedger(): { ok: boolean; rows: number } {
  let prev = ''; const balances = new Map<string, number>();
  const rows = db.all<Row>('SELECT * FROM mission_cash_entries ORDER BY seq');
  for (const [index,r] of rows.entries()) {
    const key = `${r.account_id}:${r.bucket}`, after = (balances.get(key) ?? 0) + Number(r.delta_cents);
    const row = { seq: Number(r.seq), id: String(r.id), accountId: String(r.account_id), bucket: String(r.bucket), delta: Number(r.delta_cents), after: Number(r.balance_after), reference: String(r.reference), prev: String(r.prev_hash), at: String(r.created_at) };
    if (row.seq !== index + 1 || row.prev !== prev || after !== row.after || after < 0 || !Number.isSafeInteger(after) || sha256(JSON.stringify(row)) !== r.hash) return { ok:false,rows:rows.length };
    balances.set(key, after); prev = String(r.hash);
  }
  for (const a of db.all<Row>('SELECT * FROM mission_cash_accounts')) {
    if (Number(a.available_cents) !== (balances.get(`${a.id}:available`) ?? 0) || Number(a.held_cents) !== (balances.get(`${a.id}:held`) ?? 0)) return {ok:false,rows:rows.length};
  }
  return {ok:true,rows:rows.length};
}
export function provisionMoneyAgent(agentId: string, ownerId: string, parentId?: string, delegatedCents = 0): Row {
  return db.transaction(() => {
    cents(delegatedCents);
    const prior = db.get<Row>('SELECT * FROM mission_money_grants WHERE agent_id = ?', [agentId]);
    if (prior) return prior;
    let expiry = new Date(Date.now()+365*86400000).toISOString();
    if (parentId) {
      running();
      if(!currentPolicy().autonomousEnabled)deny('autonomy_disabled');
      const parent = grant(parentId);
      if (!currentPolicy().allowAgentCreation || !Number(parent.can_create) || delegatedCents > Number(parent.delegation_cents)) deny('delegation_denied');
      const actual = db.get<Row>('SELECT parent_id FROM mission_agents WHERE id = ?', [agentId]);
      if (actual?.parent_id !== parentId) deny('invalid_parent');
      db.run('UPDATE mission_money_grants SET delegation_cents = delegation_cents - ? WHERE agent_id = ?', [delegatedCents,parentId]);
      expiry = String(parent.expires_at);
    }
    ensureCashAccount(agentId);
    db.run('INSERT INTO mission_money_grants (agent_id,parent_id,spend_limit_cents,expires_at,granted_by) VALUES (?,?,?,?,?)', [agentId,parentId ?? null,delegatedCents,expiry,ownerId]);
    if(parentId)db.run('UPDATE mission_money_grants SET opportunity_id=? WHERE agent_id=?',[grant(parentId).opportunity_id??null,agentId]);
    audit('agent_authorized', null, agentId, { parentId: parentId ?? null, spendLimitCents: delegatedCents, opportunity: 'blocked_until_assigned', canCreate: false });
    return db.get<Row>('SELECT * FROM mission_money_grants WHERE agent_id=?',[agentId])!;
  });
}
export function grant(id: string): Row {
  const seen = new Set<string>(); let cursor: string | null = id; let first: Row | undefined;
  while (cursor) {
    if (seen.has(cursor) || seen.size > 100) deny('invalid_ancestry');
    seen.add(cursor);
    const g: Row | undefined = db.get<Row>('SELECT * FROM mission_money_grants WHERE agent_id = ?', [cursor]);
    const a = db.get<Row>('SELECT status FROM mission_agents WHERE id = ?', [cursor]);
    if (!g || g.status !== 'active' || a?.status !== 'active' || !Number.isFinite(Date.parse(String(g.expires_at))) || Date.parse(String(g.expires_at)) <= Date.now()) deny('agent_authority_inactive');
    if (!first) first = g;
    cursor = g.parent_id ? String(g.parent_id) : null;
  }
  return first!;
}
export function bootstrapMoneyAgents(actor: MoneyActor): { agents: number; unassigned: number } {
  assertMoneyOwner(actor);
  return db.transaction(() => {
    ensureCashAccount();
    const agents = db.all<Row>('SELECT id FROM mission_agents');
    for (const a of agents) provisionMoneyAgent(String(a.id), actor.id);
    audit('fleet_provisioned', actor, 'fleet', { agents: agents.length });
    return { agents: agents.length, unassigned: Number(db.get<Row>('SELECT COUNT(*) AS n FROM mission_money_grants WHERE opportunity_id IS NULL')?.n ?? 0) };
  });
}
export function setMoneyGrant(actor: MoneyActor, agentId: string, input: { spendLimitCents: number; delegationCents: number; canCreate: boolean; expiresAt: string; status: 'active'|'revoked'; opportunityId?: string; autoAllocateCents?:number }): Row {
  assertMoneyOwner(actor); cents(input.spendLimitCents); cents(input.delegationCents); cents(input.autoAllocateCents??0);
  if((input.autoAllocateCents??0)>input.spendLimitCents)deny('allocation_exceeds_grant');
  if (!['active','revoked'].includes(input.status) || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) deny('invalid_grant');
  return db.transaction(() => {
    provisionMoneyAgent(agentId, actor.id);
    if (input.opportunityId) opportunity(input.opportunityId);
    db.run('UPDATE mission_money_grants SET spend_limit_cents=?, delegation_cents=?, can_create=?, expires_at=?, status=?, opportunity_id=?, granted_by=? WHERE agent_id=?', [input.spendLimitCents,input.delegationCents,input.canCreate ? 1:0,input.expiresAt,input.status,input.opportunityId ?? null,actor.id,agentId]);
    db.run('UPDATE mission_money_grants SET auto_allocate_cents=? WHERE agent_id=?',[input.autoAllocateCents??0,agentId]);
    audit('grant_updated', actor, agentId, input);
    return db.get<Row>('SELECT * FROM mission_money_grants WHERE agent_id=?',[agentId])!;
  });
}
export function approveOpportunity(actor: MoneyActor, input: {title:string; evidenceUrl:string; activity:string; provider:string}): Row {
  assertMoneyOwner(actor);
  let url: URL; try { url = new URL(input.evidenceUrl); } catch { deny('evidence_url_required'); }
  if (url!.protocol !== 'https:' || url!.username || url!.password || !checkActivity(input.activity,currentPolicy()).allowed) deny('opportunity_policy_denied');
  text(input.title); text(input.provider);
  return db.transaction(() => {
    const id = missionId('opp');
    db.run('INSERT INTO mission_money_opportunities (id,title,evidence_url,activity,provider,approved_by,created_at) VALUES (?,?,?,?,?,?,?)',[id,input.title,input.evidenceUrl,input.activity,input.provider,actor.id,nowIso()]);
    audit('opportunity_owner_reviewed',actor,id,{evidenceUrl:input.evidenceUrl, activity:input.activity});
    return opportunity(id);
  });
}
function opportunity(id:string): Row {
  const row = db.get<Row>("SELECT * FROM mission_money_opportunities WHERE id=? AND status='approved'",[id]);
  if (!row || !checkActivity(String(row.activity),currentPolicy()).allowed) deny('opportunity_unavailable');
  return row;
}
function authorize(actor:MoneyActor, agentId:string) {
  if (actor.kind === 'owner') assertMoneyOwner(actor);
  else if (actor.id !== agentId || !currentPolicy().autonomousEnabled) deny('agent_forbidden');
  grant(agentId); running();
}
export function allocateCash(actor:MoneyActor, agentId:string, amount:number, key:string): Row {
  assertMoneyOwner(actor); cents(amount,true); text(key);
  return db.transaction(() => {
    const fp=sha256(JSON.stringify([agentId,amount]));
    const old=db.get<Row>('SELECT fingerprint FROM mission_money_transfers WHERE idempotency_key=?',[key]);
    if(old) { if(old.fingerprint!==fp) deny('idempotency_conflict'); return cashAccount(agentId); }
    running(); grant(agentId); const source=ensureCashAccount(), target=ensureCashAccount(agentId);
    if(Number(source.frozen)||Number(target.frozen)||source.currency!==target.currency) deny('cash_account_unavailable');
    entry('treasury','available',-amount,`allocation:${key}`); entry(agentId,'available',amount,`allocation:${key}`);
    db.run('INSERT INTO mission_money_transfers VALUES (?,?,?)',[key,fp,nowIso()]);
    audit('allocated',actor,agentId,{amountCents:amount}); return cashAccount(agentId);
  });
}
export function freezeCash(actor:MoneyActor,id:string,frozen:boolean) {
  assertMoneyOwner(actor);
  if (!frozen && Number(db.get<Row>('SELECT COALESCE(SUM(remaining_cents),0) AS n FROM mission_cash_liabilities')?.n)) deny('unresolved_provider_liability');
  return db.transaction(()=> {cashAccount(id);db.run('UPDATE mission_cash_accounts SET frozen=? WHERE id=?',[frozen?1:0,id]); audit('freeze_changed',actor,id,{frozen});});
}
export interface CashReceipt { externalId:string; amountCents:number; currency:string; kind:'earning'|'refund'|'reversal'; agentId?:string; operationId?:string; originalExternalId?:string; availableBalanceCents?:number }
export interface PaymentResult { state:'pending'|'completed'|'failed'; providerRef:string; actualCents?:number }
/** Implementations are trusted server-side code, never HTTP request objects or arbitrary URLs. */
export interface MoneyProvider {
  id:string;
  verifyReceipt(externalId:string):Promise<CashReceipt>;
  supports(kind:string,category:string):boolean;
  pay(operation:Row, authorizeSend:()=>void):Promise<PaymentResult>;
  lookup(operation:Row):Promise<PaymentResult>;
}
function acceptReceipt(provider:MoneyProvider,receipt:CashReceipt) {
  cents(receipt.amountCents,true); text(receipt.externalId);
  return db.transaction(()=> {
    const fp=sha256(JSON.stringify([receipt.externalId,receipt.amountCents,receipt.currency,receipt.kind,receipt.agentId??null,receipt.operationId??null,receipt.originalExternalId??null]));
    const old=db.get<Row>('SELECT * FROM mission_money_receipts WHERE provider=? AND external_id=?',[provider.id,receipt.externalId]);
    if(old){ if(old.fingerprint!==fp && old.fingerprint!==sha256(JSON.stringify(Object.fromEntries(Object.entries(receipt).filter(([key])=>key!=='availableBalanceCents'))))) deny('receipt_conflict');return {duplicated:true}; }
    const treasury=ensureCashAccount();
    if(receipt.currency!==treasury.currency) deny('currency_mismatch');
    if(receipt.availableBalanceCents!==undefined && receipt.kind==='earning') {
      cents(receipt.availableBalanceCents);
      const booked=Number(db.get<Row>('SELECT COALESCE(SUM(available_cents+held_cents),0) AS n FROM mission_cash_accounts WHERE currency=?',[receipt.currency])?.n??0);
      const liability=Number(db.get<Row>('SELECT COALESCE(SUM(remaining_cents),0) AS n FROM mission_cash_liabilities WHERE provider=?',[provider.id])?.n??0);
      if(booked+Math.max(0,receipt.amountCents-liability)>receipt.availableBalanceCents)deny('provider_balance_requires_reconciliation');
    }
    if(receipt.kind==='earning') {
      if(!receipt.agentId) deny('earning_agent_missing');
      // Revocation cannot erase cash already earned; identity + prior assignment still required.
      const g=db.get<Row>('SELECT * FROM mission_money_grants WHERE agent_id=?',[receipt.agentId]);
      if(!g?.opportunity_id) deny('earning_opportunity_missing');
      const op=db.get<Row>('SELECT provider FROM mission_money_opportunities WHERE id=?',[String(g.opportunity_id)]);
      if(op?.provider!==provider.id) deny('earning_provider_mismatch');
      ensureCashAccount(receipt.agentId);
      entry(receipt.agentId,'available',receipt.amountCents,receipt.externalId);
      entry(receipt.agentId,'available',-receipt.amountCents,receipt.externalId);
      entry('treasury','available',receipt.amountCents,receipt.externalId);
    } else if(receipt.kind==='refund') {
      const op=moneyOperation(receipt.operationId ?? '');
      if(op.provider!==provider.id || op.currency!==receipt.currency || op.state!=='completed' || Number(op.refunded_cents)+receipt.amountCents>Number(op.actual_cents)) deny('invalid_refund');
      entry(String(op.account_id),'available',receipt.amountCents,receipt.externalId);
      db.run('UPDATE mission_money_operations SET refunded_cents=refunded_cents+? WHERE id=?',[receipt.amountCents,String(op.id)]);
    } else if(receipt.kind==='reversal') {
      const original=db.get<Row>("SELECT * FROM mission_money_receipts WHERE provider=? AND external_id=? AND kind='earning'",[provider.id,receipt.originalExternalId??'']);
      if(!original) deny('original_receipt_missing');
      let remaining=receipt.amountCents;
      // Only unreserved cash can be clawed back locally. Unknown external payments stay held.
      for(const a of db.all<Row>('SELECT * FROM mission_cash_accounts ORDER BY id')) {
        const take=Math.min(remaining,Number(a.available_cents));
        if(take){entry(String(a.id),'available',-take,receipt.externalId);remaining-=take;}
      }
      db.run('INSERT INTO mission_cash_liabilities VALUES (?,?,?)',[provider.id,receipt.externalId,remaining]);
      db.run('UPDATE mission_cash_accounts SET frozen=1');
      setKillSwitch(true,'provider-reversal');
    } else deny('receipt_kind_unsupported');
    db.run('INSERT INTO mission_money_receipts VALUES (?,?,?,?,?,?,?,?)',[provider.id,receipt.externalId,fp,receipt.kind,receipt.amountCents,receipt.agentId ?? null,receipt.operationId ?? null,nowIso()]);
    // Incoming cash first services confirmed provider liabilities, never invents solvency.
    if(receipt.kind==='earning'||receipt.kind==='refund') {
      const target=receipt.kind==='earning'?'treasury':String(moneyOperation(receipt.operationId!).account_id);
      for(const liability of db.all<Row>('SELECT * FROM mission_cash_liabilities WHERE provider=? AND remaining_cents>0 ORDER BY external_id',[provider.id])) {
        const take=Math.min(Number(cashAccount(target).available_cents),Number(liability.remaining_cents));
        if(take){entry(target,'available',-take,`liability:${liability.external_id}`);db.run('UPDATE mission_cash_liabilities SET remaining_cents=remaining_cents-? WHERE provider=? AND external_id=?',[take,String(liability.provider),String(liability.external_id)]);}
      }
    }
    audit('provider_receipt_verified',null,receipt.externalId,{provider:provider.id,kind:receipt.kind,amountCents:receipt.amountCents});
    return {duplicated:false};
  });
}
export async function verifyMoneyReceipt(actor:MoneyActor,provider:MoneyProvider,externalId:string) {
  assertMoneyOwner(actor);text(externalId);
  const receipt=await provider.verifyReceipt(externalId);
  if(receipt.externalId!==externalId) deny('receipt_identity_mismatch');
  return acceptReceipt(provider,receipt);
}
export function moneyOperation(id:string):Row {
  const op=db.get<Row>('SELECT * FROM mission_money_operations WHERE id=?',[id]);
  if(!op) deny('money_operation_missing');return op;
}
const categories=['api','tool','hosting','storage','account','property','upgrade'];
function capacity(op:Row,excludeId?:string) {
  if(!verifyCashLedger().ok) deny('cash_integrity_failed');
  if(op.kind==='withdrawal') {
    const slot=db.get<Row>('SELECT * FROM mission_payout_slots WHERE provider_ref=?',[String(op.destination)]);
    if(!slot||!payoutSlotVerificationStatus(Number(slot.slot)).payable||slot.currency!==op.currency)deny('verified_owner_destination_required');
    if(op.destination_hash && op.destination_hash!==destinationFingerprint(slot))deny('destination_changed');
  }
  running();const p=currentPolicy(),account=cashAccount(String(op.account_id));
  if(Number(account.frozen)||account.currency!==op.currency||p.currency!==op.currency) deny('cash_account_unavailable');
  const cost=Number(op.max_cost_cents);
  const all=db.all<Row>("SELECT * FROM mission_money_operations WHERE state IN ('reserved','dispatching','pending','unknown','completed')");
  const day=nowIso().slice(0,10);
  const counted=all.filter(r=>r.id!==excludeId);
  const daily=counted.reduce((n,r)=>n+(r.state==='completed'?(String(r.completed_at).slice(0,10)===day?Number(r.actual_cents):0):Number(r.max_cost_cents)),0);
  if(daily+cost>p.maxDailySpendCents || cost>(op.kind==='withdrawal'?p.maxPayoutCents:p.maxExpenseCents)) deny('spending_limit');
  if(op.kind==='expense') {
    const g=grant(String(op.agent_id));
    const exposure=counted.filter(r=>r.agent_id===op.agent_id).reduce((n,r)=>n+Number(r.state==='completed'?r.actual_cents:r.max_cost_cents),0);
    if(exposure+cost>Number(g.spend_limit_cents)) deny('agent_spending_limit');
  }
}
export function requestMoney(actor:MoneyActor,input:{kind:'expense'|'withdrawal';agentId?:string;provider:string;destination:string;category:string;amountCents:number;maxCostCents:number;idempotencyKey:string}):Row {
  cents(input.amountCents,true);cents(input.maxCostCents,true);
  if(input.maxCostCents<input.amountCents)deny('invalid_cost_ceiling');
  text(input.provider);text(input.destination);text(input.idempotencyKey);
  if(input.kind==='withdrawal')assertMoneyOwner(actor);
  else if(input.kind==='expense'&&input.agentId&&categories.includes(input.category))authorize(actor,input.agentId);
  else deny('invalid_operation');
  return db.transaction(()=> {
    const fp=sha256(JSON.stringify([input.kind,input.agentId??null,input.provider,input.destination,input.category,input.amountCents,input.maxCostCents]));
    const old=db.get<Row>('SELECT * FROM mission_money_operations WHERE idempotency_key=?',[input.idempotencyKey]);
    if(old){if(old.fingerprint!==fp)deny('idempotency_conflict');return old;}
    const account=ensureCashAccount(input.kind==='expense'?input.agentId:undefined);
    const op:Row={id:missionId('pay'),kind:input.kind,account_id:account.id,agent_id:input.agentId??null,provider:input.provider,destination:input.destination,category:input.category,amount_cents:input.amountCents,max_cost_cents:input.maxCostCents,currency:account.currency};
    if(op.kind==='withdrawal') {
      const slot=db.get<Row>('SELECT * FROM mission_payout_slots WHERE provider_ref=?',[input.destination]);
      if(!slot)deny('verified_owner_destination_required');op.destination_hash=destinationFingerprint(slot);
    }
    capacity(op);
    if(Number(account.available_cents)<input.maxCostCents)deny('insufficient_real_funds');
    const state=input.kind==='withdrawal'||['account','property','upgrade'].includes(input.category)||input.maxCostCents>=currentPolicy().requireApprovalAboveCents?'approval_required':'reserved';
    db.run('INSERT INTO mission_money_operations (id,idempotency_key,fingerprint,kind,account_id,agent_id,provider,destination,category,amount_cents,max_cost_cents,currency,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[String(op.id),input.idempotencyKey,fp,input.kind,String(account.id),input.agentId??null,input.provider,input.destination,input.category,input.amountCents,input.maxCostCents,String(account.currency),state,nowIso(),nowIso()]);
    if(op.destination_hash)db.run('UPDATE mission_money_operations SET destination_hash=? WHERE id=?',[String(op.destination_hash),String(op.id)]);
    if(state==='reserved')move(String(account.id),input.maxCostCents,true,String(op.id));
    audit('requested',actor,String(op.id),{state,amountCents:input.amountCents,maxCostCents:input.maxCostCents});return moneyOperation(String(op.id));
  });
}
export function decideMoney(actor:MoneyActor,id:string,approve:boolean):Row {
  assertMoneyOwner(actor);
  return db.transaction(()=> {
    const op=moneyOperation(id);
    if(op.state!=='approval_required')deny('invalid_operation_state');
    if(approve){capacity(op);move(String(op.account_id),Number(op.max_cost_cents),true,id);}
    db.run('UPDATE mission_money_operations SET state=?, approved_by=?,updated_at=? WHERE id=?',[approve?'reserved':'rejected',actor.id,nowIso(),id]);
    audit(approve?'approved':'rejected',actor,id);return moneyOperation(id);
  });
}
function settle(provider:MoneyProvider,id:string,result:PaymentResult):Row {
  text(result.providerRef);
  return db.transaction(()=> {
    const op=moneyOperation(id);
    if(op.provider!==provider.id)deny('provider_mismatch');
    if(op.provider_ref&&op.provider_ref!==result.providerRef)deny('provider_reference_changed');
    if(['completed','failed'].includes(String(op.state))) {
      if(op.state!==result.state || (result.state==='completed'&&Number(op.actual_cents)!==result.actualCents))deny('terminal_receipt_conflict');
      return op;
    }
    if(!['dispatching','pending','unknown'].includes(String(op.state)))deny('invalid_operation_state');
    if(!['pending','completed','failed'].includes(result.state))deny('invalid_provider_state');
    if(result.state==='completed') {
      cents(result.actualCents!,true);
      if(result.actualCents!<Number(op.amount_cents)||result.actualCents!>Number(op.max_cost_cents))deny('provider_cost_outside_reservation');
      entry(String(op.account_id),'held',-result.actualCents!,id);
      move(String(op.account_id),Number(op.max_cost_cents)-result.actualCents!,false,id);
    } else if(result.state==='failed')move(String(op.account_id),Number(op.max_cost_cents),false,id);
    db.run('UPDATE mission_money_operations SET state=?,provider_ref=?,actual_cents=?,completed_at=?,updated_at=? WHERE id=?',[result.state,result.providerRef,result.actualCents??null,result.state==='completed'?nowIso():null,nowIso(),id]);
    audit('provider_payment_verified',null,id,{state:result.state,providerRef:result.providerRef});return moneyOperation(id);
  });
}
export async function dispatchMoney(actor:MoneyActor,provider:MoneyProvider,id:string, automatic=false):Promise<Row> {
  const op=db.transaction(()=> {
    const op=moneyOperation(id);
    if(actor.kind==='owner')assertMoneyOwner(actor);else authorize(actor,String(op.agent_id));
    if(op.provider!==provider.id||!provider.supports(String(op.kind),String(op.category)))deny('provider_not_configured_for_operation');
    if(op.state!=='reserved')deny('dispatch_not_retryable_reconcile_only');
    capacity(op,id);
    if((op.kind==='withdrawal'||['account','property','upgrade'].includes(String(op.category))||Number(op.max_cost_cents)>=currentPolicy().requireApprovalAboveCents)&&!op.approved_by)deny('owner_approval_required');
    db.run("UPDATE mission_money_operations SET state='dispatching',updated_at=? WHERE id=?",[nowIso(),id]);
    audit('dispatch_claimed',actor,id);return moneyOperation(id);
  });
  try {return settle(provider,id,await provider.pay(op,()=>db.transaction(()=>{
    if(automatic&&!currentPolicy().autonomousEnabled)deny('autonomy_disabled');
    if(actor.kind==='owner')assertMoneyOwner(actor);else authorize(actor,String(op.agent_id));
    const current=moneyOperation(id);if(current.state!=='dispatching')deny('dispatch_authority_changed');
    capacity(current,id);
  })));}
  catch {
    // Transport/parse/settlement failure never means the provider did not pay.
    db.transaction(()=>{db.run("UPDATE mission_money_operations SET state='unknown',updated_at=? WHERE id=? AND state='dispatching'",[nowIso(),id]);audit('payment_uncertain',null,id);});
    return moneyOperation(id);
  }
}
export async function reconcileMoney(actor:MoneyActor,provider:MoneyProvider,id:string):Promise<Row> {
  assertMoneyOwner(actor);const op=moneyOperation(id);
  if(op.provider!==provider.id)deny('provider_mismatch');
  // Reconciliation remains allowed during freezes: it records reality, never sends money.
  return settle(provider,id,await provider.lookup(op));
}
export function moneyOverview() {
  return { accounting:'provider_verified_cash_only', legacyBalancesImported:false, providerConnectionStatus:'requires_live_connection_check',
    accounts:db.all<Row>('SELECT * FROM mission_cash_accounts ORDER BY id'),
    operations:db.all<Row>('SELECT * FROM mission_money_operations ORDER BY created_at DESC LIMIT 200'),
    grants:db.all<Row>('SELECT * FROM mission_money_grants ORDER BY agent_id'),
    opportunities:db.all<Row>('SELECT * FROM mission_money_opportunities ORDER BY created_at DESC'),
    jobs:db.all<Row>('SELECT * FROM mission_earning_jobs ORDER BY updated_at DESC LIMIT 200'),
    readiness:{liveConnectionTested:false,earningConnectorConfigured:false,vendorPaymentConnectorConfigured:false,withdrawalAdapter:'stripe-mission',blocked:['live_connection_not_tested','earning_connector_not_configured','vendor_payment_connector_not_configured','real_opportunity_assignments_require_owner_review']},
    liabilities:db.all<Row>('SELECT * FROM mission_cash_liabilities'), ledger:verifyCashLedger(), killSwitch:currentPolicy().killSwitch };
}


/** An earning adapter must execute a real owner-approved job, not synthesize a receipt. */
export interface EarningProvider {
  id: string;
  execute(job: Row, opportunity: Row, signal: AbortSignal, authorizeExecute:()=>void): Promise<{ paymentReference: string }>;
  lookup(job: Row, opportunity: Row): Promise<{ paymentReference: string }>;
}
export function queueEarning(actor: MoneyActor, agentId: string, key: string, costOperationId?: string): Row {
  text(key);
  return db.transaction(() => {
    authorize(actor,agentId); const g=grant(agentId);
    if(!g.opportunity_id)deny('blocked_no_real_opportunity');
    const opp=opportunity(String(g.opportunity_id));
    const old=db.get<Row>('SELECT * FROM mission_earning_jobs WHERE idempotency_key=?',[key]);
    if(old){if(old.agent_id!==agentId||old.opportunity_id!==opp.id||(old.cost_operation_id??null)!==(costOperationId??null))deny('idempotency_conflict');return old;}
    if(costOperationId){const cost=moneyOperation(costOperationId);if(cost.agent_id!==agentId||cost.kind!=='expense'||cost.state!=='completed')deny('verified_work_funding_required');}
    const id=missionId('earn');
    db.run('INSERT INTO mission_earning_jobs (id,agent_id,opportunity_id,idempotency_key,created_at,updated_at,cost_operation_id) VALUES (?,?,?,?,?,?,?)',[id,agentId,String(opp.id),key,nowIso(),nowIso(),costOperationId??null]);
    audit('earning_queued',actor,id,{agentId,opportunityId:opp.id});return db.get<Row>('SELECT * FROM mission_earning_jobs WHERE id=?',[id])!;
  });
}
export async function runEarning(actor:MoneyActor,earning:EarningProvider,payments:MoneyProvider,id:string,reconcile=false,automatic=false):Promise<Row> {
  const job=db.transaction(()=>{
    const job=db.get<Row>('SELECT * FROM mission_earning_jobs WHERE id=?',[id]);if(!job)deny('earning_job_missing');
    if(reconcile)assertMoneyOwner(actor);else authorize(actor,String(job.agent_id));
    const opp=reconcile?db.get<Row>('SELECT * FROM mission_money_opportunities WHERE id=?',[job.opportunity_id]):opportunity(String(job.opportunity_id));
    if(!opp||opp.provider!==earning.id||opp.provider!==payments.id)deny('earning_provider_not_configured');
    if(!reconcile&&job.state!=='queued')deny('earning_requires_reconciliation');
    if(job.state==='completed')return job;
    if(!reconcile){db.run("UPDATE mission_earning_jobs SET state='running',updated_at=? WHERE id=?",[nowIso(),id]);audit('earning_claimed',actor,id);}
    return job;
  });
  if(job.state==='completed')return job;
  try {
    // Revocation stops new execution, not read-only verification of already delivered work.
    const opp=db.get<Row>('SELECT * FROM mission_money_opportunities WHERE id=?',[job.opportunity_id])!;
    const authorizeExecute=()=>db.transaction(()=>{
      if(signal.aborted)deny('earning_timeout');
      authorize(actor,String(job.agent_id));opportunity(String(job.opportunity_id));
      if(automatic&&!currentPolicy().autonomousEnabled)deny('autonomy_disabled');
      if(Number(cashAccount(String(job.agent_id)).frozen))deny('cash_account_unavailable');
      const live=db.get<Row>('SELECT * FROM mission_earning_jobs WHERE id=?',[id])!;
      if(live.state!=='running')deny('earning_requires_reconciliation');
    });
    const signal=AbortSignal.timeout(60000);
    let abort:()=>void=()=>{};
    const timeout=new Promise<never>((_,reject)=>{abort=()=>reject(new MoneyError('earning_timeout'));signal.addEventListener('abort',abort,{once:true});});
    let result:{paymentReference:string};
    try {
      if(!reconcile)authorizeExecute();
      result=await Promise.race([reconcile?earning.lookup(job,opp):earning.execute(job,opp,signal,authorizeExecute),timeout]);
    } finally {signal.removeEventListener('abort',abort);}
    text(result.paymentReference);
    db.transaction(()=>{
      const live=db.get<Row>('SELECT * FROM mission_earning_jobs WHERE id=?',[id])!;
      if(live.provider_ref&&live.provider_ref!==result.paymentReference)deny('earning_reference_changed');
      if(live.state==='completed')return;
      db.run("UPDATE mission_earning_jobs SET state='awaiting_payment',provider_ref=?,updated_at=? WHERE id=?",[result.paymentReference,nowIso(),id]);audit('earning_delivered',actor,id);
    });
    const receipt=await payments.verifyReceipt(result.paymentReference);
    if(receipt.externalId!==result.paymentReference||receipt.kind!=='earning'||receipt.agentId!==job.agent_id)deny('earning_receipt_mismatch');
    db.transaction(()=>{
      if(db.get<Row>('SELECT state FROM mission_earning_jobs WHERE id=?',[id])?.state==='completed')return;
      const prior=db.get<Row>('SELECT * FROM mission_money_receipts WHERE provider=? AND external_id=?',[payments.id,receipt.externalId]);
      if(prior?.operation_id&&prior.operation_id!==id)deny('earning_receipt_already_assigned');
      acceptReceipt(payments,receipt);
      db.run('UPDATE mission_money_receipts SET operation_id=? WHERE provider=? AND external_id=?',[id,payments.id,receipt.externalId]);
      db.run("UPDATE mission_earning_jobs SET state='completed',updated_at=? WHERE id=?",[nowIso(),id]);audit('earning_verified',null,id);
    });
  } catch {
    db.transaction(()=>{db.run("UPDATE mission_earning_jobs SET state='unknown',updated_at=? WHERE id=? AND state='running'",[nowIso(),id]);db.run('UPDATE mission_earning_jobs SET updated_at=? WHERE id=? AND state<>?',[nowIso(),id,'completed']);audit('earning_waiting_for_verification',null,id);});
  }
  return db.get<Row>('SELECT * FROM mission_earning_jobs WHERE id=?',[id])!;
}
/** One bounded scheduler tick. No connector means blocked, never invented work/payments. */
export async function moneyWorkerTick(actor:MoneyActor,providers:MoneyProvider[],earningProviders:EarningProvider[]) {
  assertMoneyOwner(actor);
  // Read-only provider reconciliation continues even while execution is frozen.
  for(const pending of db.all<Row>("SELECT * FROM mission_money_operations WHERE state IN ('dispatching','pending','unknown') ORDER BY updated_at,id LIMIT 20")) {
    const p=providers.find(p=>p.id===pending.provider);
    db.transaction(()=>db.run('UPDATE mission_money_operations SET updated_at=? WHERE id=?',[nowIso(),pending.id]));
    if(p){try{await reconcileMoney(actor,p,String(pending.id));}catch{/* Held; never retry POST on uncertainty. */}}
  }
  for(const job of db.all<Row>("SELECT j.*,o.provider FROM mission_earning_jobs j JOIN mission_money_opportunities o ON o.id=j.opportunity_id WHERE j.state IN ('running','unknown','awaiting_payment') ORDER BY j.updated_at,j.id LIMIT 20")) {
    db.transaction(()=>db.run('UPDATE mission_earning_jobs SET updated_at=? WHERE id=?',[nowIso(),job.id]));
    const earning=earningProviders.find(p=>p.id===job.provider),payments=providers.find(p=>p.id===job.provider);
    if(earning&&payments){try{await runEarning(actor,earning,payments,String(job.id),true);}catch{/* No repeat delivery on uncertainty. */}}
  }
  if(currentPolicy().killSwitch||!currentPolicy().autonomousEnabled)return {blocked:'policy_disabled'};
  for(const g of db.all<Row>("SELECT * FROM mission_money_grants WHERE status='active' AND auto_allocate_cents>0 ORDER BY agent_id")) {
    try{db.transaction(()=>{
      const id=String(g.agent_id);grant(id);const account=cashAccount(id),treasury=ensureCashAccount();
      const spent=Number(db.get<Row>("SELECT COALESCE(SUM(actual_cents),0) AS n FROM mission_money_operations WHERE agent_id=? AND state='completed'",[id])?.n??0);
      const held=Number(account.held_cents),available=Number(account.available_cents);
      const amount=Math.min(Number(g.auto_allocate_cents)-available-held,Number(g.spend_limit_cents)-spent-available-held,Number(treasury.available_cents));
      if(amount>0)allocateCash(actor,id,amount,missionId('autoalloc'));
    });}catch{/* Revoked/frozen/exhausted agents receive no allocation. */}
  }
  for(const op of db.all<Row>("SELECT * FROM mission_money_operations WHERE state='reserved' ORDER BY updated_at,id LIMIT 20")) {
    const p=providers.find(p=>p.id===op.provider&&p.supports(String(op.kind),String(op.category)));
    db.transaction(()=>db.run('UPDATE mission_money_operations SET updated_at=? WHERE id=?',[nowIso(),op.id]));
    if(p){try{await dispatchMoney(actor,p,String(op.id),true);break;}catch{/* Other eligible agents must not be starved by a blocked reservation. */}}
  }
  let blocked:string|null=null;
  for(const job of db.all<Row>("SELECT * FROM mission_earning_jobs WHERE state='queued' ORDER BY updated_at,id LIMIT 20")) {
    db.transaction(()=>db.run('UPDATE mission_earning_jobs SET updated_at=? WHERE id=?',[nowIso(),job.id]));
    try {
      const opp=opportunity(String(job.opportunity_id)),earning=earningProviders.find(p=>p.id===opp.provider),payments=providers.find(p=>p.id===opp.provider);
      if(earning&&payments){await runEarning(actor,earning,payments,String(job.id),false,true);return {blocked:null};}
      blocked='earning_connector_not_configured';
    }catch{blocked='earning_authority_unavailable';}
  }
  return {blocked};
}

export function cancelMoney(actor:MoneyActor,id:string):Row {
  assertMoneyOwner(actor);
  return db.transaction(()=>{
    const op=moneyOperation(id);
    if(!['reserved','approval_required'].includes(String(op.state)))deny('cannot_cancel_dispatched_payment');
    if(op.state==='reserved')move(String(op.account_id),Number(op.max_cost_cents),false,id);
    db.run("UPDATE mission_money_operations SET state='rejected',updated_at=? WHERE id=?",[nowIso(),id]);
    audit('cancelled_before_dispatch',actor,id);return moneyOperation(id);
  });
}
export function listCashEntries(after=0,limit=200,accountId?:string):Row[] {
  if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)deny('invalid_pagination');
  return db.all<Row>(`SELECT * FROM mission_cash_entries WHERE seq>?${accountId?' AND account_id=?':''} ORDER BY seq LIMIT ?`,[after,...(accountId?[accountId]:[]),limit]);
}

export function revokeOpportunity(actor:MoneyActor,id:string):Row {
  assertMoneyOwner(actor);
  return db.transaction(()=>{
    const opp=db.get<Row>('SELECT * FROM mission_money_opportunities WHERE id=?',[id]);if(!opp)deny('opportunity_missing');
    db.run("UPDATE mission_money_opportunities SET status='revoked' WHERE id=?",[id]);audit('opportunity_revoked',actor,id);
    return {...opp,status:'revoked'};
  });
}
export function agentMoneyOverview(agentId:string) {
  return {
    accounting:'provider_verified_cash_only',
    account:db.get<Row>('SELECT * FROM mission_cash_accounts WHERE agent_id=?',[agentId])??null,
    grant:db.get<Row>('SELECT * FROM mission_money_grants WHERE agent_id=?',[agentId])??null,
    operations:db.all<Row>('SELECT * FROM mission_money_operations WHERE agent_id=? ORDER BY created_at DESC LIMIT 200',[agentId]),
    jobs:db.all<Row>('SELECT * FROM mission_earning_jobs WHERE agent_id=? ORDER BY created_at DESC LIMIT 200',[agentId]),
    killSwitch:currentPolicy().killSwitch,
  };
}
export function listMoneyOperations(after='',limit=200,agentId?:string):Row[] {
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000||typeof after!=='string'||after.length>240)deny('invalid_pagination');
  return db.all<Row>(`SELECT * FROM mission_money_operations WHERE id>?${agentId?' AND agent_id=?':''} ORDER BY id LIMIT ?`,[after,...(agentId?[agentId]:[]),limit]);
}
