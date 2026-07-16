import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyFix } from '../src/lib/gapRules.ts';
import { googleMapsDirectionsUrl, toGpx } from '../src/lib/gpx.ts';

describe('§5 fix classification', () => {
  it('drops fixes with accuracy worse than 50m', () => {
    assert.deepEqual(classifyFix({ accuracy: 51, distanceM: 400, dtMs: 5000 }), { kind: 'drop' });
  });

  it('keeps fixes with unknown accuracy', () => {
    assert.equal(classifyFix({ accuracy: null, distanceM: 400, dtMs: 5000 }).kind, 'point');
  });

  it('skips sub-25m movement (software distance filter)', () => {
    assert.deepEqual(classifyFix({ accuracy: 10, distanceM: 24, dtMs: 5000 }), { kind: 'skip' });
  });

  it('continues the segment for normal riding', () => {
    assert.deepEqual(classifyFix({ accuracy: 10, distanceM: 120, dtMs: 5000 }), {
      kind: 'point',
      gap: false,
    });
  });

  it('a chai stop is not a gap: long silence, same spot, then small move', () => {
    // 20 minutes of nothing, then the rider pulls out of the dhaba 60m away.
    assert.deepEqual(classifyFix({ accuracy: 10, distanceM: 60, dtMs: 20 * 60_000 }), {
      kind: 'point',
      gap: false,
    });
  });

  it('long silence ending somewhere else IS a gap', () => {
    assert.deepEqual(classifyFix({ accuracy: 10, distanceM: 300, dtMs: 4 * 60_000 }), {
      kind: 'point',
      gap: true,
    });
  });

  it('a big jump is a gap even when it was fast', () => {
    assert.deepEqual(classifyFix({ accuracy: 10, distanceM: 900, dtMs: 10_000 }), {
      kind: 'point',
      gap: true,
    });
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
