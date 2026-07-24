-- Route standardization — Phase 1 of the Routes spec (user, 2026-07-24).
--
-- The problem: a "route" existed in three incompatible forms — a curated
-- editorial route (didn't exist), a rider's shared trace (the routes table),
-- and an ad-hoc name typed into Plan-a-ride ("Dawn run to Sonamarg"), which
-- was just text in a title field referencing nothing. A planned ride had no
-- route object. This makes Route a real entity every planned ride points at.
--
-- Decisions taken (spec §5): user routes stay OUT of the curated catalogue —
-- reachable from a profile and shareable into Explore as posts, Strava/
-- AllTrails-style (Q2); adhoc routes soft-delete after their ride date (Q6);
-- curation is an in-app admin role, foundation laid here (Q3). Kept the
-- existing requirement columns on ride_invites rather than the spec's jsonb —
-- they're already wired to the RSVP flow; only difficulty moves to the Route.
-- Satellite tables (waypoints, saves, downloads, reviews) wait for Phase 2 —
-- they carry no backfill cost, unlike the metadata columns, which do (§3.4).

-- ---------------------------------------------------------------------------
-- 1. The Route entity. The existing table already IS the 'user' source; this
--    widens it to all three, and to the metadata that makes a Himalayan route
--    judgeable (fuel gaps, permits, seasons decide attemptability — §3.4).
-- ---------------------------------------------------------------------------

-- Curation role — the Q3 foundation. The authoring screen is Phase 2; the flag
-- it will gate on lives here so the schema and its policies are ready.
alter table profiles add column is_admin boolean not null default false;

-- Curated routes have no owner; adhoc routes have no geometry.
alter table routes alter column profile_id drop not null;
alter table routes alter column geom drop not null;

alter table routes
  add column source text not null default 'user'
    check (source in ('curated', 'user', 'adhoc')),
  -- Default 'public' because a user route only exists as a deliberate act of
  -- sharing ("share this ride as a route"). Profile-level privacy still
  -- applies on top via can_view, so a private rider's public route stays
  -- follower-only — exactly the old behaviour, now with route-level narrowing
  -- available. A 'private' default would have silently hidden every route the
  -- existing client creates (it doesn't set this column).
  add column visibility text not null default 'public'
    check (visibility in ('public', 'crew', 'private')),
  add column crew_id uuid references crews(id) on delete set null,
  add column slug text,
  add column region text,
  add column difficulty text
    check (difficulty is null or difficulty in ('easy', 'moderate', 'hard', 'expert')),
  add column route_type text
    check (route_type is null or route_type in ('loop', 'point_to_point', 'out_and_back')),
  add column elevation_gain_m int,
  add column elevation_loss_m int,
  add column max_altitude_m int,
  add column est_duration_minutes int,
  add column surface_breakdown jsonb,
  add column bike_recommendation text
    check (bike_recommendation is null or bike_recommendation in
      ('any', 'commuter_ok', 'adv_recommended', 'adv_required')),
  add column max_fuel_gap_km numeric,
  add column permits_required jsonb,
  add column best_season jsonb,
  add column road_status text not null default 'unknown'
    check (road_status in ('open', 'seasonal_closed', 'closed', 'unknown')),
  add column road_status_updated timestamptz,
  add column hazards text[],
  add column network_coverage text
    check (network_coverage is null or network_coverage in ('good', 'patchy', 'none')),
  add column hero_images text[],
  add column rating_avg numeric,
  add column rating_count int not null default 0,
  add column published_at timestamptz,
  -- Q6: adhoc routes that were never recorded get swept after their ride date.
  add column deleted_at timestamptz;

-- Existing rows are user routes, and every one of them was created by sharing
-- a ride — so they are all 'public' at the route level. Their real gate stays
-- can_view(owner), unchanged, so nothing that was visible becomes hidden.
update routes r
  set source = 'user',
      visibility = 'public',
      region = (select home_region from profiles p where p.id = r.profile_id);

create index on routes (source, visibility) where deleted_at is null;
create index on routes (profile_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Read model. RLS references the row inline (no recursion); the accessors
--    reuse the same predicate via a definer helper.
-- ---------------------------------------------------------------------------
drop policy routes_own on routes;

-- A user route is gated by BOTH its own visibility and the owner's profile
-- (can_view) — the same rule the rest of the app runs on. Curated routes are
-- editorial and answer only to published_at.
create policy routes_read on routes for select using (
  deleted_at is null and (
       profile_id = auth.uid()
    or (source = 'curated' and published_at is not null)
    or (source = 'user' and visibility = 'public' and can_view(profile_id))
    or (source = 'user' and visibility = 'crew' and crew_id is not null and is_crew_member(crew_id))
    or (source = 'adhoc' and exists (
          select 1 from ride_invites i
          where i.route_id = routes.id
            and (i.crew_id is null or is_crew_member(i.crew_id))))
  )
);

-- Writes: a rider owns their user/adhoc routes; only an admin makes curated
-- ones, and a curated route never carries an owner.
create policy routes_write_own on routes for insert to authenticated with check (
  (source in ('user', 'adhoc') and profile_id = auth.uid())
  or (source = 'curated' and profile_id is null
      and (select is_admin from profiles where id = auth.uid()))
);
create policy routes_update on routes for update to authenticated using (
  profile_id = auth.uid()
  or (source = 'curated' and (select is_admin from profiles where id = auth.uid()))
);
create policy routes_delete on routes for delete to authenticated using (
  profile_id = auth.uid()
  or (source = 'curated' and (select is_admin from profiles where id = auth.uid()))
);

-- The same visibility predicate, callable from the definer accessors (which
-- read routes with definer rights, so no policy recursion).
create or replace function route_readable(p_route_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from routes r
    where r.id = p_route_id and r.deleted_at is null and (
         r.profile_id = auth.uid()
      or (r.source = 'curated' and r.published_at is not null)
      or (r.source = 'user' and r.visibility = 'public' and can_view(r.profile_id))
      or (r.source = 'user' and r.visibility = 'crew' and r.crew_id is not null
          and is_crew_member_of(r.crew_id, auth.uid()))
      or (r.source = 'adhoc' and exists (
            select 1 from ride_invites i
            where i.route_id = r.id
              and (i.crew_id is null or is_crew_member_of(i.crew_id, auth.uid()))))
    )
  );
$$;
revoke all on function route_readable(uuid) from public;
grant execute on function route_readable(uuid) to anon, authenticated;

-- Clipped geometry: curated routes are editorial and unclipped; everything
-- else still gets the owner's privacy zones subtracted. Null geom (adhoc)
-- returns nothing.
create or replace function public_route_geom(p_route_id uuid)
returns geometry language sql stable security definer set search_path = public as $$
  select case
    when r.source = 'curated' then r.geom::geometry
    else ST_Difference(
      r.geom::geometry,
      coalesce((
        select ST_Union(z.area::geometry)
        from privacy_zones z where z.profile_id = r.profile_id
      ), ST_GeomFromText('POLYGON EMPTY', 4326)))
  end
  from routes r
  where r.id = p_route_id and r.geom is not null and route_readable(p_route_id);
$$;

-- routes_public widens to the new model and carries region + difficulty so the
-- catalogue can list without a second round-trip.
-- Definer semantics on purpose (the default, as before): the view runs as its
-- owner so anon needs no direct grant on routes, and route_readable() —
-- which reads the CALLER's auth.uid() — is what filters. Making this
-- security_invoker breaks anon reads with a bare permission error.
drop view if exists routes_public;
create view routes_public as
  select
    r.id, r.profile_id, r.source_ride_id, r.source, r.visibility,
    r.name, r.region, r.difficulty, r.description, r.terrain_tags,
    r.distance_km, public_route_geom(r.id) as geom, r.photo_url,
    r.hero_images, r.rating_avg, r.rating_count, r.created_at
  from routes r
  where r.deleted_at is null and route_readable(r.id);
grant select on routes_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Planned rides reference a real route — never null. Difficulty is a
--    property of the road, so it lives on the Route now, not the invite.
-- ---------------------------------------------------------------------------

-- Backfill: every existing free-text invite becomes an adhoc route carrying
-- the name, region and difficulty it used to hold inline.
insert into routes (id, profile_id, source, visibility, crew_id, name, region, difficulty, created_at)
select gen_random_uuid(), i.created_by, 'adhoc',
       case when i.crew_id is not null then 'crew' else 'public' end,
       i.crew_id, i.title, i.region, i.difficulty, i.created_at
from ride_invites i
where i.route_id is null;

update ride_invites i
  set route_id = r.id
  from routes r
  where i.route_id is null and r.source = 'adhoc'
    and r.name = i.title and r.created_at = i.created_at
    and r.profile_id = i.created_by;

-- Now it can be mandatory, and difficulty leaves the invite for good.
alter table ride_invites alter column route_id set not null;
alter table ride_invites drop column difficulty;

-- The board and feed now read difficulty (and the route's shape) from the
-- joined route. Same field names out, so the client is untouched.
drop function if exists invite_list(uuid);
create function invite_list(p_crew_id uuid default null)
returns table (
  id uuid, created_by uuid, handle text, avatar_url text, crew_id uuid,
  route_id uuid, title text, meetup text, region text, starts_at timestamptz,
  rsvp_count bigint, i_am_in boolean,
  bike_category text, gear_required boolean, min_experience text,
  difficulty text, route_geom jsonb, route_distance_km numeric,
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

-- explore_feed's ride rows read difficulty from the route too.
drop function if exists explore_feed(timestamptz);
create function explore_feed(p_before timestamptz default null)
returns table (
  kind text, id uuid, profile_id uuid, handle text, avatar_url text, body text,
  comment_count bigint, like_count bigint, i_liked boolean, created_at timestamptz,
  repost_of uuid, repost_handle text, repost_body text,
  ride_id uuid, ride_distance_km numeric, ride_started_at timestamptz, ride_geom jsonb,
  title text, meetup text, region text, starts_at timestamptz,
  rsvp_count bigint, i_am_in boolean,
  bike_category text, gear_required boolean, min_experience text, difficulty text
)
language sql stable security definer set search_path = public as $$
  select
    'post'::text, p.id, p.profile_id, pr.handle, pr.avatar_url, p.body,
    (select count(*) from post_comments c where c.post_id = p.id),
    (select count(*) from post_likes l where l.post_id = p.id),
    exists (select 1 from post_likes l where l.post_id = p.id and l.profile_id = auth.uid()),
    p.created_at,
    p.repost_of, rp_pr.handle, rp.body,
    p.ride_id, r.distance_km, r.started_at,
    case when p.ride_id is null then null
      else ST_AsGeoJSON(ST_Simplify(public_track_geom(p.ride_id), 0.0005))::jsonb end,
    null::text, null::text, null::text, null::timestamptz, null::bigint, null::boolean,
    null::text, null::boolean, null::text, null::text
  from posts p
  join profiles pr on pr.id = p.profile_id
  left join posts rp on rp.id = p.repost_of
  left join profiles rp_pr on rp_pr.id = rp.profile_id
  left join rides r on r.id = p.ride_id
  where can_view(p.profile_id)
    and (p_before is null or p.created_at < p_before)

  union all

  select
    'ride'::text, i.id, i.created_by, pr.handle, pr.avatar_url, i.meetup,
    (select count(*) from invite_rsvps rs where rs.invite_id = i.id),
    0::bigint, false,
    i.created_at,
    null::uuid, null::text, null::text,
    null::uuid, null::numeric, null::timestamptz, null::jsonb,
    i.title, i.meetup, i.region, i.starts_at,
    (select count(*) from invite_rsvps rs where rs.invite_id = i.id),
    exists (select 1 from invite_rsvps rs where rs.invite_id = i.id and rs.profile_id = auth.uid()),
    i.bike_category, i.gear_required, i.min_experience, rt.difficulty
  from ride_invites i
  join profiles pr on pr.id = i.created_by
  join routes rt on rt.id = i.route_id
  where i.crew_id is null
    and i.starts_at > now() - interval '6 hours'
    and auth.uid() is not null
    and (p_before is null or i.created_at < p_before)

  order by created_at desc
  limit 30;
$$;
revoke all on function explore_feed(timestamptz) from public;
grant execute on function explore_feed(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A route can be shared into Explore as a post (Q2 — the Strava/AllTrails
--    model). The column lands now; the share UI comes with the route detail
--    screen. Mirrors posts.ride_id exactly.
-- ---------------------------------------------------------------------------
alter table posts add column route_id uuid references routes(id) on delete set null;

create or replace function owns_or_can_post_route(p_route_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from routes r where r.id = p_route_id
      and (r.profile_id = auth.uid() or r.source = 'curated')
  );
$$;
revoke all on function owns_or_can_post_route(uuid) from public;
grant execute on function owns_or_can_post_route(uuid) to authenticated;

drop policy posts_write on posts;
create policy posts_write on posts for insert to authenticated with check (
  profile_id = auth.uid()
  and (ride_id is null or owns_ride(ride_id))
  and (route_id is null or owns_or_can_post_route(route_id))
  and (repost_of is null or post_visible(repost_of))
);

-- ---------------------------------------------------------------------------
-- 5. Q6 sweep: adhoc routes that were planned, never recorded, and never
--    saved, soft-deleted a week after the ride date. Lazy + idempotent; wire
--    to pg_cron at deploy, or call on demand. A recorded ride backfills
--    geometry onto the row (Phase 3), which is why we only sweep the empty ones.
-- ---------------------------------------------------------------------------
create or replace function sweep_stale_adhoc_routes()
returns int language sql security definer set search_path = public as $$
  -- No rides.route_id yet (Phase 3 matching adds it), so "never recorded" is
  -- approximated by "no geometry" — a matched ride backfills geom, sparing it.
  with gone as (
    update routes r set deleted_at = now()
    where r.source = 'adhoc'
      and r.deleted_at is null
      and r.geom is null
      and not exists (
        select 1 from ride_invites i
        where i.route_id = r.id and i.starts_at > now() - interval '7 days'
      )
    returning 1
  )
  select count(*)::int from gone;
$$;
-- Maintenance, not a rider action: no rider role gets this. The service role
-- (a scheduler, or pg_cron) is the only caller.
revoke all on function sweep_stale_adhoc_routes() from public;
grant execute on function sweep_stale_adhoc_routes() to service_role;
