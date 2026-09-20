import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
process.env.ZA141251SA_DATABASE_URL = `file:${path.join(os.tmpdir(), `mission-pipeline-${randomUUID()}.db`)}`;
import { before, after, it, describe } from 'node:test';
import assert from 'node:assert/strict';
const { applyMissionMigrations, missionDb } = require('../database') as typeof import('../database');
const EarningEngine = require('./earning-engine') as typeof import('./earning-engine');
const ExecutionPipeline = require('./execution-pipeline') as typeof import('./execution-pipeline');

let owner:any, ownerId:string, agentA:string, agentB:string;
function expiryIso(){ return new Date(Date.now()+ 7*24*3600*1000).toISOString(); }

before(()=> {
  applyMissionMigrations();
  const { provisionOwner } = require('../auth') as typeof import('../auth');
  const { updatePolicy } = require('../policy') as typeof import('../policy');
  try { const o = provisionOwner({email:`pipe-${randomUUID()}@test.local`, password:'StrongPass!123', displayName:'Pipe'}); owner = o; ownerId = o.id ?? o.owner?.id; } catch { const r = missionDb.get('SELECT id FROM mission_owner LIMIT 1'); ownerId = String(r.id); owner={id:ownerId}; }
  updatePolicy({allowAgentCreation:true, maxAgents:5000}, ownerId);
  const idA = `agt_pipe_a_${randomUUID().slice(0,6)}`; const idB = `agt_pipe_b_${randomUUID().slice(0,6)}`;
  missionDb.run("INSERT OR IGNORE INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'custom','active','worker','mission','[]')", [idA, `pipe-a-${idA.slice(-4)}`, 'Pipe A','specialist']);
  missionDb.run("INSERT OR IGNORE INTO mission_agents (id,slug,name,role_key,depth,generation,status,mission_role,origin_platform,capabilities) VALUES (?,?,?,?,0,'custom','active','worker','mission','[]')", [idB, `pipe-b-${idB.slice(-4)}`, 'Pipe B','specialist']);
  missionDb.run("INSERT OR IGNORE INTO mission_wallets (id, kind, agent_id, label, currency, balance_cents, budget_cents, spent_cents, status) VALUES (?,?,?, 'pipe wallet','USD', 100000, 100000, 0, 'active')", [`w_${idA}`, 'agent', idA]);
  const { setMoneyGrant } = require('../money') as typeof import('../money');
  for (const id of [idA, idB]) {
    try { setMoneyGrant({kind:'owner', id: ownerId} as any, id, {spendLimitCents:100000, delegationCents:0, canCreate:false, expiresAt:new Date(Date.now()+86400000).toISOString(), status:'active'}); } catch {}
  }
  agentA = idA; agentB = idB;
  // ensure payout slot for settlement flow
  const { createWallet, configurePayoutSlot } = require('../treasury') as typeof import('../treasury');
  const { confirmPayoutVerification, PAYOUT_VERIFICATION_CHECKS } = require('../payout-verification') as typeof import('../payout-verification');
  try { createWallet({kind:'mission', label:'pipe-treasury', currency:'USD'}); } catch {}
  try { configurePayoutSlot({slot:2, providerRef:`acct_pipe_${randomUUID().slice(0,8)}`, minPayoutCents:0, maxPayoutCents:100000, currency:'USD', actorId:ownerId}); confirmPayoutVerification({slot:2, ownerId, checks: Object.fromEntries(PAYOUT_VERIFICATION_CHECKS.map((c:any)=> [c.key, true])), attestation:'Pipe test attestation — no real destination.'}); } catch {}
});

after(()=> missionDb.close());

describe('execution → verification → settlement pipeline (durable, idempotent, retry/backoff)', ()=> {
  it('startExecution creates idempotent execution row and locks opportunity', ()=> {
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Pipe Corp', platform:'Direct Client Research', grossCents:50000, expectedFeesCents:5000, expectedCostsCents:800, paymentMethod:'stripe', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
    EarningEngine.lockOpportunityExclusive(String(opp.id), agentA);
    // Pipeline start is idempotent — first creates, second returns same
    const e1:any = ExecutionPipeline.startExecution({opportunityId:String(opp.id), agentId:agentA, connectorId:'direct_client_research'});
    const e2:any = ExecutionPipeline.startExecution({opportunityId:String(opp.id), agentId:agentA, connectorId:'direct_client_research'});
    assert.equal(String(e1.id), String(e2.id));
    assert.equal(String(e1.state), 'running');
  });

  it('complete + verify requires 2 verifiers at 0.85', ()=> {
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Pipe Corp2', platform:'Direct Client Research', grossCents:52000, expectedFeesCents:5200, expectedCostsCents:800, paymentMethod:'stripe', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
    EarningEngine.lockOpportunityExclusive(String(opp.id), agentA);
    const exec:any = ExecutionPipeline.startExecution({opportunityId:String(opp.id), agentId:agentA, connectorId:'direct_client_research'});
    ExecutionPipeline.completeExecution(String(exec.id), {delivered:true});
    const afterComplete = missionDb.get('SELECT state FROM mission_earning_executions WHERE id=?', [String(exec.id)]) as any;
    assert.equal(String(afterComplete.state), 'verifying');
    const res = ExecutionPipeline.verifyExecution(String(exec.id), [{agentId:agentA, confidence:0.91, passed:true},{agentId:agentB, confidence:0.91, passed:true}]);
    assert.equal((res as any).verified, true);
    const afterVerify = missionDb.get('SELECT state FROM mission_earning_executions WHERE id=?', [String(exec.id)]) as any;
    assert.equal(String(afterVerify.state), 'verified');
  });

  it('provider confirm and independent settlement → settlement_verified and ledger credit', ()=> {
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Pipe Corp3', platform:'Direct Client Research', grossCents:48000, expectedFeesCents:4800, expectedCostsCents:800, paymentMethod:'wise', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
    EarningEngine.lockOpportunityExclusive(String(opp.id), agentA);
    const exec:any = ExecutionPipeline.startExecution({opportunityId:String(opp.id), agentId:agentA, connectorId:'direct_client_research'});
    ExecutionPipeline.completeExecution(String(exec.id), {delivered:true});
    ExecutionPipeline.verifyExecution(String(exec.id), [{agentId:agentA, confidence:0.9, passed:true},{agentId:agentB, confidence:0.9, passed:true}]);
    ExecutionPipeline.confirmProviderPayment(String(exec.id), 'prov-pipe-1', {grossCents:48000, feesCents:4800, netCents:42400});
    const before = EarningEngine.totalVerifiedEarnings();
    const settled:any = ExecutionPipeline.settleExecution({executionId:String(exec.id), actor:{kind:'owner', id:ownerId}, rail:'wise', externalId:'ext-wise-'+randomUUID().slice(0,6), grossCents:48000, feeCents:4800, netCents:42400, providerRef:'prov-pipe-1'});
    assert.equal(String(settled.state), 'settlement_verified');
    assert.ok(EarningEngine.totalVerifiedEarnings() > before);
  });

  it('fail with retry schedules exponential backoff and records provider failure', ()=> {
    const opp:any = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Pipe Fail', platform:'Direct Client Research', grossCents:40000, expectedFeesCents:4000, expectedCostsCents:800, paymentMethod:'stripe', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
    EarningEngine.lockOpportunityExclusive(String(opp.id), agentA);
    const exec:any = ExecutionPipeline.startExecution({opportunityId:String(opp.id), agentId:agentA, connectorId:'direct_client_research'});
    const failed1:any = ExecutionPipeline.failExecutionWithRetry(String(exec.id), 'transient failure 1', 'transient');
    assert.equal(String(failed1.state), 'retry_scheduled');
    assert.ok(failed1.next_retry_at);
    // second failure increases backoff
    const failed2:any = ExecutionPipeline.failExecutionWithRetry(String(exec.id), 'transient failure 2', 'transient');
    assert.ok(failed2.attempts > failed1.attempts);
    // Fast-forward next_retry_at to now for retryDue test
    missionDb.run('UPDATE mission_earning_executions SET next_retry_at=? WHERE id=?', [new Date(Date.now()-1000).toISOString(), String(exec.id)]);
    const due = ExecutionPipeline.retryDueExecutions(5) as any[];
    assert.ok(due.length >= 1);
    const retr = missionDb.get('SELECT state FROM mission_earning_executions WHERE id=?', [String(exec.id)]) as any;
    assert.equal(String(retr.state), 'running');
  });

  it('kill switch blocks pipeline start', ()=> {
    const { setKillSwitch } = require('../policy') as typeof import('../policy');
    setKillSwitch(true, ownerId);
    const opp:any = EarningEngine.discoverOpportunity; // not used
    void opp;
    const opp2:any = (()=> {
      setKillSwitch(false, ownerId);
      const o = EarningEngine.discoverOpportunity({registryKey:'paid_research_data', provider:'Pipe Kill', platform:'Direct Client Research', grossCents:30000, expectedFeesCents:3000, expectedCostsCents:500, paymentMethod:'stripe', settlementEvidence:'evidence', opportunityExpiry: expiryIso()});
      setKillSwitch(true, ownerId);
      return o;
    })();
    // Even though opportunity exists, pipeline should be blocked by kill switch before lock
    // We test via direct startExecution which checks policy
    try {
      // need assigned state first — but kill switch blocks before that too
      assert.throws(()=> ExecutionPipeline.startExecution({opportunityId:String(opp2.id), agentId:agentA, connectorId:'direct_client_research'}), /kill_switch/);
    } finally {
      setKillSwitch(false, ownerId);
      // cleanup: mark failed
      try { EarningEngine.recordFailure(String(opp2.id), 'test cleanup'); } catch {}
    }
  });

  it('pipeline health reports retriesDue honestly', ()=> {
    const health = ExecutionPipeline.executionPipelineHealth() as any;
    assert.ok(typeof health.retriesDue === 'number');
    assert.ok(health.byState);
  });
});
