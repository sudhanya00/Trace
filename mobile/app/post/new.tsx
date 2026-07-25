import { router } from 'expo-router';
import { showAlert } from '../../src/components/Dialog';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../../src/components/Avatar';
import { useAuth } from '../../src/lib/auth';
import { createPost } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

const MAX = 3000;

/**
 * The composer, rebuilt to the shape everyone already knows (co-founder
 * decision 2026-07-21): Cancel left, Post right, your face beside a cursor
 * that's already blinking. No heading to read, no tag to choose, no form to
 * fill — the fastest path between having a thought and sending it.
 */
export default function NewPost() {
  const { session, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const trimmed = body.trim();
  const canPost = trimmed.length >= 2 && !busy;
  const left = MAX - body.length;

  const submit = async () => {
    if (!session || !canPost) return;
    setBusy(true);
    try {
      await createPost(session.user.id, trimmed);
      router.back();
    } catch (e) {
      showAlert('Could not post', (e as Error).message);
      setBusy(false);
    }
  };

  const discard = () => {
    if (!trimmed) return router.back();
    showAlert('Discard this?', 'What you wrote will be lost.', [
      { text: 'Keep writing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[st.bar, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={discard} hitSlop={10}>
          <Text style={st.cancel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={!canPost}
          style={[st.postBtn, !canPost && st.postBtnOff]}
          hitSlop={6}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#151100" />
          ) : (
            <Text style={[st.postText, !canPost && { color: color.dim }]}>Post</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={st.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={st.row}>
          <Avatar url={profile?.avatar_url} handle={profile?.handle} size={38} />
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="What's the road like?"
            placeholderTextColor={color.dim}
            multiline
            autoFocus
            maxLength={MAX}
            style={st.input}
            textAlignVertical="top"
          />
        </View>
      </ScrollView>

      {/* The counter earns its place only when the ceiling is in sight. */}
      {left < 300 && (
        <View style={[st.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={[st.count, left < 0 && { color: color.amber }]} allowFontScaling={false}>
            {left}
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingBottom: 12,
  },
  cancel: { fontFamily: font.bodyMedium, fontSize: 15, color: color.white },
  postBtn: {
    backgroundColor: color.signal,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 9,
    minWidth: 76,
    alignItems: 'center',
  },
  postBtnOff: { backgroundColor: color.slate2 },
  postText: { fontFamily: font.bodyBold, fontSize: 14, color: '#151100' },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 6, paddingBottom: 40 },
  row: { flexDirection: 'row', gap: 12 },
  input: {
    flex: 1,
    color: color.white,
    fontFamily: font.body,
    fontSize: 17,
    lineHeight: 24,
    paddingTop: 8,
    minHeight: 200,
  },
  footer: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: color.hair,
    alignItems: 'flex-end',
  },
  count: { fontFamily: font.mono, fontSize: 11, color: color.steel, fontVariant: ['tabular-nums'] },
});
