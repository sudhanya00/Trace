import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../src/components/Avatar';
import { FollowEdge, followEdges } from '../src/lib/db';
import { color, font, layout } from '../src/theme/tokens';

/** The follow graph, as two lists. Reached from the counts on the profile —
 *  the place people look for them (item 9, 2026-07-21). */
export default function Follows() {
  const { dir } = useLocalSearchParams<{ dir?: string }>();
  const [tab, setTab] = useState<'followers' | 'following'>(
    dir === 'following' ? 'following' : 'followers'
  );
  const [edges, setEdges] = useState<FollowEdge[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      followEdges().then((e) => alive && setEdges(e)).catch(() => {});
      return () => {
        alive = false;
      };
    }, [])
  );

  const rows =
    tab === 'followers'
      ? edges.filter((e) => e.direction === 'follower' && e.state === 'accepted')
      : edges.filter((e) => e.direction === 'following');

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}>
      <View style={st.head}>
        <Text style={st.h1}>Riders</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 8 }}>
          <Text style={st.back}>Done</Text>
        </Pressable>
      </View>

      <View style={st.tabsRow}>
        {(['followers', 'following'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={st.tabBtn}>
            <Text style={[st.tabText, tab === t && st.tabTextOn]}>{t.toUpperCase()}</Text>
            {tab === t && <View style={st.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      {rows.length === 0 ? (
        <Text style={st.empty}>
          {tab === 'followers'
            ? 'Nobody yet. Share a road and they turn up.'
            : 'Find the riders you know — routes travel through people.'}
        </Text>
      ) : (
        rows.map((e) => (
          <Pressable key={e.other_id} onPress={() => router.push(`/rider/${e.other_id}`)}>
            {({ pressed }) => (
              <View style={[st.row, pressed && { backgroundColor: color.slate }]}>
                <Avatar handle={e.handle} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={st.name}>@{e.handle}</Text>
                  {e.display_name ? <Text style={st.sub}>{e.display_name}</Text> : null}
                </View>
                {e.state === 'pending' && <Text style={st.chip}>REQUESTED</Text>}
                <Feather name="chevron-right" size={16} color={color.dim} />
              </View>
            )}
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 70, paddingBottom: 60 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: {
    fontFamily: font.display,
    fontSize: 34,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 36,
  },
  back: { fontFamily: font.bodyMedium, fontSize: 14, color: color.steel },
  tabsRow: {
    flexDirection: 'row',
    marginTop: 18,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.6, color: color.dim },
  tabTextOn: { color: color.white },
  tabUnderline: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: color.signal,
  },
  empty: { fontFamily: font.body, fontSize: 12.5, color: color.dim, marginTop: 18, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  name: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  sub: { fontFamily: font.body, fontSize: 11.5, color: color.steel, marginTop: 3 },
  chip: {
    fontFamily: font.mono,
    fontSize: 7.5,
    letterSpacing: 1.2,
    color: color.steel,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3.5,
  },
});
