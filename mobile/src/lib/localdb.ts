import * as SQLite from 'expo-sqlite';

/**
 * Offline buffer (§4). The device is the source of truth until sync succeeds.
 * local_rides / local_points are the spec schema verbatim; local_ride_state is
 * an engine-side cache (cumulative distance, last fix) so each location batch
 * does O(batch) work instead of re-reading the whole track. It is rebuildable
 * from local_points at any time.
 */
export const ldb = SQLite.openDatabaseSync('trace_local.db');

ldb.execSync(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS local_rides (
    id TEXT PRIMARY KEY,
    bike_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    sync_state TEXT NOT NULL DEFAULT 'recording'
      CHECK (sync_state IN ('recording','pending','syncing','synced','failed')),
    sync_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );

  CREATE TABLE IF NOT EXISTS local_points (
    ride_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    segment_seq INTEGER NOT NULL DEFAULT 0,
    ts INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    altitude REAL,
    speed REAL,
    PRIMARY KEY (ride_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_points_ride ON local_points(ride_id);

  CREATE TABLE IF NOT EXISTS local_ride_state (
    ride_id TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL,
    segment_seq INTEGER NOT NULL,
    last_lat REAL NOT NULL,
    last_lng REAL NOT NULL,
    last_ts INTEGER NOT NULL,
    last_altitude REAL,
    last_accuracy REAL,
    distance_m REAL NOT NULL DEFAULT 0,
    gap_count INTEGER NOT NULL DEFAULT 0,
    gap_duration_s INTEGER NOT NULL DEFAULT 0,
    last_move_ts INTEGER NOT NULL DEFAULT 0,
    pause_prompted INTEGER NOT NULL DEFAULT 0,
    stops_count INTEGER NOT NULL DEFAULT 0,
    stopped_s INTEGER NOT NULL DEFAULT 0,
    elev_gain_m REAL NOT NULL DEFAULT 0,
    -- Timestamp of the last WRITTEN point. Pairs with last_lat/last_lng, so
    -- distance and the time it took are always measured over the same span.
    anchor_ts INTEGER NOT NULL DEFAULT 0,
    -- Last fix RECEIVED, however poor. A dropped fix still proves the GPS was
    -- alive; only true silence here means the path is unknown (§5).
    last_recv_ts INTEGER NOT NULL DEFAULT 0
  );
`);

// Dev-phase column migrations for databases created before these columns existed.
{
  const cols = ldb.getAllSync<{ name: string }>('PRAGMA table_info(local_ride_state)');
  if (!cols.some((c) => c.name === 'last_move_ts')) {
    ldb.execSync(`
      ALTER TABLE local_ride_state ADD COLUMN last_move_ts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE local_ride_state ADD COLUMN pause_prompted INTEGER NOT NULL DEFAULT 0;
    `);
  }
  if (!cols.some((c) => c.name === 'stops_count')) {
    ldb.execSync(`
      ALTER TABLE local_ride_state ADD COLUMN stops_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE local_ride_state ADD COLUMN stopped_s INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE local_ride_state ADD COLUMN elev_gain_m REAL NOT NULL DEFAULT 0;
    `);
  }
  if (!cols.some((c) => c.name === 'anchor_ts')) {
    // The false-gap fix (2026-07-21). Seeded from last_ts so a ride recorded
    // by the previous build and still in the buffer keeps classifying sanely.
    ldb.execSync(`
      ALTER TABLE local_ride_state ADD COLUMN anchor_ts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE local_ride_state ADD COLUMN last_recv_ts INTEGER NOT NULL DEFAULT 0;
      UPDATE local_ride_state SET anchor_ts = last_ts, last_recv_ts = last_ts;
    `);
  }
  const rideCols = ldb.getAllSync<{ name: string }>('PRAGMA table_info(local_rides)');
  if (!rideCols.some((c) => c.name === 'pending_title')) {
    // Title typed at the finish moment, applied to the server row on sync.
    ldb.execSync('ALTER TABLE local_rides ADD COLUMN pending_title TEXT;');
  }
  if (!rideCols.some((c) => c.name === 'pending_crew_id')) {
    // Crew chosen at the finish moment. Rides are attributed offline like
    // everything else here — the choice waits in the buffer for sync.
    ldb.execSync('ALTER TABLE local_rides ADD COLUMN pending_crew_id TEXT;');
  }
}

export type LocalRide = {
  id: string;
  bike_id: string | null;
  started_at: number;
  ended_at: number | null;
  sync_state: 'recording' | 'pending' | 'syncing' | 'synced' | 'failed';
  sync_attempts: number;
  last_error: string | null;
  pending_title: string | null;
  pending_crew_id: string | null;
};

export type LocalPoint = {
  ride_id: string;
  seq: number;
  segment_seq: number;
  ts: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
};

export type RideState = {
  ride_id: string;
  last_seq: number;
  segment_seq: number;
  last_lat: number;
  last_lng: number;
  last_ts: number;
  anchor_ts: number;
  last_recv_ts: number;
  last_altitude: number | null;
  last_accuracy: number | null;
  distance_m: number;
  gap_count: number;
  gap_duration_s: number;
  /** Last fix that represented actual movement — pause detection keys off this. */
  last_move_ts: number;
  /** 1 once the still-riding notification fired for the current pause. */
  pause_prompted: number;
  /** Pause episodes (>90s stationary) — the chai-stop count. */
  stops_count: number;
  /** Total stationary seconds across those stops. */
  stopped_s: number;
  /** Accumulated positive elevation, metres (deltas > 1.5m to skip jitter). */
  elev_gain_m: number;
};

export function recordingRide(): LocalRide | null {
  return ldb.getFirstSync<LocalRide>(
    "SELECT * FROM local_rides WHERE sync_state = 'recording' ORDER BY started_at DESC LIMIT 1"
  );
}

export function rideState(rideId: string): RideState | null {
  return ldb.getFirstSync<RideState>('SELECT * FROM local_ride_state WHERE ride_id = ?', [rideId]);
}

export function listLocalRides(): LocalRide[] {
  return ldb.getAllSync<LocalRide>('SELECT * FROM local_rides ORDER BY started_at DESC');
}

export function pointsForRide(rideId: string): LocalPoint[] {
  return ldb.getAllSync<LocalPoint>(
    'SELECT * FROM local_points WHERE ride_id = ? ORDER BY seq',
    [rideId]
  );
}

/** Title typed at the finish moment; sync writes it onto the server row. */
export function setPendingTitle(rideId: string, title: string | null) {
  ldb.runSync('UPDATE local_rides SET pending_title = ? WHERE id = ?', [title, rideId]);
}

/** The crew this ride counts toward, or null for none. */
export function setPendingCrew(rideId: string, crewId: string | null) {
  ldb.runSync('UPDATE local_rides SET pending_crew_id = ? WHERE id = ?', [crewId, rideId]);
}

export function localRide(rideId: string): LocalRide | null {
  return ldb.getFirstSync<LocalRide>('SELECT * FROM local_rides WHERE id = ?', [rideId]);
}

export function deleteLocalRide(rideId: string) {
  ldb.withTransactionSync(() => {
    ldb.runSync('DELETE FROM local_points WHERE ride_id = ?', [rideId]);
    ldb.runSync('DELETE FROM local_ride_state WHERE ride_id = ?', [rideId]);
    ldb.runSync('DELETE FROM local_rides WHERE id = ?', [rideId]);
  });
}
