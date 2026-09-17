import { listActiveDeviceTokens } from '../db';

/**
 * Honest Expo push dispatch (M12 mobile integration).
 *
 * Sends real push notifications through the Expo push service
 * (https://exp.host/--/api/v2/push/send). The endpoint can be overridden
 * with AKBARAL_EXPO_PUSH_URL (used by tests with a local fixture and by
 * self-hosted relay deployments).
 *
 * Honesty rules:
 * - Delivery failures are LOGGED and reported in the return value — never
 *   swallowed into a fake "sent" and never allowed to break task execution.
 * - When a user has no registered device tokens, nothing is sent and the
 *   result says so.
 */

const DEFAULT_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const PUSH_TIMEOUT_MS = 5000;
const MAX_TOKENS_PER_REQUEST = 100;

export interface PushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  detail?: { error?: string };
}

export interface PushDispatchResult {
  attempted: number;
  delivered: number;
  errors: Array<{ token: string; message: string }>;
}

export async function notifyTaskCompletion(input: { userId: string; taskId: string; title: string; body: string }): Promise<PushDispatchResult> {
  return dispatchPush(input.userId, {
    title: input.title,
    body: input.body,
    data: { taskId: input.taskId, kind: 'task', deepLink: `akbaral://tasks/${input.taskId}` },
    channelId: 'tasks',
  });
}

export async function dispatchPush(
  userId: string,
  message: { title: string; body: string; data?: Record<string, unknown>; channelId?: string; sound?: 'default' | null },
): Promise<PushDispatchResult> {
  const tokens = listActiveDeviceTokens(userId);
  if (tokens.length === 0) {
    return { attempted: 0, delivered: 0, errors: [] };
  }

  const endpoint = (process.env.AKBARAL_EXPO_PUSH_URL ?? DEFAULT_PUSH_URL).trim();
  const result: PushDispatchResult = { attempted: tokens.length, delivered: 0, errors: [] };

  for (const batch of chunk(tokens, MAX_TOKENS_PER_REQUEST)) {
    let tickets: PushTicket[] = [];
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch.map((device) => ({ to: device.token, title: message.title, body: message.body, data: message.data, channelId: message.channelId, sound: message.sound ?? 'default' }))),
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      if (!response.ok) {
        for (const device of batch) result.errors.push({ token: device.token, message: `push endpoint responded HTTP ${response.status}` });
        continue;
      }
      const body = (await response.json()) as { data?: PushTicket[] };
      tickets = Array.isArray(body.data) ? body.data : [];
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      for (const device of batch) result.errors.push({ token: device.token, message: `push dispatch failed: ${detail}` });
      continue;
    }

    tickets.forEach((ticket, index) => {
      const device = batch[index];
      if (ticket?.status === 'ok') {
        result.delivered += 1;
      } else {
        result.errors.push({ token: device?.token ?? 'unknown', message: ticket?.detail?.error ?? ticket?.message ?? 'push ticket error' });
      }
    });
  }

  if (result.errors.length > 0) {
    console.warn(`[akbaral] push dispatch: ${result.delivered}/${result.attempted} delivered, ${result.errors.length} error(s): ${result.errors[0].message}`);
  }
  return result;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
