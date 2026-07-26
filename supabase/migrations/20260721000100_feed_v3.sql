-- v3 batch (user + co-founder, 2026-07-21): friction comes out of the feed.
--
-- Tags die (nobody wants to classify a thought before sharing it), the explore
-- feed becomes one stream of posts AND public ride invites, planned rides
-- carry the details that decide whether a rider belongs on them, and crews
-- compete on three opt-in leaderboards.

-- ---------------------------------------------------------------------------
-- 1. Posts lose their tag. One kind of post; everything lands in explore.
--    The old feed reads posts.tag, so it goes before the column does.
-- ---------------------------------------------------------------------------
drop function if exists explore_feed(text, timestamptz);
alter table posts drop column tag;

-- ---------------------------------------------------------------------------
-- 1b. Bug, found while testing item 6: private crews could never let anyone in.
--
--     20260717000100 added the members_approve UPDATE policy, but crew_members
--     was only ever granted select/insert/delete (20260716000700) — so the
--     policy was dead on arrival and every approval failed with 42501. The
--     client swallowed it (.catch(() => {})), so it looked like nothing
--     happened. Requests went in, nobody came out.
--
--     Column-scoped on purpose: approving sets state and nothing else. A
--     table-wide grant would let an admin rewrite role or profile_id, which
--     the policy's with-check does not constrain.
-- ---------------------------------------------------------------------------
grant update (state) on crew_members to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Planned rides carry their shape. Every field is nullable on purpose:
--    null means the creator didn't ask, and what the creator didn't ask, the
--    joiner is never asked either.
-- ---------------------------------------------------------------------------
alter table ride_invites
  add column bike_category text
    check (bike_category is null or bike_category in
      ('any','naked','sport','adv','cruiser','scrambler','tourer')),
  add column gear_required boolean,
  add column min_experience text
    check (min_experience is null or min_experience in
      ('any','beginner','intermediate','advanced')),
  add column difficulty text
    check (difficulty is null or difficulty in ('easy','moderate','hard','expert'));

-- The joiner's side of the same questions. Difficulty is a property of the
-- road, not of the rider, so it is never asked back.
alter table invite_rsvps
  add column bike_category text
    check (bike_category is null or bike_category in
      ('naked','sport','adv','cruiser','scrambler','tourer')),
  add column has_gear boolean,
  add column experience text
    check (experience is null or experience in ('beginner','intermediate','advanced'));

-- RSVP answers are editable by their owner (change of bike, change of mind).
create policy rsvps_update_own on invite_rsvps for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
grant update on invite_rsvps to authenticated;

-- Board rows now carry the ride's shape and the caller's own answers.
-- (Return shape changed — Postgres requires the drop.)
drop function if exists invite_list(uuid);
create function invite_list(p_crew_id uuid default null)
returns table (
  id uuid,
  created_by uuid,
  handle text,
  avatar_url text,
  crew_id uuid,
  route_id uuid,
  title text,
  meetup text,
  region text,
  starts_at timestamptz,
  rsvp_count bigint,
  i_am_in boolean,
  bike_category text,
  gear_required boolean,
  min_experience text,
  difficulty text,
  my_bike_category text,
  my_has_gear boolean,
  my_experience text
)
language sql stable security definer set search_path = public as $$
  select
    i.id, i.created_by, p.handle, p.avatar_url, i.crew_id, i.route_id, i.title,
    i.meetup, i.region, i.starts_at,
    (select count(*) from invite_rsvps r where r.invite_id = i.id) as rsvp_count,
    exists (
      select 1 from invite_rsvps r
      where r.invite_id = i.id and r.profile_id = auth.uid()
    ) as i_am_in,
    i.bike_category, i.gear_required, i.min_experience, i.difficulty,
    mine.bike_category, mine.has_gear, mine.experience
  from ride_invites i
  join profiles p on p.id = i.created_by
  left join invite_rsvps mine
    on mine.invite_id = i.id and mine.profile_id = auth.uid()
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

-- ---------------------------------------------------------------------------
-- 3. The unified explore feed: posts and public ride invites in one stream,
--    newest first. Crew invites stay in their crew — the board is the public
--    half of planning, and that is what discovery gets to see.
-- ---------------------------------------------------------------------------
create function explore_feed(p_before timestamptz default null)
returns table (
  kind text,
  id uuid,
  profile_id uuid,
  handle text,
  avatar_url text,
  body text,
  comment_count bigint,
  created_at timestamptz,
  title text,
  meetup text,
  region text,
  starts_at timestamptz,
  rsvp_count bigint,
  i_am_in boolean,
  bike_category text,
  gear_required boolean,
  min_experience text,
  difficulty text
)
language sql stable security definer set search_path = public as $$
  select
    'post'::text, p.id, p.profile_id, pr.handle, pr.avatar_url, p.body,
    (select count(*) from post_comments c where c.post_id = p.id),
    p.created_at,
    null::text, null::text, null::text, null::timestamptz, null::bigint, null::boolean,
    null::text, null::boolean, null::text, null::text
  from posts p
  join profiles pr on pr.id = p.profile_id
  where can_view(p.profile_id)
    and (p_before is null or p.created_at < p_before)

  union all

  select
    'ride'::text, i.id, i.created_by, pr.handle, pr.avatar_url, i.meetup,
    (select count(*) from invite_rsvps r where r.invite_id = i.id),
    i.created_at,
    i.title, i.meetup, i.region, i.starts_at,
    (select count(*) from invite_rsvps r where r.invite_id = i.id),
    exists (
      select 1 from invite_rsvps r
      where r.invite_id = i.id and r.profile_id = auth.uid()
    ),
    i.bike_category, i.gear_required, i.min_experience, i.difficulty
  from ride_invites i
  join profiles pr on pr.id = i.created_by
  where i.crew_id is null
    and i.starts_at > now() - interval '6 hours'
    and auth.uid() is not null
    and (p_before is null or i.created_at < p_before)

  order by created_at desc
  limit 30;
$$;

revoke all on function explore_feed(timestamptz) from public;
grant execute on function explore_feed(timestamptz) to authenticated;

-- A rider's own posts, for the profile Posts tab (tag column is gone).
create or replace function posts_of(p_profile_id uuid, p_before timestamptz default null)
returns table (
  id uuid,
  profile_id uuid,
  handle text,
  avatar_url text,
  body text,
  comment_count bigint,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.profile_id, pr.handle, pr.avatar_url, p.body,
    (select count(*) from post_comments c where c.post_id = p.id),
    p.created_at
  from posts p
  join profiles pr on pr.id = p.profile_id
  where p.profile_id = p_profile_id
    and can_view(p_profile_id)
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit 30;
$$;

revoke all on function posts_of(uuid, timestamptz) from public;
grant execute on function posts_of(uuid, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Crew leaderboards. Opt-in, per crew: privacy is a choice a crew makes
--    once, and until it makes it the crew is invisible to the board.
--
--    Distance sums every ACTIVE member's rides regardless of that rider's own
--    profile visibility (user decision 2026-07-21). The exposure is an
--    aggregate — a crew total never reveals a ride, a route, or a rider.
-- ---------------------------------------------------------------------------
alter table crews add column on_leaderboard boolean not null default false;

-- "Today" is an Indian day. The rider base is India-first and a UTC reset
-- would land at 05:30 IST — mid dawn-run, exactly when it hurts most.
create or replace function ist_day_start()
returns timestamptz language sql stable set search_path = public as $$
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
$$;

-- One call, three boards: the client sorts. At tester scale the whole opted-in
-- set is a handful of crews; when that stops being true this becomes a
-- materialized view refreshed on a schedule.
create or replace function crew_leaderboard()
returns table (
  id uuid,
  name text,
  region text,
  is_private boolean,
  member_count bigint,
  lifetime_km numeric,
  today_km numeric,
  i_am_in boolean
)
language sql stable security definer set search_path = public as $$
  select
    c.id, c.name, c.region, c.is_private,
    (select count(*) from crew_members m
      where m.crew_id = c.id and m.state = 'active') as member_count,
    coalesce((
      select sum(r.distance_km) from rides r
      where r.profile_id in (
        select m.profile_id from crew_members m
        where m.crew_id = c.id and m.state = 'active'
      )
    ), 0) as lifetime_km,
    coalesce((
      select sum(r.distance_km) from rides r
      where r.started_at >= ist_day_start()
        and r.profile_id in (
          select m.profile_id from crew_members m
          where m.crew_id = c.id and m.state = 'active'
        )
    ), 0) as today_km,
    exists (
      select 1 from crew_members m
      where m.crew_id = c.id and m.profile_id = auth.uid() and m.state = 'active'
    ) as i_am_in
  from crews c
  where c.on_leaderboard and auth.uid() is not null
  limit 100;
$$;

revoke all on function crew_leaderboard() from public;
grant execute on function crew_leaderboard() to authenticated;

-- crews_of carries the flag so the room can render its toggle. Return shape
-- changed, so Postgres requires the drop — create-or-replace cannot widen it.
drop function if exists crews_of(uuid);
create function crews_of(p_profile_id uuid)
returns table (
  id uuid, name text, region text, is_private boolean, on_leaderboard boolean,
  role text, member_count bigint
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.region, c.is_private, c.on_leaderboard, m.role,
    (select count(*) from crew_members x where x.crew_id = c.id and x.state = 'active')
  from crew_members m
  join crews c on c.id = m.crew_id
  where m.profile_id = p_profile_id
    and m.state = 'active'
    and can_view(p_profile_id)
  order by m.joined_at;
$$;

revoke all on function crews_of(uuid) from public;
grant execute on function crews_of(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Profile header numbers, one call. Definer so a visible profile's counts
--    resolve without handing the caller read access to the underlying rows;
--    can_view still decides whether anything comes back at all.
-- ---------------------------------------------------------------------------
create or replace function profile_stats(p_profile_id uuid)
returns table (
  total_km numeric,
  ride_count bigint,
  bike_count bigint,
  crew_count bigint,
  follower_count bigint,
  following_count bigint
)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(r.distance_km) from rides r where r.profile_id = p_profile_id), 0),
    (select count(*) from rides r where r.profile_id = p_profile_id),
    (select count(*) from bikes b where b.profile_id = p_profile_id),
    (select count(*) from crew_members m
      where m.profile_id = p_profile_id and m.state = 'active'),
    (select count(*) from follows f
      where f.followee_id = p_profile_id and f.state = 'accepted'),
    (select count(*) from follows f
      where f.follower_id = p_profile_id and f.state = 'accepted')
  where can_view(p_profile_id);
$$;

revoke all on function profile_stats(uuid) from public;
grant execute on function profile_stats(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Ride thumbnails for the profile's Rides tab: every track at once, coarse.
--    A MapLibre instance per row would be absurd, so these are simplified
--    geometries the client draws as SVG. ~22m tolerance — a shape, not a map.
--
--    Privacy follows the same rule as everywhere else: your own tracks come
--    back raw, everyone else's come back clipped by their privacy zones.
-- ---------------------------------------------------------------------------
create or replace function ride_thumbs(p_profile_id uuid, p_limit int default 40)
returns table (ride_id uuid, geom jsonb)
language sql stable security definer set search_path = public as $$
  select r.id,
    ST_AsGeoJSON(
      ST_Simplify(
        case
          when p_profile_id = auth.uid() then t.geom::geometry
          else ST_Difference(
            t.geom::geometry,
            coalesce((
              select ST_Union(z.area::geometry)
              from privacy_zones z where z.profile_id = t.profile_id
            ), ST_GeomFromText('POLYGON EMPTY', 4326))
          )
        end,
        0.0002
      )
    )::jsonb
  from rides r
  join ride_tracks t on t.ride_id = r.id
  where r.profile_id = p_profile_id
    and can_view(p_profile_id)
  order by r.started_at desc
  limit p_limit;
$$;

revoke all on function ride_thumbs(uuid, int) from public;
grant execute on function ride_thumbs(uuid, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Avatars. Same own-folder shape as route photos: public read, writes
--    confined to a folder named for the uploader.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars upload own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars replace own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
