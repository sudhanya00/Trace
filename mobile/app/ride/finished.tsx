import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { Odometer } from '../../src/components/Odometer';
import { PushButton } from '../../src/components/PushButton';
import { ShareCard, ShareCardData } from '../../src/components/ShareCard';
import { Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { getBike, listBikes, listMyRides, ownTrackSegments, updateRide } from '../../src/lib/db';
import { localRide, pointsForRide, rideState, setPendingTitle } from '../../src/lib/localdb';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * Ride finished — the moment. The odometer rolls up, the numbers land, the
 * road gets a name and a photo, and the share button is unmissable. A ride
 * never again ends into silence.
 */

function fmtDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const LIFETIME_MARKS = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000];

export default function RideFinished() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [title, setTitle] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [segments, setSegments] = useState<[number, number][][]>([]);
  const [bikeName, setBikeName] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<string[]>([]);
  const cardRef = useRef<View>(null);

  const ride = id ? localRide(id) : null;
  const stats = id ? rideState(id) : null;

  const distanceKm = stats ? stats.distance_m / 1000 : 0;
  const elapsedS = ride ? Math.round(((ride.ended_at ?? ride.started_at) - ride.started_at) / 1000) : 0;
  const movingS = Math.max(0, elapsedS - (stats?.stopped_s ?? 0) - (stats?.gap_duration_s ?? 0));
  const avgMoving = movingS > 60 ? distanceKm / (movingS / 3600) : null;

  useEffect(() => {
    if (!id || !ride) return;
    let alive = true;
    // Points may vanish the moment sync confirms — grab them now, fall back
    // to the server geometry if the race was lost.
    const pts = pointsForRide(id);
    if (pts.length >= 2) {
      const segs = new Map<number, [number, number][]>();
      for (const p of pts) {
        const arr = segs.get(p.segment_seq) ?? [];
        arr.push([p.lng, p.lat]);
        segs.set(p.segment_seq, arr);
      }
      setSegments([...segs.values()]);
    } else {
      ownTrackSegments(id).then((s) => alive && s && setSegments(s)).catch(() => {});
    }
    if (ride.bike_id) {
      getBike(ride.bike_id).then((b) => alive && setBikeName(b ? `${b.make} ${b.model}` : null)).catch(() => {});
    }

    // Milestones, best-effort: lifetime thresholds crossed by THIS ride,
    // longest ride yet, first ride. Quiet failures — never block the moment.
    (async () => {
      if (!session) return;
      try {
        const [bikes, rides] = await Promise.all([
          listBikes(session.user.id),
          listMyRides(session.user.id),
        ]);
        if (!alive) return;
        const found: string[] = [];
        const lifetime = bikes.reduce((sum, b) => sum + Number(b.current_odometer_km), 0);
        for (const mark of LIFETIME_MARKS) {
          if (lifetime >= mark && lifetime - distanceKm < mark) {
            found.push(`${mark.toLocaleString('en-IN')} km lifetime`);
          }
        }
        const others = rides.filter((r) => r.id !== id).map((r) => Number(r.distance_km));
        if (rides.length <= 1 && others.length === 0) found.push('First ride');
        else if (distanceKm > Math.max(0, ...others)) found.push('Longest ride yet');
        setMilestones(found);
      } catch {
        /* the moment survives without badges */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!ride || !stats) {
    return (
      <View style={st.root}>
        <Text style={st.missing}>This ride has already left the garage.</Text>
      </View>
    );
  }

  const saveTitle = async (t: string) => {
    setTitle(t);
    // Synced already? Write through. Still local? Ride carries it into sync.
    setPendingTitle(ride.id, t.trim() || null);
    if (ride.sync_state === 'synced') {
      await updateRide(ride.id, { title: t.trim() || null }).catch(() => {});
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    const res = perm.granted
      ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9 });
    if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
  };

  const share = async () => {
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
  };

  const cardData: ShareCardData = {
    title: title.trim() || 'A ride worth keeping',
    dateStr: new Date(ride.started_at).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }),
    distanceKm,
    durationStr: fmtDur(elapsedS),
    elevGainM: stats.elev_gain_m,
    stops: stats.stops_count,
    segments,
    photoUri,
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <MonoLabel size={9.5} style={{ letterSpacing: 2.3 }}>
          {bikeName ? bikeName.toUpperCase() : 'RIDE FINISHED'}
        </MonoLabel>
        <Text style={st.h1}>Ride finished</Text>

        <View style={st.odoRow}>
          <Odometer km={distanceKm} />
          <Text style={st.unit}>km</Text>
        </View>

        <View style={st.strip}>
          <StatCell first label="Duration" value={fmtDur(elapsedS)} />
          <StatCell label="Moving" value={fmtDur(movingS)} />
          {stats.stops_count > 0 && <StatCell label="Stops" value={String(stats.stops_count)} />}
        </View>
        <View style={[st.strip, { borderTopWidth: 0 }]}>
          {stats.elev_gain_m > 1 && (
            <StatCell first label="Climbed" value={`${Math.round(stats.elev_gain_m)} m`} />
          )}
          {avgMoving != null && (
            <StatCell label="Avg moving · private" value={`${avgMoving.toFixed(1)} km/h`} />
          )}
        </View>

        {stats.gap_count > 0 && (
          <View style={st.gapRow}>
            <View style={st.gapDash} />
            <Text style={st.gapText}>
              <Text style={st.gapStrong}>
                Recording was interrupted for ~{Math.max(1, Math.round(stats.gap_duration_s / 60))} min
              </Text>
              {' — not counted.'}
            </Text>
          </View>
        )}

        {milestones.length > 0 && (
          <View style={st.milestones}>
            {milestones.map((m) => (
              <Text key={m} style={st.milestone}>
                ◆ {m.toUpperCase()}
              </Text>
            ))}
          </View>
        )}

        <Field
          label="Name this ride"
          value={title}
          onChangeText={saveTitle}
          placeholder="Sangla to Chitkul, before the rain"
          autoCapitalize="sentences"
          style={{ marginTop: 26 }}
        />

        <Pressable onPress={takePhoto} style={st.photoBox}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={st.photo} resizeMode="cover" />
          ) : (
            <View style={st.photoEmpty}>
              <MonoLabel size={9}>Freeze the moment</MonoLabel>
              <Text style={st.photoHint}>A photo makes the share card yours.</Text>
            </View>
          )}
        </Pressable>

        <PushButton label="Share this ride" onPress={share} height={64} style={{ marginTop: 22 }} />

        <Pressable onPress={() => router.replace('/(tabs)/profile')} style={st.done}>
          <Text style={st.doneText}>Done</Text>
        </Pressable>
      </ScrollView>

      {/* offscreen story card, captured at 3× on share */}
      <View style={st.offscreen} pointerEvents="none">
        <ShareCard ref={cardRef} data={cardData} />
      </View>
    </KeyboardAvoidingView>
  );
}

function StatCell({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
  return (
    <View style={[st.cell, !first && st.cellDivider]}>
      <MonoLabel size={8.5}>{label}</MonoLabel>
      <Text style={st.cellValue} allowFontScaling={false}>
        {value}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void, alignItems: 'center', justifyContent: 'center' },
  missing: { fontFamily: font.body, fontSize: 13, color: color.steel },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 76, paddingBottom: 60 },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 42,
  },
  odoRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 18 },
  unit: {
    fontFamily: font.displaySemi,
    fontSize: 19,
    color: color.steel,
    textTransform: 'uppercase',
    letterSpacing: 2,
    paddingBottom: 9,
  },
  strip: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.hair,
    marginTop: 18,
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
  gapRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  gapDash: { width: 18, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: color.signal, opacity: 0.7 },
  gapText: { flex: 1, fontFamily: font.body, fontSize: 11, color: color.steel, lineHeight: 15 },
  gapStrong: { color: '#B9C0C3', fontFamily: font.bodyMedium },
  milestones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  milestone: {
    fontFamily: font.mono,
    fontSize: 8.5,
    letterSpacing: 1.4,
    color: color.signal,
    borderWidth: 1,
    borderColor: 'rgba(255,214,10,.3)',
    backgroundColor: 'rgba(255,214,10,.12)',
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  photoBox: {
    marginTop: 18,
    height: 150,
    borderRadius: layout.cardRadius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
  },
  photo: { width: '100%', height: '100%' },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7 },
  photoHint: { fontFamily: font.body, fontSize: 12, color: color.dim },
  done: { alignSelf: 'center', marginTop: 18, padding: 8 },
  doneText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
  offscreen: { position: 'absolute', left: -9999, top: 0 },
});
