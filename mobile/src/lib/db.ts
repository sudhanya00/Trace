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
  difficulty: Difficulty | null;
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
    bike_category: BikeType | 'any' | null;
    gear_required: boolean | null;
    min_experience: Experience | 'any' | null;
    difficulty: Difficulty | null;
  }
): Promise<void> {
  const { error } = await supabase.from('ride_invites').insert({
    created_by: userId,
    crew_id: input.crew_id,
    title: input.title,
    meetup: input.meetup,
    region: input.region,
    starts_at: input.starts_at.toISOString(),
    bike_category: input.bike_category,
    gear_required: input.gear_required,
    min_experience: input.min_experience,
    difficulty: input.difficulty,
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

export async function upsertLivePosition(userId: string, lng: number, lat: number, rideStartedAt: number) {
  await supabase.from('live_positions').upsert({
    profile_id: userId,
    geom: `POINT(${lng} ${lat})`,
    ride_started_at: new Date(rideStartedAt).toISOString(),
    updated_at: new Date().toISOString(),
  });
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
  created_at: string;
};

/**
 * One explore stream (user + co-founder decision 2026-07-21): posts and public
 * ride invites, newest first, no tags to pick and no filters to learn. `kind`
 * is the discriminant — a ride row carries the whole invite alongside it so
 * the feed can render an RSVP without a second call.
 */
export type FeedItem =
  | ({ kind: 'post' } & Post)
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

export async function createPost(userId: string, body: string): Promise<void> {
  const { error } = await supabase.from('posts').insert({ profile_id: userId, body });
  if (error) throw error;
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
    .select('id, profile_id, body, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: author } = await supabase
    .from('profiles')
    .select('handle, avatar_url')
    .eq('id', data.profile_id)
    .maybeSingle();
  return {
    ...data,
    handle: author?.handle ?? 'rider',
    avatar_url: author?.avatar_url ?? null,
    comment_count: 0,
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

type GeoJson =
  | { type: 'MultiLineString'; coordinates: [number, number][][] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: string; coordinates?: unknown };

/** ST_Difference can hand back either shape depending on what the clip left. */
function multiLineCoords(g: GeoJson | null): [number, number][][] {
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
