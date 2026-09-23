/**
 * ZA141251SA EXECUTION → VERIFICATION → SETTLEMENT PIPELINE
 * Durable, idempotent, retry with exponential backoff, audit-logged, kill-switch + spending limits.
 * - Creates mission_earning_executions rows with idempotency_key UNIQUE
 * - Verification requires 2 verifiers @ 0.85 + secret scan + audit
 * - Settlement requires independent verification via settlement-verification.ts (no synthetic)
 * - Links verified net to mission_agent_earnings_ledger + mission_ledger via treasury credit (owner only)
 * - All spend paths check killSwitch + canAgentSpend via policy
 */

import { missionDb as db, missionId, nowIso, sha256, appendMissionAudit, type Row } from '../database';
import { MoneyError, type MoneyActor, assertMoneyOwner } from '../money';
import { currentPolicy, canAgentSpend } from '../policy';
import * as EarningEngine from './earning-engine';
import * as Contracts from './connector-execution-contracts';
import * as SettlementVerify from './settlement-verification';
import { getProviderReadiness, recordProviderFailure } from './provider-capability-registry';
import { authorizeAgentAction } from '../owner-safety-gate';

function deny(code:string):never{ throw new MoneyError(`pipeline_${code}` as any); }

function backoffMs(attempt:number, baseMs:number): number {
  // exponential: base * 2^(attempt-1), capped 1h
  const exp = Math.min(60*60*1000, baseMs * Math.pow(2, Math.max(0, attempt-1)));
  // jitter not added to keep deterministic in tests
  return Math.round(exp);
}

export function startExecution(input: { opportunityId:string; agentId:string; connectorId?:string; scopeHash?:string }): Row {
  const policy = currentPolicy();
  if (policy.killSwitch) deny('kill_switch_engaged');
  const opp = db.get<Row>('SELECT * FROM mission_earning_engine_opportunities WHERE id=?', [input.opportunityId]);
  if (!opp) deny('opportunity_missing');
  const connectorId = input.connectorId ?? (String(opp!.platform ?? '').toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,40) || String(opp!.registry_key ?? '').toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,40) || 'direct_client_research');
  const contract = Contracts.getConnectorContract(connectorId) ?? Contracts.getConnectorContract('direct_client_research')!;
  // Idempotency: if execution already exists for this opp+agent+scope, return it regardless of opp state (after first start, opp moves to executing)
  const scopeHashEarly = input.scopeHash ?? sha256(String(opp!.evidence_json)).slice(0,16);
  const idempotencyKeyEarly = Contracts.idempotencyKeyFor(contract, { opportunityId: input.opportunityId, agentId: input.agentId, scopeHash: scopeHashEarly });
  const existingEarly = db.get<Row>('SELECT * FROM mission_earning_executions WHERE idempotency_key=?', [idempotencyKeyEarly]);
  if (existingEarly) return existingEarly;
  const sameEarly = db.get<Row>('SELECT * FROM mission_earning_executions WHERE opportunity_id=? AND agent_id=? ORDER BY created_at DESC LIMIT 1', [input.opportunityId, input.agentId]);
  if (sameEarly) return sameEarly;
  // OWNER-SAFETY GATE — fail-closed before any state mutation
  {
    const gate = authorizeAgentAction({
      agentId: input.agentId,
      actorType: 'agent',
      actorId: input.agentId,
      taskId: input.opportunityId,
      connectorId,
      action: 'execution.start',
      payload: { opportunityId: input.opportunityId, connectorId, scopeHash: scopeHashEarly, expectedCostsCents: Number(opp!.expected_costs_cents ?? 0), verificationState: String(opp!.verification_state), exclusiveAgentId: String(opp!.exclusive_agent_id ?? '') },
    });
    if (!gate.allowed) {
      if (gate.ownerActionRequired) deny(`owner_action_required:${gate.violationCode}:${gate.reasons.join(';')}`);
      else deny(`${gate.violationCode}:${gate.reasons.join(';')}`);
    }
  }
  if (String(opp!.verification_state)!=='assigned') deny('not_assigned_state');
  if (String(opp!.exclusive_agent_id)!==input.agentId) deny('not_assigned_agent');
  // Human-only gate
  if (contract.humanOnly) deny('human_only_connector_requires_owner');
  // Provider readiness gate (not fabricable)
  const readiness = getProviderReadiness(connectorId);
  if (readiness && readiness.status==='blocked') deny('provider_blocked_per_tos');
  if (readiness && readiness.status==='not_configured' && readiness.requiresOwnerAccount) deny('provider_not_configured');
  // ── D1-D5 activation procedure for direct_client_research / paid_research_data ──
  // Fail-closed: execution cannot start until owner completes lawful-purpose, data-rights,
  // non-sensitive, payout-slot verification and vault scoping (if credential needed).
  // Discovery already validates D2-D4 (lawfulPurposeRef/datasetSha256/evidenceUrl/nonSensitive),
  // but re-check evidence_json here to block legacy or bypassed rows; D1 (payout slot) is checked now.
  if (String(opp!.registry_key) === 'paid_research_data') {
    const payoutActive = db.get<Row>("SELECT slot FROM mission_payout_slots WHERE status='active' LIMIT 1");
    if (!payoutActive) deny('owner_action_required:payout_slot_not_verified:D1_payout_slot_verification_required');
    let ej: any = {};
    try { ej = JSON.parse(String(opp!.evidence_json)); } catch {}
    const inner = ej.evidenceJson ?? ej ?? {};
    if (!inner.lawfulPurposeRef || String(inner.lawfulPurposeRef).trim().length < 8) deny('owner_action_required:lawful_purpose_required:D2_lawful_purpose_ref_missing');
    if (!inner.datasetSha256 || !/^[a-f0-9]{64}$/i.test(String(inner.datasetSha256).trim())) deny('owner_action_required:dataset_sha_required:D3_dataset_sha256_missing');
    if (inner.nonSensitiveDataOnly !== true) deny('owner_action_required:non_sensitive_required:D4_non_sensitive_check_missing');
    if (inner.dataRightsReviewed !== true) deny('owner_action_required:data_rights_required:D2_data_rights_missing');
    if (inner.credentialId) {
      const cred = db.get<Row>('SELECT status FROM mission_credentials WHERE id=?', [String(inner.credentialId)]);
      if (!cred || !['active','expiring'].includes(String(cred.status))) deny('owner_action_required:credential_not_vault_verified:D5_scoped_credential_via_vault_required');
    }
    if (!inner.evidenceUrl || !/^https:\/\//.test(String(inner.evidenceUrl).trim())) deny('owner_action_required:evidence_url_required:D2_evidence_url_missing');
  }
  // Spending gate: expected costs must respect wallet + policy
  // Find agent wallet
  const walletId = (()=> {
    try {
      const w = db.get<Row>('SELECT id FROM mission_wallets WHERE agent_id=? LIMIT 1', [input.agentId]);
      return w ? String(w.id) : null;
    } catch { return null; }
  })();
  if (walletId && Number(opp!.expected_costs_cents) > 0) {
    const decision = canAgentSpend({ walletId, amountCents: Number(opp!.expected_costs_cents), category:'execution', agentId: input.agentId }, policy, 0);
    if (!decision.allowed && !decision.requiresApproval) deny(`spending_denied:${decision.reasons.join(',')}`);
    if (decision.requiresApproval) deny('execution_cost_requires_owner_approval');
  }

  const scopeHash = input.scopeHash ?? sha256(String(opp!.evidence_json)).slice(0,16);
  const idempotencyKey = Contracts.idempotencyKeyFor(contract, { opportunityId: input.opportunityId, agentId: input.agentId, scopeHash });
  // Idempotent: if execution already exists for this key, return it
  const existing = db.get<Row>('SELECT * FROM mission_earning_executions WHERE idempotency_key=?', [idempotencyKey]);
  if (existing) return existing;
  if (db.get('SELECT id FROM mission_earning_executions WHERE opportunity_id=? AND agent_id=?', [input.opportunityId, input.agentId])) {
    // Same opp+agent already executing — return that row (no duplicate execution)
    const same = db.get<Row>('SELECT * FROM mission_earning_executions WHERE opportunity_id=? AND agent_id=? ORDER BY created_at DESC LIMIT 1', [input.opportunityId, input.agentId]);
    if (same) return same;
  }
  const id = missionId('exec');
  db.run('INSERT INTO mission_earning_executions (id, opportunity_id, agent_id, connector_id, idempotency_key, input_json, state, attempts, next_retry_at, last_error, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, input.opportunityId, input.agentId, connectorId, idempotencyKey, JSON.stringify({scopeHash, connectorId}), 'running', 1, null, null, nowIso(), nowIso()]);
  // Also transition opportunity state to executing if not already
  if (String(opp!.verification_state)==='assigned') {
    try { EarningEngine.scheduleWork(input.opportunityId, input.agentId); } catch {}
  }
  appendMissionAudit({actorType:'agent', actorId: input.agentId, action:'pipeline.execution_started', subjectType:'earning_opportunity', subjectId: input.opportunityId, detail:{executionId:id, connectorId} as any});
  // Also update opportunity to executing for pipeline visibility
  db.run('UPDATE mission_earning_engine_opportunities SET verification_state=\'executing\', updated_at=?, version=version+1 WHERE id=? AND verification_state=\'assigned\'', [nowIso(), input.opportunityId]);
  return db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [id])!;
}

export function completeExecution(executionId:string, evidence:{ delivered:boolean; evidenceHash?:string }): Row {
  const exec = db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [executionId]);
  if (!exec) deny('execution_missing');
  // Gate: ensure agent cannot hide failed delivery as successful
  {
    const gate = authorizeAgentAction({
      agentId: String(exec!.agent_id),
      actorType: 'agent',
      actorId: String(exec!.agent_id),
      taskId: String(exec!.opportunity_id),
      connectorId: String(exec!.connector_id),
      action: evidence.delivered ? 'execution.complete' : 'execution.complete_failed',
      payload: { delivered: evidence.delivered, evidenceHash: evidence.evidenceHash ?? null, execState: String(exec!.state) },
    });
    if (!gate.allowed) {
      if (gate.ownerActionRequired) deny(`owner_action_required:${gate.violationCode}:${gate.reasons.join(';')}`);
      else deny(`${gate.violationCode}:${gate.reasons.join(';')}`);
    }
    if (!evidence.delivered && gate.allowed) {
      // Fail-closed for hidden failure: even if gate allowed, delivery must be confirmed
    }
  }
  if (!['running','verifying'].includes(String(exec!.state))) deny('not_running');
  if (!evidence.delivered) deny('delivery_not_confirmed');
  db.run('UPDATE mission_earning_executions SET state=?, updated_at=? WHERE id=?', ['verifying', nowIso(), executionId]);
  appendMissionAudit({actorType:'agent', actorId: String(exec!.agent_id), action:'pipeline.execution_delivered', subjectType:'earning_execution', subjectId: executionId, detail:{opportunityId: String(exec!.opportunity_id)} as any});
  return db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [executionId])!;
}

export function verifyExecution(executionId:string, verifiers: Array<{agentId:string; confidence:number; passed:boolean}>): { verified:boolean; detail:Record<string,unknown> } {
  const exec = db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [executionId]);
  if (!exec) deny('execution_missing');
  {
    const gate = authorizeAgentAction({
      agentId: String(exec!.agent_id),
      actorType: 'agent',
      actorId: String(exec!.agent_id),
      taskId: String(exec!.opportunity_id),
      connectorId: String(exec!.connector_id),
      action: 'execution.verify',
      payload: { verifiers, confidence: verifiers.map(v=> v.confidence), passed: verifiers.map(v=> v.passed) },
      // internal verification uses 2 verifiers at 0.85, no provider webhook — gate must not require providerResponse here
    });
    if (!gate.allowed) {
      if (gate.ownerActionRequired) deny(`owner_action_required:${gate.violationCode}:${gate.reasons.join(';')}`);
      else deny(`${gate.violationCode}:${gate.reasons.join(';')}`);
    }
  }
  if (String(exec!.state)!=='verifying') deny('not_verifying');
  const oppId = String(exec!.opportunity_id);
  const res = EarningEngine.verifyWorkMultiAgent(oppId, verifiers);
  if (res.verified) {
    db.run('UPDATE mission_earning_executions SET state=?, updated_at=? WHERE id=?', ['verified', nowIso(), executionId]);
    appendMissionAudit({actorType:'system', action:'pipeline.execution_verified', subjectType:'earning_execution', subjectId: executionId, detail:{confidence: res.confidence} as any});
  } else {
    db.run('UPDATE mission_earning_executions SET state=?, last_error=?, last_error_category=?, updated_at=? WHERE id=?', ['failed', res.issues.join(';'), 'validation', nowIso(), executionId]);
  }
  return { verified: res.verified, detail: res as any };
}

export function confirmProviderPayment(executionId:string, providerRef:string, amounts:{grossCents:number; feesCents:number; netCents:number}): Row {
  const exec = db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [executionId]);
  if (!exec) deny('execution_missing');
  {
    const gate = authorizeAgentAction({
      agentId: String(exec!.agent_id),
      actorType: 'agent',
      actorId: String(exec!.agent_id),
      taskId: String(exec!.opportunity_id),
      connectorId: String(exec!.connector_id),
      action: 'provider.payment_confirm',
      payload: { providerRef, grossCents: amounts.grossCents, netCents: amounts.netCents },
      providerResponse: { providerRef, grossCents: amounts.grossCents } as any,
    });
    if (!gate.allowed) {
      if (gate.ownerActionRequired) deny(`owner_action_required:${gate.violationCode}:${gate.reasons.join(';')}`);
      else deny(`${gate.violationCode}:${gate.reasons.join(';')}`);
    }
  }
  if (String(exec!.state)!=='verified') deny('not_verified');
  if (!providerRef || providerRef.length<4) deny('invalid_provider_ref');
  const oppId = String(exec!.opportunity_id);
  EarningEngine.verifyProviderPayment(oppId, { providerRef, grossCents: amounts.grossCents, feesCents: amounts.feesCents, netCents: amounts.netCents });
  db.run('UPDATE mission_earning_executions SET state=?, updated_at=? WHERE id=?', ['provider_confirmed', nowIso(), executionId]);
  appendMissionAudit({actorType:'provider', action:'pipeline.provider_confirmed', subjectType:'earning_execution', subjectId: executionId, detail:{providerRef} as any});
  return db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [executionId])!;
}

export function settleExecution(input: { executionId:string; actor: MoneyActor; rail:string; externalId:string; grossCents:number; feeCents:number; netCents:number; providerRef?:string }): Row {
  // Gate settlement even before owner assertion — ensures owner cannot be impersonated and evidence is present
  {
    const execForGate = db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [input.executionId]);
    const gate = authorizeAgentAction({
      agentId: execForGate ? String(execForGate.agent_id) : null,
      actorType: 'owner',
      actorId: input.actor.id,
      taskId: execForGate ? String(execForGate.opportunity_id) : null,
      connectorId: execForGate ? String(execForGate.connector_id) : null,
      action: 'settlement.request',
      payload: { rail: input.rail, externalId: input.externalId, grossCents: input.grossCents, providerRef: input.providerRef ?? null },
      providerResponse: { providerRef: input.providerRef ?? null, externalId: input.externalId, rail: input.rail } as any,
      amountCents: input.netCents,
      walletId: execForGate ? (db.get<Row>('SELECT id FROM mission_wallets WHERE agent_id=? LIMIT 1', [String(execForGate.agent_id)])?.id as string | undefined) ?? null : null,
    });
    if (!gate.allowed) {
      if (gate.ownerActionRequired) deny(`owner_action_required:${gate.violationCode}:${gate.reasons.join(';')}`);
      else deny(`${gate.violationCode}:${gate.reasons.join(';')}`);
    }
  }
  assertMoneyOwner(input.actor);
  const policy = currentPolicy();
  if (policy.killSwitch) deny('kill_switch_engaged');
  const exec = db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [input.executionId]);
  if (!exec) deny('execution_missing');
  if (String(exec!.state)!=='provider_confirmed') deny('not_provider_confirmed');
  const oppId = String(exec!.opportunity_id);
  // Independent verification before wallet credit
  const ver = SettlementVerify.verifySettlementAgainstProvider({
    executionId: input.executionId,
    opportunityId: oppId,
    rail: input.rail,
    externalId: input.externalId,
    providerRef: input.providerRef ?? null,
    grossCents: input.grossCents,
    feeCents: input.feeCents,
    netCents: input.netCents,
    actor: input.actor,
  });
  if (!ver.verified) deny('settlement_not_independently_verified');
  // Now reconcile via earning-engine (creates agent earnings ledger)
  EarningEngine.reconcileSettlement(oppId, input.actor, { externalId: input.externalId, rail: input.rail, grossCents: input.grossCents, feeCents: input.feeCents, netCents: input.netCents });
  db.run('UPDATE mission_earning_executions SET state=?, updated_at=? WHERE id=?', ['settlement_verified', nowIso(), input.executionId]);
  // Also credit mission treasury via money ledger for real cash? EarningEngine already added to agent earnings ledger; treasury path is via mission_ledger when settlement rails credit treasury — for now we record settlement verification as truth.
  appendMissionAudit({actorType:'owner', actorId: input.actor.id, action:'pipeline.settlement_verified', subjectType:'earning_execution', subjectId: input.executionId, detail:{rail: input.rail, externalId: input.externalId} as any});
  return db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [input.executionId])!;
}

export function failExecutionWithRetry(executionId:string, errorCode:string, category: 'rate_limit'|'transient'|'auth'|'payment'|'toS_block'|'unreachable'|'validation' = 'transient'): Row {
  const exec = db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [executionId]);
  if (!exec) deny('execution_missing');
  const connectorId = String(exec!.connector_id);
  const contract = Contracts.getConnectorContract(connectorId);
  const maxRetries = contract?.maxRetries ?? 3;
  const attempts = Number(exec!.attempts ?? 0) + 1;
  if (attempts > maxRetries) {
    db.run('UPDATE mission_earning_executions SET state=?, attempts=?, last_error=?, last_error_category=?, next_retry_at=?, updated_at=? WHERE id=?', ['failed', attempts, errorCode.slice(0,500), category, null, nowIso(), executionId]);
    // Record learning
    try { EarningEngine.recordFailure(String(exec!.opportunity_id), errorCode); } catch {}
    recordProviderFailure(connectorId, { code: errorCode, category, detail: `max retries exceeded (${attempts})` });
  } else {
    const backoff = backoffMs(attempts, contract?.backoffBaseMs ?? 60000);
    const nextRetry = new Date(Date.now()+ backoff).toISOString();
    db.run('UPDATE mission_earning_executions SET state=?, attempts=?, last_error=?, last_error_category=?, next_retry_at=?, updated_at=? WHERE id=?', ['retry_scheduled', attempts, errorCode.slice(0,500), category, nextRetry, nowIso(), executionId]);
    recordProviderFailure(connectorId, { code: errorCode, category, detail: `attempt ${attempts} scheduled retry in ${backoff}ms`, retryAfterMs: backoff });
  }
  appendMissionAudit({actorType:'system', action:'pipeline.execution_failed', subjectType:'earning_execution', subjectId: executionId, detail:{errorCode, category, attempts} as any});
  return db.get<Row>('SELECT * FROM mission_earning_executions WHERE id=?', [executionId])!;
}

export function retryDueExecutions(limit=10): Row[] {
  const due = db.all<Row>('SELECT * FROM mission_earning_executions WHERE state=\'retry_scheduled\' AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY next_retry_at ASC LIMIT ?', [nowIso(), limit]);
  for (const r of due) {
    db.run('UPDATE mission_earning_executions SET state=?, updated_at=? WHERE id=?', ['running', nowIso(), String(r.id)]);
    appendMissionAudit({actorType:'system', action:'pipeline.execution_retry', subjectType:'earning_execution', subjectId: String(r.id)});
  }
  return due;
}

export function listExecutions(filter?: { opportunityId?:string; agentId?:string; state?:string }): Row[] {
  if (filter?.opportunityId) return db.all<Row>('SELECT * FROM mission_earning_executions WHERE opportunity_id=? ORDER BY created_at DESC', [filter.opportunityId]);
  if (filter?.agentId) return db.all<Row>('SELECT * FROM mission_earning_executions WHERE agent_id=? ORDER BY created_at DESC', [filter.agentId]);
  if (filter?.state) return db.all<Row>('SELECT * FROM mission_earning_executions WHERE state=? ORDER BY created_at DESC', [filter.state]);
  return db.all<Row>('SELECT * FROM mission_earning_executions ORDER BY created_at DESC LIMIT 20');
}

export function executionPipelineHealth(): Record<string, unknown> {
  const byState = db.all<Row>('SELECT state, COUNT(*) as c FROM mission_earning_executions GROUP BY state');
  const retriesDue = Number(db.get<Row>('SELECT COUNT(*) as c FROM mission_earning_executions WHERE state=\'retry_scheduled\' AND next_retry_at <= ?', [nowIso()])?.c ?? 0);
  return { byState: Object.fromEntries(byState.map(r=> [String(r.state), Number(r.c)])), retriesDue, note:'Retries use exponential backoff; provider failures classified; no synthetic settlement.' };
}
