import {
  ChakraPetch_500Medium,
  ChakraPetch_600SemiBold,
  ChakraPetch_700Bold,
} from '@expo-google-fonts/chakra-petch';
import {
  Saira_400Regular,
  Saira_500Medium,
  Saira_600SemiBold,
  Saira_700Bold,
} from '@expo-google-fonts/saira';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import * as Sentry from '@sentry/react-native';
import { useFonts } from 'expo-font';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { PostHogProvider } from 'posthog-react-native';
import { ReactNode, useEffect } from 'react';
import { AppState, View } from 'react-native';

import { SessionProvider, useAuth } from '../src/lib/auth';
import { registerPushToken } from '../src/lib/push';
import { syncPendingRides } from '../src/lib/sync';
import { color } from '../src/theme/tokens';

const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn, sendDefaultPii: false });
}

const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const posthogHost = process.env.EXPO_PUBLIC_POSTHOG_HOST;

function Analytics({ children }: { children: ReactNode }) {
  if (!posthogKey) return children;
  return (
    <PostHogProvider apiKey={posthogKey} options={{ host: posthogHost }} autocapture={false}>
      {children}
    </PostHogProvider>
  );
}

SplashScreen.preventAutoHideAsync();

/** Registers the push token once signed in, and routes notification taps. */
function PushWiring() {
  const { session } = useAuth();

  useEffect(() => {
    if (session) registerPushToken(session.user.id);
  }, [session?.user.id]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) {
        router.push(url as never);
      }
    });
    return () => sub.remove();
  }, []);

  return null;
}

function RootLayout() {
  const [fontsLoaded] = useFonts({
    ChakraPetch_500Medium,
    ChakraPetch_600SemiBold,
    ChakraPetch_700Bold,
    Saira_400Regular,
    Saira_500Medium,
    Saira_600SemiBold,
    Saira_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // §4 sync triggers: app foreground + connectivity regained
  // (ride-stop triggers it directly).
  useEffect(() => {
    syncPendingRides();
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') syncPendingRides();
    });
    const netSub = Network.addNetworkStateListener(({ isInternetReachable }) => {
      if (isInternetReachable) syncPendingRides();
    });
    return () => {
      appSub.remove();
      netSub.remove();
    };
  }, []);

  if (!fontsLoaded) return null;

  return (
    <Analytics>
      <SessionProvider>
        <PushWiring />
        <View style={{ flex: 1, backgroundColor: color.void }}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: color.void },
              // Quick, mechanical, one direction — motion stays §8-restrained.
              animation: 'slide_from_right',
              animationDuration: 220,
            }}
          />
        </View>
      </SessionProvider>
    </Analytics>
  );
}

export default sentryDsn ? Sentry.wrap(RootLayout) : RootLayout;
