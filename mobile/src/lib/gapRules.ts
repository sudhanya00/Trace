/**
 * The §5 fix-classification rules, pure and testable. The recording engine
 * applies these to every fix; the test pass asserts them directly.
 *
 * The one hard rule lives here: a dropout ends a segment, and gap distance is
 * never counted. A stop is not a gap — >60s of silence at (roughly) the same
 * spot covered no distance and fabricates nothing by keeping the segment.
 *
 * ---------------------------------------------------------------------------
 * Rewritten 2026-07-21 after a real ride lost ~20 km to false gaps.
 *
 * The old rules asked two questions that real riding answers wrongly:
 *
 *   1. "Is this fix more than 500m from the last one?" — speed-blind. 500m is
 *      18 seconds at 100 km/h. Any time the fix cadence stretched, ordinary
 *      highway riding tripped it and the distance was thrown away.
 *
 *   2. "Has it been more than 60s since the last fix?" — where "last fix"
 *      meant the last fix we ACCEPTED. Fixes dropped for poor accuracy never
 *      advanced that clock, so the filter manufactured its own silence and
 *      then read that silence back as signal loss. Self-inflicted.
 *
 * The distinction that actually matters is between a fix we THREW AWAY and a
 * fix we NEVER RECEIVED. The first means the GPS is noisy; the rider is still
 * there and still moving, and the next trusted fix legitimately accounts for
 * the distance since the last trusted one. The second means the path is
 * genuinely unknown and must not be drawn.
 *
 * So the engine now tracks three clocks, and each answers one question:
 *   - silenceMs — since ANY fix arrived, however bad. Was there a blackout?
 *   - spanMs    — since the last WRITTEN point. Over what period did this
 *                 distance accrue?
 *   - last_ts   — since the last fix we trusted. Drives the GPS indicator.
 *
 * A gap is now: a real blackout while moving, or an implied speed no
 * motorcycle can produce. Everything else is riding, sampled sparsely, and
 * gets counted.
 */

export const ACCURACY_CUTOFF_M = 50; // drop noisier fixes before writing
export const MIN_WRITE_DISTANCE_M = 25; // software distance filter
export const GAP_TIME_MS = 60_000; // no fix AT ALL for this long = blackout
export const STATIONARY_RADIUS_M = 100;
/**
 * ~198 km/h. Above this the position jumped rather than the rider moving:
 * that is signal loss or a bounce, and the path between is unknown. Set well
 * above anything these bikes do so that genuine riding is never discarded —
 * the cost of guessing wrong in this direction is a rider's distance, and the
 * cost of guessing wrong the other way is one over-counted straight line.
 */
export const MAX_PLAUSIBLE_SPEED_MS = 55;

export type FixClass =
  | { kind: 'drop' } // accuracy too poor to trust
  | { kind: 'skip' } // no meaningful movement — freshness update only
  | { kind: 'point'; gap: false } // continues the current segment
  | { kind: 'point'; gap: true }; // starts a new segment: a real dropout

export function classifyFix(input: {
  accuracy: number | null;
  /** Metres from the last WRITTEN point. */
  distanceM: number;
  /** Milliseconds since the last WRITTEN point — pairs with distanceM. */
  spanMs: number;
  /** Milliseconds since ANY fix arrived, including ones we dropped. */
  silenceMs: number;
}): FixClass {
  if (input.accuracy != null && input.accuracy > ACCURACY_CUTOFF_M) return { kind: 'drop' };
  if (input.distanceM < MIN_WRITE_DISTANCE_M) return { kind: 'skip' };

  // A blackout: nothing arrived for a minute and the rider is somewhere else.
  // We cannot know the road taken, so we refuse to draw it.
  const blackout = input.silenceMs > GAP_TIME_MS && input.distanceM > STATIONARY_RADIUS_M;

  // A teleport: the distance cannot be explained by the time it took.
  const impliedSpeed = input.spanMs > 0 ? input.distanceM / (input.spanMs / 1000) : Infinity;
  const teleport = impliedSpeed > MAX_PLAUSIBLE_SPEED_MS;

  return { kind: 'point', gap: blackout || teleport };
}
