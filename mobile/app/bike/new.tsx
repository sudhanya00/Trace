import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { BikeForm } from '../../src/components/BikeForm';
import { useAuth } from '../../src/lib/auth';
import { BikeInput, createBike } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

export default function NewBike() {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);

  const submit = async (input: BikeInput) => {
    if (!session) return;
    setBusy(true);
    try {
      await createBike(session.user.id, input);
      router.back();
    } catch (e) {
      Alert.alert('Could not save bike', (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <Text style={st.h1}>Add a bike</Text>
        <BikeForm submitLabel="Into the garage" onSubmit={submit} busy={busy} style={{ marginTop: 24 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  scroll: { paddingHorizontal: layout.screenPadding, paddingTop: 72, paddingBottom: 48 },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 40,
  },
});
