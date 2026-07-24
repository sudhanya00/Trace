import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../../../src/components/Avatar';
import { InviteCard } from '../../../src/components/InviteCard';
import { MonoLabel } from '../../../src/components/ui';
import { useAuth } from '../../../src/lib/auth';
import {
  Crew,
  CrewContributor,
  crewMemberContributions,
  deleteCrew,
  listCrews,
  listInvites,
  myMembership,
  RideInvite,
  RsvpAnswers,
  rsvpInvite,
  setCrewLeaderboard,
} from '../../../src/lib/db';
import { color, font, layout } from '../../../src/theme/tokens';

/**
 * The crew, as itself — reached by tapping its name in the chat, the way
 * WhatsApp does it. Planned rides, then everyone in it ordered by what they
 * have actually given the crew.
 */
export default function CrewAbout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [crew, setCrew] = useState<Crew | null>(null);
  const [members, setMembers] = useState<CrewContributor[]>([]);
  const [invites, setInvites] = useState<RideInvite[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(() => {
    if (!id || !session) return;
    listCrews()
      .then((all) => setCrew(all.find((c) => c.id === id) ?? null))
      .catch(() => {});
    crewMemberContributions(id).then(setMembers).catch(() => {});
    listInvites(id).then(setInvites).catch(() => {});
    myMembership(session.user.id, id)
      .then((m) => setIsAdmin(m?.role === 'admin' && m?.state === 'active'))
      .catch(() => {});
  }, [id, session]);

  useFocusEffect(load);

  const toggleRsvp = async (invite: RideInvite, going: boolean, answers?: RsvpAnswers) => {
    if (!session) return;
    await rsvpInvite(session.user.id, invite.id, going, answers).catch(() => {});
    listInvites(id!).then(setInvites).catch(() => {});
  };

  const onDelete = () => {
    Alert.alert(
      `Delete ${crew?.name}?`,
      'The roster, the chat and every planned ride go with it. Contributed rides stay with their riders. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete crew',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCrew(id!);
              router.dismissAll();
              router.replace('/crews');
            } catch (e) {
              Alert.alert('Could not delete', (e as Error).message);
            }
          },
        },
      ]
    );
  };

  if (!crew) return <View style={st.root} />;

  const total = members.reduce((sum, m) => sum + m.total_km, 0);

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}>
      <View style={st.head}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <MonoLabel size={9}>
            {[crew.region, crew.is_private ? 'PRIVATE' : 'OPEN'].filter(Boolean).join(' — ')}
          </MonoLabel>
          <Text style={st.h1}>{crew.name}</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 8 }}>
          <Text style={st.back}>Back</Text>
        </Pressable>
      </View>

      {crew.description ? <Text style={st.desc}>{crew.description}</Text> : null}

      <View style={st.strip}>
        <Cell first label="Riders" value={String(members.length)} />
        <Cell label="Together" value={total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(Math.round(total))} unit="km" />
        <Cell label="Planned" value={String(invites.length)} />
      </View>

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

      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 30 }}>
        <MonoLabel size={9}>Planned rides</MonoLabel>
        <Pressable onPress={() => router.push(`/invite/new?crewId=${id}`)} hitSlop={8}>
          <Text style={st.planLink}>+ PLAN A RIDE</Text>
        </Pressable>
      </View>
      <View style={{ marginTop: 10 }}>
        {invites.length === 0 ? (
          <Text style={st.empty}>Nothing planned yet.</Text>
        ) : (
          invites.map((i) => (
            <InviteCard key={i.id} invite={i} onToggle={(g, a) => toggleRsvp(i, g, a)} />
          ))
        )}
      </View>

      <MonoLabel size={9} style={{ marginTop: 30, marginBottom: 4 }}>
        Riders · by contribution
      </MonoLabel>
      {members.map((m, i) => (
        <Pressable key={m.profile_id} onPress={() => router.push(`/rider/${m.profile_id}`)}>
          {({ pressed }) => (
            <View style={[st.row, pressed && { backgroundColor: color.slate }]}>
              <Text style={st.rank} allowFontScaling={false}>
                {i + 1}
              </Text>
              <Avatar url={m.avatar_url} handle={m.handle} size={36} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text style={st.name}>@{m.handle}</Text>
                  {m.role === 'admin' && <Text style={st.adminChip}>ADMIN</Text>}
                </View>
                <Text style={st.sub} allowFontScaling={false}>
                  {m.ride_count === 0
                    ? 'No rides contributed yet'
                    : `${m.ride_count} ride${m.ride_count === 1 ? '' : 's'}`}
                </Text>
              </View>
              <Text style={st.km} allowFontScaling={false}>
                {Math.round(m.total_km)}
                <Text style={st.kmUnit}> km</Text>
              </Text>
            </View>
          )}
        </Pressable>
      ))}

      {isAdmin && (
        <Pressable onPress={onDelete} style={st.deleteRow}>
          <Text style={st.deleteText}>Delete this crew</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function Cell({
  label,
  value,
  unit,
  first = false,
}: {
  label: string;
  value: string;
  unit?: string;
  first?: boolean;
}) {
  return (
    <View style={[st.cell, !first && st.cellDivider]}>
      <MonoLabel size={8.5}>{label}</MonoLabel>
      <Text style={st.cellValue} allowFontScaling={false}>
        {value}
        {unit ? <Text style={st.cellUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 70, paddingBottom: 70 },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  h1: {
    fontFamily: font.display,
    fontSize: 32,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 6,
    lineHeight: 34,
  },
  back: { fontFamily: font.bodyMedium, fontSize: 14, color: color.steel },
  desc: { fontFamily: font.body, fontSize: 13, color: color.steel, lineHeight: 19, marginTop: 12 },
  strip: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.hair,
    marginTop: 20,
  },
  cell: { flex: 1, paddingVertical: 13 },
  cellDivider: { borderLeftWidth: 1, borderLeftColor: color.hair, paddingLeft: 14 },
  cellValue: {
    fontFamily: font.displaySemi,
    fontSize: 23,
    color: color.white,
    fontVariant: ['tabular-nums'],
    marginTop: 5,
    lineHeight: 24,
  },
  cellUnit: { fontSize: 11, color: color.steel, fontFamily: font.displayMedium },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  boardText: { flex: 1, fontFamily: font.mono, fontSize: 8.5, letterSpacing: 1.2, color: color.steel },
  check: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate2,
  },
  checkOn: { backgroundColor: color.white, borderColor: color.white },
  planLink: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  empty: { fontFamily: font.body, fontSize: 12.5, color: color.dim },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  rank: {
    fontFamily: font.displaySemi,
    fontSize: 13,
    color: color.dim,
    fontVariant: ['tabular-nums'],
    minWidth: 16,
  },
  name: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  sub: { fontFamily: font.mono, fontSize: 9, color: color.dim, marginTop: 4 },
  km: {
    fontFamily: font.displaySemi,
    fontSize: 17,
    color: color.white,
    fontVariant: ['tabular-nums'],
  },
  kmUnit: { fontFamily: font.displayMedium, fontSize: 9.5, color: color.steel },
  adminChip: {
    fontFamily: font.mono,
    fontSize: 7,
    letterSpacing: 1.2,
    color: color.steel,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2.5,
  },
  deleteRow: { alignSelf: 'center', marginTop: 34, padding: 10 },
  deleteText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.amber },
});
