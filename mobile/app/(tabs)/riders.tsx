import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { InviteCard } from '../../src/components/InviteCard';
import { Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  acceptFollow,
  AppNotification,
  declineFollow,
  FollowEdge,
  followEdges,
  listInvites,
  listNotifications,
  markNotificationRead,
  Profile,
  RideInvite,
  rsvpInvite,
  searchRiders,
} from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * Riders (Phase 02): find riders, answer requests, see who you ride with.
 * Regional crews and route threads build on top of this graph.
 */
export default function Riders() {
  const { session, profile } = useAuth();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [edges, setEdges] = useState<FollowEdge[]>([]);
  const [inbox, setInbox] = useState<AppNotification[]>([]);
  const [board, setBoard] = useState<RideInvite[]>([]);

  const loadEdges = useCallback(() => {
    followEdges().then(setEdges).catch(() => {});
    listNotifications().then(setInbox).catch(() => {});
    listInvites(null).then(setBoard).catch(() => {});
  }, []);

  useFocusEffect(loadEdges);

  const toggleRsvp = async (invite: RideInvite, going: boolean) => {
    if (!session) return;
    await rsvpInvite(session.user.id, invite.id, going).catch(() => {});
    listInvites(null).then(setBoard).catch(() => {});
  };

  const openNotification = async (n: AppNotification) => {
    markNotificationRead(n.id).catch(() => {});
    setInbox((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    if (n.data.url) router.push(n.data.url as never);
  };

  const unread = inbox.filter((n) => !n.read);

  useEffect(() => {
    if (!session || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchRiders(session.user.id, q.trim()).then(setResults).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, session]);

  const requests = edges.filter((e) => e.direction === 'follower' && e.state === 'pending');
  const following = edges.filter((e) => e.direction === 'following');
  const followers = edges.filter((e) => e.direction === 'follower' && e.state === 'accepted');

  const answer = async (e: FollowEdge, accept: boolean) => {
    if (!session) return;
    try {
      if (accept) await acceptFollow(e.other_id, session.user.id);
      else await declineFollow(e.other_id, session.user.id);
    } finally {
      loadEdges();
    }
  };

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
      <Text style={st.h1}>Riders</Text>

      {/* you — the door to your own profile */}
      {profile && (
        <Pressable onPress={() => router.push('/(tabs)/profile')}>
          {({ pressed }) => (
            <View style={[st.youRow, pressed && { backgroundColor: color.slate }]}>
              <View style={{ flex: 1 }}>
                <Text style={st.rowName}>@{profile.handle}</Text>
                <MonoLabel size={8.5} style={{ marginTop: 3 }}>
                  {profile.visibility === 'public' ? 'Public profile' : 'Private profile'}
                </MonoLabel>
              </View>
              <Feather name="chevron-right" size={16} color={color.dim} />
            </View>
          )}
        </Pressable>
      )}

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

      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 26 }}>
        <MonoLabel size={9}>Ride board</MonoLabel>
        <Pressable onPress={() => router.push('/invite/new')} hitSlop={8}>
          <Text style={st.planLink}>+ PLAN A RIDE</Text>
        </Pressable>
      </View>
      <View style={{ marginTop: 8 }}>
        {board.length === 0 ? (
          <Text style={st.boardEmpty}>Nothing planned — post the first ride.</Text>
        ) : (
          board.map((i) => <InviteCard key={i.id} invite={i} onToggle={(g) => toggleRsvp(i, g)} />)
        )}
      </View>

      <Field
        label="Find riders"
        value={q}
        onChangeText={setQ}
        placeholder="handle or name"
        style={{ marginTop: 22 }}
      />
      {results.map((p) => (
        <RiderRow
          key={p.id}
          id={p.id}
          title={`@${p.handle}`}
          sub={[p.display_name, p.home_region].filter(Boolean).join(' · ')}
        />
      ))}

      {requests.length > 0 && (
        <>
          <MonoLabel size={9} style={st.section}>
            Requests
          </MonoLabel>
          {requests.map((e) => (
            <View key={e.other_id} style={st.row}>
              <Pressable style={{ flex: 1 }} onPress={() => router.push(`/rider/${e.other_id}`)}>
                <Text style={st.rowName}>@{e.handle}</Text>
                {e.display_name ? (
                  <Text style={st.rowSub}>{e.display_name}</Text>
                ) : null}
              </Pressable>
              <Pressable onPress={() => answer(e, true)} style={[st.smallBtn, st.smallBtnOn]}>
                <Text style={[st.smallBtnText, { color: color.signal }]}>ACCEPT</Text>
              </Pressable>
              <Pressable onPress={() => answer(e, false)} style={st.smallBtn}>
                <Text style={st.smallBtnText}>DECLINE</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}

      <MonoLabel size={9} style={st.section}>
        Following · {following.filter((e) => e.state === 'accepted').length}
      </MonoLabel>
      {following.length === 0 ? (
        <Text style={st.empty}>Find the riders you know — routes travel through people.</Text>
      ) : (
        following.map((e) => (
          <RiderRow
            key={e.other_id}
            id={e.other_id}
            title={`@${e.handle}`}
            sub={e.display_name ?? ''}
            chip={e.state === 'pending' ? 'REQUESTED' : undefined}
          />
        ))
      )}

      {followers.length > 0 && (
        <>
          <MonoLabel size={9} style={st.section}>
            Followers · {followers.length}
          </MonoLabel>
          {followers.map((e) => (
            <RiderRow key={e.other_id} id={e.other_id} title={`@${e.handle}`} sub={e.display_name ?? ''} />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function RiderRow({ id, title, sub, chip }: { id: string; title: string; sub: string; chip?: string }) {
  return (
    <Pressable onPress={() => router.push(`/rider/${id}`)}>
      {({ pressed }) => (
        <View style={[st.row, pressed && { backgroundColor: color.slate }]}>
          <View style={{ flex: 1 }}>
            <Text style={st.rowName}>{title}</Text>
            {sub ? <Text style={st.rowSub}>{sub}</Text> : null}
          </View>
          {chip && (
            <Text style={st.chip}>{chip}</Text>
          )}
          <Feather name="chevron-right" size={16} color={color.dim} />
        </View>
      )}
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 64, paddingBottom: 110 },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 42,
  },
  youRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    padding: 14,
    backgroundColor: color.slate,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 12,
    gap: 8,
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
  empty: { fontFamily: font.body, fontSize: 12.5, color: color.dim, marginTop: 10, lineHeight: 18 },
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
  smallBtn: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  smallBtnOn: { borderColor: 'rgba(255,214,10,.4)', backgroundColor: 'rgba(255,214,10,.10)' },
  smallBtnText: { fontFamily: font.mono, fontSize: 8, letterSpacing: 1.2, color: color.steel },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.signal },
  crewsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    padding: 14,
    backgroundColor: color.slate,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 12,
    gap: 8,
  },
  planLink: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  boardEmpty: { fontFamily: font.body, fontSize: 12.5, color: color.dim },
});
