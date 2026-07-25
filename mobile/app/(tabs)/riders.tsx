import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CrewLeaderboards } from '../../src/components/CrewLeaderboards';
import { InviteCard } from '../../src/components/InviteCard';
import { TraceLoader } from '../../src/components/Loading';
import { PushButton } from '../../src/components/PushButton';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  acceptFollow,
  AppNotification,
  crewLeaderboard,
  declineFollow,
  FollowEdge,
  followEdges,
  LeaderboardCrew,
  listInvites,
  listNotifications,
  markNotificationRead,
  RideInvite,
  RsvpAnswers,
  rsvpInvite,
} from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * Riders — the community tab. Finding riders and the follow graph moved to the
 * profile (item 9, 2026-07-21) where they read naturally; what's left is what
 * the tab was always actually about: what the crews are doing, what's being
 * ridden next, and who wants something from you.
 */
export default function Riders() {
  const { session } = useAuth();
  const [edges, setEdges] = useState<FollowEdge[]>([]);
  const [inbox, setInbox] = useState<AppNotification[]>([]);
  const [board, setBoard] = useState<RideInvite[]>([]);
  const [crews, setCrews] = useState<LeaderboardCrew[]>([]);

  const load = useCallback(() => {
    followEdges().then(setEdges).catch(() => {});
    listNotifications().then(setInbox).catch(() => {});
    listInvites(null).then(setBoard).catch(() => {});
    crewLeaderboard().then(setCrews).catch(() => {});
  }, []);

  useFocusEffect(load);

  const toggleRsvp = async (invite: RideInvite, going: boolean, answers?: RsvpAnswers) => {
    if (!session) return;
    await rsvpInvite(session.user.id, invite.id, going, answers).catch(() => {});
    listInvites(null).then(setBoard).catch(() => {});
  };

  const openNotification = async (n: AppNotification) => {
    markNotificationRead(n.id).catch(() => {});
    setInbox((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    if (n.data.url) router.push(n.data.url as never);
  };

  const unread = inbox.filter((n) => !n.read);
  const requests = edges.filter((e) => e.direction === 'follower' && e.state === 'pending');

  const answer = async (e: FollowEdge, accept: boolean) => {
    if (!session) return;
    try {
      if (accept) await acceptFollow(e.other_id, session.user.id);
      else await declineFollow(e.other_id, session.user.id);
    } finally {
      load();
    }
  };

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}>
      <Text style={st.h1}>Riders</Text>

      {unread.length > 0 && (
        <>
          <MonoLabel size={9} style={st.section}>
            New
          </MonoLabel>
          {unread.map((n) => (
            <Pressable key={n.id} onPress={() => openNotification(n)}>
              {({ pressed }) => (
                <View style={[st.row, pressed && { backgroundColor: color.slate }]}>
                  <View style={st.unreadDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.rowName}>{n.title}</Text>
                    {n.body ? <Text style={st.rowSub}>{n.body}</Text> : null}
                  </View>
                </View>
              )}
            </Pressable>
          ))}
        </>
      )}

      {requests.length > 0 && (
        <>
          <MonoLabel size={9} style={st.section}>
            Follow requests
          </MonoLabel>
          {requests.map((e) => (
            <View key={e.other_id} style={st.row}>
              <Pressable style={{ flex: 1 }} onPress={() => router.push(`/rider/${e.other_id}`)}>
                <Text style={st.rowName}>@{e.handle}</Text>
                {e.display_name ? <Text style={st.rowSub}>{e.display_name}</Text> : null}
              </Pressable>
              <Pressable onPress={() => answer(e, true)} style={[st.smallBtn, st.smallBtnOn]}>
                <Text style={[st.smallBtnText, { color: color.white }]}>ACCEPT</Text>
              </Pressable>
              <Pressable onPress={() => answer(e, false)} style={st.smallBtn}>
                <Text style={st.smallBtnText}>DECLINE</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}

      <Pressable onPress={() => router.push('/crews')}>
        {({ pressed }) => (
          <View style={[st.crewsRow, pressed && { backgroundColor: color.slate2 }]}>
            <View style={{ flex: 1 }}>
              <Text style={st.rowName}>Crews</Text>
              <Text style={st.rowSub}>Local groups, live chat. Find yours or start it.</Text>
            </View>
            <Feather name="chevron-right" size={16} color={color.dim} />
          </View>
        )}
      </Pressable>

      <MonoLabel size={9} style={st.section}>
        Crew leaderboard
      </MonoLabel>
      <View style={{ marginTop: 10 }}>
        <CrewLeaderboards crews={crews} />
      </View>

      <MonoLabel size={9} style={{ marginTop: 30 }}>
        Ride board
      </MonoLabel>
      <View style={{ marginTop: 10 }}>
        {board.length === 0 ? (
          // A designed empty state (§3.4): a ghosted trace in the crew
          // language, a line of copy, and a real button — not a dead-end.
          <View style={st.emptyState}>
            <TraceLoader size={1.6} />
            <Text style={st.boardEmpty}>Nothing planned yet. Put a ride on the board and see who's in.</Text>
            <PushButton
              label="Plan a ride"
              variant="secondary"
              onPress={() => router.push('/invite/new')}
              style={{ alignSelf: 'stretch', marginTop: 4 }}
            />
          </View>
        ) : (
          <>
            {board.map((i) => (
              <InviteCard
                key={i.id}
                invite={i}
                onOpen={() => router.push(`/invite/${i.id}`)}
                onToggle={(g, a) => toggleRsvp(i, g, a)}
              />
            ))}
            <PushButton
              label="Plan a ride"
              variant="secondary"
              onPress={() => router.push('/invite/new')}
              style={{ marginTop: 6 }}
            />
          </>
        )}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 64, paddingBottom: 132 },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 42,
  },
  section: { marginTop: 28, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
    gap: 10,
  },
  rowName: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  rowSub: { fontFamily: font.body, fontSize: 11.5, color: color.steel, marginTop: 3 },
  smallBtn: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  smallBtnOn: { borderColor: color.disabled, backgroundColor: color.slate2 },
  smallBtnText: { fontFamily: font.mono, fontSize: 8, letterSpacing: 1.2, color: color.steel },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.white },
  crewsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    padding: 14,
    backgroundColor: color.slate,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 12,
    gap: 8,
  },
  planLink: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  boardEmpty: { fontFamily: font.body, fontSize: 12.5, color: color.dim, textAlign: 'center', lineHeight: 18 },
  emptyState: { alignItems: 'center', gap: 14, paddingVertical: 24, borderWidth: 1, borderColor: color.hair, borderRadius: 16, paddingHorizontal: 20 },
});
