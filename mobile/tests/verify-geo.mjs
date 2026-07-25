/**
 * Proves the geo Edge Function actually works against real Google + ORS.
 *
 * Nothing in this path can be unit-tested — it's two third-party contracts and
 * a proxy — so this is the check that matters. Run it after setting keys:
 *
 *   1. put GOOGLE_MAPS_KEY and ORS_KEY in supabase/.env   (gitignored)
 *   2. npx supabase functions serve geo --env-file supabase/.env
 *   3. node tests/verify-geo.mjs                          (from mobile/)
 */
const URL = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

// A real session: the function resolves the caller before doing any work, so
// an anon key alone must not be enough to spend anyone's API quota.
const signIn = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'asha@test.local', password: 'password123' }),
});
const session = await signIn.json();
if (!session.access_token) {
  console.error('could not sign in — is the local stack up?', session);
  process.exit(1);
}

const call = async (body) => {
  const res = await fetch(`${URL}/functions/v1/geo`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// 1. The exact search the feature exists for: an Indian local landmark, the
//    case where OSM data is weak and Google is strong.
const search = await call({ action: 'search', query: 'City Chowk Jammu' });
const hit = search.body?.results?.[0];
check(
  'places search returns a located result',
  search.status === 200 && !!hit?.lat && !!hit?.lng,
  hit ? `${hit.name} (${hit.lat?.toFixed(3)}, ${hit.lng?.toFixed(3)})` : JSON.stringify(search.body)
);
check(
  'result carries a storable place_id',
  !!hit?.place_id,
  hit?.place_id ? hit.place_id.slice(0, 18) + '…' : 'missing'
);

// 2. Routing between two real points — Jammu to Patnitop, the user's own
//    example, and the case that has several legitimate lines.
const route = await call({
  action: 'route',
  points: [
    [74.857, 32.7266], // Jammu
    [75.331, 33.0836], // Patnitop
  ],
  alternatives: true,
});
const first = route.body?.routes?.[0];
check(
  'ORS returns a route with geometry',
  route.status === 200 && Array.isArray(first?.coordinates) && first.coordinates.length > 2,
  first
    ? `${first.coordinates.length} points, ${first.distance_km?.toFixed(1)} km, ${first.duration_min} min`
    : JSON.stringify(route.body).slice(0, 300)
);
check(
  'alternatives offered for a two-point request',
  (route.body?.routes?.length ?? 0) > 1,
  `${route.body?.routes?.length ?? 0} option(s)`
);
check(
  'ODbL attribution travels with the geometry',
  !!first?.attribution,
  first?.attribution ?? 'missing'
);

// 3. The paywall seam: unauthenticated callers must not spend quota.
const anonCall = await fetch(`${URL}/functions/v1/geo`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'search', query: 'City Chowk Jammu' }),
});
check('unauthenticated calls are refused', anonCall.status === 401, `status ${anonCall.status}`);

console.log(failed === 0 ? '\nall geo checks passed' : `\n${failed} check(s) failed`);
process.exit(failed ? 1 : 0);
