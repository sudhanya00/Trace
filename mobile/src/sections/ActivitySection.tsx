import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PostCard } from '../components/PostCard';
import { Post, postsOf } from '../lib/db';
import { color, font, layout } from '../theme/tokens';

/** A rider's posts — their voice on the platform. Tags are gone (2026-07-21),
 *  so the row leads with what was said, not with how it was filed. */
export function ActivitySection({
  profileId,
  handle,
  own = false,
}: {
  profileId: string;
  handle: string;
  own?: boolean;
}) {
  const [posts, setPosts] = useState<Post[]>([]);

  const load = useCallback(() => {
    postsOf(profileId).then(setPosts).catch(() => {});
  }, [profileId]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      postsOf(profileId).then((p) => alive && setPosts(p)).catch(() => {});
      return () => {
        alive = false;
      };
    }, [profileId])
  );

  return (
    <View>
      {own && (
        <Pressable onPress={() => router.push('/post/new')} style={st.compose}>
          <Text style={st.composeText}>+ NEW POST</Text>
        </Pressable>
      )}
      {posts.length === 0 ? (
        <Text style={st.empty}>
          {own ? 'Nothing said yet. Ask the road a question.' : `@${handle} hasn't posted yet.`}
        </Text>
      ) : (
        // Negative inset: PostCard carries the screen padding itself, and the
        // profile has already applied it.
        <View style={{ marginHorizontal: -layout.screenPadding }}>
          {posts.map((p) => (
            <PostCard key={p.id} post={p} onChanged={load} />
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  compose: { alignSelf: 'flex-end', paddingVertical: 4, marginBottom: 6 },
  composeText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  empty: { fontFamily: font.body, fontSize: 13, color: color.steel, lineHeight: 19 },
  row: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: color.hair },
  when: { fontFamily: font.mono, fontSize: 8.5, color: color.dim },
  body: { fontFamily: font.body, fontSize: 14, color: '#C6CBCE', lineHeight: 20 },
});
