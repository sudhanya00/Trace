import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  addPostComment,
  deletePost,
  deletePostComment,
  flagPost,
  getPost,
  Post,
  PostComment,
  postThread,
} from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

function ago(iso: string): string {
  const m = Math.floor((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [thread, setThread] = useState<PostComment[]>([]);
  const [reply, setReply] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    getPost(id).then(setPost).catch(() => {});
    postThread(id).then(setThread).catch(() => {});
  }, [id]);

  useFocusEffect(load);

  const send = async () => {
    if (!session || !id || !reply.trim()) return;
    try {
      await addPostComment(session.user.id, id, reply.trim());
      setReply('');
      load();
    } catch (e) {
      Alert.alert('Could not reply', (e as Error).message);
    }
  };

  const onLongPressPost = () => {
    if (!session || !post) return;
    if (post.profile_id === session.user.id) {
      Alert.alert('Delete this post?', undefined, [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deletePost(post.id).catch(() => {});
            router.back();
          },
        },
      ]);
    } else {
      Alert.alert('Flag this post?', 'Sends it to us for review.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Flag', onPress: () => flagPost(session.user.id, post.id).catch(() => {}) },
      ]);
    }
  };

  const onLongPressComment = (c: PostComment) => {
    if (!session || c.profile_id !== session.user.id) return;
    Alert.alert('Delete your reply?', undefined, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deletePostComment(c.id).catch(() => {});
          load();
        },
      },
    ]);
  };

  if (!post) return <View style={st.root} />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <Pressable onLongPress={onLongPressPost}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Pressable onPress={() => router.push(`/rider/${post.profile_id}`)} hitSlop={6}>
              <Text style={st.author}>@{post.handle}</Text>
            </Pressable>
            <Text style={st.tag}>{post.tag.toUpperCase()}</Text>
            <Text style={st.when}>{ago(post.created_at)}</Text>
          </View>
          <Text style={st.body}>{post.body}</Text>
        </Pressable>

        <MonoLabel size={9} style={{ marginTop: 26, marginBottom: 4 }}>
          Replies · {thread.length}
        </MonoLabel>
        {thread.length === 0 && <Text style={st.empty}>Nobody's answered yet.</Text>}
        {thread.map((c) => (
          <Pressable key={c.id} onLongPress={() => onLongPressComment(c)}>
            <View style={st.commentRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Text style={st.commentAuthor}>@{c.handle}</Text>
                <Text style={st.when}>{ago(c.created_at)}</Text>
              </View>
              <Text style={st.commentBody}>{c.body}</Text>
            </View>
          </Pressable>
        ))}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, alignItems: 'flex-end' }}>
          <Field
            label="Reply"
            value={reply}
            onChangeText={setReply}
            placeholder="What do you know?"
            autoCapitalize="sentences"
            style={{ flex: 1 }}
          />
          <Pressable
            onPress={send}
            disabled={!reply.trim()}
            style={[st.sendBtn, !reply.trim() && { opacity: 0.4 }]}
          >
            <Text style={st.sendText}>SEND</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => router.back()} style={st.back}>
          <Text style={st.backText}>Back</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 76, paddingBottom: 60 },
  author: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  tag: {
    fontFamily: font.mono,
    fontSize: 7.5,
    letterSpacing: 1.2,
    color: color.steel,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2.5,
  },
  when: { fontFamily: font.mono, fontSize: 8.5, color: color.dim },
  body: { fontFamily: font.body, fontSize: 15, color: '#D7DBDD', lineHeight: 22, marginTop: 12 },
  empty: { fontFamily: font.body, fontSize: 12.5, color: color.dim, marginTop: 8 },
  commentRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: color.hair },
  commentAuthor: { fontFamily: font.bodySemi, fontSize: 12.5, color: color.white },
  commentBody: { fontFamily: font.body, fontSize: 13, color: '#C6CBCE', lineHeight: 19, marginTop: 5 },
  sendBtn: { backgroundColor: color.signal, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 13 },
  sendText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: '#F2F7FF' },
  back: { alignSelf: 'center', marginTop: 18, padding: 8 },
  backText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
