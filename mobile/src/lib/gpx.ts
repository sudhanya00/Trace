/**
 * GPX 1.1 generation (§10). We do NOT build turn-by-turn — this is the entire
 * strategic wedge: export the route, hand off to Google Maps or any GPX
 * consumer. Each geometry segment becomes its own <trkseg>, so a clipped or
 * gapped route stays honest in the export too — no fabricated connectors.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Directions to a single point, handed to Google Maps.
 *
 * Getting to the meetup is a point-to-point drive with traffic and a deadline
 * — exactly what Google Maps is best at, and what a rider would open anyway.
 * TRACE's own following is for the ride itself, where the question is "am I
 * still on the road", not "which lane".
 */
export function googleMapsPointUrl(
  lat: number,
  lng: number,
  placeId?: string | null
): string {
  const base = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  // A place ID pins the actual establishment rather than the nearest bit of
  // road to its coordinates — and it's the one Google field we may store.
  return placeId ? `${base}&destination_place_id=${encodeURIComponent(placeId)}` : base;
}

export function toGpx(name: string, segments: [number, number][][]): string {
  const trksegs = segments
    .filter((seg) => seg.length >= 2)
    .map(
      (seg) =>
        `    <trkseg>\n${seg
          .map(([lng, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"/>`)
          .join('\n')}\n    </trkseg>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TRACE" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(name)}</name>
${trksegs}
  </trk>
</gpx>
`;
}

/**
 * §10: "waypoints in Google Maps" deep link for simple routes. Google's dir
 * API takes origin + destination + up to 9 waypoints, so the line is
 * downsampled evenly — good enough to seed navigation, which re-routes along
 * real roads anyway.
 */
export function googleMapsDirectionsUrl(segments: [number, number][][]): string | null {
  const coords = segments.flat();
  if (coords.length < 2) return null;
  const fmt = ([lng, lat]: [number, number]) => `${lat.toFixed(6)},${lng.toFixed(6)}`;

  const origin = coords[0];
  const destination = coords[coords.length - 1];
  const middles = coords.slice(1, -1);
  const maxWaypoints = 8;
  const stride = Math.max(1, Math.ceil(middles.length / maxWaypoints));
  const waypoints = middles.filter((_, i) => i % stride === 0).slice(0, maxWaypoints);

  const params = new URLSearchParams({
    api: '1',
    origin: fmt(origin),
    destination: fmt(destination),
    travelmode: 'driving',
  });
  if (waypoints.length) params.set('waypoints', waypoints.map(fmt).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
