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
  moving_s: number | null;
  stops_count: number | null;
  elev_gain_m: number | null;
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

/**
 * The caller's OWN bikes. RLS governs visibility (a public rider's bikes are
 * legitimately readable by others — that's rider profiles), so ownership must
 * be an explicit filter, never an assumption. Garage/record/manual-entry all
 * mean "my garage".
 */
export async function listBikes(userId: string): Promise<Bike[]> {
  const { data, error } = await supabase
    .from('bikes')
    .select('*')
    .eq('profile_id', userId)
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

/** Ride counts per OWN bike, one round trip. Fine at Phase 01 volumes. */
export async function rideCountsByBike(userId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('rides')
    .select('bike_id')
    .eq('profile_id', userId);
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

export type PrivacyZone = {
  id: string;
  profile_id: string;
  label: string | null;
  created_at: string;
};

export async function listPrivacyZones(): Promise<PrivacyZone[]> {
  // Deliberately never selects the area geometry — the app doesn't need to
  // re-render the exact home polygon anywhere outside the editor.
  const { data, error } = await supabase
    .from('privacy_zones')
    .select('id, profile_id, label, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Zones are circles to the rider, polygons to PostGIS: a 32-gon around the
 *  chosen center. Clipping applies at read time from the moment this row
 *  exists — no reprocessing, past rides included. */
export async function createPrivacyZone(
  userId: string,
  label: string | null,
  centerLng: number,
  centerLat: number,
  radiusM: number
): Promise<void> {
  const pts: string[] = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((centerLat * Math.PI) / 180));
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    pts.push(`${(centerLng + dLng * Math.cos(a)).toFixed(6)} ${(centerLat + dLat * Math.sin(a)).toFixed(6)}`);
  }
  const wkt = `POLYGON((${pts.join(', ')}))`;
  const { error } = await supabase
    .from('privacy_zones')
    .insert({ profile_id: userId, label, area: wkt });
  if (error) throw error;
}

export async function deletePrivacyZone(id: string): Promise<void> {
  const { error } = await supabase.from('privacy_zones').delete().eq('id', id);
  if (error) throw error;
}

export type FollowEdge = {
  direction: 'following' | 'follower';
  other_id: string;
  handle: string;
  display_name: string | null;
  state: 'pending' | 'accepted';
  created_at: string;
};

/** Both sides of the caller's follow graph, with names. */
export async function followEdges(): Promise<FollowEdge[]> {
  const { data, error } = await supabase.rpc('follow_edges');
  if (error) throw error;
  return data ?? [];
}

/** Follow someone. The server decides pending vs accepted from their
 *  visibility — public accepts instantly, private becomes a request. */
export async function follow(userId: string, followeeId: string): Promise<'pending' | 'accepted'> {
  const { data, error } = await supabase
    .from('follows')
    .insert({ follower_id: userId, followee_id: followeeId })
    .select('state')
    .single();
  if (error) throw error;
  return data.state;
}

export async function unfollow(userId: string, followeeId: string): Promise<void> {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', userId)
    .eq('followee_id', followeeId);
  if (error) throw error;
}

export async function acceptFollow(followerId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('follows')
    .update({ state: 'accepted' })
    .eq('follower_id', followerId)
    .eq('followee_id', userId);
  if (error) throw error;
}

export async function declineFollow(followerId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followee_id', userId);
  if (error) throw error;
}

/** Handle search. RLS keeps results to public + followed profiles. */
export async function searchRiders(userId: string, q: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .neq('id', userId)
    .or(`handle.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function listRiderRoutes(profileId: string): Promise<Route[]> {
  const { data, error } = await supabase
    .from('routes_public')
    .select('id, profile_id, source_ride_id, name, description, terrain_tags, distance_km, photo_url, created_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type ThreadComment = {
  id: string;
  profile_id: string;
  handle: string;
  display_name: string | null;
  body: string;
  rode_it: boolean;
  created_at: string;
};

export type ConditionReport = {
  id: string;
  profile_id: string;
  handle: string;
  status: 'clear' | 'caution' | 'blocked';
  note: string | null;
  rode_it: boolean;
  created_at: string;
};

export async function routeThread(routeId: string): Promise<ThreadComment[]> {
  const { data, error } = await supabase.rpc('route_thread', { p_route_id: routeId });
  if (error) throw error;
  return data ?? [];
}

export async function addRouteComment(userId: string, routeId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('route_comments')
    .insert({ route_id: routeId, profile_id: userId, body });
  if (error) throw error;
}

export async function deleteRouteComment(id: string): Promise<void> {
  const { error } = await supabase.from('route_comments').delete().eq('id', id);
  if (error) throw error;
}

export async function flagComment(userId: string, commentId: string): Promise<void> {
  const { error } = await supabase
    .from('content_reports')
    .insert({ reporter_id: userId, comment_id: commentId });
  if (error) throw error;
}

export async function routeConditions(routeId: string): Promise<ConditionReport[]> {
  const { data, error } = await supabase.rpc('route_conditions', { p_route_id: routeId });
  if (error) throw error;
  return data ?? [];
}

export async function addConditionReport(
  userId: string,
  routeId: string,
  status: ConditionReport['status'],
  note: string | null
): Promise<void> {
  const { error } = await supabase
    .from('condition_reports')
    .insert({ route_id: routeId, profile_id: userId, status, note });
  if (error) throw error;
}

export type AppNotification = {
  id: string;
  title: string;
  body: string | null;
  data: { url?: string };
  read: boolean;
  created_at: string;
};

export async function listNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, title, body, data, read, created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
  if (error) throw error;
}

export type Crew = {
  id: string;
  name: string;
  region: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  member_count?: number;
};

export type CrewMessage = {
  id: string;
  profile_id: string;
  handle: string;
  body: string;
  created_at: string;
};

export type CrewMember = {
  profile_id: string;
  handle: string;
  display_name: string | null;
  role: 'admin' | 'member';
  joined_at: string;
};

export async function listCrews(): Promise<Crew[]> {
  const { data, error } = await supabase
    .from('crews')
    .select('*, crew_members(count)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    ...c,
    member_count: (c.crew_members as { count: number }[] | null)?.[0]?.count ?? 0,
  }));
}

export async function myCrewIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('crew_members')
    .select('crew_id')
    .eq('profile_id', userId);
  if (error) throw error;
  return new Set((data ?? []).map((m) => m.crew_id));
}

export async function createCrew(
  userId: string,
  input: { name: string; region: string | null; description: string | null }
): Promise<Crew> {
  const { data, error } = await supabase
    .from('crews')
    .insert({ ...input, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function joinCrew(userId: string, crewId: string): Promise<void> {
  const { error } = await supabase
    .from('crew_members')
    .insert({ crew_id: crewId, profile_id: userId });
  if (error) throw error;
}

export async function leaveCrew(userId: string, crewId: string): Promise<void> {
  const { error } = await supabase
    .from('crew_members')
    .delete()
    .eq('crew_id', crewId)
    .eq('profile_id', userId);
  if (error) throw error;
}

export async function crewChat(crewId: string, before?: string): Promise<CrewMessage[]> {
  const { data, error } = await supabase.rpc('crew_chat', {
    p_crew_id: crewId,
    p_before: before ?? null,
  });
  if (error) throw error;
  return data ?? [];
}

export async function crewRoster(crewId: string): Promise<CrewMember[]> {
  const { data, error } = await supabase.rpc('crew_roster', { p_crew_id: crewId });
  if (error) throw error;
  return data ?? [];
}

export async function sendCrewMessage(userId: string, crewId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('crew_messages')
    .insert({ crew_id: crewId, profile_id: userId, body });
  if (error) throw error;
}

export type RideInvite = {
  id: string;
  created_by: string;
  handle: string;
  crew_id: string | null;
  route_id: string | null;
  title: string;
  meetup: string | null;
  region: string | null;
  starts_at: string;
  rsvp_count: number;
  i_am_in: boolean;
};

/** Upcoming invites: the public board (crewId null) or one crew's. */
export async function listInvites(crewId: string | null): Promise<RideInvite[]> {
  const { data, error } = await supabase.rpc('invite_list', { p_crew_id: crewId });
  if (error) throw error;
  return (data ?? []).map((i: RideInvite & { rsvp_count: number | string }) => ({
    ...i,
    rsvp_count: Number(i.rsvp_count),
  }));
}

export async function createInvite(
  userId: string,
  input: {
    crew_id: string | null;
    title: string;
    meetup: string | null;
    region: string | null;
    starts_at: Date;
  }
): Promise<void> {
  const { error } = await supabase.from('ride_invites').insert({
    created_by: userId,
    crew_id: input.crew_id,
    title: input.title,
    meetup: input.meetup,
    region: input.region,
    starts_at: input.starts_at.toISOString(),
  });
  if (error) throw error;
}

export async function rsvpInvite(userId: string, inviteId: string, going: boolean): Promise<void> {
  if (going) {
    const { error } = await supabase
      .from('invite_rsvps')
      .insert({ invite_id: inviteId, profile_id: userId });
    if (error && error.code !== '23505') throw error;
  } else {
    const { error } = await supabase
      .from('invite_rsvps')
      .delete()
      .eq('invite_id', inviteId)
      .eq('profile_id', userId);
    if (error) throw error;
  }
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
