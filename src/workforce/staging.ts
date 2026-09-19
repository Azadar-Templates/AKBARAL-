import fs from 'node:fs';
import { db } from '../db/database';
import { ftsSafeQuery } from '../db/platform-repositories';
import { resolveStoredFilePath } from '../services/files';

/**
 * WORKFORCE STAGING (D5) — explicit, per-item, revocable sharing.
 *
 * The workforce service identity owns nothing. The owner stages individual
 * knowledge items / files for workforce use; unstaging (or deleting the
 * underlying row/file) revokes access immediately, because resolution always
 * joins the LIVE rows at read time. Nothing is copied, nothing is cached.
 */

export class StagingError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StagingError';
  }
}

// ── Knowledge ──────────────────────────────────────────────────────────────

export function stageKnowledgeItem(input: { knowledgeItemId: string; stagedBy: string }): { staged: boolean } {
  const id = input.knowledgeItemId.trim();
  if (!id) throw new StagingError(400, 'validation_error', 'knowledge_item_id is required');
  const row = db.get<{ id: string }>('SELECT id FROM knowledge_items WHERE id = ?', [id]);
  if (!row) throw new StagingError(404, 'not_found', `knowledge item ${id} does not exist — refusing to stage a ghost`);
  db.run('INSERT OR IGNORE INTO workforce_staged_knowledge (knowledge_item_id, staged_by) VALUES (?, ?)', [id, input.stagedBy]);
  return { staged: true };
}

export function unstageKnowledgeItem(knowledgeItemId: string): { unstaged: boolean } {
  db.run('DELETE FROM workforce_staged_knowledge WHERE knowledge_item_id = ?', [knowledgeItemId]);
  return { unstaged: true };
}

export function listStagedKnowledge(): Array<{ knowledgeItemId: string; title: string | null; stagedBy: string; stagedAt: string }> {
  return db.all(
    `SELECT s.knowledge_item_id AS knowledgeItemId, ki.title AS title, s.staged_by AS stagedBy, s.staged_at AS stagedAt
     FROM workforce_staged_knowledge s LEFT JOIN knowledge_items ki ON ki.id = s.knowledge_item_id
     ORDER BY s.staged_at DESC LIMIT 500`,
  );
}

/**
 * Full-text search over STAGED knowledge only. Only rows the owner staged
 * can ever match — same honest widening as the user path, narrower scope.
 */
export function searchStagedKnowledge(query: string, limit = 20): Array<Record<string, unknown>> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const run = (match: string): Array<Record<string, unknown>> =>
    db.all(
      `SELECT ki.id, ki.title, ki.content, ki.source_type, ki.mime_type, ki.project_id
       FROM knowledge_fts fts
       JOIN knowledge_items ki ON ki.rowid = fts.rowid
       WHERE knowledge_fts MATCH ?
         AND ki.id IN (SELECT knowledge_item_id FROM workforce_staged_knowledge)
       ORDER BY ki.indexed_at DESC
       LIMIT ?`,
      [match, capped],
    ) as Array<Record<string, unknown>>;

  let exact: Array<Record<string, unknown>> = [];
  try {
    exact = run(ftsSafeQuery(query));
  } catch {
    exact = [];
  }
  if (exact.length > 0) return exact;
  const tokens = query
    .split(/[\s,.;:!?()[\]{}"'\-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 8);
  if (tokens.length > 1) {
    const orQuery = tokens.map((token) => `"${token.replace(/"/g, '')}"`).join(' OR ');
    try {
      return run(orQuery);
    } catch {
      return exact;
    }
  }
  return exact;
}

// ── Files ──────────────────────────────────────────────────────────────────

export function stageFile(input: { fileId: string; stagedBy: string }): { staged: boolean } {
  const id = input.fileId.trim();
  if (!id) throw new StagingError(400, 'validation_error', 'file_id is required');
  const row = db.get<{ id: string }>('SELECT id FROM files WHERE id = ?', [id]);
  if (!row) throw new StagingError(404, 'not_found', `file ${id} does not exist — refusing to stage a ghost`);
  db.run('INSERT OR IGNORE INTO workforce_staged_files (file_id, staged_by) VALUES (?, ?)', [id, input.stagedBy]);
  return { staged: true };
}

export function unstageFile(fileId: string): { unstaged: boolean } {
  db.run('DELETE FROM workforce_staged_files WHERE file_id = ?', [fileId]);
  return { unstaged: true };
}

export function listStagedFiles(): Array<{ fileId: string; originalName: string | null; stagedBy: string; stagedAt: string }> {
  return db.all(
    `SELECT s.file_id AS fileId, f.original_name AS originalName, s.staged_by AS stagedBy, s.staged_at AS stagedAt
     FROM workforce_staged_files s LEFT JOIN files f ON f.id = s.file_id
     ORDER BY s.staged_at DESC LIMIT 500`,
  );
}

/**
 * Resolve a workforce file reference to a live on-disk path. The file must be
 * staged AND its files row must still exist AND the bytes must still be on
 * disk — any missing link fails honestly. Storage keys are validated by the
 * same traversal-proof resolver as the user path.
 */
export function resolveStagedFile(fileIdOrKey: string): string {
  const row = db.get<{ storage_key: string }>(
    `SELECT f.storage_key AS storage_key FROM workforce_staged_files s
     JOIN files f ON f.id = s.file_id
     WHERE f.id = ? OR f.storage_key = ? OR f.original_name = ?
     LIMIT 1`,
    [fileIdOrKey, fileIdOrKey, fileIdOrKey],
  );
  if (!row?.storage_key) {
    throw new Error(`file_parse_text refused: file "${fileIdOrKey}" is not staged for workforce use`);
  }
  const fsPath = resolveStoredFilePath(row.storage_key);
  if (!fs.existsSync(fsPath) || !fs.statSync(fsPath).isFile()) {
    throw new Error(`file_parse_text refused: staged file "${fileIdOrKey}" has no readable bytes on disk`);
  }
  return fsPath;
}
