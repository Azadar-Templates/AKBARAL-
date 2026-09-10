import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';

/**
 * Push notification registration (M12) — honest end to end:
 * - permission is requested from the user first;
 * - an Expo push token is only obtained from a real runtime that can issue one
 *   (iOS simulators cannot receive push; an Expo Go/EAS build with a
 *   projectId is required for getExpoPushTokenAsync);
 * - the token is registered with the server (POST /api/notifications/device)
 *   and revoked on logout (DELETE /api/notifications/device/:token);
 * - failures are reported to the caller with a reason — never faked.
 */

const PUSH_TOKEN_KEY = 'ak_push_token';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushRegisterResult = { ok: true; token: string } | { ok: false; reason: string };

export async function registerForPushNotifications(): Promise<PushRegisterResult> {
  if (Platform.OS === 'ios' && !Device.isDevice) {
    return { ok: false, reason: 'Push notifications require a physical device (the iOS simulator cannot receive them).' };
  }

  let granted = false;
  try {
    const settings = await Notifications.getPermissionsAsync();
    granted = settings.granted;
    if (!granted) {
      const request = await Notifications.requestPermissionsAsync();
      granted = request.granted;
    }
  } catch (error) {
    return { ok: false, reason: `Could not request notification permission (${error instanceof Error ? error.message : 'unknown error'}).` };
  }
  if (!granted) {
    return { ok: false, reason: 'Notification permission was not granted.' };
  }

  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('tasks', {
        name: 'Task updates',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#ffcf5c',
      });
    } catch {
      // channel may already exist — registration can continue
    }
  }

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync();
    token = result.data;
    if (!token) throw new Error('empty token');
  } catch (error) {
    return {
      ok: false,
      reason: `Could not obtain an Expo push token (${error instanceof Error ? error.message : 'unknown error'}). Push requires an EAS/development build with a projectId.`,
    };
  }

  try {
    await api.post('/api/notifications/device', { token, platform: Platform.OS });
  } catch (error) {
    return { ok: false, reason: `Server rejected the device registration (${error instanceof Error ? error.message : 'unknown error'}).` };
  }

  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  return { ok: true, token };
}

export async function unregisterPushNotifications(): Promise<void> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (!token) return;
  try {
    await api.del(`/api/notifications/device/${encodeURIComponent(token)}`);
  } catch {
    // token already revoked/expired server-side — local cleanup still proceeds
  }
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}

/** Extract a task id from an `akbaral://tasks/:id` deep link, if present. */
export function taskIdFromDeepLink(link: unknown): string | null {
  if (typeof link !== 'string') return null;
  const match = link.match(/\/tasks\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

/** Extract an automation id from an `akbaral://automations/:id` deep link. */
export function automationIdFromDeepLink(link: unknown): string | null {
  if (typeof link !== 'string') return null;
  const match = link.match(/\/automations\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}
