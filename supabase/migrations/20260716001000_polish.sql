-- Polish batch (user, 2026-07-16): bike types for the map marker, trace
-- bounds for auto-fit, live location for followers, achievements.

-- Bike type drives the trace-map marker silhouette (Duke → naked,
-- Xpulse → adv). Optional — old rows and minimalists stay null.
alter table bikes add column type text
  check (type is null or type in ('naked','sport','adv','cruiser','scrambler','tourer'));

-- Bounding box of everything the caller has ridden — the trace map opens
-- fitted to YOUR world, so it always looks full.
create or replace function trace_bounds()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select case
    when ext is null then null
    else jsonb_build_array(ST_XMin(ext), ST_YMin(ext), ST_XMax(ext), ST_YMax(ext))
  end
  from (
    select ST_Extent(geom::geometry) as ext
    from ride_tracks where profile_id = auth.uid()
  ) e;
$$;
grant execute on function trace_bounds() to authenticated;

-- ---------------------------------------------------------------------------
-- Live location. Safety feature with a stalking surface, so the gates are
-- deliberate: OFF by default, one row per rider (no history), visible to
-- ACCEPTED FOLLOWERS ONLY — public visibility does not extend here — and
-- deleted the moment the ride ends.
-- ---------------------------------------------------------------------------
create table live_positions (
  profile_id uuid primary key references profiles(id) on delete cascade,
  geom geography(POINT, 4326) not null,
  ride_started_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table live_positions enable row level security;
grant select, insert, update, delete on live_positions to authenticated;

create policy live_own on live_positions for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy live_followers_read on live_positions for select to authenticated using (
  exists (
    select 1 from follows f
    where f.followee_id = live_positions.profile_id
      and f.follower_id = auth.uid()
      and f.state = 'accepted'
  )
);

-- GeoJSON face for the client (invoker: RLS decides who sees whom).
create or replace function live_position_of(p_profile_id uuid)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'point', ST_AsGeoJSON(geom)::jsonb,
    'updated_at', updated_at,
    'ride_started_at', ride_started_at
  )
  from live_positions
  where profile_id = p_profile_id;
$$;
grant execute on function live_position_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Achievements: awarded server-side, never claimable by clients. Visible
-- wherever the profile is (own, public, followed).
-- ---------------------------------------------------------------------------
create table achievements (
  profile_id uuid not null references profiles(id) on delete cascade,
  key text not null,
  achieved_at timestamptz not null default now(),
  primary key (profile_id, key)
);

alter table achievements enable row level security;
grant select on achievements to anon, authenticated;

create policy achievements_read on achievements for select using (can_view(profile_id));

-- The award sweep: idempotent, cheap, called from the triggers below.
create or replace function award_achievements(p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  lifetime numeric;
  n_rides int;
  longest numeric;
  n_routes int;
  n_bikes int;
  n_crews int;
begin
  select coalesce(sum(current_odometer_km), 0) into lifetime from bikes where profile_id = p_profile_id;
  select count(*), coalesce(max(distance_km), 0) into n_rides, longest from rides where profile_id = p_profile_id;
  select count(*) into n_routes from routes where profile_id = p_profile_id;
  select count(*) into n_bikes from bikes where profile_id = p_profile_id;
  select count(*) into n_crews from crew_members where profile_id = p_profile_id;

  insert into achievements (profile_id, key)
  select p_profile_id, k from unnest(array[
    case when lifetime >= 100 then 'km_100' end,
    case when lifetime >= 500 then 'km_500' end,
    case when lifetime >= 1000 then 'km_1000' end,
    case when lifetime >= 5000 then 'km_5000' end,
    case when lifetime >= 10000 then 'km_10000' end,
    case when lifetime >= 25000 then 'km_25000' end,
    case when lifetime >= 50000 then 'km_50000' end,
    case when n_rides >= 1 then 'rides_1' end,
    case when n_rides >= 10 then 'rides_10' end,
    case when n_rides >= 50 then 'rides_50' end,
    case when n_rides >= 100 then 'rides_100' end,
    case when longest >= 100 then 'longest_100' end,
    case when longest >= 300 then 'longest_300' end,
    case when longest >= 500 then 'longest_500' end,
    case when n_routes >= 1 then 'routes_1' end,
    case when n_routes >= 10 then 'routes_10' end,
    case when n_bikes >= 2 then 'bikes_2' end,
    case when n_bikes >= 3 then 'bikes_3' end,
    case when n_crews >= 1 then 'crews_1' end
  ]) as k
  where k is not null
  on conflict do nothing;
end;
$$;

create or replace function trg_award()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform award_achievements(coalesce(new.profile_id, old.profile_id));
  return coalesce(new, old);
end;
$$;

create trigger trg_award_rides after insert or update of distance_km on rides
  for each row execute function trg_award();
create trigger trg_award_routes after insert on routes
  for each row execute function trg_award();
create trigger trg_award_bikes after insert or update of current_odometer_km on bikes
  for each row execute function trg_award();
create trigger trg_award_crews after insert on crew_members
  for each row execute function trg_award();
