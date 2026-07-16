/**
 * The §5 fix-classification rules, pure and testable. The recording engine
 * applies these to every fix; the test pass asserts them directly.
 *
 * The one hard rule lives here: a dropout ends a segment, and gap distance is
 * never counted. A stop is not a gap — >60s of silence at (roughly) the same
 * spot covered no distance and fabricates nothing by keeping the segment.
 */

export const ACCURACY_CUTOFF_M = 50; // drop noisier fixes before writing
export const MIN_WRITE_DISTANCE_M = 25; // software distance filter
export const GAP_TIME_MS = 60_000;
export const GAP_DISTANCE_M = 500;
export const STATIONARY_RADIUS_M = 100;

export type FixClass =
  | { kind: 'drop' } // accuracy too poor to trust
  | { kind: 'skip' } // no meaningful movement — freshness update only
  | { kind: 'point'; gap: false } // continues the current segment
  | { kind: 'point'; gap: true }; // starts a new segment: a real dropout

export function classifyFix(input: {
  accuracy: number | null;
  distanceM: number;
  dtMs: number;
}): FixClass {
  if (input.accuracy != null && input.accuracy > ACCURACY_CUTOFF_M) return { kind: 'drop' };
  if (input.distanceM < MIN_WRITE_DISTANCE_M) return { kind: 'skip' };

  const movedFar = input.distanceM > GAP_DISTANCE_M;
  const silentAndElsewhere = input.dtMs > GAP_TIME_MS && input.distanceM > STATIONARY_RADIUS_M;
  return { kind: 'point', gap: movedFar || silentAndElsewhere };
}
