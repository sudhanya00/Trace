import { router, useLocalSearchParams } from 'expo-router';
import { showAlert } from '../../../src/components/Dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Feather } from '@expo/vector-icons';

import { InviteCard } from '../../../src/components/InviteCard';
import { PushButton } from '../../../src/components/PushButton';
import { MonoLabel } from '../../../src/components/ui';
import { useAuth } from '../../../src/lib/auth';
import {
  approveCrewMember,
  Crew,
  CrewMember,
  CrewMessage,
  LiveRider,
  crewChat,
  crewLiveRiders,
  crewRoster,
  declineCrewRequest,
  joinCrew,
  leaveCrew,
  listInvites,
  myMembership,
  RideInvite,
  rsvpInvite,
  sendCrewMessage,
  setCrewLeaderboard,
} from '../../../src/lib/db';
import { supabase } from '../../../src/lib/supabase';
import { useKeyboardHeight } from '../../../src/lib/useKeyboardHeight';
import { accent, color, font, layout } from '../../../src/theme/tokens';

/**
 * The crew room: live chat over Supabase Realtime. The WAL stream respects
 * RLS, so only members ever receive rows; incoming payloads carry no handle
 * (raw table row), so the roster decorates them client-side.
 */
export default function CrewRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [crew, setCrew] = useState<Crew | null>(null);
  const kbHeight = useKeyboardHeight();
  const [liveRiders, setLiveRiders] = useState<LiveRider[]>([]);
  const [roster, setRoster] = useState<Map<string, CrewMember>>(new Map());
  const [messages, setMessages] = useState<CrewMessage[]>([]);
  const [member, setMember] = useState(false);
  const [pendingMe, setPendingMe] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [requests, setRequests] = useState<CrewMember[]>([]);
  const [draft, setDraft] = useState('');
  const [invites, setInvites] = useState<RideInvite[]>([]);
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  const load = useCallback(async () => {
    if (!id || !session) return;
    const { data: c } = await supabase.from('crews').select('*').eq('id', id).maybeSingle();
    setCrew(c);
    const mine = await myMembership(session.user.id, id).catch(() => null);
    setPendingMe(mine?.state === 'pending');
    setIsAdmin(mine?.role === 'admin' && mine?.state === 'active');
    const r = await crewRoster(id).catch(() => []);
    setRoster(new Map(r.filter((m) => m.state === 'active').map((m) => [m.profile_id, m])));
    setRequests(r.filter((m) => m.state === 'pending'));
    setMember(mine?.state === 'active');
    crewLiveRiders(id).then(setLiveRiders).catch(() => {});
    setMessages(await crewChat(id).catch(() => []));
    setInvites(await listInvites(id).catch(() => []));
  }, [id, session]);

  useEffect(() => {
    load();
  }, [load]);

  // Live inserts: decorate with the roster, newest first (list is inverted).
  useEffect(() => {
    if (!id || !member) return;
    const channel = supabase
      .channel(`crew-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'crew_messages', filter: `crew_id=eq.${id}` },
        (payload) => {
          // Contribution rows arrive here too — written by trigger, so they
          // carry the same shape but no joined handle. The roster supplies it,
          // exactly as it does for chat.
          const row = payload.new as {
            id: string;
            profile_id: string;
            body: string;
            kind?: 'chat' | 'contribution' | 'live_share';
            ride_id?: string | null;
            distance_km?: number | null;
            created_at: string;
          };
          setMessages((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [
                  {
                    id: row.id,
                    profile_id: row.profile_id,
                    handle: rosterRef.current.get(row.profile_id)?.handle ?? 'rider',
                    body: row.body,
                    kind: row.kind ?? 'chat',
                    ride_id: row.ride_id ?? null,
                    distance_km: row.distance_km ?? null,
                    created_at: row.created_at,
                  },
                  ...prev,
                ]
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, member]);

  const send = async () => {
    if (!session || !id || !draft.trim()) return;
    const body = draft.trim();
    setDraft('');
    try {
      await sendCrewMessage(session.user.id, id, body);
    } catch (e) {
      setDraft(body);
      showAlert('Could not send', (e as Error).message);
    }
  };

  const onJoin = async () => {
    if (!session || !id) return;
    try {
      await joinCrew(session.user.id, id);
      load();
    } catch (e) {
      showAlert('Could not join', (e as Error).message);
    }
  };

  const onLeaveQuiet = async () => {
    if (!session || !id) return;
    await leaveCrew(session.user.id, id).catch(() => {});
    load();
  };

  const onLeave = () => {
    if (!session || !id) return;
    showAlert('Leave this crew?', undefined, [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await leaveCrew(session.user.id, id).catch(() => {});
          load();
        },
      },
    ]);
  };

  if (!crew) return <View style={st.root} />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={st.head}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <MonoLabel size={9}>
              {[crew.region, `${roster.size} rider${roster.size === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
            </MonoLabel>
            {/* WhatsApp's move: the title is the way into the crew itself. */}
            <Pressable onPress={() => router.push(`/crew/${id}/about`)} hitSlop={6}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Text style={st.h1}>{crew.name}</Text>
                <Feather name="chevron-right" size={17} color={color.steel} />
              </View>
            </Pressable>
          </View>
          <Pressable onPress={() => router.back()} style={{ padding: 8 }}>
            <Text style={st.backText}>Back</Text>
          </Pressable>
        </View>
      </View>

      {member ? (
        <>
          {/* Who's out right now. Self-cleaning: nothing older than 15 minutes
              counts as live, so this empties itself when riders park. */}
          {liveRiders.length > 0 && (
            <Pressable onPress={() => router.push(`/crew/${id}/live`)} style={st.liveBanner}>
              <View style={st.livePulse} />
              <Text style={st.liveBannerText} numberOfLines={1}>
                {liveRiders.length === 1
                  ? `@${liveRiders[0].handle} is riding now`
                  : `${liveRiders.length} riders out now`}
              </Text>
              <Feather name="chevron-right" size={15} color={accent.trace} />
            </Pressable>
          )}

          {isAdmin && requests.length > 0 && (
            <View style={st.requestsWrap}>
              <MonoLabel size={8.5} style={{ marginBottom: 8 }}>
                Waiting at the gate · {requests.length}
              </MonoLabel>
              {requests.map((r) => (
                <View key={r.profile_id} style={st.requestRow}>
                  <Pressable style={{ flex: 1 }} onPress={() => router.push(`/rider/${r.profile_id}`)}>
                    <Text style={st.requestName}>@{r.handle}</Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      await approveCrewMember(id!, r.profile_id).catch(() => {});
                      load();
                    }}
                    style={[st.reqBtn, st.reqBtnOn]}
                  >
                    <Text style={[st.reqBtnText, { color: color.white }]}>LET IN</Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      await declineCrewRequest(id!, r.profile_id).catch(() => {});
                      load();
                    }}
                    style={st.reqBtn}
                  >
                    <Text style={st.reqBtnText}>DECLINE</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {invites.length > 0 && (
            <View style={st.invitesStrip}>
              {invites.slice(0, 2).map((i) => (
                <InviteCard
                  key={i.id}
                  invite={i}
                  onToggle={async (going, answers) => {
                    if (!session) return;
                    await rsvpInvite(session.user.id, i.id, going, answers).catch(() => {});
                    setInvites(await listInvites(id!).catch(() => invites));
                  }}
                />
              ))}
            </View>
          )}
          {/* The crew's own choice, made once by an admin (item 6). Kept
              separate from private/open — they answer different questions. */}
          {isAdmin && (
            <Pressable
              onPress={async () => {
                const next = !crew.on_leaderboard;
                setCrew({ ...crew, on_leaderboard: next });
                await setCrewLeaderboard(id!, next).catch(() => setCrew(crew));
              }}
              style={st.boardRow}
            >
              <Text style={[st.boardText, crew.on_leaderboard && { color: color.white }]}>
                {crew.on_leaderboard ? 'ON THE GLOBAL LEADERBOARD' : 'JOIN THE GLOBAL LEADERBOARD'}
              </Text>
              <View style={[st.check, crew.on_leaderboard && st.checkOn]} />
            </Pressable>
          )}

          <Pressable onPress={() => router.push(`/invite/new?crewId=${id}`)} style={st.planRow}>
            <Text style={st.planText}>+ PLAN A RIDE</Text>
          </Pressable>
          <FlatList
            inverted
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={st.chat}
            ListEmptyComponent={
              <Text style={st.empty}>Quiet in here. Say where you're riding this weekend.</Text>
            }
            renderItem={({ item }) => {
              // A contribution is an event in the crew's life, not something
              // somebody said — so it spans the room instead of taking a side.
              // "@asha is sharing live location" — an event, said once when
              // they set off. The banner above is what stays current.
              if (item.kind === 'live_share') {
                return (
                  <View style={st.liveMsg}>
                    <View style={st.liveMsgDot} />
                    <Text style={st.liveMsgText}>
                      <Text style={st.liveMsgWho}>@{item.handle}</Text> {item.body}
                    </Text>
                  </View>
                );
              }
              if (item.kind === 'contribution') {
                return (
                  <Pressable
                    onPress={() => item.ride_id && router.push(`/ride/${item.ride_id}`)}
                    style={st.contribution}
                  >
                    <View style={st.contribDot} />
                    <Text style={st.contribText}>
                      <Text style={st.contribWho}>@{item.handle}</Text> contributed{' '}
                      <Text style={st.contribKm}>
                        {Number(item.distance_km ?? 0).toFixed(1)} km
                      </Text>
                    </Text>
                  </Pressable>
                );
              }
              const own = item.profile_id === session?.user.id;
              return (
                <View style={[st.msg, own && st.msgOwn]}>
                  {!own && <Text style={st.msgAuthor}>@{item.handle}</Text>}
                  <Text style={st.msgBody}>{item.body}</Text>
                  <Text style={st.msgWhen}>
                    {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              );
            }}
          />
          {/* Lifted by the measured keyboard height: edge-to-edge means the
              window never resizes, so nothing moves this on its own. */}
          <View style={[st.inputRow, { marginBottom: kbHeight }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message the crew"
              placeholderTextColor={color.dim}
              style={st.input}
              multiline
            />
            <Pressable onPress={send} disabled={!draft.trim()} style={[st.sendBtn, !draft.trim() && { opacity: 0.4 }]}>
              <Text style={st.sendText}>SEND</Text>
            </Pressable>
          </View>
          {kbHeight === 0 && (
            <Pressable onPress={onLeave} style={st.leaveRow}>
              <Text style={st.leaveText}>Leave crew</Text>
            </Pressable>
          )}
        </>
      ) : pendingMe ? (
        <View style={st.joinWrap}>
          {crew.description ? <Text style={st.desc}>{crew.description}</Text> : null}
          <Text style={st.pendingNote}>
            Request sent — the crew admin decides who gets in. The chat opens the moment they do.
          </Text>
          <PushButton
            label="Withdraw request"
            variant="slate"
            onPress={onLeaveQuiet}
            style={{ marginTop: 20 }}
          />
        </View>
      ) : (
        <View style={st.joinWrap}>
          {crew.description ? <Text style={st.desc}>{crew.description}</Text> : null}
          <Text style={st.joinNote}>
            {crew.is_private
              ? 'Private crew — the admin approves who joins.'
              : "The chat opens when you're in."}
          </Text>
          <PushButton
            label={crew.is_private ? 'Request to join' : 'Join crew'}
            onPress={onJoin}
            style={{ marginTop: 20 }}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  head: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: 64,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  h1: {
    fontFamily: font.display,
    fontSize: 27,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 6,
    lineHeight: 29,
  },
  backText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },

  chat: { paddingHorizontal: layout.screenPadding, paddingVertical: 16, gap: 10 },
  empty: { fontFamily: font.body, fontSize: 12.5, color: color.dim, transform: [{ scaleY: -1 }] },
  msg: {
    alignSelf: 'flex-start',
    maxWidth: '82%',
    backgroundColor: color.slate,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 12,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  msgOwn: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(46,125,255,.12)',
    borderColor: 'rgba(46,125,255,.25)',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 4,
  },
  msgAuthor: { fontFamily: font.mono, fontSize: 8.5, letterSpacing: 1, color: color.steel, marginBottom: 4 },
  msgBody: { fontFamily: font.body, fontSize: 13.5, color: '#D7DBDD', lineHeight: 19 },
  msgWhen: {
    fontFamily: font.mono,
    fontSize: 7.5,
    color: color.dim,
    marginTop: 5,
    alignSelf: 'flex-end',
    fontVariant: ['tabular-nums'],
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: color.hair,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: color.white,
    fontFamily: font.body,
    fontSize: 14,
  },
  sendBtn: { backgroundColor: color.signal, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 13 },
  sendText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: '#F2F7FF' },
  leaveRow: { alignSelf: 'center', paddingVertical: 10 },
  leaveText: { fontFamily: font.body, fontSize: 11.5, color: color.dim },

  invitesStrip: { paddingHorizontal: layout.screenPadding, paddingTop: 12 },
  planRow: { alignSelf: 'flex-end', paddingHorizontal: layout.screenPadding, paddingVertical: 8 },
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: layout.screenPadding,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,201,51,0.28)',
    borderRadius: 10,
    backgroundColor: 'rgba(255,201,51,0.08)',
  },
  livePulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: accent.trace },
  liveBannerText: { flex: 1, fontFamily: font.bodySemi, fontSize: 13, color: accent.trace },
  liveMsg: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    marginVertical: 8,
    paddingVertical: 8,
  },
  liveMsgDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: accent.trace },
  liveMsgText: { fontFamily: font.body, fontSize: 11.5, color: color.dim },
  liveMsgWho: { fontFamily: font.bodySemi, color: color.steel },
  contribution: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    alignSelf: 'stretch',
    marginVertical: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
  },
  contribDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: color.white },
  contribText: { fontFamily: font.body, fontSize: 12, color: color.steel },
  contribWho: { fontFamily: font.bodySemi, color: color.white },
  contribKm: { fontFamily: font.bodyBold, color: color.white, fontVariant: ['tabular-nums'] },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: layout.screenPadding,
    marginTop: 12,
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  boardText: {
    flex: 1,
    fontFamily: font.mono,
    fontSize: 8.5,
    letterSpacing: 1.2,
    color: color.steel,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate2,
  },
  checkOn: { backgroundColor: color.white, borderColor: color.white },
  planText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  joinWrap: { flex: 1, paddingHorizontal: layout.screenPadding, paddingTop: 26 },
  desc: { fontFamily: font.body, fontSize: 13.5, color: '#B9C0C3', lineHeight: 20 },
  joinNote: { fontFamily: font.body, fontSize: 12, color: color.steel, marginTop: 12 },
  pendingNote: { fontFamily: font.body, fontSize: 12.5, color: color.amber, marginTop: 12, lineHeight: 18 },
  requestsWrap: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: 12,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  requestName: { fontFamily: font.bodySemi, fontSize: 13.5, color: color.white },
  reqBtn: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  reqBtnOn: { borderColor: 'rgba(46,125,255,.4)', backgroundColor: 'rgba(46,125,255,.10)' },
  reqBtnText: { fontFamily: font.mono, fontSize: 8, letterSpacing: 1.2, color: color.steel },
});
