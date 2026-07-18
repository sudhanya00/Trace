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
  TextInput,
  View,
} from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { createPost, PostTag } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

const TAGS: PostTag[] = ['general', 'ask', 'tips', 'gear', 'bike', 'road', 'story'];

export default function NewPost() {
  const { session } = useAuth();
  const [tag, setTag] = useState<PostTag>('general');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!session || body.trim().length < 2) return;
    setBusy(true);
    try {
      await createPost(session.user.id, tag, body.trim());
      router.back();
    } catch (e) {
      Alert.alert('Could not post', (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <Text style={st.h1}>Say it</Text>

        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Anyone ridden the Sach Pass road this month? Heard the snow wall's still up…"
          placeholderTextColor={color.dim}
          multiline
          autoFocus
          maxLength={3000}
          style={st.input}
        />

        <MonoLabel size={8.5} style={{ marginTop: 18, marginBottom: 8 }}>
          Tag
        </MonoLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TAGS.map((t) => (
            <Pressable key={t} onPress={() => setTag(t)} style={[st.chip, tag === t && st.chipOn]}>
              <Text style={[st.chipText, tag === t && { color: color.signal }]}>{t.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        <PushButton label="Post" onPress={submit} disabled={busy || body.trim().length < 2} style={{ marginTop: 26 }} />
        <Pressable onPress={() => router.back()} style={st.cancel}>
          <Text style={st.cancelText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 84, paddingBottom: 60 },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 40,
  },
  input: {
    marginTop: 20,
    minHeight: 140,
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 12,
    padding: 16,
    color: color.white,
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
  chip: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipOn: { borderColor: 'rgba(255,214,10,.4)', backgroundColor: 'rgba(255,214,10,.10)' },
  chipText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1, color: color.steel },
  cancel: { alignSelf: 'center', marginTop: 16, padding: 8 },
  cancelText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
