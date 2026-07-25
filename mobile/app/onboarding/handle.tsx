import { router } from 'expo-router';
import { showAlert } from '../../src/components/Dialog';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { createProfile } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export default function Handle() {
  const { session, profile, refreshProfile } = useAuth();
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);

  // If a profile materializes (late fetch, cache, recovery), this screen has
  // no business existing — leave immediately.
  useEffect(() => {
    if (profile) router.replace('/');
  }, [profile]);

  const cleaned = handle.trim().toLowerCase();
  const valid = HANDLE_RE.test(cleaned);

  const submit = async () => {
    if (!session || !valid) return;
    setBusy(true);
    try {
      await createProfile(session.user.id, cleaned);
      await refreshProfile();
      router.replace('/onboarding/bike');
    } catch (e) {
      const err = e as { code?: string; message?: string };
      // A PK collision means this account ALREADY HAS a profile — we were
      // routed here by a failed fetch, not a missing row. Recover, don't argue.
      if (err.code === '23505' && err.message?.includes('profiles_pkey')) {
        await refreshProfile().catch(() => {});
        router.replace('/');
        return;
      }
      const msg =
        err.code === '23505' ? 'That handle is taken — try another.' : (err.message ?? 'Try again.');
      showAlert('Could not save handle', msg);
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
        <MonoLabel>Step 1 of 2</MonoLabel>
        <Text style={st.h1}>Pick your handle</Text>
        <Text style={st.sub}>How other riders will know you. Letters, numbers, underscores.</Text>

        <Field
          label="Handle"
          value={handle}
          onChangeText={setHandle}
          placeholder="ridge_runner"
          style={{ marginTop: 28 }}
        />

        <PushButton
          label="Continue"
          onPress={submit}
          disabled={busy || !valid}
          style={{ marginTop: 30 }}
        />
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
