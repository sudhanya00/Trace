import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { showAlert } from '../../src/components/Dialog';
import { JoinSheet } from '../../src/components/InviteCard';
import { PushButton } from '../../src/components/PushButton';
import { TrackThumb } from '../../src/components/TrackThumb';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  deleteInvite,
  getInvite,
  InviteDetail,
  inviteAsks,
  inviteRiders,
  InviteRider,
  multiLineCoords,
  RsvpAnswers,
  rsvpInvite,
} from '../../src/lib/db';
import { googleMapsPointUrl } from '../../src/lib/gpx';
import { accent, color, font, layout, status, surface } from '../../src/theme/tokens';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((+d - Date.now()) / 86400000);
  const day =
    days < 0
      ? d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
      : days === 0
        ? 'Today'
        : days === 1
          ? 'Tomorrow'
          : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return `${day} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * A planned ride, opened.
 *
 * The card could only ever answer "am I in?". Everything a rider actually
 * weighs before committing a Sunday — how long the road is, how hard, who else
 * is coming, whether they need gear — had nowhere to live. This is that.
 *
 * Who's coming is the part that matters most: riders decide by looking at who
 * else said yes, and after the ride the same list quietly becomes the record
 * of who actually turned up.
 */
export default function InviteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [ride, setRide] = useState<InviteDetail | null>(null);
  const [riders, setRiders] = useState<InviteRider[]>([]);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    getInvite(id).then(setRide).catch(() => {});
    inviteRiders(id).then(setRiders).catch(() => {});
  }, [id]);

  useFocusEffect(load);

  if (!ride) return <View style={st.root} />;

  const past = +new Date(ride.starts_at) < Date.now();
  const segments = ride.route_geom ? multiLineCoords(ride.route_geom) : [];

  const requirements: string[] = [];
  if (ride.bike_category)
    requirements.push(ride.bike_category === 'any' ? 'Any bike' : ride.bike_category.toUpperCase());
  if (ride.gear_required) requirements.push('Full gear required');
  else if (ride.gear_required === false) requirements.push('Gear optional');
  if (ride.min_experience && ride.min_experience !== 'any')
    requirements.push(`${ride.min_experience} and up`);
  if (ride.difficulty) requirements.push(`${ride.difficulty} route`);

  // Joining from here asks exactly what joining from the card asks — same
  // sheet, so a rider meets the same questions wherever they say yes.
  const press = () => {
    if (ride.i_am_in) return answer({});
    if (inviteAsks(ride).length === 0) return answer({});
    setSheet(true);
  };

  const answer = async (answers: RsvpAnswers) => {
    if (!session) return;
    setSheet(false);
    setBusy(true);
    await rsvpInvite(session.user.id, ride.id, !ride.i_am_in, answers).catch(() => {});
    setBusy(false);
    load();
  };

  const onCancel = () =>
    showAlert('Cancel this ride?', 'Everyone who said they were coming loses it too.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel the ride',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteInvite(ride.id);
            router.back();
          } catch (e) {
            showAlert('Could not cancel', (e as Error).message);
          }
        },
      },
    ]);

  const going = riders.filter((r) => r.rsvpd);
  const rode = riders.filter((r) => r.ride_id);

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}>
      <View style={st.head}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <MonoLabel size={9} style={{ letterSpacing: 1.6 }}>
            {[fmtWhen(ride.starts_at).toUpperCase(), ride.crew_name?.toUpperCase() ?? 'PUBLIC BOARD']
              .filter(Boolean)
              .join(' — ')}
          </MonoLabel>
          <Text style={st.h1}>{ride.title}</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 8 }}>
          <Text style={st.back}>Back</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push(`/rider/${ride.created_by}`)}
        style={st.byline}
        hitSlop={6}
      >
        <Avatar url={ride.avatar_url} handle={ride.handle} size={26} />
        <Text style={st.bylineText}>
          Planned by <Text style={{ color: color.white }}>@{ride.handle}</Text>
        </Text>
      </Pressable>

      {/* The road, if it has a shape. */}
      {ride.route_id && (
        <Pressable
          onPress={() => router.push(`/route/${ride.route_id}`)}
          style={st.routeCard}
        >
          <TrackThumb id={ride.route_id} segments={segments} />
          <View style={{ flex: 1 }}>
            <Text style={st.routeName} numberOfLines={1}>
              {ride.route_name ?? 'The route'}
            </Text>
            <Text style={st.routeMeta}>
              {[
                ride.route_distance_km ? `${Number(ride.route_distance_km).toFixed(0)} km` : null,
                ride.difficulty,
                ride.region,
              ]
                .filter(Boolean)
                .join(' · ') || 'Named, not mapped'}
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={color.dim} />
        </Pressable>
      )}

      {ride.description ? <Text style={st.description}>{ride.description}</Text> : null}

      {/* Where to be, and a way to get there. */}
      {(ride.meetup || ride.meetup_lat != null) && (
        <View style={st.block}>
          <MonoLabel size={8.5} style={{ marginBottom: 8 }}>
            Meeting point
          </MonoLabel>
          {ride.meetup ? <Text style={st.meetupText}>{ride.meetup}</Text> : null}
          {ride.meetup_lat != null && ride.meetup_lng != null && (
            <Pressable
              onPress={() =>
                Linking.openURL(
                  googleMapsPointUrl(ride.meetup_lat!, ride.meetup_lng!, ride.meetup_place_id)
                ).catch(() => {})
              }
              style={st.navRow}
            >
              <Feather name="navigation" size={14} color={accent.trace} />
              <Text style={st.navText}>Take me there</Text>
            </Pressable>
          )}
        </View>
      )}

      {requirements.length > 0 && (
        <View style={st.block}>
          <MonoLabel size={8.5} style={{ marginBottom: 8 }}>
            What it asks of you
          </MonoLabel>
          <View style={st.reqWrap}>
            {requirements.map((r) => (
              <Text key={r} style={st.req}>
                {r}
              </Text>
            ))}
          </View>
        </View>
      )}

      {/* Who's coming — the thing riders actually decide on. After the ride it
          becomes the record of who turned up. */}
      <View style={st.block}>
        <MonoLabel size={8.5} style={{ marginBottom: 4 }}>
          {past ? `Who rode · ${rode.length}` : `Who's in · ${going.length}`}
        </MonoLabel>
        {riders.length === 0 ? (
          <Text style={st.empty}>Nobody yet. Be the first and others follow.</Text>
        ) : (
          riders.map((r) => (
            <Pressable key={r.profile_id} onPress={() => router.push(`/rider/${r.profile_id}`)}>
              {({ pressed }) => (
                <View style={[st.riderRow, pressed && { backgroundColor: surface.raised }]}>
                  <Avatar url={r.avatar_url} handle={r.handle} size={34} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.riderName}>@{r.handle}</Text>
                    <Text style={st.riderSub}>
                      {r.ride_id
                        ? `Rode it${r.distance_km ? ` · ${Number(r.distance_km).toFixed(0)} km` : ''}`
                        : r.rsvpd
                          ? 'Coming'
                          : 'Was there'}
                    </Text>
                  </View>
                  {r.ride_id && <Feather name="check" size={15} color={accent.trace} />}
                </View>
              )}
            </Pressable>
          ))
        )}
      </View>

      {!past && (
        <PushButton
          label={ride.i_am_in ? "You're in — tap to drop out" : 'Count me in'}
          variant={ride.i_am_in ? 'secondary' : 'primary'}
          onPress={press}
          disabled={busy}
          style={{ marginTop: 26 }}
        />
      )}

      {ride.i_created_it && (
        <Pressable onPress={onCancel} style={st.cancelRow}>
          <Text style={st.cancelText}>Cancel this ride</Text>
        </Pressable>
      )}

      <JoinSheet
        invite={ride}
        visible={sheet}
        onClose={() => setSheet(false)}
        onConfirm={answer}
      />
    </ScrollView>
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
  byline: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14 },
  bylineText: { fontFamily: font.body, fontSize: 13, color: color.steel },
  routeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: surface.stroke,
    borderRadius: 14,
    backgroundColor: surface.raised,
  },
  routeName: { fontFamily: font.bodySemi, fontSize: 15, color: color.white },
  routeMeta: { fontFamily: font.body, fontSize: 12, color: color.steel, marginTop: 4 },
  description: {
    fontFamily: font.body,
    fontSize: 14.5,
    color: '#C6CBCE',
    lineHeight: 21,
    marginTop: 20,
  },
  block: { marginTop: 26 },
  meetupText: { fontFamily: font.body, fontSize: 14, color: color.white, lineHeight: 20 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  navText: { fontFamily: font.bodyMedium, fontSize: 13, color: accent.trace },
  reqWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  req: {
    fontFamily: font.mono,
    fontSize: 8.5,
    letterSpacing: 1.1,
    color: color.steel,
    textTransform: 'uppercase',
    borderWidth: 1,
    borderColor: surface.stroke,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: surface.stroke,
  },
  riderName: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  riderSub: { fontFamily: font.mono, fontSize: 9, color: color.dim, marginTop: 3 },
  empty: { fontFamily: font.body, fontSize: 12.5, color: color.dim, marginTop: 8 },
  cancelRow: { alignSelf: 'center', marginTop: 26, padding: 10 },
  cancelText: { fontFamily: font.bodyMedium, fontSize: 13, color: status.danger },
});
