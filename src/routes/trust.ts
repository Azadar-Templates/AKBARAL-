import { Router } from 'express';
import {
  appendAuditLog,
  createFeedback,
  feedbackStats,
  findTaskById,
  getFeedbackById,
  listFeedbackForAdmin,
  listUserFeedback,
  listTaskRatingsByAgent,
  updateFeedbackStatus,
  upsertTaskRating,
} from '../db';
import { AuthenticatedRequest, requireAuth } from '../server/middleware/auth';
import { requireRole } from '../server/middleware/rbac';
import { HttpError } from '../server/http';
import { getBody, requireString, optionalString } from '../server/middleware/validation';

const FEEDBACK_TYPES = new Set(['bug', 'feature', 'feedback', 'abuse']);
const ADMIN_STATUSES = new Set(['open', 'under_review', 'resolved', 'dismissed']);

export function createTrustRouter(): Router {
  const router = Router();

  // --- Task ratings ---------------------------------------------------------
  router.post('/tasks/:id/rating', requireAuth, (req: AuthenticatedRequest, res) => {
    const task = findTaskById(req.params.id);
    if (!task || String(task.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'task not found', 'not_found');
    }
    if (String(task.status) !== 'completed') {
      throw new HttpError(409, 'only completed tasks can be rated', 'task_not_completed');
    }
    const body = getBody(req);
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new HttpError(400, 'rating must be an integer from 1 to 5', 'validation_error');
    }
    const saved = upsertTaskRating({
      userId: req.auth!.userId,
      taskId: task.id,
      executionId: optionalString(body, 'execution_id') ?? null,
      rating,
      comment: optionalString(body, 'comment') ?? null,
    });
    appendAuditLog({
      actorId: req.auth!.userId,
      action: 'task.rating.submitted',
      resourceType: 'task',
      resourceId: task.id,
      description: `rated completed task ${rating}/5`,
      metadata: { rating },
    });
    res.status(201).json({ rating: saved });
  });

  router.get('/tasks/:id/rating', requireAuth, (req: AuthenticatedRequest, res) => {
    const task = findTaskById(req.params.id);
    if (!task || String(task.user_id) !== req.auth!.userId) {
      throw new HttpError(404, 'task not found', 'not_found');
    }
    const rows = listTaskRatingsByAgent(task.id);
    res.status(200).json({ ratings: rows });
  });

  // --- Feedback / bug / feature / abuse -------------------------------------
  router.post('/feedback', requireAuth, (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const type = requireString(body, 'type', 'type').toLowerCase();
    if (!FEEDBACK_TYPES.has(type)) {
      throw new HttpError(400, 'type must be bug, feature, feedback or abuse', 'validation_error');
    }
    const subject = requireString(body, 'subject', 'subject').slice(0, 200);
    const feedbackBody = requireString(body, 'body', 'body').slice(0, 10_000);
    const created = createFeedback({ userId: req.auth!.userId, type: type as 'bug' | 'feature' | 'feedback' | 'abuse', subject, body: feedbackBody });
    appendAuditLog({
      actorId: req.auth!.userId,
      action: 'feedback.created',
      resourceType: 'feedback',
      resourceId: created.id,
      description: `${type} submitted: ${subject}`,
    });
    res.status(201).json({ feedback: created });
  });

  router.get('/feedback/mine', requireAuth, (req: AuthenticatedRequest, res) => {
    res.status(200).json({ feedback: listUserFeedback(req.auth!.userId) });
  });

  // --- Admin moderation ------------------------------------------------------
  router.get('/admin/feedback', requireAuth, requireRole('admin', 'super_admin'), (_req, res) => {
    res.status(200).json({ feedback: listFeedbackForAdmin(), stats: feedbackStats() });
  });

  router.patch('/admin/feedback/:id/status', requireAuth, requireRole('admin', 'super_admin'), (req: AuthenticatedRequest, res) => {
    const body = getBody(req);
    const status = requireString(body, 'status', 'status').toLowerCase();
    if (!ADMIN_STATUSES.has(status)) {
      throw new HttpError(400, 'status must be open, under_review, resolved or dismissed', 'validation_error');
    }
    const feedback = getFeedbackById(req.params.id);
    if (!feedback) {
      throw new HttpError(404, 'feedback not found', 'not_found');
    }
    updateFeedbackStatus({
      feedbackId: feedback.id as string,
      status: status as 'open' | 'under_review' | 'resolved' | 'dismissed',
      adminUserId: req.auth!.userId,
      adminNote: optionalString(body, 'admin_note') ?? null,
    });
    appendAuditLog({
      actorId: req.auth!.userId,
      action: 'feedback.status.changed',
      resourceType: 'feedback',
      resourceId: feedback.id as string,
      description: `feedback status changed to ${status}`,
      metadata: { from: String(feedback.status), to: status },
    });
    res.status(200).json({ feedback: { id: feedback.id, status } });
  });

  return router;
}
