import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from '../db';
import type { ChatMessage } from '../models/client';
import { modelRouter } from '../models/router';
import { asyncRoute, HttpError } from '../server/http';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { rateLimit } from '../server/middleware/rate-limit';
import { getBody } from '../server/middleware/validation';

interface ConversationRow {
  id: string;
  title: string;
  model_key: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model_key: string | null;
  created_at: string;
}

function now() {
  return new Date().toISOString();
}

function publicChatFailure(code: string | undefined) {
  if (code === 'provider_rate_limited' || code === 'rate_limited') {
    return { code: 'quota_unavailable', message: 'Provider quota temporarily unavailable. Please try again in a few minutes. No task credit was deducted.' };
  }
  if (code === 'provider_not_configured') {
    return { code: 'chat_unavailable', message: 'Chat is not available on this deployment yet. No task credit was deducted.' };
  }
  return { code: 'chat_failed', message: "We couldn't complete this chat response right now. No task credit was deducted." };
}

function titleFor(content: string) {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
}

/** Server-owned, per-user Chat history and streaming. Chat never touches credits. */
export function createChatRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req: AuthenticatedRequest, res) => {
    const rows = db.all<ConversationRow>(
      `SELECT id, title, model_key, created_at, updated_at
         FROM chat_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100`,
      [req.auth!.userId],
    );
    res.status(200).json({ conversations: rows.map((row) => ({
      id: row.id,
      title: row.title,
      model: row.model_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) });
  });

  router.get('/:id', (req: AuthenticatedRequest, res) => {
    const conversation = db.get<ConversationRow>(
      `SELECT id, title, model_key, created_at, updated_at
         FROM chat_conversations WHERE id = ? AND user_id = ?`,
      [req.params.id, req.auth!.userId],
    );
    if (!conversation) throw new HttpError(404, 'conversation not found', 'not_found');
    const messages = db.all<MessageRow>(
      `SELECT id, role, content, model_key, created_at
         FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      [conversation.id],
    );
    res.status(200).json({
      conversation: { id: conversation.id, title: conversation.title, model: conversation.model_key },
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        model: message.model_key,
        createdAt: message.created_at,
      })),
    });
  });

  router.delete('/:id', (req: AuthenticatedRequest, res) => {
    const row = db.get<{ id: string }>('SELECT id FROM chat_conversations WHERE id = ? AND user_id = ?', [req.params.id, req.auth!.userId]);
    if (!row) throw new HttpError(404, 'conversation not found', 'not_found');
    db.run('DELETE FROM chat_conversations WHERE id = ? AND user_id = ?', [req.params.id, req.auth!.userId]);
    res.status(200).json({ deleted: true, id: req.params.id });
  });

  router.post(
    '/stream',
    rateLimit({ prefix: 'chat-stream', max: 30, windowMs: 60_000 }),
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const body = getBody(req);
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gemini-3.8-flash';
      const requestedId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
      if (!content || content.length > 20_000) throw new HttpError(400, 'content must be between 1 and 20000 characters', 'validation_error');

      const timestamp = now();
      let conversationId = requestedId;
      if (conversationId) {
        const owned = db.get<{ id: string }>('SELECT id FROM chat_conversations WHERE id = ? AND user_id = ?', [conversationId, req.auth!.userId]);
        if (!owned) throw new HttpError(404, 'conversation not found', 'not_found');
      } else {
        conversationId = `chat_${randomUUID()}`;
        db.run(
          `INSERT INTO chat_conversations (id, user_id, title, model_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [conversationId, req.auth!.userId, titleFor(content), model, timestamp, timestamp],
        );
      }

      db.run(
        `INSERT INTO chat_messages (id, conversation_id, role, content, model_key, created_at)
         VALUES (?, ?, 'user', ?, ?, ?)`,
        [`msg_${randomUUID()}`, conversationId, content, model, timestamp],
      );
      db.run('UPDATE chat_conversations SET model_key = ?, updated_at = ? WHERE id = ?', [model, timestamp, conversationId]);

      const history = db.all<MessageRow>(
        `SELECT id, role, content, model_key, created_at FROM chat_messages
         WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 40`,
        [conversationId],
      );
      const messages: ChatMessage[] = history.map((message) => ({ role: message.role, content: message.content }));

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (payload: Record<string, unknown>) => {
        if (!res.destroyed) res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      send({ type: 'start', conversationId, model, creditsUsed: 0 });

      let text = '';
      let stopped = false;
      res.on('close', () => {
        if (!res.writableEnded) stopped = true;
      });

      try {
        const result = await modelRouter.completeStreaming({ preferredModelKey: model }, messages, (token) => {
          if (stopped) return;
          text += token;
          send({ type: 'token', token });
        });
        if (!stopped) {
          const finalText = text || result.text;
          db.run(
            `INSERT INTO chat_messages (id, conversation_id, role, content, model_key, created_at)
             VALUES (?, ?, 'assistant', ?, ?, ?)`,
            [`msg_${randomUUID()}`, conversationId, finalText, result.model, now()],
          );
          db.run('UPDATE chat_conversations SET updated_at = ? WHERE id = ?', [now(), conversationId]);
          send({ type: 'done', conversationId, model: result.model, text: finalText, creditsUsed: 0 });
        }
      } catch (error) {
        const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
        send({ type: 'error', ...publicChatFailure(code), conversationId, creditsUsed: 0 });
      }
      res.end();
    }),
  );

  return router;
}
