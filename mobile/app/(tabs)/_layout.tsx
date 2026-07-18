import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router';

import { color, font } from '../../src/theme/tokens';

/**
 * Phase 01 tabs only. The prototype's TRACE (map) and RIDERS (community) tabs
 * are Phase 02 — don't stub them (§13).
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.void },
        // Floating over a fade, like the reference — no hard border line.
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          height: 84,
          paddingTop: 14,
        },
        tabBarBackground: () => (
          <LinearGradient
            colors={['rgba(11,13,14,0)', color.void]}
            locations={[0, 0.42]}
            style={{ flex: 1 }}
          />
        ),
        // Prototype: active icon is signal, active label is white.
        tabBarActiveTintColor: color.white,
        tabBarInactiveTintColor: color.dim,
        tabBarLabelStyle: {
          fontFamily: font.mono,
          fontSize: 8,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          marginTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="explore"
        options={{
          title: 'EXPLORE',
          tabBarIcon: ({ focused }) => (
            <Feather name="compass" size={19} color={focused ? color.signal : color.dim} />
          ),
        }}
      />
      <Tabs.Screen
        name="trace"
        options={{
          title: 'TRACE',
          tabBarIcon: ({ focused }) => (
            <Feather name="activity" size={19} color={focused ? color.signal : color.dim} />
          ),
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: 'RECORD',
          tabBarIcon: ({ focused }) => (
            <Feather name="disc" size={19} color={focused ? color.signal : color.dim} />
          ),
        }}
      />
      <Tabs.Screen
        name="riders"
        options={{
          title: 'RIDERS',
          tabBarIcon: ({ focused }) => (
            <Feather name="users" size={19} color={focused ? color.signal : color.dim} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'PROFILE',
          tabBarIcon: ({ focused }) => (
            <Feather name="user" size={19} color={focused ? color.signal : color.dim} />
          ),
        }}
      />
    </Tabs>
  );
}
