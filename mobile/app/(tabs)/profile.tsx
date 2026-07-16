import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { Card, Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { updateProfile } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

export default function ProfileScreen() {
  const { profile, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [region, setRegion] = useState(profile?.home_region ?? '');
  const [busy, setBusy] = useState(false);

  if (!profile) return <View style={st.root} />;

  const isPublic = profile.visibility === 'public';

  const setVisibility = async (pub: boolean) => {
    try {
      await updateProfile(profile.id, { visibility: pub ? 'public' : 'private' });
      await refreshProfile();
    } catch (e) {
      Alert.alert('Could not update visibility', (e as Error).message);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await updateProfile(profile.id, {
        display_name: displayName.trim() || null,
        home_region: region.trim() || null,
      });
      await refreshProfile();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
      <MonoLabel size={9.5}>@{profile.handle}</MonoLabel>
      <Text style={st.h1}>Profile</Text>

      <Field label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="Asha" autoCapitalize="words" style={{ marginTop: 24 }} />
      <Field label="Home region" value={region} onChangeText={setRegion} placeholder="Himachal" autoCapitalize="words" style={{ marginTop: 18 }} />
      <PushButton label="Save" variant="slate" onPress={save} disabled={busy} style={{ marginTop: 24 }} />

      <Card style={{ marginTop: 30 }}>
        <View style={st.visRow}>
          <View style={{ flex: 1, paddingRight: 14 }}>
            <Text style={st.visTitle}>Public profile</Text>
            <Text style={st.visBody}>
              {isPublic
                ? 'Other riders can see your rides and routes. Tracks are always clipped by your privacy zones.'
                : 'Only you can see your rides and routes.'}
            </Text>
          </View>
          <Switch
            value={isPublic}
            onValueChange={setVisibility}
            trackColor={{ false: color.slate2, true: color.moss }}
            thumbColor={color.white}
          />
        </View>
      </Card>

      <PushButton
        label="Settings"
        variant="slate"
        onPress={() => router.push('/settings')}
        style={{ marginTop: 30 }}
      />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 64, paddingBottom: 110 },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 42,
  },
  visRow: { flexDirection: 'row', alignItems: 'center' },
  visTitle: { fontFamily: font.bodySemi, color: color.white, fontSize: 14 },
  visBody: { fontFamily: font.body, color: color.steel, fontSize: 11.5, lineHeight: 16, marginTop: 5 },
});
