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

export type BikeType = 'naked' | 'sport' | 'adv' | 'cruiser' | 'scrambler' | 'tourer';

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
  type: BikeType | null;
  nickname: string | null;
  created_at: string;
};

/** "KAALI" leads when the bike has a name; the model rides pillion. */
export function bikeTitle(b: Pick<Bike, 'nickname' | 'make' | 'model'>): string {
  return b.nickname?.trim() ? b.nickname.trim() : `${b.make} ${b.model}`;
}

export function bikeSubtitle(b: Pick<Bike, 'nickname' | 'make' | 'model' | 'year'>): string {
  const parts = b.nickname?.trim() ? [`${b.make} ${b.model}`] : [];
  if (b.year) parts.push(String(b.year));
  return parts.join(' · ');
}

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
  /** The one crew this ride counts toward, or null for none. */
  crew_id: string | null;
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
  type: BikeType | null;
  nickname: string | null;
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

/**
 * A Route is a plan — something you can go ride. (A Ride is history: something
 * a rider did.) Route standardization, 2026-07-24: one entity, three origins.
 *
 *  - `curated` — editorial, no owner, the discovery catalogue (admin-authored)
 *  - `user`    — a rider promoted one of their traces into a reusable route
 *  - `adhoc`   — created inline by Plan-a-ride when no route was picked, so
 *                every planned ride references a real Route and never a null
 */
export type RouteSource = 'curated' | 'user' | 'adhoc';
export type RouteVisibility = 'public' | 'crew' | 'private';

export type Route = {
  id: string;
  profile_id: string | null; // null for curated
  source_ride_id: string | null;
  source: RouteSource;
  visibility: RouteVisibility;
  name: string;
  region: string | null;
  difficulty: Difficulty | null;
  description: string | null;
  terrain_tags: string[] | null;
  distance_km: number;
  photo_url: string | null;
  created_at: string;
};

/** The columns every route read needs. One place so a schema change is one edit. */
const ROUTE_COLS =
  'id, profile_id, source_ride_id, source, visibility, name, region, difficulty, description, terrain_tags, distance_km, photo_url, created_at';

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
    region?: string | null;
    difficulty?: Difficulty | null;
  }
): Promise<Route> {
  const coords = input.segments.flat();
  if (coords.length < 2) throw new Error('This ride has no track to share.');
  const wkt = `LINESTRING(${coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`;
  const { data, error } = await supabase
    .from('routes')
    .insert({
      profile_id: userId,
      // Explicit, never defaulted: a route created here is a rider deliberately
      // sharing a ride, so it's a public `user` route. Profile privacy still
      // gates who can actually see it (can_view, server-side).
      source: 'user',
      visibility: 'public',
      source_ride_id: input.source_ride_id,
      name: input.name,
      region: input.region ?? null,
      difficulty: input.difficulty ?? null,
      description: input.description,
      terrain_tags: input.terrain_tags.length ? input.terrain_tags : null,
      distance_km: input.distance_km,
      geom: wkt,
    })
    .select(ROUTE_COLS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * The route a planned ride points at. When the rider picked one, that's it;
 * when they just named the ride, this creates the `adhoc` row that keeps
 * PlannedRide.route_id non-null and holds the name/region/difficulty.
 */
export async function createAdhocRoute(
  userId: string,
  input: {
    name: string;
    region: string | null;
    difficulty: Difficulty | null;
    crew_id: string | null;
  }
): Promise<string> {
  const { data, error } = await supabase
    .from('routes')
    .insert({
      profile_id: userId,
      source: 'adhoc',
      // A crew ride's route is crew-scoped; a board ride's is public. The
      // server refuses a route the destination can't legally show.
      visibility: input.crew_id ? 'crew' : 'public',
      crew_id: input.crew_id,
      name: input.name,
      region: input.region,
      difficulty: input.difficulty,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/**
 * Save a planned route. The WAYPOINTS are what persist — the rider's own
 * coordinates plus place IDs, which Google's terms permit indefinitely. The
 * computed line is never stored; it's recomputed from these whenever the route
 * needs drawing. distance_km is kept because it's a fact about the road, not
 * Google's content, and a route list without distances is useless.
 */
export async function createPlannedRoute(
  userId: string,
  input: {
    name: string;
    region: string | null;
    difficulty: Difficulty | null;
    waypoints: { lat: number; lng: number; place_id: string | null; label: string }[];
    distance_km: number;
    crew_id: string | null;
  }
): Promise<Route> {
  const first = input.waypoints[0];
  const last = input.waypoints[input.waypoints.length - 1];
  const { data, error } = await supabase
    .from('routes')
    .insert({
      profile_id: userId,
      source: 'user',
      visibility: input.crew_id ? 'crew' : 'public',
      crew_id: input.crew_id,
      geom_provider: 'google',
      name: input.name,
      region: input.region,
      difficulty: input.difficulty,
      waypoints: input.waypoints,
      distance_km: input.distance_km,
      // Endpoint labels so "Jammu → Patnitop" renders without a lookup —
      // several routes share endpoints and differ only in the road between.
      start_label: first?.label ?? null,
      end_label: last?.label ?? null,
      start_place_id: first?.place_id ?? null,
      end_place_id: last?.place_id ?? null,
    })
    .select(ROUTE_COLS)
    .single();
  if (error) throw error;
  return data;
}

/** Routes a rider can pick from when planning: their own, then curated. */
export async function pickableRoutes(userId: string): Promise<{
  mine: Route[];
  curated: Route[];
}> {
  const [mine, curated] = await Promise.all([
    supabase
      .from('routes')
      .select(ROUTE_COLS)
      .eq('profile_id', userId)
      .eq('source', 'user')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('routes')
      .select(ROUTE_COLS)
      .eq('source', 'curated')
      .order('name')
      .limit(50),
  ]);
  if (mine.error) throw mine.error;
  if (curated.error) throw curated.error;
  return { mine: mine.data ?? [], curated: curated.data ?? [] };
}

export async function getRoute(id: string): Promise<Route | null> {
  // Own routes come straight off the table; someone else's come through the
  // privacy-clipped public view. Same shape either way.
  const own = await supabase
    .from('routes')
    .select(ROUTE_COLS)
    .eq('id', id)
    .maybeSingle();
  if (own.error) throw own.error;
  if (own.data) return own.data;
  const pub = await supabase
    .from('routes_public')
    .select(ROUTE_COLS)
    .eq('id', id)
    .maybeSingle();
  if (pub.error) throw pub.error;
  return pub.data;
}

export async function routeForRide(rideId: string): Promise<Route | null> {
  const { data, error } = await supabase
    .from('routes')
    .select(ROUTE_COLS)
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

/**
 * Retire one of your routes.
 *
 * Through an RPC rather than an update, and not by preference: a plain
 * `update routes set deleted_at` is refused by Postgres, because it applies the
 * SELECT policy to the new row and routes_read hides anything deleted — you
 * cannot update a row into a state where you can no longer see it. The rule
 * about planned rides that still point at the road lives in the same function,
 * where it decides rather than advises. See 20260805000200.
 *
 * The messages raised there are written to be shown to a rider as they are.
 */
export async function deleteRoute(routeId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_own_route', { p_route_id: routeId });
  if (error) throw error;
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

/**
 * A rider's saved roads, for their profile.
 *
 * Adhoc routes are excluded on purpose: every planned ride mints one behind
 * the scenes to carry its name, so listing them would fill the tab with a
 * shadow copy of the ride board rather than roads anyone chose to keep.
 */
export async function listRiderRoutes(profileId: string): Promise<Route[]> {
  const { data, error } = await supabase
    .from('routes_public')
    .select(ROUTE_COLS)
    .eq('profile_id', profileId)
    .neq('source', 'adhoc')
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
  is_private: boolean;
  on_leaderboard: boolean;
  created_at: string;
  member_count?: number;
};

export type CrewMessage = {
  id: string;
  profile_id: string;
  handle: string;
  body: string;
  /**
   * 'chat' is typed by a rider. 'contribution' and 'live_share' are events
   * written server-side — the client is refused any kind but chat.
   */
  kind: 'chat' | 'contribution' | 'live_share';
  ride_id: string | null;
  distance_km: number | null;
  created_at: string;
};

export type CrewMember = {
  profile_id: string;
  handle: string;
  display_name: string | null;
  role: 'admin' | 'member';
  joined_at: string;
  state: 'pending' | 'active';
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
  input: {
    name: string;
    region: string | null;
    description: string | null;
    is_private: boolean;
    on_leaderboard: boolean;
  }
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

/** What a planned ride asks for, and what a joiner answers back. */
export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type Difficulty = 'easy' | 'moderate' | 'hard' | 'expert';

export const EXPERIENCE: Experience[] = ['beginner', 'intermediate', 'advanced'];
export const DIFFICULTY: Difficulty[] = ['easy', 'moderate', 'hard', 'expert'];
export const BIKE_TYPES: BikeType[] = ['naked', 'sport', 'adv', 'cruiser', 'scrambler', 'tourer'];

export type RideInvite = {
  id: string;
  created_by: string;
  handle: string;
  avatar_url: string | null;
  crew_id: string | null;
  route_id: string | null;
  title: string;
  meetup: string | null;
  region: string | null;
  starts_at: string;
  rsvp_count: number;
  i_am_in: boolean;
  // What the ride asks. Null means the creator didn't ask — and what wasn't
  // asked is never put to the joiner either.
  bike_category: BikeType | 'any' | null;
  gear_required: boolean | null;
  min_experience: Experience | 'any' | null;
  /** From the joined Route — difficulty is a property of the road. */
  difficulty: Difficulty | null;
  /** The route's shape and length, when it has geometry (adhoc routes don't). */
  route_geom: GeoJson | null;
  route_distance_km: number | null;
  /** The navigable meeting point, when the creator pinned one. */
  meetup_lat: number | null;
  meetup_lng: number | null;
  meetup_place_id: string | null;
  // The caller's own answers, when they've RSVP'd.
  my_bike_category: BikeType | null;
  my_has_gear: boolean | null;
  my_experience: Experience | null;
};

/** A joiner's answers to whatever the ride asked. */
export type RsvpAnswers = {
  bike_category?: BikeType | null;
  has_gear?: boolean | null;
  experience?: Experience | null;
};

/** Which questions a ride actually puts to a joiner — the creator's choice. */
export function inviteAsks(i: RideInvite): (keyof RsvpAnswers)[] {
  const asks: (keyof RsvpAnswers)[] = [];
  if (i.bike_category) asks.push('bike_category');
  if (i.gear_required != null) asks.push('has_gear');
  if (i.min_experience) asks.push('experience');
  return asks;
}

/** One planned ride in full — the detail page's shape. */
export type InviteDetail = RideInvite & {
  crew_name: string | null;
  description: string | null;
  route_name: string | null;
  created_at: string;
  i_created_it: boolean;
};

export async function getInvite(inviteId: string): Promise<InviteDetail | null> {
  const { data, error } = await supabase.rpc('invite_detail', { p_invite_id: inviteId });
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) return null;
  return { ...row, rsvp_count: Number(row.rsvp_count) };
}

/** Cancel a ride you planned. Everyone's RSVPs go with it. */
export async function deleteInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.from('ride_invites').delete().eq('id', inviteId);
  if (error) throw error;
}

/** Upcoming invites: the public board (crewId null) or one crew's. */
export async function listInvites(crewId: string | null): Promise<RideInvite[]> {
  const { data, error } = await supabase.rpc('invite_list', { p_crew_id: crewId });
  if (error) throw error;
  return (data ?? []).map((i: RideInvite & { rsvp_count: number | string }) => ({
    ...i,
    rsvp_count: Number(i.rsvp_count),
  }));
}

/**
 * Post a planned ride. Every one references a real Route: either the one the
 * rider picked, or an `adhoc` route created here from what they typed. That
 * is what makes ride_invites.route_id non-null — no ride is ever just words.
 */
export async function createInvite(
  userId: string,
  input: {
    crew_id: string | null;
    route_id: string | null; // null = they just named it
    title: string;
    description: string | null;
    meetup: string | null;
    /** The navigable point behind the meetup line, when the rider set one. */
    meetup_point: { lat: number; lng: number; place_id: string | null } | null;
    region: string | null;
    starts_at: Date;
    bike_category: BikeType | 'any' | null;
    gear_required: boolean | null;
    min_experience: Experience | 'any' | null;
    difficulty: Difficulty | null;
  }
): Promise<void> {
  const routeId =
    input.route_id ??
    (await createAdhocRoute(userId, {
      name: input.title,
      region: input.region,
      difficulty: input.difficulty,
      crew_id: input.crew_id,
    }));

  const { error } = await supabase.from('ride_invites').insert({
    created_by: userId,
    crew_id: input.crew_id,
    route_id: routeId,
    title: input.title,
    description: input.description,
    meetup: input.meetup,
    meetup_lat: input.meetup_point?.lat ?? null,
    meetup_lng: input.meetup_point?.lng ?? null,
    meetup_place_id: input.meetup_point?.place_id ?? null,
    region: input.region,
    starts_at: input.starts_at.toISOString(),
    bike_category: input.bike_category,
    gear_required: input.gear_required,
    min_experience: input.min_experience,
    // difficulty lives on the Route now, not here.
  });
  if (error) throw error;
}

/** Join or drop out. Answers upsert so a rider can change their bike or
 *  correct themselves without leaving and rejoining. */
export async function rsvpInvite(
  userId: string,
  inviteId: string,
  going: boolean,
  answers: RsvpAnswers = {}
): Promise<void> {
  if (going) {
    const { error } = await supabase
      .from('invite_rsvps')
      .upsert(
        { invite_id: inviteId, profile_id: userId, ...answers },
        { onConflict: 'invite_id,profile_id' }
      );
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('invite_rsvps')
      .delete()
      .eq('invite_id', inviteId)
      .eq('profile_id', userId);
    if (error) throw error;
  }
}

/** My trace's bounding box [w,s,e,n] — the map opens fitted to YOUR world. */
export async function traceBounds(): Promise<[number, number, number, number] | null> {
  const { data, error } = await supabase.rpc('trace_bounds');
  if (error) throw error;
  return data as [number, number, number, number] | null;
}

export async function upsertLivePosition(
  userId: string,
  lng: number,
  lat: number,
  rideStartedAt: number,
  sharedCrewIds: string[]
) {
  await supabase.from('live_positions').upsert({
    profile_id: userId,
    geom: `POINT(${lng} ${lat})`,
    ride_started_at: new Date(rideStartedAt).toISOString(),
    // Written every cycle: the rider's chosen audience travels with the
    // position, so turning sharing off mid-ride takes effect immediately.
    shared_crew_ids: sharedCrewIds,
    updated_at: new Date().toISOString(),
  });
}

/** Tell the chosen crews you've set off. Once, when sharing is switched on. */
export async function announceLiveShare(crewIds: string[]): Promise<void> {
  if (crewIds.length === 0) return;
  const { error } = await supabase.rpc('announce_live_share', { p_crew_ids: crewIds });
  if (error) throw error;
}

/** Riders currently out and sharing with this crew. Empties itself: nothing
 *  older than 15 minutes counts as live. */
export type LiveRider = {
  profile_id: string;
  handle: string;
  avatar_url: string | null;
  point: { type: 'Point'; coordinates: [number, number] };
  ride_started_at: string | null;
  updated_at: string;
};

export async function crewLiveRiders(crewId: string): Promise<LiveRider[]> {
  const { data, error } = await supabase.rpc('crew_live_riders', { p_crew_id: crewId });
  if (error) throw error;
  return data ?? [];
}

export async function clearLivePosition(userId: string) {
  await supabase.from('live_positions').delete().eq('profile_id', userId);
}

export type LivePosition = {
  point: { type: 'Point'; coordinates: [number, number] };
  updated_at: string;
  ride_started_at: string | null;
};

export async function livePositionOf(profileId: string): Promise<LivePosition | null> {
  const { data, error } = await supabase.rpc('live_position_of', { p_profile_id: profileId });
  if (error) throw error;
  return data;
}

export async function listAchievements(profileId: string): Promise<{ key: string; achieved_at: string }[]> {
  const { data, error } = await supabase
    .from('achievements')
    .select('key, achieved_at')
    .eq('profile_id', profileId)
    .order('achieved_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Approve a pending member (admin). Decline = declineCrewRequest. */
export async function approveCrewMember(crewId: string, profileId: string): Promise<void> {
  const { error } = await supabase
    .from('crew_members')
    .update({ state: 'active' })
    .eq('crew_id', crewId)
    .eq('profile_id', profileId);
  if (error) throw error;
}

export async function declineCrewRequest(crewId: string, profileId: string): Promise<void> {
  const { error } = await supabase
    .from('crew_members')
    .delete()
    .eq('crew_id', crewId)
    .eq('profile_id', profileId);
  if (error) throw error;
}

/** The caller's own membership row for one crew (any state), if it exists. */
export async function myMembership(
  userId: string,
  crewId: string
): Promise<{ state: 'pending' | 'active'; role: string } | null> {
  const { data, error } = await supabase
    .from('crew_members')
    .select('state, role')
    .eq('crew_id', crewId)
    .eq('profile_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type Post = {
  id: string;
  profile_id: string;
  handle: string;
  avatar_url: string | null;
  body: string;
  comment_count: number;
  like_count: number;
  i_liked: boolean;
  created_at: string;
  /** Set when this post repeats another one. */
  repost_of: string | null;
  repost_handle: string | null;
  repost_body: string | null;
  /** Set when this post is a ride the rider shared. */
  ride_id: string | null;
  ride_distance_km: number | null;
};

/**
 * One explore stream (user + co-founder decision 2026-07-21): posts and public
 * ride invites, newest first, no tags to pick and no filters to learn. `kind`
 * is the discriminant — a ride row carries the whole invite alongside it so
 * the feed can render an RSVP without a second call.
 */
export type FeedItem =
  | ({ kind: 'post' } & Post & {
      ride_started_at: string | null;
      ride_geom: GeoJson | null;
    })
  | ({ kind: 'ride' } & Post & {
      title: string;
      meetup: string | null;
      region: string | null;
      starts_at: string;
      rsvp_count: number;
      i_am_in: boolean;
      bike_category: BikeType | 'any' | null;
      gear_required: boolean | null;
      min_experience: Experience | 'any' | null;
      difficulty: Difficulty | null;
    });

export async function exploreFeed(before?: string): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc('explore_feed', { p_before: before ?? null });
  if (error) throw error;
  return (data ?? []).map((r: FeedItem & { comment_count: number | string; rsvp_count?: number | string }) => ({
    ...r,
    comment_count: Number(r.comment_count),
    ...(r.kind === 'ride' ? { rsvp_count: Number(r.rsvp_count) } : {}),
  }));
}

/** A rider's own posts, for the profile Posts tab. */
export async function postsOf(profileId: string, before?: string): Promise<Post[]> {
  const { data, error } = await supabase.rpc('posts_of', {
    p_profile_id: profileId,
    p_before: before ?? null,
  });
  if (error) throw error;
  return (data ?? []).map((p: Post & { comment_count: number | string }) => ({
    ...p,
    comment_count: Number(p.comment_count),
  }));
}

export async function createPost(
  userId: string,
  body: string,
  extra: { ride_id?: string | null; repost_of?: string | null } = {}
): Promise<void> {
  const { error } = await supabase.from('posts').insert({ profile_id: userId, body, ...extra });
  if (error) throw error;
}

/** Like is an identity, not a counter — insert/delete, never increment. */
export async function likePost(userId: string, postId: string): Promise<void> {
  const { error } = await supabase
    .from('post_likes')
    .insert({ post_id: postId, profile_id: userId });
  if (error && error.code !== '23505') throw error; // already liked is fine
}

export async function unlikePost(userId: string, postId: string): Promise<void> {
  const { error } = await supabase
    .from('post_likes')
    .delete()
    .eq('post_id', postId)
    .eq('profile_id', userId);
  if (error) throw error;
}

/** Repeat someone's post. An empty body is a plain repost; text quotes it. */
export async function repost(userId: string, postId: string, body = ''): Promise<void> {
  return createPost(userId, body, { repost_of: postId });
}

/** Put a ride on the feed. Visibility follows the profile, like any post. */
export async function shareRideAsPost(
  userId: string,
  rideId: string,
  body = ''
): Promise<void> {
  return createPost(userId, body, { ride_id: rideId });
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) throw error;
}

export async function getPost(id: string): Promise<Post | null> {
  // One feed call scoped by nothing returns newest 30; a single post needs its
  // own fetch + handle. Reuse the thread function's visibility via posts table.
  const { data, error } = await supabase
    .from('posts')
    .select('id, profile_id, body, created_at, repost_of, ride_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // The counts have to be real here: this row feeds the action row, and a
  // like button that renders "undefined" is worse than no like button.
  const [{ data: author }, { data: likes }, { data: mine }, { data: comments }] = await Promise.all([
    supabase.from('profiles').select('handle, avatar_url').eq('id', data.profile_id).maybeSingle(),
    supabase.from('post_likes').select('profile_id').eq('post_id', id),
    supabase.auth.getSession(),
    supabase.from('post_comments').select('id').eq('post_id', id),
  ]);
  const uid = mine.session?.user.id;

  let repost_handle: string | null = null;
  let repost_body: string | null = null;
  if (data.repost_of) {
    const { data: orig } = await supabase
      .from('posts')
      .select('body, profile_id')
      .eq('id', data.repost_of)
      .maybeSingle();
    if (orig) {
      repost_body = orig.body;
      const { data: op } = await supabase
        .from('profiles')
        .select('handle')
        .eq('id', orig.profile_id)
        .maybeSingle();
      repost_handle = op?.handle ?? null;
    }
  }

  let ride_distance_km: number | null = null;
  if (data.ride_id) {
    const { data: r } = await supabase
      .from('rides')
      .select('distance_km')
      .eq('id', data.ride_id)
      .maybeSingle();
    ride_distance_km = r ? Number(r.distance_km) : null;
  }

  return {
    ...data,
    handle: author?.handle ?? 'rider',
    avatar_url: author?.avatar_url ?? null,
    comment_count: comments?.length ?? 0,
    like_count: likes?.length ?? 0,
    i_liked: !!uid && (likes ?? []).some((l) => l.profile_id === uid),
    repost_handle,
    repost_body,
    ride_distance_km,
  } as Post;
}

export type PostComment = {
  id: string;
  profile_id: string;
  handle: string;
  body: string;
  created_at: string;
};

export async function postThread(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase.rpc('post_thread', { p_post_id: postId });
  if (error) throw error;
  return data ?? [];
}

export async function addPostComment(userId: string, postId: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('post_comments')
    .insert({ post_id: postId, profile_id: userId, body });
  if (error) throw error;
}

export async function deletePostComment(id: string): Promise<void> {
  const { error } = await supabase.from('post_comments').delete().eq('id', id);
  if (error) throw error;
}

export async function flagPost(userId: string, postId: string): Promise<void> {
  const { error } = await supabase
    .from('content_reports')
    .insert({ reporter_id: userId, post_id: postId });
  if (error) throw error;
}

export type SuggestedRider = {
  id: string;
  handle: string;
  display_name: string | null;
  home_region: string | null;
  reason: string;
};

export async function suggestedRiders(): Promise<SuggestedRider[]> {
  const { data, error } = await supabase.rpc('suggested_riders');
  if (error) throw error;
  return data ?? [];
}

export type RiderCrew = {
  id: string;
  name: string;
  region: string | null;
  is_private: boolean;
  on_leaderboard: boolean;
  role: string;
  member_count: number;
};

export async function crewsOf(profileId: string): Promise<RiderCrew[]> {
  const { data, error } = await supabase.rpc('crews_of', { p_profile_id: profileId });
  if (error) throw error;
  return (data ?? []).map((c: RiderCrew & { member_count: number | string }) => ({
    ...c,
    member_count: Number(c.member_count),
  }));
}

/**
 * The three boards, one call: riders, lifetime km, today's km. Opt-in per crew
 * — a crew that hasn't joined the board isn't in this list at all, public or
 * private. Distance is an aggregate over active members; no ride is exposed.
 */
export type LeaderboardCrew = {
  id: string;
  name: string;
  region: string | null;
  is_private: boolean;
  member_count: number;
  lifetime_km: number;
  today_km: number;
  i_am_in: boolean;
};

export async function crewLeaderboard(): Promise<LeaderboardCrew[]> {
  const { data, error } = await supabase.rpc('crew_leaderboard');
  if (error) throw error;
  return (data ?? []).map((c: Record<string, unknown>) => ({
    ...(c as unknown as LeaderboardCrew),
    member_count: Number(c.member_count),
    lifetime_km: Number(c.lifetime_km),
    today_km: Number(c.today_km),
  }));
}

/** Admin-only by RLS: the crew decides once whether it competes. */
export async function setCrewLeaderboard(crewId: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('crews').update({ on_leaderboard: on }).eq('id', crewId);
  if (error) throw error;
}

/** The profile header's numbers, one call. */
export type ProfileStats = {
  total_km: number;
  ride_count: number;
  bike_count: number;
  crew_count: number;
  follower_count: number;
  following_count: number;
};

export async function profileStats(profileId: string): Promise<ProfileStats> {
  const { data, error } = await supabase.rpc('profile_stats', { p_profile_id: profileId });
  if (error) throw error;
  const row = (data ?? [])[0];
  const n = (v: unknown) => Number(v ?? 0);
  return {
    total_km: n(row?.total_km),
    ride_count: n(row?.ride_count),
    bike_count: n(row?.bike_count),
    crew_count: n(row?.crew_count),
    follower_count: n(row?.follower_count),
    following_count: n(row?.following_count),
  };
}

/**
 * Attribute a ride to one of the rider's crews, or to none. Enforced server
 * side too: the rides policy refuses a crew you aren't an active member of.
 */
/**
 * The line for a route, however that route happens to hold its shape.
 *
 * A recorded or curated route has real geometry stored. A route planned
 * through Google has only its waypoints — storing their computed line isn't
 * permitted — so it gets recomputed here on demand. Callers don't need to
 * know which kind they're holding.
 */
export async function routeLine(routeId: string): Promise<[number, number][][]> {
  const stored = await publicRouteSegments(routeId).catch(() => null);
  if (stored?.length) return stored;

  // Through the accessor, never off the table: waypoints are raw positions, so
  // another rider gets them with the owner's privacy zones taken out. Reading
  // the column directly would hand back the doorstep the zone exists to hide.
  const { data } = await supabase.rpc('route_waypoints', { p_route_id: routeId });
  const wp = (data ?? []) as { lat: number; lng: number }[];
  if (wp.length < 2) return [];

  const { planRoute } = await import('./geo-api');
  const options = await planRoute(
    wp.map((w) => [w.lng, w.lat] as [number, number]),
    { alternatives: false }
  );
  return options[0]?.coordinates.length ? [options[0].coordinates] : [];
}

/** A planned ride the rider has RSVP'd to and could be starting right now. */
export type UpcomingRide = {
  id: string;
  title: string;
  starts_at: string;
  crew_id: string | null;
  route_id: string;
  meetup: string | null;
};

/** Asked once when recording starts: "is this the Sunday run?" */
export async function myUpcomingRides(): Promise<UpcomingRide[]> {
  const { data, error } = await supabase.rpc('my_upcoming_rides');
  if (error) throw error;
  return data ?? [];
}

/** Who actually rode a planned ride — RSVPs are intent, this is the record. */
export type InviteRider = {
  profile_id: string;
  handle: string;
  avatar_url: string | null;
  rsvpd: boolean;
  ride_id: string | null;
  distance_km: number | null;
};

export async function inviteRiders(inviteId: string): Promise<InviteRider[]> {
  const { data, error } = await supabase.rpc('invite_riders', { p_invite_id: inviteId });
  if (error) throw error;
  return (data ?? []).map((r: InviteRider) => ({
    ...r,
    distance_km: r.distance_km == null ? null : Number(r.distance_km),
  }));
}

/** Attach an already-synced ride to a planned ride (or detach it). */
export async function setRidePlannedRide(
  rideId: string,
  plannedRideId: string | null
): Promise<void> {
  const { error } = await supabase
    .from('rides')
    .update({ planned_ride_id: plannedRideId })
    .eq('id', rideId);
  if (error) throw error;
}

/** Members of a crew, ordered by what they have contributed to it. */
export type CrewContributor = {
  profile_id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  role: 'admin' | 'member';
  state: 'active' | 'pending';
  ride_count: number;
  total_km: number;
};

export async function crewMemberContributions(crewId: string): Promise<CrewContributor[]> {
  const { data, error } = await supabase.rpc('crew_member_contributions', { p_crew_id: crewId });
  if (error) throw error;
  return (data ?? []).map((m: Record<string, unknown>) => ({
    ...(m as unknown as CrewContributor),
    ride_count: Number(m.ride_count),
    total_km: Number(m.total_km),
  }));
}

/** Owner-scoped by RLS; the geometry and any contribution line go with it. */
export async function deleteRide(rideId: string): Promise<void> {
  const { error } = await supabase.from('rides').delete().eq('id', rideId);
  if (error) throw error;
}

/** Admin-only by RLS. Takes the roster, the chat and the crew's invites. */
export async function deleteCrew(crewId: string): Promise<void> {
  const { error } = await supabase.from('crews').delete().eq('id', crewId);
  if (error) throw error;
}

export async function setRideCrew(rideId: string, crewId: string | null): Promise<void> {
  const { error } = await supabase.from('rides').update({ crew_id: crewId }).eq('id', rideId);
  if (error) throw error;
}

/** What this rider has given each of their crews so far. */
export async function myCrewContributions(): Promise<
  Map<string, { ride_count: number; total_km: number }>
> {
  const { data, error } = await supabase.rpc('my_crew_contributions');
  if (error) throw error;
  const out = new Map<string, { ride_count: number; total_km: number }>();
  for (const r of (data ?? []) as { crew_id: string; ride_count: number; total_km: number }[]) {
    out.set(r.crew_id, { ride_count: Number(r.ride_count), total_km: Number(r.total_km) });
  }
  return out;
}

/** Track shapes for a rider's ride list, one call. Simplified server-side and
 *  drawn as SVG — see TrackThumb for why this isn't a map. */
export async function rideThumbs(profileId: string): Promise<Map<string, [number, number][][]>> {
  const { data, error } = await supabase.rpc('ride_thumbs', { p_profile_id: profileId });
  if (error) throw error;
  const out = new Map<string, [number, number][][]>();
  for (const row of (data ?? []) as { ride_id: string; geom: GeoJson | null }[]) {
    const segs = multiLineCoords(row.geom);
    if (segs.length) out.set(row.ride_id, segs);
  }
  return out;
}

export type GeoJson =
  | { type: 'MultiLineString'; coordinates: [number, number][][] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: string; coordinates?: unknown };

/** ST_Difference can hand back either shape depending on what the clip left. */
export function multiLineCoords(g: GeoJson | null): [number, number][][] {
  if (!g) return [];
  if (g.type === 'MultiLineString') return (g as { coordinates: [number, number][][] }).coordinates;
  if (g.type === 'LineString') return [(g as { coordinates: [number, number][] }).coordinates];
  return [];
}

/** Avatar upload — own-folder bucket, same shape as route photos. Cache-busted
 *  on read: the path is stable, so a replaced face needs the query string. */
export async function uploadAvatar(userId: string, bytes: ArrayBuffer): Promise<string> {
  const path = `${userId}/avatar.jpg`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  return `${url}?v=${Date.now()}`;
}

/**
 * Ride AI — discovery.
 *
 * The warning codes are decided server-side against columns (see
 * `20260726001000`), never by a model and never here. The client's only job is
 * to render them; the copy lives in DiscoverCard so the design system owns the
 * words. A code the client doesn't recognise is dropped rather than shown raw —
 * a new rule shipping ahead of its copy should say nothing, not leak an
 * identifier at a rider.
 */
export type RouteWarning =
  | 'high_pass'
  | 'out_of_season'
  | 'seasonal_gate'
  | 'no_signal'
  | 'above_your_altitude'
  | 'beyond_your_longest';

export type DiscoveredRoute = {
  route_id: string;
  name: string;
  region: string | null;
  description: string | null;
  distance_km: number | null;
  difficulty: Difficulty | null;
  terrain_tags: string[] | null;
  max_altitude_m: number | null;
  est_duration_minutes: number | null;
  network_coverage: string | null;
  road_status: string | null;
  /** How many riders have actually ridden it. 0 means unverified, not bad. */
  riders_count: number;
  last_condition: string | null;
  last_condition_at: string | null;
  warnings: RouteWarning[];
  score: number;
};

/** Roads worth riding near somewhere, ranked against who the caller is. */
export async function discoverRoutes(opts?: {
  region?: string | null;
  when?: Date | null;
  limit?: number;
}): Promise<DiscoveredRoute[]> {
  const { data, error } = await supabase.rpc('discover_routes', {
    p_region: opts?.region ?? null,
    p_when: opts?.when ? opts.when.toISOString() : null,
    p_limit: opts?.limit ?? 20,
  });
  if (error) throw error;
  return (data ?? []) as DiscoveredRoute[];
}

/**
 * Ride AI — the conversation.
 *
 * `contents` is Gemini's own turn shape, kept opaque here on purpose: the
 * client stores what the function hands back and returns it next turn, without
 * knowing what a `functionCall` part is. That keeps the provider's vocabulary
 * inside the edge function, where swapping it is one file.
 *
 * `routes` is every road the model actually looked up, so the UI can render
 * the real cards — badges and warnings drawn from data rather than from the
 * model's prose.
 */
export type RideAiTurn = { role: 'user' | 'model'; parts: unknown[] };

export type RideAiReply = {
  reply: string;
  contents: RideAiTurn[];
  routes: DiscoveredRoute[];
};

export async function askRideAI(contents: RideAiTurn[]): Promise<RideAiReply> {
  const { data, error } = await supabase.functions.invoke('ride-ai', {
    body: { contents },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return {
    reply: data?.reply ?? '',
    contents: data?.contents ?? contents,
    routes: data?.routes ?? [],
  };
}

/**
 * Delete the rider's account, and everything hanging off it.
 *
 * Order matters and only runs one way. Storage first, because buckets are not
 * tables and nothing cascades into them — the rider's own delete policy is
 * scoped to their folder, so this is the last moment anyone can clear it. The
 * database goes last: `delete_own_account` removes the auth row, every table
 * cascades from it, and the session it was called with stops existing.
 *
 * A failure to clear a photo does not stop the deletion. Leaving a rider
 * unable to delete their account because a bucket listing timed out would be
 * the worse outcome, and an orphaned JPEG is not what they asked us to forget.
 */
export async function deleteOwnAccount(userId: string): Promise<void> {
  for (const bucket of ['avatars', 'route-photos'] as const) {
    try {
      const { data } = await supabase.storage.from(bucket).list(userId);
      if (data?.length) {
        await supabase.storage.from(bucket).remove(data.map((f) => `${userId}/${f.name}`));
      }
    } catch {
      // see above — never block the deletion on a file
    }
  }

  const { error } = await supabase.rpc('delete_own_account');
  if (error) throw error;

  // The account is gone; the local session is now a key to nothing.
  await supabase.auth.signOut().catch(() => {});
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
