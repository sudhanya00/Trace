-- Community v1: discussion anchored to real routes, not a generic board.
-- "Anyone ridden Bhaba Pass in October?" — and the answerers who actually
-- have carry proof.

create table route_comments (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references routes(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  -- Set by trigger, never by the client: whether this rider's own recorded
  -- tracks substantially overlap the route. The credibility marker that
  -- makes a route thread worth more than a form post.
  rode_it boolean not null default false,
  created_at timestamptz not null default now()
);
create index on route_comments (route_id, created_at);

create table condition_reports (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references routes(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  status text not null check (status in ('clear','caution','blocked')),
  note text check (note is null or char_length(note) <= 500),
  rode_it boolean not null default false,
  created_at timestamptz not null default now()
);
create index on condition_reports (route_id, created_at desc);

-- Store-required moderation minimum: anyone can flag a comment; flags are
-- reviewed out-of-band (dashboard) for now.
create table content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  comment_id uuid references route_comments(id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

alter table route_comments enable row level security;
alter table condition_reports enable row level security;
alter table content_reports enable row level security;

grant select, insert, delete on route_comments to authenticated;
grant select on route_comments to anon;
grant select, insert, delete on condition_reports to authenticated;
grant select on condition_reports to anon;
grant select, insert on content_reports to authenticated;

-- Whether the caller may see this route. SECURITY DEFINER because raw routes
-- rows are owner-only under RLS — visibility is judged by can_view, exactly
-- like the clipped accessors, not by raw-row access.
create or replace function route_visible(p_route_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from routes r where r.id = p_route_id and can_view(r.profile_id));
$$;
revoke all on function route_visible(uuid) from public;
grant execute on function route_visible(uuid) to anon, authenticated;

-- Comments and reports inherit the route's visibility exactly: if you can
-- see the route, you can read its thread; if you can't, it doesn't exist.
create policy comments_read on route_comments for select using (
  route_visible(route_id)
);
create policy comments_write on route_comments for insert to authenticated with check (
  profile_id = auth.uid() and route_visible(route_id)
);
create policy comments_delete_own on route_comments for delete to authenticated using (
  profile_id = auth.uid()
);

create policy conditions_read on condition_reports for select using (
  route_visible(route_id)
);
create policy conditions_write on condition_reports for insert to authenticated with check (
  profile_id = auth.uid() and route_visible(route_id)
);
create policy conditions_delete_own on condition_reports for delete to authenticated using (
  profile_id = auth.uid()
);

create policy content_reports_own on content_reports for all to authenticated
  using (reporter_id = auth.uid())
  with check (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The proof-of-riding check: does ≥30% of the route lie within 150m of any
-- of this rider's own recorded tracks? SECURITY DEFINER: the commenter can't
-- read the raw route geometry under RLS (nobody but the owner can), but the
-- comparison against it must still happen. Only a boolean ever leaves.
-- ---------------------------------------------------------------------------
create or replace function rider_rode_route(p_profile_id uuid, p_route_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  with r as (
    select geom, ST_Length(geom) as len from routes where id = p_route_id
  )
  select coalesce((
    select sum(ST_Length(ST_Intersection(t.geom, ST_Buffer(r.geom, 150))))
    from ride_tracks t, r
    where t.profile_id = p_profile_id
      and ST_DWithin(t.geom, r.geom, 150)
  ), 0) > 0.3 * (select len from r);
$$;

create or replace function set_rode_it()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.rode_it := coalesce(rider_rode_route(new.profile_id, new.route_id), false);
  return new;
end;
$$;

create trigger trg_comment_rode_it
before insert on route_comments
for each row execute function set_rode_it();

create trigger trg_condition_rode_it
before insert on condition_reports
for each row execute function set_rode_it();

-- Thread rows need names. Same narrow shape as follow_edges: handle and
-- display name only, only for content you can already see.
create or replace function route_thread(p_route_id uuid)
returns table (
  id uuid,
  profile_id uuid,
  handle text,
  display_name text,
  body text,
  rode_it boolean,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.profile_id, p.handle, p.display_name, c.body, c.rode_it, c.created_at
  from route_comments c
  join profiles p on p.id = c.profile_id
  where c.route_id = p_route_id
    and exists (select 1 from routes r where r.id = p_route_id and can_view(r.profile_id))
  order by c.created_at asc;
$$;

create or replace function route_conditions(p_route_id uuid)
returns table (
  id uuid,
  profile_id uuid,
  handle text,
  status text,
  note text,
  rode_it boolean,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select cr.id, cr.profile_id, p.handle, cr.status, cr.note, cr.rode_it, cr.created_at
  from condition_reports cr
  join profiles p on p.id = cr.profile_id
  where cr.route_id = p_route_id
    and exists (select 1 from routes r where r.id = p_route_id and can_view(r.profile_id))
  order by cr.created_at desc
  limit 20;
$$;

revoke all on function route_thread(uuid) from public;
revoke all on function route_conditions(uuid) from public;
grant execute on function route_thread(uuid) to anon, authenticated;
grant execute on function route_conditions(uuid) to anon, authenticated;
