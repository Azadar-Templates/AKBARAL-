import { createNotification } from '../db';
import { dispatchPush } from './expo-push';

/**
 * Automation notifications (M12 integration): one in-app notification row per
 * settled automation run / attention event, plus best-effort Expo push to the
 * user's registered devices. Deep links route the mobile app to the
 * automation's run history (akbaral://automations/:id).
 *
 * Per-step task notifications keep flowing through the existing task-level
 * hooks in the executor — these are the run-level summaries.
 */

export async function notifyAutomationRun(input: {
  userId: string;
  automationId: string;
  name: string;
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
}): Promise<void> {
  const title =
    input.status === 'completed' ? 'Automation completed' : input.status === 'failed' ? 'Automation failed' : 'Automation cancelled';
  const body =
    input.status === 'completed'
      ? `"${input.name}" finished successfully.`
      : input.status === 'failed'
        ? `"${input.name}" failed — failed steps were refunded automatically.`
        : `"${input.name}" was cancelled.`;
  try {
    createNotification({
      userId: input.userId,
      type: 'workflow',
      title,
      body,
      data: { automationId: input.automationId, runId: input.runId, status: input.status },
    });
  } catch (error) {
    console.warn(`[akbaral] in-app automation notification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await dispatchPush(input.userId, {
    title,
    body,
    data: { automationId: input.automationId, runId: input.runId, kind: 'automation', deepLink: `akbaral://automations/${input.automationId}` },
    channelId: 'tasks',
  });
}

export async function notifyAutomationAttention(input: {
  userId: string;
  automationId: string;
  name: string;
  reason: string;
}): Promise<void> {
  const title = 'Automation paused';
  const body = `"${input.name}" was paused: ${input.reason}`;
  try {
    createNotification({
      userId: input.userId,
      type: 'workflow',
      title,
      body,
      data: { automationId: input.automationId, attention: true },
    });
  } catch (error) {
    console.warn(`[akbaral] in-app automation notification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await dispatchPush(input.userId, {
    title,
    body,
    data: { automationId: input.automationId, kind: 'automation', deepLink: `akbaral://automations/${input.automationId}` },
    channelId: 'tasks',
  });
}
