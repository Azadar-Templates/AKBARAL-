import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from '../db';
import type { ChatMessage } from '../models/client';
import { MODEL_SPECS, modelAvailable, modelRequiredCredential, type ModelSpec } from '../models/catalog';
import { modelRouter } from '../models/router';
import { runTool } from '../tools';
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

interface AttachmentRow {
  id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
}

/** Hard ceiling on attachments per message; mirrors the Work pipeline. */
const MAX_CHAT_ATTACHMENTS = 5;
/** Ceiling on extracted characters injected per attachment. */
const MAX_ATTACHMENT_CHARS = 20_000;

function modelSpecFor(key: string): ModelSpec | null {
  return MODEL_SPECS.find((spec) => spec.key === key) ?? null;
}

/**
 * Attachment capability is read from the model catalog — never hardcoded and
 * never assumed. A model qualifies only when its catalog entry declares vision
 * or a multimodal/image modality. Everything else is reported to the client as
 * `model_does_not_support_attachments` so the composer can disable the upload
 * control with the real reason instead of accepting a file the model will
 * never receive.
 */
function attachmentSupport(key: string): { supported: boolean; reason: string | null; detail: string } {
  const spec = modelSpecFor(key);
  if (!spec) {
    return { supported: false, reason: 'model_not_in_catalog', detail: `Model "${key}" is not in the server catalog.` };
  }
  const supported = spec.capabilities.includes('vision') || spec.modality === 'multimodal' || spec.modality === 'image';
  if (supported) return { supported: true, reason: null, detail: `${spec.name} accepts attachments.` };
  return {
    supported: false,
    reason: 'model_does_not_support_attachments',
    detail: `${spec.name} declares no vision or multimodal capability in the catalog, so attachments cannot be sent to it.`,
  };
}

/**
 * Resolve each attachment into content that is GENUINELY handed to the model.
 *
 * Honest transport disclosure: the provider interface used by this deployment
 * (`ChatMessage.content`) carries text only. Files whose text can really be
 * extracted are delivered as `extracted_text`. Binary payloads (image pixels)
 * are NOT transmitted — they are reported as `metadata_only`, and the system
 * block tells the model explicitly that it cannot see them. Nothing is ever
 * described, summarised, or invented on the model's behalf.
 */
async function resolveAttachments(rows: AttachmentRow[], userId: string) {
  const resolved: Array<{ id: string; name: string; mime: string; bytes: number; delivery: 'extracted_text' | 'metadata_only'; reason: string | null; characters: number }> = [];
  const blocks: string[] = [];
  for (const row of rows) {
    const mime = String(row.mime_type ?? 'application/octet-stream');
    const parsed = await runTool('file_parse_text', { file: row.id, mime_type: mime }, { userId });
    const text = parsed.ok ? parsed.content.trim().slice(0, MAX_ATTACHMENT_CHARS) : '';
    if (text) {
      resolved.push({ id: row.id, name: row.original_name, mime, bytes: Number(row.size_bytes ?? 0), delivery: 'extracted_text', reason: null, characters: text.length });
      blocks.push(`FILE "${row.original_name}" (${mime}, ${Number(row.size_bytes ?? 0)} bytes) — real extracted text follows:\n${text}`);
    } else {
      const reason = parsed.ok ? 'no_extractable_text' : String(parsed.code ?? 'tool_failed');
      resolved.push({ id: row.id, name: row.original_name, mime, bytes: Number(row.size_bytes ?? 0), delivery: 'metadata_only', reason, characters: 0 });
      blocks.push(
        `FILE "${row.original_name}" (${mime}, ${Number(row.size_bytes ?? 0)} bytes) — content NOT transmitted (${reason}). ` +
          'This deployment sends text to the provider; binary/pixel data was not included. ' +
          'Do not claim to have seen this file — ask the user to describe it if the answer depends on it.',
      );
    }
  }
  const systemBlock = blocks.length > 0 ? `USER ATTACHMENTS (${blocks.length}):\n\n${blocks.join('\n\n')}` : null;
  return { resolved, systemBlock };
}

/** Escape LIKE wildcards so a literal % or _ in a search term stays literal. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
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
    // Optional `?q=` search across the caller's own titles and message bodies.
    // Parameterised LIKE only; a blank query keeps the plain recency list.
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
    const rows = query
      ? db.all<ConversationRow>(
          `SELECT id, title, model_key, created_at, updated_at
             FROM chat_conversations
            WHERE user_id = ?
              AND (title LIKE ? ESCAPE '\\'
                   OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = chat_conversations.id AND m.content LIKE ? ESCAPE '\\'))
            ORDER BY updated_at DESC LIMIT 100`,
          [req.auth!.userId, `%${escapeLike(query)}%`, `%${escapeLike(query)}%`],
        )
      : db.all<ConversationRow>(
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

  // Declared BEFORE '/:id' so the literal path is never swallowed by the
  // parameterised route. Catalog truth only: which models can actually accept
  // an attachment, and the exact reason when they cannot.
  router.get('/attachment-support', (_req: AuthenticatedRequest, res) => {
    res.status(200).json({
      maxAttachments: MAX_CHAT_ATTACHMENTS,
      transport: 'text',
      models: MODEL_SPECS.filter((spec) => spec.capability === 'llm').map((spec) => {
        const support = attachmentSupport(spec.key);
        return {
          key: spec.key,
          name: spec.name,
          supportsAttachments: support.supported,
          reason: support.reason,
          detail: support.detail,
          available: modelAvailable(spec),
          requiredEnvKey: modelRequiredCredential(spec),
        };
      }),
    });
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

      // Attachments: owner-verified ids only. A file the caller does not own is
      // a 404 before anything is persisted or streamed.
      const rawAttachmentIds = Array.isArray(body.attachment_file_ids)
        ? (body.attachment_file_ids as unknown[]).filter((id): id is string => typeof id === 'string')
        : [];
      const attachmentIds = [...new Set(rawAttachmentIds)].slice(0, MAX_CHAT_ATTACHMENTS);
      let attachmentRows: AttachmentRow[] = [];
      if (attachmentIds.length > 0) {
        attachmentRows = db.all<AttachmentRow>(
          `SELECT id, original_name, mime_type, size_bytes FROM files
            WHERE user_id = ? AND id IN (${attachmentIds.map(() => '?').join(', ')})`,
          [req.auth!.userId, ...attachmentIds],
        );
        if (attachmentRows.length !== attachmentIds.length) {
          throw new HttpError(404, 'attachment files not found', 'not_found');
        }
      }

      // A model that cannot take attachments never receives them silently: the
      // request is refused on the stream with the verbatim provider code and
      // the machine-readable reason the composer renders.
      const support = attachmentSupport(model);
      if (attachmentRows.length > 0 && !support.supported) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`data: ${JSON.stringify({
          type: 'error',
          code: 'provider_not_configured',
          reason: support.reason,
          message: support.detail,
          model,
          creditsUsed: 0,
        })}\n\n`);
        res.end();
        return;
      }

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

      // Build the attachment context BEFORE the stream opens so the first
      // event can name exactly what was handed to the model.
      const attachments = attachmentRows.length > 0
        ? await resolveAttachments(attachmentRows, req.auth!.userId)
        : { resolved: [], systemBlock: null as string | null };
      if (attachments.systemBlock) {
        messages.unshift({ role: 'system', content: attachments.systemBlock });
      }

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
      if (attachments.resolved.length > 0) {
        // Names what was ACTUALLY included, per file, with the delivery mode.
        send({
          type: 'attachment',
          conversationId,
          count: attachments.resolved.length,
          message: `attachment count: ${attachments.resolved.length}`,
          attachments: attachments.resolved,
        });
      }

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
