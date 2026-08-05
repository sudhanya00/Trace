/**
 * geo — the server side of location search and route planning.
 *
 * Why this exists rather than calling the APIs from the app:
 *
 *  1. An API key shipped in an APK is an API key anyone can extract. Google
 *     bills per request, so a leaked key is someone else's traffic on your
 *     card.
 *  2. Route planning is meant to be a paid feature. A paywall enforced in the
 *     client is not a paywall — this function is the only place entitlement
 *     can actually be checked. The seam is `assertEntitled()` below.
 *  3. Places and Directions bill per call, so the cache here is money.
 *  4. Providers change. This is one server file, not an app release.
 *
 * One provider — Google (user decision 2026-07-25) — for both search and
 * routing, with a hard rule attached:
 *
 *   WE NEVER STORE A GOOGLE-COMPUTED LINE.
 *
 * Google's terms restrict storing Directions content; place IDs are the stated
 * exemption. So a planned route is persisted as the WAYPOINTS the rider chose
 * (their own coordinates, plus exempt place IDs) and the line is recomputed
 * here on demand. That keeps one vendor, one bill, and the best Indian
 * coverage, without retaining a metre of their content.
 *
 * The cache below is what stops "recompute on demand" meaning "pay Google
 * every time someone looks at a ride".
 *
 * Secrets (set with `supabase secrets set`, never in the repo):
 *   GOOGLE_MAPS_KEY  — with BOTH "Places API (New)" and "Routes API" enabled,
 *                      billing on
 */

import { forecastFor, geocodeOne } from '../_shared/forecast.ts';

const GOOGLE_KEY = Deno.env.get('GOOGLE_MAPS_KEY');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** India-first: bias search results home rather than scattering them globally. */
const REGION = 'IN';

/**
 * Cheap in-memory cache. Per-instance and short-lived by design — long enough
 * to kill the repeat traffic of someone retyping a query, short enough to stay
 * inside provider caching rules.
 */
const cache = new Map<string, { at: number; body: unknown }>();
const CACHE_MS = 10 * 60_000;

function cached(key: string): unknown | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) return null;
  return hit.body;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * Per-rider throttle.
 *
 * Every call past the cache costs money at Google, and a signed-in account is
 * cheap to get. Without this, one rider with a loop can spend the whole
 * billing account before anyone notices — the failure mode here is a bill, not
 * a breach, which is exactly why it's easy to leave unguarded.
 *
 * Deliberately generous: a rider dragging a route around genuinely fires a lot
 * of requests, and the cache absorbs the repeats. These numbers refuse abuse,
 * not use.
 *
 * In-memory, so the real ceiling is this times the instance count. That is a
 * floor on protection rather than a guarantee — a durable counter belongs in
 * Postgres alongside the subscription model below.
 */
const LIMIT = { search: 60, route: 40 };
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

/**
 * Called on the way to Google, never on a cache hit — the thing being rationed
 * is spend, and a hit costs nothing. A rider dragging a route around fires a
 * lot of requests that the cache absorbs; those shouldn't count against them.
 */
function throttle(userId: string, action: 'search' | 'route'): void {
  const now = Date.now();
  // The map is per-instance and only grows while an instance lives, but an
  // idle rider shouldn't hold a slot in it forever.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  const key = `${action}:${userId}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT[action]) throw new Error('slow down');
  recent.push(now);
  hits.set(key, recent);
}

/**
 * The freemium gate. Today it only proves the caller is a signed-in rider —
 * there is no subscription model yet, and inventing a schema for one here
 * would be guessing. When plans exist, this is the single place that decides,
 * and no client change is needed to enforce it.
 */
function assertEntitled(userId: string, _action: 'search' | 'route'): void {
  if (!userId) throw new Error('unauthenticated');
  // TODO(subscriptions): look up the rider's plan and refuse or meter here.
}

/** Who's calling. The anon key alone isn't enough — we want the actual user. */
async function callerId(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization');
  if (!auth) return '';
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' },
  });
  if (!res.ok) return '';
  const user = await res.json();
  return user?.id ?? '';
}

/**
 * Google Places Text Search (New). The field mask is not decoration — it
 * decides which billing tier the request lands in, so it stays as narrow as
 * the feature allows: id, name, address, coordinates. Nothing else.
 */
async function placesSearch(query: string, near?: { lat: number; lng: number }) {
  if (!GOOGLE_KEY) throw new Error('GOOGLE_MAPS_KEY is not set');
  const body: Record<string, unknown> = { textQuery: query, regionCode: REGION };
  if (near) {
    body.locationBias = {
      circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 },
    };
  }

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`places ${res.status}: ${await res.text()}`);
  const data = await res.json();

  return (data.places ?? []).slice(0, 8).map((p: Record<string, any>) => ({
    place_id: p.id,
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
  }));
}

/**
 * Google Routes API. Returns the line for display only — the caller stores the
 * waypoints, never this.
 *
 * GEO_JSON_LINESTRING is requested rather than the default encoded polyline so
 * nothing has to decode Google's polyline format on the client; the shape
 * arrives in the same [lng, lat] order everything else in this app uses.
 *
 * Alternatives are only meaningful between two points. Once via points exist
 * the rider has already said which way they're going, so Google is asked for
 * the one line through them.
 */
async function googleRoute(points: [number, number][], wantAlternatives: boolean) {
  if (!GOOGLE_KEY) throw new Error('GOOGLE_MAPS_KEY is not set');

  const asWaypoint = ([lng, lat]: [number, number]) => ({
    location: { latLng: { latitude: lat, longitude: lng } },
  });
  const twoPoints = points.length === 2;

  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      // Narrow on purpose: the field mask decides the billing tier.
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.geoJsonLinestring',
    },
    body: JSON.stringify({
      origin: asWaypoint(points[0]),
      destination: asWaypoint(points[points.length - 1]),
      intermediates: points.slice(1, -1).map(asWaypoint),
      travelMode: 'DRIVE',
      computeAlternativeRoutes: wantAlternatives && twoPoints,
      polylineEncoding: 'GEO_JSON_LINESTRING',
      units: 'METRIC',
    }),
  });
  if (!res.ok) throw new Error(`routes ${res.status}: ${await res.text()}`);
  const data = await res.json();

  return (data.routes ?? []).map((r: Record<string, any>, i: number) => ({
    index: i,
    // GeoJSON LineString: coordinates already [lng, lat].
    coordinates: r.polyline?.geoJsonLinestring?.coordinates ?? [],
    distance_km: (r.distanceMeters ?? 0) / 1000,
    // Google returns duration as a string of seconds, e.g. "8130s".
    duration_min: Math.round(parseInt(String(r.duration ?? '0').replace('s', ''), 10) / 60),
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const userId = await callerId(req);
    const { action, ...params } = await req.json();

    if (action === 'search') {
      const query = String(params.query ?? '').trim();
      if (query.length < 2) return json({ results: [] });
      assertEntitled(userId, 'search');

      const key = `s:${query}:${params.near?.lat ?? ''},${params.near?.lng ?? ''}`;
      const hit = cached(key);
      if (hit) return json({ results: hit, cached: true });

      throttle(userId, 'search');
      const results = await placesSearch(query, params.near);
      cache.set(key, { at: Date.now(), body: results });
      return json({ results });
    }

    if (action === 'route') {
      const points = params.points as [number, number][];
      if (!Array.isArray(points) || points.length < 2) {
        return json({ error: 'need at least a start and an end' }, 400);
      }
      assertEntitled(userId, 'route');

      const key = `r:${JSON.stringify(points)}:${params.alternatives ? 'alt' : 'one'}`;
      const hit = cached(key);
      if (hit) return json({ routes: hit, cached: true });

      throttle(userId, 'route');
      const routes = await googleRoute(points, params.alternatives !== false);
      cache.set(key, { at: Date.now(), body: routes });
      return json({ routes });
    }

    if (action === 'forecast') {
      const place = String(params.place ?? '').trim();
      const date = params.date ? new Date(params.date) : null;
      if (!place || !date || Number.isNaN(+date)) {
        return json({ error: 'need a place and a date' }, 400);
      }
      assertEntitled(userId, 'search');

      // Weather moves slowly enough that the existing ten-minute cache is
      // generous rather than stale, and a region's forecast is shared across
      // every rider asking about it.
      // Read the map directly rather than through cached(): a null body is a
      // real answer here ("nobody knows yet"), and cached() cannot tell that
      // apart from a miss — so the one result most likely to repeat would be
      // the one that never cached.
      const key = `w:${place}:${date.toISOString().slice(0, 10)}`;
      const entry = cache.get(key);
      if (entry && Date.now() - entry.at < CACHE_MS) {
        return json({ forecast: entry.body, cached: true });
      }

      if (!GOOGLE_KEY) throw new Error('GOOGLE_MAPS_KEY is not set');
      throttle(userId, 'search');
      const at = await geocodeOne(place, GOOGLE_KEY);
      // No such place is not an error — it is an answer, and the caller says
      // so rather than showing a weather line for somewhere that isn't there.
      const forecast = at ? await forecastFor(at.lat, at.lng, date, GOOGLE_KEY) : null;
      cache.set(key, { at: Date.now(), body: forecast });
      return json({ forecast });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    const message = (e as Error).message ?? 'geo failed';
    // Auth failures and throttling are the caller's problem; everything else
    // is ours.
    const status = message === 'unauthenticated' ? 401 : message === 'slow down' ? 429 : 500;
    return json({ error: message }, status);
  }
});
