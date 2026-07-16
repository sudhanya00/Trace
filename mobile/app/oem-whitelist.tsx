import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PushButton } from '../src/components/PushButton';
import { Card, MonoLabel } from '../src/components/ui';
import { OEM_COPY, oemFamily, openWhitelistSettings } from '../src/lib/oem';
import { color, font, layout } from '../src/theme/tokens';

/**
 * §6 walkthrough. Reached from onboarding (aggressive OEM detected), from
 * Settings (re-run), and from a killed-ride recovery. Warns, never gates.
 */
export default function OemWhitelist() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const family = oemFamily();
  const copy = family ? OEM_COPY[family] : null;
  const [opened, setOpened] = useState<null | 'oem' | 'battery' | 'app'>(null);

  const done = () => {
    if (from === 'onboarding') router.replace('/(tabs)/garage');
    else router.back();
  };

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}>
      <MonoLabel size={9}>{copy ? copy.skin.toUpperCase() : 'BATTERY SETTINGS'}</MonoLabel>
      <Text style={st.h1}>Keep recording alive</Text>
      <Text style={st.body}>
        {copy
          ? `${copy.skin} kills background apps to save battery — including a ride recorder mid-ride. Two minutes of settings stops that from ever happening.`
          : 'Some phones kill background apps to save battery — including a ride recorder mid-ride. Allowing TRACE to run unrestricted stops that.'}
      </Text>

      {copy && (
        <Card style={{ marginTop: 24 }}>
          {copy.steps.map((s, i) => (
            <View key={i} style={[st.stepRow, i > 0 && st.stepDivider]}>
              <Text style={st.stepNum}>{i + 1}</Text>
              <Text style={st.stepText}>{s}</Text>
            </View>
          ))}
        </Card>
      )}

      <PushButton
        label="Open phone settings"
        onPress={async () => setOpened(await openWhitelistSettings(family))}
        style={{ marginTop: 26 }}
      />
      {opened === 'battery' && (
        <Text style={st.hint}>Find TRACE in the list and choose "Don't optimise".</Text>
      )}
      {opened === 'app' && (
        <Text style={st.hint}>Go to Battery → allow unrestricted background use.</Text>
      )}

      <Pressable onPress={done} style={st.skip}>
        <Text style={st.skipText}>{opened ? 'Done' : 'Skip for now'}</Text>
      </Pressable>

      <Text style={st.foot}>
        You can re-run this any time from Settings. If a ride ever stops by itself, this screen is
        the fix.
      </Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 84, paddingBottom: 60 },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 8,
    lineHeight: 40,
  },
  body: { fontFamily: font.body, fontSize: 13, color: color.steel, lineHeight: 20, marginTop: 12 },
  stepRow: { flexDirection: 'row', gap: 14, paddingVertical: 12, alignItems: 'flex-start' },
  stepDivider: { borderTopWidth: 1, borderTopColor: color.hair },
  stepNum: {
    fontFamily: font.mono,
    fontSize: 11,
    color: color.signal,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  stepText: { flex: 1, fontFamily: font.body, fontSize: 13, color: color.white, lineHeight: 18 },
  hint: { fontFamily: font.body, fontSize: 12, color: color.amber, marginTop: 12, lineHeight: 17 },
  skip: { alignSelf: 'center', marginTop: 22, padding: 8 },
  skipText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
  foot: { fontFamily: font.body, fontSize: 11, color: color.dim, marginTop: 26, lineHeight: 16 },
});
