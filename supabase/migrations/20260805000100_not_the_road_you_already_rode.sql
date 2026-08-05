-- Discovery stops recommending roads the rider has already ridden
-- (user, 2026-08-05, from testing on a real account).
--
-- The report was "responses are just showing my previous rides". That is not a
-- rendering fault. discover_routes ranked every readable public user route in
-- the region, and a rider's OWN shared roads are readable public user routes —
-- so the roads a rider had personally ridden and shared were not merely
-- included, they WON. The scoring guaranteed it: +30 for having been ridden by
-- somebody, +4 per rider, and the somebody was the person asking.
--
-- On a database with one active rider that is the whole list. Every answer came
-- back as a mirror of their own riding history, which is the exact opposite of
-- the question the feature exists to answer.
--
-- WHAT COUNTS AS "ALREADY RIDDEN" is the same pair of records rider_profile()
-- counts, and deliberately so — one definition, used for the fingerprint and
-- for this. A road is ridden if the rider shared it FROM a ride, or if they
-- rode a planned ride that pointed at it. Both are records the rider created on
-- purpose. No geometry is touched to decide it, which is what keeps this away
-- from the rider_rode_route mistake (20260726000400).
--
-- WHAT IS DELIBERATELY NOT EXCLUDED: a route the rider drew in the planner and
-- has not ridden yet. They may well have drawn it in order to go and ride it,
-- and hiding it would be answering a different complaint than the one made.
-- Owning a line is not the same as knowing the road.
--
-- The honest consequence, worth stating because it will be the first thing seen
-- on a young database: a rider whose region contains nothing but their own
-- ridden roads now gets an EMPTY list. That is correct. An empty discovery list
-- says "nobody here has been anywhere you haven't" and the copy already invites
-- them to be the first to map something; a list of their own last rides said
-- nothing at all, at four times the length.

create or replace function discover_routes(
  p_region text default null,
  p_when timestamptz default null,
  p_limit int default 20
)
returns table (
  route_id uuid,
  name text,
  region text,
  description text,
  distance_km numeric,
  difficulty text,
  terrain_tags text[],
  max_altitude_m int,
  est_duration_minutes int,
  network_coverage text,
  road_status text,
  riders_count int,
  last_condition text,
  last_condition_at timestamptz,
  warnings text[],
  score numeric
)
language sql stable security definer set search_path = public as $$
  with me as (
    select auth.uid() as id
  ),
  fp as (
    select * from rider_profile()
  ),
  garage as (
    select bool_or(b.type in ('adv', 'scrambler')) as has_adv
    from bikes b, me
    where b.profile_id = me.id and b.is_active
  ),
  plan as (
    select case when p_when is null then null
                else extract(month from p_when)::int end as month
  ),
  -- The roads this rider has already been down. Written as its own step rather
  -- than folded into the filter below so that what is being excluded can be
  -- read on its own and tested on its own.
  already_ridden as (
    select rt.id
    from routes rt, me
    where rt.deleted_at is null
      and (
        rt.source_ride_id in (select r.id from rides r where r.profile_id = me.id)
        or rt.id in (
          select i.route_id
          from ride_invites i
          join rides r on r.planned_ride_id = i.id
          where r.profile_id = me.id
        )
      )
  ),
  candidate as (
    select r.*
    from routes r
    where r.deleted_at is null
      and r.source = 'user'
      and r.visibility = 'public'
      and route_readable(r.id)
      and (p_region is null or r.region = p_region)
      -- NOT EXISTS rather than NOT IN: already_ridden is built from columns
      -- that can be null, and `x not in (… null …)` is null, which is not true,
      -- which silently returns nothing at all. That is the same three-valued
      -- logic that made 20260726000400 wrong, and it fails in the direction
      -- that looks like a working feature with an empty catalogue.
      and not exists (select 1 from already_ridden a where a.id = r.id)
  ),
  ridden as (
    select c.id as route_id, count(distinct who.profile_id)::int as riders_count
    from candidate c
    left join lateral (
      select rd.profile_id from rides rd where rd.id = c.source_ride_id
      union
      select rd.profile_id
      from ride_invites i
      join rides rd on rd.planned_ride_id = i.id
      where i.route_id = c.id
    ) who on true
    group by c.id
  ),
  latest_condition as (
    select distinct on (cr.route_id) cr.route_id, cr.status, cr.created_at
    from condition_reports cr
    join candidate c on c.id = cr.route_id
    order by cr.route_id, cr.created_at desc
  ),
  flagged as (
    select
      c.id, c.name, c.region, c.description, c.distance_km, c.difficulty,
      c.terrain_tags, c.max_altitude_m, c.est_duration_minutes,
      c.network_coverage, c.road_status, c.rating_avg,
      coalesce(rd.riders_count, 0) as riders_count,
      lc.status as last_condition,
      lc.created_at as last_condition_at,
      f.terrain_ridden, f.highest_altitude_m, f.longest_ride_km,

      (
        c.road_status = 'closed'
        or (c.bike_recommendation = 'adv_required' and not coalesce(g.has_adv, false))
      ) as refused,

      (
        array_remove(array[
          case when c.max_altitude_m > 3500 then 'high_pass' end,
          case when pl.month is not null
                and c.best_season is not null
                and not (c.best_season -> 'months' @> to_jsonb(pl.month))
               then 'out_of_season' end,
          case when c.road_status = 'seasonal_closed' then 'seasonal_gate' end,
          case when c.network_coverage = 'none' then 'no_signal' end,
          case when f.highest_altitude_m is not null
                and c.max_altitude_m > f.highest_altitude_m + 500
               then 'above_your_altitude' end,
          case when f.longest_ride_km >= 25
                and c.distance_km > f.longest_ride_km * 1.5
               then 'beyond_your_longest' end
        ], null)
      ) as warnings

    from candidate c
    left join ridden rd on rd.route_id = c.id
    left join latest_condition lc on lc.route_id = c.id
    cross join plan pl
    left join fp f on true
    left join garage g on true
  ),
  scored as (
    select
      x.*,
      (
          case when x.riders_count > 0 then 30 else 0 end
        + least(x.riders_count, 5) * 4
        + case when x.last_condition_at > now() - interval '30 days' then 15 else 0 end
        + coalesce(x.rating_avg, 0) * 2

        + case when x.terrain_ridden && x.terrain_tags then 10 else 0 end
        - case when x.highest_altitude_m is not null
                and x.max_altitude_m > x.highest_altitude_m + 500
               then 20 else 0 end
        - case when x.longest_ride_km >= 25
                and x.distance_km > x.longest_ride_km * 1.5
               then 15 else 0 end

        - case when 'out_of_season' = any (x.warnings) then 25 else 0 end

        - cardinality(x.warnings) * 5
      )::numeric as score
    from flagged x
  )
  select
    s.id, s.name, s.region, s.description, s.distance_km, s.difficulty,
    s.terrain_tags, s.max_altitude_m, s.est_duration_minutes,
    s.network_coverage, s.road_status,
    s.riders_count, s.last_condition, s.last_condition_at,
    s.warnings, s.score
  from scored s, me
  where me.id is not null
    and not s.refused
  order by s.score desc, s.riders_count desc, s.name
  limit greatest(1, least(p_limit, 50));
$$;

-- Unchanged, and restated because CREATE OR REPLACE keeps the ACL but a future
-- DROP would not — 20260726000600 learned that the hard way.
revoke all on function discover_routes(text, timestamptz, int) from public, anon;
grant execute on function discover_routes(text, timestamptz, int) to authenticated;
