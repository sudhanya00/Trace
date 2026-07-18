import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { BikeForm } from '../../src/components/BikeForm';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { BikeInput, createBike } from '../../src/lib/db';
import { oemFamily } from '../../src/lib/oem';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * §7 sequence, step 1: the garage is non-empty before anything asks for
 * location. The app is never a blank slate.
 */
export default function FirstBike() {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);

  const submit = async (input: BikeInput) => {
    if (!session) return;
    setBusy(true);
    try {
      await createBike(session.user.id, input);
      // §6: aggressive-OEM handsets get the battery walkthrough right after
      // the garage exists — warn, don't gate.
      router.replace(oemFamily() ? '/oem-whitelist?from=onboarding' : '/(tabs)/explore');
    } catch (e) {
      Alert.alert('Could not save bike', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <MonoLabel>Step 2 of 2</MonoLabel>
        <Text style={st.h1}>Add your first bike</Text>
        <Text style={st.sub}>
          Enter the odometer as it reads today — every ride you record adds to it from here.
        </Text>
        <BikeForm submitLabel="Into the garage" onSubmit={submit} busy={busy} style={{ marginTop: 28 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: 60,
  },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 8,
    lineHeight: 40,
  },
  sub: { fontFamily: font.body, color: color.steel, fontSize: 13, marginTop: 10, lineHeight: 19 },
});
