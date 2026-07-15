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
