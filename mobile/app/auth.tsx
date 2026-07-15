import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';

import { PushButton } from '../src/components/PushButton';
import { Field, MonoLabel } from '../src/components/ui';
import { supabase } from '../src/lib/supabase';
import { color, font, layout } from '../src/theme/tokens';

export default function Auth() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.replace('/');
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (data.session) {
          router.replace('/');
        } else {
          Alert.alert('Check your email', 'Confirm your address, then sign in.');
          setMode('in');
        }
      }
    } catch (e) {
      Alert.alert(mode === 'in' ? 'Sign in failed' : 'Sign up failed', (e as Error).message);
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
        <MonoLabel style={{ marginBottom: 8 }}>Ride. Trace. Belong.</MonoLabel>
        <Text style={st.word}>TRACE</Text>

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@somewhere.com"
          keyboardType="email-address"
          style={{ marginTop: 40 }}
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={{ marginTop: 18 }}
        />

        <PushButton
          label={mode === 'in' ? 'Sign in' : 'Create account'}
          onPress={submit}
          disabled={busy || !email.trim() || password.length < 6}
          style={{ marginTop: 30 }}
        />

        <Pressable onPress={() => setMode(mode === 'in' ? 'up' : 'in')} style={st.switch}>
          <Text style={st.switchText}>
            {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </Text>
        </Pressable>

        <MonoLabel size={8.5} style={{ marginTop: 34, color: color.dim }}>
          Google and Apple sign-in are on the way
        </MonoLabel>
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
  word: {
    fontFamily: font.display,
    fontSize: 56,
    color: color.white,
    letterSpacing: 2,
    lineHeight: 58,
  },
  switch: { marginTop: 22, paddingVertical: 6 },
  switchText: { fontFamily: font.bodyMedium, color: color.steel, fontSize: 13 },
});
