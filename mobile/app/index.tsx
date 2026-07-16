import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../src/lib/auth';
import { listBikes } from '../src/lib/db';
import { color } from '../src/theme/tokens';

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
          const bikes = await listBikes(session.user.id);
          if (!alive) return;
          router.replace(bikes.length === 0 ? '/onboarding/bike' : '/(tabs)/garage');
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
