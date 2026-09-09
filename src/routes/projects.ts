import { Router } from 'express';
import { db, createProject, findProjectById, listProjectsByUser, findUserByEmail } from '../db';
import {
  hasProjectRole,
  projectRole,
  listProjectMembers,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  listProjectArtifacts,
  searchProjectKnowledge,
  type ProjectRole,
} from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { HttpError, asyncRoute } from '../server/http';
import { getBody, optionalString, requireString } from '../server/middleware/validation';

/**
 * Projects = project-scoped workspaces (Milestone 5).
 *
 * Authorization model (enforced on every route):
 *   owner  — full control, membership management, can delete
 *   admin  — membership management, settings, upload, create work
 *   member — upload files, create tasks/workflows, read everything
 *   viewer — read-only
 * Non-members get an indistinguishable 404 (no existence leak).
 */
const ASSIGNABLE_ROLES: ProjectRole[] = ['admin', 'member', 'viewer'];

export function createProjectsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  function requireProjectAccess(req: AuthenticatedRequest, minimum: ProjectRole) {
    const project = findProjectById(req.params.id);
    if (!project || !hasProjectRole(project as { id: string; owner_id: string }, req.auth!.userId, minimum)) {
      throw new HttpError(404, 'project not found', 'not_found');
    }
    return project as { id: string; owner_id: string; name: string; slug: string; description: string | null; status: string | null };
  }

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
    const project = requireProjectAccess(req, 'viewer');
    const files = db.all('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC', [String(project.id)]);
    const tasks = db.all('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC', [String(project.id)]);
    const workflows = db.all('SELECT * FROM workflows WHERE project_id = ? ORDER BY created_at DESC', [String(project.id)]);
    res.status(200).json({
      project,
      myRole: projectRole(project as { id: string; owner_id: string }, req.auth!.userId),
      files,
      tasks,
      workflows,
    });
  });

  router.patch(
    '/:id',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const project = requireProjectAccess(req, 'admin');
      const body = getBody(req);
      const name = optionalString(body, 'name');
      const description = optionalString(body, 'description');
      const status = optionalString(body, 'status');
      if (status && !['active', 'archived'].includes(status)) {
        throw new HttpError(400, 'status must be active or archived', 'validation_error');
      }
      db.run(
        `UPDATE projects SET
           name = COALESCE(?, name),
           description = COALESCE(?, description),
           status = COALESCE(?, status),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
        [name ?? null, description ?? null, status ?? null, String(project.id)],
      );
      res.status(200).json({ project: findProjectById(String(project.id)) });
    }),
  );

  // ------------------------------------------------------------- members ---

  router.get('/:id/members', (req: AuthenticatedRequest, res) => {
    const project = requireProjectAccess(req, 'viewer');
    res.status(200).json({ members: listProjectMembers(String(project.id)) });
  });

  router.post(
    '/:id/members',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const project = requireProjectAccess(req, 'admin');
      const body = getBody(req);
      const email = requireString(body, 'email', 'email').toLowerCase();
      const role = body.role;
      if (typeof role !== 'string' || !ASSIGNABLE_ROLES.includes(role as ProjectRole)) {
        throw new HttpError(400, `role must be one of ${ASSIGNABLE_ROLES.join(', ')}`, 'validation_error');
      }
      const user = findUserByEmail(email);
      if (!user) {
        throw new HttpError(404, 'no user with that email', 'not_found');
      }
      if (String(user.id) === String(project.owner_id)) {
        throw new HttpError(409, 'the project owner already has full access', 'conflict');
      }
      addProjectMember({ projectId: String(project.id), userId: String(user.id), role: role as ProjectRole });
      db.run(
        `INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        [
          `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          String(user.id),
          'workspace.invited',
          `You were added to "${project.name}"`,
          `You now have ${role} access to this workspace.`,
          JSON.stringify({ projectId: project.id, role }),
        ],
      );
      res.status(201).json({ member: { userId: user.id, email, role } });
    }),
  );

  router.patch(
    '/:id/members/:userId',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const project = requireProjectAccess(req, 'admin');
      const body = getBody(req);
      const role = body.role;
      if (typeof role !== 'string' || !ASSIGNABLE_ROLES.includes(role as ProjectRole)) {
        throw new HttpError(400, `role must be one of ${ASSIGNABLE_ROLES.join(', ')}`, 'validation_error');
      }
      if (req.params.userId === String(project.owner_id)) {
        throw new HttpError(409, 'the owner role cannot be changed', 'conflict');
      }
      const updated = updateProjectMemberRole(String(project.id), req.params.userId, role as ProjectRole);
      if (!updated) {
        throw new HttpError(404, 'member not found', 'not_found');
      }
      res.status(200).json({ member: { userId: req.params.userId, role } });
    }),
  );

  router.delete(
    '/:id/members/:userId',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      // Any member may remove themselves; removing someone else needs admin.
      const project = req.params.userId === req.auth!.userId
        ? requireProjectAccess(req, 'viewer')
        : requireProjectAccess(req, 'admin');
      if (req.params.userId === String(project.owner_id)) {
        throw new HttpError(409, 'the owner cannot be removed', 'conflict');
      }
      const removed = removeProjectMember(String(project.id), req.params.userId);
      if (!removed) {
        throw new HttpError(404, 'member not found', 'not_found');
      }
      res.status(200).json({ removed: true });
    }),
  );

  // ---------------------------------------------------- knowledge scope ---

  router.post(
    '/:id/knowledge/search',
    asyncRoute(async (req: AuthenticatedRequest, res) => {
      const project = requireProjectAccess(req, 'viewer');
      const body = getBody(req);
      const query = requireString(body, 'query', 'query');
      const limit = Math.min(Math.max(1, typeof body.limit === 'number' ? Math.floor(body.limit) : 20), 50);
      // Shared workspace knowledge: every member sees the project's indexed
      // items, regardless of which member uploaded them (membership is
      // verified above).
      const results = searchProjectKnowledge(String(project.id), query, limit);
      res.status(200).json({ projectId: project.id, results });
    }),
  );

  // ------------------------------------------------------------ artifacts ---

  router.get('/:id/artifacts', (req: AuthenticatedRequest, res) => {
    const project = requireProjectAccess(req, 'viewer');
    res.status(200).json({ artifacts: listProjectArtifacts(String(project.id)) });
  });

  return router;
}
