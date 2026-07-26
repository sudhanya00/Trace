-- The meetup point was write-only (user, 2026-07-25).
--
-- 20260725000100 added meetup_lat/lng/place_id and the picker saved them, but
-- invite_list never returned them — so a rider could drop a pin on the map
-- and nothing could ever take them there. "Get me to City Chowk by six" is the
-- most common navigation need a planned ride has, and it was the one thing
-- the data couldn't answer.

drop function if exists invite_list(uuid);
create function invite_list(p_crew_id uuid default null)
returns table (
  id uuid, created_by uuid, handle text, avatar_url text, crew_id uuid,
  route_id uuid, title text, meetup text, region text, starts_at timestamptz,
  rsvp_count bigint, i_am_in boolean,
  bike_category text, gear_required boolean, min_experience text,
  difficulty text, route_geom jsonb, route_distance_km numeric,
  meetup_lat double precision, meetup_lng double precision, meetup_place_id text,
  my_bike_category text, my_has_gear boolean, my_experience text
)
language sql stable security definer set search_path = public as $$
  select
    i.id, i.created_by, p.handle, p.avatar_url, i.crew_id, i.route_id, i.title,
    i.meetup, i.region, i.starts_at,
    (select count(*) from invite_rsvps r where r.invite_id = i.id),
    exists (select 1 from invite_rsvps r where r.invite_id = i.id and r.profile_id = auth.uid()),
    i.bike_category, i.gear_required, i.min_experience,
    rt.difficulty,
    ST_AsGeoJSON(ST_Simplify(public_route_geom(rt.id), 0.0005))::jsonb,
    rt.distance_km,
    i.meetup_lat, i.meetup_lng, i.meetup_place_id,
    mine.bike_category, mine.has_gear, mine.experience
  from ride_invites i
  join profiles p on p.id = i.created_by
  join routes rt on rt.id = i.route_id
  left join invite_rsvps mine on mine.invite_id = i.id and mine.profile_id = auth.uid()
  where i.starts_at > now() - interval '6 hours'
    and auth.uid() is not null
    and (
      (p_crew_id is null and i.crew_id is null)
      or (p_crew_id is not null and i.crew_id = p_crew_id and is_crew_member_of(p_crew_id, auth.uid()))
    )
  order by i.starts_at asc
  limit 50;
$$;

revoke all on function invite_list(uuid) from public;
grant execute on function invite_list(uuid) to authenticated;
