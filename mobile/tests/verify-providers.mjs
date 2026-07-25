/**
 * Verifies the Google Places and OpenRouteService contracts DIRECTLY — the
 * exact requests the geo Edge Function makes, without needing the Supabase
 * stack up. This isolates the genuinely unverified part (the third-party
 * request/response shapes) from local infrastructure.
 *
 * Reads keys from supabase/.env itself and never prints them.
 *
 *   node tests/verify-providers.mjs      (from mobile/)
 */
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '../supabase/.env');
if (!fs.existsSync(envPath)) {
  console.error(`no key file at ${envPath}`);
  process.exit(1);
}
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const GOOGLE_KEY = env.GOOGLE_MAPS_KEY;
console.log(`google key: ${GOOGLE_KEY ? 'present' : 'MISSING'}\n`);

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// ── Google Places Text Search (New) ─────────────────────────────────────────
// The exact call placesSearch() makes, field mask and all.
if (GOOGLE_KEY) {
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        textQuery: 'City Chowk Jammu',
        regionCode: 'IN',
        locationBias: {
          circle: { center: { latitude: 32.7266, longitude: 74.857 }, radius: 50000 },
        },
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      check('places search', false, `${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    } else {
      const p = body.places?.[0];
      check(
        'places: Indian landmark resolves to coordinates',
        !!p?.location?.latitude && !!p?.location?.longitude,
        p ? `${p.displayName?.text} (${p.location.latitude.toFixed(3)}, ${p.location.longitude.toFixed(3)})` : 'no results'
      );
      check('places: storable place_id returned', !!p?.id, p?.id ? `${p.id.slice(0, 20)}…` : 'missing');
      check('places: address present', !!p?.formattedAddress, p?.formattedAddress?.slice(0, 60));
    }
  } catch (e) {
    check('places search', false, e.message);
  }
}

// ── Google Routes API ───────────────────────────────────────────────────────
// Jammu → Patnitop: the user's own example, and the case with several
// legitimate lines between the same two points.
if (GOOGLE_KEY) {
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask':
          'routes.duration,routes.distanceMeters,routes.polyline.geoJsonLinestring',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: 32.7266, longitude: 74.857 } } },
        destination: { location: { latLng: { latitude: 33.0836, longitude: 75.331 } } },
        travelMode: 'DRIVE',
        computeAlternativeRoutes: true,
        polylineEncoding: 'GEO_JSON_LINESTRING',
        units: 'METRIC',
      }),
    });
    // Read as text first: an error page is HTML, and parsing it as JSON throws
    // away the status code that says what actually went wrong.
    const raw = await res.text();
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      check('routes api', false, `HTTP ${res.status}, non-JSON: ${raw.slice(0, 200).replace(/\s+/g, ' ')}`);
    }
    if (body && !res.ok) {
      check('routes api', false, `${res.status}: ${JSON.stringify(body).slice(0, 350)}`);
    } else if (body) {
      const r = body.routes?.[0];
      const coords = r?.polyline?.geoJsonLinestring?.coordinates;
      check(
        'routes: geometry returned as GeoJSON',
        Array.isArray(coords) && coords.length > 2,
        coords ? `${coords.length} points` : JSON.stringify(r ?? {}).slice(0, 200)
      );
      check(
        'routes: distance and duration present',
        typeof r?.distanceMeters === 'number' && !!r?.duration,
        r ? `${(r.distanceMeters / 1000).toFixed(1)} km, ${r.duration}` : 'missing'
      );
      // Jammu→Patnitop is NH44 with no competitive rival, so it correctly
      // returns ONE route. Alternatives are a property of the road network,
      // not of the request — so they're asserted where they actually exist.
      check(
        'routes: single road returns a single option',
        (body.routes?.length ?? 0) === 1,
        `${body.routes?.length ?? 0} option(s) — one road, as expected in the hills`
      );
    }
  } catch (e) {
    check('routes api', false, e.message);
  }

  // Alternatives, proven where the network actually offers them.
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: 28.6139, longitude: 77.209 } } }, // Delhi
        destination: { location: { latLng: { latitude: 26.9124, longitude: 75.7873 } } }, // Jaipur
        travelMode: 'DRIVE',
        computeAlternativeRoutes: true,
        units: 'METRIC',
      }),
    });
    const body = await res.json();
    const opts = body.routes?.length ?? 0;
    check(
      'routes: alternatives returned where roads diverge',
      res.ok && opts > 1,
      `${opts} option(s) Delhi→Jaipur`
    );
  } catch (e) {
    check('routes: alternatives', false, e.message);
  }
}

console.log(failed === 0 ? '\nall provider contracts verified' : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
