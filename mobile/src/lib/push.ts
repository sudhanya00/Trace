import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * Register this device for pushes. Never prompts — permission is asked in
 * context at first Record (§7), and this simply catches up whenever it's
 * already granted. Fails soft: without FCM credentials (Android needs the
 * Firebase setup) the token call throws and the in-app inbox still carries
 * every notification.
 */
export async function registerPushToken(userId: string): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'TRACE',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#2E7DFF',
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from('push_tokens').upsert({
      token,
      profile_id: userId,
      platform: Platform.OS,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Expected until Firebase credentials exist — the inbox covers delivery.
  }
}
