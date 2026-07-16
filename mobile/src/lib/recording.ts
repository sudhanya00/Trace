import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { clearLivePosition, upsertLivePosition } from './db';
import { metersBetween } from './geo';
import { ldb, LocalRide, recordingRide, rideState } from './localdb';
import { supabase } from './supabase';

/** AsyncStorage key for the live-share opt-in. OFF unless the rider says so. */
export const LIVE_SHARE_KEY = 'trace_live_share';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export const RECORDING_TASK = 'trace-ride-recording';

// §5 tuning values and the fix classifier live in gapRules.ts (pure, tested).
// Task 1 calibration was skipped by decision, so these are the spec's starting
// numbers — the §12b feedback loop tunes them from tester telemetry.
import { classifyFix } from './gapRules';

export const AUTO_PAUSE_MS = 90_000; // display state: no movement > 90s
/**
 * Paused this long → one "still riding?" notification. Never an auto-stop:
 * bike breaks run long (user decision 2026-07-15, overriding §5's
 * "stop if unanswered") — an unanswered prompt keeps recording.
 */
export const AUTO_STOP_PROMPT_MS = 15 * 60_000;

/**
 * Continuous 5s fixes (distanceInterval 0) instead of the raw 25m hardware
 * filter: a stationary phone emits nothing under a hardware distance filter,
 * which would blind auto-pause detection and GPS status. The 25m filter is
 * applied in software before anything is written, so storage is identical.
 */
const LOCATION_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 5000,
  distanceInterval: 0,
  pausesUpdatesAutomatically: false,
  activityType: Location.LocationActivityType.AutomotiveNavigation,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'TRACE — recording',
    notificationBody: 'Ride in progress',
    notificationColor: '#2E7DFF',
    killServiceOnDestroy: false,
  },
};

let lastNotificationUpdate = 0;

TaskManager.defineTask(RECORDING_TASK, async ({ data, error }) => {
  if (error) return;
  const ride = recordingRide();
  if (!ride) return; // stale callback after stop

  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
  if (!locations?.length) return;

  ingest(ride, locations);

  await maybePromptStillRiding(ride);

  // §6: the notification is the only visible surface for 8 hours — live stats.
  const now = Date.now();
  if (now - lastNotificationUpdate > 30_000) {
    lastNotificationUpdate = now;
    const s = rideState(ride.id);
    // Live share (opt-in): one small upsert per cycle. Followers-only by RLS;
    // failure (dead zone) is silence, and staleness reads honestly on their end.
    if (s) {
      AsyncStorage.getItem(LIVE_SHARE_KEY)
        .then(async (on) => {
          if (on !== '1') return;
          const { data } = await supabase.auth.getSession();
          const uid = data.session?.user.id;
          if (uid) await upsertLivePosition(uid, s.last_lng, s.last_lat, ride.started_at);
        })
        .catch(() => {});
    }
    if (s) {
      const km = (s.distance_m / 1000).toFixed(1);
      const mins = Math.floor((now - ride.started_at) / 60_000);
      const elev = s.last_altitude != null ? ` · ${Math.round(s.last_altitude)} m` : '';
      await Location.startLocationUpdatesAsync(RECORDING_TASK, {
        ...LOCATION_OPTIONS,
        foregroundService: {
          ...LOCATION_OPTIONS.foregroundService!,
          notificationBody: `${km} km · ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}${elev}`,
        },
      }).catch(() => {});
    }
  }
});

/** One notification per pause episode once it crosses the threshold. The fix
 *  stream keeps flowing while stationary (time-based updates), so this runs
 *  even with the screen off in a tank bag. */
async function maybePromptStillRiding(ride: LocalRide) {
  const s = rideState(ride.id);
  if (!s || s.last_move_ts === 0 || s.pause_prompted) return;
  const pausedMs = Date.now() - s.last_move_ts;
  if (pausedMs < AUTO_STOP_PROMPT_MS) return;
  ldb.runSync('UPDATE local_ride_state SET pause_prompted = 1 WHERE ride_id = ?', [ride.id]);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Still riding?',
      body: `Paused ${Math.round(pausedMs / 60_000)} min — the ride is still recording. Open TRACE to finish it.`,
    },
    trigger: null,
  }).catch(() => {});
}

/** Write a batch of fixes: accuracy filter → distance filter → gap rule. */
export function ingest(ride: LocalRide, locations: Location.LocationObject[]) {
  const sorted = [...locations].sort((a, b) => a.timestamp - b.timestamp);

  ldb.withTransactionSync(() => {
    let s = rideState(ride.id);

    for (const loc of sorted) {
      const { latitude: lat, longitude: lng, accuracy, altitude, speed } = loc.coords;
      const ts = loc.timestamp;

      if (!s) {
        if (accuracy != null && accuracy > 50) continue; // no anchor from noise
        ldb.runSync(
          `INSERT OR REPLACE INTO local_points (ride_id, seq, segment_seq, ts, lat, lng, accuracy, altitude, speed)
           VALUES (?, 0, 0, ?, ?, ?, ?, ?, ?)`,
          [ride.id, ts, lat, lng, accuracy ?? null, altitude ?? null, speed ?? null]
        );
        ldb.runSync(
          `INSERT OR REPLACE INTO local_ride_state
             (ride_id, last_seq, segment_seq, last_lat, last_lng, last_ts, last_altitude, last_accuracy, distance_m, gap_count, gap_duration_s, last_move_ts, pause_prompted, stops_count, stopped_s, elev_gain_m)
           VALUES (?, 0, 0, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, 0, 0, 0)`,
          [ride.id, lat, lng, ts, altitude ?? null, accuracy ?? null, ts]
        );
        s = rideState(ride.id)!;
        continue;
      }

      if (ts <= s.last_ts) continue; // out-of-order duplicate

      const d = metersBetween(s.last_lat, s.last_lng, lat, lng);
      const dt = ts - s.last_ts;
      const cls = classifyFix({ accuracy: accuracy ?? null, distanceM: d, dtMs: dt });

      if (cls.kind === 'drop') continue; // GPS noise (§5)

      // Always keep freshness current, even for fixes we don't write —
      // auto-pause detection and GPS status read these.
      if (cls.kind === 'skip') {
        ldb.runSync(
          'UPDATE local_ride_state SET last_ts = ?, last_altitude = ?, last_accuracy = ? WHERE ride_id = ?',
          [ts, altitude ?? s.last_altitude, accuracy ?? null, ride.id]
        );
        s = { ...s, last_ts: ts, last_altitude: altitude ?? s.last_altitude };
        continue;
      }

      // §5: never interpolate across a dropout. A dropout ends a segment.
      const isGap = cls.gap;

      const seq = s.last_seq + 1;
      const segment = isGap ? s.segment_seq + 1 : s.segment_seq;
      // Gap distance is never counted (§5) — distance only accrues within a segment.
      const addedM = isGap ? 0 : d;
      // Movement resuming after a >90s stationary silence closes a stop
      // episode (a gap is signal loss, not a stop — counted separately).
      const wasStop = !isGap && ts - s.last_move_ts > AUTO_PAUSE_MS;
      // Elevation gain: positive deltas only, jitter under 1.5m ignored.
      const elevDelta =
        altitude != null && s.last_altitude != null && altitude - s.last_altitude > 1.5
          ? altitude - s.last_altitude
          : 0;

      ldb.runSync(
        `INSERT OR REPLACE INTO local_points (ride_id, seq, segment_seq, ts, lat, lng, accuracy, altitude, speed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ride.id, seq, segment, ts, lat, lng, accuracy ?? null, altitude ?? null, speed ?? null]
      );
      ldb.runSync(
        `UPDATE local_ride_state SET
           last_seq = ?, segment_seq = ?, last_lat = ?, last_lng = ?, last_ts = ?,
           last_altitude = ?, last_accuracy = ?, distance_m = distance_m + ?,
           gap_count = gap_count + ?, gap_duration_s = gap_duration_s + ?,
           last_move_ts = ?, pause_prompted = 0,
           stops_count = stops_count + ?, stopped_s = stopped_s + ?,
           elev_gain_m = elev_gain_m + ?
         WHERE ride_id = ?`,
        [
          seq, segment, lat, lng, ts,
          altitude ?? null, accuracy ?? null, addedM,
          isGap ? 1 : 0, isGap ? Math.round(dt / 1000) : 0,
          ts,
          wasStop ? 1 : 0, wasStop ? Math.round((ts - s.last_move_ts) / 1000) : 0,
          elevDelta,
          ride.id,
        ]
      );
      s = {
        ...s,
        last_seq: seq,
        segment_seq: segment,
        last_lat: lat,
        last_lng: lng,
        last_ts: ts,
        last_altitude: altitude ?? s.last_altitude,
        distance_m: s.distance_m + addedM,
        gap_count: s.gap_count + (isGap ? 1 : 0),
      };
    }
  });
}

export async function isRecordingTaskRunning(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(RECORDING_TASK);
}

export async function startRide(bikeId: string | null): Promise<LocalRide> {
  const id = Crypto.randomUUID();
  const now = Date.now();
  ldb.runSync('INSERT INTO local_rides (id, bike_id, started_at) VALUES (?, ?, ?)', [
    id,
    bikeId,
    now,
  ]);
  lastNotificationUpdate = 0;
  await Location.startLocationUpdatesAsync(RECORDING_TASK, LOCATION_OPTIONS);
  return { id, bike_id: bikeId, started_at: now, ended_at: null, sync_state: 'recording', sync_attempts: 0, last_error: null, pending_title: null };
}

/** Resume after an interruption (§5 recovery): same ride, recorder restarted.
 *  The silence since the last fix becomes a gap or a stop by the normal rules. */
export async function resumeRide(): Promise<void> {
  await Location.startLocationUpdatesAsync(RECORDING_TASK, LOCATION_OPTIONS);
}

/** Finish: stop the recorder, close the ride, hand off to sync. */
export async function finishRide(ride: LocalRide): Promise<void> {
  if (await isRecordingTaskRunning()) {
    await Location.stopLocationUpdatesAsync(RECORDING_TASK);
  }
  const s = rideState(ride.id);
  const endedAt = s?.last_ts ?? Date.now();
  ldb.runSync(
    "UPDATE local_rides SET ended_at = ?, sync_state = 'pending' WHERE id = ?",
    [endedAt, ride.id]
  );
  // The ride is over: the live position leaves the map immediately.
  supabase.auth.getSession().then(({ data }) => {
    const uid = data.session?.user.id;
    if (uid) clearLivePosition(uid).catch(() => {});
  });
}

/** Finalize a ride found dead after a kill/reboot — data kept, never lost (§5). */
export function finalizeInterrupted(ride: LocalRide): void {
  const s = rideState(ride.id);
  ldb.runSync(
    "UPDATE local_rides SET ended_at = ?, sync_state = 'pending' WHERE id = ?",
    [s?.last_ts ?? ride.started_at, ride.id]
  );
}
