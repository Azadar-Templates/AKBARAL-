import { missionDb, nowIso, appendMissionAudit, sha256, type Row } from './database';
import { agentChatConfig, assertAgentChatReady, chatResourcePreflight, type AgentChatConfig } from './chat-state';
import { appendAgentMessage } from './messaging';
import { reserveResourceCall, cancelResourceCall, markResourceCallUncertain, runResourceCall, type ReserveResourceCall } from './resource-calls';
import { chatTokenReservation, invokeGoogleChat, type ChatAdapter } from './chat-provider';
import { MissionSelfServiceError } from './self-management';

function finishJob(job: Row, status: string, reason: string | null = null, replyId: string | null = null): void {
  missionDb.run('UPDATE mission_agent_chat_jobs SET status = ?, reason = ?, reply_message_id = ?, resolved_at = ? WHERE id = ?', [status, reason, replyId, nowIso(), job.id]);
  appendMissionAudit({ actorType: 'agent', actorId: String(job.agent_id), action: `agent.chat_${status}`, subjectType: 'agent', subjectId: String(job.agent_id), detail: { jobId: job.id, callId: job.call_id ?? null, reason, commandExecuted: false } });
}
/** Crash recovery never repeats an already-dispatched provider operation. */
export function recoverAgentChatJobs(): number {
  return missionDb.transaction(() => {
    const cutoff = new Date(Date.now() - 120000).toISOString();
    const rows = missionDb.all<Row>("SELECT * FROM mission_agent_chat_jobs WHERE status = 'running' AND started_at < ? ORDER BY started_at LIMIT 100", [cutoff]);
    for (const job of rows) {
      const call = missionDb.get<Row>('SELECT status FROM mission_resource_calls WHERE id = ?', [job.call_id!]);
      const actor = { actorType: 'agent' as const, actorId: String(job.agent_id) };
      if (call?.status === 'reserved') cancelResourceCall(String(job.call_id), actor);
      if (call?.status === 'dispatched') markResourceCallUncertain(String(job.call_id), actor);
      finishJob(job, 'needs_review', 'worker_interrupted_no_automatic_replay');
    }
    return rows.length;
  });
}
export async function runNextAgentChat(adapter: ChatAdapter = invokeGoogleChat): Promise<Row | null> {
  recoverAgentChatJobs();
  const claimed = missionDb.transaction(() => {
    const job = missionDb.get<Row>("SELECT * FROM mission_agent_chat_jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1");
    if (!job) return null;
    const config = JSON.parse(String(job.config_snapshot)) as AgentChatConfig;
    const message = missionDb.get<Row>('SELECT * FROM mission_agent_messages WHERE id = ?', [job.message_id]);
    const actor = { actorType: 'agent' as const, actorId: String(job.agent_id) };
    try {
      if (!message || message.actor_type !== 'owner' || message.agent_id !== job.agent_id || sha256(String(message.body)) !== job.message_fingerprint || Buffer.byteLength(String(message.body), 'utf8') > config.maxInputBytes) throw new MissionSelfServiceError(409, 'message is unavailable or exceeds the configured byte bound', 'chat_message_unavailable');
      if (missionDb.get("SELECT id FROM mission_agent_messages WHERE reply_to = ? AND actor_type = 'agent'", [message.id])) { finishJob(job, 'superseded', 'agent_already_replied'); return { job }; }
      chatResourcePreflight(String(job.agent_id), config);
      const input: ReserveResourceCall = { resourceId: config.resourceId, agentId: String(job.agent_id), ...actor, idempotencyKey: `chat:${job.id}`, operationFingerprint: sha256(JSON.stringify({ message: message.body, config, instructionVersion: 1 })), units: { requests: 1, tokens: chatTokenReservation(String(message.body), config) }, budget: { walletId: config.walletId, maxCostCents: config.maxCostCents } };
      const call = reserveResourceCall(input);
      missionDb.run("UPDATE mission_agent_chat_jobs SET status = 'running', call_id = ?, started_at = ? WHERE id = ?", [call.id, nowIso(), job.id]);
      return { job: { ...job, call_id: call.id } as Row, input, body: String(message.body), config };
    } catch (error) {
      if (!(error instanceof MissionSelfServiceError)) throw error;
      finishJob(job, 'blocked', error.code);
      return { job };
    }
  });
  if (!claimed) return null;
  const { job } = claimed;
  if (claimed.input && claimed.config && claimed.body) {
    try {
      const config = claimed.config;
      const result = await runResourceCall(claimed.input, async (permit, signal) => {
        assertAgentChatReady(String(job.agent_id), config);
        return adapter(permit, signal, { body: claimed.body!, config });
      });
      missionDb.transaction(() => {
        const live = missionDb.get<Row>('SELECT status FROM mission_agent_chat_jobs WHERE id = ?', [job.id]);
        if (live?.status !== 'running') return; // A recovery/operator decision wins.
        assertAgentChatReady(String(job.agent_id), config);
        if (JSON.stringify(agentChatConfig(String(job.agent_id))) !== job.config_snapshot) throw new MissionSelfServiceError(409, 'chat authority changed', 'chat_unavailable');
        if (missionDb.get("SELECT id FROM mission_agent_messages WHERE reply_to = ? AND actor_type = 'agent'", [job.message_id])) { finishJob(job, 'superseded', 'agent_already_replied'); return; }
        const reply = appendAgentMessage({ agentId: String(job.agent_id), actorType: 'agent', actorId: String(job.agent_id), body: result.value, idempotencyKey: `chat-reply:${job.id}`, replyTo: String(job.message_id) });
        finishJob(job, 'succeeded', null, String(reply.message.id));
      });
    } catch (error) {
      missionDb.transaction(() => {
        if (missionDb.get<Row>('SELECT status FROM mission_agent_chat_jobs WHERE id = ?', [job.id])?.status !== 'running') return;
        const call = missionDb.get<Row>('SELECT status FROM mission_resource_calls WHERE id = ?', [job.call_id!]);
        finishJob(job, call?.status === 'cancelled' ? 'blocked' : 'needs_review', error instanceof MissionSelfServiceError ? error.code : 'worker_error');
      });
    }
  }
  return missionDb.get<Row>('SELECT * FROM mission_agent_chat_jobs WHERE id = ?', [job.id])!;
}
