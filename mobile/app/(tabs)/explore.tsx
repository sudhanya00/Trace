import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Loading } from '../../src/components/Loading';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { exploreFeed, Post, PostTag, suggestedRiders, SuggestedRider } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

const TAGS: (PostTag | null)[] = [null, 'ask', 'tips', 'gear', 'bike', 'road', 'story'];

function ago(iso: string): string {
  const m = Math.floor((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/**
 * Explore — the front door (user decision 2026-07-17). The feed is riders
 * talking: questions, gear, roads. Tag chips filter; suggested riders keep
 * the graph growing.
 */
export default function Explore() {
  const { profile } = useAuth();
  const [tag, setTag] = useState<PostTag | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [suggested, setSuggested] = useState<SuggestedRider[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      exploreFeed(tag).then((p) => alive && setPosts(p)).catch(() => {});
      suggestedRiders().then((s) => alive && setSuggested(s)).catch(() => {});
      return () => {
        alive = false;
      };
    }, [tag])
  );

  return (
    <View style={st.root}>
      <View style={st.head}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <MonoLabel size={9.5} style={{ letterSpacing: 2.3 }}>
              {profile ? `@${profile.handle.toUpperCase()}` : 'RIDE. TRACE. BELONG.'}
            </MonoLabel>
            <Text style={st.h1}>Explore</Text>
          </View>
          <Pressable onPress={() => router.push('/post/new')} style={st.newPost}>
            <Text style={st.newPostText}>+ POST</Text>
          </Pressable>
        </View>

        <View style={st.tagRow}>
          {TAGS.map((t) => (
            <Pressable key={t ?? 'all'} onPress={() => setTag(t)} style={[st.chip, tag === t && st.chipOn]}>
              <Text style={[st.chipText, tag === t && { color: color.signal }]}>
                {(t ?? 'all').toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {posts === null ? (
        <Loading label="Finding the conversation" />
      ) : (
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={st.list}
        ListHeaderComponent={
          suggested.length > 0 ? (
            <View style={st.suggestWrap}>
              <MonoLabel size={8.5} style={{ marginBottom: 8 }}>
                Riders you might know
              </MonoLabel>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={suggested}
                keyExtractor={(s) => s.id}
                renderItem={({ item }) => (
                  <Pressable onPress={() => router.push(`/rider/${item.id}`)} style={st.suggestCard}>
                    <Text style={st.suggestHandle}>@{item.handle}</Text>
                    <Text style={st.suggestReason}>{item.reason}</Text>
                  </Pressable>
                )}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <Text style={st.empty}>
            Quiet out here. First post sets the tone — ask about a road, show off the garage.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/post/${item.id}`)}>
            {({ pressed }) => (
              <View style={[st.post, pressed && { backgroundColor: color.slate }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Pressable onPress={() => router.push(`/rider/${item.profile_id}`)} hitSlop={6}>
                    <Text style={st.postAuthor}>@{item.handle}</Text>
                  </Pressable>
                  <Text style={st.postTag}>{item.tag.toUpperCase()}</Text>
                  <Text style={st.postWhen}>{ago(item.created_at)}</Text>
                </View>
                <Text style={st.postBody} numberOfLines={6}>
                  {item.body}
                </Text>
                {item.comment_count > 0 && (
                  <Text style={st.postComments} allowFontScaling={false}>
                    {item.comment_count} repl{item.comment_count === 1 ? 'y' : 'ies'}
                  </Text>
                )}
              </View>
            )}
          </Pressable>
        )}
      />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  head: { paddingHorizontal: layout.screenPadding, paddingTop: 64 },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 42,
  },
  newPost: {
    backgroundColor: color.signal,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 4,
  },
  newPostText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: '#F2F7FF' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 16, paddingBottom: 14 },
  chip: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  chipOn: { borderColor: 'rgba(46,125,255,.4)', backgroundColor: 'rgba(46,125,255,.10)' },
  chipText: { fontFamily: font.mono, fontSize: 8.5, letterSpacing: 1, color: color.steel },
  list: { paddingBottom: 110 },
  suggestWrap: { paddingLeft: layout.screenPadding, paddingVertical: 12, borderTopWidth: 1, borderTopColor: color.hair },
  suggestCard: {
    backgroundColor: color.slate,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginRight: 8,
    minWidth: 130,
  },
  suggestHandle: { fontFamily: font.bodySemi, fontSize: 13, color: color.white },
  suggestReason: { fontFamily: font.body, fontSize: 10.5, color: color.steel, marginTop: 4 },
  empty: {
    fontFamily: font.body,
    fontSize: 13,
    color: color.steel,
    lineHeight: 19,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 26,
  },
  post: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: color.hair,
  },
  postAuthor: { fontFamily: font.bodySemi, fontSize: 13, color: color.white },
  postTag: {
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
  postWhen: { fontFamily: font.mono, fontSize: 8.5, color: color.dim },
  postBody: { fontFamily: font.body, fontSize: 14, color: '#C6CBCE', lineHeight: 20, marginTop: 8 },
  postComments: { fontFamily: font.mono, fontSize: 9, color: color.steel, marginTop: 9, fontVariant: ['tabular-nums'] },
});
