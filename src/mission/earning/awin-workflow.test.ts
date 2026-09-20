/** Synthetic provider fixtures only. Disposable DB; no production money, property, or API. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = process.env.PG_TEST_DATABASE_URL || `file:${path.join(os.tmpdir(), `awin-workflow-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'fixture-only-awin-session-not-live';
import { before, beforeEach, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { AwinPublisherClient } from './awin';
import type { AwinPublishingProvider, AwinSettlementProvider, AwinSettlementProof, PublicationProof, PropertyProof } from './awin-contracts';
const { applyMissionMigrations, missionDb: db } = require('../database') as typeof import('../database');
const { AwinWorkflow } = require('./awin-workflow') as typeof import('./awin-workflow');
const m = require('../money') as typeof import('../money');
const { updatePolicy, setKillSwitch } = require('../policy') as typeof import('../policy');
import type { Row } from '../database';
const owner = { kind: 'owner' as const, id: 'fixture-owner' }, agent = 'fixture-agent', other = 'fixture-other';
let status = 'pending', paid = false, amount = 5, paymentId = 77, currentJob = '', allowed = true, disappear = false;
let publications = 0, receiveCalls = 0, failPublish = false, badPublication = false;
let property: PropertyProof, receipt: PublicationProof | null, settlementProof: AwinSettlementProof;
let publisher: AwinPublishingProvider, receiver: AwinSettlementProvider, client: AwinPublisherClient, w: InstanceType<typeof AwinWorkflow>;
let beforePublish: (() => void) | undefined;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
function api(publisherId = '1') {
  return new AwinPublisherClient({ publisherId, accessToken: `fixture-only-${randomUUID()}` }, { fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/programmes')) return json([{ id: 2, name: 'Fixture programme, no real work', status: 'active' }]);
    if (url.pathname.endsWith('/programmedetails')) return json({ programmeInfo: { id: 2, membershipStatus: allowed ? 'Joined' : 'Suspended', deeplinkEnabled: true, validDomains: [{ domain: 'shop.example' }] } });
    if (url.pathname.endsWith('/linkbuilder/generate')) {
      const body = JSON.parse(String(init!.body)); currentJob = body.parameters.clickref;
      return json({ url: `https://www.awin1.com/cread.php?awinaffid=${publisherId}&awinmid=2&clickref=${currentJob}` });
    }
    if (url.pathname.endsWith('/transactions')) return json(disappear ? [] : [{ id: 3, publisherId: Number(publisherId), advertiserId: 2, commissionStatus: status,
      commissionAmount: { amount, currency: 'USD' }, clickRefs: { clickRef: currentJob }, paidToPublisher: paid, paymentId: paid ? paymentId : 0 }]);
    assert.fail('unsupported fixture endpoint');
  } });
}
const tables = ['mission_awin_evidence','mission_awin_api_requests','mission_awin_api_cooldown','mission_awin_events','mission_awin_commissions','mission_awin_publications','mission_awin_assignments','mission_awin_opportunities','mission_awin_payouts','mission_earning_jobs','mission_money_receipts','mission_cash_liabilities','mission_cash_entries','mission_money_transfers','mission_money_operations','mission_money_grants','mission_money_opportunities','mission_cash_accounts'];
before(() => {
  applyMissionMigrations();
  db.run("INSERT INTO mission_owner (id,email,password_hash,role,status) VALUES (?,'fixture-owner@example.test','fixture','owner','active')", [owner.id]);
  for (const id of [agent, other]) db.run("INSERT INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform) VALUES (?,?,'Fixture agent','specialist',0,'custom','active','worker','fixture')", [id,id]);
});
beforeEach(() => {
  setKillSwitch(false, owner.id);
  for (const table of tables) db.run(`DELETE FROM ${table}`);
  updatePolicy({ killSwitch: false, autonomousEnabled: true, currency: 'USD', maxDailySpendCents: 100000, maxExpenseCents: 10000, requireApprovalAboveCents: 500 }, owner.id);
  for (const id of [agent, other]) m.setMoneyGrant(owner, id, { spendLimitCents: 10000, delegationCents: 0, canCreate: false, expiresAt: new Date(Date.now()+86400000).toISOString(), status: 'active' });
  status='pending'; paid=false; amount=5; paymentId=77; currentJob=''; allowed=true; disappear=false;
  publications=0; receiveCalls=0; failPublish=false; badPublication=false; beforePublish=undefined; receipt=null;
  property = { propertyKey: 'https://publisher.example', publisherId: '1', permitted: true, incrementalCostCents: 0, evidenceRef: 'fixture-property-permission', expiresAt: new Date(Date.now()+3600000).toISOString() };
  publisher = { propertyKey: property.propertyKey, verifyProperty: async () => ({ ...property }), publish: async (document, authorize) => {
    beforePublish?.(); authorize(); publications++;
    receipt = { key: document.key, propertyKey: property.propertyKey, externalId: 'fixture-post-1', url: 'https://publisher.example/post', contentHash: document.contentHash, state: 'published' };
    if (badPublication) receipt.contentHash = 'wrong';
    if (failPublish) throw Error('fixture connection lost after remote publication');
    return { ...receipt };
  }, lookup: async () => receipt ? { ...receipt } : null };
  settlementProof = { rail: 'fixture-bank', receivingAccount: 'fixture-mission-account', externalId: 'fixture-transfer', publisherId: '1', paymentId: '77', state: 'settled', currency: 'USD', netCents: 450, availableBalanceCents: 100000,
    lines: [{ transactionId: '3', grossCents: 500, feeCents: 50, netCents: 450, currency: 'USD' }] };
  receiver = { rail: 'fixture-bank', receivingAccount: 'fixture-mission-account', verify: async () => { receiveCalls++; return structuredClone(settlementProof); }, verifyReversal: async input => ({ rail: 'fixture-bank', receivingAccount: 'fixture-mission-account', ...input, state: 'settled', amountCents: 450, currency: 'USD' }) };
  client = api(); w = new AwinWorkflow(client, publisher, receiver);
});
after(() => db.close());
async function assigned() {
  const leads = await w.discover(owner);
  assert.equal(leads[0].state, 'discovered');
  return w.assign(owner, { agentId: agent, opportunityId: String(leads[0].id), destinationUrl: 'https://shop.example/item' });
}
async function prepared() {
  const a = await assigned();
  const j = w.draft(owner, String(a.id), { key: 'fixture-key', title: 'Owner title', body: '<script>not executable</script> useful original text' });
  return w.prepare(owner, String(j.id));
}
async function published() {
  const j = await prepared(); w.approvePublication(owner, String(j.id), String(j.content_hash));
  return w.publish(owner, String(j.id));
}
async function paidJob() {
  const j = await published(); status='approved'; paid=true;
  await w.sync(owner, String(j.id), ['3']); return j;
}
function balance() { return Number(m.ensureCashAccount().available_cents); }
function commission() { return db.get<Row>('SELECT * FROM mission_awin_commissions WHERE transaction_id=?', ['3'])!; }

it('missing credentials, publishing and settlement providers are explicitly BLOCKED', async () => {
  const missing = new AwinWorkflow(null);
  assert.deepEqual(missing.overview(owner).blocked, ['credentials','property_not_configured','settlement_not_configured']);
  await assert.rejects(missing.discover(owner), /blocked_credentials/);
  const noProperty = new AwinWorkflow(client); const leads = await noProperty.discover(owner);
  await assert.rejects(noProperty.assign(owner, { agentId: agent, opportunityId: String(leads[0].id), destinationUrl: 'https://shop.example/item' }), /property_not_configured/);
  await assert.rejects(noProperty.reconcilePayout(owner, '77', 'fixture-transfer'), /settlement_not_configured/);
  assert.equal(balance(), 0);
});
it('agent callers cannot authorize discovery, assignments, publishing or settlement', async () => {
  const actor = { kind: 'agent' as const, id: agent };
  assert.throws(() => w.overview(actor), /owner_required/);
  await assert.rejects(w.discover(actor), /owner_required/);
  await assert.rejects(w.assign(actor, { agentId: agent, opportunityId: 'missing', destinationUrl: 'https://shop.example' }), /owner_required/);
  await assert.rejects(w.reconcilePayout(actor, '77', 'fixture-transfer'), /owner_required/);
});
it('requires active authority, joined advertiser and verified/permitted property', async () => {
  await w.discover(owner);
  const input = { agentId: agent, opportunityId: 'awin_1_2', destinationUrl: 'https://shop.example/item' };
  allowed=false; await assert.rejects(w.assign(owner,input), /not_eligible/); allowed=true;
  property.permitted=false; await assert.rejects(w.assign(owner,input), /property_unverified/); property.permitted=true;
  property.expiresAt=new Date(Date.now()-1000).toISOString(); await assert.rejects(w.assign(owner,input), /property_unverified/);
  property.expiresAt=new Date(Date.now()+3600000).toISOString();
  db.run("UPDATE mission_money_grants SET status='revoked' WHERE agent_id=?", [agent]);
  await assert.rejects(w.assign(owner,input), /authority_inactive/);
  assert.equal(db.all('SELECT * FROM mission_awin_assignments').length, 0);
});
it('durable exclusivity covers agent, account, property, opportunity and revoked tombstones', async () => {
  const a = await assigned(); const input = { agentId: other, opportunityId: 'awin_1_2', destinationUrl: 'https://shop.example/item' };
  const restarted = new AwinWorkflow(api(), publisher, receiver);
  await assert.rejects(restarted.assign(owner,input), /exclusive_assignment/);
  w.revoke(owner, String(a.id));
  await assert.rejects(restarted.assign(owner,input), /exclusive_assignment/);
  assert.throws(() => db.transaction(() => db.run('INSERT INTO mission_awin_assignments SELECT ?,?,publisher_id,property_key,opportunity_id,money_opportunity_id,destination_url,state,property_evidence,verified_until,approved_by,created_at FROM mission_awin_assignments WHERE id=?', ['duplicate',other,a.id])));
  assert.throws(() => w.draft(owner,String(a.id),{ key:'x',title:'x',body:'x' }), /assignment_blocked/);
});
it('simultaneous competing claims leave one exclusive assignment', async () => {
  await w.discover(owner);
  const outcomes = await Promise.allSettled([agent,other].map(agentId => w.assign(owner,{agentId,opportunityId:'awin_1_2',destinationUrl:'https://shop.example/item'})));
  assert.equal(outcomes.filter(r => r.status==='fulfilled').length,1);
  assert.equal(db.all('SELECT * FROM mission_awin_assignments').length,1);
});
it('immutable drafts are idempotent and contain escaped content plus affiliate disclosure', async () => {
  const j = await prepared();
  assert.match(String(j.content_html), /&lt;script&gt;/); assert.match(String(j.content_html), /Disclosure:/);
  assert.equal(w.draft(owner,String(j.assignment_id),{key:'fixture-key',title:'Owner title',body:'<script>not executable</script> useful original text'}).id,j.id);
  assert.throws(()=>w.draft(owner,String(j.assignment_id),{key:'fixture-key',title:'changed',body:'changed'}),/idempotency_conflict/);
  assert.equal(balance(),0);
});
it('owner approves the exact content hash and an approved link is not publication', async () => {
  const j = await prepared();
  await assert.rejects(w.publish(owner,String(j.id)),/approval_required/);
  assert.throws(()=>w.approvePublication(owner,String(j.id),'wrong'),/content_mismatch/);
  w.approvePublication(owner,String(j.id),String(j.content_hash));
  assert.equal(publications,0); assert.equal(balance(),0);
  await assert.rejects(w.sync(owner,String(j.id),['3']),/publication_unconfirmed/);
});
it('checks property and advertiser again before publication and freeze just before external mutation', async () => {
  const j=await prepared();w.approvePublication(owner,String(j.id),String(j.content_hash));
  allowed=false;await assert.rejects(w.publish(owner,String(j.id)),/not_eligible/);allowed=true;
  property.permitted=false;await assert.rejects(w.publish(owner,String(j.id)),/property_unverified/);property.permitted=true;
  beforePublish=()=>setKillSwitch(true,owner.id);
  assert.equal((await w.publish(owner,String(j.id))).state,'unknown_publish');assert.equal(publications,0);
});
it('uncertain publication is reconciled read-only, including after revocation/freeze; never resubmitted', async () => {
  failPublish=true;const j=await published();assert.equal(j.state,'unknown_publish');assert.equal(publications,1);
  await assert.rejects(w.publish(owner,String(j.id)),/approval_required/);
  w.revoke(owner,String(j.assignment_id));setKillSwitch(true,owner.id);
  assert.equal((await w.reconcilePublication(owner,String(j.id))).state,'published');assert.equal(publications,1);
});
it('absent or mismatched publication proof cannot advance to conversion', async () => {
  badPublication=true;const j=await published();assert.equal(j.state,'unknown_publish');
  await assert.rejects(w.reconcilePublication(owner,String(j.id)),/identity_mismatch/);
  receipt=null;await assert.rejects(w.reconcilePublication(owner,String(j.id)),/publication_unconfirmed/);
  await assert.rejects(w.sync(owner,String(j.id),['3']),/publication_unconfirmed/);assert.equal(balance(),0);
});
it('simultaneous publication claims make exactly one external POST', async () => {
  const j=await prepared();w.approvePublication(owner,String(j.id),String(j.content_hash));
  const results=await Promise.allSettled([w.publish(owner,String(j.id)),w.publish(owner,String(j.id))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(publications,1);
});
it('covers discovered → eligible → published → conversion → approved → paid → confirmed → eligible without early cash', async () => {
  const j=await published();assert.equal(j.state,'published');assert.equal(balance(),0);
  await w.sync(owner,String(j.id),['3']);assert.equal(commission().state,'conversion');assert.equal(balance(),0);
  status='approved';await w.sync(owner,String(j.id),['3']);assert.equal(commission().state,'approved');assert.equal(balance(),0);
  paid=true;await w.sync(owner,String(j.id),['3']);assert.equal(commission().state,'paid');assert.equal(balance(),0);
  assert.equal((await w.reconcilePayout(owner,'77','fixture-transfer')).duplicated,false);
  assert.equal(commission().state,'mission_cash_eligible');assert.equal(balance(),450);assert.equal(m.verifyCashLedger().ok,true);
  assert.equal(db.get<Row>('SELECT state FROM mission_earning_jobs')!.state,'completed');
  const states=db.all<Row>('SELECT state FROM mission_awin_events').map(r=>r.state);
  for (const state of ['discovered','eligible','published','conversion','approved','paid','provider_confirmed','mission_cash_eligible']) assert.ok(states.includes(state),state);
});
it('duplicate and concurrent settlement checks credit the net batch exactly once', async () => {
  await paidJob();const result=await Promise.all([w.reconcilePayout(owner,'77','fixture-transfer'),w.reconcilePayout(owner,'77','fixture-transfer')]);
  assert.equal(result.filter(r=>!r.duplicated).length,1);assert.equal(balance(),450);
  assert.equal((await w.reconcilePayout(owner,'77','fixture-transfer')).duplicated,true);assert.equal(balance(),450);
  assert.equal(db.all('SELECT * FROM mission_money_receipts').length,1);
});
it('no cash from pending bank movements or network uncertainty; later read-only reconciliation is safe', async () => {
  await paidJob();settlementProof.state='pending';
  await assert.rejects(w.reconcilePayout(owner,'77','fixture-transfer'),/blocked_or_uncertain/);assert.equal(balance(),0);
  assert.equal(db.get<Row>('SELECT state FROM mission_awin_payouts')!.state,'unknown');
  settlementProof.state='settled';await w.reconcilePayout(owner,'77','fixture-transfer');assert.equal(balance(),450);assert.equal(receiveCalls,2);
});
it('never credits pending, declined, deleted or stale/missing Awin transactions', async () => {
  const j=await paidJob();status='declined';paid=false;
  await assert.rejects(w.reconcilePayout(owner,'77','fixture-transfer'),/blocked_or_uncertain/);assert.equal(balance(),0);assert.equal(commission().state,'rejected');
  status='approved';paid=true;await w.sync(owner,String(j.id),['3']);disappear=true;
  await assert.rejects(w.reconcilePayout(owner,'77','fixture-transfer'),/blocked_or_uncertain/);assert.equal(balance(),0);assert.equal(commission().state,'settlement_review');
});
it('wrong bank, account, movement, publisher, payment, currency, amount or itemization never credits', async () => {
  await paidJob();const original=structuredClone(settlementProof);
  const patches: Array<Partial<AwinSettlementProof>>=[{rail:'other'},{receivingAccount:'customer-account'},{externalId:'wrong'},{publisherId:'9'},{paymentId:'99'},
    {currency:'EUR'},{netCents:451},{availableBalanceCents:449},{lines:[]},{lines:[original.lines[0],original.lines[0]]},{lines:[{...original.lines[0],grossCents:501}]},
    {lines:[{...original.lines[0],transactionId:'9'}]}];
  for(const patch of patches){
    // Fresh client resets only fixture request budget; never resets persistent evidence or cash.
    w=new AwinWorkflow(api(),publisher,receiver);settlementProof={...structuredClone(original),...patch};
    await assert.rejects(w.reconcilePayout(owner,'77','fixture-transfer'));assert.equal(balance(),0);
    assert.equal(db.all('SELECT * FROM mission_money_receipts').length,0);
    assert.equal(commission().state,'paid');
  }
});
it('binding conflicts do not permit a second receiving movement for the same payout', async () => {
  await paidJob();await w.reconcilePayout(owner,'77','fixture-transfer');
  await assert.rejects(w.reconcilePayout(owner,'77','another-transfer'),/binding_conflict/);assert.equal(balance(),450);
});
it('an altered post-credit commission freezes all mission cash instead of fabricating a reversal', async () => {
  const j=await paidJob();await w.reconcilePayout(owner,'77','fixture-transfer');amount=4;
  await w.sync(owner,String(j.id),['3']);assert.equal(commission().state,'settlement_review');assert.equal(balance(),450);
  assert.ok(db.all<Row>('SELECT frozen FROM mission_cash_accounts').every(r=>Number(r.frozen)===1));
  assert.equal(db.all('SELECT * FROM mission_money_receipts').length,1);
});
it('provider-confirmed reversal is bounded and duplicate-safe, using the existing cash ledger', async () => {
  await paidJob();await w.reconcilePayout(owner,'77','fixture-transfer');
  await w.reconcileReversal(owner,'77','fixture-reversal');assert.equal(balance(),0);assert.equal(commission().state,'reversed');
  assert.equal((await w.reconcileReversal(owner,'77','fixture-reversal')).duplicated,true);
  await assert.rejects(w.reconcileReversal(owner,'77','another-reversal'),/exceeds_settlement/);
  assert.equal(balance(),0);assert.equal(m.verifyCashLedger().ok,true);
});
it('reversal of reserved cash creates a liability, never overdrafts or releases uncertain holds', async () => {
  await paidJob();await w.reconcilePayout(owner,'77','fixture-transfer');m.allocateCash(owner,agent,450,'fixture-allocation');
  const expense=m.requestMoney({kind:'agent',id:agent},{kind:'expense',agentId:agent,provider:'fixture-only',destination:'fixture-vendor',category:'hosting',amountCents:450,maxCostCents:450,idempotencyKey:'fixture-expense'});
  assert.equal(expense.state,'reserved');await w.reconcileReversal(owner,'77','fixture-reversal');
  assert.equal(Number(m.cashAccount(agent).held_cents),450);assert.equal(Number(m.cashAccount(agent).available_cents),0);
  assert.equal(Number(db.get<Row>('SELECT remaining_cents FROM mission_cash_liabilities')!.remaining_cents),450);
  assert.equal(m.verifyCashLedger().ok,true);
});
it('reconciliation records historically earned cash even after agent revocation and kill switch', async () => {
  const j=await paidJob();w.revoke(owner,String(j.assignment_id));db.run("UPDATE mission_money_grants SET status='revoked' WHERE agent_id=?",[agent]);setKillSwitch(true,owner.id);
  await w.reconcilePayout(owner,'77','fixture-transfer');assert.equal(balance(),450);
  await assert.rejects(w.publish(owner,String(j.id)));assert.equal(publications,1);
});
it('date-window conversion discovery records only provider evidence and cannot infer disappearance', async () => {
  const j=await published();const result=await w.scan(owner,String(j.id),'2026-09-01T00:00:00Z','2026-09-20T00:00:00Z');
  assert.equal(result.observed,1);assert.equal(commission().state,'conversion');assert.equal(balance(),0);
  disappear=true;await w.scan(owner,String(j.id),'2026-09-01T00:00:00Z','2026-09-20T00:00:00Z');assert.equal(commission().state,'conversion');
  await assert.rejects(w.scan(owner,String(j.id),'2026-01-01T00:00:00Z','2026-09-20T00:00:00Z'),/invalid_date_window/);
});

it('expired property verification blocks drafts and can only be refreshed with fresh provider permission', async () => {
  const a=await assigned();db.run('UPDATE mission_awin_assignments SET verified_until=? WHERE id=?',[new Date(Date.now()-1000).toISOString(),a.id]);
  assert.throws(()=>w.draft(owner,String(a.id),{key:'expire',title:'title',body:'body'}),/assignment_blocked/);
  property.permitted=false;await assert.rejects(w.refreshAssignment(owner,String(a.id)),/property_unverified/);
  property.permitted=true;await w.refreshAssignment(owner,String(a.id));
  assert.equal(w.draft(owner,String(a.id),{key:'expire',title:'title',body:'body'}).state,'eligible');
});
it('same property or agent cannot be assigned through another publisher identity', async () => {
  await assigned();const second=new AwinWorkflow(api('2'),publisher,receiver);await second.discover(owner);property.publisherId='2';
  await assert.rejects(second.assign(owner,{agentId:other,opportunityId:'awin_2_2',destinationUrl:'https://shop.example/item'}),/exclusive_assignment/);
  property.propertyKey='https://second.example';publisher={...publisher,propertyKey:property.propertyKey};
  const third=new AwinWorkflow(api('2'),publisher,receiver);
  await assert.rejects(third.assign(owner,{agentId:agent,opportunityId:'awin_2_2',destinationUrl:'https://shop.example/item'}),/exclusive_assignment/);
});
it('a changed settlement after credit freezes cash and cannot alter the existing receipt', async () => {
  await paidJob();await w.reconcilePayout(owner,'77','fixture-transfer');
  settlementProof.netCents=400;settlementProof.lines[0].netCents=400;settlementProof.lines[0].feeCents=100;
  await assert.rejects(w.reconcilePayout(owner,'77','fixture-transfer'),/blocked_or_uncertain/);
  assert.equal(balance(),450);assert.equal(Number(m.cashAccount('treasury').frozen),1);
  assert.equal(db.all('SELECT * FROM mission_money_receipts').length,1);
});
it('partial reversals are bounded cumulatively and idempotent', async () => {
  await paidJob();await w.reconcilePayout(owner,'77','fixture-transfer');
  const verify=receiver.verifyReversal;receiver.verifyReversal=async input=>({...await verify(input),amountCents:200});
  await w.reconcileReversal(owner,'77','partial-1');assert.equal(balance(),250);
  await w.reconcileReversal(owner,'77','partial-1');assert.equal(balance(),250);
  await w.reconcileReversal(owner,'77','partial-2');assert.equal(balance(),50);
  await assert.rejects(w.reconcileReversal(owner,'77','partial-3'),/exceeds_settlement/);
  assert.equal(balance(),50);assert.equal(commission().state,'settlement_review');
});
it('read failures cannot be promoted to confirmed payouts', async () => {
  await paidJob();receiver.verify=async()=>{throw Error('fixture network failure with secret body');};
  await assert.rejects(w.reconcilePayout(owner,'77','fixture-transfer'),{message:'awin_settlement_blocked_or_uncertain'});
  assert.equal(balance(),0);assert.equal(db.all('SELECT * FROM mission_money_receipts').length,0);
});
it('production request budget and 429 cooldown persist across client/worker recreation', () => {
  const {reserveAwinRequest,recordAwinCooldown}=require('./awin-workflow') as typeof import('./awin-workflow');
  for(let i=0;i<20;i++)reserveAwinRequest();assert.throws(()=>reserveAwinRequest(),/rate_limited/);
  db.run('UPDATE mission_awin_api_requests SET started_at=?',[new Date(Date.now()-61000).toISOString()]);reserveAwinRequest();
  recordAwinCooldown(120000);assert.throws(()=>reserveAwinRequest(),/rate_limited/);
  recordAwinCooldown(60000);assert.ok(Date.parse(String(db.get<Row>('SELECT until_at FROM mission_awin_api_cooldown')!.until_at))-Date.now()>110000);
});
it('cash receipt bridge rolls back workflow transitions on insufficient independently confirmed balance', async () => {
  await paidJob();settlementProof.availableBalanceCents=449;
  await assert.rejects(w.reconcilePayout(owner,'77','fixture-transfer'));assert.equal(balance(),0);
  assert.equal(commission().state,'paid');assert.equal(db.all('SELECT * FROM mission_earning_jobs').length,0);
  assert.equal(db.all("SELECT * FROM mission_awin_events WHERE state='mission_cash_eligible'").length,0);
});

it('unbounded or paid publishing capacity is blocked instead of bypassing spending controls', async () => {
  property.incrementalCostCents=1;await assert.rejects(assigned(),/property_unverified/);
  assert.equal(publications,0);assert.equal(balance(),0);
});
it('event order and evidence versions preserve the actual observed lifecycle', async () => {
  const j=await published();await w.sync(owner,String(j.id),['3']);status='approved';paid=true;await w.sync(owner,String(j.id),['3']);
  await w.reconcilePayout(owner,'77','fixture-transfer');
  const states=db.all<Row>('SELECT state FROM mission_awin_events ORDER BY seq').map(r=>r.state);
  assert.ok(states.indexOf('provider_confirmed')>states.indexOf('paid'));
  assert.ok(states.indexOf('mission_cash_eligible')>states.indexOf('provider_confirmed'));
  assert.equal(db.all('SELECT * FROM mission_awin_evidence').length,2);
  assert.equal(require('../database').verifyMissionAudit().ok,true);
});
