-- Ride AI, step 2: the ranker. No model anywhere in this file.
--
-- The point of building this first is that it has to be useful on its own. If
-- a plain regional list ranked against what the rider has actually done isn't
-- worth reading, then the chat on top is decorating a hole and no amount of
-- prompting fixes that.
--
-- This is also where the safety boundary sits. A language model names roads;
-- it does not decide whether a rider should be on one. Everything that can
-- hurt somebody — a closed road, a pass shut for the season, a track that
-- demands a bike they don't own — is decided HERE, against columns, in code
-- that can be read and tested. The model never gets a vote on it.
--
-- Two tiers, and the difference matters:
--
--   REFUSED   the road is not shown at all. Reserved for facts, not guesses:
--             it is closed, or the rider's garage cannot do it. Over-refusing
--             is its own failure — hiding a road nobody asked us to hide —
--             so this list stays short.
--
--   FLAGGED   the road is shown with a warning code. Everything else: high
--             altitude, out of season, no signal, harder or longer or higher
--             than anything this rider has finished.
--
-- Warnings are CODES, not prose. §8 owns the copy and the colours (amber for a
-- caution, never the signal blue), and a sentence written in SQL would be a
-- sentence outside the design system.

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
  -- The caller's own fingerprint, inlined rather than called: rider_profile()
  -- returns a row per caller and we need its columns in a join, not a scalar.
  fp as (
    select * from rider_profile()
  ),
  -- What the garage can do. A rider with any adv or scrambler can be offered a
  -- track that demands one; nobody else can.
  garage as (
    select bool_or(b.type in ('adv', 'scrambler')) as has_adv
    from bikes b, me
    where b.profile_id = me.id and b.is_active
  ),
  -- The month the rider is actually planning for, not the month it is now.
  -- WhenPicker already knows this date; null means "no date chosen yet", and
  -- with no date there is no season to be out of.
  plan as (
    select case when p_when is null then null
                else extract(month from p_when)::int end as month
  ),
  candidate as (
    select r.*
    from routes r
    where r.deleted_at is null
      and r.source = 'user'
      and r.visibility = 'public'
      and route_readable(r.id)
      and (p_region is null or r.region = p_region)
  ),
  -- Provenance: how many distinct riders have actually ridden this road, by
  -- the same two records rider_profile() counts — a shared route, or a planned
  -- ride someone rode. No geometry is touched to establish it.
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
  -- Refusals and warnings first, in their own step, so the score below can
  -- read the warning list instead of recomputing it. That ordering is not
  -- cosmetic: it is what lets a flagged road sink when nothing else separates
  -- it from an unflagged one.
  flagged as (
    select
      c.id, c.name, c.region, c.description, c.distance_km, c.difficulty,
      c.terrain_tags, c.max_altitude_m, c.est_duration_minutes,
      c.network_coverage, c.road_status, c.rating_avg,
      coalesce(rd.riders_count, 0) as riders_count,
      lc.status as last_condition,
      lc.created_at as last_condition_at,
      f.terrain_ridden, f.highest_altitude_m, f.longest_ride_km,

      -- ---- REFUSED --------------------------------------------------------
      (
        c.road_status = 'closed'
        or (c.bike_recommendation = 'adv_required' and not coalesce(g.has_adv, false))
      ) as refused,

      -- ---- FLAGGED --------------------------------------------------------
      (
        array_remove(array[
          case when c.max_altitude_m > 3500 then 'high_pass' end,
          case when pl.month is not null
                and c.best_season is not null
                and not (c.best_season -> 'months' @> to_jsonb(pl.month))
               then 'out_of_season' end,
          case when c.road_status = 'seasonal_closed' then 'seasonal_gate' end,
          case when c.network_coverage = 'none' then 'no_signal' end,
          -- Fit warnings only fire when there is a demonstrated number to be
          -- beyond. A rider who has ridden nothing is not warned about
          -- everything — that is the new-city case, and drowning it in
          -- warnings is the same failure as captioning every row.
          case when f.highest_altitude_m is not null
                and c.max_altitude_m > f.highest_altitude_m + 500
               then 'above_your_altitude' end,
          -- 25 km, not "> 0". A multiplier on a tiny baseline is nonsense: a
          -- rider whose longest day is 5 km would be warned off a sealed
          -- 21 km riverside road, which is the one road they should be shown.
          -- Below the floor we do not claim to know their range at all.
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
      -- Deliberately legible arithmetic, not a tuned formula. Someone should be
      -- able to read why a road came third.
      (
          -- Verified beats unverified, and density beats a single rider.
          case when x.riders_count > 0 then 30 else 0 end
        + least(x.riders_count, 5) * 4
        + case when x.last_condition_at > now() - interval '30 days' then 15 else 0 end
        + coalesce(x.rating_avg, 0) * 2

          -- Fit, where fit is known.
        + case when x.terrain_ridden && x.terrain_tags then 10 else 0 end
        - case when x.highest_altitude_m is not null
                and x.max_altitude_m > x.highest_altitude_m + 500
               then 20 else 0 end
        - case when x.longest_ride_km >= 25
                and x.distance_km > x.longest_ride_km * 1.5
               then 15 else 0 end

          -- Out of season sinks but does not hide: the rider may be planning
          -- for a month that hasn't come yet.
        - case when 'out_of_season' = any (x.warnings) then 25 else 0 end

          -- And every warning costs a little. Small on purpose — a flag should
          -- never outweigh real community evidence — but enough that when
          -- nothing else separates two roads, the one carrying four warnings
          -- does not tie with the one carrying none. That tie is exactly the
          -- case a rider with no history hits, which is the case this feature
          -- exists for.
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

-- Named roles. Signed-out callers get nothing: the ranker is built on a
-- fingerprint, and anon has no auth.uid() to have one.
revoke all on function discover_routes(text, timestamptz, int) from public, anon;
grant execute on function discover_routes(text, timestamptz, int) to authenticated;
