import { db, createId } from './index';

const NOW = () => new Date().toISOString();

export interface TaskRatingInput {
  userId: string;
  taskId: string;
  executionId?: string | null;
  rating: number;
  comment?: string | null;
}

export interface FeedbackInput {
  userId: string;
  type: 'bug' | 'feature' | 'feedback' | 'abuse';
  subject: string;
  body: string;
}

export function upsertTaskRating(input: TaskRatingInput): { id: string; rating: number } {
  const existing = db.get<{ id: string }>(
    'SELECT id FROM task_ratings WHERE user_id = ? AND task_id = ?',
    [input.userId, input.taskId],
  );
  const now = NOW();
  if (existing) {
    db.run(
      `UPDATE task_ratings SET rating = ?, comment = ?, execution_id = COALESCE(?, execution_id), updated_at = ?
       WHERE id = ?`,
      [input.rating, input.comment ?? null, input.executionId ?? null, now, existing.id],
    );
    return { id: existing.id, rating: input.rating };
  }
  const id = createId('rat');
  db.run(
    `INSERT INTO task_ratings (id, user_id, task_id, execution_id, rating, comment, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.userId, input.taskId, input.executionId ?? null, input.rating, input.comment ?? null, now, now],
  );
  return { id, rating: input.rating };
}

export function findTaskRating(taskId: string): Record<string, unknown> | undefined {
  return db.get(
    `SELECT id, user_id, task_id, execution_id, rating, comment, created_at, updated_at
     FROM task_ratings WHERE task_id = ?`,
    [taskId],
  ) as Record<string, unknown> | undefined;
}

export function listTaskRatingsByAgent(taskId: string): Array<Record<string, unknown>> {
  return db.all(
    `SELECT id, user_id, task_id, execution_id, rating, comment, created_at
     FROM task_ratings WHERE task_id = ? ORDER BY created_at DESC`,
    [taskId],
  ) as Array<Record<string, unknown>>;
}

export function createFeedback(input: FeedbackInput): { id: string; status: string } {
  const id = createId('fdb');
  db.run(
    `INSERT INTO feedback (id, user_id, type, subject, body, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    [id, input.userId, input.type, input.subject, input.body, NOW(), NOW()],
  );
  return { id, status: 'open' };
}

export function listUserFeedback(userId: string): Array<Record<string, unknown>> {
  return db.all(
    `SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    [userId],
  ) as Array<Record<string, unknown>>;
}

export function listFeedbackForAdmin(limit = 200): Array<Record<string, unknown>> {
  return db.all(
    `SELECT f.*, u.email AS user_email, u.name AS user_name
     FROM feedback f
     JOIN users u ON u.id = f.user_id
     ORDER BY CASE f.status WHEN 'open' THEN 0 WHEN 'under_review' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END, f.created_at DESC
     LIMIT ?`,
    [limit],
  ) as Array<Record<string, unknown>>;
}

export function updateFeedbackStatus(input: {
  feedbackId: string;
  status: 'open' | 'under_review' | 'resolved' | 'dismissed';
  adminUserId: string;
  adminNote?: string | null;
}): void {
  db.run(
    `UPDATE feedback SET status = ?, admin_note = COALESCE(?, admin_note), resolved_by_user_id = ?, updated_at = ?
     WHERE id = ?`,
    [input.status, input.adminNote ?? null, input.adminUserId, NOW(), input.feedbackId],
  );
}

export function getFeedbackById(id: string): Record<string, unknown> | undefined {
  return db.get('SELECT * FROM feedback WHERE id = ?', [id]) as Record<string, unknown> | undefined;
}

export function feedbackStats(): Record<string, number> {
  const rows = db.all<{ status: string; count: number }>(
    'SELECT status, COUNT(*) AS count FROM feedback GROUP BY status',
  );
  const stats: Record<string, number> = { open: 0, under_review: 0, resolved: 0, dismissed: 0 };
  for (const row of rows) {
    stats[row.status] = row.count;
  }
  return stats;
}
