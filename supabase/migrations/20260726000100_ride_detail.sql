-- A planned ride you can actually open (user, 2026-07-26).
--
-- The card said when, where and who's counting — and then stopped. You could
-- say you were in, and that was the entire interaction. Everything a rider
-- actually wants before committing to a 300km Sunday — what the road is like,
-- who else is coming, what the plan is beyond a title — had nowhere to live.

-- Somewhere to put the plan. The title is a name; this is the detail.
alter table ride_invites
  add column description text check (description is null or char_length(description) <= 2000);

/**
 * One planned ride, in full.
 *
 * Deliberately without invite_list's six-hour window: that exists so the board
 * shows what's next, but a detail page must still open for a ride that started
 * this morning — you follow a link from the chat, or check who turned up.
 */
create or replace function invite_detail(p_invite_id uuid)
returns table (
  id uuid, created_by uuid, handle text, avatar_url text, crew_id uuid,
  crew_name text, route_id uuid, title text, description text, meetup text,
  region text, starts_at timestamptz, created_at timestamptz,
  rsvp_count bigint, i_am_in boolean, i_created_it boolean,
  bike_category text, gear_required boolean, min_experience text,
  difficulty text, route_geom jsonb, route_distance_km numeric, route_name text,
  meetup_lat double precision, meetup_lng double precision, meetup_place_id text,
  my_bike_category text, my_has_gear boolean, my_experience text
)
language sql stable security definer set search_path = public as $$
  select
    i.id, i.created_by, p.handle, p.avatar_url, i.crew_id, c.name,
    i.route_id, i.title, i.description, i.meetup, i.region, i.starts_at, i.created_at,
    (select count(*) from invite_rsvps r where r.invite_id = i.id),
    exists (select 1 from invite_rsvps r where r.invite_id = i.id and r.profile_id = auth.uid()),
    i.created_by = auth.uid(),
    i.bike_category, i.gear_required, i.min_experience,
    rt.difficulty,
    ST_AsGeoJSON(ST_Simplify(public_route_geom(rt.id), 0.0005))::jsonb,
    rt.distance_km, rt.name,
    i.meetup_lat, i.meetup_lng, i.meetup_place_id,
    mine.bike_category, mine.has_gear, mine.experience
  from ride_invites i
  join profiles p on p.id = i.created_by
  join routes rt on rt.id = i.route_id
  left join crews c on c.id = i.crew_id
  left join invite_rsvps mine on mine.invite_id = i.id and mine.profile_id = auth.uid()
  where i.id = p_invite_id
    and auth.uid() is not null
    -- Same visibility rule as the board: public rides are open to any signed-in
    -- rider, a crew's ride is the crew's business.
    and (i.crew_id is null or is_crew_member_of(i.crew_id, auth.uid()));
$$;

revoke all on function invite_detail(uuid) from public;
grant execute on function invite_detail(uuid) to authenticated;

-- No new update policy needed: invites_update_own (20260716000900) already
-- lets the creator edit their own ride, and description rides along with it.
