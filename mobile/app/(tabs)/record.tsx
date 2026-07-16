import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Odometer } from '../../src/components/Odometer';
import { PushButton } from '../../src/components/PushButton';
import { TrackBed } from '../../src/components/TrackBed';
import { MonoLabel } from '../../src/components/ui';
import { Bike, listBikes } from '../../src/lib/db';
import {
  LocalRide,
  pointsForRide,
  recordingRide,
  rideState,
  RideState,
} from '../../src/lib/localdb';
import {
  AUTO_PAUSE_MS,
  finalizeInterrupted,
  finishRide,
  isRecordingTaskRunning,
  resumeRide,
  startRide,
} from '../../src/lib/recording';
import { syncPendingRides } from '../../src/lib/sync';
import { color, font, layout } from '../../src/theme/tokens';

function fmtElapsed(ms: number): { hm: string; s: string } {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return { hm: `${h}:${String(m).padStart(2, '0')}`, s: `:${String(t % 60).padStart(2, '0')}` };
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording'; ride: LocalRide }
  | { kind: 'interrupted'; ride: LocalRide };

export default function Record() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [state, setState] = useState<RideState | null>(null);
  const [trackPoints, setTrackPoints] = useState<
    { lat: number; lng: number; segment_seq: number }[]
  >([]);
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [bikeId, setBikeId] = useState<string | null>(null);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [foregroundOnly, setForegroundOnly] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [sweepKey, setSweepKey] = useState(0);

  const refresh = useCallback(async () => {
    const ride = recordingRide();
    if (!ride) {
      setPhase({ kind: 'idle' });
      setState(null);
      setTrackPoints([]);
      return;
    }
    const running = await isRecordingTaskRunning();
    setPhase(running ? { kind: 'recording', ride } : { kind: 'interrupted', ride });
    setState(rideState(ride.id));
    // Downsample for the bed: the SVG needs the shape, not every fix.
    const pts = pointsForRide(ride.id);
    const stride = Math.max(1, Math.ceil(pts.length / 300));
    setTrackPoints(
      pts.filter((_, i) => i % stride === 0 || i === pts.length - 1)
        .map((p) => ({ lat: p.lat, lng: p.lng, segment_seq: p.segment_seq }))
    );
    setNow(Date.now());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      setSweepKey((k) => k + 1); // ignition sweep on every visit to the dial
      const bikesLoad = listBikes()
        .then((b) => {
          const active = b.filter((x) => x.is_active);
          setBikes(active);
          setBikeId((cur) => cur ?? (active.length ? active[active.length - 1].id : null));
        })
        .catch(() => {});
      const t = setInterval(refresh, 2000);
      const tick = setInterval(() => setNow(Date.now()), 1000);
      return () => {
        clearInterval(t);
        clearInterval(tick);
        void bikesLoad;
      };
    }, [refresh])
  );

  /**
   * §7 sequence at the moment it matters: explainer first, WHEN_IN_USE, then
   * ALWAYS — and an honest degraded mode if ALWAYS is denied. No nagging.
   */
  const onStartTap = () => setExplainerOpen(true);

  const requestAndStart = async () => {
    setExplainerOpen(false);
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      Alert.alert('No location, no ride', 'TRACE cannot record a ride without location access.');
      return;
    }
    const bg = await Location.requestBackgroundPermissionsAsync();
    setForegroundOnly(!bg.granted);
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      // The §6 notification is the surface that keeps Android honest — ask.
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never).catch(
        () => {}
      );
    }
    try {
      await startRide(bikeId);
      refresh();
    } catch (e) {
      Alert.alert('Could not start', (e as Error).message);
    }
  };

  const onFinish = async () => {
    if (phase.kind !== 'recording') return;
    await finishRide(phase.ride);
    refresh();
    syncPendingRides(); // fire and forget — never block the UI on sync (§4)
  };

  const onResume = async () => {
    await resumeRide();
    refresh();
  };

  const onFinalize = () => {
    if (phase.kind !== 'interrupted') return;
    finalizeInterrupted(phase.ride);
    refresh();
    syncPendingRides();
  };

  // Derived display state. Fixes flow continuously (time-based), so GPS
  // status reads fix freshness while pause reads MOVEMENT freshness.
  const distanceKm = state ? state.distance_m / 1000 : 0;
  const lastFixAge = state ? now - state.last_ts : Infinity;
  const lastMoveAge = state && state.last_move_ts > 0 ? now - state.last_move_ts : 0;
  const paused =
    phase.kind === 'recording' && state != null && lastFixAge < 30_000 && lastMoveAge > AUTO_PAUSE_MS;
  const gpsGood = lastFixAge < 20_000 && (state?.last_accuracy ?? 99) < 30;
  const gpsWeak = !gpsGood && lastFixAge < 60_000;
  const elapsed = phase.kind === 'recording' ? fmtElapsed(now - phase.ride.started_at) : null;

  const bike = bikes.find((b) => b.id === bikeId) ?? null;

  return (
    <View style={st.root}>
      {/* map bed: real recorded points behind everything, scrimmed (§8) */}
      <TrackBed points={trackPoints} />

      {/* top row: live indicator / GPS status */}
      <View style={st.top}>
        {phase.kind === 'recording' ? (
          <LiveIndicator label={paused ? 'AUTO-PAUSED' : 'RECORDING'} paused={paused} />
        ) : (
          <View />
        )}
        {phase.kind === 'recording' && (
          <View style={{ alignItems: 'flex-end' }}>
            <MonoLabel size={9}>GPS</MonoLabel>
            <GpsBars level={gpsGood ? 'good' : gpsWeak ? 'weak' : 'lost'} />
          </View>
        )}
      </View>

      <View style={{ flex: 1 }} />

      {/* the odometer is the screen */}
      <View style={{ paddingHorizontal: layout.screenPadding }}>
        <MonoLabel size={9.5} style={{ marginBottom: 6, letterSpacing: 2.3 }}>
          Distance — this ride
        </MonoLabel>
        <View style={st.odoRow}>
          <Odometer km={distanceKm} sweepKey={sweepKey} />
          <Text style={st.unit}>km</Text>
        </View>
      </View>

      {/* data strip */}
      {phase.kind === 'recording' && elapsed && (
        <View style={st.strip}>
          <View style={st.cell}>
            <MonoLabel size={8.5}>Elapsed</MonoLabel>
            <Text style={st.cellValue} allowFontScaling={false}>
              {elapsed.hm}
              <Text style={st.cellSmall}>{elapsed.s}</Text>
            </Text>
          </View>
          <View style={[st.cell, st.cellDivider]}>
            <MonoLabel size={8.5}>Elevation</MonoLabel>
            <Text style={st.cellValue} allowFontScaling={false}>
              {state?.last_altitude != null ? Math.round(state.last_altitude).toLocaleString('en-IN') : '—'}
              <Text style={st.cellSmall}>m</Text>
            </Text>
          </View>
        </View>
      )}

      {/* the gap footnote — information, not an alarm (§8) */}
      {phase.kind === 'recording' && state != null && state.gap_count > 0 && (
        <View style={st.gapRow}>
          <View style={st.gapDash} />
          <Text style={st.gapText}>
            <Text style={st.gapStrong}>
              {state.gap_count === 1
                ? `~${Math.max(1, Math.round(state.gap_duration_s / 60))} min gap`
                : `${state.gap_count} gaps (~${Math.max(1, Math.round(state.gap_duration_s / 60))} min)`}
            </Text>
            {' — not counted'}
          </Text>
        </View>
      )}

      {/* idle: bike selector */}
      {phase.kind === 'idle' && bikes.length > 0 && (
        <View style={st.bikeRow}>
          <MonoLabel size={8.5} style={{ marginBottom: 8 }}>
            Riding
          </MonoLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {bikes.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => setBikeId(b.id)}
                style={[st.bikeChip, b.id === bikeId && st.bikeChipOn]}
              >
                <Text style={[st.bikeChipText, b.id === bikeId && { color: color.signal }]}>
                  {b.make.toUpperCase()} {b.model.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {foregroundOnly && phase.kind === 'recording' && (
        <View style={st.warnRow}>
          <Text style={st.warnText}>
            Background access is off — this track will break when the screen locks.
          </Text>
        </View>
      )}

      {/* interrupted: recovery is mandatory, never silent (§5) */}
      {phase.kind === 'interrupted' && (
        <View style={st.interrupted}>
          <Text style={st.interruptedTitle}>Recording was interrupted</Text>
          <Text style={st.interruptedBody}>
            The recorder stopped — likely the OS or a reboot. Everything already recorded is safe.
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
            <PushButton label="Resume ride" onPress={onResume} height={56} style={{ flex: 1 }} />
            <PushButton label="Finish here" variant="slate" onPress={onFinalize} height={56} style={{ flex: 1 }} />
          </View>
        </View>
      )}

      {/* control — oversized on purpose: gloves (§8) */}
      <View style={st.ctrl}>
        {phase.kind === 'recording' ? (
          <PushButton label="Finish ride" onPress={onFinish} height={layout.recordButtonHeight} />
        ) : phase.kind === 'idle' ? (
          <PushButton
            label={bike ? 'Start ride' : 'Add a bike first'}
            onPress={onStartTap}
            disabled={bikes.length === 0}
            height={layout.recordButtonHeight}
          />
        ) : null}
      </View>

      {/* §7 step 2: plain language BEFORE the OS dialog */}
      <Modal visible={explainerOpen} transparent animationType="fade" onRequestClose={() => setExplainerOpen(false)}>
        <View style={st.modalScrim}>
          <View style={st.modalCard}>
            <MonoLabel size={9}>Before your first ride</MonoLabel>
            <Text style={st.modalTitle}>TRACE records with the screen off</Text>
            <Text style={st.modalBody}>
              Your phone goes in a pocket or tank bag and the ride keeps recording — through dead
              zones, for hours. For that, Android asks you to allow location{' '}
              <Text style={{ color: color.white }}>all the time</Text>. TRACE uses it only while a
              ride is recording, and your tracks stay yours.
            </Text>
            <PushButton label="Got it — ask me" onPress={requestAndStart} style={{ marginTop: 22 }} />
            <Pressable onPress={() => setExplainerOpen(false)} style={st.modalCancel}>
              <Text style={st.modalCancelText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** The one ambient animation in the app: the recording pulse (§8 motion #2). */
function LiveIndicator({ label, paused }: { label: string; paused: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (paused) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.28, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [paused, opacity]);

  const tint = paused ? color.steel : color.signal;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint, opacity }} />
      <Text style={{ fontFamily: font.mono, fontSize: 10, letterSpacing: 2, color: tint }}>{label}</Text>
    </View>
  );
}

/** Green/amber signal language does not bend to brand color (§8). */
function GpsBars({ level }: { level: 'good' | 'weak' | 'lost' }) {
  const fill = level === 'good' ? color.gpsGood : level === 'weak' ? color.amber : color.moss;
  const heights = [4, 6, 8.5, 11];
  const lit = level === 'good' ? 4 : level === 'weak' ? 2 : 1;
  return (
    <View style={{ flexDirection: 'row', gap: 2, alignItems: 'flex-end', height: 11, marginTop: 4 }}>
      {heights.map((h, i) => (
        <View
          key={i}
          style={{ width: 3, height: h, borderRadius: 0.5, backgroundColor: i < lit ? fill : color.slate2 }}
        />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 64,
  },
  odoRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
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
    marginHorizontal: layout.screenPadding,
    marginTop: 18,
  },
  cell: { flex: 1, paddingVertical: 13 },
  cellDivider: { borderLeftWidth: 1, borderLeftColor: color.hair, paddingLeft: 16 },
  cellValue: {
    fontFamily: font.displaySemi,
    fontSize: 25,
    color: color.white,
    fontVariant: ['tabular-nums'],
    marginTop: 5,
    lineHeight: 26,
  },
  cellSmall: { fontSize: 12, color: color.steel },

  gapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: layout.screenPadding,
    marginTop: 13,
  },
  gapDash: {
    width: 18,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: color.signal,
    opacity: 0.7,
  },
  gapText: { fontFamily: font.body, fontSize: 11, color: color.steel, lineHeight: 15 },
  gapStrong: { color: '#B9C0C3', fontFamily: font.bodyMedium },

  bikeRow: { marginTop: 20, paddingLeft: layout.screenPadding },
  bikeChip: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginRight: 8,
  },
  bikeChipOn: { borderColor: 'rgba(46,125,255,.4)', backgroundColor: 'rgba(46,125,255,.10)' },
  bikeChipText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1, color: color.steel },

  warnRow: { marginHorizontal: layout.screenPadding, marginTop: 14 },
  warnText: { fontFamily: font.body, fontSize: 11, color: color.amber, lineHeight: 16 },

  interrupted: {
    marginHorizontal: layout.screenPadding,
    marginTop: 20,
    backgroundColor: color.slate,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: layout.cardRadius,
    padding: 16,
  },
  interruptedTitle: { fontFamily: font.bodySemi, fontSize: 14, color: color.amber },
  interruptedBody: { fontFamily: font.body, fontSize: 12, color: color.steel, lineHeight: 17, marginTop: 6 },

  ctrl: { padding: layout.screenPadding, paddingBottom: 100, marginTop: 20 },

  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,.72)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: color.slate,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: layout.screenPadding,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderColor: color.hair,
  },
  modalTitle: {
    fontFamily: font.display,
    fontSize: 27,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 8,
    lineHeight: 29,
  },
  modalBody: { fontFamily: font.body, fontSize: 13, color: color.steel, lineHeight: 20, marginTop: 12 },
  modalCancel: { alignSelf: 'center', marginTop: 16, padding: 8 },
  modalCancelText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
