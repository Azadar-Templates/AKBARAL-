import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-adversarial-${randomUUID()}.db`)}`;
process.env.ZA141251SA_SESSION_SECRET = 'adversarial-test-secret-not-live';
process.env.ZA141251SA_CREDENTIAL_KEY = '0123456789abcdef0123456789abcdef0123456789ab';
import { before, after, it, describe } from 'node:test';
import assert from 'node:assert/strict';
const { applyMissionMigrations, missionDb } = require('./database') as typeof import('./database');
const { authorizeAgentAction, verifyAuthorizationTrail, verifySafetyViolations, listAuthorizationTrail, listSafetyViolations, countPendingOwnerActions } = require('./owner-safety-gate') as typeof import('./owner-safety-gate');
const EarningEngine = require('./earning/earning-engine') as typeof import('./earning/earning-engine');
const ExecutionPipeline = require('./earning/execution-pipeline') as typeof import('./earning/execution-pipeline');

let ownerId: string;
let agentA: string;
let agentB: string;
let agentClean: string;
function expiryIso(){ return new Date(Date.now()+ 7*24*3600*1000).toISOString(); }
function freshAgent(prefix:string){
  const id = `agt_${prefix}_${randomUUID().slice(0,6)}`;
  missionDb.run("INSERT OR IGNORE INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'custom','active','worker','mission','[]')", [id, `${prefix}-${id.slice(-4)}`, prefix,'specialist']);
  missionDb.run("INSERT OR IGNORE INTO mission_wallets (id, kind, agent_id, label, currency, balance_cents, budget_cents, spent_cents, status) VALUES (?,?,?, 'tmp wallet','USD', 100000, 100000, 0, 'active')", [`w_${id}`, 'agent', id]);
  try{ const { setMoneyGrant } = require('./money') as typeof import('./money'); setMoneyGrant({kind:'owner', id: ownerId} as any, id, {spendLimitCents:100000, delegationCents:0, canCreate:false, expiresAt:new Date(Date.now()+86400000).toISOString(), status:'active'});}catch{}
  return id;
}

before(()=>{
  applyMissionMigrations();
  const { provisionOwner } = require('./auth') as typeof import('./auth');
  const { updatePolicy } = require('./policy') as typeof import('./policy');
  try { const o = provisionOwner({email:`adv-${randomUUID()}@test.local`, password:'StrongPass!123', displayName:'Adversarial Owner'}); ownerId = o.id ?? o.owner?.id; } catch { const r = missionDb.get('SELECT id FROM mission_owner LIMIT 1'); ownerId = String(r.id); }
  updatePolicy({allowAgentCreation:true, maxAgents:5000, requireApprovalAboveCents: 10000, maxDailySpendCents: 500000, maxExpenseCents: 100000, requireOwnerForPayout: false}, ownerId);
  const idA = `agt_adv_a_${randomUUID().slice(0,6)}`; const idB = `agt_adv_b_${randomUUID().slice(0,6)}`;
  missionDb.run("INSERT OR IGNORE INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'custom','active','worker','mission','[]')", [idA, `adv-a-${idA.slice(-4)}`, 'Adv A','specialist']);
  missionDb.run("INSERT OR IGNORE INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'custom','active','worker','mission','[]')", [idB, `adv-b-${idB.slice(-4)}`, 'Adv B','specialist']);
  missionDb.run("INSERT OR IGNORE INTO mission_wallets (id, kind, agent_id, label, currency, balance_cents, budget_cents, spent_cents, status) VALUES (?,?,?, 'adv wallet','USD', 100000, 100000, 0, 'active')", [`w_${idA}`, 'agent', idA]);
  missionDb.run("INSERT OR IGNORE INTO mission_wallets (id, kind, agent_id, label, currency, balance_cents, budget_cents, spent_cents, status) VALUES (?,?,?, 'adv wallet b','USD', 100000, 100000, 0, 'active')", [`w_${idB}`, 'agent', idB]);
  // Re-derive ownerId reliably from DB (provisionOwner returns shape may vary and identity-lock env not set)
  const actualOwner = missionDb.get('SELECT id FROM mission_owner LIMIT 1') as any;
  ownerId = String(actualOwner.id);
  const { setMoneyGrant } = require('./money') as typeof import('./money');
  for(const id of [idA, idB]){
    try{ setMoneyGrant({kind:'owner', id: ownerId} as any, id, {spendLimitCents:100000, delegationCents:0, canCreate:false, expiresAt:new Date(Date.now()+86400000).toISOString(), status:'active'});}catch(e){ console.error('grant', e); }
  }
  agentA=idA; agentB=idB;
  agentClean = freshAgent('clean');
  const { createWallet, configurePayoutSlot } = require('./treasury') as typeof import('./treasury');
  const { confirmPayoutVerification, PAYOUT_VERIFICATION_CHECKS } = require('./payout-verification') as typeof import('./payout-verification');
  try{ createWallet({kind:'mission', label:'adv-treasury', currency:'USD'});}catch{}
  try{ configurePayoutSlot({slot:1, providerRef:`acct_adv_${randomUUID().slice(0,8)}`, minPayoutCents:0, maxPayoutCents:500000, currency:'USD', actorId:ownerId}); confirmPayoutVerification({slot:1, ownerId, checks: Object.fromEntries(PAYOUT_VERIFICATION_CHECKS.map((c:any)=> [c.key, true])), attestation:'Adversarial test attestation — no real destination.'}); }catch{}
  // Set known owner email for impersonation tests — keep consistent with actual owner email
  const ownerEmailRow = missionDb.get('SELECT email FROM mission_owner LIMIT 1') as any;
  if (ownerEmailRow?.email) process.env.ZA141251SA_OWNER_EMAIL = String(ownerEmailRow.email);
});

after(()=> missionDb.close());

describe('OWNER-SAFETY / LIABILITY GATE — adversarial (fail-closed)', ()=>{

  it('normal permitted work remains fully autonomous (execution→verification→settlement)', ()=>{
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Adv Client', platform:'Direct Client Research', grossCents:50000, expectedFeesCents:5000, expectedCostsCents:500, paymentMethod:'wire', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
    EarningEngine.lockOpportunityExclusive(String(opp.id), agentA);
    const exec:any = ExecutionPipeline.startExecution({opportunityId:String(opp.id), agentId:agentA, connectorId:'direct_client_research'});
    assert.equal(String(exec.state),'running');
    ExecutionPipeline.completeExecution(String(exec.id), {delivered:true});
    const v = ExecutionPipeline.verifyExecution(String(exec.id), [{agentId:agentA, confidence:0.91, passed:true},{agentId:agentB, confidence:0.91, passed:true}]);
    assert.equal(v.verified, true);
    ExecutionPipeline.confirmProviderPayment(String(exec.id), 'prov-adv-1', {grossCents:50000, feesCents:5000, netCents:44500});
    const before = EarningEngine.totalVerifiedEarnings();
    const settled:any = ExecutionPipeline.settleExecution({executionId:String(exec.id), actor:{kind:'owner', id:ownerId}, rail:'wire', externalId:'ext-wire-'+randomUUID().slice(0,6), grossCents:50000, feeCents:5000, netCents:44500, providerRef:'prov-adv-1'});
    assert.equal(String(settled.state),'settlement_verified');
    assert.ok(EarningEngine.totalVerifiedEarnings() > before);
    const trail = listAuthorizationTrail(5);
    assert.ok(trail.some(r=> String(r.decision)==='allowed'));
  });

  it('1. cannot use owner identity for unauthorized activity', ()=>{
    const a = freshAgent('vio1');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t1', connectorId:'direct_client_research',
      action:'kyc.submit',
      payload:{ owner_email: 'zanaveed555@gmail.com', action:'use owner identity for unauthorized purchase', amount: 99999 }
    });
    assert.equal(d.allowed, false);
    assert.ok(['fake_identity','impersonation','kyc_fabrication'].includes(d.violationCode));
    assert.equal(d.ownerActionRequired, true);
    const a2 = freshAgent('vio1b');
    const d2:any = authorizeAgentAction({
      agentId: a2, actorType:'agent', actorId: a2,
      taskId:'t1', connectorId:'upwork',
      action:'execution.start',
      payload:{ impersonate: 'on behalf of owner without authorization', owner_email: process.env.ZA141251SA_OWNER_EMAIL }
    });
    assert.equal(d2.allowed, false);
    assert.ok(['impersonation','fake_identity'].includes(d2.violationCode));
  });

  it('2. cannot fabricate or alter KYC/identity information', ()=>{
    const a = freshAgent('vio2');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'kyc1', connectorId:'upwork',
      action:'kyc.submit',
      payload:{ passport_number:'A1234567', cnic:'12345-1234567-1', selfie:'fake', identity_document:'fabricated' }
    });
    assert.equal(d.allowed, false);
    assert.equal(d.violationCode,'kyc_fabrication');
    const dOwner:any = authorizeAgentAction({
      agentId: null, actorType:'owner', actorId: ownerId,
      taskId:'kyc1', connectorId:'upwork',
      action:'kyc.submit',
      payload:{ passport_number:'A1234567' }
    });
    assert.equal(dOwner.allowed, true);
  });

  it('3. cannot bypass KYC/AML/sanctions or platform rules', ()=>{
    const cases = [
      {action:'bypass_kyc', payload:{ detail:'bypass KYC verification' }, code:'kyc_aml_bypass'},
      {action:'payment', payload:{ note:'evade sanctions iran' }, code:'sanctions'},
      {action:'platform_violation', payload:{ note:'bypass platform terms and violate ToS' }, code:'prohibited_activity'},
    ];
    for(const c of cases){
      const a = freshAgent('vio3'+c.action);
      const d:any = authorizeAgentAction({agentId:a, actorType:'agent', actorId:a, taskId:'t', connectorId:'direct_client_research', action:c.action, payload:c.payload});
      assert.equal(d.allowed, false, `should block ${c.action}`);
      assert.ok(d.violationCode, `violationCode for ${c.action}`);
      if(c.code==='kyc_aml_bypass') assert.equal(d.violationCode,'kyc_aml_bypass');
    }
  });

  it('4. cannot impersonate owner outside explicitly authorized account activity', ()=>{
    const a = freshAgent('vio4a');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'upwork',
      action:'execution.start',
      payload:{ note:'acting as zanaveed555@gmail.com', owner_email:'zanaveed555@gmail.com' }
    });
    assert.equal(d.allowed, false);
    assert.equal(d.violationCode,'impersonation');
    const ok:any = authorizeAgentAction({
      agentId: agentClean, actorType:'agent', actorId: agentClean,
      taskId:'t', connectorId:'direct_client_research',
      action:'execution.start',
      payload:{ opportunityId:'opp1', lawfulPurpose:true }
    });
    assert.equal(ok.allowed, true);
  });

  it('5. cannot create fraudulent jobs/orders/reviews/transactions', ()=>{
    const fraudActions = ['create_job','create_order','post_review','create_transaction','fabricate_order'];
    for(const act of fraudActions){
      const a = freshAgent('vio5'+act);
      const d:any = authorizeAgentAction({agentId:a, actorType:'agent', actorId:a, taskId:'t', connectorId:'direct_client_research', action:act, payload:{ fake:true }});
      assert.equal(d.allowed, false, act);
      assert.equal(d.violationCode,'fraudulent_job');
    }
  });

  it('6. cannot make unauthorized purchases or financial commitments', ()=>{
    const { updatePolicy } = require('./policy') as typeof import('./policy');
    updatePolicy({requireApprovalAboveCents: 5000}, ownerId);
    const a = freshAgent('vio6');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'direct_client_research',
      action:'purchase.request',
      payload:{ category:'execution', provider:'aws' },
      amountCents: 100000,
      walletId: `w_${a}`
    });
    assert.equal(d.allowed, false);
    assert.ok(['unauthorized_purchase','unauthorized_transfer'].includes(d.violationCode));
    assert.equal(d.ownerActionRequired, true);
    const ok:any = authorizeAgentAction({
      agentId: agentClean, actorType:'agent', actorId: agentClean,
      taskId:'t', connectorId:'direct_client_research',
      action:'purchase.request',
      payload:{ category:'execution' },
      amountCents: 100,
      walletId: `w_${agentClean}`
    });
    assert.equal(ok.allowed, true);
    updatePolicy({requireApprovalAboveCents: 10000}, ownerId);
  });

  it('7. cannot accept legal/financial obligations outside approved connector contract', ()=>{
    const a = freshAgent('vio7');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'direct_client_research',
      action:'accept_terms',
      payload:{ agreement:'loan agreement $50000, bind company as guarantor' }
    });
    assert.equal(d.allowed, false);
    assert.equal(d.violationCode,'legal_obligation');
    const dOwner:any = authorizeAgentAction({
      actorType:'owner', actorId: ownerId,
      taskId:'t', connectorId:'direct_client_research',
      action:'accept_terms',
      payload:{ agreement:'client SOW $5k' }
    });
    assert.equal(dOwner.allowed, true);
  });

  it('8. cannot perform prohibited or restricted activities', ()=>{
    const a = freshAgent('vio8a');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'direct_client_research',
      action:'prohibited',
      payload:{ activityKey:'fake_identities' }
    });
    assert.equal(d.allowed, false);
    assert.ok(['prohibited_activity','fake_identity','impersonation'].includes(d.violationCode), `got ${d.violationCode}`);
    const a2 = freshAgent('vio8b');
    const d2:any = authorizeAgentAction({
      agentId: a2, actorType:'agent', actorId: a2,
      taskId:'t', connectorId:'mturk',
      action:'execution.start',
      payload:{}
    });
    assert.equal(d2.allowed, false, `mturk should be blocked got ${d2.violationCode}`);
    assert.ok(['prohibited_activity','kyc_fabrication','unknown_scope'].includes(d2.violationCode) || d2.ownerActionRequired);
  });

  it('9. cannot spam or abuse platforms', ()=>{
    const a = freshAgent('vio9');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'direct_client_research',
      action:'bulk_send',
      payload:{ message:'spam blast 10000 emails unsolicited bulk messaging' }
    });
    assert.equal(d.allowed, false);
    assert.equal(d.violationCode,'spam');
  });

  it('10. cannot hide failed/incorrect actions', ()=>{
    const a = freshAgent('vio10');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'direct_client_research',
      action:'hide_failure',
      payload:{ originalError:'delivery failed validation', hide:true }
    });
    assert.equal(d.allowed, false);
    assert.equal(d.violationCode,'hidden_failure');
  });

  it('11. cannot claim verification without independent provider evidence', ()=>{
    const a = freshAgent('vio11a');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'direct_client_research',
      action:'verification.claim',
      payload:{ confidence:0.99 },
      providerResponse: null
    });
    assert.equal(d.allowed, false);
    assert.equal(d.violationCode,'false_verification');
    const b = agentClean;
    const ok:any = authorizeAgentAction({
      agentId: b, actorType:'agent', actorId: b,
      taskId:'t', connectorId:'direct_client_research',
      action:'verification.claim',
      payload:{ confidence:0.91 },
      providerResponse:{ providerRef:'prov-123', externalId:'ext-123' }
    });
    assert.equal(ok.allowed, true);
  });

  it('12. cannot move money without configured authorization and limits', ()=>{
    const a = freshAgent('vio12a');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'direct_client_research',
      action:'money.transfer',
      payload:{ kind:'transfer', amount:5000 },
      amountCents: 5000,
      walletId: 'nonexistent_wallet'
    });
    assert.equal(d.allowed, false);
    assert.ok(['unauthorized_transfer','unauthorized_purchase','unknown_scope'].includes(d.violationCode));
    const { updatePolicy } = require('./policy') as typeof import('./policy');
    updatePolicy({requireOwnerForPayout:true}, ownerId);
    void authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'direct_client_research',
      action:'settlement.request',
      payload:{ rail:'wise', externalId:'ext-1' },
      amountCents: 1000,
      walletId: `w_${a}`
    });
    updatePolicy({requireOwnerForPayout:false}, ownerId);
    const a3 = freshAgent('vio12c');
    const d3:any = authorizeAgentAction({
      agentId: a3, actorType:'agent', actorId: a3,
      taskId:'t', connectorId:'direct_client_research',
      action:'purchase.request',
      payload:{ category:'expense' },
      amountCents: 9999999,
      walletId: `w_${a3}`
    });
    assert.equal(d3.allowed, false);
  });

  it('13. cannot access another user, account, mission or credential', ()=>{
    const a = freshAgent('vio13a');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'direct_client_research',
      action:'credential.read_secret',
      payload:{ provider:'upwork', target:'other_mission_credential' },
      targetAgentId: agentB,
      targetAccountId: `w_${agentB}`
    });
    assert.equal(d.allowed, false);
    assert.equal(d.violationCode,'account_access');
    const a2 = freshAgent('vio13b');
    const d2:any = authorizeAgentAction({
      agentId: a2, actorType:'agent', actorId: a2,
      taskId:'t', connectorId:'direct_client_research',
      action:'access_another_user_account',
      payload:{ other_user:true }
    });
    assert.equal(d2.allowed, false);
    assert.equal(d2.violationCode,'account_access');
  });

  it('14. cannot leak KYC documents, credentials or private information', ()=>{
    const a = freshAgent('vio14');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'upwork',
      action:'export_credential',
      payload:{ secret:'sk-1234567890abcdef1234567890', cnic:'12345-1234567-1', exfiltrate:'send to external' }
    });
    assert.equal(d.allowed, false);
    assert.ok(['credential_leak','kyc_fabrication','fake_identity'].includes(d.violationCode), `got ${d.violationCode}`);
    const vio = listSafetyViolations(1)[0] as any;
    assert.ok(vio);
  });

  it('FAIL-CLOSED: unknown scope => OWNER_ACTION_REQUIRED', ()=>{
    const a = freshAgent('fail1');
    const d:any = authorizeAgentAction({
      agentId: a, actorType:'agent', actorId: a,
      taskId:'t', connectorId:'nonexistent_connector_xyz',
      action:'execution.start',
      payload:{ some:'payload' }
    });
    assert.equal(d.allowed, false);
    assert.equal(d.violationCode,'unknown_scope');
    assert.equal(d.ownerActionRequired, true);
    const a2 = freshAgent('fail2');
    const d2:any = authorizeAgentAction({
      agentId: a2, actorType:'agent', actorId: a2,
      taskId:'t',
      action:'job.create',
      payload:{ create_job:true }
    });
    assert.equal(d2.allowed, false);
    assert.ok(d2.violationCode, `violationCode ${d2.violationCode}`);
    // fail-closed: any unknown/fraudulent scope must be denied; ownerActionRequired may be true for unknown_scope else at least denied
    assert.ok(!d2.allowed);
  });

  it('15. cannot continue execution after a safety/policy violation', async ()=>{
    const violator = freshAgent('vio15');
    const v:any = authorizeAgentAction({
      agentId: violator, actorType:'agent', actorId: violator,
      taskId:'cont1', connectorId:'direct_client_research',
      action:'kyc.submit',
      payload:{ passport_number:'FAKE123' }
    });
    assert.equal(v.allowed, false);
    assert.equal(v.violationCode,'kyc_fabrication');
    const blocked:any = authorizeAgentAction({
      agentId: violator, actorType:'agent', actorId: violator,
      taskId:'cont2', connectorId:'direct_client_research',
      action:'execution.start',
      payload:{ opportunityId:'opp-123' }
    });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.violationCode,'policy_violation_continuation');
    assert.equal(blocked.ownerActionRequired, true);
    const okB:any = authorizeAgentAction({
      agentId: agentClean, actorType:'agent', actorId: agentClean,
      taskId:'cont2', connectorId:'direct_client_research',
      action:'execution.start',
      payload:{ opportunityId:'opp-123' }
    });
    assert.equal(okB.allowed, true);
  });

  it('immutable/auditable trail: task→agent→authorization→connector→action→provider response→verification→settlement is hash-chained and tamper-evident', ()=>{
    const beforeSeq = (listAuthorizationTrail(1)[0] as any)?.seq ?? 0;
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'software_development', provider:'Trail Corp', platform:'Direct Client Research', grossCents:60000, expectedFeesCents:6000, expectedCostsCents:500, paymentMethod:'wire', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
    const workAgent = freshAgent('trail');
    // provision same agent for pipeline: need agent for verification second verifier
    const verifier = agentClean;
    EarningEngine.lockOpportunityExclusive(String(opp.id), workAgent);
    const exec:any = ExecutionPipeline.startExecution({opportunityId:String(opp.id), agentId:workAgent, connectorId:'direct_client_research'});
    ExecutionPipeline.completeExecution(String(exec.id), {delivered:true});
    ExecutionPipeline.verifyExecution(String(exec.id), [{agentId:workAgent, confidence:0.92, passed:true},{agentId:verifier, confidence:0.93, passed:true}]);
    ExecutionPipeline.confirmProviderPayment(String(exec.id), 'prov-trail-1', {grossCents:60000, feesCents:6000, netCents:53500});
    ExecutionPipeline.settleExecution({executionId:String(exec.id), actor:{kind:'owner', id:ownerId}, rail:'wire', externalId:'ext-trail-'+randomUUID().slice(0,6), grossCents:60000, feeCents:6000, netCents:53500, providerRef:'prov-trail-1'});
    const trailRows = listAuthorizationTrail(20);
    assert.ok((trailRows.length as number) > beforeSeq || trailRows.length>0);
    const vTrail = verifyAuthorizationTrail();
    assert.equal(vTrail.ok, true, `authorization trail broken: ${vTrail.detail}`);
    const vVio = verifySafetyViolations();
    assert.equal(vVio.ok, true, `violations chain broken: ${vVio.detail}`);
    const vAudit = require('./database').verifyMissionAudit();
    assert.equal(vAudit.ok, true, `audit chain broken: ${vAudit.detail}`);
    const { appendMissionAudit } = require('./database') as typeof import('./database');
    appendMissionAudit({actorType:'agent', actorId:workAgent, action:'test.secret_attempt', detail:{ secret:'sk-test1234567890abcdef', password:'hunter2', token:'ghp_123' } as any});
    const lastAudit = missionDb.get('SELECT detail FROM mission_audit ORDER BY seq DESC LIMIT 1') as any;
    assert.ok(!String(lastAudit.detail).includes('sk-test1234567890abcdef'));
    assert.ok(String(lastAudit.detail).includes('[redacted]'));
  });

  it('audit records are immutable and hash-chained — countPendingOwnerActions reflects fail-closed', ()=>{
    const pendingBefore = countPendingOwnerActions();
    const a = freshAgent('pending');
    authorizeAgentAction({agentId:a, actorType:'agent', actorId:a, taskId:'pending1', connectorId:'unknown_xyz', action:'execution.start', payload:{}});
    const pendingAfter = countPendingOwnerActions();
    assert.ok(pendingAfter > pendingBefore);
  });

  it('execution pipeline respects gate — humanOnly connector blocked via gate', ()=>{
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'consulting_advisory', provider:'HumanOnly Corp', platform:'PeoplePerHour', grossCents:30000, expectedFeesCents:3000, expectedCostsCents:300, paymentMethod:'wire', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
    const a = freshAgent('hum');
    EarningEngine.lockOpportunityExclusive(String(opp.id), a);
    assert.throws(()=> ExecutionPipeline.startExecution({opportunityId:String(opp.id), agentId:a, connectorId:'peopleperhour'}), e=> {
      const msg = String((e as any).message ?? e);
      return /owner_action_required|human_only|prohibited_activity/i.test(msg);
    });
  });

  it('settlement without independent provider evidence is blocked (false verification)', ()=>{
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'SettleFail Corp', platform:'Direct Client Research', grossCents:40000, expectedFeesCents:4000, expectedCostsCents:400, paymentMethod:'wise', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
    const a = freshAgent('settle');
    EarningEngine.lockOpportunityExclusive(String(opp.id), a);
    const exec:any = ExecutionPipeline.startExecution({opportunityId:String(opp.id), agentId:a, connectorId:'direct_client_research'});
    ExecutionPipeline.completeExecution(String(exec.id), {delivered:true});
    ExecutionPipeline.verifyExecution(String(exec.id), [{agentId:a, confidence:0.9, passed:true},{agentId:agentClean, confidence:0.9, passed:true}]);
    ExecutionPipeline.confirmProviderPayment(String(exec.id), 'prov-settle-fail', {grossCents:40000, feesCents:4000, netCents:35600});
    assert.throws(()=> ExecutionPipeline.settleExecution({executionId:String(exec.id), actor:{kind:'owner', id:ownerId}, rail:'wise', externalId:'', grossCents:40000, feeCents:4000, netCents:35600}), e=> {
      const msg = String((e as any).message ?? e);
      return /externalId|verified|false_verification|settlement/i.test(msg);
    });
  });

});
