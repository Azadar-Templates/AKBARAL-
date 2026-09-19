import { missionDb, missionId, nowIso, appendMissionAudit, type Row } from './database';
import { MissionSelfServiceError } from './self-management';

/** Durable correspondence only. A message is never a tool/payment instruction. */
export function appendAgentMessage(input: { agentId: string; actorType: 'owner' | 'agent'; actorId: string; body: string; idempotencyKey: string; replyTo?: string | null }): { message: Row; duplicate: boolean; commandExecuted: false } {
  return missionDb.transaction(() => {
    const agent = missionDb.get<Row>('SELECT id, status FROM mission_agents WHERE id = ?', [input.agentId]);
    if (!agent) throw new MissionSelfServiceError(404, 'agent not found', 'not_found');
    if (!['owner', 'agent'].includes(input.actorType) || !input.actorId) throw new MissionSelfServiceError(403, 'a trusted owner or bound agent identity is required', 'forbidden');
    if (input.actorType === 'agent' && (input.actorId !== input.agentId || agent.status !== 'active')) throw new MissionSelfServiceError(403, 'agent identity or state does not permit this reply', 'forbidden');
    const body = input.body.trim();
    const key = input.idempotencyKey.trim();
    if (!body || body.length > 12000 || key.length < 8 || key.length > 160) throw new MissionSelfServiceError(400, 'message must contain 1–12000 characters and an 8–160 character idempotency key', 'validation_error');
    const prior = missionDb.get<Row>('SELECT * FROM mission_agent_messages WHERE agent_id = ? AND actor_id = ? AND idempotency_key = ?', [input.agentId, input.actorId, key]);
    if (prior) {
      if (prior.body !== body || (prior.reply_to ?? null) !== (input.replyTo ?? null) || prior.actor_type !== input.actorType) throw new MissionSelfServiceError(409, 'message idempotency key belongs to different content', 'idempotency_conflict');
      return { message: prior, duplicate: true, commandExecuted: false };
    }
    if (input.replyTo && !missionDb.get('SELECT id FROM mission_agent_messages WHERE id = ? AND agent_id = ?', [input.replyTo, input.agentId])) throw new MissionSelfServiceError(409, 'reply target is not in this agent conversation', 'conflict');
    const id = missionId('msg');
    const seq = Number(missionDb.get<{ n: number }>('SELECT COALESCE(MAX(seq), 0) AS n FROM mission_agent_messages')!.n) + 1;
    missionDb.run('INSERT INTO mission_agent_messages (id, seq, agent_id, actor_type, actor_id, body, reply_to, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, seq, input.agentId, input.actorType, input.actorId, body, input.replyTo ?? null, key, nowIso()]);
    appendMissionAudit({ actorType: input.actorType, actorId: input.actorId, action: 'agent.message_recorded', subjectType: 'agent', subjectId: input.agentId, detail: { messageId: id, characters: body.length, replyTo: input.replyTo ?? null, commandExecuted: false } });
    return { message: missionDb.get<Row>('SELECT * FROM mission_agent_messages WHERE id = ?', [id])!, duplicate: false, commandExecuted: false };
  });
}

export function listAgentMessages(agentId: string, afterSeq = 0, limit = 100): { messages: Row[]; nextCursor: number; hasMore: boolean; automaticReplies: false } {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new MissionSelfServiceError(400, 'invalid message cursor or limit (1–100)', 'validation_error');
  const rows = missionDb.all<Row>('SELECT * FROM mission_agent_messages WHERE agent_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?', [agentId, afterSeq, limit + 1]);
  const messages = rows.slice(0, limit);
  return { messages, nextCursor: messages.length ? Number(messages[messages.length - 1].seq) : afterSeq, hasMore: rows.length > limit, automaticReplies: false };
}
