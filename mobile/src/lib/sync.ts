import { ldb, listLocalRides, LocalRide, pointsForRide, rideState } from './localdb';
import { supabase } from './supabase';

/**
 * Sync pipeline (§4). Rides are append-only and single-author, which is the
 * whole reason this stays simple — no general sync framework.
 *
 * - distance_km is NOT sent: the server computes it from the geometry
 *   (ST_Length over the MULTILINESTRING) and the odometer trigger runs off it.
 * - Segments are never merged: each segment_seq becomes one linestring.
 * - Local points are deleted only after the server confirms both writes.
 * - Upserts keyed on the device-generated uuid make retries idempotent.
 */

const MAX_ATTEMPTS = 8;
let syncing = false;

export async function syncPendingRides(): Promise<void> {
  if (syncing) return; // one sweep at a time; callers fire-and-forget
  syncing = true;
  try {
    const { data: auth } = await supabase.auth.getSession();
    const userId = auth.session?.user.id;
    if (!userId) return;

    const rides = listLocalRides().filter(
      (r) =>
        (r.sync_state === 'pending' || r.sync_state === 'failed') &&
        r.sync_attempts < MAX_ATTEMPTS &&
        // exponential backoff: 30s * 2^attempts since the last try
        backoffElapsed(r)
    );
    for (const ride of rides) {
      await syncRide(ride, userId);
    }
  } finally {
    syncing = false;
  }
}

function backoffElapsed(r: LocalRide): boolean {
  if (r.sync_state !== 'failed') return true;
  const lastTry = lastAttemptAt.get(r.id) ?? 0;
  return Date.now() - lastTry > 30_000 * 2 ** r.sync_attempts;
}
const lastAttemptAt = new Map<string, number>();

async function syncRide(ride: LocalRide, userId: string): Promise<void> {
  ldb.runSync("UPDATE local_rides SET sync_state = 'syncing' WHERE id = ?", [ride.id]);
  lastAttemptAt.set(ride.id, Date.now());
  try {
    const s = rideState(ride.id);
    const points = pointsForRide(ride.id);

    const elapsedS = Math.max(0, Math.round(((ride.ended_at ?? ride.started_at) - ride.started_at) / 1000));
    const { error: rideErr } = await supabase.from('rides').upsert(
      {
        id: ride.id,
        profile_id: userId,
        bike_id: ride.bike_id,
        started_at: new Date(ride.started_at).toISOString(),
        ended_at: new Date(ride.ended_at ?? ride.started_at).toISOString(),
        gap_count: s?.gap_count ?? 0,
        gap_duration_s: s?.gap_duration_s ?? 0,
        stops_count: s?.stops_count ?? 0,
        // moving time = wall time minus stops minus dropouts
        moving_s: Math.max(0, elapsedS - (s?.stopped_s ?? 0) - (s?.gap_duration_s ?? 0)),
        elev_gain_m: Math.round(s?.elev_gain_m ?? 0),
        title: ride.pending_title,
      },
      { onConflict: 'id' }
    );
    if (rideErr) throw rideErr;

    const wkt = toMultiLineStringWkt(points);
    if (wkt) {
      const { error: trackErr } = await supabase.from('ride_tracks').upsert(
        { ride_id: ride.id, profile_id: userId, geom: wkt },
        { onConflict: 'ride_id' }
      );
      if (trackErr) throw trackErr;
    }

    // Server confirmed both writes — only now does the local buffer let go (§4).
    ldb.withTransactionSync(() => {
      ldb.runSync('DELETE FROM local_points WHERE ride_id = ?', [ride.id]);
      ldb.runSync(
        "UPDATE local_rides SET sync_state = 'synced', last_error = NULL WHERE id = ?",
        [ride.id]
      );
    });
  } catch (e) {
    ldb.runSync(
      "UPDATE local_rides SET sync_state = 'failed', sync_attempts = sync_attempts + 1, last_error = ? WHERE id = ?",
      [(e as Error).message ?? 'unknown', ride.id]
    );
  }
}

/**
 * Points → MULTILINESTRING WKT (lng lat order). Segments with a single point
 * can't form a line and are dropped from the geometry — their existence is
 * still visible in gap_count. Returns null when no segment has 2+ points
 * (recording failed hard; the ride row still syncs so the rider keeps it).
 */
export function toMultiLineStringWkt(
  points: Array<{ segment_seq: number; lat: number; lng: number }>
): string | null {
  const segments = new Map<number, string[]>();
  for (const p of points) {
    const arr = segments.get(p.segment_seq) ?? [];
    arr.push(`${p.lng} ${p.lat}`);
    segments.set(p.segment_seq, arr);
  }
  const lines = [...segments.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, coords]) => coords)
    .filter((coords) => coords.length >= 2)
    .map((coords) => `(${coords.join(', ')})`);
  if (lines.length === 0) return null;
  return `MULTILINESTRING(${lines.join(', ')})`;
}
