import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyFix } from '../src/lib/gapRules.ts';
import { googleMapsDirectionsUrl, toGpx } from '../src/lib/gpx.ts';

/** Shorthand: a fix arriving on a healthy 5s cadence (no blackout). */
const live = (accuracy: number | null, distanceM: number, spanMs: number) =>
  classifyFix({ accuracy, distanceM, spanMs, silenceMs: 5000 });

describe('§5 fix classification', () => {
  it('drops fixes with accuracy worse than 50m', () => {
    assert.deepEqual(live(51, 400, 5000), { kind: 'drop' });
  });

  it('keeps fixes with unknown accuracy', () => {
    assert.equal(live(null, 400, 5000).kind, 'point');
  });

  it('skips sub-25m movement (software distance filter)', () => {
    assert.deepEqual(live(10, 24, 5000), { kind: 'skip' });
  });

  it('continues the segment for normal riding', () => {
    assert.deepEqual(live(10, 120, 5000), { kind: 'point', gap: false });
  });

  it('a chai stop is not a gap: long silence, same spot, then small move', () => {
    // 20 minutes of nothing, then the rider pulls out of the dhaba 60m away.
    assert.deepEqual(
      classifyFix({ accuracy: 10, distanceM: 60, spanMs: 20 * 60_000, silenceMs: 20 * 60_000 }),
      { kind: 'point', gap: false }
    );
  });

  it('long silence ending somewhere else IS a gap', () => {
    assert.deepEqual(
      classifyFix({ accuracy: 10, distanceM: 300, spanMs: 4 * 60_000, silenceMs: 4 * 60_000 }),
      { kind: 'point', gap: true }
    );
  });

  it('a jump no motorcycle could make is a gap', () => {
    // 900m in 10s is 324 km/h — the position moved, the rider did not.
    assert.deepEqual(live(10, 900, 10_000), { kind: 'point', gap: true });
  });
});

/**
 * Regression: a real ride on 2026-07-21 reported ~55 min "not counted" and
 * lost roughly 20 km. These are the exact shapes that produced it.
 */
describe('§5 false gaps — the 20 km the old rules threw away', () => {
  const KMH = (v: number) => v / 3.6; // km/h → m/s

  it('ordinary highway riding is never a gap, however sparse the fixes', () => {
    // 100 km/h with four fixes lost to the accuracy filter: 695m over 25s.
    // The old 500m rule called this a dropout and discarded the distance.
    assert.deepEqual(live(8, KMH(100) * 25, 25_000), { kind: 'point', gap: false });

    // 140 km/h over 20s = 778m. Fast, but a motorcycle absolutely does this.
    assert.deepEqual(live(8, KMH(140) * 20, 20_000), { kind: 'point', gap: false });
  });

  it('a noisy patch is not a blackout: dropped fixes still prove the GPS is alive', () => {
    // 70s of >50m-accuracy fixes, all dropped, then a clean one 1.9 km on.
    // silenceMs stays small because fixes kept ARRIVING — we just refused
    // them. The old rules read their own filtering back as signal loss.
    assert.deepEqual(
      classifyFix({ accuracy: 9, distanceM: KMH(100) * 70, spanMs: 70_000, silenceMs: 5000 }),
      { kind: 'point', gap: false }
    );
  });

  it('but a true blackout while moving is still a gap', () => {
    // Nothing arrived at all for five minutes. The road taken is unknown and
    // must not be drawn, whatever the implied speed works out to.
    assert.deepEqual(
      classifyFix({ accuracy: 9, distanceM: 6000, spanMs: 300_000, silenceMs: 300_000 }),
      { kind: 'point', gap: true }
    );
  });

  it('holds the line right at the plausible-speed boundary', () => {
    // 197 km/h is still a rider; 260 km/h is the position jumping.
    assert.deepEqual(live(8, KMH(197) * 10, 10_000), { kind: 'point', gap: false });
    assert.deepEqual(live(8, KMH(260) * 10, 10_000), { kind: 'point', gap: true });
  });
});

describe('§10 GPX export', () => {
  const segments: [number, number][][] = [
    [
      [78.265, 31.427],
      [78.276, 31.421],
    ],
    [
      [78.37, 31.376],
      [78.39, 31.368],
      [78.41, 31.359],
    ],
  ];

  it('emits one trkseg per segment — no fabricated connectors', () => {
    const gpx = toGpx('Test', segments);
    assert.equal((gpx.match(/<trkseg>/g) ?? []).length, 2);
    assert.equal((gpx.match(/<trkpt /g) ?? []).length, 5);
  });

  it('escapes XML in names', () => {
    const gpx = toGpx('Sangla <& Chitkul>', segments);
    assert.ok(gpx.includes('<name>Sangla &lt;&amp; Chitkul&gt;</name>'));
  });

  it('drops single-point segments', () => {
    const gpx = toGpx('Test', [[[78.1, 31.1]], ...segments]);
    assert.equal((gpx.match(/<trkseg>/g) ?? []).length, 2);
  });

  it('google maps link keeps at most 8 waypoints plus origin/destination', () => {
    const long: [number, number][] = Array.from({ length: 200 }, (_, i) => [78 + i * 0.001, 31]);
    const url = googleMapsDirectionsUrl([long]);
    if (!url) return assert.fail('expected a url');
    const waypoints = new URL(url).searchParams.get('waypoints') ?? '';
    assert.ok(waypoints.split('|').length <= 8);
    assert.ok(url.includes('origin=') && url.includes('destination='));
  });

  it('returns null for a route too short to navigate', () => {
    assert.equal(googleMapsDirectionsUrl([[[78, 31]]]), null);
  });
});
