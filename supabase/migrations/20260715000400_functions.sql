-- Privacy-zone clipping, server-side distance, odometer sync.

-- ---------------------------------------------------------------------------
-- Privacy-zone clipping (§3). Applied at READ time — the rider's own stored
-- data is never modified.
--
-- Differences from the spec's sketch, both flagged in the build summary:
--   1. visibility check — without it, anyone holding a ride id could pull a
--      private profile's (clipped) track. The function refuses unless the
--      owner is public or the caller is the owner.
--   2. security definer — callers cannot read these tables directly (RLS is
--      owner-only on raw geometry), so the clipped accessor must run with
--      elevated rights and do its own authorization.
-- ---------------------------------------------------------------------------
create or replace function public_track_geom(p_ride_id uuid)
returns geometry
language sql stable security definer set search_path = public as $$
  select ST_Difference(
    t.geom::geometry,
    coalesce((
      select ST_Union(z.area::geometry)
      from privacy_zones z where z.profile_id = t.profile_id
    ), 'POLYGON EMPTY'::geometry)
  )
  from ride_tracks t
  join profiles p on p.id = t.profile_id
  where t.ride_id = p_ride_id
    and (p.visibility = 'public' or t.profile_id = auth.uid());
$$;

-- Same clipping for route geometry (§3: "Same clipping must apply to
-- routes.geom on any public read").
create or replace function public_route_geom(p_route_id uuid)
returns geometry
language sql stable security definer set search_path = public as $$
  select ST_Difference(
    r.geom::geometry,
    coalesce((
      select ST_Union(z.area::geometry)
      from privacy_zones z where z.profile_id = r.profile_id
    ), 'POLYGON EMPTY'::geometry)
  )
  from routes r
  join profiles p on p.id = r.profile_id
  where r.id = p_route_id
    and (p.visibility = 'public' or r.profile_id = auth.uid());
$$;

revoke all on function public_track_geom(uuid) from public;
revoke all on function public_route_geom(uuid) from public;
grant execute on function public_track_geom(uuid) to anon, authenticated;
grant execute on function public_route_geom(uuid) to anon, authenticated;

-- Route discovery surface: public-profile routes with clipped geometry.
-- The view runs as its owner (not the caller), which is what lets it read
-- past owner-only RLS — its WHERE clause is the authorization.
create view routes_public as
  select
    r.id,
    r.profile_id,
    r.source_ride_id,
    r.name,
    r.description,
    r.terrain_tags,
    r.distance_km,
    public_route_geom(r.id) as geom,
    r.photo_url,
    r.created_at
  from routes r
  join profiles p on p.id = r.profile_id
  where p.visibility = 'public';

grant select on routes_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Server-side distance (§4): client numbers drift, so distance_km is computed
-- here from the geometry. ST_Length over a MULTILINESTRING geography sums the
-- segments — gap distance is excluded by construction.
-- ---------------------------------------------------------------------------
create or replace function compute_ride_distance()
returns trigger language plpgsql as $$
begin
  update rides
  set distance_km = round((ST_Length(new.geom) / 1000.0)::numeric, 2)
  where id = new.ride_id;
  return new;
end;
$$;

create trigger trg_ride_track_distance
after insert or update of geom on ride_tracks
for each row execute function compute_ride_distance();

-- ---------------------------------------------------------------------------
-- Odometer sync: the garage odometer moves with logged rides (concept doc).
-- bikes.current_odometer_km starts at whatever the rider enters when adding
-- the bike, then every ride's distance_km is added on top. Delta-based so
-- manual rides (§12b — distance, no track) count exactly the same way.
-- Runs with invoker rights: RLS on bikes still applies, so a ride can only
-- ever move the odometer of a bike the same rider owns.
-- ---------------------------------------------------------------------------
create or replace function sync_bike_odometer()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.bike_id is not null then
      update bikes set current_odometer_km = current_odometer_km + new.distance_km
      where id = new.bike_id;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.bike_id is distinct from new.bike_id
       or old.distance_km is distinct from new.distance_km then
      if old.bike_id is not null then
        update bikes set current_odometer_km = current_odometer_km - old.distance_km
        where id = old.bike_id;
      end if;
      if new.bike_id is not null then
        update bikes set current_odometer_km = current_odometer_km + new.distance_km
        where id = new.bike_id;
      end if;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.bike_id is not null then
      update bikes set current_odometer_km = current_odometer_km - old.distance_km
      where id = old.bike_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

create trigger trg_ride_odometer
after insert or update of bike_id, distance_km or delete on rides
for each row execute function sync_bike_odometer();
