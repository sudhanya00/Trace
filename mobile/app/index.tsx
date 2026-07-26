import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../src/lib/auth';
import { listBikes } from '../src/lib/db';
import { color, font } from '../src/theme/tokens';

const HAS_BIKES_KEY = 'trace_has_bikes';

/**
 * Entry gate. Order matters (§7): a rider always has a garage before anything
 * asks for permissions — signed in → handle → first bike → the app.
 */
export default function Gate() {
  const { session, profile, loading } = useAuth();
  const insets = useSafeAreaInsets();

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
    <View style={st.root}>
      <View style={st.centre}>
        <ActivityIndicator color={color.steel} />
      </View>
      {/* Where this was built, said once, quietly, at the bottom. */}
      <Text style={[st.made, { marginBottom: insets.bottom + 22 }]} allowFontScaling={false}>
        Made with ♥️ in 🇮🇳
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  made: {
    fontFamily: font.bodyMedium,
    fontSize: 12,
    color: color.steel,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});
