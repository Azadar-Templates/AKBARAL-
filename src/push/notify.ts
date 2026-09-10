import { createNotification } from '../db';
import { notifyTaskCompletion, type PushDispatchResult } from './expo-push';

/**
 * Task-finished notification fan-out (M12): one in-app notification row plus
 * best-effort Expo push delivery. Never throws into the caller — a task
 * result must never be affected by a notification failure. Delivery outcome
 * is logged honestly (no fake success).
 */
export async function notifyTaskFinished(input: {
  userId: string;
  taskId: string;
  status: 'completed' | 'failed';
  detail: string;
}): Promise<void> {
  const title = input.status === 'completed' ? 'Task completed' : 'Task failed';
  try {
    createNotification({
      userId: input.userId,
      type: 'task',
      title,
      body: input.detail,
      data: { taskId: input.taskId, status: input.status },
    });
  } catch (error) {
    console.warn(`[akbaral] in-app notification for task ${input.taskId} failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let push: PushDispatchResult;
  try {
    push = await notifyTaskCompletion({ userId: input.userId, taskId: input.taskId, title, body: input.detail });
  } catch (error) {
    push = { attempted: 0, delivered: 0, errors: [{ token: '-', message: error instanceof Error ? error.message : String(error) }] };
  }
  if (push.attempted > 0) {
    console.log(`[akbaral] push for task ${input.taskId}: ${push.delivered}/${push.attempted} delivered${push.errors.length ? ` (${push.errors.length} error(s))` : ''}`);
  }
}
