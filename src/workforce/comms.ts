import { getAgentBySlug } from '../agents/registry';
import { recordEconomyEvent } from '../db/economy-repositories';
import { currentPolicy } from '../economy/policy';
import { runTool } from '../tools';
import { getComm, insertComm, maskRecipient, updateComm, type CommRow } from './repositories';

/**
 * WORKFORCE CUSTOMER COMMUNICATIONS — legitimate contact only.
 *
 *   · Every outbound message is REQUESTED first (never sent silently).
 *   · Restricted channels (email/sms/social_dm) ALWAYS need owner approval.
 *   · Platform messages (freelance/marketplace in-platform threads) need owner
 *     approval unless the policy explicitly allows the template AND the
 *     recipient consented (documented in consent_basis).
 *   · Sends go through the real provider tools, which refuse without
 *     credentials — no fake "sent" states exist.
 *   · Recipients are stored masked; full addresses never hit listings/logs.
 */

export const COMMS_CHANNELS = ['platform_message', 'email', 'sms', 'social_dm'] as const;
export type CommsChannel = (typeof COMMS_CHANNELS)[number];

/** Owner-approved templates. Freeform is representable ONLY as owner-approved at decision time. */
export const COMMS_TEMPLATES = [
  'proposal-intro', 'proposal-followup', 'delivery-notice', 'support-reply',
  'order-update', 'service-inquiry', 'freeform-owner-approved',
] as const;

export class CommsError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = 'CommsError';
  }
}

export function requestComm(input: {
  agentSlug: string;
  channel: string;
  /** Full recipient (used once at send time; stored masked). */
  recipient: string;
  template: string;
  contentPreview: string;
  consentBasis: string;
  executionId?: string | null;
  opportunityId?: string | null;
}): CommRow {
  const agent = getAgentBySlug(input.agentSlug);
  if (!agent) throw new CommsError(404, 'agent_not_found', `agent "${input.agentSlug}" does not exist`);
  if (!(COMMS_CHANNELS as readonly string[]).includes(input.channel)) {
    throw new CommsError(400, 'invalid_channel', `channel must be one of ${COMMS_CHANNELS.join(', ')}`);
  }
  if (!(COMMS_TEMPLATES as readonly string[]).includes(input.template)) {
    throw new CommsError(400, 'invalid_template', `template must be one of ${COMMS_TEMPLATES.join(', ')}`);
  }
  if (!input.recipient.trim()) throw new CommsError(400, 'invalid_request', 'recipient is required');
  if (input.contentPreview.trim().length < 10) throw new CommsError(400, 'invalid_request', 'content preview is required (min 10 chars)');
  if (input.consentBasis.trim().length < 10) {
    throw new CommsError(400, 'consent_required', 'consent_basis is required: explain why this contact is legitimate (customer request, platform thread, consented list)');
  }
  if (/bulk|blast|scrape|purchased.?list|cold.?spam/i.test(input.consentBasis)) {
    throw new CommsError(400, 'bulk_messaging_refused', 'bulk/unsolicited messaging is not representable in this system');
  }
  const policy = currentPolicy();
  if (policy.killSwitch) throw new CommsError(409, 'kill_switch_engaged', 'kill switch engaged — no outbound contact');
  const row = insertComm({
    executionId: input.executionId ?? null,
    opportunityId: input.opportunityId ?? null,
    agentSlug: input.agentSlug,
    channel: input.channel,
    recipientMasked: maskRecipient(input.channel, input.recipient),
    template: input.template,
    contentPreview: input.contentPreview,
    consentBasis: input.consentBasis,
  });
  recordEconomyEvent({
    kind: 'security', actor: input.agentSlug,
    summary: `outbound ${input.channel} REQUESTED by ${input.agentSlug} (template ${input.template}) — awaiting owner decision`,
    details: { commId: row.id },
  });
  return row;
}

export function decideComm(id: string, decision: 'approve' | 'reject', decidedBy: string): CommRow {
  const row = getComm(id);
  if (!row) throw new CommsError(404, 'not_found', 'communication request not found');
  if (row.status !== 'requested') throw new CommsError(409, 'decision_final', `request is already ${row.status}`);
  updateComm(id, { status: decision === 'approve' ? 'approved' : 'rejected', decided_by: decidedBy, decided_at: new Date().toISOString() });
  recordEconomyEvent({
    kind: 'security', actor: decidedBy,
    summary: `outbound ${row.channel} ${decision === 'approve' ? 'APPROVED' : 'REJECTED'} by owner (${row.id})`,
  });
  return getComm(id)!;
}

/**
 * Send an APPROVED request through the real provider tool. The caller supplies
 * the full recipient + body (the stored row keeps only the masked reference +
 * preview). Without provider credentials the tool refuses honestly and the
 * request is marked failed — never "sent".
 */
export async function sendApprovedComm(id: string, input: { recipient: string; body: string; from?: string }): Promise<CommRow> {
  const row = getComm(id);
  if (!row) throw new CommsError(404, 'not_found', 'communication request not found');
  if (row.status !== 'approved') throw new CommsError(409, 'not_approved', `only approved requests can be sent (status: ${row.status})`);
  const policy = currentPolicy();
  if (policy.killSwitch) throw new CommsError(409, 'kill_switch_engaged', 'kill switch engaged');
  try {
    if (row.channel === 'sms') {
      if (!input.from) throw new CommsError(400, 'invalid_request', 'sender identity (from) is required for sms');
      const result = await runTool('twilio_message', { to: input.recipient, from: input.from, body: input.body }, { userId: '', projectId: null, taskId: null, executionId: row.execution_id });
      if (!result.ok) throw new CommsError(502, result.code ?? 'provider_failed', result.error ?? 'sms provider failed');
      updateComm(id, { status: 'sent', provider_ref: `twilio:${JSON.stringify(result.data ?? {}).slice(0, 200)}` });
    } else if (row.channel === 'email') {
      // Email goes through SMTP (owner-configured). No SMTP tool key exists, so
      // the send is refused honestly until the provider path is connected.
      const { sendWorkforceEmail } = await import('./email');
      const ref = await sendWorkforceEmail({ to: input.recipient, subject: `[Workforce] ${row.template}`, text: input.body });
      updateComm(id, { status: 'sent', provider_ref: ref });
    } else {
      // platform_message / social_dm: sent by the owner through the platform's
      // own authenticated session (agents never hold platform credentials).
      // The owner confirms the real send with the platform's message reference.
      throw new CommsError(409, 'owner_send_required', 'platform/social messages are sent by the owner in the platform session; confirm with confirmCommSent(providerRef)');
    }
  } catch (error) {
    if (error instanceof CommsError && error.code === 'owner_send_required') throw error;
    const message = error instanceof Error ? error.message : String(error);
    updateComm(id, { status: 'failed', error_message: message.slice(0, 500) });
    recordEconomyEvent({ kind: 'security', actor: 'system', summary: `outbound ${row.channel} FAILED (${row.id}): ${message.slice(0, 200)}` });
    throw error instanceof CommsError ? error : new CommsError(502, 'provider_failed', message);
  }
  recordEconomyEvent({ kind: 'security', actor: 'system', summary: `outbound ${row.channel} SENT (${row.id}) with provider reference` });
  return getComm(id)!;
}

/** Owner confirmation for a platform/social message they sent themselves. */
export function confirmCommSent(id: string, providerRef: string, confirmedBy: string): CommRow {
  const row = getComm(id);
  if (!row) throw new CommsError(404, 'not_found', 'communication request not found');
  if (row.status !== 'approved') throw new CommsError(409, 'not_approved', `only approved requests can be confirmed (status: ${row.status})`);
  if (!providerRef.trim()) throw new CommsError(400, 'evidence_required', 'provider message reference is required — sends are never claimed without one');
  updateComm(id, { status: 'sent', provider_ref: providerRef.slice(0, 300) });
  recordEconomyEvent({ kind: 'security', actor: confirmedBy, summary: `outbound ${row.channel} confirmed sent by owner (${row.id})` });
  return getComm(id)!;
}
