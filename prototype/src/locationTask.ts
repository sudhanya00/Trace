import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { activeSession, insertFixes, logEvent } from './db';

export const LOCATION_TASK = 'trace-gps-prototype-recording';

// Runs once per JS context. If the OS kills the process mid-ride, the next
// location batch spins up a fresh context and this fires again — so a second
// 'js_context_start' inside one session is direct evidence of a kill.
logEvent('js_context_start');

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    logEvent('task_error', error.message);
    return;
  }
  const session = activeSession();
  if (!session) return; // stale callback after stop

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations?.length) return;

  // One battery read per batch is enough resolution for a drain-per-hour number.
  const battery = await Battery.getBatteryLevelAsync().catch(() => null);

  // Raw, unfiltered. This app measures; the accuracy filter (§5) belongs to
  // the real recording engine, and we want to see cold-start noise here.
  insertFixes(
    session.id,
    locations.map((l) => ({
      ts: l.timestamp,
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      accuracy: l.coords.accuracy,
      altitude: l.coords.altitude,
      speed: l.coords.speed,
    })),
    battery
  );
});

// §5 starting values — Task 1 exists to tune these against real rides.
// distanceInterval means a stationary chai stop produces no fixes; the
// analysis must not read that as a dropout.
export const RECORDING_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 5000,
  distanceInterval: 25,
  pausesUpdatesAutomatically: false,
  activityType: Location.LocationActivityType.AutomotiveNavigation,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'TRACE — recording',
    notificationBody: 'GPS calibration ride in progress',
    notificationColor: '#2E7DFF',
    killServiceOnDestroy: false,
  },
};

export async function isRecording(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}

export async function startRecording() {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, RECORDING_OPTIONS);
}

export async function stopRecording() {
  if (await isRecording()) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}
