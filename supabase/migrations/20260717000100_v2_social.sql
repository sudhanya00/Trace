-- v2 batch (user, 2026-07-17): bike nicknames, private crews with owner
-- approval, posts + explore feed, suggested riders.

-- People name their bikes. The name leads; the model follows.
alter table bikes add column nickname text
  check (nickname is null or char_length(nickname) between 1 and 30);

-- ---------------------------------------------------------------------------
-- Private crews: the owner decides who gets in. Membership grows a state —
-- joining a private crew parks you at 'pending' until an admin approves.
-- ---------------------------------------------------------------------------
alter table crews add column is_private boolean not null default false;
alter table crew_members add column state text not null default 'active'
  check (state in ('pending','active'));

-- The client never chooses its state; the crew's privacy does.
create or replace function set_member_state()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'admin' then
    new.state := 'active'; -- creator via seed_crew_admin
  else
    select case when c.is_private then 'pending' else 'active' end
      into new.state
    from crews c where c.id = new.crew_id;
  end if;
  return new;
end;
$$;

create trigger trg_member_state
before insert on crew_members
for each row execute function set_member_state();

-- Membership now means ACTIVE membership, everywhere at once: chat policies,
-- realtime stream, roster, invites — all speak through these two.
create or replace function is_crew_member(p_crew_id uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from crew_members m
    where m.crew_id = p_crew_id and m.profile_id = auth.uid() and m.state = 'active'
  );
$$;

create or replace function is_crew_member_of(p_crew_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from crew_members m
    where m.crew_id = p_crew_id and m.profile_id = p_profile_id and m.state = 'active'
  );
$$;

-- Admins approve (the only transition) or remove; members_leave already
-- covers declining-by-deletion on both sides.
create policy members_approve on crew_members for update to authenticated
  using (is_crew_admin(crew_id))
  with check (state = 'active');

-- Roster shows state so the room can render requests; still member/admin-read
-- through the existing definer function, now active-gated for callers.
-- (Return shape changed — Postgres requires the drop.)
drop function if exists crew_roster(uuid);
create function crew_roster(p_crew_id uuid)
returns table (profile_id uuid, handle text, display_name text, role text, joined_at timestamptz, state text)
language sql stable security definer set search_path = public as $$
  select m.profile_id, p.handle, p.display_name, m.role, m.joined_at, m.state
  from crew_members m
  join profiles p on p.id = m.profile_id
  where m.crew_id = p_crew_id
    and is_crew_member_of(p_crew_id, auth.uid())
  order by m.state desc, m.role, m.joined_at;
$$;

-- ---------------------------------------------------------------------------
-- Posts: thoughts, questions, gear talk — the explore feed. Visibility rides
-- the same can_view rule as everything else.
-- ---------------------------------------------------------------------------
create table posts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  tag text not null default 'general'
    check (tag in ('general','ask','tips','gear','bike','road','story')),
  body text not null check (char_length(body) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index on posts (created_at desc);
create index on posts (profile_id, created_at desc);

create table post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index on post_comments (post_id, created_at);

alter table posts enable row level security;
alter table post_comments enable row level security;
grant select on posts, post_comments to anon, authenticated;
grant insert, delete on posts, post_comments to authenticated;

create policy posts_read on posts for select using (can_view(profile_id));
create policy posts_write on posts for insert to authenticated
  with check (profile_id = auth.uid());
create policy posts_delete_own on posts for delete to authenticated
  using (profile_id = auth.uid());

create or replace function post_visible(p_post_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from posts p where p.id = p_post_id and can_view(p.profile_id));
$$;
revoke all on function post_visible(uuid) from public;
grant execute on function post_visible(uuid) to anon, authenticated;

create policy post_comments_read on post_comments for select using (post_visible(post_id));
create policy post_comments_write on post_comments for insert to authenticated
  with check (profile_id = auth.uid() and post_visible(post_id));
create policy post_comments_delete_own on post_comments for delete to authenticated
  using (profile_id = auth.uid());

-- Content flags extend to posts and their comments.
alter table content_reports add column post_id uuid references posts(id) on delete cascade;
alter table content_reports add column post_comment_id uuid references post_comments(id) on delete cascade;

-- Feed rows with handles and comment counts, one call. Definer: a private
-- author's handle shows on posts their followers can see — that's the deal.
create or replace function explore_feed(p_tag text default null, p_before timestamptz default null)
returns table (
  id uuid,
  profile_id uuid,
  handle text,
  tag text,
  body text,
  comment_count bigint,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.profile_id, pr.handle, p.tag, p.body,
    (select count(*) from post_comments c where c.post_id = p.id),
    p.created_at
  from posts p
  join profiles pr on pr.id = p.profile_id
  where can_view(p.profile_id)
    and (p_tag is null or p.tag = p_tag)
    and (p_before is null or p.created_at < p_before)
  order by p.created_at desc
  limit 30;
$$;

create or replace function post_thread(p_post_id uuid)
returns table (id uuid, profile_id uuid, handle text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.profile_id, p.handle, c.body, c.created_at
  from post_comments c
  join profiles p on p.id = c.profile_id
  where c.post_id = p_post_id and post_visible(p_post_id)
  order by c.created_at asc;
$$;

revoke all on function explore_feed(text, timestamptz) from public;
revoke all on function post_thread(uuid) from public;
grant execute on function explore_feed(text, timestamptz) to anon, authenticated;
grant execute on function post_thread(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Suggested riders: same bike or same region, public, not already followed.
-- ---------------------------------------------------------------------------
create or replace function suggested_riders()
returns table (id uuid, handle text, display_name text, home_region text, reason text)
language sql stable security definer set search_path = public as $$
  with my_bikes as (
    select distinct lower(make) as mk, lower(model) as md
    from bikes where profile_id = auth.uid()
  ),
  my_region as (
    select nullif(lower(coalesce(home_region, '')), '') as r
    from profiles where id = auth.uid()
  )
  select p.id, p.handle, p.display_name, p.home_region,
    case
      when exists (
        select 1 from bikes b
        join my_bikes mb on lower(b.make) = mb.mk and lower(b.model) = mb.md
        where b.profile_id = p.id
      ) then 'rides the same bike'
      when nullif(lower(coalesce(p.home_region, '')), '') = (select r from my_region)
        then 'from your region'
    end as reason
  from profiles p
  where p.id <> auth.uid()
    and p.visibility = 'public'
    and not exists (
      select 1 from follows f
      where f.follower_id = auth.uid() and f.followee_id = p.id
    )
    and (
      exists (
        select 1 from bikes b
        join my_bikes mb on lower(b.make) = mb.mk and lower(b.model) = mb.md
        where b.profile_id = p.id
      )
      or nullif(lower(coalesce(p.home_region, '')), '') = (select r from my_region)
    )
  limit 12;
$$;

revoke all on function suggested_riders() from public;
grant execute on function suggested_riders() to authenticated;

-- A rider's crews, for the profile Crews section (memberships are open info
-- for open rosters; pending rows only surface to the person themselves).
create or replace function crews_of(p_profile_id uuid)
returns table (id uuid, name text, region text, is_private boolean, role text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.region, c.is_private, m.role,
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
