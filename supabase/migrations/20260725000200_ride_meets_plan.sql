-- The planned ride and the recording, joined up (user, 2026-07-25).
--
-- Until now these were strangers. You planned a ride — route, meetup, who's
-- coming — then on Sunday you tapped Record and the app had no idea the two
-- were the same thing. RSVPs said who INTENDED to come; nothing said who
-- actually rode.
--
-- Deliberately not fuzzy GPS matching (spec §4.2). The rider knows which ride
-- they're on, and asking once at the start is both cheaper and more accurate
-- than inferring it from a track afterwards.

alter table rides
  add column planned_ride_id uuid references ride_invites(id) on delete set null;
create index on rides (planned_ride_id) where planned_ride_id is not null;

-- You can only attach a ride to a plan you could actually see. rides_write is
-- `for all`, so this covers insert and update.
drop policy rides_write on rides;
create policy rides_write on rides for all
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and (crew_id is null or is_crew_member(crew_id))
    and (planned_ride_id is null or exists (
      select 1 from ride_invites i
      where i.id = planned_ride_id
        and (i.crew_id is null or is_crew_member(i.crew_id))
    ))
  );

-- ---------------------------------------------------------------------------
-- Who actually turned up. RSVPs are intent; this is the record.
-- ---------------------------------------------------------------------------
create or replace function invite_riders(p_invite_id uuid)
returns table (
  profile_id uuid,
  handle text,
  avatar_url text,
  rsvpd boolean,
  ride_id uuid,
  distance_km numeric
)
language sql stable security definer set search_path = public as $$
  -- Everyone who said they were coming, plus anyone who rode it without
  -- saying so — turning up unannounced still counts as being there.
  with people as (
    select r.profile_id from invite_rsvps r where r.invite_id = p_invite_id
    union
    select rd.profile_id from rides rd where rd.planned_ride_id = p_invite_id
  )
  select
    p.id, p.handle, p.avatar_url,
    exists (select 1 from invite_rsvps r
            where r.invite_id = p_invite_id and r.profile_id = p.id),
    rd.id, rd.distance_km
  from people
  join profiles p on p.id = people.profile_id
  left join rides rd
    on rd.planned_ride_id = p_invite_id and rd.profile_id = p.id
  where exists (
    select 1 from ride_invites i
    where i.id = p_invite_id
      and (i.crew_id is null or is_crew_member_of(i.crew_id, auth.uid()))
  )
  order by rd.distance_km desc nulls last, p.handle;
$$;

revoke all on function invite_riders(uuid) from public;
grant execute on function invite_riders(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The rides a rider might be starting right now. Asked once at Record time:
-- "Recording the Sunday run?" — so the window is deliberately generous at the
-- front (people set off early) and short behind (a ride that started six
-- hours ago is not the one you're beginning now).
-- ---------------------------------------------------------------------------
create or replace function my_upcoming_rides()
returns table (
  id uuid,
  title text,
  starts_at timestamptz,
  crew_id uuid,
  route_id uuid,
  meetup text
)
language sql stable security invoker set search_path = public as $$
  select i.id, i.title, i.starts_at, i.crew_id, i.route_id, i.meetup
  from ride_invites i
  join invite_rsvps r on r.invite_id = i.id and r.profile_id = auth.uid()
  where i.starts_at between now() - interval '6 hours' and now() + interval '12 hours'
  order by i.starts_at;
$$;

revoke all on function my_upcoming_rides() from public;
grant execute on function my_upcoming_rides() to authenticated;

-- ---------------------------------------------------------------------------
-- The elegant part. A route planned through Google can only keep its
-- waypoints — their terms forbid storing the computed line. But the moment a
-- rider actually RIDES it, we have a real recorded track, which is the
-- rider's own data with no strings attached at all.
--
-- So riding a route is what gives it permanent geometry. That is also the way
-- offline bundles and ride matching (spec §4.1, §4.2) eventually become
-- possible: not by buying a licence, but by riders using the app.
--
-- Only fills an EMPTY geometry. A route that already has a line keeps it —
-- the first recording wins, and later rides never quietly redraw a road
-- other people have already planned against.
-- ---------------------------------------------------------------------------
create or replace function backfill_route_geometry()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  if new.planned_ride_id is null then
    return null;
  end if;

  select i.route_id into target from ride_invites i where i.id = new.planned_ride_id;
  if target is null then
    return null;
  end if;

  -- Only a CLEAN recording becomes a route. routes.geom is a LINESTRING while
  -- a track is a MULTILINESTRING — one line per segment, split wherever the
  -- signal dropped. Flattening those into one line would invent connections
  -- the rider never rode, which §5 forbids, so a track with gaps is simply
  -- not offered as a road for others to follow. The next clean ride of the
  -- same route fills it instead.
  update routes r
    set geom = (
          select ST_GeometryN(t.geom::geometry, 1)::geography
          from ride_tracks t
          where t.ride_id = new.id and ST_NumGeometries(t.geom::geometry) = 1
        ),
        geom_provider = 'recorded',
        distance_km = case when r.distance_km = 0 then new.distance_km else r.distance_km end
  where r.id = target
    and r.geom is null
    and exists (
      select 1 from ride_tracks t
      where t.ride_id = new.id and ST_NumGeometries(t.geom::geometry) = 1
    );

  return null;
end;
$$;

-- Fires when the track lands, not when the ride row does: sync writes the ride
-- first and the geometry second, so distance and geom only exist afterwards.
create trigger trg_backfill_route_geometry
after insert or update of planned_ride_id, distance_km on rides
for each row execute function backfill_route_geometry();
