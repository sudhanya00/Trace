import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { CreateSheet } from '../../src/components/CreateSheet';
import { InviteCard } from '../../src/components/InviteCard';
import { PostCard } from '../../src/components/PostCard';
import { FeedSkeleton } from '../../src/components/Skeleton';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  exploreFeed,
  FeedItem,
  RideInvite,
  RsvpAnswers,
  rsvpInvite,
  suggestedRiders,
  SuggestedRider,
} from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

function ago(iso: string): string {
  const m = Math.floor((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/**
 * Explore — the front door. One stream, no tags to filter by (co-founder
 * decision 2026-07-21): riders talking and rides being planned, newest first.
 * The + opens the two things you can add to it.
 */
export default function Explore() {
  const { session, profile } = useAuth();
  const [feed, setFeed] = useState<FeedItem[] | null>(null);
  const [suggested, setSuggested] = useState<SuggestedRider[]>([]);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    exploreFeed().then(setFeed).catch(() => {});
    suggestedRiders().then(setSuggested).catch(() => {});
  }, []);

  useFocusEffect(load);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      exploreFeed().then(setFeed).catch(() => {}),
      suggestedRiders().then(setSuggested).catch(() => {}),
    ]);
    setRefreshing(false);
  }, []);

  const toggleRsvp = async (id: string, going: boolean, answers?: RsvpAnswers) => {
    if (!session) return;
    await rsvpInvite(session.user.id, id, going, answers).catch(() => {});
    load();
  };

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
          <Pressable onPress={() => setCreating(true)} style={st.fab} hitSlop={8}>
            <Feather name="plus" size={22} color="#151100" />
          </Pressable>
        </View>
      </View>

      {feed === null ? (
        <FeedSkeleton />
      ) : (
        <FlatList
          data={feed}
          keyExtractor={(i) => `${i.kind}:${i.id}`}
          contentContainerStyle={st.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={color.trace}
              colors={[color.trace]}
              progressBackgroundColor={color.slate}
            />
          }
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
              Quiet out here. First post sets the tone — ask about a road, show off the garage, or
              put a ride on the board.
            </Text>
          }
          renderItem={({ item }) =>
            item.kind === 'ride' ? (
              <View style={st.rideWrap}>
                <InviteCard
                  invite={item as unknown as RideInvite}
                  onOpen={() => router.push(`/invite/${item.id}`)}
                  onToggle={(going, answers) => toggleRsvp(item.id, going, answers)}
                />
              </View>
            ) : (
              <PostCard post={item} rideGeom={item.ride_geom} onChanged={load} />
            )
          }
        />
      )}

      <CreateSheet visible={creating} onClose={() => setCreating(false)} />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  head: { paddingHorizontal: layout.screenPadding, paddingTop: 64, paddingBottom: 16 },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 42,
  },
  fab: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: color.signal,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  list: { paddingBottom: 132 },
  suggestWrap: {
    paddingLeft: layout.screenPadding,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: color.hair,
  },
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
  rideWrap: { paddingHorizontal: layout.screenPadding, paddingTop: 12 },
  postAuthor: { fontFamily: font.bodySemi, fontSize: 13.5, color: color.white },
  postWhen: { fontFamily: font.mono, fontSize: 8.5, color: color.dim },
  postBody: { fontFamily: font.body, fontSize: 14.5, color: '#C6CBCE', lineHeight: 21, marginTop: 5 },
  postComments: {
    fontFamily: font.mono,
    fontSize: 9,
    color: color.steel,
    marginTop: 9,
    fontVariant: ['tabular-nums'],
  },
});
