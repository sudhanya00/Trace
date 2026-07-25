-- Live location, rebuilt around crews (user, 2026-07-25).
--
-- The old design failed the only test that matters: the rider couldn't tell
-- who could see them. A toggle reading "share live location with followers
-- while riding" broadcast to every accepted follower — an audience you never
-- chose — and the only place anyone could see it was by opening your profile
-- and noticing a dot. Obscure switch, wrong audience, hidden surface.
--
-- Now: you pick which crews, they see it in the room where they already talk
-- about riding, and it disappears when you stop.

alter table live_positions
  add column shared_crew_ids uuid[] not null default '{}';

-- Followers no longer get this by default. Live position is a crew thing now:
-- being followed is not the same as being expected on a ride.
drop policy live_followers_read on live_positions;

/**
 * A position is visible to an active member of any crew the rider chose —
 * and only while it's fresh. A stale row means the app died or the ride
 * ended badly; showing a two-hour-old dot as "live" is worse than showing
 * nothing, because someone might ride to it.
 */
create policy live_crew_read on live_positions for select to authenticated using (
  updated_at > now() - interval '15 minutes'
  and exists (
    select 1 from crew_members m
    where m.profile_id = auth.uid()
      and m.state = 'active'
      and m.crew_id = any (live_positions.shared_crew_ids)
  )
);

-- ---------------------------------------------------------------------------
-- The announcement. One message per crew, the moment the rider says go —
-- crew_messages refuses any kind but 'chat' from a client, so this is a
-- definer function and the only door.
-- ---------------------------------------------------------------------------
alter table crew_messages drop constraint crew_messages_kind_check;
alter table crew_messages add constraint crew_messages_kind_check
  check (kind in ('chat', 'contribution', 'live_share'));

create or replace function announce_live_share(p_crew_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  foreach target in array p_crew_ids loop
    -- Only crews the rider is actually in; a client can't announce itself
    -- into a room it doesn't belong to.
    if is_crew_member_of(target, auth.uid()) then
      insert into crew_messages (crew_id, profile_id, body, kind)
      values (target, auth.uid(), 'is sharing live location', 'live_share');
    end if;
  end loop;
end;
$$;
revoke all on function announce_live_share(uuid[]) from public;
grant execute on function announce_live_share(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Who is out right now, for the banner. Fresh rows only, same 15-minute rule
-- as the policy — the banner empties itself when riders stop.
-- ---------------------------------------------------------------------------
create or replace function crew_live_riders(p_crew_id uuid)
returns table (
  profile_id uuid,
  handle text,
  avatar_url text,
  point jsonb,
  ride_started_at timestamptz,
  updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select l.profile_id, p.handle, p.avatar_url,
         ST_AsGeoJSON(l.geom)::jsonb, l.ride_started_at, l.updated_at
  from live_positions l
  join profiles p on p.id = l.profile_id
  where p_crew_id = any (l.shared_crew_ids)
    and l.updated_at > now() - interval '15 minutes'
    and is_crew_member_of(p_crew_id, auth.uid())
  order by l.updated_at desc;
$$;
revoke all on function crew_live_riders(uuid) from public;
grant execute on function crew_live_riders(uuid) to authenticated;

-- crew_chat carries the new kind through unchanged — it already returns
-- `kind`, so a live_share row renders as its own thing rather than a bubble.
