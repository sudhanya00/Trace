import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../src/lib/auth';
import { listBikes } from '../src/lib/db';
import { color } from '../src/theme/tokens';

const HAS_BIKES_KEY = 'trace_has_bikes';

/**
 * Entry gate. Order matters (§7): a rider always has a garage before anything
 * asks for permissions — signed in → handle → first bike → the app.
 */
export default function Gate() {
  const { session, profile, loading } = useAuth();

  useFocusEffect(
    useCallback(() => {
      if (loading) return;
      let alive = true;
      (async () => {
        if (!session) {
          router.replace('/auth');
        } else if (!profile) {
          router.replace('/onboarding/handle');
        } else {
          try {
            const bikes = await listBikes(session.user.id);
            if (!alive) return;
            await AsyncStorage.setItem(HAS_BIKES_KEY, bikes.length > 0 ? '1' : '0').catch(() => {});
            router.replace(bikes.length === 0 ? '/onboarding/bike' : '/(tabs)/explore');
          } catch {
            // Offline: trust the cache — never march an existing rider back
            // through onboarding because the network blinked.
            const cached = await AsyncStorage.getItem(HAS_BIKES_KEY).catch(() => null);
            if (!alive) return;
            if (cached === '1') router.replace('/(tabs)/explore');
            // else stay on the spinner; next focus retries
          }
        }
      })();
      return () => {
        alive = false;
      };
    }, [session, profile, loading])
  );

  return (
    <View style={{ flex: 1, backgroundColor: color.void, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={color.steel} />
    </View>
  );
}
