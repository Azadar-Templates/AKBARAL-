import { db } from '../db/database';
import { createId } from '../db/id';
import { runTool } from '../tools';

/**
 * GOVERNED IMAGE PATH (degraded-agent fix).
 *
 * image_render is a PAID tool (DALL-E 3 per image) and stays OUT of the
 * autonomous tool set — agents can never spend on images by themselves.
 * Instead an agent files a free image brief; the owner approves per item;
 * fulfillment calls the provider and attaches the result. No approval → no
 * spend, ever. No OPENAI_API_KEY → honest provider_not_configured, ever.
 *
 * Cost honesty: the provider does not return per-image cost, so fulfillment
 * records NO cost figure rather than inventing one.
 */

export class ImageError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImageError';
  }
}

export interface ImageRequestRow {
  id: string;
  execution_id: string | null;
  opportunity_id: string | null;
  agent_slug: string;
  prompt: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  result_ref: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const NOW = (): string => new Date().toISOString();

export function getImageRequest(id: string): ImageRequestRow | undefined {
  return db.get<ImageRequestRow>('SELECT * FROM workforce_image_requests WHERE id = ?', [id]);
}

export function listImageRequests(status?: string, limit = 100): ImageRequestRow[] {
  const capped = Math.min(Math.max(limit, 1), 500);
  return status
    ? db.all<ImageRequestRow>('SELECT * FROM workforce_image_requests WHERE status = ? ORDER BY created_at DESC LIMIT ?', [status, capped])
    : db.all<ImageRequestRow>('SELECT * FROM workforce_image_requests ORDER BY created_at DESC LIMIT ?', [capped]);
}

/** Free to file: records the brief, spends nothing, calls no provider. */
export function requestImage(input: { executionId?: string | null; opportunityId?: string | null; agentSlug: string; prompt: string }): ImageRequestRow {
  const prompt = input.prompt.trim();
  if (!input.agentSlug.trim()) throw new ImageError(400, 'validation_error', 'agent_slug is required');
  if (prompt.length < 10) throw new ImageError(400, 'validation_error', 'prompt must describe the image (min 10 chars)');
  if (prompt.length > 2000) throw new ImageError(400, 'validation_error', 'prompt is too long (max 2000 chars)');
  const id = createId('eco_img');
  db.run(
    `INSERT INTO workforce_image_requests (id, execution_id, opportunity_id, agent_slug, prompt)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.executionId ?? null, input.opportunityId ?? null, input.agentSlug.trim(), prompt],
  );
  return getImageRequest(id)!;
}

/**
 * Idempotent filing for executions (retries must not duplicate briefs): one
 * open brief per execution.
 */
export function ensureImageBrief(input: { executionId: string; opportunityId?: string | null; agentSlug: string; prompt: string }): ImageRequestRow {
  const existing = db.get<ImageRequestRow>(
    `SELECT * FROM workforce_image_requests WHERE execution_id = ? AND status IN ('requested', 'approved') ORDER BY created_at ASC, id ASC LIMIT 1`,
    [input.executionId],
  );
  if (existing) return existing;
  return requestImage({ executionId: input.executionId, opportunityId: input.opportunityId ?? null, agentSlug: input.agentSlug, prompt: input.prompt });
}

/** Owner decision. Only a requested brief can be decided. */
export function decideImageRequest(id: string, decision: 'approve' | 'reject', by: string): ImageRequestRow {
  const row = getImageRequest(id);
  if (!row) throw new ImageError(404, 'not_found', 'image request not found');
  if (row.status !== 'requested') throw new ImageError(409, 'wrong_state', `image request is '${row.status}', not decidable`);
  db.run('UPDATE workforce_image_requests SET status = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?',
    [decision === 'approve' ? 'approved' : 'rejected', by.slice(0, 160), NOW(), NOW(), id]);
  return getImageRequest(id)!;
}

/**
 * Owner-triggered fulfillment. Requires an APPROVED brief; calls the real
 * provider (honest failure without OPENAI_API_KEY); records the result
 * reference or the real error. Never throws on provider failure — the row
 * carries the outcome.
 */
export async function fulfillImageRequest(id: string): Promise<ImageRequestRow> {
  const row = getImageRequest(id);
  if (!row) throw new ImageError(404, 'not_found', 'image request not found');
  if (row.status !== 'approved') throw new ImageError(409, 'wrong_state', `image request is '${row.status}' — approve it before fulfillment`);
  const result = await runTool('image_render', { prompt: row.prompt }, { userId: '', projectId: null, taskId: null, executionId: row.execution_id });
  if (result.ok) {
    const data = (result.data ?? {}) as Record<string, unknown>;
    const ref = typeof data.url === 'string' && data.url
      ? `url:${data.url.slice(0, 500)}`
      : `rendered:${String(data.format ?? 'unknown').slice(0, 40)}:${Number(data.bytes ?? 0)}b`;
    db.run('UPDATE workforce_image_requests SET status = ?, result_ref = ?, error_message = NULL, updated_at = ? WHERE id = ?',
      ['fulfilled', ref.slice(0, 600), NOW(), id]);
  } else {
    db.run('UPDATE workforce_image_requests SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
      ['failed', `${result.code ?? 'tool_failed'}: ${(result.error ?? result.content).slice(0, 500)}`, NOW(), id]);
  }
  return getImageRequest(id)!;
}
