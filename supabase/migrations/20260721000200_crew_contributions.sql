-- Crew contributions (user, 2026-07-21). A rider is in several crews; a ride
-- belongs to at most one of them, and only if the rider says so. Nothing is
-- counted by default.
--
-- This replaces the "sum every member's rides" leaderboard from
-- 20260721000100. That version made distance a property of membership, which
-- meant a rider's whole history silently followed them into any crew they
-- joined — and made a crew's total a thing no member had agreed to. Now
-- contribution is a deliberate act, and the aggregate-privacy question the
-- earlier design raised disappears with it.

-- ---------------------------------------------------------------------------
-- 1. The attribution itself.
-- ---------------------------------------------------------------------------
alter table rides add column crew_id uuid references crews(id) on delete set null;
create index on rides (crew_id, started_at desc) where crew_id is not null;

-- A rider may only contribute to a crew they are actually in. rides_write is
-- `for all`, so this rides on both the insert and the update path.
--
-- is_crew_member, not is_crew_member_of: the latter is SECURITY DEFINER and
-- has only ever been called from inside other definer functions, so it carries
-- no execute grant for `authenticated` and fails 42501 the moment a policy
-- invokes it in the caller's own context. is_crew_member is SECURITY INVOKER,
-- already used by the crew_messages policies, and says exactly what is meant
-- here: the rider doing the writing is an active member.
drop policy rides_write on rides;
create policy rides_write on rides for all
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and (crew_id is null or is_crew_member(crew_id))
  );

-- ---------------------------------------------------------------------------
-- 2. The crew timeline. Contributions land in the room's stream rather than a
--    parallel feed, so ordering and pagination come for free and re-attributing
--    a ride can never leave a stale line behind.
-- ---------------------------------------------------------------------------
alter table crew_messages
  add column kind text not null default 'chat' check (kind in ('chat','contribution')),
  add column ride_id uuid references rides(id) on delete cascade,
  add column distance_km numeric;

-- One timeline entry per ride, so a re-attribution moves the entry instead of
-- accumulating them.
create unique index on crew_messages (ride_id) where ride_id is not null;

-- Chat stays chat: the client may only ever write plain messages. Contribution
-- rows come from the trigger below, which is the only thing that can set kind.
drop policy messages_send on crew_messages;
create policy messages_send on crew_messages for insert to authenticated
  with check (profile_id = auth.uid() and is_crew_member(crew_id) and kind = 'chat');

-- Nor may a rider delete a contribution out of the timeline while the ride
-- still counts toward the crew's total. Un-attributing the ride is the way to
-- take it back, and that removes the line through the trigger.
drop policy messages_delete_own on crew_messages;
create policy messages_delete_own on crew_messages for delete to authenticated
  using (profile_id = auth.uid() and kind = 'chat');

/*
 * Keep the timeline in step with the ride.
 *
 * Fires on crew_id AND distance_km because those arrive at different moments:
 * sync writes the ride row first and the geometry second, and distance_km is
 * computed by the ride_tracks trigger afterwards. A contribution attached at
 * finish time would otherwise post "0.0 km" forever.
 *
 * SECURITY DEFINER: messages_send deliberately refuses kind='contribution'
 * from any client, so the trigger is the only door.
 */
create or replace function sync_contribution_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Attribution removed, or moved to a different crew: the old line goes.
  if tg_op = 'UPDATE' and old.crew_id is distinct from new.crew_id then
    delete from crew_messages where ride_id = new.id;
  end if;

  if new.crew_id is null then
    return null;
  end if;

  -- A ride with no distance yet has nothing to announce; the distance_km
  -- update will bring us back here the moment the geometry lands.
  if coalesce(new.distance_km, 0) <= 0 then
    return null;
  end if;

  insert into crew_messages (crew_id, profile_id, body, kind, ride_id, distance_km)
  values (
    new.crew_id,
    new.profile_id,
    'contributed ' || to_char(new.distance_km, 'FM999999990.0') || ' km',
    'contribution',
    new.id,
    new.distance_km
  )
  -- The predicate is repeated so Postgres can infer the partial unique index.
  on conflict (ride_id) where ride_id is not null do update
    set body = excluded.body,
        distance_km = excluded.distance_km,
        crew_id = excluded.crew_id;

  return null;
end;
$$;

create trigger trg_contribution_message
after insert or update of crew_id, distance_km on rides
for each row execute function sync_contribution_message();

-- crew_chat carries the new shape so the room can render a contribution as a
-- timeline entry rather than a chat bubble. (Return shape changed — drop.)
drop function if exists crew_chat(uuid, timestamptz);
create function crew_chat(p_crew_id uuid, p_before timestamptz default null)
returns table (
  id uuid,
  profile_id uuid,
  handle text,
  body text,
  kind text,
  ride_id uuid,
  distance_km numeric,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.id, m.profile_id, p.handle, m.body, m.kind, m.ride_id, m.distance_km, m.created_at
  from crew_messages m
  join profiles p on p.id = m.profile_id
  where m.crew_id = p_crew_id
    and is_crew_member_of(p_crew_id, auth.uid())
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit 50;
$$;

revoke all on function crew_chat(uuid, timestamptz) from public;
grant execute on function crew_chat(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The leaderboard now counts contributions, not memberships.
--
--    A contributed ride stays contributed even if the rider later leaves the
--    crew: the kilometres were given, and a crew's history shouldn't rewrite
--    itself when someone walks. Member count still tracks live membership.
-- ---------------------------------------------------------------------------
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
      select sum(r.distance_km) from rides r where r.crew_id = c.id
    ), 0) as lifetime_km,
    coalesce((
      select sum(r.distance_km) from rides r
      where r.crew_id = c.id and r.started_at >= ist_day_start()
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

-- What a rider has given each of their crews — the seed of the per-crew stats
-- the user wants later, and what the picker reads to show current standing.
create or replace function my_crew_contributions()
returns table (crew_id uuid, ride_count bigint, total_km numeric)
language sql stable security invoker set search_path = public as $$
  select r.crew_id, count(*), coalesce(sum(r.distance_km), 0)
  from rides r
  where r.profile_id = auth.uid() and r.crew_id is not null
  group by r.crew_id;
$$;

revoke all on function my_crew_contributions() from public;
grant execute on function my_crew_contributions() to authenticated;
