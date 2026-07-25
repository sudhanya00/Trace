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

      const routes = await googleRoute(points, params.alternatives !== false);
      cache.set(key, { at: Date.now(), body: routes });
      return json({ routes });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    const message = (e as Error).message ?? 'geo failed';
    // Auth failures are the caller's problem; everything else is ours.
    return json({ error: message }, message === 'unauthenticated' ? 401 : 500);
  }
});
