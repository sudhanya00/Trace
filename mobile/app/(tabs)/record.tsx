import { router, useFocusEffect } from 'expo-router';
import { showAlert } from '../../src/components/Dialog';
import * as Location from 'expo-location';
import * as Device from 'expo-device';
import { usePostHog } from 'posthog-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
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

const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

import { Feather } from '@expo/vector-icons';
import { TransformRequestManager } from '@maplibre/maplibre-react-native';

import { Odometer } from '../../src/components/Odometer';
import { PushButton } from '../../src/components/PushButton';
import { LocationPicker, PickedPlace } from '../../src/components/LocationPicker';
import { RecordMap } from '../../src/components/RecordMap';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { Bike, listBikes, myUpcomingRides, traceBounds, UpcomingRide } from '../../src/lib/db';
import {
  LocalRide,
  pointsForRide,
  recordingRide,
  rideState,
  RideState,
  setPendingInvite,
} from '../../src/lib/localdb';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AUTO_PAUSE_MS,
  cancelRide,
  finalizeInterrupted,
  finishRide,
  isRecordingTaskRunning,
  LIVE_SHARE_KEY,
  resumeRide,
  startRide,
} from '../../src/lib/recording';
import { planRoute } from '../../src/lib/geo-api';
import { supabase } from '../../src/lib/supabase';
import { success } from '../../src/lib/haptics';
import { oemFamily } from '../../src/lib/oem';
import { syncPendingRides } from '../../src/lib/sync';
import { accent, color, font, layout } from '../../src/theme/tokens';

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
  const { session } = useAuth();
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
  // GPS warm-up: the chip takes tens of seconds to first fix from cold.
  // Watching position while the Record screen is open (screen on, foreground
  // permission only) means the fix usually exists BEFORE the Start tap —
  // the same trick maps apps use. Stops on blur; costs nothing on other tabs.
  const [warmFix, setWarmFix] = useState<{ accuracy: number | null; ts: number } | null>(null);
  const [liveShare, setLiveShare] = useState(false);
  const [linkedRide, setLinkedRide] = useState<UpcomingRide | null>(null);
  // Where the rider said they're headed. A line on the map and nothing more —
  // no turns, no voice. Enough to know you haven't missed the turning.
  const [destination, setDestination] = useState<PickedPlace | null>(null);
  const [destinationLine, setDestinationLine] = useState<[number, number][] | null>(null);
  const [pickingDest, setPickingDest] = useState(false);
  const [routing, setRouting] = useState(false);
  const [recentre, setRecentre] = useState(0);
  // One map, two things it can show. A plain toggle, always in the same
  // place: the screen behaves identically every time you open it, which is
  // what lets muscle memory form.
  const [mapMode, setMapMode] = useState<'ride' | 'traces'>('ride');
  const [traceBox, setTraceBox] = useState<[number, number, number, number] | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(LIVE_SHARE_KEY).then((v) => setLiveShare(v === '1')).catch(() => {});
  }, []);

  // Trace tiles are RLS-scoped to the rider, so the tile requests carry the
  // caller's JWT. Re-applied on focus so a refreshed token wins.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token || !alive) return;
        TransformRequestManager.clearHeaders();
        for (const [name, value] of [
          ['apikey', ANON_KEY],
          ['Authorization', `Bearer ${token}`],
          ['Accept', 'application/vnd.mapbox-vector-tile'],
        ]) {
          TransformRequestManager.addHeader({ match: /rpc\/trace_tiles/, name, value });
        }
        traceBounds().then((b) => alive && setTraceBox(b)).catch(() => {});
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

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
      const bikesLoad = (session ? listBikes(session.user.id) : Promise.resolve([]))
        .then((b) => {
          const active = b.filter((x) => x.is_active);
          setBikes(active);
          setBikeId((cur) => cur ?? (active.length ? active[active.length - 1].id : null));
        })
        .catch(() => {});
      const t = setInterval(refresh, 2000);
      const tick = setInterval(() => setNow(Date.now()), 1000);
      // Warm the GPS while the dial is on screen and no ride is running.
      let warmSub: Location.LocationSubscription | null = null;
      (async () => {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted || recordingRide()) return;
        const last = await Location.getLastKnownPositionAsync().catch(() => null);
        if (last) setWarmFix({ accuracy: last.coords.accuracy ?? null, ts: last.timestamp });
        warmSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 0 },
          (loc) => setWarmFix({ accuracy: loc.coords.accuracy ?? null, ts: loc.timestamp })
        ).catch(() => null);
      })();

      return () => {
        clearInterval(t);
        clearInterval(tick);
        warmSub?.remove();
        void bikesLoad;
      };
    }, [refresh, session])
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
      showAlert('No location, no ride', 'TRACE cannot record a ride without location access.');
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
      const ride = await startRide(bikeId);
      refresh();
      // If a ride they said they'd be on is starting about now, ask once —
      // the rider knows which ride they're on far better than a track
      // comparison afterwards ever would.
      offerToLink(ride.id);
    } catch (e) {
      showAlert('Could not start', (e as Error).message);
    }
  };

  /** One prompt, only when there's something plausible to attach to. */
  const offerToLink = async (rideId: string) => {
    const planned = await myUpcomingRides().catch(() => [] as UpcomingRide[]);
    if (planned.length === 0) return;

    const attach = (invite: UpcomingRide) => {
      setPendingInvite(rideId, invite.id);
      setLinkedRide(invite);
    };

    if (planned.length === 1) {
      const only = planned[0];
      showAlert(
        'Riding the planned one?',
        `“${only.title}”${only.meetup ? ` — ${only.meetup}` : ''}. Link this recording to it, and the crew sees you actually rode it.`,
        [
          { text: 'Separate ride', style: 'cancel' },
          { text: "That's the one", onPress: () => attach(only) },
        ]
      );
      return;
    }
    showAlert(
      'Which ride is this?',
      'You have more than one planned around now.',
      [
        ...planned.slice(0, 3).map((p) => ({ text: p.title, onPress: () => attach(p) })),
        { text: 'Separate ride', style: 'cancel' as const },
      ]
    );
  };

  const posthog = usePostHog();

  /** The hold has completed; now say plainly what is about to be lost. */
  const onCancelHeld = () => {
    if (phase.kind !== 'recording') return;
    const s = rideState(phase.ride.id);
    const km = s ? (s.distance_m / 1000).toFixed(1) : '0.0';
    showAlert(
      'Cancel this ride?',
      `${km} km recorded so far will be deleted and cannot be recovered. To keep it instead, finish the ride.`,
      [
        { text: 'Keep recording', style: 'cancel' },
        {
          text: 'Delete the ride',
          style: 'destructive',
          onPress: async () => {
            await cancelRide(phase.ride).catch(() => {});
            refresh();
          },
        },
      ]
    );
  };

  const onFinish = async () => {
    if (phase.kind !== 'recording') return;
    const s = rideState(phase.ride.id);
    success(); // the ride is saved — a moment worth feeling (§4)
    await finishRide(phase.ride);
    // §12b: gap metrics + device from day one — tuning without this is guesswork.
    posthog?.capture('ride_finished', {
      distance_km: s ? Math.round(s.distance_m / 100) / 10 : 0,
      gap_count: s?.gap_count ?? 0,
      gap_duration_s: s?.gap_duration_s ?? 0,
      manufacturer: Device.manufacturer,
      os_version: Device.osVersion,
    });
    refresh();
    syncPendingRides(); // fire and forget — never block the UI on sync (§4)
    // The moment of accomplishment — never let a ride end into silence.
    router.push(`/ride/finished?id=${phase.ride.id}`);
  };

  const onResume = async () => {
    await resumeRide();
    refresh();
  };

  /**
   * Draw a line to somewhere. Uses the last known position as the start, so
   * it works before a ride begins as well as during one. Failure is quiet and
   * non-blocking: a missing line must never stand between a rider and the
   * record button.
   */
  const setHeading = async (place: PickedPlace) => {
    setDestination(place);
    setRouting(true);
    try {
      const from =
        trackPoints.length > 0
          ? ([trackPoints[trackPoints.length - 1].lng, trackPoints[trackPoints.length - 1].lat] as [number, number])
          : await Location.getLastKnownPositionAsync()
              .then((p) => (p ? ([p.coords.longitude, p.coords.latitude] as [number, number]) : null))
              .catch(() => null);
      if (!from) {
        setRouting(false);
        return;
      }
      const options = await planRoute([from, [place.lng, place.lat]], { alternatives: false });
      setDestinationLine(options[0]?.coordinates ?? null);
    } catch {
      setDestinationLine(null);
    } finally {
      setRouting(false);
    }
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
      <RecordMap
        points={trackPoints}
        destination={destinationLine}
        recentreKey={recentre}
        mode={mapMode}
        traceBounds={traceBox}
      />

      {/* top row: live indicator / GPS status */}
      <View style={st.top}>
        {phase.kind === 'recording' ? (
          <LiveIndicator label={paused ? 'AUTO-PAUSED' : 'RECORDING'} paused={paused} />
        ) : (
          <View />
        )}
        {phase.kind === 'recording' ? (
          <View style={{ alignItems: 'flex-end' }}>
            <MonoLabel size={9}>GPS</MonoLabel>
            <GpsBars level={gpsGood ? 'good' : gpsWeak ? 'weak' : 'lost'} />
          </View>
        ) : (
          <View style={{ alignItems: 'flex-end' }}>
            <MonoLabel size={9}>GPS</MonoLabel>
            <GpsBars
              level={
                warmFix && now - warmFix.ts < 10_000 && (warmFix.accuracy ?? 99) < 30
                  ? 'good'
                  : warmFix && now - warmFix.ts < 30_000
                    ? 'weak'
                    : 'lost'
              }
            />
          </View>
        )}
      </View>

      {/* The toggle. Deliberately loud and always in the same place — a
          control that moves or changes meaning is one nobody learns. */}
      <View style={st.modeRow}>
        {(['ride', 'traces'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMapMode(m)}
            style={[st.modeBtn, mapMode === m && st.modeBtnOn]}
          >
            <Text style={[st.modeText, mapMode === m && { color: color.white }]}>
              {m === 'ride' ? 'THIS RIDE' : 'MY TRACES'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Where to — at the top, out of the keyboard's way, and translucent so
          it sits on the map rather than blocking it. */}
      {phase.kind !== 'interrupted' && (
        <Pressable onPress={() => setPickingDest(true)} style={st.destRow}>
          <Feather
            name={destination ? 'flag' : 'search'}
            size={15}
            color={destination ? accent.trace : color.steel}
          />
          <Text style={[st.destText, destination && { color: color.white }]} numberOfLines={1}>
            {routing
              ? 'Finding the way…'
              : destination
                ? destination.label
                : 'Heading somewhere?'}
          </Text>
          {destination ? (
            <Pressable
              onPress={() => {
                setDestination(null);
                setDestinationLine(null);
              }}
              hitSlop={10}
            >
              <Feather name="x" size={15} color={color.steel} />
            </Pressable>
          ) : null}
        </Pressable>
      )}

      <View style={{ flex: 1 }} />

      {/* Snap back to the rider after panning the map away. */}
      {trackPoints.length > 0 && (
        <Pressable
          onPress={() => setRecentre((k) => k + 1)}
          style={st.recentre}
          hitSlop={8}
        >
          <Feather name="crosshair" size={17} color={color.white} />
        </Pressable>
      )}

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

      
      {/* live share opt-in: followers-only, off by default */}
      {phase.kind === 'idle' && (
        <Pressable
          onPress={async () => {
            const next = !liveShare;
            setLiveShare(next);
            await AsyncStorage.setItem(LIVE_SHARE_KEY, next ? '1' : '0').catch(() => {});
          }}
          style={st.liveShareRow}
        >
          <View style={[st.liveShareDot, liveShare && { backgroundColor: color.trace }]} />
          <Text style={st.liveShareText}>
            Share live location with followers while riding {liveShare ? '— on' : '— off'}
          </Text>
        </Pressable>
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
                <Text style={[st.bikeChipText, b.id === bikeId && { color: color.white }]}>
                  {b.make.toUpperCase()} {b.model.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* What this recording is for, and a way out if it was the wrong tap. */}
      {linkedRide && phase.kind === 'recording' && (
        <Pressable
          onPress={() =>
            showAlert('Unlink this ride?', `It stops counting as “${linkedRide.title}”.`, [
              { text: 'Keep it linked', style: 'cancel' },
              {
                text: 'Unlink',
                onPress: () => {
                  if (phase.kind === 'recording') setPendingInvite(phase.ride.id, null);
                  setLinkedRide(null);
                },
              },
            ])
          }
          style={st.linkedRow}
        >
          <Text style={st.linkedText} numberOfLines={1}>
            Riding <Text style={{ color: color.white }}>{linkedRide.title}</Text>
          </Text>
          <Feather name="x" size={13} color={color.steel} />
        </Pressable>
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
          {oemFamily() && (
            <Pressable onPress={() => router.push('/oem-whitelist')} style={{ marginTop: 12 }}>
              <Text style={st.oemLink}>
                Your phone likely killed it — set TRACE to unrestricted battery →
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* control — oversized on purpose: gloves (§8) */}
      <View style={st.ctrl}>
        {phase.kind === 'recording' ? (
          <>
            <PushButton label="Finish ride" onPress={onFinish} height={layout.recordButtonHeight} />
            {/* Cancelling destroys a track that can't be recovered, so it stays
                deliberate — but it no longer needs a full bar to do that. A
                small target plus a confirm that names the distance is two
                intentional acts, and it gives the map back its space. */}
            <Pressable onPress={onCancelHeld} style={st.cancelRide} hitSlop={10}>
              <Text style={st.cancelRideText}>Cancel ride</Text>
            </Pressable>
          </>
        ) : phase.kind === 'idle' ? (
          <PushButton
            label={bike ? 'Start ride' : 'Add a bike first'}
            onPress={onStartTap}
            disabled={bikes.length === 0}
            height={layout.recordButtonHeight}
          />
        ) : null}
      </View>

      <LocationPicker
        visible={pickingDest}
        onClose={() => setPickingDest(false)}
        title="Where are you headed?"
        initial={destination}
        onPick={(p) => {
          setPickingDest(false);
          setHeading(p);
        }}
      />

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

  const tint = paused ? color.steel : color.trace;
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
    borderColor: color.traceDim,
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
  bikeChipOn: { borderColor: color.disabled, backgroundColor: color.slate2 },
  bikeChipText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1, color: color.steel },

  modeRow: {
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: layout.screenPadding,
    marginTop: 10,
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modeBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 9 },
  modeBtnOn: { backgroundColor: color.slate2 },
  modeText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.dim },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: layout.screenPadding,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 10,
    // Translucent: it floats on the map instead of covering it.
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  destText: { flex: 1, fontFamily: font.body, fontSize: 13, color: color.steel },
  recentre: {
    alignSelf: 'flex-end',
    marginRight: layout.screenPadding,
    marginBottom: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  cancelRide: { alignSelf: 'center', marginTop: 10, padding: 8 },
  cancelRideText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: layout.screenPadding,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    backgroundColor: color.slate,
  },
  linkedText: { flex: 1, fontFamily: font.body, fontSize: 12.5, color: color.steel },
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
  oemLink: { fontFamily: font.bodyMedium, fontSize: 12, color: color.amber, lineHeight: 17 },

  liveShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: layout.screenPadding,
    marginTop: 10,
    paddingVertical: 4,
  },
  liveShareDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.slate2, borderWidth: 1, borderColor: color.hair },
  liveShareText: { fontFamily: font.body, fontSize: 11, color: color.steel },

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
