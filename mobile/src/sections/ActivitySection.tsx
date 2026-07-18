import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { activityOf, Post } from '../lib/db';
import { color, font } from '../theme/tokens';

function ago(iso: string): string {
  const m = Math.floor((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/** A rider's posts — their voice on the platform. */
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

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      activityOf(profileId).then((p) => alive && setPosts(p)).catch(() => {});
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
        posts.map((p) => (
          <Pressable key={p.id} onPress={() => router.push(`/post/${p.id}`)}>
            {({ pressed }) => (
              <View style={[st.row, pressed && { backgroundColor: color.slate }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text style={st.tag}>{p.tag.toUpperCase()}</Text>
                  <Text style={st.when}>{ago(p.created_at)}</Text>
                </View>
                <Text style={st.body} numberOfLines={4}>
                  {p.body}
                </Text>
              </View>
            )}
          </Pressable>
        ))
      )}
    </View>
  );
}

const st = StyleSheet.create({
  compose: { alignSelf: 'flex-end', paddingVertical: 4, marginBottom: 6 },
  composeText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  empty: { fontFamily: font.body, fontSize: 13, color: color.steel, lineHeight: 19 },
  row: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: color.hair },
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
  body: { fontFamily: font.body, fontSize: 13.5, color: '#C6CBCE', lineHeight: 19, marginTop: 7 },
});
