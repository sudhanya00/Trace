import { supabase } from './supabase';

/** Row types mirror supabase/migrations — keep in sync by hand, they change rarely. */
export type Profile = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  visibility: 'public' | 'private';
  home_region: string | null;
  created_at: string;
};

export type Bike = {
  id: string;
  profile_id: string;
  make: string;
  model: string;
  year: number | null;
  mods: string | null;
  photo_url: string | null;
  current_odometer_km: number;
  is_active: boolean;
  created_at: string;
};

export type Ride = {
  id: string;
  profile_id: string;
  bike_id: string | null;
  started_at: string;
  ended_at: string;
  distance_km: number;
  gap_count: number;
  gap_duration_s: number;
  title: string | null;
  note: string | null;
  created_at: string;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createProfile(userId: string, handle: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: userId, handle })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, 'display_name' | 'visibility' | 'home_region' | 'avatar_url'>>
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listBikes(): Promise<Bike[]> {
  const { data, error } = await supabase
    .from('bikes')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getBike(id: string): Promise<Bike | null> {
  const { data, error } = await supabase.from('bikes').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export type BikeInput = {
  make: string;
  model: string;
  year: number | null;
  mods: string | null;
  current_odometer_km: number;
};

export async function createBike(profileId: string, input: BikeInput): Promise<Bike> {
  const { data, error } = await supabase
    .from('bikes')
    .insert({ profile_id: profileId, ...input })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBike(id: string, patch: Partial<BikeInput & { is_active: boolean }>): Promise<Bike> {
  const { data, error } = await supabase.from('bikes').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** Ride counts per bike, one round trip. Fine at Phase 01 volumes. */
export async function rideCountsByBike(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('rides').select('bike_id');
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    if (r.bike_id) counts.set(r.bike_id, (counts.get(r.bike_id) ?? 0) + 1);
  }
  return counts;
}

export async function listRidesForBike(bikeId: string): Promise<Ride[]> {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('bike_id', bikeId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listMyRides(userId: string): Promise<Ride[]> {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('profile_id', userId)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getRide(id: string): Promise<Ride | null> {
  const { data, error } = await supabase.from('rides').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateRide(
  id: string,
  patch: Partial<Pick<Ride, 'title' | 'note' | 'bike_id'>>
): Promise<Ride> {
  const { data, error } = await supabase.from('rides').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** Canonical server geometry for the caller's own ride (RLS applies). */
export async function ownTrackSegments(rideId: string): Promise<[number, number][][] | null> {
  const { data, error } = await supabase.rpc('own_track_geojson', { p_ride_id: rideId });
  if (error) throw error;
  if (!data || data.type !== 'MultiLineString') return null;
  return data.coordinates as [number, number][][];
}

/** §12b manual entry: distance + date + bike, no track. Keeps the odometer
 *  honest when recording fails — distance_km is client-set by design here,
 *  and the odometer trigger picks it up like any other ride. */
export async function createManualRide(
  userId: string,
  input: { bike_id: string | null; date: Date; distance_km: number; title: string | null }
): Promise<Ride> {
  const at = new Date(input.date);
  at.setHours(12, 0, 0, 0);
  const { data, error } = await supabase
    .from('rides')
    .insert({
      profile_id: userId,
      bike_id: input.bike_id,
      started_at: at.toISOString(),
      ended_at: at.toISOString(),
      distance_km: input.distance_km,
      title: input.title,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export type Route = {
  id: string;
  profile_id: string;
  source_ride_id: string | null;
  name: string;
  description: string | null;
  terrain_tags: string[] | null;
  distance_km: number;
  photo_url: string | null;
  created_at: string;
};

/** Create a route from a ride's segments. The route line concatenates
 *  segments (a route is a recommendation, not a recording) but distance_km
 *  carries the ride's honest measured distance — never the line's length,
 *  which would count gap connectors. */
export async function createRoute(
  userId: string,
  input: {
    source_ride_id: string;
    name: string;
    description: string | null;
    terrain_tags: string[];
    distance_km: number;
    segments: [number, number][][];
  }
): Promise<Route> {
  const coords = input.segments.flat();
  if (coords.length < 2) throw new Error('This ride has no track to share.');
  const wkt = `LINESTRING(${coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`;
  const { data, error } = await supabase
    .from('routes')
    .insert({
      profile_id: userId,
      source_ride_id: input.source_ride_id,
      name: input.name,
      description: input.description,
      terrain_tags: input.terrain_tags.length ? input.terrain_tags : null,
      distance_km: input.distance_km,
      geom: wkt,
    })
    .select('id, profile_id, source_ride_id, name, description, terrain_tags, distance_km, photo_url, created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function getRoute(id: string): Promise<Route | null> {
  // Own routes come straight off the table; someone else's come through the
  // privacy-clipped public view. Same shape either way.
  const own = await supabase
    .from('routes')
    .select('id, profile_id, source_ride_id, name, description, terrain_tags, distance_km, photo_url, created_at')
    .eq('id', id)
    .maybeSingle();
  if (own.error) throw own.error;
  if (own.data) return own.data;
  const pub = await supabase
    .from('routes_public')
    .select('id, profile_id, source_ride_id, name, description, terrain_tags, distance_km, photo_url, created_at')
    .eq('id', id)
    .maybeSingle();
  if (pub.error) throw pub.error;
  return pub.data;
}

export async function routeForRide(rideId: string): Promise<Route | null> {
  const { data, error } = await supabase
    .from('routes')
    .select('id, profile_id, source_ride_id, name, description, terrain_tags, distance_km, photo_url, created_at')
    .eq('source_ride_id', rideId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Privacy-clipped route geometry — what everyone (including the owner
 *  previewing their public face) sees and exports. */
export async function publicRouteSegments(routeId: string): Promise<[number, number][][] | null> {
  const { data, error } = await supabase.rpc('public_route_geojson', { p_route_id: routeId });
  if (error) throw error;
  if (!data) return null;
  if (data.type === 'LineString') return [data.coordinates as [number, number][]];
  if (data.type === 'MultiLineString') return data.coordinates as [number, number][][];
  return null;
}

export async function updateRoutePhoto(routeId: string, photoUrl: string): Promise<void> {
  const { error } = await supabase.from('routes').update({ photo_url: photoUrl }).eq('id', routeId);
  if (error) throw error;
}

export async function uploadRoutePhoto(
  userId: string,
  routeId: string,
  bytes: ArrayBuffer
): Promise<string> {
  const path = `${userId}/${routeId}.jpg`;
  const { error } = await supabase.storage
    .from('route-photos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  return supabase.storage.from('route-photos').getPublicUrl(path).data.publicUrl;
}

/** §12b: one-tap report — the feedback loop that fixes GPS. */
export async function submitRecordingReport(
  userId: string,
  rideId: string | null,
  device: object,
  payload: object
): Promise<void> {
  const { error } = await supabase
    .from('recording_reports')
    .insert({ profile_id: userId, ride_id: rideId, device, payload });
  if (error) throw error;
}
