import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { color, font, shadow } from '../../src/theme/tokens';

/** Active icons sit in a lit puck — the light source the nav needed. */
function TabIcon({ name, focused }: { name: keyof typeof Feather.glyphMap; focused: boolean }) {
  return (
    <View style={[ti.puck, focused && ti.puckOn]}>
      <Feather name={name} size={19} color={focused ? color.signal : color.dim} />
    </View>
  );
}

const ti = StyleSheet.create({
  puck: {
    width: 40,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puckOn: {
    backgroundColor: 'rgba(46,125,255,0.14)',
    boxShadow: shadow.signalGlow,
  },
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
            <LinearGradient
              colors={['rgba(46,125,255,0)', 'rgba(46,125,255,0.35)', 'rgba(46,125,255,0)']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ height: 1.25 }}
            />
            <BlurView
              intensity={48}
              tint="dark"
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' }}
            />
          </View>
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
