import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';

import { PushButton } from '../src/components/PushButton';
import { Field, MonoLabel } from '../src/components/ui';
import { supabase } from '../src/lib/supabase';
import { color, font, layout } from '../src/theme/tokens';

/**
 * Sign-in. Email is primary for the tester phase (user decision 2026-07-17);
 * the phone-OTP flow is built, tested, and parked behind this flag until an
 * SMS provider is configured for production — flip it and phone leads again.
 */
const PHONE_AUTH_ENABLED = false;

/** "98765 43210" → "+919876543210"; anything already-international passes through. */
function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-()]/g, '');
  if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  return null;
}

export default function Auth() {
  const [step, setStep] = useState<'phone' | 'code' | 'email'>(
    PHONE_AUTH_ENABLED ? 'phone' : 'email'
  );
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailMode, setEmailMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);
  const sentTo = useRef<string | null>(null);

  const sendCode = async () => {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      Alert.alert('Check the number', 'Ten digits, or the full number with country code.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
      if (error) throw error;
      sentTo.current = normalized;
      setCode('');
      setStep('code');
    } catch (e) {
      Alert.alert('Could not send the code', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!sentTo.current || code.trim().length < 4) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: sentTo.current,
        token: code.trim(),
        type: 'sms',
      });
      if (error) throw error;
      router.replace('/');
    } catch (e) {
      Alert.alert('Wrong code?', (e as Error).message);
      setBusy(false);
    }
  };

  const submitEmail = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      if (emailMode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.replace('/');
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (data.session) router.replace('/');
        else {
          Alert.alert('Check your email', 'Confirm your address, then sign in.');
          setEmailMode('in');
        }
      }
    } catch (e) {
      Alert.alert('Sign in failed', (e as Error).message);
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

        {step === 'phone' && (
          <>
            <Field
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="98765 43210"
              keyboardType="phone-pad"
              style={{ marginTop: 40 }}
            />
            <PushButton
              label="Send code"
              onPress={sendCode}
              disabled={busy || phone.replace(/\D/g, '').length < 10}
              style={{ marginTop: 30 }}
            />
            <Pressable onPress={() => setStep('email')} style={st.switch}>
              <Text style={st.switchText}>Use email instead</Text>
            </Pressable>
          </>
        )}

        {step === 'code' && (
          <>
            <MonoLabel size={9} style={{ marginTop: 40 }}>
              Code sent to {sentTo.current}
            </MonoLabel>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="••••••"
              placeholderTextColor={color.dim}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              style={st.codeInput}
            />
            <PushButton
              label="Verify"
              onPress={verify}
              disabled={busy || code.trim().length < 4}
              style={{ marginTop: 26 }}
            />
            <Pressable onPress={() => setStep('phone')} style={st.switch}>
              <Text style={st.switchText}>Different number</Text>
            </Pressable>
          </>
        )}

        {step === 'email' && (
          <>
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
              label={emailMode === 'in' ? 'Sign in' : 'Create account'}
              onPress={submitEmail}
              disabled={busy || !email.trim() || password.length < 6}
              style={{ marginTop: 30 }}
            />
            <Pressable onPress={() => setEmailMode(emailMode === 'in' ? 'up' : 'in')} style={st.switch}>
              <Text style={st.switchText}>
                {emailMode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
              </Text>
            </Pressable>
            {PHONE_AUTH_ENABLED && (
              <Pressable onPress={() => setStep('phone')} style={st.switch}>
                <Text style={st.switchText}>Use phone instead</Text>
              </Pressable>
            )}
          </>
        )}
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
  codeInput: {
    marginTop: 14,
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    color: color.white,
    fontFamily: font.display,
    fontSize: 30,
    letterSpacing: 12,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  switch: { marginTop: 18, alignSelf: 'center', padding: 6 },
  switchText: { fontFamily: font.bodyMedium, color: color.steel, fontSize: 13 },
});
