-- Likes, reposts, rides-as-posts, and the crew details page (user, 2026-07-21).

-- ---------------------------------------------------------------------------
-- 1. Likes. A like is an identity, not a counter: one row per rider per post,
--    so the count can never drift and double-tapping is idempotent.
-- ---------------------------------------------------------------------------
create table post_likes (
  post_id uuid not null references posts(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);
create index on post_likes (profile_id);

alter table post_likes enable row level security;
grant select, insert, delete on post_likes to authenticated;
grant select on post_likes to anon;

create policy likes_read on post_likes for select using (post_visible(post_id));
create policy likes_own on post_likes for insert to authenticated
  with check (profile_id = auth.uid() and post_visible(post_id));
create policy likes_unlike on post_likes for delete to authenticated
  using (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. A post can now carry a ride, or repeat another post.
-- ---------------------------------------------------------------------------
alter table posts
  add column repost_of uuid references posts(id) on delete cascade,
  add column ride_id uuid references rides(id) on delete set null;
create index on posts (repost_of) where repost_of is not null;

-- A plain post still needs words. A repost or a shared ride carries its
-- meaning in what it points at, so an empty body is legitimate there.
alter table posts drop constraint posts_body_check;
alter table posts add constraint posts_body_check check (
  char_length(body) <= 3000
  and (char_length(body) >= 1 or repost_of is not null or ride_id is not null)
);

-- You may only post a ride that is yours. Visibility then follows the profile,
-- exactly like any other post — no separate per-ride switch to get wrong.
create or replace function owns_ride(p_ride_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from rides r where r.id = p_ride_id and r.profile_id = auth.uid());
$$;
revoke all on function owns_ride(uuid) from public;
grant execute on function owns_ride(uuid) to authenticated;

drop policy posts_write on posts;
create policy posts_write on posts for insert to authenticated
  with check (
    profile_id = auth.uid()
    and (ride_id is null or owns_ride(ride_id))
    and (repost_of is null or post_visible(repost_of))
  );

-- ---------------------------------------------------------------------------
-- 3. The feed carries the new shapes. One call still.
-- ---------------------------------------------------------------------------
drop function if exists explore_feed(timestamptz);
create function explore_feed(p_before timestamptz default null)
returns table (
  kind text,
  id uuid,
  profile_id uuid,
  handle text,
  avatar_url text,
  body text,
  comment_count bigint,
  like_count bigint,
  i_liked boolean,
  created_at timestamptz,
  -- reposts
  repost_of uuid,
  repost_handle text,
  repost_body text,
  -- shared rides
  ride_id uuid,
  ride_distance_km numeric,
  ride_started_at timestamptz,
  ride_geom jsonb,
  -- planned rides
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
    (select count(*) from post_likes l where l.post_id = p.id),
    exists (select 1 from post_likes l where l.post_id = p.id and l.profile_id = auth.uid()),
    p.created_at,
    p.repost_of, rp_pr.handle, rp.body,
    p.ride_id, r.distance_km, r.started_at,
    -- Coarse on purpose: this draws at thumbnail size in a scrolling list.
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
    exists (
      select 1 from invite_rsvps rs
      where rs.invite_id = i.id and rs.profile_id = auth.uid()
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

drop function if exists posts_of(uuid, timestamptz);
create function posts_of(p_profile_id uuid, p_before timestamptz default null)
returns table (
  id uuid,
  profile_id uuid,
  handle text,
  avatar_url text,
  body text,
  comment_count bigint,
  like_count bigint,
  i_liked boolean,
  created_at timestamptz,
  repost_of uuid,
  repost_handle text,
  repost_body text,
  ride_id uuid,
  ride_distance_km numeric
)
language sql stable security definer set search_path = public as $$
  select p.id, p.profile_id, pr.handle, pr.avatar_url, p.body,
    (select count(*) from post_comments c where c.post_id = p.id),
    (select count(*) from post_likes l where l.post_id = p.id),
    exists (select 1 from post_likes l where l.post_id = p.id and l.profile_id = auth.uid()),
    p.created_at,
    p.repost_of, rp_pr.handle, rp.body,
    p.ride_id, r.distance_km
  from posts p
  join profiles pr on pr.id = p.profile_id
  left join posts rp on rp.id = p.repost_of
  left join profiles rp_pr on rp_pr.id = rp.profile_id
  left join rides r on r.id = p.ride_id
  where p.profile_id = p_profile_id
    and can_view(p_profile_id)
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit 30;
$$;

revoke all on function posts_of(uuid, timestamptz) from public;
grant execute on function posts_of(uuid, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The crew details page: who is in, ordered by what they have given.
--    Contribution is the crew's own measure of itself, so it leads — but
--    a rider who has contributed nothing is still a member and still listed.
-- ---------------------------------------------------------------------------
create or replace function crew_member_contributions(p_crew_id uuid)
returns table (
  profile_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  role text,
  state text,
  ride_count bigint,
  total_km numeric
)
language sql stable security definer set search_path = public as $$
  select
    m.profile_id, p.handle, p.display_name, p.avatar_url, m.role, m.state,
    (select count(*) from rides r
      where r.crew_id = p_crew_id and r.profile_id = m.profile_id),
    coalesce((select sum(r.distance_km) from rides r
      where r.crew_id = p_crew_id and r.profile_id = m.profile_id), 0)
  from crew_members m
  join profiles p on p.id = m.profile_id
  where m.crew_id = p_crew_id
    and m.state = 'active'
    and is_crew_member_of(p_crew_id, auth.uid())
  order by 8 desc, m.joined_at asc;
$$;

revoke all on function crew_member_contributions(uuid) from public;
grant execute on function crew_member_contributions(uuid) to authenticated;
