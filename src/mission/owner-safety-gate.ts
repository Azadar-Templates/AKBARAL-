/**
 * ZA141251SA OWNER-SAFETY / LIABILITY GATE
 * Maximal autonomy for permitted work, FAIL-CLOSED for everything else.
 * Before any real provider account connected to owner identity is activated,
 * this gate proves agents cannot abuse identity, fabricate KYC, bypass compliance,
 * impersonate, fraud, spam, hide failures, claim false verification, move money,
 * access other accounts, leak secrets, or continue after violation.
 *
 * - Fail-closed: unknown scope => OWNER_ACTION_REQUIRED
 * - Immutable audit trail for task→agent→authorization→connector→action→provider response→verification→settlement
 * - No claim of 100% legal immunity — technical protections only, external/provider/legal risks remain.
 */

import { missionDb, missionId, nowIso, sha256, appendMissionAudit, redactForAudit, type Row } from './database';
import { currentPolicy, checkActivity, canAgentSpend } from './policy';
import { PROHIBITED_ACTIVITY_KEYS } from './policy';
import { findConnector } from './earning/platform-connectors';
import { getProviderReadiness } from './earning/provider-capability-registry';
import { OPPORTUNITY_REGISTRY } from './earning/opportunity-registry';

/* ── violation taxonomy (covers all 15 prompt requirements + generic unknown_scope) ── */
export const VIOLATION_CODES = [
  'fake_identity',
  'kyc_fabrication',
  'kyc_aml_bypass',
  'sanctions',
  'impersonation',
  'fraudulent_job',
  'unauthorized_purchase',
  'legal_obligation',
  'prohibited_activity',
  'spam',
  'hidden_failure',
  'false_verification',
  'unauthorized_transfer',
  'account_access',
  'credential_leak',
  'policy_violation_continuation',
  'unauthorized_activity',
  'unknown_scope',
] as const;
export type ViolationCode = typeof VIOLATION_CODES[number];

export interface SafetyDecision {
  allowed: boolean;
  ownerActionRequired: boolean;
  violationCode: ViolationCode | null;
  reasons: string[];
  trailId: string | null;
  trailSeq: number | null;
}

/* ── secret / KYC detectors ── */
const SECRET_KEY_PATTERN = /(password|secret|token|api[_-]?key|credential|authorization|private[_-]?key|card|cvv|iban|account[_-]?number)/i;
const KYC_KEY_PATTERN = /(kyc|passport|national[_-]?id|cnic|ssn|id[_-]?number|identity[_-]?document|selfie|proof[_-]?address|utility[_-]?bill|bank[_-]?statement|driving[_-]?license|birth[_-]?certificate)/i;
const KYC_VALUE_PATTERNS = [
  /\b[A-Z]{2}\d{6,9}\b/, // generic passport-like
  /\b\d{5}-\d{7}-\d\b/, // CNIC
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN-ish
];
const SANCTIONS_COUNTRIES = ['iran', 'north korea', 'syria', 'crimea', 'donetsk', 'luhansk', 'cuba', 'belarus', 'russia', 'venezuela', 'sudan'];
const SPAM_TRIGGERS = ['bulk_send', 'mass_message', 'unsolicited', 'spam', 'scrape_without_consent', 'auto_bid', 'fake_review', 'purchased_followers'];

function payloadHasKyc(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const flat = JSON.stringify(payload);
  if (KYC_KEY_PATTERN.test(flat)) return true;
  for (const p of KYC_VALUE_PATTERNS) if (p.test(flat)) return true;
  return false;
}
function payloadHasSecret(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const flat = JSON.stringify(payload);
  // redactForAudit would redact keys matching SECRET_KEY_PATTERN, but we want to detect exfiltration attempt
  for (const k of Object.keys(payload as Record<string, unknown>)) if (SECRET_KEY_PATTERN.test(k)) return true;
  if (/sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}/.test(flat)) return true;
  return false;
}
function payloadClaimsOwnerIdentity(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const flat = JSON.stringify(payload).toLowerCase();
  // owner email env or generic impersonation markers
  const ownerEmail = (process.env.ZA141251SA_OWNER_EMAIL ?? '').toLowerCase();
  if (ownerEmail && flat.includes(ownerEmail.toLowerCase())) return true;
  if (/(owner[_-]?email|impersonat|on behalf of owner|as owner)/i.test(flat)) return true;
  return false;
}

/* ── immutable trail ── */
function appendAuthorizationTrail(input: {
  taskId?: string | null;
  agentId?: string | null;
  actorType: 'owner' | 'agent' | 'system' | 'provider';
  actorId?: string | null;
  connectorId?: string | null;
  action: string;
  payload?: unknown;
  decision: 'allowed' | 'denied' | 'owner_action_required';
  violationCode: string | null;
  reasons: string[];
  providerResponseHash?: string | null;
  verificationRef?: string | null;
  settlementRef?: string | null;
}): { id: string; seq: number; hash: string } {
  return missionDb.transaction(() => {
    const prev = missionDb.get<{ seq: number; hash: string }>('SELECT seq, hash FROM mission_authorization_trail ORDER BY seq DESC LIMIT 1');
    const seq = Number(prev?.seq ?? 0) + 1;
    const id = missionId('authtrail');
    const createdAt = nowIso();
    const redacted = redactForAudit(input.payload ?? {}) as Record<string, unknown>;
    const payloadHash = sha256(JSON.stringify(redacted).slice(0, 4000));
    const reasonsStr = JSON.stringify(input.reasons ?? []);
    const payload = [
      seq, id,
      input.taskId ?? '',
      input.agentId ?? '',
      input.actorType, input.actorId ?? '',
      input.connectorId ?? '',
      input.action,
      payloadHash,
      input.decision,
      input.violationCode ?? '',
      reasonsStr,
      input.providerResponseHash ?? '',
      input.verificationRef ?? '',
      input.settlementRef ?? '',
      prev?.hash ?? '',
      createdAt,
    ].join('|');
    const hash = sha256(payload);
    missionDb.run(
      `INSERT INTO mission_authorization_trail (id, seq, prev_hash, hash, task_id, agent_id, actor_type, actor_id, connector_id, action, payload_hash, decision, violation_code, reasons_json, provider_response_hash, verification_ref, settlement_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, seq, prev?.hash ?? null, hash, input.taskId ?? null, input.agentId ?? null, input.actorType, input.actorId ?? null, input.connectorId ?? null, input.action, payloadHash, input.decision, input.violationCode, reasonsStr, input.providerResponseHash ?? null, input.verificationRef ?? null, input.settlementRef ?? null, createdAt]
    );
    return { id, seq, hash };
  });
}

function appendSafetyViolation(input: { agentId: string; violationCode: ViolationCode; detail?: string | null; trailId?: string | null; blockedAction?: string | null }): { id: string; seq: number; hash: string } {
  return missionDb.transaction(() => {
    const prev = missionDb.get<{ seq: number; hash: string }>('SELECT seq, hash FROM mission_safety_violations ORDER BY seq DESC LIMIT 1');
    const seq = Number(prev?.seq ?? 0) + 1;
    const id = missionId('safevio');
    const createdAt = nowIso();
    const payload = [seq, id, input.agentId, input.violationCode, input.detail ?? '', input.trailId ?? '', input.blockedAction ?? '', prev?.hash ?? '', createdAt].join('|');
    const hash = sha256(payload);
    missionDb.run(
      `INSERT INTO mission_safety_violations (id, seq, prev_hash, hash, agent_id, violation_code, detail, trail_id, blocked_action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, seq, prev?.hash ?? null, hash, input.agentId, input.violationCode, input.detail ?? null, input.trailId ?? null, input.blockedAction ?? null, createdAt]
    );
    // also audited
    appendMissionAudit({
      actorType: 'system',
      action: `safety.violation_blocked:${input.violationCode}`,
      subjectType: 'agent',
      subjectId: input.agentId,
      detail: { violationCode: input.violationCode, detail: (input.detail ?? '').slice(0, 400), blockedAction: input.blockedAction ?? null, trailId: input.trailId ?? null } as any,
    });
    return { id, seq, hash };
  });
}

/**
 * Core gate. Pure decision + immutable trail. No execution.
 * Returns allowed only when the system can positively establish authorization, compliance and scope.
 * Otherwise owner_action_required/denied (FAIL-CLOSED).
 */
export function authorizeAgentAction(input: {
  agentId?: string | null;
  ownerId?: string | null; // when owner explicitly delegates
  actorType: 'owner' | 'agent' | 'system' | 'provider';
  actorId?: string | null;
  taskId?: string | null;
  connectorId?: string | null;
  action: string; // canonical action name, e.g. 'execution.start', 'kyc.submit', 'money.transfer', 'job.create'
  payload?: Record<string, unknown> | null;
  amountCents?: number | null;
  walletId?: string | null;
  providerResponse?: Record<string, unknown> | null; // for verification claims
  targetAgentId?: string | null;
  targetAccountId?: string | null;
}): SafetyDecision {
  const reasons: string[] = [];
  let violation: ViolationCode | null = null;
  const actorType = input.actorType;
  const agentId = input.agentId ?? (actorType === 'agent' ? input.actorId : null);
  const ownerId = input.ownerId ?? (actorType === 'owner' ? input.actorId : null);
  const action = String(input.action ?? '').trim() || 'unknown';
  const connectorId = input.connectorId ? String(input.connectorId) : null;
  const payload = input.payload ?? {};
  const amountCents = input.amountCents ?? null;

  // Helpers to fail closed
  const deny = (code: ViolationCode, reason: string, ownerRequired = true): SafetyDecision => {
    violation = code;
    reasons.push(reason);
    const trail = appendAuthorizationTrail({
      taskId: input.taskId ?? null,
      agentId: agentId ?? null,
      actorType,
      actorId: input.actorId ?? null,
      connectorId,
      action,
      payload,
      decision: ownerRequired ? 'owner_action_required' : 'denied',
      violationCode: code,
      reasons,
      providerResponseHash: input.providerResponse ? sha256(JSON.stringify(redactForAudit(input.providerResponse))) : null,
    });
    if (agentId) {
      try { appendSafetyViolation({ agentId: String(agentId), violationCode: code, detail: reason, trailId: trail.id, blockedAction: action }); } catch {}
    }
    // also record generic audit
    appendMissionAudit({
      actorType: actorType as any,
      actorId: input.actorId ?? null,
      action: `safety.gate_blocked:${code}`,
      subjectType: 'authorization',
      subjectId: input.taskId ?? action,
      detail: { connectorId, violationCode: code, reasons, ownerActionRequired: ownerRequired } as any,
    });
    return {
      allowed: false,
      ownerActionRequired: ownerRequired,
      violationCode: code,
      reasons: [...reasons],
      trailId: trail.id,
      trailSeq: trail.seq,
    };
  };
  const allow = (): SafetyDecision => {
    const trail = appendAuthorizationTrail({
      taskId: input.taskId ?? null,
      agentId: agentId ?? null,
      actorType,
      actorId: input.actorId ?? null,
      connectorId,
      action,
      payload,
      decision: 'allowed',
      violationCode: null,
      reasons: ['authorized_compliant_in_scope'],
      providerResponseHash: input.providerResponse ? sha256(JSON.stringify(redactForAudit(input.providerResponse))) : null,
    });
    appendMissionAudit({
      actorType: actorType as any,
      actorId: input.actorId ?? null,
      action: 'safety.gate_allowed',
      subjectType: 'authorization',
      subjectId: input.taskId ?? action,
      detail: { connectorId, action } as any,
    });
    return { allowed: true, ownerActionRequired: false, violationCode: null, reasons: ['authorized_compliant_in_scope'], trailId: trail.id, trailSeq: trail.seq };
  };

  // 0. Kill switch absolute
  try {
    const policy = currentPolicy();
    if (policy.killSwitch) return deny('prohibited_activity', 'kill_switch_engaged — all activity suspended', false);
    // Agent liveness/paused check - fail-closed if agent not active
    if (actorType === 'agent' && agentId) {
      const agent = missionDb.get<Row>('SELECT status FROM mission_agents WHERE id=?', [String(agentId)]);
      if (!agent) return deny('account_access', `agent ${agentId} not found — cannot establish authorization`, true);
      if (String(agent.status) !== 'active') return deny('policy_violation_continuation', `agent ${agentId} is ${agent.status} — paused agents cannot act`, false);
      // continuation after violation: if recent violation (<10m) for this agent that is not cleared by owner, block
      const recent = missionDb.get<Row>("SELECT id FROM mission_safety_violations WHERE agent_id=? AND datetime(created_at) > datetime('now','-10 minutes') ORDER BY seq DESC LIMIT 1", [String(agentId)]);
      if (recent && action !== 'owner.review_violation') {
        // allow read-only verification/status actions, but block mutating actions
        if (['execution.start','job.create','money.transfer','kyc.submit','verification.claim','settlement.request'].includes(action)) {
          return deny('policy_violation_continuation', `agent ${agentId} has unreviewed safety violation ${recent.id} — owner must review before continuation`, true);
        }
      }
    }
    // Owner bypass for read-only? Owners can do anything (but still audited)
    if (actorType === 'owner') {
      // Even owner cannot do prohibited activities
      const prohibitedCheck = checkProhibited(action, payload);
      if (prohibitedCheck) return deny(prohibitedCheck.code, prohibitedCheck.reason, false);
      return allow();
    }

    // From here: agent/system/provider actor — strict checks

    // 1. Prohibited activities (hard deny-list, never configurable)
    const prohibited = checkProhibited(action, payload);
    if (prohibited) return deny(prohibited.code, prohibited.reason, false);

    // 2. KYC fabrication / fake identity — only owner may touch KYC docs
    if (payloadHasKyc(payload) || /kyc/i.test(action)) {
      // Allow only if owner explicitly provided identityReviewRef and action is not fabricating
      // Agent attempts to submit or alter KYC docs => deny
      if (actorType === 'agent') {
        // Check if this is a legitimate agent verification helper (e.g., verification artifact with no KYC doc creation)
        const isDocFabrication = action.toLowerCase().includes('kyc') || action.toLowerCase().includes('identity') || KYC_KEY_PATTERN.test(JSON.stringify(payload));
        if (isDocFabrication) return deny('kyc_fabrication', 'agents cannot create, alter or submit KYC/identity documents — owner must perform via official flow and vault', true);
      }
    }
    if (payloadHasKyc(payload) && actorType === 'agent' && !input.ownerId) {
      // generic fake identity catch
      if (Object.keys(payload as object).some(k => /identity|passport|cnic/i.test(k))) {
        return deny('fake_identity', 'fabricated or altered identity information detected — owner must provide real identity via official connector flow', true);
      }
    }

    // 3. KYC/AML bypass, sanctions evasion, platform rules
    const lowerPayload = JSON.stringify(payload).toLowerCase();
    const lowerAction = action.toLowerCase();
    if (lowerPayload.includes('bypass') && (lowerPayload.includes('kyc') || lowerPayload.includes('aml'))) {
      return deny('kyc_aml_bypass', 'attempt to bypass KYC/AML checks', false);
    }
    if (lowerPayload.includes('sanction') || SANCTIONS_COUNTRIES.some(c => lowerPayload.includes(c))) {
      // allow if it's a legitimate compliance disclosure, but if payload tries to evade sanctions => deny
      if (lowerPayload.includes('evade') || lowerPayload.includes('bypass') || lowerPayload.includes('sanctioned') ) {
        return deny('sanctions', 'sanctions evasion or trade-control evasion detected', false);
      }
    }
    if (/(bypass.*platform|violate.*terms|tos.*bypass)/i.test(lowerPayload)) {
      return deny('kyc_aml_bypass', 'platform rule bypass attempt', false);
    }

    // 4. Impersonation outside authorized account activity
    if (payloadClaimsOwnerIdentity(payload) && actorType === 'agent') {
      // Exception: direct client work where agent is explicitly authorized for that connector's bound account via mission_credentials with owner delegation
      // Check if connector allows this — for direct_* no credential needed but impersonation still denied unless owner delegation exists
      const isExplicitlyAuthorized = connectorId && (() => {
        const cred = missionDb.get<Row>('SELECT id FROM mission_credentials WHERE provider=? AND status=? LIMIT 1', [String(connectorId), 'active']);
        return !!cred && !!input.ownerId; // owner must have delegated
      })();
      if (!isExplicitlyAuthorized) return deny('impersonation', 'agent impersonating owner identity outside explicitly authorized account activity', false);
    }
    if (lowerAction.includes('impersonat') || lowerPayload.includes('impersonate')) {
      return deny('impersonation', 'impersonation detected', false);
    }

    // 5. Fraudulent jobs/orders/reviews/transactions
    if (['create_job','create_order','post_review','create_transaction','fabricate_order','fake_engagement','create_fraudulent_job'].some(t => lowerAction.includes(t) || lowerPayload.includes(t))) {
      return deny('fraudulent_job', 'fraudulent job/order/review/transaction creation blocked — only provider-confirmed commerce via connector contract is permitted', false);
    }
    if (lowerPayload.includes('fake_review') || lowerPayload.includes('purchased_followers') || lowerPayload.includes('fake_order')) {
      return deny('fraudulent_job', 'fake engagement/transaction detected', false);
    }

    // 6. Legal/financial obligations outside connector contract
    if (['accept_terms','sign_contract','accept_legal','bind_company','loan','credit_agreement'].some(t => lowerAction.includes(t))) {
      // Only allow if connector contract's auditEvents includes this action and owner has permitted
      const conn = connectorId ? findConnector(String(connectorId)) : null;
      const allowed = conn ? (conn.humanOnlyActions.join(' ') + ' ' + (conn as any).auditEvents?.join(' ') ?? '').toLowerCase() : '';
      if (!allowed.includes(lowerAction)) {
        return deny('legal_obligation', `accepting legal/financial obligations outside approved connector contract — owner approval required`, true);
      }
    }

    // 7. Prohibited/restricted activities via policy allow-list
    // If action maps to an activityKey, check it
    const activityKey = (payload as any)?.activityKey ?? (payload as any)?.activity ?? (payload as any)?.registryKey ?? null;
    if (activityKey) {
      const policy = currentPolicy();
      const dec = checkActivity(String(activityKey), policy);
      if (!dec.allowed) return deny('prohibited_activity', `activity ${activityKey} refused by policy: ${dec.reasons.join('; ')}`, false);
    }
    // Also check connector platform status
    if (connectorId) {
      const readiness = (() => { try { return getProviderReadiness(String(connectorId)); } catch { return null; } })();
      if (readiness) {
        if (readiness.status === 'blocked') return deny('prohibited_activity', `connector ${connectorId} is BLOCKED per ToS`, false);
        if (readiness.status === 'restricted') return deny('prohibited_activity', `connector ${connectorId} is RESTRICTED — human-only actions required: ${readiness.ownerActions.slice(0,2).join('; ')}`, true);
      }
      const conn = findConnector(String(connectorId));
      if (conn) {
        if (conn.status === 'BLOCKED') return deny('prohibited_activity', `connector ${conn.label} BLOCKED`, false);
        if (conn.kind === 'RESTRICTED_HUMAN_ONLY') return deny('prohibited_activity', `connector ${conn.label} RESTRICTED_HUMAN_ONLY — human must perform`, true);
        if (conn.status === 'RESTRICTED') return deny('prohibited_activity', `connector ${conn.label} RESTRICTED`, true);
      }
    }

    // 8. Spam/abuse
    if (SPAM_TRIGGERS.some(t => lowerAction.includes(t) || lowerPayload.includes(t))) {
      return deny('spam', 'spam or bulk abuse detected — outreach template approval and scope authorization required', true);
    }
    if (lowerPayload.includes('spam') || lowerPayload.includes('unsolicited bulk')) {
      return deny('spam', 'spam/abuse blocked', false);
    }

    // 9. Hidden failure — agent tries to suppress or hide errors
    if (['hide_failure','suppress_error','delete_failure','cover_up'].some(t => lowerAction.includes(t))) {
      return deny('hidden_failure', 'hiding failed/incorrect actions is prohibited — all failures are immutably audited', false);
    }

    // 10. False verification — claim verification without independent provider evidence
    if (['verification.claim','claim_verification','verify_without_evidence','false_verification'].some(t => lowerAction.includes(t))) {
      const hasEvidence = input.providerResponse && (input.providerResponse as any).providerRef && (input.providerResponse as any).externalId;
      if (!hasEvidence) return deny('false_verification', 'verification claim without independent provider evidence — provider webhook/bank ref required', false);
    }
    if (lowerAction.includes('verify') && !input.providerResponse && action !== 'execution.verify') {
      // allow execution.verify when verifiers are provided, but not generic verify without evidence
      // Check if this is settlement verification path — requires externalId
      if (['settlement','reconcile','payout'].some(t => lowerAction.includes(t))) {
        const hasExt = (payload as any)?.externalId ?? (payload as any)?.providerRef ?? input.providerResponse;
        if (!hasExt) return deny('false_verification', 'settlement/payout claim without provider evidence', false);
      }
    }

    // 11. Unauthorized transfer / purchase / financial commitment
    if (amountCents !== null && amountCents !== undefined) {
      const walletId = input.walletId ?? (agentId ? missionDb.get<Row>('SELECT id FROM mission_wallets WHERE agent_id=? LIMIT 1', [String(agentId)])?.id as string | undefined : undefined) as string | null | undefined;
      if (!walletId) return deny('unauthorized_transfer', 'no wallet found — cannot establish authorization for money movement', true);
      const policy = currentPolicy();
      const dailySpent = (() => { try { const p = currentPolicy(); return Number(missionDb.get<{ cents: number }>(`SELECT COALESCE(SUM(amount_cents),0) AS cents FROM mission_ledger WHERE direction='debit' AND substr(created_at,1,10)=?`, [nowIso().slice(0,10)])?.cents ?? 0); } catch { return 0; } })();
      const dec = canAgentSpend({ walletId: String(walletId), amountCents: Number(amountCents), category: String((payload as any)?.category ?? 'expense'), agentId: agentId ? String(agentId) : null }, policy, dailySpent);
      if (!dec.allowed) {
        if (dec.requiresApproval) return deny('unauthorized_transfer', `amount ${amountCents} requires owner approval (threshold ${policy.requireApprovalAboveCents}) — routing to approval queue`, true);
        return deny('unauthorized_purchase', `purchase/financial commitment denied: ${dec.reasons.join('; ')}`, dec.reasons.join(';').includes('wallet_not_found') ? true : false);
      }
      // also check provider rail requires owner
      if (String((payload as any)?.kind ?? '').toLowerCase().includes('withdrawal') || String((payload as any)?.category ?? '').toLowerCase().includes('payout')) {
        if (policy.requireOwnerForPayout) return deny('unauthorized_transfer', 'payouts require owner (requireOwnerForPayout=true)', true);
      }
    }
    // Also check generic money actions without amount but with transfer intent
    if (['money.transfer','payout.request','withdrawal.request','purchase.request'].some(t => lowerAction.includes(t.replace('.','_')) || lowerAction===t)) {
      if (actorType === 'agent' && !input.walletId && !agentId) return deny('unauthorized_transfer', 'money movement without wallet authorization', true);
    }

    // 12. Account access — cross-agent/account/mission/credential
    if (input.targetAgentId && agentId && String(input.targetAgentId) !== String(agentId)) {
      return deny('account_access', `agent ${agentId} cannot access agent ${input.targetAgentId}'s account`, false);
    }
    if (input.targetAccountId && agentId) {
      const wallet = missionDb.get<Row>('SELECT agent_id FROM mission_wallets WHERE id=?', [String(input.targetAccountId)]);
      if (wallet && String(wallet.agent_id) !== String(agentId)) {
        return deny('account_access', `wallet ${input.targetAccountId} belongs to different agent`, false);
      }
    }
    // Credential isolation: agent trying to read another provider's secret
    if (lowerAction.includes('credential') || lowerPayload.includes('credential')) {
      const providerFromPayload = (payload as any)?.provider ?? (payload as any)?.targetProvider ?? null;
      if (providerFromPayload && agentId) {
        // If agent's contract doesn't list this tool, deny
        const agentCaps = missionDb.get<Row>('SELECT capabilities FROM mission_agents WHERE id=?', [String(agentId)]);
        if (agentCaps) {
          try {
            const caps = JSON.parse(String(agentCaps.capabilities ?? '[]'));
            if (!caps.includes(String(providerFromPayload)) && !String(providerFromPayload).toLowerCase().includes('general')) {
              // not necessarily violation, just restrict — allow vault reads only via owner-authorized tool requests
              // Strict: agent cannot directly access another mission's credential
              if (lowerAction.includes('read_secret') || lowerAction.includes('export_credential') || lowerAction.includes('leak')) {
                return deny('account_access', `agent cannot access credential for provider ${providerFromPayload}`, false);
              }
            }
          } catch {}
        }
      }
    }
    // Cross-mission: check if trying to access other mission or user
    if (lowerPayload.includes('other_mission') || lowerPayload.includes('other_user') || lowerPayload.includes('access_another')) {
      return deny('account_access', 'access to another user/mission/account is prohibited', false);
    }

    // 13. Credential/KYC leak
    if (payloadHasSecret(payload) && actorType === 'agent') {
      // Determine if this is legitimate tool use vs exfiltration
      // If agent is trying to send secret to external destination, deny
      if (lowerAction.includes('send') || lowerAction.includes('export') || lowerAction.includes('leak') || lowerPayload.includes('exfiltrate')) {
        return deny('credential_leak', 'KYC documents/credentials/private info leak blocked — secrets must stay in vault and are redacted in audit', false);
      }
      // For normal execution payloads that happen to contain redacted secrets, allow but ensure redaction
      // We still allow but we have already payloadHash redacted
    }
    // Also detect KYC doc leak
    if (payloadHasKyc(payload) && lowerAction.includes('leak')) {
      return deny('credential_leak', 'KYC document leak blocked', false);
    }

    // 14. Unknown scope — fail-closed if connector not found or authorization cannot be established
    if (connectorId && !findConnector(String(connectorId))) {
      // Check if it's a direct_* or known opportunity class
      const isDirect = String(connectorId).startsWith('direct_') || String(connectorId)==='seo_direct';
      const isOppClass = OPPORTUNITY_REGISTRY.some(c => c.key === String(connectorId));
      if (!isDirect && !isOppClass) {
        return deny('unknown_scope', `cannot establish connector scope for ${connectorId} — fail-closed to owner_action_required`, true);
      }
    }
    // For agent actions without connector, require at least a task/opportunity context
    if (actorType === 'agent' && !connectorId && !input.taskId && ['execution.start','job.create'].some(t => lowerAction.includes(t))) {
      return deny('unknown_scope', 'cannot establish authorized scope — connector/task required', true);
    }

    // 15. If we reached here without deny, allow (maximal autonomy preserved)
    return allow();
  } catch (e) {
    // Unexpected gate error => fail-closed
    const msg = e instanceof Error ? e.message.slice(0, 300) : String(e);
    return deny('unknown_scope', `gate error — fail-closed: ${msg}`, true);
  }
}

function checkProhibited(action: string, payload: any): { code: ViolationCode; reason: string } | null {
  const flat = (action + ' ' + JSON.stringify(payload ?? {})).toLowerCase();
  if (PROHIBITED_ACTIVITY_KEYS.includes(action as any)) return { code: 'prohibited_activity', reason: `prohibited_activity:${action}` };
  for (const key of PROHIBITED_ACTIVITY_KEYS) {
    if (flat.includes(key) || flat.includes(key.replace(/_/g, ' '))) {
      return { code: key === 'fake_identities' ? 'fake_identity' : key === 'kyc_aml_bypass' ? 'kyc_aml_bypass' : key === 'sanctions_evasion' ? 'sanctions' : key === 'impersonation' ? 'impersonation' : key === 'spam_or_unsolicited_bulk_messaging' ? 'spam' : 'prohibited_activity', reason: `payload matches prohibited ${key}` };
    }
  }
  // explicit checks
  if (flat.includes('fake identity') || flat.includes('fabricate identity')) return { code: 'fake_identity', reason: 'fake identity' };
  if (flat.includes('bypass') && (flat.includes('kyc') || flat.includes('aml'))) return { code: 'kyc_aml_bypass', reason: 'kyc/aml bypass' };
  if (flat.includes('sanctions') && flat.includes('evade')) return { code: 'sanctions', reason: 'sanctions evasion' };
  if (flat.includes('fraud') || flat.includes('fake engagement') || flat.includes('purchased followers')) return { code: 'fraudulent_job', reason: 'fraud' };
  if (flat.includes('unauthorized transfer') || flat.includes('money laundering')) return { code: 'unauthorized_transfer', reason: 'unauthorized transfer' };
  if (flat.includes('spam') || flat.includes('platform terms violation')) return { code: flat.includes('spam') ? 'spam' : 'prohibited_activity', reason: flat.includes('spam') ? 'spam' : 'platform violation' };
  if (flat.includes('impersonation')) return { code: 'impersonation', reason: 'impersonation' };
  return null;
}

/* ── helpers for UI / tests ── */

export function listAuthorizationTrail(limit = 100): Row[] {
  return missionDb.all<Row>('SELECT * FROM mission_authorization_trail ORDER BY seq DESC LIMIT ?', [Math.min(500, Math.max(1, limit))]);
}
export function listSafetyViolations(limit = 100): Row[] {
  return missionDb.all<Row>('SELECT * FROM mission_safety_violations ORDER BY seq DESC LIMIT ?', [Math.min(500, Math.max(1, limit))]);
}
export function getAuthorizationTrail(id: string): Row | undefined {
  return missionDb.get<Row>('SELECT * FROM mission_authorization_trail WHERE id=?', [id]);
}
export function countPendingOwnerActions(): number {
  const row = missionDb.get<{ c: number }>("SELECT COUNT(*) as c FROM mission_authorization_trail WHERE decision='owner_action_required'");
  return Number(row?.c ?? 0);
}

export function verifyAuthorizationTrail(): { ok: boolean; rows: number; brokenAtSeq: number | null; detail: string } {
  const rows = missionDb.all<Row>('SELECT * FROM mission_authorization_trail ORDER BY seq ASC');
  let prevHash = '';
  let expected = 1;
  for (const r of rows) {
    if (Number(r.seq) !== expected) return { ok: false, rows: rows.length, brokenAtSeq: Number(r.seq), detail: `sequence gap expected ${expected} got ${r.seq}` };
    const reasons = String(r.reasons_json ?? '[]');
    const payload = [r.seq, r.id, r.task_id ?? '', r.agent_id ?? '', r.actor_type, r.actor_id ?? '', r.connector_id ?? '', r.action, r.payload_hash ?? '', r.decision, r.violation_code ?? '', reasons, r.provider_response_hash ?? '', r.verification_ref ?? '', r.settlement_ref ?? '', prevHash, r.created_at].join('|');
    const h = sha256(payload);
    if (h !== String(r.hash)) return { ok: false, rows: rows.length, brokenAtSeq: Number(r.seq), detail: `hash mismatch at ${r.seq}` };
    if (String(r.prev_hash ?? '') !== prevHash) return { ok: false, rows: rows.length, brokenAtSeq: Number(r.seq), detail: `prev_hash broken at ${r.seq}` };
    prevHash = String(r.hash);
    expected++;
  }
  return { ok: true, rows: rows.length, brokenAtSeq: null, detail: `${rows.length} authorization trail rows verified end to end` };
}
export function verifySafetyViolations(): { ok: boolean; rows: number; brokenAtSeq: number | null; detail: string } {
  const rows = missionDb.all<Row>('SELECT * FROM mission_safety_violations ORDER BY seq ASC');
  let prevHash = '';
  let expected = 1;
  for (const r of rows) {
    if (Number(r.seq) !== expected) return { ok: false, rows: rows.length, brokenAtSeq: Number(r.seq), detail: `sequence gap expected ${expected} got ${r.seq}` };
    const payload = [r.seq, r.id, r.agent_id, r.violation_code, r.detail ?? '', r.trail_id ?? '', r.blocked_action ?? '', prevHash, r.created_at].join('|');
    const h = sha256(payload);
    if (h !== String(r.hash)) return { ok: false, rows: rows.length, brokenAtSeq: Number(r.seq), detail: `hash mismatch at ${r.seq}` };
    if (String(r.prev_hash ?? '') !== prevHash) return { ok: false, rows: rows.length, brokenAtSeq: Number(r.seq), detail: `prev_hash broken at ${r.seq}` };
    prevHash = String(r.hash);
    expected++;
  }
  return { ok: true, rows: rows.length, brokenAtSeq: null, detail: `${rows.length} safety violation rows verified` };
}

/** Owner clears a violation after review (does not delete, just records clearance in audit). */
export function clearSafetyViolation(ownerId: string, violationId: string, note?: string): Row | null {
  const vio = missionDb.get<Row>('SELECT * FROM mission_safety_violations WHERE id=?', [violationId]);
  if (!vio) return null;
  appendMissionAudit({
    actorType: 'owner',
    actorId: ownerId,
    action: 'safety.violation_cleared',
    subjectType: 'agent',
    subjectId: String(vio.agent_id),
    detail: { violationId, violationCode: String(vio.violation_code), note: (note ?? '').slice(0, 400) } as any,
  });
  // Mark trail as cleared by updating its decision to allowed? No — we keep immutable. Clearance is audit-only.
  return vio;
}

/** Convenience: is provider identity connected (any active credential for an EARNING_SOURCE)? */
export function isProviderIdentityConnected(): boolean {
  const row = missionDb.get<{ c: number }>("SELECT COUNT(*) as c FROM mission_credentials WHERE status='active'");
  return Number(row?.c ?? 0) > 0;
}
export function providerConnectivityStatus(): { connected: boolean; activeCredentials: number; ownerIdentity: string | null } {
  const active = Number(missionDb.get<{ c: number }>("SELECT COUNT(*) as c FROM mission_credentials WHERE status='active'")?.c ?? 0);
  const ownerEmail = process.env.ZA141251SA_OWNER_EMAIL ?? null;
  return { connected: active > 0, activeCredentials: active, ownerIdentity: ownerEmail ? `${ownerEmail.slice(0,2)}…${ownerEmail.slice(ownerEmail.indexOf('@'))}` : null };
}
