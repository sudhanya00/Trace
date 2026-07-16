import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { InviteCard } from '../../src/components/InviteCard';
import { PushButton } from '../../src/components/PushButton';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  Crew,
  CrewMember,
  CrewMessage,
  crewChat,
  crewRoster,
  joinCrew,
  leaveCrew,
  listInvites,
  RideInvite,
  rsvpInvite,
  sendCrewMessage,
} from '../../src/lib/db';
import { supabase } from '../../src/lib/supabase';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * The crew room: live chat over Supabase Realtime. The WAL stream respects
 * RLS, so only members ever receive rows; incoming payloads carry no handle
 * (raw table row), so the roster decorates them client-side.
 */
export default function CrewRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [crew, setCrew] = useState<Crew | null>(null);
  const [roster, setRoster] = useState<Map<string, CrewMember>>(new Map());
  const [messages, setMessages] = useState<CrewMessage[]>([]);
  const [member, setMember] = useState(false);
  const [draft, setDraft] = useState('');
  const [invites, setInvites] = useState<RideInvite[]>([]);
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  const load = useCallback(async () => {
    if (!id || !session) return;
    const { data: c } = await supabase.from('crews').select('*').eq('id', id).maybeSingle();
    setCrew(c);
    const r = await crewRoster(id).catch(() => []);
    setRoster(new Map(r.map((m) => [m.profile_id, m])));
    setMember(r.some((m) => m.profile_id === session.user.id));
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
          const row = payload.new as { id: string; profile_id: string; body: string; created_at: string };
          setMessages((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [
                  {
                    id: row.id,
                    profile_id: row.profile_id,
                    handle: rosterRef.current.get(row.profile_id)?.handle ?? 'rider',
                    body: row.body,
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
      Alert.alert('Could not send', (e as Error).message);
    }
  };

  const onJoin = async () => {
    if (!session || !id) return;
    try {
      await joinCrew(session.user.id, id);
      load();
    } catch (e) {
      Alert.alert('Could not join', (e as Error).message);
    }
  };

  const onLeave = () => {
    if (!session || !id) return;
    Alert.alert('Leave this crew?', undefined, [
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
            <Text style={st.h1}>{crew.name}</Text>
          </View>
          <Pressable onPress={() => router.back()} style={{ padding: 8 }}>
            <Text style={st.backText}>Back</Text>
          </Pressable>
        </View>
      </View>

      {member ? (
        <>
          {invites.length > 0 && (
            <View style={st.invitesStrip}>
              {invites.slice(0, 2).map((i) => (
                <InviteCard
                  key={i.id}
                  invite={i}
                  onToggle={async (going) => {
                    if (!session) return;
                    await rsvpInvite(session.user.id, i.id, going).catch(() => {});
                    setInvites(await listInvites(id!).catch(() => invites));
                  }}
                />
              ))}
            </View>
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
          <View style={st.inputRow}>
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
          <Pressable onPress={onLeave} style={st.leaveRow}>
            <Text style={st.leaveText}>Leave crew</Text>
          </Pressable>
        </>
      ) : (
        <View style={st.joinWrap}>
          {crew.description ? <Text style={st.desc}>{crew.description}</Text> : null}
          <Text style={st.joinNote}>The chat opens when you're in.</Text>
          <PushButton label="Join crew" onPress={onJoin} style={{ marginTop: 20 }} />
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
  planText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  joinWrap: { flex: 1, paddingHorizontal: layout.screenPadding, paddingTop: 26 },
  desc: { fontFamily: font.body, fontSize: 13.5, color: '#B9C0C3', lineHeight: 20 },
  joinNote: { fontFamily: font.body, fontSize: 12, color: color.steel, marginTop: 12 },
});
