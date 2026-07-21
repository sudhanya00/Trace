import * as Battery from 'expo-battery';
import * as Device from 'expo-device';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { captureRef } from 'react-native-view-shot';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CrewContribution } from '../../src/components/CrewContribution';
import { PushButton } from '../../src/components/PushButton';
import { RideMap, Segments } from '../../src/components/RideMap';
import { ShareCard, ShareCardData } from '../../src/components/ShareCard';
import { DataCell, Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  getBike,
  getRide,
  ownTrackSegments,
  Ride,
  Route,
  routeForRide,
  setRideCrew,
  submitRecordingReport,
  updateRide,
} from '../../src/lib/db';
import { listLocalRides, LocalRide, pointsForRide, rideState } from '../../src/lib/localdb';
import { color, font, layout } from '../../src/theme/tokens';

type Detail =
  | { source: 'server'; ride: Ride; segments: Segments | null }
  | {
      source: 'local';
      ride: LocalRide;
      segments: Segments;
      distanceKm: number;
      gapCount: number;
      gapDurationS: number;
    };

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export default function RideDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [bikeName, setBikeName] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [crewId, setCrewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<View>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      // Local first: an unsynced ride only exists here. Same uuid becomes the
      // server id after sync, so this route serves both lives of a ride.
      const local = listLocalRides().find((r) => r.id === id && r.sync_state !== 'synced');
      if (local) {
        const pts = pointsForRide(local.id);
        const segs = new Map<number, [number, number][]>();
        for (const p of pts) {
          const arr = segs.get(p.segment_seq) ?? [];
          arr.push([p.lng, p.lat]);
          segs.set(p.segment_seq, arr);
        }
        const s = rideState(local.id);
        if (!alive) return;
        setDetail({
          source: 'local',
          ride: local,
          segments: [...segs.values()],
          distanceKm: s ? s.distance_m / 1000 : 0,
          gapCount: s?.gap_count ?? 0,
          gapDurationS: s?.gap_duration_s ?? 0,
        });
        if (local.bike_id) getBike(local.bike_id).then((b) => alive && setBikeName(b ? `${b.make} ${b.model}` : null)).catch(() => {});
        return;
      }
      const ride = await getRide(id);
      if (!ride || !alive) return;
      setTitle(ride.title ?? '');
      setNote(ride.note ?? '');
      setCrewId(ride.crew_id ?? null);
      const segments = await ownTrackSegments(ride.id).catch(() => null);
      if (!alive) return;
      setDetail({ source: 'server', ride, segments });
      routeForRide(ride.id).then((r) => alive && setRoute(r)).catch(() => {});
      if (ride.bike_id) getBike(ride.bike_id).then((b) => alive && setBikeName(b ? `${b.make} ${b.model}` : null)).catch(() => {});
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (!detail) return <View style={st.root} />;

  const isServer = detail.source === 'server';
  const started = new Date(isServer ? detail.ride.started_at : detail.ride.started_at);
  const ended = isServer
    ? new Date((detail.ride as Ride).ended_at)
    : new Date((detail.ride as LocalRide).ended_at ?? (detail.ride as LocalRide).started_at);
  const distanceKm = isServer ? Number((detail.ride as Ride).distance_km) : detail.distanceKm;
  const gapCount = isServer ? (detail.ride as Ride).gap_count : detail.gapCount;
  const gapDurationS = isServer ? (detail.ride as Ride).gap_duration_s : detail.gapDurationS;
  const segments = detail.segments ?? [];
  const isManual = isServer && segments.length === 0 && gapCount === 0 && +started === +ended;

  const save = async () => {
    if (!isServer) return;
    setBusy(true);
    try {
      await updateRide(detail.ride.id, { title: title.trim() || null, note: note.trim() || null });
      router.back();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
      setBusy(false);
    }
  };

  const report = () => {
    Alert.alert(
      'Report bad recording?',
      'Sends us the point log for this ride with your device model — nothing else. It goes straight into fixing GPS.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send report',
          onPress: async () => {
            try {
              const battery = await Battery.getBatteryLevelAsync().catch(() => null);
              const localPoints = pointsForRide(id!);
              await submitRecordingReport(
                session!.user.id,
                isServer ? detail.ride.id : null,
                {
                  manufacturer: Device.manufacturer,
                  model: Device.modelName,
                  os: Device.osName,
                  osVersion: Device.osVersion,
                  battery,
                },
                {
                  ride_id: id,
                  synced: isServer,
                  gap_count: gapCount,
                  gap_duration_s: gapDurationS,
                  // Unsynced rides still hold the raw log locally; synced rides
                  // already have their geometry server-side.
                  points: localPoints.slice(0, 5000),
                }
              );
              Alert.alert('Report sent', 'Thank you — this is exactly what tunes the recorder.');
            } catch (e) {
              Alert.alert('Could not send', (e as Error).message);
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <MonoLabel size={9.5}>
          {started.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}
          {bikeName ? ` — ${bikeName.toUpperCase()}` : ''}
        </MonoLabel>
        <Text style={st.h1}>
          {(isServer && (detail.ride as Ride).title) || (isManual ? 'Manual ride' : 'Ride')}
        </Text>

        {segments.length > 0 && <RideMap segments={segments} style={{ marginTop: 20 }} />}

        <View style={st.strip}>
          <DataCell first label="Distance" value={distanceKm.toFixed(1)} unit="km" />
          {!isManual && <DataCell label="Duration" value={fmtDuration(+ended - +started)} />}
          {gapCount > 0 && <DataCell label="Gaps" value={String(gapCount)} />}
        </View>
        {isServer &&
          (() => {
            const r = detail.ride as Ride;
            const movingS = r.moving_s ?? null;
            const avg =
              movingS && movingS > 60 && r.profile_id === session?.user.id
                ? Number(r.distance_km) / (movingS / 3600)
                : null;
            const cells = [
              movingS != null && { label: 'Moving', value: fmtDuration(movingS * 1000) },
              (r.stops_count ?? 0) > 0 && { label: 'Stops', value: String(r.stops_count) },
              (r.elev_gain_m ?? 0) > 1 && { label: 'Climbed', value: `${Math.round(Number(r.elev_gain_m))} m` },
              avg != null && { label: 'Avg moving · private', value: `${avg.toFixed(1)} km/h` },
            ].filter(Boolean) as { label: string; value: string }[];
            if (!cells.length) return null;
            return (
              <View style={[st.strip, { borderTopWidth: 0 }]}>
                {cells.map((c, i) => (
                  <DataCell key={c.label} first={i === 0} label={c.label} value={c.value} />
                ))}
              </View>
            );
          })()}

        {gapCount > 0 && (
          <View style={st.gapRow}>
            <View style={st.gapDash} />
            <Text style={st.gapText}>
              <Text style={st.gapStrong}>
                Recording was interrupted{' '}
                {gapCount === 1 ? 'once' : `${gapCount} times`} for ~
                {Math.max(1, Math.round(gapDurationS / 60))} min
              </Text>
              {' — those sections aren’t counted.'}
            </Text>
          </View>
        )}

        {detail.source === 'local' && (
          <Text style={st.pendingNote}>
            Waiting to sync — the title and note unlock once this ride reaches the server.
          </Text>
        )}

        {isServer && (
          <>
            <Field label="Title" value={title} onChangeText={setTitle} placeholder="Sangla to Chitkul" autoCapitalize="sentences" style={{ marginTop: 26 }} />
            <Field label="Note" value={note} onChangeText={setNote} placeholder="Broken tarmac after the bridge." autoCapitalize="sentences" style={{ marginTop: 16 }} />

            {/* Attribution stays changeable: the crew you meant may not be the
                crew you tapped at the end of eight hours in the saddle. */}
            <View style={{ marginTop: 22 }}>
              <CrewContribution
                value={crewId}
                onChange={async (c) => {
                  const prev = crewId;
                  setCrewId(c);
                  try {
                    await setRideCrew(detail.ride.id, c);
                  } catch (e) {
                    setCrewId(prev);
                    Alert.alert('Could not change the crew', (e as Error).message);
                  }
                }}
                distanceKm={Number((detail.ride as Ride).distance_km)}
              />
            </View>

            <PushButton label="Save" variant="slate" onPress={save} disabled={busy} style={{ marginTop: 22 }} />
            {route ? (
              <PushButton
                label="View route"
                onPress={() => router.push(`/route/${route.id}`)}
                style={{ marginTop: 26 }}
              />
            ) : (
              <PushButton
                label="Share as route"
                onPress={() => router.push(`/route/share?rideId=${detail.ride.id}`)}
                disabled={segments.length === 0}
                style={{ marginTop: 26 }}
              />
            )}
          </>
        )}

        {segments.length > 0 && (
          <PushButton
            label="Share as image"
            variant="slate"
            onPress={async () => {
              try {
                const uri = await captureRef(cardRef, {
                  format: 'png',
                  quality: 1,
                  result: 'tmpfile',
                  width: 1080,
                  height: 1920,
                });
                await Sharing.shareAsync(`file://${uri.replace(/^file:\/\//, '')}`, {
                  mimeType: 'image/png',
                  dialogTitle: 'Share your ride',
                });
              } catch (e) {
                Alert.alert('Could not share', (e as Error).message);
              }
            }}
            style={{ marginTop: 12 }}
          />
        )}

        {!isManual && (
          <Pressable onPress={report} style={st.reportRow}>
            <Text style={st.reportText}>Something wrong with this track? Report bad recording →</Text>
          </Pressable>
        )}

        <Pressable onPress={() => router.back()} style={st.back}>
          <Text style={st.backText}>Back</Text>
        </Pressable>
      </ScrollView>

      {segments.length > 0 && (
        <View style={{ position: 'absolute', left: -9999, top: 0 }} pointerEvents="none">
          <ShareCard
            ref={cardRef}
            data={
              {
                title:
                  (isServer && (detail.ride as Ride).title) ||
                  (isManual ? 'Manual ride' : 'A ride worth keeping'),
                dateStr: started.toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                }),
                distanceKm,
                durationStr: fmtDuration(+ended - +started),
                elevGainM: isServer ? Number((detail.ride as Ride).elev_gain_m ?? 0) : detail.source === 'local' ? null : null,
                stops: isServer ? (detail.ride as Ride).stops_count : null,
                segments,
                photoUri: null,
              } satisfies ShareCardData
            }
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 72, paddingBottom: 60 },
  h1: {
    fontFamily: font.display,
    fontSize: 34,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 36,
  },
  strip: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.hair,
    marginTop: 20,
  },
  gapRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13 },
  gapDash: { width: 18, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: color.signal, opacity: 0.7 },
  gapText: { flex: 1, fontFamily: font.body, fontSize: 11, color: color.steel, lineHeight: 15 },
  gapStrong: { color: '#B9C0C3', fontFamily: font.bodyMedium },
  pendingNote: { fontFamily: font.body, fontSize: 12, color: color.steel, lineHeight: 17, marginTop: 22 },
  reportRow: { marginTop: 30, paddingVertical: 6 },
  reportText: { fontFamily: font.bodyMedium, fontSize: 12, color: color.steel },
  back: { alignSelf: 'center', marginTop: 18, padding: 8 },
  backText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
