import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import multer from 'multer';
import { createFile, createFileVersion, indexKnowledgeItem, getFile } from '../db';
import { env } from '../config/env';

export const UPLOAD_DIR = path.resolve(process.cwd(), env.uploadDir);

export interface FileUploadResult {
  fileId: string;
  storageKey: string;
  originalName: string;
  sizeBytes: number;
  kind: string;
  extractedText: boolean;
  knowledgeItemId?: string;
}

export const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      callback(null, UPLOAD_DIR);
    },
    filename(_req, file, callback) {
      const safeName = file.originalname.replace(/[^\w.\-]+/g, '-').slice(0, 80);
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const TEXT_MIME = new Set([
  'text/plain',
  'text/csv',
  'application/json',
  'application/xml',
  'text/markdown',
  'text/html',
]);

export function detectKind(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'spreadsheet';
  if (mimeType.includes('pdf')) return 'document';
  return 'document';
}

export function extractTextFromFile(filePath: string, mimeType: string): string {
  if (!TEXT_MIME.has(mimeType)) {
    return '';
  }
  const buffer = fs.readFileSync(filePath);
  return buffer
    .toString('utf8')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function processUpload(input: {
  userId: string;
  projectId?: string | null;
  file: { path: string; originalname: string; mimetype: string; size: number };
}): FileUploadResult {
  const mimeType = input.file.mimetype || 'application/octet-stream';
  const buffer = fs.readFileSync(input.file.path);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const storageKey = `${Date.now()}-${sha256.slice(0, 18)}`;
  const kind = detectKind(mimeType);

  const created = createFile({
    userId: input.userId,
    projectId: input.projectId ?? null,
    originalName: input.file.originalname,
    storageKey,
    mimeType,
    sizeBytes: input.file.size,
    sha256,
    kind,
    metadata: { mimeType, source: 'upload' },
  });

  createFileVersion({
    fileId: created.id,
    storageKey,
    sizeBytes: input.file.size,
  });

  const text = extractTextFromFile(input.file.path, mimeType);
  let knowledgeItemId: string | undefined;
  if (text.length > 0) {
    const item = indexKnowledgeItem({
      userId: input.userId,
      projectId: input.projectId ?? null,
      fileId: created.id,
      sourceType: 'document',
      title: input.file.originalname,
      content: text,
      mimeType,
      metadata: { fileId: created.id },
    });
    knowledgeItemId = item.id;
  }

  return {
    fileId: created.id,
    storageKey,
    originalName: input.file.originalname,
    sizeBytes: input.file.size,
    kind,
    extractedText: text.length > 0,
    knowledgeItemId,
  };
}

export function getStoredFile(id: string) {
  const file = getFile(id);
  if (!file) {
    return undefined;
  }
  const storageKey = String(file.storage_key ?? '');
  const filePath = path.join(UPLOAD_DIR, storageKey);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return { file, filePath };
}
