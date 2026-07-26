-- Ride AI, step 1: the rider fingerprint (user, 2026-07-26).
--
-- The ranker needs to know who is asking. The obvious source is
-- ride_invites.min_experience — a dropdown the rider picked once at onboarding
-- — and it is the wrong one. Self-declared experience is miscalibrated in the
-- usual direction: everyone is "intermediate".
--
-- What cannot be posed is what they have actually ridden. Longest day, highest
-- pass, hardest road finished, what surfaces they have been on, how far the
-- odometer has turned. A rider with 40,000 km on a commuter is a different
-- proposition from one with 900 km on an adv, and no dropdown says so.
--
-- NO ARGUMENT, deliberately. This reads rides, routes and bikes as the owner —
-- RLS is not in the room — so the only safe shape is one that cannot be pointed
-- at anybody else. A function taking a uuid would be one typo from being
-- rider_rode_route all over again (20260726000400), which is the exact mistake
-- this codebase already made once by letting the caller choose the subject.
--
-- Everything returned is an aggregate. No coordinates, no handles, no ids, no
-- row from another rider. This is the struct that ends up in a model prompt, so
-- the rule is not "hard to misuse" — it is that there is nothing in here worth
-- leaking in the first place.
create or replace function rider_profile()
returns table (
  ride_count int,
  total_km numeric,
  longest_ride_km numeric,
  highest_altitude_m int,
  hardest_difficulty text,
  terrain_ridden text[],
  routes_ridden int,
  bike_types text[],
  max_odometer_km numeric,
  active_months int[],
  home_region text
)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as id
  ),
  my_rides as (
    select r.* from rides r, me where r.profile_id = me.id
  ),
  -- A road counts as ridden two ways: the rider shared it as a route
  -- (source_ride_id), or they rode a planned ride that pointed at it
  -- (planned_ride_id). Both are records the rider created deliberately —
  -- no geometry is touched to establish this, unlike rider_rode_route.
  ridden_routes as (
    select distinct rt.id, rt.max_altitude_m, rt.difficulty, rt.terrain_tags
    from routes rt, me
    where rt.deleted_at is null
      and (
        rt.source_ride_id in (select id from my_rides)
        or rt.id in (
          select i.route_id
          from ride_invites i
          join my_rides rd on rd.planned_ride_id = i.id
        )
      )
  )
  select
    (select count(*)::int from my_rides),
    coalesce((select sum(distance_km) from my_rides), 0),
    coalesce((select max(distance_km) from my_rides), 0),
    (select max(max_altitude_m) from ridden_routes),
    -- Hardest finished, not hardest attempted: difficulty is ordered by hand
    -- because the column is text and the order is a product fact, not a
    -- lexical one ('expert' < 'hard' alphabetically, which is backwards).
    (select difficulty from ridden_routes
      where difficulty is not null
      order by case difficulty
        when 'expert' then 4
        when 'hard' then 3
        when 'moderate' then 2
        when 'easy' then 1
        else 0
      end desc
      limit 1),
    -- The tags themselves rather than an "unpaved %" — the ranker can decide
    -- what matters, and a ratio throws away which surfaces they were.
    coalesce((
      select array_agg(distinct t)
      from ridden_routes, unnest(terrain_tags) as t
    ), '{}'),
    (select count(*)::int from ridden_routes),
    coalesce((
      select array_agg(distinct b.type)
      from bikes b, me
      where b.profile_id = me.id and b.type is not null
    ), '{}'),
    coalesce((select max(b.current_odometer_km) from bikes b, me where b.profile_id = me.id), 0),
    -- Which months they actually ride. A rider who has never ridden in January
    -- should not be handed a January pass.
    coalesce((
      select array_agg(distinct extract(month from started_at)::int)
      from my_rides
    ), '{}'),
    (select p.home_region from profiles p, me where p.id = me.id)
  -- Signed out, this returns no rows rather than a row of zeros: a fingerprint
  -- for nobody is not a fingerprint, and a caller should be able to tell the
  -- difference between "new rider" and "not a rider".
  where (select id from me) is not null;
$$;

-- Named roles, not `from public`. On hosted, revoking PUBLIC does not remove
-- anon's directly-granted EXECUTE (20260726000600) — and anon has no auth.uid()
-- to describe anyway.
revoke all on function rider_profile() from public, anon;
grant execute on function rider_profile() to authenticated;
