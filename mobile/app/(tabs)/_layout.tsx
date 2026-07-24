import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { color, font } from '../../src/theme/tokens';

/** §2.4: no puck, no glow. Active is simply white, inactive tertiary — the
 *  contrast is the signal. Nav never wears the action colour. */
function TabIcon({ name, focused }: { name: keyof typeof Feather.glyphMap; focused: boolean }) {
  return (
    <View style={ti.slot}>
      <Feather name={name} size={20} color={focused ? color.white : color.dim} />
    </View>
  );
}

const ti = StyleSheet.create({
  slot: { width: 40, height: 30, alignItems: 'center', justifyContent: 'center' },
});

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
        // Glass nav: blur over pitch black, a lit hairline along the top edge,
        // active icons glowing in their pucks. Floating, alive, still dark.
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          height: 86,
          paddingTop: 12,
        },
        tabBarBackground: () => (
          <View style={{ flex: 1 }}>
            {/* A plain hairline, not a lit yellow gradient. Frosted bar stays —
                it's texture, not a glow. */}
            <View style={{ height: 1, backgroundColor: color.hair }} />
            <BlurView
              intensity={40}
              tint="dark"
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
            />
          </View>
        ),
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
          tabBarIcon: ({ focused }) => <TabIcon name="compass" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="trace"
        options={{
          title: 'TRACE',
          tabBarIcon: ({ focused }) => <TabIcon name="activity" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: 'RECORD',
          tabBarIcon: ({ focused }) => <TabIcon name="disc" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="riders"
        options={{
          title: 'RIDERS',
          tabBarIcon: ({ focused }) => <TabIcon name="users" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'PROFILE',
          tabBarIcon: ({ focused }) => <TabIcon name="user" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
