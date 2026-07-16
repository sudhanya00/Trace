-- Planned rides: "Sunday, 6am, Nishat gate — who's in?" An invite lives in a
-- crew (members only) or on the public board (any signed-in rider). One
-- mechanism covers both §13 items. RSVP is a single tap, revocable.

create table ride_invites (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references profiles(id) on delete cascade,
  crew_id uuid references crews(id) on delete cascade, -- null = public board
  route_id uuid references routes(id) on delete set null,
  title text not null check (char_length(title) between 3 and 80),
  meetup text check (meetup is null or char_length(meetup) <= 200),
  region text check (region is null or char_length(region) <= 60),
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on ride_invites (crew_id, starts_at);
create index on ride_invites (starts_at) where crew_id is null;

create table invite_rsvps (
  invite_id uuid not null references ride_invites(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invite_id, profile_id)
);

alter table ride_invites enable row level security;
alter table invite_rsvps enable row level security;

grant select, insert, update, delete on ride_invites to authenticated;
grant select, insert, delete on invite_rsvps to authenticated;

-- Public invites are for signed-in riders; crew invites for members.
create policy invites_read on ride_invites for select to authenticated using (
  crew_id is null or is_crew_member(crew_id)
);
create policy invites_create on ride_invites for insert to authenticated with check (
  created_by = auth.uid() and (crew_id is null or is_crew_member(crew_id))
);
create policy invites_update_own on ride_invites for update to authenticated
  using (created_by = auth.uid());
create policy invites_delete on ride_invites for delete to authenticated
  using (created_by = auth.uid() or (crew_id is not null and is_crew_admin(crew_id)));

-- You RSVP as yourself, to invites you can see.
create policy rsvps_read on invite_rsvps for select to authenticated using (
  exists (select 1 from ride_invites i where i.id = invite_rsvps.invite_id)
);
create policy rsvps_join on invite_rsvps for insert to authenticated with check (
  profile_id = auth.uid()
  and exists (select 1 from ride_invites i where i.id = invite_rsvps.invite_id)
);
create policy rsvps_leave on invite_rsvps for delete to authenticated using (
  profile_id = auth.uid()
);

-- Board rows with names and counts, in one call. Upcoming only (a 6h grace
-- window so a ride in progress doesn't vanish off the board at kickoff).
-- SECURITY DEFINER, same narrow deal as route_thread: posting an invite means
-- your handle shows on it, private profile or not — so visibility must be
-- enforced explicitly here, not inherited from RLS.
create or replace function invite_list(p_crew_id uuid default null)
returns table (
  id uuid,
  created_by uuid,
  handle text,
  crew_id uuid,
  route_id uuid,
  title text,
  meetup text,
  region text,
  starts_at timestamptz,
  rsvp_count bigint,
  i_am_in boolean
)
language sql stable security definer set search_path = public as $$
  select
    i.id, i.created_by, p.handle, i.crew_id, i.route_id, i.title, i.meetup,
    i.region, i.starts_at,
    (select count(*) from invite_rsvps r where r.invite_id = i.id) as rsvp_count,
    exists (
      select 1 from invite_rsvps r
      where r.invite_id = i.id and r.profile_id = auth.uid()
    ) as i_am_in
  from ride_invites i
  join profiles p on p.id = i.created_by
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

-- The WhatsApp-group ping: a crew invite notifies the members (not the
-- poster). Public-board invites notify nobody — the board is discovery.
create or replace function notify_on_invite()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  poster text;
  member record;
begin
  if new.crew_id is null then
    return new;
  end if;
  select handle into poster from profiles where id = new.created_by;
  for member in
    select profile_id from crew_members
    where crew_id = new.crew_id and profile_id <> new.created_by
  loop
    perform notify_profile(
      member.profile_id,
      'Ride planned: ' || new.title,
      '@' || poster || coalesce(' — ' || new.meetup, '') || ' · ' ||
        to_char(new.starts_at at time zone 'UTC', 'Dy DD Mon, HH24:MI') || ' UTC',
      jsonb_build_object('url', '/crew/' || new.crew_id)
    );
  end loop;
  return new;
end;
$$;

create trigger trg_notify_invite
after insert on ride_invites
for each row execute function notify_on_invite();
