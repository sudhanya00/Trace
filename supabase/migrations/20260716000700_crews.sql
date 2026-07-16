-- Crews: small regional groups over a global feed — the WhatsApp riding
-- group, given a real home. Open join, anyone creates (user decisions,
-- 2026-07-16). Creator becomes admin; admins remove members; that's the
-- whole hierarchy for v1.

create table crews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 60),
  region text check (region is null or char_length(region) <= 60),
  description text check (description is null or char_length(description) <= 500),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table crew_members (
  crew_id uuid not null references crews(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  primary key (crew_id, profile_id)
);
create index on crew_members (profile_id);

create table crew_messages (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references crews(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on crew_messages (crew_id, created_at desc);

alter table crews enable row level security;
alter table crew_members enable row level security;
alter table crew_messages enable row level security;

grant select, insert, update, delete on crews to authenticated;
grant select, insert, delete on crew_members to authenticated;
grant select, insert, delete on crew_messages to authenticated;

-- Membership helpers. crew_members is flat-readable to authenticated (open
-- crews mean open rosters), so these stay invoker.
create or replace function is_crew_member(p_crew_id uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from crew_members m
    where m.crew_id = p_crew_id and m.profile_id = auth.uid()
  );
$$;

create or replace function is_crew_admin(p_crew_id uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from crew_members m
    where m.crew_id = p_crew_id and m.profile_id = auth.uid() and m.role = 'admin'
  );
$$;

-- Crews are discoverable by any signed-in rider.
create policy crews_read on crews for select to authenticated using (true);
create policy crews_create on crews for insert to authenticated
  with check (created_by = auth.uid());
create policy crews_admin_update on crews for update to authenticated
  using (is_crew_admin(id));
create policy crews_admin_delete on crews for delete to authenticated
  using (is_crew_admin(id));

-- Open rosters, open join — but you only ever join as yourself, as a plain
-- member. Admin comes from creating the crew (trigger below), never from the
-- client. Leaving is yours; removal is the admin's.
create policy members_read on crew_members for select to authenticated using (true);
create policy members_join on crew_members for insert to authenticated
  with check (profile_id = auth.uid() and role = 'member');
create policy members_leave on crew_members for delete to authenticated
  using (profile_id = auth.uid() or is_crew_admin(crew_id));

-- Chat is for members only — reading and writing.
create policy messages_read on crew_messages for select to authenticated
  using (is_crew_member(crew_id));
create policy messages_send on crew_messages for insert to authenticated
  with check (profile_id = auth.uid() and is_crew_member(crew_id));
create policy messages_delete_own on crew_messages for delete to authenticated
  using (profile_id = auth.uid());

-- Creator lands in their own crew as admin, atomically. SECURITY DEFINER
-- because members_join deliberately refuses role='admin' from clients.
create or replace function seed_crew_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into crew_members (crew_id, profile_id, role)
  values (new.id, new.created_by, 'admin');
  return new;
end;
$$;

create trigger trg_crew_admin
after insert on crews
for each row execute function seed_crew_admin();

-- Explicit-caller membership check for use inside DEFINER functions, where
-- auth.uid() would still be correct but making the caller explicit keeps the
-- definer surface auditable.
create or replace function is_crew_member_of(p_crew_id uuid, p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from crew_members m
    where m.crew_id = p_crew_id and m.profile_id = p_profile_id
  );
$$;

-- Chat rows with handles, same narrow definer shape as route_thread: you're
-- in the same crew, you get to know who's talking.
create or replace function crew_chat(p_crew_id uuid, p_before timestamptz default null)
returns table (
  id uuid,
  profile_id uuid,
  handle text,
  body text,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select m.id, m.profile_id, p.handle, m.body, m.created_at
  from crew_messages m
  join profiles p on p.id = m.profile_id
  where m.crew_id = p_crew_id
    and is_crew_member_of(p_crew_id, auth.uid())
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit 50;
$$;

-- Roster with handles, member-gated the same way.
create or replace function crew_roster(p_crew_id uuid)
returns table (profile_id uuid, handle text, display_name text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.profile_id, p.handle, p.display_name, m.role, m.joined_at
  from crew_members m
  join profiles p on p.id = m.profile_id
  where m.crew_id = p_crew_id
    and is_crew_member_of(p_crew_id, auth.uid())
  order by m.role, m.joined_at;
$$;

revoke all on function crew_chat(uuid, timestamptz) from public;
revoke all on function crew_roster(uuid) from public;
revoke all on function is_crew_member_of(uuid, uuid) from public;
grant execute on function crew_chat(uuid, timestamptz) to authenticated;
grant execute on function crew_roster(uuid) to authenticated;

-- Live chat: realtime WAL stream for members (RLS applies to the stream).
alter publication supabase_realtime add table crew_messages;
