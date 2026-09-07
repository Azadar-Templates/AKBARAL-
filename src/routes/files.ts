import { Router, type Response } from 'express';
import { findProjectById, getFile, indexKnowledgeItem, searchKnowledge } from '../db';
import { upload, processUpload, getStoredFile } from '../services/files';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';
import { getBody, requireString } from '../server/middleware/validation';

export function createFilesRouter(): Router {
  const router = Router();

  router.post('/projects/:projectId/files', requireAuth, (req: AuthenticatedRequest, res) => {
    const project = findProjectById(req.params.projectId);
    if (!project || String(project.owner_id) !== req.auth!.userId) {
      throw new HttpError(404, 'project not found', 'not_found');
    }
    upload.single('file')(req, res, (error) => {
      if (error) {
        throw new HttpError(400, error.message, 'upload_failed');
      }
      if (!req.file) {
        throw new HttpError(400, 'file is required', 'validation_error');
      }
      const result = processUpload({
        userId: req.auth!.userId,
        projectId: String(project.id),
        file: { path: req.file.path, originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size },
      });
      res.status(201).json({ file: result });
    });
  });

  router.get('/files/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const file = getFile(req.params.id);
    if (!file || String(file.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'file not found', 'not_found');
    }
    const stored = getStoredFile(req.params.id);
    if (!stored) {
      throw new HttpError(404, 'stored file not found', 'not_found');
    }
    res.setHeader('content-type', String(file.mime_type ?? 'application/octet-stream'));
    res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(String(file.original_name))}"`);
    require('node:fs').createReadStream(stored.filePath).pipe(res);
  });

  router.post('/files/:id/knowledge', requireAuth, (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const content = requireString(body, 'content', 'content');
    const file = getFile(req.params.id);
    if (!file || String(file.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'file not found', 'not_found');
    }
    const item = indexKnowledgeItem({
      userId: req.auth!.userId,
      projectId: file.project_id ? String(file.project_id) : null,
      fileId: file.id as string,
      sourceType: 'document',
      title: String(file.original_name),
      content,
      mimeType: file.mime_type ? String(file.mime_type) : null,
    });
    res.status(201).json({ knowledge: item });
  });

  function knowledgeSearch(req: AuthenticatedRequest, res: Response): void {
    const body = getBody(req);
    const query = requireString(body, 'query', 'query');
    const results = searchKnowledge(req.auth!.userId, query, 20);
    res.status(200).json({ results });
  }

  // Documented client path.
  router.post('/files/knowledge/search', requireAuth, knowledgeSearch);
  // Backwards-compatible alias.
  router.post('/knowledge/search', requireAuth, knowledgeSearch);

  return router;
}
