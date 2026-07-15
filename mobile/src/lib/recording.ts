import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { metersBetween } from './geo';
import { ldb, LocalRide, recordingRide, rideState } from './localdb';

export const RECORDING_TASK = 'trace-ride-recording';

/**
 * §5 tuning values. Task 1 calibration was skipped by decision, so these are
 * the spec's starting numbers — the §12b feedback loop (gap metrics in
 * PostHog, report-bad-recording) is what tunes them now.
 */
const ACCURACY_CUTOFF_M = 50; // drop noisier fixes before writing
const MIN_WRITE_DISTANCE_M = 25; // software distance filter
const GAP_TIME_MS = 60_000;
const GAP_DISTANCE_M = 500;
/**
 * A >60s silence at (roughly) the same spot is a stop — a chai break, a photo
 * — not a dropout. No distance was covered, nothing is fabricated by keeping
 * the segment. A >60s silence that ENDS somewhere else is a real gap: the
 * rider moved and we don't know the path. Segments split only on real gaps.
 */
const STATIONARY_RADIUS_M = 100;

export const AUTO_PAUSE_MS = 90_000; // display state: no movement > 90s
export const AUTO_STOP_PROMPT_MS = 15 * 60_000; // paused this long → prompt

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

  // §6: the notification is the only visible surface for 8 hours — live stats.
  const now = Date.now();
  if (now - lastNotificationUpdate > 30_000) {
    lastNotificationUpdate = now;
    const s = rideState(ride.id);
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

/** Write a batch of fixes: accuracy filter → distance filter → gap rule. */
export function ingest(ride: LocalRide, locations: Location.LocationObject[]) {
  const sorted = [...locations].sort((a, b) => a.timestamp - b.timestamp);

  ldb.withTransactionSync(() => {
    let s = rideState(ride.id);

    for (const loc of sorted) {
      const { latitude: lat, longitude: lng, accuracy, altitude, speed } = loc.coords;
      const ts = loc.timestamp;
      if (accuracy != null && accuracy > ACCURACY_CUTOFF_M) continue; // GPS noise (§5)

      if (!s) {
        ldb.runSync(
          `INSERT OR REPLACE INTO local_points (ride_id, seq, segment_seq, ts, lat, lng, accuracy, altitude, speed)
           VALUES (?, 0, 0, ?, ?, ?, ?, ?, ?)`,
          [ride.id, ts, lat, lng, accuracy ?? null, altitude ?? null, speed ?? null]
        );
        ldb.runSync(
          `INSERT OR REPLACE INTO local_ride_state
             (ride_id, last_seq, segment_seq, last_lat, last_lng, last_ts, last_altitude, last_accuracy, distance_m, gap_count, gap_duration_s)
           VALUES (?, 0, 0, ?, ?, ?, ?, ?, 0, 0, 0)`,
          [ride.id, lat, lng, ts, altitude ?? null, accuracy ?? null]
        );
        s = rideState(ride.id)!;
        continue;
      }

      if (ts <= s.last_ts) continue; // out-of-order duplicate

      const d = metersBetween(s.last_lat, s.last_lng, lat, lng);
      const dt = ts - s.last_ts;

      // Always keep freshness current, even for fixes we don't write —
      // auto-pause detection and GPS status read these.
      if (d < MIN_WRITE_DISTANCE_M) {
        ldb.runSync(
          'UPDATE local_ride_state SET last_ts = ?, last_altitude = ?, last_accuracy = ? WHERE ride_id = ?',
          [ts, altitude ?? s.last_altitude, accuracy ?? null, ride.id]
        );
        s = { ...s, last_ts: ts, last_altitude: altitude ?? s.last_altitude };
        continue;
      }

      // §5: never interpolate across a dropout. A dropout ends a segment.
      const movedFar = d > GAP_DISTANCE_M;
      const silentAndElsewhere = dt > GAP_TIME_MS && d > STATIONARY_RADIUS_M;
      const isGap = movedFar || silentAndElsewhere;

      const seq = s.last_seq + 1;
      const segment = isGap ? s.segment_seq + 1 : s.segment_seq;
      // Gap distance is never counted (§5) — distance only accrues within a segment.
      const addedM = isGap ? 0 : d;

      ldb.runSync(
        `INSERT OR REPLACE INTO local_points (ride_id, seq, segment_seq, ts, lat, lng, accuracy, altitude, speed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ride.id, seq, segment, ts, lat, lng, accuracy ?? null, altitude ?? null, speed ?? null]
      );
      ldb.runSync(
        `UPDATE local_ride_state SET
           last_seq = ?, segment_seq = ?, last_lat = ?, last_lng = ?, last_ts = ?,
           last_altitude = ?, last_accuracy = ?, distance_m = distance_m + ?,
           gap_count = gap_count + ?, gap_duration_s = gap_duration_s + ?
         WHERE ride_id = ?`,
        [
          seq, segment, lat, lng, ts,
          altitude ?? null, accuracy ?? null, addedM,
          isGap ? 1 : 0, isGap ? Math.round(dt / 1000) : 0,
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
  return { id, bike_id: bikeId, started_at: now, ended_at: null, sync_state: 'recording', sync_attempts: 0, last_error: null };
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
}

/** Finalize a ride found dead after a kill/reboot — data kept, never lost (§5). */
export function finalizeInterrupted(ride: LocalRide): void {
  const s = rideState(ride.id);
  ldb.runSync(
    "UPDATE local_rides SET ended_at = ?, sync_state = 'pending' WHERE id = ?",
    [s?.last_ts ?? ride.started_at, ride.id]
  );
}
