import { Feather } from '@expo/vector-icons';
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
        tabBarStyle: {
          backgroundColor: color.void,
          borderTopColor: color.hair,
          borderTopWidth: 1,
          height: 78,
          paddingTop: 8,
        },
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
        name="garage"
        options={{
          title: 'GARAGE',
          tabBarIcon: ({ focused }) => (
            <Feather name="home" size={19} color={focused ? color.signal : color.dim} />
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
        name="rides"
        options={{
          title: 'RIDES',
          tabBarIcon: ({ focused }) => (
            <Feather name="list" size={19} color={focused ? color.signal : color.dim} />
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
