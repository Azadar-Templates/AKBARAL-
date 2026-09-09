import { Router } from 'express';
import { db, createProject, findProjectById, listProjectsByUser } from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError } from '../server/http';
import { getBody, optionalString, requireString } from '../server/middleware/validation';

export function createProjectsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (req: AuthenticatedRequest, res) => {
    res.status(200).json({ projects: listProjectsByUser(req.auth!.userId) });
  });

  router.post('/', (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const name = requireString(body, 'name', 'name');
    const description = optionalString(body, 'description');
    let slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    let slug = slugBase;
    let attempt = 0;
    while (db.get<{ id: string }>('SELECT id FROM projects WHERE slug = ?', [slug]) && attempt < 20) {
      slug = `${slugBase}-${attempt + 1}`;
      attempt += 1;
    }
    const project = createProject({ ownerId: req.auth!.userId, name, slug, description: description ?? null });
    res.status(201).json({ project: { id: project.id, name, slug } });
  });

  router.get('/:id', (req: AuthenticatedRequest, res) => {
    const project = findProjectById(req.params.id);
    if (!project || String(project.owner_id) !== req.auth!.userId) {
      throw new HttpError(404, 'project not found', 'not_found');
    }
    const files = db.all('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC', [String(project.id)]);
    const tasks = db.all('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC', [String(project.id)]);
    const workflows = db.all('SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC', [String(project.id)]);
    res.status(200).json({ project, files, tasks, workflows });
  });

  return router;
}
