import { supabase } from './supabase';

/**
 * Client half of the `geo` Edge Function. Nothing here knows which providers
 * sit behind it — that's the point. The API keys live server-side, so they
 * can't be pulled out of the APK, and the entitlement check for the paid
 * tier happens where a client can't route around it.
 */

export type PlaceResult = {
  /** Google's place ID — the one field their terms allow storing indefinitely. */
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

/**
 * A line to look at, not to keep. Google's terms restrict storing computed
 * routes, so these coordinates are for display and the WAYPOINTS get saved —
 * the line is recomputed whenever it's needed again.
 */
export type RouteOption = {
  index: number;
  /** [lng, lat] pairs, GeoJSON order. Display only — never persisted. */
  coordinates: [number, number][];
  distance_km: number;
  duration_min: number;
};

/** What a planned route is actually made of, and the only part we store. */
export type Waypoint = {
  lat: number;
  lng: number;
  place_id: string | null;
  label: string;
};

async function call<T>(body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke('geo', { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as T;
}

/**
 * Search for a place by name. `near` biases results to where the rider is, so
 * "city chowk" finds the one in their city rather than a namesake 2,000 km off.
 */
export async function searchPlaces(
  query: string,
  near?: { lat: number; lng: number }
): Promise<PlaceResult[]> {
  if (query.trim().length < 2) return [];
  const { results } = await call<{ results: PlaceResult[] }>({
    action: 'search',
    query,
    near,
  });
  return results ?? [];
}

/**
 * Lines between the given points, in [lng, lat] order. With exactly two points
 * the router offers alternatives — the several ways from A to B. Add via
 * points and it returns the one road that goes through them, which is how a
 * rider says "no, the old road" rather than accepting the fastest.
 *
 * Call this whenever a route needs drawing; do not cache the result on the
 * device. The server caches briefly so this isn't a billed request every time.
 */
export async function planRoute(
  points: [number, number][],
  opts: { alternatives?: boolean } = {}
): Promise<RouteOption[]> {
  const { routes } = await call<{ routes: RouteOption[] }>({
    action: 'route',
    points,
    alternatives: opts.alternatives !== false,
  });
  return routes ?? [];
}
