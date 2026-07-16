-- Phase 02: the social graph. This is the "policy swap, not a redesign"
-- §3 promised — the third arm lands on every read surface at once.

create table follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  followee_id uuid not null references profiles(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index on follows (followee_id) where state = 'pending';
create index on follows (followee_id, state);

alter table follows enable row level security;
grant select, insert, update, delete on follows to authenticated;
-- anon needs the table privilege because can_view() references follows inside
-- read policies anon triggers; RLS still yields zero rows for anon.
grant select on follows to anon;

-- Both ends of an edge can see it; nobody else can.
create policy follows_read on follows for select
  using (follower_id = auth.uid() or followee_id = auth.uid());

-- You follow as yourself. State is decided server-side (trigger below).
create policy follows_insert on follows for insert to authenticated
  with check (follower_id = auth.uid());

-- Only the followee accepts, and accepting is the only transition.
create policy follows_update on follows for update to authenticated
  using (followee_id = auth.uid())
  with check (followee_id = auth.uid() and state = 'accepted');

-- Unfollow/cancel (follower) or remove/decline (followee).
create policy follows_delete on follows for delete to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());

-- Public profiles are followable instantly; private ones get a request.
-- The client never chooses — the trigger overrules whatever was sent.
create or replace function set_follow_state()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select case when p.visibility = 'public' then 'accepted' else 'pending' end
    into new.state
  from profiles p where p.id = new.followee_id;
  return new;
end;
$$;

create trigger trg_follow_state
before insert on follows
for each row execute function set_follow_state();

-- ---------------------------------------------------------------------------
-- The visibility rule, named: own, or public owner, or accepted follow.
-- Policies and accessors below all speak through this.
-- ---------------------------------------------------------------------------
create or replace function can_view(owner uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select owner = auth.uid()
    or exists (select 1 from profiles p where p.id = owner and p.visibility = 'public')
    or exists (
      select 1 from follows f
      where f.followee_id = owner and f.follower_id = auth.uid() and f.state = 'accepted'
    );
$$;

-- The swap: reads widen from own-or-public to own-or-public-or-followed.
drop policy profiles_read on profiles;
create policy profiles_read on profiles for select using (
  id = auth.uid()
  or visibility = 'public'
  or exists (
    select 1 from follows f
    where f.followee_id = profiles.id and f.follower_id = auth.uid() and f.state = 'accepted'
  )
);

drop policy bikes_read on bikes;
create policy bikes_read on bikes for select using (can_view(profile_id));

drop policy rides_read on rides;
create policy rides_read on rides for select using (can_view(profile_id));

-- Raw geometry stays owner-only — followers see CLIPPED tracks like everyone
-- else. Privacy zones bow to nobody, follower or not.
create or replace function public_track_geom(p_ride_id uuid)
returns geometry
language sql stable security definer set search_path = public as $$
  select ST_Difference(
    t.geom::geometry,
    coalesce((
      select ST_Union(z.area::geometry)
      from privacy_zones z where z.profile_id = t.profile_id
    ), ST_GeomFromText('POLYGON EMPTY', 4326))
  )
  from ride_tracks t
  where t.ride_id = p_ride_id
    and can_view(t.profile_id);
$$;

create or replace function public_route_geom(p_route_id uuid)
returns geometry
language sql stable security definer set search_path = public as $$
  select ST_Difference(
    r.geom::geometry,
    coalesce((
      select ST_Union(z.area::geometry)
      from privacy_zones z where z.profile_id = r.profile_id
    ), ST_GeomFromText('POLYGON EMPTY', 4326))
  )
  from routes r
  where r.id = p_route_id
    and can_view(r.profile_id);
$$;

-- Both sides of your own edges, with names. SECURITY DEFINER on purpose and
-- narrowly: a private profile's handle is visible to someone they asked to
-- follow, and to someone asking them — you deserve to know who's knocking.
-- Nothing else leaks: only handle/display_name, only on your own edges.
create or replace function follow_edges()
returns table (
  direction text,
  other_id uuid,
  handle text,
  display_name text,
  state text,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select 'following', f.followee_id, p.handle, p.display_name, f.state, f.created_at
  from follows f join profiles p on p.id = f.followee_id
  where f.follower_id = auth.uid()
  union all
  select 'follower', f.follower_id, p.handle, p.display_name, f.state, f.created_at
  from follows f join profiles p on p.id = f.follower_id
  where f.followee_id = auth.uid();
$$;

revoke all on function follow_edges() from public;
grant execute on function follow_edges() to authenticated;

-- routes_public widens the same way. (Runs as owner; can_view still reads the
-- caller's auth.uid() from the request, so the filter is per-caller.)
create or replace view routes_public as
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
  where can_view(r.profile_id);
